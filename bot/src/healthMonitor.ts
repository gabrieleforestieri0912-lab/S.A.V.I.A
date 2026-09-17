import fs from "node:fs";
import path from "node:path";
import { log } from "./logger.js";

// ── Types ───────────────────────────────────────────────────────────────
export type HealthScope = "core" | "managed";

export interface ErrorRecord {
  signature: string;
  rawMessage: string;
  normalizedMessage: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  occurrences: string[]; // ISO timestamps
  pendingPrUrl?: string | null;
  pendingBranch?: string | null;
  pendingCreatedAt?: string | null;
  disabled?: boolean;
  disabledUntil?: string | null;
  disabledReason?: string | null;
  lastPrUrl?: string | null;
  lastPrMergedAt?: string | null; // set after merge detection (manual)
}

export interface HealthState {
  errors: Record<string, ErrorRecord>;
  globalPendingCount: number;
}

export interface ThresholdEvent {
  signature: string;
  record: ErrorRecord;
  recentLogs: string[];
}

// ── Config (fallback spec) ──────────────────────────────────────────────
const STATE_FILE = path.resolve(process.cwd(), "health-state.json");

const THRESHOLD_COUNT = 3;
const THRESHOLD_WINDOW_MS = 30 * 60 * 1000; // 30 min
const LOG_LINES_FOR_DIAGNOSIS = 50;
const MAX_GLOBAL_PENDING = 2;

// Errori che NON attivano mai self-healing (solo notifica diretta)
const EXCLUDED_PATTERNS = [
  /telegram.*token/i,
  /TELEGRAM_BOT_TOKEN/i,
  /openrouter.*api.*key/i,
  /OPENROUTER_API_KEY/i,
  /gh auth/i,
  /github.*auth/i,
  /anthropic.*api/i,
  /notion.*api.*key/i,
  /NOTION_MCP_API_KEY/i,
  /rate limit.*telegram/i,
  /ETELEGRAM/i,
  /401.*unauthorized/i,
  /403.*forbidden/i,
  /invalid.*token/i,
  /credentials/i,
  /ENOTFOUND.*api\.telegram/i,
];

// ── Helpers ─────────────────────────────────────────────────────────────
function redactSecrets(text: string): string {
  let out = text;
  // Bearer tokens, sk-..., api keys
  out = out.replace(/sk-(or|proj)-[A-Za-z0-9_-]{10,}/g, "[REDACTED_API_KEY]");
  out = out.replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]");
  out = out.replace(/ghp_[A-Za-z0-9_]{20,}/g, "[REDACTED_GH_TOKEN]");
  out = out.replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_GH_TOKEN]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer [REDACTED]");
  out = out.replace(/TELEGRAM_BOT_TOKEN\s*=\s*\S+/gi, "TELEGRAM_BOT_TOKEN=[REDACTED]");
  out = out.replace(/OPENROUTER_API_KEY\s*=\s*\S+/gi, "OPENROUTER_API_KEY=[REDACTED]");
  out = out.replace(/NOTION_MCP_API_KEY\s*=\s*\S+/gi, "NOTION_MCP_API_KEY=[REDACTED]");
  // generic token=xxx
  out = out.replace(/(token|apiKey|apikey|secret|password)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
  return out;
}

export function normalizeSignature(raw: string): string {
  let s = String(raw || "");
  // take first line of stack if present
  s = s.split("\n")[0];
  s = s.toLowerCase();
  // strip paths: C:\... or /home/... -> keep filename
  s = s.replace(/[a-z]:\\[^:\s]*/gi, (m) => path.basename(m));
  s = s.replace(/\/[^:\s]+\//g, "/");
  // strip line/col numbers :123:45
  s = s.replace(/:\d+:\d+/g, "");
  s = s.replace(/:\d+/g, "");
  // strip hex ids, timestamps, numbers
  s = s.replace(/\b0x[0-9a-f]+\b/gi, "0xID");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, "TIMESTAMP");
  s = s.replace(/\b\d+\b/g, "N");
  // strip urls
  s = s.replace(/https?:\/\/\S+/g, "URL");
  // collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // keep first 160 chars as signature
  return s.slice(0, 160) || "unknown";
}

export function isExcludedFromHealing(normalizedOrRaw: string): boolean {
  const t = normalizedOrRaw.toLowerCase();
  return EXCLUDED_PATTERNS.some((re) => re.test(t));
}

function loadState(): HealthState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as HealthState;
      if (parsed && typeof parsed.errors === "object") return parsed;
    }
  } catch (_) {}
  return { errors: {}, globalPendingCount: 0 };
}

function saveState(state: HealthState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (_) {}
}

function readRecentLogs(n: number): string[] {
  try {
    const logFile = path.resolve(process.cwd(), "logs/savia.log");
    if (!fs.existsSync(logFile)) return [];
    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    return lines.slice(-n);
  } catch (_) {
    return [];
  }
}

// ── HealthMonitor singleton ────────────────────────────────────────────
type ThresholdCallback = (event: ThresholdEvent) => Promise<void> | void;

class HealthMonitor {
  private state: HealthState = loadState();
  private thresholdCb: ThresholdCallback | null = null;

  onThreshold(cb: ThresholdCallback): void {
    this.thresholdCb = cb;
  }

  recordError(rawError: unknown, scope: HealthScope = "core", extra?: { fileHint?: string }): ThresholdEvent | null {
    if (scope !== "core") {
      // managed project errors: log only, never heal
      const msg = rawError instanceof Error ? rawError.message : String(rawError);
      log({ level: "warn", event: "managed_error_ignored_for_healing", error: redactSecrets(msg).slice(0, 500) });
      return null;
    }

    const rawMessage = rawError instanceof Error ? (rawError.stack || rawError.message) : String(rawError);
    const redacted = redactSecrets(rawMessage);
    const normalized = normalizeSignature(redacted);
    const signature = normalized;

    // excluded patterns → never heal, just log
    if (isExcludedFromHealing(redacted) || isExcludedFromHealing(normalized)) {
      log({ level: "warn", event: "excluded_error_no_heal", error: signature });
      return null;
    }

    const now = new Date();
    const iso = now.toISOString();
    const rec = this.state.errors[signature] || {
      signature,
      rawMessage: redacted.slice(0, 2000),
      normalizedMessage: normalized,
      count: 0,
      firstSeen: iso,
      lastSeen: iso,
      occurrences: [],
      pendingPrUrl: null,
      disabled: false,
    };

    // if disabled (fix failed within 24h), do not count toward healing
    if (rec.disabled) {
      const until = rec.disabledUntil ? new Date(rec.disabledUntil).getTime() : 0;
      if (until && Date.now() < until) {
        rec.occurrences.push(iso);
        rec.lastSeen = iso;
        this.state.errors[signature] = rec;
        saveState(this.state);
        log({ level: "warn", event: "healing_disabled_for_signature", error: signature });
        return null;
      } else if (rec.disabled) {
        // expired → re-enable
        rec.disabled = false;
        rec.disabledUntil = null;
        rec.disabledReason = null;
      }
    }

    rec.count += 1;
    rec.lastSeen = iso;
    rec.rawMessage = redacted.slice(0, 2000);
    rec.occurrences.push(iso);
    // keep only occurrences within window
    const windowStart = now.getTime() - THRESHOLD_WINDOW_MS;
    rec.occurrences = rec.occurrences.filter((ts) => new Date(ts).getTime() >= windowStart);
    // adjust count to windowed
    rec.count = rec.occurrences.length;
    if (rec.occurrences.length === 1) rec.firstSeen = iso;

    // if already has pending PR, circuit breaker: do not re-trigger, but notify via callback with flag
    if (rec.pendingPrUrl) {
      this.state.errors[signature] = rec;
      saveState(this.state);
      log({ level: "warn", event: "duplicate_heal_suppressed", error: `${signature} -> pending ${rec.pendingPrUrl}` });
      return null;
    }

    // global pending cap
    if (this.state.globalPendingCount >= MAX_GLOBAL_PENDING) {
      this.state.errors[signature] = rec;
      saveState(this.state);
      log({ level: "warn", event: "global_heal_cap_reached", error: signature });
      return null;
    }

    this.state.errors[signature] = rec;
    saveState(this.state);

    // check threshold
    if (rec.occurrences.length >= THRESHOLD_COUNT) {
      const recentLogs = readRecentLogs(LOG_LINES_FOR_DIAGNOSIS);
      const event: ThresholdEvent = { signature, record: { ...rec }, recentLogs };
      log({ level: "error", event: "healing_threshold_exceeded", error: signature });
      if (this.thresholdCb) {
        // fire async, don't block
        Promise.resolve(this.thresholdCb(event)).catch((e) => {
          log({ level: "error", event: "threshold_callback_failed", error: String(e).slice(0, 500) });
        });
      }
      return event;
    }

    log({ level: "warn", event: "error_recorded", error: `${signature} (${rec.occurrences.length}/${THRESHOLD_COUNT})` });
    return null;
  }

  // Circuit breaker helpers
  markPending(signature: string, branch: string, prUrl: string): void {
    const rec = this.state.errors[signature];
    if (rec) {
      rec.pendingPrUrl = prUrl;
      rec.pendingBranch = branch;
      rec.pendingCreatedAt = new Date().toISOString();
      this.state.errors[signature] = rec;
    }
    this.state.globalPendingCount = Object.values(this.state.errors).filter((r) => !!r.pendingPrUrl).length;
    saveState(this.state);
  }

  clearPending(signature: string): void {
    const rec = this.state.errors[signature];
    if (rec) {
      rec.lastPrUrl = rec.pendingPrUrl || rec.lastPrUrl;
      rec.pendingPrUrl = null;
      rec.pendingBranch = null;
      rec.pendingCreatedAt = null;
      // reset occurrences to avoid immediate re-trigger
      rec.occurrences = [];
      rec.count = 0;
      this.state.errors[signature] = rec;
    }
    this.state.globalPendingCount = Object.values(this.state.errors).filter((r) => !!r.pendingPrUrl).length;
    saveState(this.state);
  }

  disableSignature(signature: string, reason: string, hours = 24): void {
    const rec = this.state.errors[signature];
    if (!rec) return;
    rec.disabled = true;
    rec.disabledUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    rec.disabledReason = reason;
    this.state.errors[signature] = rec;
    saveState(this.state);
  }

  resetSignature(signature: string): void {
    delete this.state.errors[signature];
    this.state.globalPendingCount = Object.values(this.state.errors).filter((r) => !!r.pendingPrUrl).length;
    saveState(this.state);
  }

  resetAll(): void {
    this.state = { errors: {}, globalPendingCount: 0 };
    saveState(this.state);
  }

  getState(): HealthState {
    return JSON.parse(JSON.stringify(this.state));
  }

  getRecentLogs(n = LOG_LINES_FOR_DIAGNOSIS): string[] {
    return readRecentLogs(n);
  }
}

export const healthMonitor = new HealthMonitor();
export { redactSecrets, STATE_FILE, THRESHOLD_COUNT, THRESHOLD_WINDOW_MS, MAX_GLOBAL_PENDING };
