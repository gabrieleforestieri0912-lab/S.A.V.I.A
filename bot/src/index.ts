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

const LOGO_PATH = path.resolve(process.cwd(), "..", "savia.png");

function validateConfig(): void {
  const missing: string[] = [];
  if (!config.telegramBotToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.geminiApiKey) missing.push("GEMINI_API_KEY");
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
  await bot.sendMessage(chatId, text);
}

const notifier: Notifier = {
  notify(chatId: string, text: string) {
    return sendReply(chatId, text);
  },
};

const jobQueue = new JobQueue(notifier);

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
    log({ level: "error", event: "parse_failed", chatId, error: message });
    await sendReply(
      chatId,
      "⚠️ Si è verificato un errore durante l'elaborazione del messaggio " +
        "(chiamata LLM o parsing del risultato). Riprova più tardi."
    );
  }
});

bot.on("polling_error", (error: Error) => {
  log({ level: "error", event: "polling_error", error: error.message });
  console.error("Polling error:", error.message);
});

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

console.log("S.A.V.I.A — Second Brain Remote Control (Fase 2) in ascolto...");
