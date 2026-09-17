import { spawn as ptySpawn } from "node-pty";
import { AgentName, AgentResult, AgentRunner } from "./types.js";
import { config } from "../config.js";
import { killPid } from "../util.js";
import { log } from "../logger.js";

function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

export class FreeBuffRunner implements AgentRunner {
  readonly name: AgentName = "freebuff";

  constructor(private readonly timeoutMs: number) {}

  run(projectPath: string, prompt: string): Promise<AgentResult> {
    return new Promise<AgentResult>((resolve) => {
      let pty: ReturnType<typeof ptySpawn>;
      try {
        pty = ptySpawn("freebuff", ["--cwd", projectPath], {
          cwd: projectPath,
          env: process.env,
          cols: 200,
          rows: 40,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log({ level: "error", event: "freebuff_spawn_failed", error: message });
        resolve({
          success: false,
          output: "",
          filesChanged: [],
          error: `Impossibile avviare freebuff via pseudo-terminal: ${message}`,
        });
        return;
      }

      let output = "";
      let finished = false;

      const finish = (result: AgentResult): void => {
        if (finished) return;
        finished = true;
        clearTimeout(hardTimer);
        if (quietTimer) clearTimeout(quietTimer);
        try {
          pty.write("\x03");
        } catch {
          // Ignora.
        }
        setTimeout(() => {
          try {
            pty.kill();
          } catch {
            // Ignora.
          }
          killPid(pty.pid);
        }, 300);
        resolve(result);
      };

      const hardTimer = setTimeout(() => {
        finish({
          success: false,
          output: stripAnsi(output),
          filesChanged: [],
          error: "TIMEOUT",
        });
      }, this.timeoutMs);

      let quietTimer: ReturnType<typeof setTimeout> | undefined;
      const resetQuiet = (): void => {
        if (config.freebuffQuietMs <= 0) return;
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => {
          if (output.length > 0) {
            finish({ success: true, output: stripAnsi(output), filesChanged: [] });
          }
        }, config.freebuffQuietMs);
      };

      pty.onData((data: string) => {
        output += data;
        const cleaned = stripAnsi(output);
        const pattern = config.freebuffDonePattern;
        if (pattern && new RegExp(pattern).test(cleaned)) {
          finish({ success: true, output: cleaned, filesChanged: [] });
          return;
        }
        resetQuiet();
      });

      pty.onExit(() => {
        finish({ success: true, output: stripAnsi(output), filesChanged: [] });
      });

      setTimeout(() => {
        try {
          pty.write(prompt + "\r");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          finish({
            success: false,
            output: stripAnsi(output),
            filesChanged: [],
            error: `Impossibile inviare il prompt a freebuff: ${message}`,
          });
        }
        resetQuiet();
      }, config.freebuffStartupMs);
    });
  }
}
