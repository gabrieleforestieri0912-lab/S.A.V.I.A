import { config } from "./config.js";
import type { ParseResult } from "./types.js";

const SYSTEM_PROMPT = `Sei il modulo di parsing di S.A.V.I.A, un sistema che interpreta comandi in linguaggio naturale per pilotare agenti di coding su progetti locali.

Ti verrà fornito:
1. L'elenco dei progetti disponibili, ciascuno con un "name" e una lista di "aliases".
2. Il messaggio testuale dell'utente.

Devi restituire ESCLUSIVAMENTE un oggetto JSON valido, senza alcun testo aggiuntivo prima o dopo, e senza code fence (niente \`\`\`json). La struttura deve essere esattamente:

{
  "project": "nome-progetto-o-null",
  "agent": "freebuff | opencode | null",
  "confidence": "high | medium | low",
  "intent_summary": "riassunto breve di cosa viene chiesto",
  "ambiguous": true,
  "clarification_needed": "domanda da fare se ambiguous=true, altrimenti null"
}

REGOLE FONDAMENTALI:
(a) PROGETTO: associa il messaggio a un progetto SOLO se è ragionevolmente chiaro dal testo o da uno dei suoi alias. Se non è chiaro, NON indovinare: imposta "project": null e "ambiguous": true. È sempre meglio chiedere un chiarimento che scegliere un progetto sbagliato.
(b) AGENTE: riconosci quale agente è richiesto SOLO se viene esplicitamente nominato nel messaggio (es. "con opencode", "usa freebuff", "fai fare a opencode"). Altrimenti imposta "agent": null. Non inferire l'agente dal tipo di task.
(c) FORMATO: rispondi ESCLUSIVAMENTE con il JSON. Nessun markdown, nessun code fence, nessuna spiegazione. Se il messaggio è troppo vago per capire il progetto, o se un alias potrebbe combaciare con più progetti, imposta "ambiguous": true e scrivi in "clarification_needed" una domanda utile (in italiano) per disambiguare.`;

function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    s = fence[1].trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Nessun JSON trovato nella risposta del modello.");
  }
  return s.slice(start, end + 1);
}

function normalize(obj: Record<string, unknown>): ParseResult {
  const agent = obj.agent;
  const validAgent = agent === "freebuff" || agent === "opencode" ? agent : null;
  const confidence = obj.confidence;
  const validConfidence =
    confidence === "high" || confidence === "medium" || confidence === "low"
      ? confidence
      : "low";
  return {
    project: typeof obj.project === "string" ? obj.project : null,
    agent: validAgent,
    confidence: validConfidence,
    intent_summary: typeof obj.intent_summary === "string" ? obj.intent_summary : "",
    ambiguous: Boolean(obj.ambiguous),
    clarification_needed:
      typeof obj.clarification_needed === "string" ? obj.clarification_needed : null,
  };
}

export async function parseMessage(text: string): Promise<ParseResult> {
  if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY non configurata");

  const projectsList = config.projects.map((p) => ({ name: p.name, aliases: p.aliases }));
  const userContent =
    `PROGETTI DISPONIBILI:\n${JSON.stringify(projectsList, null, 2)}\n\n` +
    `MESSAGGIO DELL'UTENTE:\n${text}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openrouterApiKey}`,
      "HTTP-Referer": "https://github.com/savia",
      "X-Title": "S.A.V.I.A Bot",
    },
    body: JSON.stringify({
      model: config.openrouterModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenRouter error ${res.status}: ${err.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "";

  const jsonString = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error("La risposta del modello non è un JSON valido.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("La risposta del modello non è un oggetto JSON valido.");
  }

  return normalize(parsed as Record<string, unknown>);
}
