export interface ParseResult {
  project: string | null;
  agent: "freebuff" | "opencode" | null;
  confidence: "high" | "medium" | "low";
  intent_summary: string;
  ambiguous: boolean;
  clarification_needed: string | null;
}
