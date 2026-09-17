/**
 * S.A.V.I.A — Notion via MCP bridge (renderer side)
 *
 * Sostituisce le chiamate REST dirette a api.notion.com con chiamate
 * agli strumenti di un server MCP (es. @notionhq/notion-mcp-server).
 * L'autenticazione vive nella configurazione del server MCP, non più
 * in una API key locale.
 *
 * Risoluzione del server Notion:
 *   1. selezione esplicita (localStorage "notion-mcp-server-id")
 *   2. auto-detect: il primo server connesso che espone tool "notion_*"
 */
(function () {
  const KEY_SERVER_ID = 'notion-mcp-server-id';

  async function mcpStatus() {
    if (!window.electronAPI || !window.electronAPI.mcpStatus) {
      return { servers: [], tools: [] };
    }
    try {
      return await window.electronAPI.mcpStatus();
    } catch {
      return { servers: [], tools: [] };
    }
  }

  async function resolveServerId(force) {
    if (window.__saviaNotionServerId && !force) return window.__saviaNotionServerId;
    const explicit = localStorage.getItem(KEY_SERVER_ID);
    if (explicit) {
      window.__saviaNotionServerId = explicit;
      return explicit;
    }
    const st = await mcpStatus();
    const t = (st.tools || []).find((t) => /^notion[_-]/i.test(t.name));
    if (t) {
      window.__saviaNotionServerId = t.serverId;
      return t.serverId;
    }
    return null;
  }

  async function callTool(toolName, args) {
    const serverId = await resolveServerId();
    if (!serverId) {
      throw new Error(
        'Nessun server MCP Notion connesso. Aggiungine uno in Impostazioni → MCP ' +
          '(server ufficiale @notionhq/notion-mcp-server).'
      );
    }
    if (!window.electronAPI || !window.electronAPI.mcpCallTool) {
      throw new Error('MCP non disponibile (electronAPI.mcpCallTool mancante).');
    }
    const r = await window.electronAPI.mcpCallTool({
      serverId,
      tool: toolName,
      args: args || {}
    });
    if (!r || !r.ok) {
      throw new Error((r && r.error) ? r.error : 'Errore chiamata MCP');
    }
    let data = null;
    if (typeof r.result === 'string') {
      try { data = JSON.parse(r.result); } catch { /* keep text */ }
    }
    return { text: r.result, data };
  }

  const api = {
    mcpStatus,
    resolveServerId,
    setServerId(id) {
      window.__saviaNotionServerId = id || null;
      if (id) localStorage.setItem(KEY_SERVER_ID, id);
      else localStorage.removeItem(KEY_SERVER_ID);
    },
    async listServers() {
      const st = await mcpStatus();
      return (st.servers || []).map((s) => ({ id: s.id, name: s.name, status: s.status }));
    },
    async verify() {
      const r = await callTool('notion_retrieve_bot_user', {});
      return r.data || r.text;
    },
    async queryDatabase(databaseId, filter) {
      const body = { database_id: databaseId, page_size: 50 };
      if (filter) body.filter = filter;
      const r = await callTool('notion_query_database', body);
      return r.data || {};
    },
    async createPage(databaseId, properties, children) {
      const args = { parent: { database_id: databaseId }, properties };
      if (children) args.children = children;
      const r = await callTool('notion_create_page', args);
      return r.data || {};
    },
    async updatePage(pageId, properties) {
      const r = await callTool('notion_update_page', { page_id: pageId, properties });
      return r.data || {};
    },
    async search(query, filter) {
      const args = {};
      if (query) args.query = query;
      if (filter) args.filter = filter;
      const r = await callTool('notion_search', args);
      return r.data || {};
    },
    async appendBlockChildren(blockId, children) {
      const r = await callTool('notion_append_block_children', { block_id: blockId, children });
      return r.data || {};
    },
    callTool
  };

  window.SaviaNotionMCP = api;
})();
