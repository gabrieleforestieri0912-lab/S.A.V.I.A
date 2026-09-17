/**
 * S.A.V.I.A — MCP SERVERS
 * Gestisce le connessioni a server Model Context Protocol (MCP),
 * espone i tool scoperti a tutto il sistema (agent, voce, UI).
 *
 * Trasporti supportati:
 *   - stdio   : process spawn (command + args)
 *   - sse     : Server-Sent Events (eventStream → SSE endpoint)
 *   - http    : Streamable HTTP (transports "streamable-http")
 *
 * Ogni server è configurato, connesso e i suoi tool raccolti in
 * lista piatta per l'agente cognitivo.
 */
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

let srcCfg = [];          // lista di configurazioni { id, name, transport, ... }
let eventSink = null;     // (type, payload) => void
const clients = new Map(); // id → { cfg, client, transport, status, tools, error }

function emit(type, payload) {
  if (eventSink) { try { eventSink(type, payload); } catch (e) { /* ignore */ } }
}

function nextId() {
  return 'mcp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalize(c) {
  c = c || {};
  return {
    id: String(c.id || nextId()),
    name: String(c.name || 'MCP Server').trim() || 'MCP Server',
    transport: String(c.transport || 'stdio').toLowerCase(),
    command: String(c.command || ''),
    args: Array.isArray(c.args) ? c.args.map(String) : [],
    cwd: String(c.cwd || ''),
    env: (c.env && typeof c.env === 'object') ? c.env : {},
    url: String(c.url || ''),
    headers: (c.headers && typeof c.headers === 'object') ? c.headers : {},
    enabled: c.enabled !== false
  };
}

function setConfig(servers) {
  srcCfg = (Array.isArray(servers) ? servers : []).map(normalize);
  for (const id of [...clients.keys()]) {
    if (!srcCfg.some(s => s.id === id)) {
      stopServer(id); // rimuove i server cancellati dalla config
    }
  }
  return getServers();
}

function setEventSink(fn) {
  eventSink = fn;
}

function serverById(id) {
  return srcCfg.find(s => s.id === String(id)) || null;
}

function getServers() {
  return srcCfg.map(c => {
    const e = clients.get(c.id);
    return { ...c, status: e ? e.status : 'off', error: e ? e.error : '' };
  });
}

function buildTransport(cfg) {
  if (cfg.transport === 'stdio') {
    if (!cfg.command) return { error: 'Command richiesto per il trasporto stdio' };
    return {
      transport: new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        cwd: cfg.cwd || undefined,
        env: { ...process.env, ...cfg.env }
      })
    };
  }
  if (cfg.transport === 'sse') {
    if (!cfg.url) return { error: 'URL richiesto per il trasporto SSE' };
    const headers = cfg.headers && Object.keys(cfg.headers).length ? cfg.headers : undefined;
    return { transport: new SSEClientTransport(new URL(cfg.url), headers ? { requestInit: { headers } } : undefined) };
  }
  if (cfg.transport === 'http') {
    if (!cfg.url) return { error: 'URL richiesto per il trasporto HTTP' };
    const headers = cfg.headers && Object.keys(cfg.headers).length ? cfg.headers : undefined;
    return { transport: new StreamableHTTPClientTransport(new URL(cfg.url), headers ? { requestInit: { headers } } : undefined) };
  }
  return { error: `Trasporto non supportato: ${cfg.transport}` };
}

function setStatus(id, status, error) {
  const e = clients.get(id);
  if (!e) return;
  e.status = status;
  e.error = error || '';
  const cfg = e.cfg;
  emit('status', {
    id: cfg.id, name: cfg.name, transport: cfg.transport,
    status, error: e.error, toolsCount: (e.tools || []).length
  });
}

async function startServer(cfgId) {
  const cfg = normalize(serverById(cfgId));
  const existing = clients.get(cfg.id);
  if (existing && (existing.status === 'on' || existing.status === 'connecting')) {
    return { ok: true, status: existing.status };
  }
  if (!srcCfg.some(s => s.id === cfg.id)) {
    return { ok: false, error: 'Server non trovato nella configurazione' };
  }

  const built = buildTransport(cfg);
  if (built.error) return { ok: false, error: built.error };
  const transport = built.transport;

  const client = new Client({ name: 'savia-mcp', version: '4.0.0' });
  const entry = { cfg, client, transport, status: 'connecting', tools: [], error: '' };
  clients.set(cfg.id, entry);
  setStatus(cfg.id, 'connecting');

  let connected = false;
  transport.onerror = () => {};
  transport.onclose = () => {
    if (connected && clients.get(cfg.id)) {
      const e = clients.get(cfg.id);
      if (e.status === 'on') {
        e.status = 'off';
        e.error = 'connessione chiusa';
        setStatus(cfg.id, 'off', 'connessione chiusa');
      }
    }
  };

  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout connessione MCP (15s)')), 15000);
      client.connect(transport).then(() => { clearTimeout(t); resolve(); }).catch(err => { clearTimeout(t); reject(err); });
    });
  } catch (e) {
    connected = false;
    entry.status = 'error';
    entry.error = e.message || String(e);
    setStatus(cfg.id, 'error', entry.error);
    try { await transport.close(); } catch (x) { /* ignore */ }
    clients.delete(cfg.id);
    return { ok: false, error: entry.error };
  }

  connected = true;
  try {
    const toolsRes = await client.listTools();
    entry.tools = (toolsRes.tools || []).map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {}
    }));
  } catch (e) {
    entry.tools = [];
    entry.error = 'tools discovery fallito: ' + (e.message || String(e));
  }

  entry.status = 'on';
  clients.set(cfg.id, entry);
  setStatus(cfg.id, 'on');
  emit('tools', {
    id: cfg.id, name: cfg.name,
    tools: entry.tools.map(t => ({ name: t.name, description: t.description }))
  });
  return { ok: true, status: 'on', toolsCount: entry.tools.length };
}

async function stopServer(cfgId) {
  const id = String(cfgId);
  const entry = clients.get(id);
  if (!entry) return { ok: true, status: 'off' };
  try { await entry.client.close(); } catch (e) { /* ignore */ }
  try { if (entry.transport && typeof entry.transport.close === 'function') await entry.transport.close(); } catch (e) { /* ignore */ }
  clients.delete(id);
  const cfg = entry.cfg;
  emit('status', { id: cfg.id, name: cfg.name, transport: cfg.transport, status: 'off', error: '', toolsCount: 0 });
  return { ok: true, status: 'off' };
}

async function startAll() {
  const results = [];
  for (const s of srcCfg) {
    if (!s.enabled) continue;
    const e = clients.get(s.id);
    if (e && (e.status === 'on' || e.status === 'connecting')) continue;
    results.push(await startServer(s.id));
  }
  return results;
}

function stopAll() {
  return Promise.all([...clients.keys()].map(id => stopServer(id)));
}

function listTools() {
  const out = [];
  for (const [, entry] of clients) {
    if (entry.status !== 'on') continue;
    for (const t of entry.tools) {
      out.push({
        serverId: entry.cfg.id,
        serverName: entry.cfg.name,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      });
    }
  }
  return out;
}

function resultToText(res) {
  if (!res) return '';
  const content = Array.isArray(res.content) ? res.content : [];
  let text = '';
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'text') text += (text ? '\n' : '') + String(c.text || '');
    else if (c.type === 'image') text += (text ? '\n' : '') + '[IMMAGINE (data:' + String(c.mimeType || 'png').split('/')[1] || 'png' + ')]';
    else if (c.type === 'resource') text += (text ? '\n' : '') + (c.resource ? c.resource.text || JSON.stringify(c.resource) : JSON.stringify(c));
    else text += (text ? '\n' : '') + JSON.stringify(c);
  }
  if (res.isError && text) text = '[MCP ERRORE] ' + text;
  return text || JSON.stringify(res);
}

async function callTool({ serverId, tool, args }) {
  const entry = clients.get(String(serverId || ''));
  if (!entry || entry.status !== 'on') {
    return { ok: false, error: 'Server MCP non connesso' };
  }
  let parsed = args;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed || '{}'); } catch (e) { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  try {
    const res = await entry.client.callTool({ name: String(tool || ''), arguments: parsed });
    return { ok: true, result: resultToText(res) };
  } catch (e) {
    const msg = e.message || String(e);
    setStatus(entry.cfg.id, 'on', msg);
    return { ok: false, error: msg };
  }
}

function upsertServer(input) {
  const c = normalize(input);
  const idx = srcCfg.findIndex(s => s.id === c.id);
  if (idx >= 0) srcCfg[idx] = c;
  else srcCfg.push(c);
  return { ok: true, server: c };
}

async function removeServer(id) {
  await stopServer(id);
  srcCfg = srcCfg.filter(s => s.id !== String(id));
  return { ok: true };
}

module.exports = {
  setConfig,
  setEventSink,
  getServers,
  startServer,
  stopServer,
  startAll,
  stopAll,
  upsertServer,
  removeServer,
  listTools,
  callTool
};