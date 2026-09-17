/**
 * S.A.V.I.A — MCP page controller (mcp.html)
 * Gestisce configurazione, connessione e test dei server MCP.
 */
(function () {
  const api = window.electronAPI;
  let editingId = null;

  const $ = (id) => document.getElementById(id);
  const logEl = $('mcpLog');

  function log(level, msg) {
    const div = document.createElement('div');
    div.className = 'ln-' + level;
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function parseJson(text) {
    text = String(text || '').trim();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch (e) { return {}; }
  }

  function escHtml(s) {
    return String(s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function statusDot(status) {
    let cls = 'hl-off';
    if (status === 'on') cls = 'hl-on';
    else if (status === 'connecting') cls = 'hl-connecting';
    else if (status === 'error') cls = 'hl-off';
    else cls = 'hl-stby';
    return '<span class="hl-status-dot ' + cls + '"></span>';
  }

  async function mcpStatus() {
    if (!api || !api.mcpStatus) return { servers: [], tools: [] };
    try { return await api.mcpStatus(); } catch (e) { return { servers: [], tools: [] }; }
  }

  async function refresh() {
    const st = await mcpStatus();
    renderServers(st.servers || []);
    renderTools(st.tools || []);
  }

  function renderServers(servers) {
    $('srvCount').textContent = servers.length ? '(' + servers.length + ')' : '';
    const el = $('srvList');
    if (!servers.length) {
      el.innerHTML = '<div class="ln-sys">Nessun server configurato.</div>';
      return;
    }
    el.innerHTML = servers.map(s => {
      const on = s.status === 'on';
      const cls = on ? 'px-srv on' : (s.status === 'error' ? 'px-srv err' : 'px-srv');
      const meta = s.transport === 'stdio'
        ? (s.command + (s.args && s.args.length ? ' ' + s.args.join(' ') : ''))
        : s.url;
      return '<div class="' + cls + '">' +
        '<div class="px-shead"><span class="px-sname">' + escHtml(s.name) + '</span>' +
        '<span class="px-strans">' + escHtml(s.transport.toUpperCase()) + '</span></div>' +
        '<div class="px-smeta">' + escHtml(s.id) + '</div>' +
        '<div class="px-smeta">' + escHtml(meta) + '</div>' +
        '<div class="px-status-row"><span>' + statusDot(s.status) + (s.status === 'error' ? 'ERRORE' : s.status.toUpperCase()) + '</span>' +
        '<span class="px-val">' + (s.status === 'on' ? 'TOOL: ' + s.toolsCount + '' : escHtml(s.error || '')) + '</span></div>' +
        '<div class="px-scontrols">' +
        (on
          ? '<button class="px-mini-btn danger" onclick="saviaMcp.stop(\'' + escHtml(s.id) + '\')"><i class="fas fa-stop"></i> STOP</button>'
          : '<button class="px-mini-btn green" onclick="saviaMcp.start(\'' + escHtml(s.id) + '\')"><i class="fas fa-play"></i> CONNETTI</button>') +
        '<button class="px-mini-btn" onclick="saviaMcp.edit(\'' + escHtml(s.id) + '\')"><i class="fas fa-pen"></i> MODIFICA</button>' +
        '<button class="px-mini-btn danger" onclick="saviaMcp.remove(\'' + escHtml(s.id) + '\')"><i class="fas fa-trash"></i> RIMUOVI</button>' +
        '</div></div>';
    }).join('');
  }

  function renderTools(tools) {
    $('toolCount').textContent = tools.length ? '(' + tools.length + ')' : '';
    const el = $('toolList');
    if (!tools.length) {
      el.innerHTML = '<div class="ln-sys">Nessun server connesso. Aggiungi e connetti un server MCP per scoprire i suoi tool.</div>';
      return;
    }
    el.innerHTML = tools.map((t, i) => {
      const props = (t.inputSchema && t.inputSchema.properties) ? Object.keys(t.inputSchema.properties) : [];
      const hint = props.length ? ('{ ' + props.map(p => '"' + p + '":…').join(', ') + ' }') : '{}';
      return '<div class="px-tool">' +
        '<div class="px-thead"><span class="px-tname">' + escHtml(t.name) + '</span>' +
        '<span class="px-tserver">' + escHtml(t.serverName) + '(' + escHtml(t.serverId) + ')</span></div>' +
        (t.description ? '<div class="px-tdesc">' + escHtml(t.description) + '</div>' : '') +
        '<div class="px-run"><textarea id="runArgs-' + i + '" data-idx="' + i + '" placeholder="' + escHtml(hint) + '"></textarea>' +
        '<button class="px-mini-btn green" data-idx="' + i + '" onclick="saviaMcp.call(this,' + i + ')"><i class="fas fa-play"></i> CALL</button></div>' +
        '<div class="px-out" id="runOut-' + i + '" style="display:none;"></div>' +
        '</div>';
    }).join('');
  }

  async function start(id) {
    if (!api || !api.mcpStart) return;
    const r = await api.mcpStart(id);
    if (r && r.ok) { log('ok', 'Connesso: ' + id + ' — tool: ' + (r.tools ? r.tools.length : 0)); }
    else log('error', 'Start fallito ' + id + ': ' + (r && r.error));
    refresh();
  }

  async function stop(id) {
    if (!api || !api.mcpStop) return;
    await api.mcpStop(id);
    log('sys', 'Stoppato: ' + id);
    refresh();
  }

  async function remove(id) {
    if (!api || !api.mcpRemove) return;
    if (!confirm('Rimuovere il server MCP ' + id + '?')) return;
    const r = await api.mcpRemove(id);
    if (r && r.ok) { log('sys', 'Rimosso: ' + id); if (editingId === id) cancelEdit(); }
    else log('error', 'Rimozione fallita: ' + (r && r.error));
    refresh();
  }

  function getFormServer() {
    return {
      id: editingId || undefined,
      name: $('inpName').value.trim(),
      transport: $('selTransport').value,
      enabled: $('chkAuto').checked,
      command: $('inpCommand').value.trim(),
      args: $('inpArgs').value.trim().split(/\s+/).filter(Boolean),
      cwd: $('inpCwd').value.trim(),
      env: parseJson($('inpEnv').value),
      url: $('inpUrl').value.trim(),
      headers: parseJson($('inpHeaders').value)
    };
  }

  async function save() {
    if (!api || !api.mcpSave) return;
    const s = getFormServer();
    if (!s.name) { log('warn', 'Inserisci un nome per il server.'); return; }
    if (s.transport === 'stdio' && !s.command) { log('warn', 'Comando richiesto per trasporto stdio.'); return; }
    if (s.transport !== 'stdio' && !s.url) { log('warn', 'URL richiesto per trasporto ' + s.transport + '.'); return; }
    const r = await api.mcpSave(s);
    if (r && r.ok) {
      log('ok', 'Server salvato: ' + r.server.name + ' — ' + (r.start && r.start.status));
      cancelEdit();
      refresh();
    } else {
      log('error', 'Salvataggio fallito: ' + (r && r.error));
    }
  }

  function presetNotion() {
    editingId = null;
    $('inpName').value = 'Notion (ufficiale)';
    $('selTransport').value = 'stdio';
    $('chkAuto').checked = true;
    $('inpCommand').value = 'npx';
    $('inpArgs').value = '-y @notionhq/notion-mcp-server';
    $('inpCwd').value = '';
    $('inpEnv').value = '{ "OPENAPI_MCP_HEADERS": "{\\"Authorization\\": \\"Bearer <IL_TUO_TOKEN_NOTION>\\", \\"Notion-Version\\": \\"2022-06-28\\"}" }';
    $('inpUrl').value = '';
    $('inpHeaders').value = '';
    $('btnCancelEdit').style.display = '';
    $('editingHint').style.display = '';
    toggleFields();
    $('inpName').focus();
    log('sys', 'Preset Notion caricato. Incolla il tuo token Bearer in OPENAPI_MCP_HEADERS, poi SALVA SERVER.');
  }

  async function edit(id) {
    if (!api || !api.mcpStatus) return;
    const st = await mcpStatus();
    const s = (st.servers || []).find(x => x.id === id);
    if (!s) return;
    editingId = id;
    $('inpName').value = s.name;
    $('selTransport').value = s.transport;
    $('chkAuto').checked = !!s.enabled;
    $('inpCommand').value = s.command || '';
    $('inpArgs').value = (s.args || []).join(' ');
    $('inpCwd').value = s.cwd || '';
    $('inpEnv').value = s.env && Object.keys(s.env).length ? JSON.stringify(s.env, null, 2) : '';
    $('inpUrl').value = s.url || '';
    $('inpHeaders').value = s.headers && Object.keys(s.headers).length ? JSON.stringify(s.headers, null, 2) : '';
    $('btnCancelEdit').style.display = '';
    $('editingHint').style.display = '';
    toggleFields();
    $('inpName').focus();
  }

  function cancelEdit() {
    editingId = null;
    $('inpName').value = '';
    $('inpCommand').value = '';
    $('inpArgs').value = '';
    $('inpCwd').value = '';
    $('inpEnv').value = '';
    $('inpUrl').value = '';
    $('inpHeaders').value = '';
    $('chkAuto').checked = true;
    $('selTransport').value = 'stdio';
    $('btnCancelEdit').style.display = 'none';
    $('editingHint').style.display = 'none';
    toggleFields();
  }

  function toggleFields() {
    const t = $('selTransport').value;
    $('fldStdio').style.display = t === 'stdio' ? '' : 'none';
    $('fldNet').style.display = t === 'stdio' ? 'none' : '';
  }

  async function call(btn, idx) {
    if (!api || !api.mcpStatus) return;
    const st = await mcpStatus();
    const tools = st.tools || [];
    if (!tools[idx]) return;
    const t = tools[idx];
    const argsEl = $('runArgs-' + idx);
    const outEl = $('runOut-' + idx);
    outEl.textContent = '...';
    outEl.className = 'px-out';
    outEl.style.display = '';
    btn.disabled = true;
    try {
      const r = await api.mcpCallTool({ serverId: t.serverId, tool: t.name, args: argsEl.value });
      if (r && r.ok) {
        outEl.textContent = r.result || '(vuoto)';
        outEl.className = 'px-out';
      } else {
        outEl.textContent = 'ERRORE: ' + (r && r.error);
        outEl.className = 'px-out err';
        log('error', 'Tool ' + t.name + ': ' + (r && r.error));
      }
    } catch (e) {
      outEl.textContent = 'ERRORE: ' + (e.message || e);
      outEl.className = 'px-out err';
    } finally {
      btn.disabled = false;
    }
  }

  window.saviaMcp = { start, stop, remove, edit, call };

  function bind() {
    $('btnSave').addEventListener('click', save);
    $('btnCancelEdit').addEventListener('click', cancelEdit);
    $('btnPresetNotion').addEventListener('click', presetNotion);
    $('selTransport').addEventListener('change', toggleFields);
    if (api && api.onMcpEvent) api.onMcpEvent(() => refresh());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
  refresh();
})();