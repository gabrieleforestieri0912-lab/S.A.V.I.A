import { AgentName, AgentRunner } from "./types.js";
import { OpenCodeRunner } from "./openCodeRunner.js";
import { FreeBuffRunner } from "./freeBuffRunner.js";

export function getRunner(name: AgentName, timeoutMs: number): AgentRunner {
  switch (name) {
    case "opencode":
      return new OpenCodeRunner(timeoutMs);
    case "freebuff":
      return new FreeBuffRunner(timeoutMs);
  }
}

export * from "./types.js";
