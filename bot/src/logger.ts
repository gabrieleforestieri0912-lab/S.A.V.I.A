import fs from "node:fs";
import path from "node:path";

const logDir = path.resolve(process.cwd(), "logs");
const logFile = path.join(logDir, "savia.log");

try {
  fs.mkdirSync(logDir, { recursive: true });
} catch {
  // Non blocchiamo mai il bot per problemi di logging.
}

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  chatId?: string;
  text?: string;
  result?: unknown;
  error?: string;
}

export function log(entry: Omit<LogEntry, "timestamp">): void {
  const line: LogEntry = { timestamp: new Date().toISOString(), ...entry };
  try {
    fs.appendFileSync(logFile, JSON.stringify(line) + "\n", "utf-8");
  } catch {
    // Silenzioso: il logging non deve mai far crashare il processo.
  }
}
