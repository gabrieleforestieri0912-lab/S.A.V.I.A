import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "./config.js";

// Client MCP dedicato del bot S.A.V.I.A per Notion.
// Avvia il server ufficiale @notionhq/notion-mcp-server in stdio e ne
// espone i tool (lettura + scrittura) tramite un'interfaccia tipizzata.
// L'autenticazione usa NOTION_MCP_API_KEY (token di integrazione Notion)
// passato come Bearer in OPENAPI_MCP_HEADERS.

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let cachedTools: string[] = [];

export async function connectNotionMcp(): Promise<{
  ok: boolean;
  error?: string;
  tools?: string[];
}> {
  if (client) return { ok: true, tools: cachedTools };

  const apiKey = config.notionMcpApiKey;
  if (!apiKey) {
    return { ok: false, error: "NOTION_MCP_API_KEY non impostata in .env.local" };
  }

  const headers = JSON.stringify({
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": "2022-06-28",
  });

  try {
    transport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { ...process.env, OPENAPI_MCP_HEADERS: headers },
    });
    client = new Client({ name: "savia-bot", version: "1.0.0" });
    await client.connect(transport);
    const res = await client.listTools();
    cachedTools = (res.tools || []).map((t) => t.name);
    return { ok: true, tools: cachedTools };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    client = null;
    transport = null;
    return { ok: false, error: message };
  }
}

async function ensure(): Promise<Client> {
  const r = await connectNotionMcp();
  if (!r.ok || !client) throw new Error(r.error || "Notion MCP non connesso");
  return client;
}

async function call(tool: string, args: Record<string, unknown>): Promise<string> {
  const c = await ensure();
  const res = await c.callTool({ name: tool, arguments: args });
  const content = Array.isArray(res.content) ? res.content : [];
  let text = "";
  for (const part of content) {
    if (part && typeof part === "object") {
      const p = part as { type?: string; text?: string };
      if (p.type === "text") text += (text ? "\n" : "") + String(p.text || "");
      else text += (text ? "\n" : "") + JSON.stringify(part);
    }
  }
  if (res.isError && text) text = "[ERRORE] " + text;
  return text || "(vuoto)";
}

export const notion = {
  verify: () => call("notion_retrieve_bot_user", {}),
  retrievePage: (pageId: string) => call("notion_retrieve_page", { page_id: pageId }),
  queryDatabase: (databaseId: string, filter?: Record<string, unknown>) =>
    call("notion_query_database", {
      database_id: databaseId,
      page_size: 50,
      ...(filter ? { filter } : {}),
    }),
  createPage: (
    databaseId: string,
    properties: Record<string, unknown>,
    children?: unknown[]
  ) => {
    const a: Record<string, unknown> = { parent: { database_id: databaseId }, properties };
    if (children) a.children = children;
    return call("notion_create_page", a);
  },
  updatePage: (pageId: string, properties: Record<string, unknown>) =>
    call("notion_update_page", { page_id: pageId, properties }),
  search: (query?: string, filter?: Record<string, unknown>) =>
    call("notion_search", {
      ...(query ? { query } : {}),
      ...(filter ? { filter } : {}),
    }),
  appendBlockChildren: (blockId: string, children: unknown[]) =>
    call("notion_append_block_children", { block_id: blockId, children }),
};

export async function disconnectNotionMcp(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
  client = null;
  transport = null;
  cachedTools = [];
}
