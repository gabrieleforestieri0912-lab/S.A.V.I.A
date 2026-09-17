import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";
import { healthMonitor, redactSecrets, normalizeSignature } from "./healthMonitor.js";
import type { ThresholdEvent } from "./healthMonitor.js";
import { getRunner } from "./agents/index.js";
import * as gitOps from "./gitOps.js";
import { checkGhAuth, getDefaultBranch, createPr } from "./prOps.js";

// Repo di S.A.V.I.A stesso (bot è in <repo>/bot)
const SAVIA_REPO = path.resolve(process.cwd(), "..");

// ── Diagnosis via OpenRouter (stessa chiave) ──────────────────────────
interface Diagnosis {
  confidence: "high" | "medium" | "low";
  cause: string;
  filesToModify: string[];
  fixType: string;
  promptForAgent: string;
  isAuthError: boolean;
  shouldFix: boolean;
}

const DIAGNOSIS_SYSTEM = `Sei il modulo di diagnosi self-healing di S.A.V.I.A.
Analizza un errore ricorrente nel codice di S.A.V.I.A. stesso (bot, parser, agentRunner, gitOps, prOps, jobQueue) e restituisci ESCLUSIVAMENTE JSON valido con questa struttura:

{
  "confidence": "high | medium | low",
  "cause": "frase breve che descrive la causa probabile",
  "filesToModify": ["path/relativo.js", ...],
  "fixType": "bugfix | null-check | error-handling | config | altro",
  "promptForAgent": "prompt dettagliato per l'agente di coding che farà la fix — descrivi cosa modificare, dove, e come verificare",
  "isAuthError": true|false,
  "shouldFix": true|false
}

Regole:
- Se l'errore sembra di autenticazione/credenziali (token, API key, gh auth, rate limit) → isAuthError=true, shouldFix=false, confidence=low
- Se non riesci a identificare causa chiara → confidence=low, shouldFix=false
- filesToModify deve contenere solo file del repo S.A.V.I.A. (bot/src/*, src/* se pertinenti), mai progetti gestiti
- promptForAgent deve essere operativo e sicuro: non includere secret, non chiedere merge automatico`;

function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON");
  return s.slice(start, end + 1);
}

async function diagnoseWithOpenRouter(event: ThresholdEvent): Promise<Diagnosis | null> {
  if (!config.openrouterApiKey) {
    log({ level: "error", event: "diagnose_no_key" });
    return null;
  }
  const redactedLogs = event.recentLogs.map(redactSecrets).join("\n").slice(0, 8000);
  const redactedError = redactSecrets(event.record.rawMessage).slice(0, 2000);
  const userContent =
    `ERRORE RICORRENTE (signature: ${event.signature})\n` +
    `Occorrenze: ${event.record.occurrences.length} in 30 minuti\n` +
    `Ultimo stack/message:\n${redactedError}\n\n` +
    `Ultime ${event.recentLogs.length} righe di log (redatte):\n${redactedLogs}\n\n` +
    `File coinvolti possibili: bot/src/healthMonitor.ts, bot/src/selfHeal.ts, bot/src/parser.ts, bot/src/gitOps.ts, bot/src/prOps.ts, bot/src/jobQueue.ts, bot/src/index.ts\n` +
    `Rispondi SOLO con il JSON richiesto.`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openrouterApiKey}`,
        "HTTP-Referer": "https://github.com/savia",
        "X-Title": "S.A.V.I.A Self-Heal",
      },
      body: JSON.stringify({
        model: config.openrouterModel,
        messages: [
          { role: "system", content: DIAGNOSIS_SYSTEM },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenRouter diagnose ${res.status}: ${t.slice(0, 400)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const jsonStr = extractJson(raw);
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    const confidence = obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low" ? obj.confidence : "low";
    // normalize
    const diag: Diagnosis = {
      confidence: confidence as Diagnosis["confidence"],
      cause: typeof obj.cause === "string" ? obj.cause : "unknown",
      filesToModify: Array.isArray(obj.filesToModify) ? (obj.filesToModify as string[]).filter((x) => typeof x === "string") : [],
      fixType: typeof obj.fixType === "string" ? obj.fixType : "bugfix",
      promptForAgent: typeof obj.promptForAgent === "string" ? obj.promptForAgent : "",
      isAuthError: Boolean(obj.isAuthError),
      shouldFix: Boolean(obj.shouldFix),
    };
    // auth guard
    if (diag.isAuthError) diag.shouldFix = false;
    if (diag.confidence === "low") diag.shouldFix = false;
    return diag;
  } catch (e) {
    log({ level: "error", event: "diagnose_failed", error: String(e).slice(0, 600) });
    return null;
  }
}

// ── Auto-correction (branch + PR su repo S.A.V.I.A) ────────────────────
function makeSelfHealBranchName(cause: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const slug = cause
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-") || "fix";
  return `savia/self-heal/${stamp}-${slug}`;
}

export type Notifier = { notify(chatId: string, text: string): Promise<void> | void };

export async function handleSelfHeal(event: ThresholdEvent, notifier?: Notifier): Promise<void> {
  const chatId = config.allowedChatId;
  const sig = event.signature;

  // ── Circuit breaker: stesso errore con PR già pendente
  const state = healthMonitor.getState();
  const existing = state.errors[sig];
  if (existing?.pendingPrUrl) {
    const msg = `⚠️ Stesso errore ripetuto, PR di correzione già in attesa: ${existing.pendingPrUrl}, nessuna nuova azione`;
    log({ level: "warn", event: "selfheal_suppressed_pending", error: sig });
    if (notifier && chatId) await notifier.notify(chatId, msg);
    return;
  }
  if (state.globalPendingCount >= 2) {
    const msg = `⚠️ Self-healing in pausa: 2 PR di correzione già pendenti, non avvio un terzo ciclo per "${sig.slice(0, 80)}". Revisione richiesta.`;
    log({ level: "warn", event: "selfheal_suppressed_global_cap", error: sig });
    if (notifier && chatId) await notifier.notify(chatId, msg);
    return;
  }

  // ── Se dopo merge lo stesso errore ritorna entro 24h → disattiva
  // (rilevato via flag disabled; qui controlliamo se lastPrMergedAt recente)
  // Questo check è già gestito da healthMonitor recordError che blocca se disabled.

  // ── Diagnosi
  const diagnosis = await diagnoseWithOpenRouter(event);
  if (!diagnosis) {
    const msg =
      `🔍 Self-healing: diagnosi fallita per "${event.record.normalizedMessage.slice(0, 80)}"\n` +
      `Occorrenze: ${event.record.occurrences.length} in 30m\n` +
      `⚠️ Serve intervento manuale — log completi in health-state.json`;
    log({ level: "error", event: "selfheal_diagnose_failed", error: sig });
    if (notifier && chatId) await notifier.notify(chatId, msg);
    return;
  }

  if (!diagnosis.shouldFix || diagnosis.confidence !== "high") {
    const msg =
      `🔍 Self-healing: causa incerta (confidence: ${diagnosis.confidence})\n` +
      `Errore: ${event.record.normalizedMessage.slice(0, 100)}\n` +
      `Causa ipotizzata: ${diagnosis.cause}\n` +
      `⚠️ Non procedo con fix automatico, serve verifica manuale.`;
    log({ level: "warn", event: "selfheal_low_confidence", error: JSON.stringify(diagnosis).slice(0, 600) });
    if (notifier && chatId) await notifier.notify(chatId, msg);
    return;
  }

  if (diagnosis.isAuthError) {
    const msg =
      `🔐 Errore di autenticazione rilevato — nessun auto-fix tentato.\n` +
      `Errore: ${event.record.normalizedMessage.slice(0, 100)}\n` +
      `Causa: ${diagnosis.cause}\n` +
      `👉 Verifica TELEGRAM_BOT_TOKEN / OPENROUTER_API_KEY / gh auth`;
    log({ level: "warn", event: "selfheal_auth_error", error: sig });
    if (notifier && chatId) await notifier.notify(chatId, msg);
    return;
  }

  // ── Branch + OpenCode su repo S.A.V.I.A
  const repo = SAVIA_REPO;
  let originalBranch = "";
  const branch = makeSelfHealBranchName(diagnosis.cause);

  try {
    if (!(await gitOps.isWorkingTreeClean(repo))) {
      const msg = `🔧 Self-healing abortito: working tree di S.A.V.I.A sporco, non creo branch ${branch}. Pulisci e riprova.`;
      log({ level: "error", event: "selfheal_dirty_tree", error: branch });
      if (notifier && chatId) await notifier.notify(chatId, msg);
      return;
    }

    const gh = await checkGhAuth(repo);
    if (!gh.ok) {
      log({ level: "warn", event: "selfheal_gh_not_authed", error: gh.detail });
      // procediamo comunque con branch locale, PR fallirà ma branch resta
    }

    originalBranch = await gitOps.getCurrentBranch(repo);
    await gitOps.createBranch(repo, branch);

    // Costruisci prompt per OpenCode — perimetro esplicito SOLO S.A.V.I.A
    const agentPrompt =
      `Sei in modalità self-healing di S.A.V.I.A. Ripara un bug nel repo S.A.V.I.A. stesso (NON nei progetti che gestisce).\n` +
      `Contesto errore (redatto):\n${redactSecrets(event.record.rawMessage).slice(0, 1500)}\n\n` +
      `Diagnosi LLM:\nCausa: ${diagnosis.cause}\nFile da modificare: ${diagnosis.filesToModify.join(", ") || "da inferire"}\n` +
      `Tipo fix: ${diagnosis.fixType}\n\n` +
      `Istruzioni fix:\n${diagnosis.promptForAgent}\n\n` +
      `Vincoli:\n- Modifica SOLO codice di S.A.V.I.A. (bot/src/*, src/* se necessario), MAI progetti gestiti\n` +
      `- Non toccare token/chiavi, usa redazione [REDACTED] se vedi secret\n` +
      `- Scrivi codice robusto con gestione errori\n` +
      `- Dopo la fix, verifica con tsc --noEmit se rilevante\n` +
      `Firma errore normalizzata: ${sig}\n`;

    const runner = getRunner("opencode", config.agentTimeoutMs);
    const result = await runner.run(repo, agentPrompt);

    if (!result.success) {
      const changed = await gitOps.getChangedFiles(repo).catch(() => []);
      if (changed.length > 0) await gitOps.stashChanges(repo, `savia-selfheal-failed: ${diagnosis.cause}`).catch(() => {});
      await gitOps.checkoutBranch(repo, originalBranch).catch(() => {});
      const msg = `❌ Self-healing fallito (OpenCode) per "${diagnosis.cause}"\nErrore: ${result.error?.slice(0, 300) || "unknown"}`;
      log({ level: "error", event: "selfheal_runner_failed", error: msg.slice(0, 600) });
      if (notifier && chatId) await notifier.notify(chatId, msg);
      return;
    }

    const changed = await gitOps.getChangedFiles(repo);
    if (changed.length === 0) {
      await gitOps.checkoutBranch(repo, originalBranch).catch(() => {});
      await gitOps.deleteBranch(repo, branch).catch(() => {});
      const msg = `🔧 Self-healing: OpenCode non ha prodotto modifiche per "${diagnosis.cause}" — branch rimosso. Serve intervento manuale.`;
      log({ level: "warn", event: "selfheal_no_changes", error: sig });
      if (notifier && chatId) await notifier.notify(chatId, msg);
      return;
    }

    await gitOps.commitChanges(repo, `fix(self-heal): ${diagnosis.cause.slice(0, 80)} [${sig.slice(0, 30)}]`);

    // push + PR (stesso flusso Fase 3)
    let prUrl: string | null = null;
    let pushOk = false;
    try {
      await gitOps.pushBranch(repo, branch);
      pushOk = true;
    } catch (e) {
      const msg = `✅ Self-healing commit su ${branch} ma push fallito: ${String(e).slice(0, 300)}\n🔧 Branch locale pronto, pusha a mano: git push -u origin ${branch}`;
      await gitOps.checkoutBranch(repo, originalBranch).catch(() => {});
      log({ level: "error", event: "selfheal_push_failed", error: String(e).slice(0, 400) });
      if (notifier && chatId) await notifier.notify(chatId, msg);
      return;
    }

    if (pushOk) {
      try {
        const base = await getDefaultBranch(repo);
        const title = `fix(self-heal): ${diagnosis.cause.slice(0, 60)}`;
        const body = [
          `**Self-healing automatico** — errore ricorrente rilevato da healthMonitor`,
          ``,
          `**Errore:** ${event.record.normalizedMessage}`,
          `**Occorrenze:** ${event.record.occurrences.length} in 30m`,
          `**Causa diagnosticata:** ${diagnosis.cause}`,
          `**File modificati (${changed.length}):**`,
          ...changed.map((f) => `- ${f}`),
          ``,
          `**Branch:** ${branch}`,
          `**Diagnosi confidence:** ${diagnosis.confidence}`,
          ``,
          `⚠️ Il sistema continua a girare con il codice attuale. Applica la correzione manualmente quando l'hai rivista (merge + riavvio).`,
          ``,
          `🤖 PR generata automaticamente da S.A.V.I.A. self-healing — revisionare prima del merge`,
        ].join("\n");
        prUrl = await createPr(repo, { base, head: branch, title, body });
      } catch (e) {
        log({ level: "error", event: "selfheal_pr_failed", error: String(e).slice(0, 400) });
      }
    }

    await gitOps.checkoutBranch(repo, originalBranch).catch(() => {});

    if (prUrl) {
      healthMonitor.markPending(sig, branch, prUrl);
      const msg =
        `🔧 Self-healing attivato\n` +
        `Errore rilevato: ${event.record.normalizedMessage.slice(0, 80)}\n` +
        `Occorrenze: ${event.record.occurrences.length} in 30m\n` +
        `Diagnosi: ${diagnosis.cause}\n` +
        `🔗 PR con la correzione proposta: ${prUrl}\n\n` +
        `⚠️ Il sistema continua a girare con il codice attuale. Applica la correzione manualmente quando l'hai rivista.`;
      log({ level: "info", event: "selfheal_pr_opened", error: prUrl });
      if (notifier && chatId) await notifier.notify(chatId, msg);
    } else {
      const msg = `🔧 Self-healing commit+push su ${branch} ma PR non aperta — apri a mano: gh pr create --head ${branch}`;
      log({ level: "error", event: "selfheal_pr_failed_final", error: branch });
      if (notifier && chatId) await notifier.notify(chatId, msg);
      // comunque marca pending per evitare duplicati locali
      healthMonitor.markPending(sig, branch, `local:${branch}`);
    }
  } catch (e) {
    log({ level: "error", event: "selfheal_pipeline_error", error: String(e).slice(0, 600) });
    try {
      if (originalBranch) await gitOps.checkoutBranch(repo, originalBranch);
    } catch {}
    if (notifier && chatId) await notifier.notify(chatId, `⚠️ Self-healing errore pipeline: ${String(e).slice(0, 400)}`);
  }
}

// Per test / reset manuale del circuit breaker esposto via comandi Telegram
export function getSelfHealState() {
  return healthMonitor.getState();
}
export function resetSelfHeal(signature?: string) {
  if (signature) healthMonitor.resetSignature(signature);
  else healthMonitor.resetAll();
}
