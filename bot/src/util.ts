import { spawn, ChildProcess } from "node:child_process";

export function killTree(child: ChildProcess): void {
  killPid(child.pid);
}

export function killPid(pid: number | undefined): void {
  if (pid == null) return;

  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // Ignora: il cleanup è best-effort.
    }
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignora.
    }
  }
}
