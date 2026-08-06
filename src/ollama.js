/**
 * S.A.V.I.A - Ollama Bridge & Chat Terminal Module
 */

const OLLAMA_HOST = 'http://localhost:11434';
const terminalLogs = document.getElementById('terminal-logs');
const terminalInput = document.getElementById('terminal-input');
const terminalForm = document.getElementById('terminal-input-form');
const typingIndicator = document.getElementById('typing-indicator');
const systemBridgeStatus = document.getElementById('system-bridge-status');

// ── Configurazione runtime (persistita in savia-config.json via IPC) ──
let activeModel = localStorage.getItem('savia-model') || 'mistral';

function getActiveModel() {
  return activeModel || 'mistral';
}

async function loadRuntimeConfig() {
  try {
    if (window.electronAPI && window.electronAPI.configGet) {
      const cfg = await window.electronAPI.configGet();
      if (cfg) {
        if (cfg.elevenLabsKey) ELEVENLABS_API_KEY = cfg.elevenLabsKey;
        if (cfg.activeModel) activeModel = cfg.activeModel;
      }
    }
  } catch (e) { /* ignore */ }
  if (window.electronAPI && window.electronAPI.configSet) {
    try { await window.electronAPI.configSet({ activeModel }); } catch (e) { /* ignore */ }
  }
}

// Popola il selettore modello con i modelli installati su Ollama
async function refreshModelList() {
  const sel = document.getElementById('model-select');
  if (!sel) return;
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) return;
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    if (!models.length) return;
    sel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
    // Risolvi il modello attivo: se quello salvato non è installato, usa il primo disponibile
    if (models.includes(activeModel)) {
      sel.value = activeModel;
    } else {
      activeModel = models[0];
      sel.value = activeModel;
    }
    localStorage.setItem('savia-model', activeModel);
  } catch (e) { /* ignore */ }
}

function applyModelToUI() {
  const sel = document.getElementById('model-select');
  if (sel) sel.value = activeModel;
  const modelInfo = document.getElementById('chat-model-info');
  if (modelInfo) modelInfo.textContent = `INTELLIGENZA: OLLAMA // ${activeModel.toUpperCase()}`;
  const modelStatus = document.getElementById('model-status-text');
  if (modelStatus) modelStatus.textContent = `ACTIVE MODEL // ${activeModel.toUpperCase()}`;
}

if (document.getElementById('model-select')) {
  document.getElementById('model-select').addEventListener('change', function() {
    activeModel = this.value || 'mistral';
    localStorage.setItem('savia-model', activeModel);
    if (window.electronAPI && window.electronAPI.configSet) {
      window.electronAPI.configSet({ activeModel }).catch(() => {});
    }
    applyModelToUI();
    addTickerEvent('ollama', `Modello AI cambiato: ${activeModel}`);
  });
}

let welcomeSent = sessionStorage.getItem('savia-welcome-sent') === 'true';

function getCurrentPage() {
  const p = window.location.pathname.split('/').pop();
  return p || 'index.html';
}

const ACTION_MAP = {
  // ── Navigation ──
  navigate_index:        { el: null, fn: () => { window.location.href = 'index.html'; }, pages: ['particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  navigate_particles:    { el: null, fn: () => { window.location.href = 'particles.html'; }, pages: ['index.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  navigate_terminal:     { el: null, fn: () => { window.location.href = 'terminal.html'; }, pages: ['index.html','particles.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  navigate_knowledge:    { el: null, fn: () => { window.location.href = 'knowledge.html'; }, pages: ['index.html','particles.html','terminal.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  navigate_globe:        { el: null, fn: () => { window.location.href = 'globe.html'; }, pages: ['index.html','particles.html','terminal.html','knowledge.html','objectives.html','imagine.html','calendar.html'] },
  navigate_objectives:   { el: null, fn: () => { window.location.href = 'objectives.html'; }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','youtube.html','imagine.html','calendar.html'] },
  navigate_calendar:     { el: null, fn: () => { window.location.href = 'calendar.html'; }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','youtube.html','objectives.html','imagine.html'] },
  navigate_imagine:      { el: null, fn: () => { window.location.href = 'imagine.html'; }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','youtube.html','objectives.html','calendar.html'] },

  // ── System toggles ──
  toggle_overclock:      { el: 'btn-overclock', fn: null, pages: ['index.html','terminal.html'] },
  toggle_sound:          { el: 'btn-sound', fn: null, pages: ['index.html','terminal.html'] },
  toggle_scanlines:      { el: 'btn-scanlines', fn: null, pages: ['index.html','terminal.html'] },

  // ── Voice controls ──
  toggle_wake:           { el: 'vc-wake-toggle', fn: null, pages: ['index.html'] },
  toggle_continuous:     { el: 'vc-continuous-toggle', fn: null, pages: ['index.html'] },
  toggle_autospeak:      { el: 'btn-auto-speak', fn: null, pages: ['index.html'] },

  // ── Globe controls ──
  toggle_globe_rotate:   { el: 'btn-globe-rotate', fn: null, pages: ['globe.html'] },
  globe_global_view:     { el: 'btn-view-global', fn: null, pages: ['globe.html'] },
  toggle_globe_gestures: { el: 'btn-globe-gestures', fn: null, pages: ['globe.html'] },
  globe_city_back:       { el: 'btn-city-back', fn: null, pages: ['globe.html'] },

  // ── Particles controls ──
  toggle_particles_rotate:  { el: 'btn-autoRotate', fn: null, pages: ['particles.html'] },
  toggle_particles_gestures: { el: 'btn-gestures', fn: null, pages: ['particles.html'] },
  particles_set_count:   { el: 'particleCount', fn: null, pages: ['particles.html'] },
  particles_set_shape:   { el: 'shapeSelect', fn: null, pages: ['particles.html'] },
  particles_set_size:    { el: 'particleSize', fn: null, pages: ['particles.html'] },

  // ── Terminal controls ──
  terminal_clear:        { el: 'term-clear', fn: null, pages: ['terminal.html'] },
  terminal_kill:         { el: 'term-kill', fn: null, pages: ['terminal.html'] },
  fb_refresh:            { el: 'fb-refresh', fn: null, pages: ['terminal.html'] },
  fb_back:               { el: 'fb-back', fn: null, pages: ['terminal.html'] },
  fb_forward:            { el: 'fb-forward', fn: null, pages: ['terminal.html'] },
  fb_up:                 { el: 'fb-up', fn: null, pages: ['terminal.html'] },

  // ── Knowledge base ──
  kb_index:              { el: 'kb-index-btn', fn: null, pages: ['knowledge.html'] },

  // ── Memory ──
  memory_scan_projects:  { el: 'mem-scan-btn', fn: null, pages: ['index.html'] },

  // ── YouTube ──
  navigate_youtube:      { el: null, fn: () => { window.location.href = 'youtube.html'; }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  yt_search:             { el: null, fn: () => {
    const input = document.getElementById('yt-search-input');
    const btn = document.getElementById('yt-search-btn');
    if (input && btn) { input.focus(); }
  }, pages: ['youtube.html'] },

  // ── Logs ──
  open_logs:             { el: 'system-logs-ticker', fn: null, pages: ['index.html','particles.html','terminal.html','globe.html','knowledge.html','youtube.html','objectives.html'] },
};

function executeAction(actionId) {
  const action = ACTION_MAP[actionId];
  if (!action) { addTickerEvent('warn', `Unknown action: ${actionId}`); return false; }

  const current = getCurrentPage();
  if (!action.pages.includes(current)) {
    addTickerEvent('warn', `Action "${actionId}" not available in ${current}`);
    return false;
  }

  if (action.fn) {
    action.fn();
    addTickerEvent('agent', `Action executed: ${actionId}`);
    return true;
  }

  const el = document.getElementById(action.el);
  if (!el) { addTickerEvent('warn', `Element "${action.el}" not found for ${actionId}`); return false; }

  if (el.tagName === 'SELECT') {
    el.dispatchEvent(new Event('change'));
  } else {
    el.click();
  }
  addTickerEvent('agent', `Action executed: ${actionId}`);
  return true;
}

const ACTION_KEYWORDS = {
  // Navigation
  'vai alla dashboard': 'navigate_index',
  'vai alla home': 'navigate_index',
  'torna alla home': 'navigate_index',
  'apri la home': 'navigate_index',
  'vai alle particelle': 'navigate_particles',
  'apri le particelle': 'navigate_particles',
  'mostra le particelle': 'navigate_particles',
  'vai al terminale': 'navigate_terminal',
  'apri il terminale': 'navigate_terminal',
  'vai al command center': 'navigate_terminal',
  'vai alla knowledge base': 'navigate_knowledge',
  'apri la knowledge base': 'navigate_knowledge',
  'vai al globo': 'navigate_globe',
  'apri il globo': 'navigate_globe',
  'vai al global timeline': 'navigate_globe',
  'vai agli obiettivi': 'navigate_objectives',
  'apri obiettivi': 'navigate_objectives',
  'vai a objectives hub': 'navigate_objectives',
  'vai agli objectives': 'navigate_objectives',
  'vai al calendario': 'navigate_calendar',
  'apri calendario': 'navigate_calendar',
  'vai a calendar': 'navigate_calendar',
  'vai a imagine': 'navigate_imagine',
  'vai alla generazione immagini': 'navigate_imagine',
  'apri imagine': 'navigate_imagine',
  'genera immagine': 'navigate_imagine',

  // System toggles
  'attiva overclock': 'toggle_overclock',
  'disattiva overclock': 'toggle_overclock',
  'overclock': 'toggle_overclock',
  'attiva suoni': 'toggle_sound',
  'disattiva suoni': 'toggle_sound',
  'attiva effetti sonori': 'toggle_sound',
  'disattiva effetti sonori': 'toggle_sound',
  'attiva scanlines': 'toggle_scanlines',
  'disattiva scanlines': 'toggle_scanlines',

  // Voice
  'attiva wake word': 'toggle_wake',
  'disattiva wake word': 'toggle_wake',
  'attiva comando vocale': 'toggle_wake',
  'disattiva comando vocale': 'toggle_wake',
  'attiva conversazione continua': 'toggle_continuous',
  'disattiva conversazione continua': 'toggle_continuous',
  'attiva auto speak': 'toggle_autospeak',
  'disattiva auto speak': 'toggle_autospeak',

  // Globe
  'attiva rotazione globo': 'toggle_globe_rotate',
  'disattiva rotazione globo': 'toggle_globe_rotate',
  'vista globale': 'globe_global_view',
  'mostra vista globale': 'globe_global_view',
  'attiva gesti globo': 'toggle_globe_gestures',
  'disattiva gesti globo': 'toggle_globe_gestures',

  // Particles
  'attiva rotazione particelle': 'toggle_particles_rotate',
  'disattiva rotazione particelle': 'toggle_particles_rotate',
  'attiva gesti particelle': 'toggle_particles_gestures',
  'disattiva gesti particelle': 'toggle_particles_gestures',

  // Terminal
  'pulisci terminale': 'terminal_clear',
  'cancella terminale': 'terminal_clear',
  'termina processo': 'terminal_kill',
  'kill': 'terminal_kill',
  'aggiorna file': 'fb_refresh',
  'ricarica file': 'fb_refresh',
  'torna indietro': 'fb_back',
  'vai avanti': 'fb_forward',
  'sali directory': 'fb_up',
  'directory superiore': 'fb_up',

  // Knowledge base
  'indicizza directory': 'kb_index',
  'scansiona directory': 'kb_index',
  'aggiungi documenti': 'kb_index',

  // YouTube
  'vai su youtube': 'navigate_youtube',
  'apri youtube': 'navigate_youtube',
  'vai al controllo youtube': 'navigate_youtube',

  // Memory
  'scansiona progetti': 'memory_scan_projects',

  // Logs
  'apri log': 'open_logs',
  'mostra log': 'open_logs',
  'apri system log': 'open_logs',
};

function detectAndExecuteAction(query) {
  const lower = query.toLowerCase().trim();
  for (const [keyword, actionId] of Object.entries(ACTION_KEYWORDS)) {
    if (lower === keyword || lower.startsWith(keyword + ' ') || lower.startsWith(keyword + '.') || lower.startsWith(keyword + ',')) {
      addTickerEvent('agent', `Command recognized: "${keyword}" → ${actionId}`);
      return executeAction(actionId);
    }
  }
  return false;
}

const ollamaStatusDot = document.getElementById('ollama-status-dot');
const ollamaStatusText = document.getElementById('ollama-status-text');
function formatTimestamp() {
  const now = new Date();
  return `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
}

function appendLogMessage(sender, text, type) {
  const msgEl = document.createElement('div');
  msgEl.className = `log-message ${type}`;

  const stampEl = document.createElement('span');
  stampEl.className = 'log-timestamp';
  stampEl.textContent = formatTimestamp();

  const senderEl = document.createElement('span');
  senderEl.className = 'log-sender';
  senderEl.textContent = `[${sender.toUpperCase()}]:`;

  const textEl = document.createElement('span');
  textEl.className = 'log-text';
  textEl.innerHTML = text;

  msgEl.appendChild(stampEl);
  msgEl.appendChild(senderEl);
  msgEl.appendChild(textEl);

  terminalLogs.appendChild(msgEl);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
  return textEl;
}

let lastBridgeState = null;

async function checkOllamaBridge() {
  const startTime = Date.now();
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { method: 'GET' });
    if (res.ok) {
      const duration = Date.now() - startTime;
      const wasOffline = !ollamaOnline;
      ollamaOnline = true;
      if (wasOffline && lastBridgeState === false && typeof sendNotification === 'function') {
        sendNotification('Cognitive bridge ONLINE. AI Agents ready.', 'success', 3000);
      }
      systemBridgeStatus.textContent = 'COGNITIVE BRIDGE // ONLINE';
      systemBridgeStatus.style.color = 'var(--accent-cyan)';
      systemBridgeStatus.style.textShadow = '0 0 10px var(--accent-cyan-glow)';

      if (ollamaStatusDot) ollamaStatusDot.className = 'item-status online';
      if (ollamaStatusText) ollamaStatusText.textContent = 'status: active';

      if (svcCognitive) {
        setServiceStatus(svcCognitive, 'online');
        const desc = svcCognitive.querySelector('.item-desc');
        if (desc) { desc.textContent = `Mistral Active // ${duration}ms`; desc.style.color = 'var(--accent-cyan)'; }
      }

      fillPing.style.width = `${Math.min(100, Math.max(5, Math.round(duration / 2)))}%`;
      txtPingLoad.textContent = `${duration} ms`;

      const initLog = document.getElementById('initialization-log');
      if (initLog && initLog.textContent.includes('Verifying')) {
        initLog.textContent = `Cognitive bridge established on ${OLLAMA_HOST}. Mistral synaptic pathways locked and operational.`;
        addTickerEvent('ollama', `Mistral model hooked to interface.`);
      }

      if (!welcomeSent) sendWelcomeMessage();

      lastBridgeState = true;

      if (Math.random() > 0.8) {
        addTickerEvent('ollama', `Bridge ping verified. Latency: ${duration} ms.`);
      }
    } else {
      throw new Error('Bridge responded with bad status');
    }
  } catch (error) {
    ollamaOnline = false;
    if (lastBridgeState !== false) {
      if (typeof sendNotification === 'function') sendNotification('Cognitive bridge OFFLINE. Ollama unreachable.', 'error', 8000);
    }
    systemBridgeStatus.textContent = 'COGNITIVE BRIDGE // UNSTABLE';
    systemBridgeStatus.style.color = 'var(--accent-red)';
    systemBridgeStatus.style.textShadow = '0 0 10px var(--accent-red-glow)';

    if (ollamaStatusDot) ollamaStatusDot.className = 'item-status offline';
    if (ollamaStatusText) ollamaStatusText.textContent = 'status: disconnected';

    if (svcCognitive) {
      setServiceStatus(svcCognitive, 'offline');
      const desc = svcCognitive.querySelector('.item-desc');
      if (desc) { desc.textContent = 'Mistral OFFLINE'; desc.style.color = 'var(--accent-red)'; }
    }

    fillPing.style.width = '0%';
    txtPingLoad.textContent = 'OFFLINE';

    lastBridgeState = false;

    const initLog = document.getElementById('initialization-log');
    if (initLog && initLog.textContent.includes('Verifying')) {
      initLog.innerHTML = `Cognitive bridge <span style="color: var(--accent-red); font-weight: bold;">OFFLINE</span>. Ollama unreachable on ${OLLAMA_HOST}. AI commands will use local simulators.`;
      addTickerEvent('warn', `Cognitive bridge connection failed on ${OLLAMA_HOST}.`);
    }
  }
}

// Reduced from 1000ms: Ollama is already running after facial login, no need to wait long
setTimeout(checkOllamaBridge, 200);
setInterval(checkOllamaBridge, 8000);

// Carica config persistita + popola il selettore modelli all'avvio
loadRuntimeConfig().then(() => {
  refreshModelList();
  applyModelToUI();
});

async function sendWelcomeMessage() {
  welcomeSent = true; sessionStorage.setItem('savia-welcome-sent', 'true');

  // Wait for memory to be loaded if the promise exists
  if (window.memoryLoadedPromise) {
    await window.memoryLoadedPromise;
  }

  const systemContent = getAgentPrompt();
  const history = buildConversationHistory();
  
  const welcomePrompt = (history.length > 0 
    ? 'Your optical and neural systems have just reactivated. Generate a short welcome back greeting for your creator. You perfectly remember our previous conversations (present in long-term memory above). Be informal, compliant, and in a cyberpunk style, avoiding mechanical summaries.'
    : 'Your optical and neural systems have just activated for the first time. Generate a welcome greeting for your creator. Be cyberpunk but natural.') + '\n\nGreet the user according to the time of day in the style of JARVIS from Iron Man (e.g. "Good morning sir" in the morning, "Good evening sir" in the evening). Reply to the user in the language they used.';

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getActiveModel(),
        messages: [
          { role: 'system', content: systemContent },
          ...history,
          { role: 'user', content: welcomePrompt }
        ],
        stream: true
      })
    });

    if (!response.ok) return;

    const streamTextRef = appendLogMessage('savia', '', 'ai');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const jsonChunk = JSON.parse(line);
          if (jsonChunk.message && jsonChunk.message.content) {
            streamTextRef.textContent += jsonChunk.message.content;
            terminalLogs.scrollTop = terminalLogs.scrollHeight;
          }
        } catch (jsonErr) {}
      }
    }

    if (buffer.trim()) {
      try {
        const jsonChunk = JSON.parse(buffer);
        if (jsonChunk.message && jsonChunk.message.content) {
          streamTextRef.textContent += jsonChunk.message.content;
        }
      } catch(e) {}
    }

    const fullResponse = streamTextRef.textContent.trim();
    if (!fullResponse) return;

    let cleanedText = fullResponse.replace(/\[TOOL\].*/gi, '').replace(/<\|.*?\|>/g, '').trim();
    cleanedText = cleanedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    streamTextRef.innerHTML = cleanedText;

    if (autoSpeak) speakText(streamTextRef.textContent);
    playAudio(audioClick);
    addTickerEvent('agent', `S.A.V.I.A online. Welcome generated.`);
    document.dispatchEvent(new CustomEvent('savia-response-complete', {
      detail: { query: '', response: streamTextRef.textContent }
    }));
  } catch (e) {
    welcomeSent = false; sessionStorage.setItem('savia-welcome-sent', 'false');
  }
}

// Build conversation history for AI context window
function buildConversationHistory(maxPairs = 4) {
  try {
    const data = typeof memoryData !== 'undefined' ? memoryData : null;
    if (!data || !data.conversations || !data.conversations.length) return [];
    
    // Get the most recent maxPairs conversations and reverse them to make them chronological (oldest first)
    const recentConvs = data.conversations.slice(0, maxPairs).reverse();
    
    const history = [];
    for (const conv of recentConvs) {
      if (!conv.messages || !conv.messages.length) continue;
      for (const msg of conv.messages) {
        const role = msg.sender === 'savia' ? 'assistant' : 'user';
        history.push({ role, content: msg.text.substring(0, 1000) });
      }
    }
    return history.slice(-20); // last 20 messages max
  } catch { return []; }
}

terminalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = terminalInput.value.trim();
  if (!query) return;

  playAudio(audioClick);

  appendLogMessage('user', query, 'user');
  terminalInput.value = '';

  // Fast path: if query is an action command, execute and skip AI
  if (detectAndExecuteAction(query)) return;

  typingIndicator.classList.remove('hidden');
  terminalLogs.scrollTop = terminalLogs.scrollHeight;

  if (ollamaOnline) {
    try {
      // Route to specialist agent
      const agentId = await routeQuery(query);
      const agent = AGENTS[agentId];
      const agentLabel = agent ? agent.name : 'AUTO';

      // Update agent indicator in chat
      const modelInfo = document.getElementById('chat-model-info');
      if (modelInfo) {
        modelInfo.textContent = `AGENT: ${agentLabel} // ${getActiveModel().toUpperCase()}`;
        modelInfo.style.color = agent ? agent.color : 'var(--accent-cyan)';
      }

      // Update agent selector UI
      const sel = document.getElementById('agent-select');
      if (sel) sel.value = 'auto';

      addTickerEvent(`agent`, `Routed to ${agentLabel} agent`);

      const systemContent = getAgentPrompt();
      const history = buildConversationHistory();

      const messages = [
        { role: 'system', content: systemContent },
        ...history,
        { role: 'user', content: query + '\n\nReply to the user in the language they used in their query.' }
      ];

      const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: getActiveModel(),
          messages,
          stream: true
        })
      });

      if (!response.ok) throw new Error('Model streaming connection failure');

      typingIndicator.classList.add('hidden');

      const streamTextRef = appendLogMessage('savia', '', 'ai');
      const agentBadge = document.createElement('span');
      agentBadge.className = 'agent-badge';
      agentBadge.textContent = agentLabel;
      agentBadge.style.color = agent ? agent.color : 'var(--accent-cyan)';
      streamTextRef.parentNode.insertBefore(agentBadge, streamTextRef);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const jsonChunk = JSON.parse(line);
            if (jsonChunk.message && jsonChunk.message.content) {
              streamTextRef.textContent += jsonChunk.message.content;
              terminalLogs.scrollTop = terminalLogs.scrollHeight;
            }
          } catch (jsonErr) {
            console.error('Buffer parse breakdown:', jsonErr);
          }
        }
      }

      if (buffer.trim()) {
        try {
          const jsonChunk = JSON.parse(buffer);
          if (jsonChunk.message && jsonChunk.message.content) {
            streamTextRef.textContent += jsonChunk.message.content;
          }
        } catch(e) {}
      }

      let fullResponse = streamTextRef.textContent.trim();

      // Execute agent tools found in response
      const toolResult = await executeAgentTool(fullResponse);
      if (toolResult) {
        appendLogMessage('tool', `[TOOL RESULT] ${toolResult.substring(0, 500)}`, 'tool');
        addTickerEvent('agent', `Tool executed: ${toolResult.substring(0, 60)}...`);
      }

      // Execute [ACTION:...] tags from AI response
      const actionMatches = fullResponse.matchAll(/\[ACTION:(\w+)\]/gi);
      for (const match of actionMatches) {
        executeAction(match[1]);
      }

      // Clean [TOOL], [ACTION] directives and Llama3 tokens from displayed response
      let cleanedText = fullResponse.replace(/\[TOOL\].*/gi, '').replace(/\[ACTION:\w+\]/gi, '').replace(/<\|.*?\|>/g, '').trim();
      cleanedText = cleanedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      streamTextRef.innerHTML = cleanedText;
      fullResponse = streamTextRef.textContent;

      if (autoSpeak && fullResponse) {
        speakText(fullResponse);
      }

      if (typeof logConversation === 'function' && query && fullResponse) {
        logConversation(query, fullResponse);
      }

      playAudio(audioClick);
      addTickerEvent("agent", `${agentLabel} response complete.`);
      document.dispatchEvent(new CustomEvent('savia-response-complete', {
        detail: { query, response: fullResponse }
      }));

    } catch (streamError) {
      typingIndicator.classList.add('hidden');
      playAudio(audioBeep);
      appendLogMessage('sys_err', `COGNITIVE STREAM INTERRUPTED: Connection error during active synthesis. Details: ${streamError.message}`, 'error');
    }
  } else {
    setTimeout(() => {
      typingIndicator.classList.add('hidden');
      playAudio(audioBeep);

      appendLogMessage('sys_err',
        `COGNITIVE BRIDGE UNREACHABLE.<br><br>` +
        `Connection to Ollama on <span style="color:var(--accent-cyan); font-weight:bold;">${OLLAMA_HOST}</span> failed.<br>` +
        `Please verify that the Ollama service is active and the model is pulled.<br><br>` +
        `Initialize the cognitive core by executing the following in your shell:<br>` +
        `<span class="ollama-command-hint">ollama run llama3</span>`,
        'error'
      );

      addTickerEvent("[AI] Telemetry fallback activated due to offline gateway.");
    }, 1500);
  }
});

// ============================================================
// VOICE OUTPUT (ElevenLabs + Web Speech API fallback)
// ============================================================
var ELEVENLABS_API_KEY = ''; // caricata da savia-config.json via IPC
var elevenLabsVoiceId = localStorage.getItem('elevenlabs-voice-id') || '';
var elevenLabsVoices = [];
var useElevenLabs = localStorage.getItem('use-elevenlabs') !== 'false';

let autoSpeak = localStorage.getItem('auto-speak') !== 'false';
let synth = window.speechSynthesis;
let autoSpeakBtn = document.getElementById('btn-auto-speak');
let elevenLabsBtn = document.getElementById('btn-elevenlabs');
let wsVoice = null; // auto-selected Italian voice for Web Speech fallback

function selectItalianVoice() {
  if (!synth) return;
  var v = synth.getVoices();
  wsVoice = v.find(function(v) { return v.lang.startsWith('it'); }) || v[0] || null;
}

if (synth) {
  selectItalianVoice();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = selectItalianVoice;
  }
}

function updateElevenLabsUI() {
  if (!elevenLabsBtn) elevenLabsBtn = document.getElementById('btn-elevenlabs');
  if (elevenLabsBtn) {
    elevenLabsBtn.classList.toggle('active', useElevenLabs);
    var ind = elevenLabsBtn.querySelector('.indicator');
    if (ind) {
      ind.style.background = useElevenLabs ? '#00ff88' : '#555';
      ind.style.boxShadow = useElevenLabs ? '0 0 6px #00ff88' : 'none';
    }
  }
}

if (elevenLabsBtn) {
  updateElevenLabsUI();
  elevenLabsBtn.addEventListener('click', function() {
    useElevenLabs = !useElevenLabs;
    localStorage.setItem('use-elevenlabs', String(useElevenLabs));
    updateElevenLabsUI();
    if (useElevenLabs && elevenLabsVoices.length === 0) fetchElevenLabsVoices();
    playAudio(audioClick);
    addTickerEvent('tts', 'ElevenLabs ' + (useElevenLabs ? 'ACTIVE' : 'INACTIVE'));
  });
}

async function fetchElevenLabsVoices() {
  try {
    var res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (!res.ok) {
      var errText = '';
      try { var e = await res.json(); errText = JSON.stringify(e.detail || e); } catch(_) { try { errText = await res.text(); } catch(_) {} }
      addTickerEvent('warn', 'ElevenLabs voices: HTTP ' + res.status + ' — ' + errText);
      return;
    }
    var data = await res.json();
    elevenLabsVoices = data.voices || [];

    var itVoice = null;
    for (var v of elevenLabsVoices) {
      if (!itVoice && v.labels && v.labels.language && v.labels.language.startsWith('it')) itVoice = v;
      if (!itVoice && v.name && /it|italian|italia/i.test(v.name)) itVoice = v;
    }

    var savedId = localStorage.getItem('elevenlabs-voice-id');
    if (savedId && elevenLabsVoices.some(function(v) { return v.voice_id === savedId; })) {
      elevenLabsVoiceId = savedId;
    } else if (itVoice) {
      elevenLabsVoiceId = itVoice.voice_id;
    } else if (elevenLabsVoices.length > 0) {
      elevenLabsVoiceId = elevenLabsVoices[0].voice_id;
    }
    localStorage.setItem('elevenlabs-voice-id', elevenLabsVoiceId);
    addTickerEvent('tts', 'ElevenLabs: ' + elevenLabsVoices.length + ' voices available');
  } catch (e) {
    addTickerEvent('warn', 'ElevenLabs voices error: ' + e.message);
  }
}    if (useElevenLabs && ELEVENLABS_API_KEY) {
      fetchElevenLabsVoices();
    }

function updateAutoSpeakUI() {
  if (!autoSpeakBtn) autoSpeakBtn = document.getElementById('btn-auto-speak');
  if (autoSpeakBtn) {
    autoSpeakBtn.classList.toggle('active', autoSpeak);
    var ind = autoSpeakBtn.querySelector('.indicator');
    if (ind) {
      ind.style.background = autoSpeak ? '#00ff88' : '#555';
      ind.style.boxShadow = autoSpeak ? '0 0 6px #00ff88' : 'none';
    }
  }
}

if (autoSpeakBtn) {
  updateAutoSpeakUI();
  autoSpeakBtn.addEventListener('click', function() {
    autoSpeak = !autoSpeak;
    localStorage.setItem('auto-speak', String(autoSpeak));
    updateAutoSpeakUI();
    playAudio(audioClick);
  });
}

async function elevenLabsSpeak(text) {
  var cleanText = text.replace(/<[^>]*>/g, '').trim();
  if (!cleanText) return false;

  if (!elevenLabsVoiceId) {
    if (elevenLabsVoices.length === 0) await fetchElevenLabsVoices();
    if (!elevenLabsVoiceId && elevenLabsVoices.length > 0) {
      elevenLabsVoiceId = elevenLabsVoices[0].voice_id;
      localStorage.setItem('elevenlabs-voice-id', elevenLabsVoiceId);
    }
    if (!elevenLabsVoiceId) return false;
  }

  try {
    var res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + elevenLabsVoiceId, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3
        }
      })
    });

    if (!res.ok) {
      var errText = '';
      try { var e = await res.json(); errText = JSON.stringify(e.detail || e); } catch(_) { try { errText = await res.text(); } catch(_) {} }
      addTickerEvent('warn', 'ElevenLabs TTS: HTTP ' + res.status + ' — ' + errText + ' (fallback Web Speech)');
      return false;
    }

    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var audio = new Audio(url);

    return new Promise(function(resolve) {
      audio.onended = function() {
        URL.revokeObjectURL(url);
        resolve(true);
      };
      audio.onerror = function() {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      audio.play().catch(function() {
        URL.revokeObjectURL(url);
        resolve(false);
      });
    });
  } catch (e) {
    addTickerEvent('warn', 'ElevenLabs error: ' + e.message);
    return false;
  }
}

// ── Saluto contestuale basato sull'ora (stile JARVIS) ─────────────────
// Chiamato al termine della boot sequence: se il ponte è offline,
// mostra e pronuncia un saluto locale invece di restare muto.
window.__saviaBootGreeting = function () {
  const hour = new Date().getHours();
  let saluto;
  if (hour < 6) saluto = 'Buonanotte, sir. Tutti i sistemi sono in standby, ma sono a disposizione.';
  else if (hour < 12) saluto = 'Buongiorno, sir. Sistemi online e pronti ad assistervi.';
  else if (hour < 18) saluto = 'Buon pomeriggio, sir. Tutti i sistemi operativi.';
  else saluto = 'Buonasera, sir. Arc reactor operativo, in attesa dei vostri ordini.';

  addTickerEvent('sys', 'Saluto contestuale generato.');

  // Il saluto AI (più ricco) verrà generato da sendWelcomeMessage se il bridge è online;
  // qui gestiamo solo il fallback vocale locale per la boot sequence.
  if (!ollamaOnline && autoSpeak && typeof speakText === 'function') {
    speakText(saluto);
  }
  if (!ollamaOnline) {
    appendLogMessage('savia', saluto, 'ai');
  }
};

// ── Salvataggio chiave ElevenLabs da UI ───────────────────────────────
const elevenLabsKeyInput = document.getElementById('elevenlabs-key-input');
const saveKeyBtn = document.getElementById('btn-save-elevenlabs-key');

function applyElevenLabsKeyToUI() {
  if (elevenLabsKeyInput && ELEVENLABS_API_KEY) elevenLabsKeyInput.value = ELEVENLABS_API_KEY;
}

if (saveKeyBtn) {
  saveKeyBtn.addEventListener('click', async () => {
    const key = (elevenLabsKeyInput && elevenLabsKeyInput.value.trim()) || '';
    ELEVENLABS_API_KEY = key;
    if (window.electronAPI && window.electronAPI.configSet) {
      try { await window.electronAPI.configSet({ elevenLabsKey: key }); } catch (e) { /* ignore */ }
    }
    if (key) {
      localStorage.setItem('use-elevenlabs', 'true');
      useElevenLabs = true;
      updateElevenLabsUI();
      fetchElevenLabsVoices();
      addTickerEvent('tts', 'ElevenLabs API key salvata. TTS premium attivo.');
      sendNotification('ElevenLabs key salvata. TTS premium attivo.', 'success', 4000);
    } else {
      addTickerEvent('tts', 'Chiave ElevenLabs rimossa. Verrà usata la sintesi vocale di sistema.');
    }
  });
}

// Popola il campo chiave dalla config già caricata
if (window.electronAPI && window.electronAPI.configGet) {
  window.electronAPI.configGet().then((cfg) => {
    if (cfg && cfg.elevenLabsKey && !elevenLabsKeyInput.value) {
      ELEVENLABS_API_KEY = cfg.elevenLabsKey;
      applyElevenLabsKeyToUI();
      updateElevenLabsUI();
      if (useElevenLabs && elevenLabsVoices.length === 0) fetchElevenLabsVoices();
    }
  }).catch(() => {});
}

async function speakText(text) {
  if (!text) return;
  var cleanText = text.replace(/<[^>]*>/g, '').trim();
  if (!cleanText) return;

  if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = true;
  addTickerEvent('agent', 'Voice synthesis in progress...');

  // Try ElevenLabs first if enabled
  if (useElevenLabs) {
    var ok = await elevenLabsSpeak(cleanText);
    if (ok) {
      if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
      return;
    }
  }

  // Fallback: Web Speech API
  if (!synth) {
    if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
    return;
  }

  try {
    var utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = 'it-IT';
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    if (wsVoice) utter.voice = wsVoice;

    utter.onend = function() {
      if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
    };
    utter.onerror = function() {
      if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
    };

    synth.speak(utter);
  } catch (e) {
    if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
    addTickerEvent('warn', 'Voice synthesis failed: ' + e.message);
  }
}




