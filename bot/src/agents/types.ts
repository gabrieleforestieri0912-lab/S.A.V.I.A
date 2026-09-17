export type AgentName = "opencode" | "freebuff";

export interface AgentResult {
  success: boolean;
  output: string;
  filesChanged: string[];
  error?: string;
}

export interface AgentRunner {
  name: AgentName;
  run(projectPath: string, prompt: string): Promise<AgentResult>;
}
