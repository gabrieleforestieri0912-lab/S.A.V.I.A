import { spawn } from "node:child_process";
import { AgentName, AgentResult, AgentRunner } from "./types.js";
import { killTree } from "../util.js";

const TIMEOUT_ERROR = "TIMEOUT";

export class OpenCodeRunner implements AgentRunner {
  readonly name: AgentName = "opencode";

  constructor(private readonly timeoutMs: number) {}

  run(projectPath: string, prompt: string): Promise<AgentResult> {
    return new Promise<AgentResult>((resolve) => {
      const args = ["run", prompt, "--auto", "--print-logs"];
      const child = spawn("opencode", args, {
        cwd: projectPath,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

      const timer = setTimeout(() => {
        killTree(child);
        resolve({
          success: false,
          output: stdout + stderr,
          filesChanged: [],
          error: TIMEOUT_ERROR,
        });
      }, this.timeoutMs);

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: stdout + stderr,
          filesChanged: [],
          error: err.message,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const output = stdout + stderr;
        if (code === 0) {
          resolve({ success: true, output, filesChanged: [] });
        } else {
          resolve({
            success: false,
            output,
            filesChanged: [],
            error: `Processo terminato con codice ${code}`,
          });
        }
      });
    });
  }
}
