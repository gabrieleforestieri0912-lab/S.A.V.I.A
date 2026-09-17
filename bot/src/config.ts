import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

export interface ProjectConfig {
  name: string;
  path: string;
  aliases: string[];
}

export interface ProjectsFile {
  projects: ProjectConfig[];
}

export interface AppConfig {
  telegramBotToken: string;
  openrouterApiKey: string;
  allowedChatId: string;
  openrouterModel: string;
  agentTimeoutMs: number;
  freebuffStartupMs: number;
  freebuffQuietMs: number;
  freebuffDonePattern: string;
  notionMcpApiKey: string;
  projects: ProjectConfig[];
}

function loadProjects(): ProjectConfig[] {
  const file = path.resolve(process.cwd(), "projects.config.json");
  const raw = fs.readFileSync(file, "utf-8");
  const parsed = JSON.parse(raw) as ProjectsFile;
  if (!parsed || !Array.isArray(parsed.projects)) {
    throw new Error("projects.config.json non valido: manca la chiave 'projects'.");
  }
  return parsed.projects;
}

export const config: AppConfig = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  allowedChatId: (process.env.ALLOWED_CHAT_ID ?? "").trim(),
  openrouterModel: process.env.OPENROUTER_MODEL?.trim() || "nvidia/nemotron-3.5-lightning:free",
  agentTimeoutMs: Number(process.env.AGENT_TIMEOUT_MS) || 600000,
  freebuffStartupMs: Number(process.env.FREEBUFF_STARTUP_MS) || 3000,
  freebuffQuietMs: Number(process.env.FREEBUFF_QUIET_MS) || 3000,
  freebuffDonePattern: process.env.FREEBUFF_DONE_PATTERN?.trim() || "",
  notionMcpApiKey: process.env.NOTION_MCP_API_KEY?.trim() || "",
  projects: loadProjects(),
};
