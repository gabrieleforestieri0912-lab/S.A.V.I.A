import { spawn } from "node:child_process";

export class GhError extends Error {
  constructor(
    message: string,
    public readonly code: number | string | undefined,
    public readonly stderr: string,
    public readonly stdout: string
  ) {
    super(message);
    this.name = "GhError";
  }
}

interface GhRun {
  stdout: string;
  stderr: string;
  code: number;
}

function runGh(repoPath: string, args: string[]): Promise<GhRun> {
  return new Promise<GhRun>((resolve, reject) => {
    const child = spawn("gh", args, { cwd: repoPath, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(new GhError(err.message, err.code ?? "ENOENT", "", ""));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new GhError(`gh exited with code ${code}`, code ?? -1, stderr, stdout));
      }
    });
  });
}

export interface GhAuthResult {
  ok: boolean;
  detail: string;
}

export async function checkGhAuth(repoPath: string): Promise<GhAuthResult> {
  try {
    await runGh(repoPath, ["auth", "status"]);
    return { ok: true, detail: "" };
  } catch (err) {
    const e = err as GhError;
    if (e.code === "ENOENT") {
      return { ok: false, detail: "gh non installato nel PATH" };
    }
    const detail = (e.stderr || e.message || "").trim().split("\n")[0] || "gh non autenticato";
    return { ok: false, detail };
  }
}

export async function getDefaultBranch(repoPath: string): Promise<string> {
  const out = await runGh(repoPath, ["repo", "view", "--json", "defaultBranchRef"]);
  try {
    const parsed = JSON.parse(out.stdout) as {
      defaultBranchRef?: { name?: string } | null;
    };
    const name = parsed.defaultBranchRef?.name;
    if (!name) {
      throw new GhError("defaultBranchRef mancante nella risposta di gh", 0, out.stderr, out.stdout);
    }
    return name;
  } catch (err) {
    if (err instanceof GhError) throw err;
    throw new GhError("Risposta di gh repo view non valida", 0, "", out.stdout);
  }
}

function extractPrUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+\/pull\/\d+/);
  return match ? match[0] : null;
}

export interface CreatePrOptions {
  base: string;
  head: string;
  title: string;
  body: string;
}

export async function createPr(repoPath: string, opts: CreatePrOptions): Promise<string> {
  const out = await runGh(repoPath, [
    "pr",
    "create",
    "--base",
    opts.base,
    "--head",
    opts.head,
    "--title",
    opts.title,
    "--body",
    opts.body,
  ]);
  const url = extractPrUrl(out.stdout);
  if (!url) {
    throw new GhError("Impossibile estrarre l'URL della PR dall'output di gh", 0, out.stderr, out.stdout);
  }
  return url;
}
