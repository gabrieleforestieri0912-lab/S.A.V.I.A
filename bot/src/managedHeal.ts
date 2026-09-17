import path from "node:path";
import { config, ProjectConfig } from "./config.js";
import { log } from "./logger.js";
import { healthMonitor, redactSecrets } from "./healthMonitor.js";
import type { ThresholdEvent } from "./healthMonitor.js";
import { getRunner } from "./agents/index.js";
import * as gitOps from "./gitOps.js";
import { checkGhAuth, getDefaultBranch, createPr } from "./prOps.js";

/**
 * Self-healing ESTESO ai progetti gestiti — OPT-IN per progetto (projects.config.json: "selfHeal": true)
 * Perimetro diverso dal core: agisce sul repo del progetto che ha fallito, non su S.A.V.I.A.
 * Riutilizza stesso pattern ma con guardrail ancora più stretti:
 * - max 1 PR pendente per progetto
 * - mai merge/restart automatico
 * - solo errori di build/test/lint, mai auth (esclusi da healthMonitor)
 */

function makeManagedBranchName(projectName: string, cause: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const slug = cause.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s-]/g, "").trim().split(/\s+/).slice(0, 3).join("-") || "fix";
  return `savia/self-heal/${projectName}/${stamp}-${slug}`;
}

interface DiagnosisManaged {
  confidence: "high" | "medium" | "low";
  cause: string;
  filesToModify: string[];
  fixType: string;
  promptForAgent: string;
  shouldFix: boolean;
}

const DIAG_MANAGED_SYSTEM = `Sei il modulo di diagnosi self-healing per un PROGETTO GESTITO da S.A.V.I.A. (non il core S.A.V.I.A. stesso).
Analizza un fallimento ricorrente avvenuto durante l'esecuzione di un agente di coding su quel progetto (es. test falliti, build rotta, lint error) e restituisci SOLO JSON:

{
  "confidence": "high | medium | low",
  "cause": "causa breve",
  "filesToModify": ["path/file.ts"],
  "fixType": "bugfix | test-fix | build-fix | lint-fix",
  "promptForAgent": "istruzioni operative per l'agente",
  "shouldFix": true|false
}
Regole: se confidence != high → shouldFix=false. Non suggerire mai modifiche a S.A.V.I.A. core, solo file del progetto gestito.`;

function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON");
  return s.slice(start, end + 1);
}

async function diagnoseManaged(project: ProjectConfig, event: ThresholdEvent): Promise<DiagnosisManaged | null> {
  if (!config.openrouterApiKey) return null;
  const redactedLogs = event.recentLogs.map(redactSecrets).join("\n").slice(0, 7000);
  const redactedError = redactSecrets(event.record.rawMessage).slice(0, 2000);
  const userContent =
    `PROGETTO: ${project.name} (${project.path})\n` +
    `ERRORE RICORRENTE: ${event.signature}\n` +
    `Occorrenze: ${event.record.occurrences.length} in 30m\n` +
    `Stack: ${redactedError}\n\n` +
    `Log recenti:\n${redactedLogs}\n\nRispondi SOLO JSON.`;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openrouterApiKey}`,
        "HTTP-Referer": "https://github.com/savia",
        "X-Title": "S.A.V.I.A Managed Self-Heal",
      },
      body: JSON.stringify({
        model: config.openrouterModel,
        messages: [
          { role: "system", content: DIAG_MANAGED_SYSTEM },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const obj = JSON.parse(extractJson(raw)) as Record<string, unknown>;
    const conf = obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low" ? obj.confidence : "low";
    return {
      confidence: conf as DiagnosisManaged["confidence"],
      cause: typeof obj.cause === "string" ? obj.cause : "unknown",
      filesToModify: Array.isArray(obj.filesToModify) ? (obj.filesToModify as string[]).filter((x) => typeof x === "string") : [],
      fixType: typeof obj.fixType === "string" ? obj.fixType : "bugfix",
      promptForAgent: typeof obj.promptForAgent === "string" ? obj.promptForAgent : "",
      shouldFix: Boolean(obj.shouldFix) && conf === "high",
    };
  } catch (e) {
    log({ level: "error", event: "managed_diagnose_failed", error: String(e).slice(0, 500) });
    return null;
  }
}

export type ManagedNotifier = { notify(chatId: string, text: string): Promise<void> | void };

export async function handleManagedHeal(project: ProjectConfig, event: ThresholdEvent, notifier?: ManagedNotifier): Promise<void> {
  const chatId = config.allowedChatId;
  const sig = event.signature;

  // per-progetto: se già pending, suppress
  const state = healthMonitor.getState();
  const existing = state.errors[sig];
  if (existing?.pendingPrUrl) {
    const msg = `⚠️ [${project.name}] Stesso errore gestito già in PR: ${existing.pendingPrUrl} — nessuna nuova PR`;
    log({ level: "warn", event: "managed_suppressed_pending", error: sig });
    if (notifier && chatId) await notifier.notify(chatId, msg);
    return;
  }

  const diagnosis = await diagnoseManaged(project, event);
  if (!diagnosis || !diagnosis.shouldFix) {
    const msg = `🔍 [${project.name}] Self-healing gestito: diagnosi incerta (confidence: ${diagnosis?.confidence ?? "fail"})\nErrore: ${event.record.normalizedMessage.slice(0, 80)}\n→ Serve intervento manuale.`;
    log({ level: "warn", event: "managed_low_confidence", error: sig });
    if (notifier && chatId) await notifier.notify(chatId, msg);
    return;
  }

  const repo = project.path;
  const branch = makeManagedBranchName(project.name, diagnosis.cause);
  let originalBranch = "";

  try {
    if (!(await gitOps.isWorkingTreeClean(repo))) {
      const msg = `🔧 [${project.name}] Self-healing abortito: working tree sporco, non creo ${branch}`;
      log({ level: "error", event: "managed_dirty", error: branch });
      if (notifier && chatId) await notifier.notify(chatId, msg);
      return;
    }
    const gh = await checkGhAuth(repo);
    // proceed anyway
    originalBranch = await gitOps.getCurrentBranch(repo);
    await gitOps.createBranch(repo, branch);

    const prompt =
      `Sei in self-healing per il progetto "${project.name}".\n` +
      `Errore ricorrente: ${redactSecrets(event.record.rawMessage).slice(0, 1200)}\n` +
      `Causa diagnosticata: ${diagnosis.cause}\nFile: ${diagnosis.filesToModify.join(", ")}\n` +
      `Istruzioni: ${diagnosis.promptForAgent}\n` +
      `Vincoli: modifica SOLO file di questo progetto (${project.path}), mai S.A.V.I.A. core. Non toccare secret. Verifica con build/test se pertinenti.`;

    const runner = getRunner("opencode", config.agentTimeoutMs);
    const result = await runner.run(repo, prompt);
    if (!result.success) {
      const changed = await gitOps.getChangedFiles(repo).catch(() => []);
      if (changed.length > 0) await gitOps.stashChanges(repo, `savia-managed-heal-failed: ${diagnosis.cause}`).catch(() => {});
      await gitOps.checkoutBranch(repo, originalBranch).catch(() => {});
      const msg = `❌ [${project.name}] Self-healing fallito (OpenCode)\n${result.error?.slice(0, 300) || ""}`;
      log({ level: "error", event: "managed_runner_failed", error: sig });
      if (notifier && chatId) await notifier.notify(chatId, msg);
      return;
    }
    const changed = await gitOps.getChangedFiles(repo);
    if (!changed.length) {
      await gitOps.checkoutBranch(repo, originalBranch).catch(() => {});
      await gitOps.deleteBranch(repo, branch).catch(() => {});
      const msg = `🔧 [${project.name}] Self-healing: nessuna modifica prodotta per "${diagnosis.cause}"`;
      log({ level: "warn", event: "managed_no_changes", error: sig });
      if (notifier && chatId) await notifier.notify(chatId, msg);
      return;
    }
    await gitOps.commitChanges(repo, `fix(self-heal:${project.name}): ${diagnosis.cause.slice(0, 70)} [${sig.slice(0, 20)}]`);
    await gitOps.pushBranch(repo, branch);
    let prUrl: string | null = null;
    try {
      const base = await getDefaultBranch(repo);
      const title = `fix(self-heal:${project.name}): ${diagnosis.cause.slice(0, 60)}`;
      const body = [
        `**Self-healing gestito** per \`${project.name}\``,
        `**Errore:** ${event.record.normalizedMessage}`,
        `**Occorrenze:** ${event.record.occurrences.length} in 30m`,
        `**Causa:** ${diagnosis.cause}`,
        `**File modificati (${changed.length}):**`,
        ...changed.map((f) => `- ${f}`),
        `**Branch:** ${branch}`,
        `⚠️ Revisiona e mergia manualmente — il progetto continua su codice attuale.`,
      ].join("\n");
      prUrl = await createPr(repo, { base, head: branch, title, body });
    } catch (e) {
      log({ level: "error", event: "managed_pr_failed", error: String(e).slice(0, 400) });
    }
    await gitOps.checkoutBranch(repo, originalBranch).catch(() => {});
    if (prUrl) {
      healthMonitor.markPending(sig, branch, prUrl);
      const msg = `🔧 Self-healing GESTITO attivato per ${project.name}\nErrore: ${event.record.normalizedMessage.slice(0, 70)}\nDiagnosi: ${diagnosis.cause}\n🔗 PR: ${prUrl}\n⚠️ Mergia manualmente quando verificato.`;
      log({ level: "info", event: "managed_pr_opened", error: prUrl });
      if (notifier && chatId) await notifier.notify(chatId, msg);
    } else {
      healthMonitor.markPending(sig, branch, `local:${branch}`);
      const msg = `🔧 [${project.name}] Commit+push su ${branch} ma PR non aperta — crea a mano: gh pr create --head ${branch}`;
      if (notifier && chatId) await notifier.notify(chatId, msg);
    }
  } catch (e) {
    log({ level: "error", event: "managed_pipeline_error", error: String(e).slice(0, 600) });
    try { if (originalBranch) await gitOps.checkoutBranch(repo, originalBranch); } catch {}
    if (notifier && chatId) await notifier.notify(chatId, `⚠️ [${project.name}] Self-healing errore: ${String(e).slice(0, 300)}`);
  }
}
