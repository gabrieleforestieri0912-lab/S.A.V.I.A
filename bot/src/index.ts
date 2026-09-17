import fs from "node:fs";
import path from "node:path";
import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import { parseMessage } from "./parser.js";
import { log } from "./logger.js";
import { AgentName } from "./agents/index.js";
import { JobQueue, type Notifier } from "./jobQueue.js";
import type { ExecJob } from "./executor.js";
import { connectNotionMcp, notion } from "./notionMcp.js";
import { healthMonitor, redactSecrets } from "./healthMonitor.js";
import { handleSelfHeal, getSelfHealState, resetSelfHeal } from "./selfHeal.js";

const LOGO_PATH = path.resolve(process.cwd(), "..", "savia.png");

function validateConfig(): void {
  const missing: string[] = [];
  if (!config.telegramBotToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.openrouterApiKey) missing.push("OPENROUTER_API_KEY");
  if (!config.allowedChatId) missing.push("ALLOWED_CHAT_ID");

  if (missing.length > 0) {
    console.error(
      `Errore: variabili mancanti in .env.local: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}

validateConfig();

const bot = new TelegramBot(config.telegramBotToken, { polling: true });

async function sendReply(chatId: string, text: string): Promise<void> {
  try {
    if (fs.existsSync(LOGO_PATH)) {
      await bot.sendPhoto(chatId, LOGO_PATH, { caption: text });
      return;
    }
  } catch (err) {
    log({
      level: "warn",
      event: "logo_send_failed",
      chatId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    await bot.sendMessage(chatId, text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log({ level: "error", event: "telegram_send_failed", chatId, error: redactSecrets(msg).slice(0, 600) });
    // core scope → health monitor (potenziale credenziale scaduta → escluso)
    healthMonitor.recordError(new Error(`telegram_send_failed: ${msg}`), "core");
    throw err;
  }
}

const notifier: Notifier = {
  notify(chatId: string, text: string) {
    return sendReply(chatId, text);
  },
};

const jobQueue = new JobQueue(notifier);

// ── HealthMonitor wiring (core only) ──────────────────────────────────
healthMonitor.onThreshold(async (event) => {
  await handleSelfHeal(event, notifier);
});

// Global crash handlers — livello 1 resilienza è PM2, qui logghiamo e tracciamo
process.on("uncaughtException", (err) => {
  const redacted = redactSecrets(err.stack || err.message);
  log({ level: "error", event: "uncaught_exception", error: redacted.slice(0, 2000) });
  console.error("uncaughtException:", redacted.slice(0, 800));
  healthMonitor.recordError(err, "core", { fileHint: "uncaughtException" });
  // non exit: PM2 riavvierà se necessario, ma proviamo a restare up per loggare
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const redacted = redactSecrets(err.stack || err.message);
  log({ level: "error", event: "unhandled_rejection", error: redacted.slice(0, 2000) });
  console.error("unhandledRejection:", redacted.slice(0, 800));
  healthMonitor.recordError(err, "core", { fileHint: "unhandledRejection" });
});

bot.on("polling_error", (error: Error) => {
  const redacted = redactSecrets(error.message);
  log({ level: "error", event: "polling_error", error: redacted.slice(0, 600) });
  console.error("Polling error:", redacted.slice(0, 400));
  healthMonitor.recordError(error, "core");
});

bot.on("message", async (msg) => {
  const chatId = String(msg.chat.id);
  const text = msg.text ?? "";

  if (chatId !== config.allowedChatId) {
    log({ level: "warn", event: "unauthorized_message_ignored", chatId });
    return;
  }

  if (!text) {
    return;
  }

  // ── Self-heal commands (perimetro: solo S.A.V.I.A core) ──────────────
  if (text.startsWith("/heal")) {
    await handleHealCommand(chatId, text);
    return;
  }

  if (text.startsWith("/notion")) {
    await handleNotionCommand(chatId, text);
    return;
  }

  log({ level: "info", event: "message_received", chatId, text });

  try {
    const result = await parseMessage(text);
    log({ level: "info", event: "parse_success", chatId, result });

    if (result.ambiguous) {
      const reply =
        `❓ Ho bisogno di un chiarimento:\n\n` +
        `${result.clarification_needed ?? "Non ho capito a quale progetto ti riferisci."}`;
      await sendReply(chatId, reply);
      return;
    }

    if (!result.project) {
      await sendReply(
        chatId,
        "❓ Non ho capito a quale progetto ti riferisci. Indica il progetto (es. " +
          "il nome o un alias) nel messaggio."
      );
      return;
    }

    const project = config.projects.find((p) => p.name === result.project);
    if (!project) {
      await sendReply(
        chatId,
        `❓ Il progetto "${result.project}" non è configurato in projects.config.json.`
      );
      return;
    }

    const agentName: AgentName = result.agent ?? "opencode";
    const job: ExecJob = {
      chatId,
      project,
      agentName,
      intentSummary: result.intent_summary,
      prompt: text,
    };
    jobQueue.enqueue(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({ level: "error", event: "parse_failed", chatId, error: redactSecrets(message).slice(0, 600) });
    healthMonitor.recordError(err instanceof Error ? err : new Error(message), "core", { fileHint: "parser.ts" });
    await sendReply(
      chatId,
      "⚠️ Si è verificato un errore durante l'elaborazione del messaggio " +
        "(chiamata LLM o parsing del risultato). Riprova più tardi."
    );
  }
});

async function handleHealCommand(chatId: string, raw: string): Promise<void> {
  const parts = raw.trim().split(/\s+/);
  const sub = (parts[1] || "").toLowerCase();
  const rest = raw.trim().slice((parts[0] + (parts[1] ? " " + parts[1] : "")).length).trim();
  try {
    switch (sub) {
      case "status": {
        const state = getSelfHealState();
        const lines: string[] = [];
        lines.push(`🩺 Self-healing status — pending: ${state.globalPendingCount}/2`);
        const entries = Object.values(state.errors);
        if (!entries.length) {
          lines.push("Nessun errore tracciato.");
        } else {
          for (const r of entries.slice(0, 10)) {
            const pend = r.pendingPrUrl ? `→ PR: ${r.pendingPrUrl}` : "";
            const dis = r.disabled ? `⛔ disabilitato fino ${r.disabledUntil} (${r.disabledReason})` : "";
            lines.push(`- ${r.signature.slice(0, 70)} — ${r.count} occ. ultima: ${r.lastSeen} ${pend} ${dis}`.trim());
          }
          if (entries.length > 10) lines.push(`... e altri ${entries.length - 10} signatures`);
        }
        await sendReply(chatId, lines.join("\n").slice(0, 3800));
        return;
      }
      case "reset": {
        if (!rest) {
          resetSelfHeal();
          await sendReply(chatId, "✅ Circuit breaker resettato: tutte le firme azzerate.");
        } else {
          resetSelfHeal(rest);
          await sendReply(chatId, `✅ Firma resettata: ${rest.slice(0, 120)}`);
        }
        return;
      }
      case "logs": {
        const state = getSelfHealState();
        const sig = rest;
        if (!sig) {
          await sendReply(chatId, "Uso: /heal logs <signature>  oppure  /heal logs all");
          return;
        }
        if (sig === "all") {
          const recent = healthMonitor.getRecentLogs(20).map(redactSecrets).join("\n").slice(0, 3500);
          await sendReply(chatId, `📋 Ultime 20 righe di log (redatte):\n${recent}`);
          return;
        }
        const rec = state.errors[sig] || Object.values(state.errors).find((r) => r.signature.includes(sig));
        if (!rec) {
          await sendReply(chatId, `Nessuna firma trovata per: ${sig.slice(0, 80)}`);
          return;
        }
        await sendReply(chatId, `📋 ${rec.signature}\nOccorrenze: ${rec.occurrences.join(", ").slice(0, 1000)}\nPending: ${rec.pendingPrUrl || "-"}\nDisabled: ${rec.disabled ? rec.disabledUntil : "no"}`);
        return;
      }
      default:
        await sendReply(
          chatId,
          "🩺 Comandi self-healing:\n" +
            "/heal status — stato circuit breaker e PR pendenti\n" +
            "/heal reset [signature] — resetta una firma o tutto\n" +
            "/heal logs <signature|all> — mostra log recenti\n"
        );
    }
  } catch (err) {
    await sendReply(chatId, `⚠️ Errore heal: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleNotionCommand(chatId: string, raw: string): Promise<void> {
  const parts = raw.trim().split(/\s+/);
  const sub = (parts[1] || "").toLowerCase();
  const rest = raw
    .trim()
    .slice((parts[0] + (parts[1] ? " " + parts[1] : "")).length)
    .trim();

  try {
    switch (sub) {
      case "test":
      case "verify": {
        const r = await connectNotionMcp();
        if (!r.ok) {
          await sendReply(chatId, `❌ Notion MCP: ${r.error}`);
          return;
        }
        const info = await notion.verify();
        await sendReply(
          chatId,
          `✅ Notion MCP connesso.\nTool: ${r.tools?.join(", ") || "-"}\n\n${info.slice(0, 1500)}`
        );
        return;
      }
      case "search": {
        const out = await notion.search(rest || undefined);
        await sendReply(chatId, `🔎 Risultati ricerca:\n${out.slice(0, 3500)}`);
        return;
      }
      case "query": {
        const db = rest.trim();
        if (!db) {
          await sendReply(chatId, "Uso: /notion query <database_id>");
          return;
        }
        const out = await notion.queryDatabase(db);
        await sendReply(chatId, `📄 Database ${db}:\n${out.slice(0, 3500)}`);
        return;
      }
      case "add": {
        const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
        if (!m) {
          await sendReply(chatId, "Uso: /notion add <database_id> <titolo>");
          return;
        }
        const out = await notion.createPage(m[1], {
          Name: { title: [{ text: { content: m[2] } }] },
        });
        await sendReply(chatId, `✅ Pagina creata:\n${out.slice(0, 3500)}`);
        return;
      }
      case "page": {
        const id = rest.trim();
        if (!id) {
          await sendReply(chatId, "Uso: /notion page <page_id>");
          return;
        }
        const out = await notion.retrievePage(id);
        await sendReply(chatId, `📄 Pagina:\n${out.slice(0, 3500)}`);
        return;
      }
      default:
        await sendReply(
          chatId,
          "📚 Comandi Notion (via MCP):\n" +
            "/notion test — verifica connessione\n" +
            "/notion search <query> — cerca pagine\n" +
            "/notion query <database_id> — interroga database\n" +
            "/notion add <database_id> <titolo> — crea pagina\n" +
            "/notion page <page_id> — leggi pagina"
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendReply(chatId, `⚠️ Errore Notion MCP: ${message}`);
  }
}

console.log("S.A.V.I.A — Second Brain Remote Control (Fase 4 self-healing) in ascolto...");
