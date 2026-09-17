/**
 * S.A.V.I.A - Cognitive Bridge & Chat Terminal Module
 */

const LOCAL_AI_HOST = 'http://localhost:11434';
const terminalLogs = document.getElementById('terminal-logs');
const terminalInput = document.getElementById('terminal-input');
const terminalForm = document.getElementById('terminal-input-form');

terminalInput.addEventListener('input', () => {
  stopSpeaking();
});
const typingIndicator = document.getElementById('typing-indicator');
const systemBridgeStatus = document.getElementById('system-bridge-status');

// ── Configurazione runtime (persistita in savia-config.json via IPC) ──
function getDefaultModel() {
  if (typeof aiProvider !== 'undefined' && aiProvider === 'openrouter') return 'nvidia/nemotron-3.5-lightning:free';
  if (typeof aiProvider !== 'undefined' && aiProvider === 'opencode') return 'claude-sonnet-4-5';
  return 'mistral';
}

let activeModel = localStorage.getItem('savia-model') || getDefaultModel();

function getActiveModel() {
  return activeModel || getDefaultModel();
}

async function loadRuntimeConfig() {
  try {
    if (window.electronAPI && window.electronAPI.configGet) {
      const cfg = await window.electronAPI.configGet();
      if (cfg) {
        if (cfg.aiProvider) aiProvider = cfg.aiProvider;
        if (cfg.openrouterApiKey) openrouterApiKey = cfg.openrouterApiKey;
        if (cfg.opencodeApiKey) opencodeApiKey = cfg.opencodeApiKey;
        if (cfg.activeModel) activeModel = cfg.activeModel;
      }
    }
  } catch (e) { /* ignore */ }
  if ((typeof aiProvider !== 'undefined' && aiProvider === 'openrouter') && (!activeModel || activeModel === 'mistral' || activeModel === 'claude-sonnet-4-5')) {
    activeModel = 'nvidia/nemotron-3.5-lightning:free';
    localStorage.setItem('savia-model', activeModel);
  }
  if (window.electronAPI && window.electronAPI.configSet) {
    try {
      await window.electronAPI.configSet({
        aiProvider: typeof aiProvider !== 'undefined' ? aiProvider : 'openrouter',
        openrouterApiKey: typeof openrouterApiKey !== 'undefined' ? openrouterApiKey : '',
        opencodeApiKey: typeof opencodeApiKey !== 'undefined' ? opencodeApiKey : '',
        activeModel
      });
    } catch (e) { /* ignore */ }
  }
}

// Popola il selettore modello con i modelli installati su OpenRouter / OpenCode / Local
async function refreshModelList() {
  const sel = document.getElementById('model-select');
  if (!sel) return;
  try {
    let models = [];
    const isOpenRouter = (typeof aiProvider !== 'undefined' && aiProvider === 'openrouter');
    const isOpenCode = (typeof aiProvider !== 'undefined' && aiProvider === 'opencode');

    if (isOpenRouter) {
      const res = await fetch(`${openrouterBaseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${openrouterApiKey}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const all = (data.data || []).map(m => m.id);
      const free = all.filter(m => m.endsWith(':free'));
      const paid = all.filter(m => !m.endsWith(':free'));
      models = [...free, ...paid];
    } else if (isOpenCode) {
      const res = await fetch(`${opencodeBaseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${opencodeApiKey}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      models = (data.data || []).map(m => m.id);
    } else {
      const res = await fetch(`${LOCAL_AI_HOST}/api/tags`);
      if (!res.ok) return;
      const data = await res.json();
      models = (data.models || []).map(m => m.name);
    }
    if (!models.length) return;
    sel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
    // Risolvi il modello attivo: se quello salvato non è installato, usa il preferito o il primo
    if (models.includes(activeModel)) {
      sel.value = activeModel;
    } else {
      activeModel = isOpenRouter
        ? (models.includes('nvidia/nemotron-3.5-lightning:free') ? 'nvidia/nemotron-3.5-lightning:free' : models[0])
        : ((isOpenCode && models.includes('claude-sonnet-4-5')) ? 'claude-sonnet-4-5' : models[0]);
      sel.value = activeModel;
    }
    localStorage.setItem('savia-model', activeModel);
  } catch (e) { /* ignore */ }
}

function applyModelToUI() {
  const sel = document.getElementById('model-select');
  if (sel) sel.value = activeModel;
  const modelInfo = document.getElementById('chat-model-info');
  const providerLabel = (typeof aiProvider !== 'undefined' && aiProvider === 'openrouter')
    ? 'OPENROUTER'
    : ((typeof aiProvider !== 'undefined' && aiProvider === 'opencode') ? 'OPENCODE' : 'LOCAL');
  if (modelInfo) modelInfo.textContent = `INTELLIGENZA: ${providerLabel} // ${activeModel.toUpperCase()}`;
  const modelStatus = document.getElementById('model-status-text');
  if (modelStatus) modelStatus.textContent = `ACTIVE MODEL // ${activeModel.toUpperCase()}`;
}

if (document.getElementById('model-select')) {
  document.getElementById('model-select').addEventListener('change', function() {
    activeModel = this.value || getDefaultModel();
    localStorage.setItem('savia-model', activeModel);
    if (window.electronAPI && window.electronAPI.configSet) {
      window.electronAPI.configSet({ activeModel }).catch(() => {});
    }
    applyModelToUI();
    const providerLabel = (typeof aiProvider !== 'undefined' && aiProvider === 'openrouter')
      ? 'OpenRouter'
      : ((typeof aiProvider !== 'undefined' && aiProvider === 'opencode') ? 'OpenCode' : 'Local');
    addTickerEvent('agent', `Modello AI cambiato (${providerLabel}): ${activeModel}`);
  });
}

let welcomeSent = sessionStorage.getItem('savia-welcome-sent') === 'true';
// Flag condivisi per evitare doppio saluto vocale tra benvenuto AI e saluto locale
window.__saviaWelcomeFirstSentence = false; // true quando il primo token del benvenuto AI è arrivato
window.__saviaLocalGreetingSpoken = false;  // true quando il saluto locale è stato pronunciato

const aiStatusDot = document.getElementById('ai-status-dot');
const aiStatusText = document.getElementById('ai-status-text');
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

async function checkAiBridge() {
  const startTime = Date.now();
  const isOpenRouter = (typeof aiProvider !== 'undefined' && aiProvider === 'openrouter');
  const isOpenCode = (typeof aiProvider !== 'undefined' && aiProvider === 'opencode');
  const endpointDesc = isOpenRouter ? 'OpenRouter (openrouter.ai)' : (isOpenCode ? 'OpenCode Zen (opencode.ai)' : LOCAL_AI_HOST);
  const providerName = isOpenRouter ? 'OpenRouter' : (isOpenCode ? 'OpenCode' : 'Local');
  try {
    let res;
    if (isOpenRouter) {
      res = await fetch(`${openrouterBaseUrl}/auth/key`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${openrouterApiKey}` }
      });
    } else if (isOpenCode) {
      res = await fetch(`${opencodeBaseUrl}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${opencodeApiKey}` }
      });
    } else {
      res = await fetch(`${LOCAL_AI_HOST}/api/tags`, { method: 'GET' });
    }
    if (res.ok) {
      const duration = Date.now() - startTime;
      const wasOffline = !aiOnline;
      aiOnline = true;
      if (wasOffline && lastBridgeState === false && typeof sendNotification === 'function') {
        sendNotification(`Cognitive bridge ONLINE. Motore AI (${providerName}) pronto.`, 'success', 3000);
      }
      systemBridgeStatus.textContent = `COGNITIVE BRIDGE // ${providerName.toUpperCase()} ONLINE`;
      systemBridgeStatus.style.color = 'var(--accent-cyan)';
      systemBridgeStatus.style.textShadow = '0 0 10px var(--accent-cyan-glow)';

      if (aiStatusDot) aiStatusDot.className = 'item-status online';
      if (aiStatusText) aiStatusText.textContent = `status: ${providerName.toLowerCase()} active`;

      if (svcCognitive) {
        setServiceStatus(svcCognitive, 'online');
        const desc = svcCognitive.querySelector('.item-desc');
        if (desc) { desc.textContent = `${activeModel} Active // ${duration}ms`; desc.style.color = 'var(--accent-cyan)'; }
      }

      fillPing.style.width = `${Math.min(100, Math.max(5, Math.round(duration / 2)))}%`;
      txtPingLoad.textContent = `${duration} ms`;

      const initLog = document.getElementById('initialization-log');
      if (initLog && initLog.textContent.includes('Verifying')) {
        initLog.textContent = `Cognitive bridge established on ${endpointDesc}. ${activeModel} synaptic pathways locked and operational.`;
        addTickerEvent('agent', `${activeModel} collegato via ${providerName}.`);
      }

      if (!welcomeSent) sendWelcomeMessage();

      lastBridgeState = true;

      if (Math.random() > 0.8) {
        addTickerEvent('agent', `Bridge ping verified (${providerName}). Latency: ${duration} ms.`);
      }
    } else {
      throw new Error(`Bridge responded with status ${res.status}`);
    }
  } catch (error) {
    aiOnline = false;
    if (lastBridgeState !== false) {
      if (typeof sendNotification === 'function') sendNotification(`Cognitive bridge OFFLINE. ${providerName} non raggiungibile.`, 'error', 8000);
    }
    systemBridgeStatus.textContent = 'COGNITIVE BRIDGE // UNSTABLE';
    systemBridgeStatus.style.color = 'var(--accent-red)';
    systemBridgeStatus.style.textShadow = '0 0 10px var(--accent-red-glow)';

    if (aiStatusDot) aiStatusDot.className = 'item-status offline';
    if (aiStatusText) aiStatusText.textContent = 'status: disconnected';

    if (svcCognitive) {
      setServiceStatus(svcCognitive, 'offline');
      const desc = svcCognitive.querySelector('.item-desc');
      if (desc) { desc.textContent = `${providerName} OFFLINE`; desc.style.color = 'var(--accent-red)'; }
    }

    fillPing.style.width = '0%';
    txtPingLoad.textContent = 'OFFLINE';

    lastBridgeState = false;

    const initLog = document.getElementById('initialization-log');
    if (initLog && initLog.textContent.includes('Verifying')) {
      initLog.innerHTML = `Cognitive bridge <span style="color: var(--accent-red); font-weight: bold;">OFFLINE</span>. ${providerName} non raggiungibile su ${endpointDesc}. I comandi AI useranno i simulatori locali.`;
      addTickerEvent('warn', `Cognitive bridge connection failed on ${endpointDesc}.`);
    }
  }
}

// Reduced from 1000ms: AI bridge is already running after facial login, no need to wait long
setTimeout(checkAiBridge, 200);
setInterval(checkAiBridge, 8000);

// Benvenuto immediato: parte subito all'avvio, senza aspettare il primo ping
// del ponte. Se il bridge è lento o offline, scatta il saluto locale (vedi sotto).
if (!welcomeSent) setTimeout(() => { sendWelcomeMessage(); }, 100);

// Carica config persistita + popola il selettore modelli all'avvio
loadRuntimeConfig().then(() => {
  refreshModelList();
  applyModelToUI();
});

// Funzione unificata per streaming chat (OpenRouter / OpenCode Zen SSE / Local JSON lines)
async function streamAiChatCompletion({ messages, onToken, signal }) {
  const isOpenRouter = (typeof aiProvider !== 'undefined' && aiProvider === 'openrouter');
  const isOpenCode = (typeof aiProvider !== 'undefined' && aiProvider === 'opencode');

  if (isOpenRouter || isOpenCode) {
    const url = isOpenRouter ? `${openrouterBaseUrl}/chat/completions` : `${opencodeBaseUrl}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${isOpenRouter ? openrouterApiKey : opencodeApiKey}`
    };
    if (isOpenRouter) {
      headers['HTTP-Referer'] = 'https://github.com/savia';
      headers['X-Title'] = 'S.A.V.I.A';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: getActiveModel(),
        messages,
        stream: true
      }),
      signal
    });

    if (!response.ok) {
      let errText = '';
      try {
        const errJson = await response.json();
        if (errJson.error && errJson.error.message) {
          errText = errJson.error.message;
        } else if (errJson.message) {
          errText = errJson.message;
        } else {
          errText = JSON.stringify(errJson);
        }
      } catch {
        errText = await response.text();
      }

      if (isOpenCode && response.status === 401 && (errText.includes('payment method') || errText.includes('CreditsError'))) {
        throw new Error(`OpenCode Zen: Nessun metodo di pagamento associato al workspace. Aggiungi crediti o un metodo di pagamento su https://opencode.ai/workspace/wrk_01M1BPS5DBX6H5ZHGR2YPPMCFP/billing`);
      }
      throw new Error(`${isOpenRouter ? 'OpenRouter' : 'OpenCode'} API error (${response.status}): ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    streamActive = true;

    try {
      while (true) {
        await waitIfStandby();
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const jsonChunk = JSON.parse(trimmed.slice(6));
              const delta = jsonChunk.choices?.[0]?.delta?.content;
              if (delta) {
                onToken(delta);
              }
            } catch (jsonErr) {
              console.warn('SSE parse error:', jsonErr);
            }
          }
        }
      }

      if (buffer.trim() && buffer.trim().startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
        try {
          const jsonChunk = JSON.parse(buffer.trim().slice(6));
          const delta = jsonChunk.choices?.[0]?.delta?.content;
          if (delta) onToken(delta);
        } catch (e) {}
      }
    } finally {
      streamActive = false;
    }

  } else {
    // Local AI streaming
    const response = await fetch(`${LOCAL_AI_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getActiveModel(),
        messages,
        stream: true
      }),
      signal
    });

    if (!response.ok) throw new Error('Model streaming connection failure');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    streamActive = true;

    try {
      while (true) {
        await waitIfStandby();
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
              onToken(jsonChunk.message.content);
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
            onToken(jsonChunk.message.content);
          }
        } catch(e) {}
      }
    } finally {
      streamActive = false;
    }
  }
}

async function sendWelcomeMessage() {
  welcomeSent = true; sessionStorage.setItem('savia-welcome-sent', 'true');

  // Attesa memoria con timeout: il benvenuto non deve mai bloccarsi in attesa.
  if (window.memoryLoadedPromise) {
    const memTimeout = new Promise(resolve => setTimeout(resolve, 1500));
    await Promise.race([window.memoryLoadedPromise.catch(() => null), memTimeout]);
  }

  const systemContent = getAgentPrompt();
  const history = buildConversationHistory();
  
  const welcomePrompt = (history.length > 0 
    ? 'Your optical and neural systems have just reactivated. Generate a short welcome back greeting for your creator. You perfectly remember our previous conversations (present in long-term memory above). Be informal, compliant, and in a cyberpunk style, avoiding mechanical summaries.'
    : 'Your optical and neural systems have just activated for the first time. Generate a welcome greeting for your creator. Be cyberpunk but natural.') + '\n\nGreet the user according to the time of day in the style of JARVIS from Iron Man (e.g. "Good morning sir" in the morning, "Good evening sir" in the evening). Reply to the user in the language they used.';

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let firstTokenTimer = null;

  try {
    const streamTextRef = appendLogMessage('savia', '', 'ai');
    let spokenCursor = 0;

    if (controller) {
      firstTokenTimer = setTimeout(() => { try { controller.abort(); } catch (e) {} }, 12000);
    }

    await streamAiChatCompletion({
      messages: [
        { role: 'system', content: systemContent },
        ...history,
        { role: 'user', content: welcomePrompt }
      ],
      signal: controller ? controller.signal : undefined,
      onToken: (token) => {
        streamTextRef.textContent += token;
        terminalLogs.scrollTop = terminalLogs.scrollHeight;
        if (!window.__saviaWelcomeFirstSentence) {
          window.__saviaWelcomeFirstSentence = true;
          if (firstTokenTimer) { clearTimeout(firstTokenTimer); firstTokenTimer = null; }
        }
        if (!window.__saviaLocalGreetingSpoken) {
          spokenCursor = speakStreamedSentences(streamTextRef.textContent, spokenCursor);
        }
      }
    });

    const fullResponse = streamTextRef.textContent.trim();
    if (!fullResponse) return;

    let cleanedText = fullResponse.replace(/\[TOOL\].*/gi, '').replace(/<\|.*?\|>/g, '').trim();
    cleanedText = cleanedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    streamTextRef.innerHTML = cleanedText;

    // Pronuncia l'eventuale coda residua non ancora letta durante lo stream.
    if (!window.__saviaLocalGreetingSpoken) {
      const remaining = streamTextRef.textContent.slice(spokenCursor);
      if (remaining.trim()) queueSpeak(remaining);
    }

    playAudio(audioClick);
    addTickerEvent('agent', `S.A.V.I.A online. Benvenuto generato.`);
    document.dispatchEvent(new CustomEvent('savia-response-complete', {
      detail: { query: '', response: streamTextRef.textContent }
    }));
  } catch (e) {
    welcomeSent = false; sessionStorage.setItem('savia-welcome-sent', 'false');
    streamActive = false;
    // Fallback: saluto locale immediato con voce, così non resta mai muto né bloccato.
    if (typeof window.__saviaBootGreeting === 'function') window.__saviaBootGreeting();
  } finally {
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
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
  const sourcePage = e.detail && e.detail.sourcePage;
  if (!query) return;

  // Fast path STAND BY: interrompe prima di fermare la sintesi corrente,
  // così "pausa"/"ricomincia" agiscono sull'azione in corso.
  if (handleStandbyCommand(query)) {
    appendLogMessage('user', query, 'user');
    terminalInput.value = '';
    playAudio(audioClick);
    document.dispatchEvent(new Event('savia-standby-command'));
    return;
  }

  resetStandby();
  stopSpeaking();

  playAudio(audioClick);

  const isVoice = (e.detail && e.detail.isVoice);
  appendLogMessage('user', isVoice ? `[VOCE] ${query}` : query, 'user');
  terminalInput.value = '';

  // Fast path: if query is an action command, execute and skip AI
  if (detectAndExecuteAction(query, sourcePage)) {
    document.dispatchEvent(new CustomEvent('savia-response-complete', {
      detail: { query, response: null }
    }));
    return;
  }

  typingIndicator.classList.remove('hidden');
  terminalLogs.scrollTop = terminalLogs.scrollHeight;

  if (aiOnline) {
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

      typingIndicator.classList.add('hidden');

      const streamTextRef = appendLogMessage('savia', '', 'ai');
      const agentBadge = document.createElement('span');
      agentBadge.className = 'agent-badge';
      agentBadge.textContent = agentLabel;
      agentBadge.style.color = agent ? agent.color : 'var(--accent-cyan)';
      streamTextRef.parentNode.insertBefore(agentBadge, streamTextRef);

      let spokenCursor = 0;

      await streamAiChatCompletion({
        messages,
        onToken: (token) => {
          streamTextRef.textContent += token;
          terminalLogs.scrollTop = terminalLogs.scrollHeight;
          // La voce parte mentre la risposta è ancora in generazione.
          spokenCursor = speakStreamedSentences(streamTextRef.textContent, spokenCursor);
        }
      });

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
        executeConfigAction(match[1]);
      }

      // Clean [TOOL], [ACTION] directives and Llama3 tokens from displayed response
      let cleanedText = fullResponse.replace(/\[TOOL\].*/gi, '').replace(/\[ACTION:\w+\]/gi, '').replace(/<\|.*?\|>/g, '').trim();
      cleanedText = cleanedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      streamTextRef.innerHTML = cleanedText;
      fullResponse = streamTextRef.textContent;

      if (autoSpeak && fullResponse) {
        // Pronuncia solo la coda residua non ancora letta durante lo stream
        const remaining = streamTextRef.textContent.slice(spokenCursor);
        if (remaining.trim()) queueSpeak(remaining);
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
      streamActive = false;
      playAudio(audioBeep);
      appendLogMessage('sys_err', `COGNITIVE STREAM INTERRUPTED: Connection error during active synthesis. Details: ${streamError.message}`, 'error');
    }
  } else {
    setTimeout(() => {
      typingIndicator.classList.add('hidden');
      playAudio(audioBeep);

      appendLogMessage('sys_err',
        `COGNITIVE BRIDGE UNREACHABLE.<br><br>` +
        `Connection to AI provider on <span style="color:var(--accent-cyan); font-weight:bold;">${LOCAL_AI_HOST}</span> failed.<br>` +
        `Please verify that the AI service is active and the model is available.<br><br>` +
        `Initialize the cognitive core by checking your AI provider configuration.<br>` +
        `<span class="ai-command-hint">Check AI provider settings</span>`,
        'error'
      );

      addTickerEvent("[AI] Telemetry fallback activated due to offline gateway.");
    }, 1500);
  }
});

// ============================================================
// VOICE OUTPUT (ElevenLabs + Web Speech API fallback)
// ============================================================
var ELEVENLABS_API_KEY = localStorage.getItem('elevenlabs-key') || '';
var elevenLabsVoiceId = localStorage.getItem('elevenlabs-voice-id') || '';
var elevenLabsVoices = [];
var useElevenLabs = localStorage.getItem('use-elevenlabs') === 'true'; // false per default se non configurato

let autoSpeak = localStorage.getItem('auto-speak') !== 'false';
let synth = window.speechSynthesis;
let autoSpeakBtn = document.getElementById('btn-auto-speak');
let elevenLabsBtn = document.getElementById('btn-elevenlabs');
let wsVoice = null; // voce selezionata per sintesi locale JARVIS

function selectItalianVoice() {
  if (!synth) return;
  var v = synth.getVoices();
  if (!v || !v.length) return;
  // Priorità: voce naturale italiana profonda e chiara (es. Cosimo / Elsa / Natural / Google)
  wsVoice = v.find(function(item) { return item.lang === 'it-IT' && (/cosimo|natural|google|male/i.test(item.name)); })
    || v.find(function(item) { return item.lang && item.lang.startsWith('it'); })
    || v.find(function(item) { return item.lang && item.lang.startsWith('en'); })
    || v[0] || null;
}

if (synth) {
  selectItalianVoice();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = selectItalianVoice;
  }
}

let ttsAudioEl = null;

// ============================================================
// STAND BY — pausa/ripresa dell'azione in corso (TTS + stream)
// Riprende esattamente da dove era rimasto.
// ============================================================
let standbyActive = false;
let standbyResumeResolve = null;
let streamActive = false;

function waitIfStandby() {
  if (!standbyActive) return Promise.resolve();
  return new Promise(function (resolve) { standbyResumeResolve = resolve; });
}

function isActionRunning() {
  return !!((synth && (synth.speaking || synth.pending)) || ttsAudioEl || streamActive || ttsQueueBusy || ttsQueue.length > 0 || (typeof voiceAudioInProgress !== 'undefined' && voiceAudioInProgress));
}

window.saviaIsSpeaking = isActionRunning;

function updateStandbyUI() {
  const statusText = document.getElementById('agent-status-text');
  if (statusText) {
    statusText.textContent = standbyActive ? 'STAND BY — azione in pausa' : 'AUTO — Waiting for input';
    statusText.style.color = standbyActive ? 'var(--accent-gold)' : '';
  }
  const dot = document.getElementById('agent-dot');
  if (dot) dot.style.background = standbyActive ? 'var(--accent-gold)' : '';
  updateStandbyBtn();
}

let standbyBtn = null;

function updateStandbyBtn() {
  if (!standbyBtn) standbyBtn = document.getElementById('btn-standby');
  if (!standbyBtn) return;
  standbyBtn.classList.toggle('active', standbyActive);
  standbyBtn.innerHTML = standbyActive
    ? '<span class="indicator"></span> RIPRENDI (RICOMINCIA)'
    : '<span class="indicator"></span> STAND BY (PAUSA)';
  const ind = standbyBtn.querySelector('.indicator');
  if (ind) {
    ind.style.background = standbyActive ? 'var(--accent-gold)' : '#555';
    ind.style.boxShadow = standbyActive ? '0 0 6px var(--accent-gold)' : 'none';
  }
}

function standbyPause() {
  if (standbyActive) return { ok: false, reason: 'already' };
  if (!isActionRunning()) return { ok: false, reason: 'none' };
  standbyActive = true;
  updateStandbyUI();
  if (ttsAudioEl) { try { ttsAudioEl.pause(); } catch (e) {} }
  if (synth && synth.speaking) { try { synth.pause(); } catch (e) {} }
  addTickerEvent('sys', 'STAND BY — azione in pausa. Dite "ricomincia" per riprendere esattamente da dove era.');
  if (typeof sendNotification === 'function') sendNotification('S.A.V.I.A in STAND BY. Dite "ricomincia".', 'info', 2500);
  return { ok: true };
}

function standbyResume() {
  if (!standbyActive) return { ok: false, reason: 'not-active' };
  standbyActive = false;
  if (ttsAudioEl) { try { ttsAudioEl.play().catch(function () {}); } catch (e) {} }
  if (synth && synth.paused) { try { synth.resume(); } catch (e) {} }
  if (standbyResumeResolve) {
    const r = standbyResumeResolve;
    standbyResumeResolve = null;
    r();
  }
  updateStandbyUI();
  addTickerEvent('sys', 'RIPRESA — si continua esattamente da dove era rimasto.');
  if (typeof sendNotification === 'function') sendNotification('S.A.V.I.A ripreso.', 'success', 2000);
  return { ok: true };
}

function parseStandbyCommand(query) {
  const lower = query.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const stopKws = ['stop', 'silenzio', 'basta', 'fermati', 'zitto', 'taci', 'interrompi', 'stai zitto', 'chiudi la bocca'];
  for (const k of stopKws) if (lower === k || lower.startsWith(k + ' ')) return 'stop';
  const pauseKws = ['mettiti in pausa', 'mettimi in pausa', 'metti in pausa', 'in pausa', 'mettere in pausa', 'pausa', 'standby', 'stand by', 'attiva standby', 'stai in stand by'];
  const resumeKws = ['ricomincia', 'riprendi', 'riparti', 'riprendiamo', 'togli lo standby', 'togli standby', 'disattiva standby', 'riprendi a parlare', 'continua a parlare', 'riprendi la risposta', 'continua la risposta', 'continua da dove', 'riprendi da dove'];
  for (const k of pauseKws) if (lower === k || lower.startsWith(k + ' ')) return 'pause';
  for (const k of resumeKws) if (lower === k || lower.startsWith(k + ' ')) return 'resume';
  return null;
}

function handleStandbyCommand(query) {
  const cmd = parseStandbyCommand(query);
  if (!cmd) return false;
  if (cmd === 'stop') {
    stopSpeaking();
    addTickerEvent('sys', 'Interruzione vocale eseguita: sintesi arrestata.');
    if (typeof sendNotification === 'function') sendNotification('S.A.V.I.A: Sintesi arrestata.', 'info', 1500);
    return true;
  }
  if (cmd === 'pause') {
    const r = standbyPause();
    if (!r.ok) {
      addTickerEvent(r.reason === 'already' ? 'sys' : 'warn',
        r.reason === 'already'
          ? 'Già in STAND BY. Dite "ricomincia".'
          : 'Nessuna azione in corso da mettere in pausa.');
    }
  } else {
    const r = standbyResume();
    if (!r.ok && r.reason === 'not-active') {
      addTickerEvent('sys', 'Nessuna azione in pausa da riprendere.');
    }
  }
  return true;
}

window.saviaStandbyPause = standbyPause;
window.saviaStandbyResume = standbyResume;

function initStandbyButton() {
  standbyBtn = document.getElementById('btn-standby');
  updateStandbyBtn();
  if (standbyBtn) {
    standbyBtn.addEventListener('click', function () {
      if (typeof playAudio === 'function') playAudio(audioClick);
      const r = standbyActive ? standbyResume() : standbyPause();
      if (!r.ok) {
        addTickerEvent(r.reason === 'already' ? 'sys' : 'warn',
          r.reason === 'already'
            ? 'Già in STAND BY. Premi di nuovo per riprendere.'
            : 'Nessuna azione in corso da mettere in pausa.');
      }
    });
  }
}
initStandbyButton();

function resetStandby() {
  if (standbyActive) {
    standbyActive = false;
    if (synth && synth.paused) { try { synth.resume(); } catch (e) {} }
    if (standbyResumeResolve) {
      const r = standbyResumeResolve;
      standbyResumeResolve = null;
      r();
    }
    updateStandbyUI();
  }
  if (ttsAudioEl) { try { ttsAudioEl.pause(); } catch (e) {} }
}

function stopSpeaking() {
  ttsQueue = [];
  ttsQueueBusy = false;
  if (ttsAudioEl) { try { ttsAudioEl.pause(); } catch (e) {} }
  ttsAudioEl = null;
  if (synth) { try { synth.cancel(); } catch (e) {} }
  if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
  document.dispatchEvent(new CustomEvent('savia-speech-ended'));
}

window.saviaStopSpeaking = stopSpeaking;

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
    ttsAudioEl = audio;

    return new Promise(function(resolve) {
      audio.onended = function() {
        if (ttsAudioEl === audio) ttsAudioEl = null;
        URL.revokeObjectURL(url);
        resolve(true);
      };
      audio.onerror = function() {
        if (ttsAudioEl === audio) ttsAudioEl = null;
        URL.revokeObjectURL(url);
        resolve(false);
      };
      audio.play().catch(function() {
        if (ttsAudioEl === audio) ttsAudioEl = null;
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
// Chiamato al termine della boot sequence o come fallback se il ponte è
// offline o il benvenuto AI non riesce a partire. Garantisce un messaggio
// e una voce immediati all'avvio, senza mai restare muti o bloccati.
let bootGreetingDone = false;

window.__saviaBootGreeting = function () {
  // Se il benvenuto AI è già partito (primo token arrivato), lascia parlare lui.
  if (bootGreetingDone || window.__saviaWelcomeFirstSentence) return;
  bootGreetingDone = true;
  window.__saviaLocalGreetingSpoken = true;

  const hour = new Date().getHours();
  let saluto;
  if (hour < 6) saluto = 'Buonanotte, sir. Tutti i sistemi sono in standby, ma sono a disposizione.';
  else if (hour < 12) saluto = 'Buongiorno, sir. Sistemi online e pronti ad assistervi.';
  else if (hour < 18) saluto = 'Buon pomeriggio, sir. Tutti i sistemi operativi.';
  else saluto = 'Buonasera, sir. Arc reactor operativo, in attesa dei vostri ordini.';

  addTickerEvent('sys', 'Saluto contestuale generato.');

  if (autoSpeak && typeof speakText === 'function') {
    speakText(saluto);
  }
  appendLogMessage('savia', saluto, 'ai');
};

// Fetch voices on startup since key is hardcoded
if (useElevenLabs && ELEVENLABS_API_KEY) {
  setTimeout(() => fetchElevenLabsVoices(), 1000);
}

async function speakText(text) {
  if (!text) return false;
  var cleanText = text.replace(/<[^>]*>/g, '').trim();
  if (!cleanText) return false;

  if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = true;
  addTickerEvent('agent', 'Voice synthesis in progress...');

  // Try ElevenLabs only if explicitly enabled and key configured
  if (useElevenLabs && ELEVENLABS_API_KEY && !ELEVENLABS_API_KEY.startsWith('sk_2141')) {
    var ok = await elevenLabsSpeak(cleanText);
    if (ok) {
      if (ttsQueue.length === 0 && !ttsQueueBusy) {
        if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
        document.dispatchEvent(new CustomEvent('savia-speech-ended'));
      }
      return true;
    }
  }

  // Fallback / Default: Web Speech API (zero latency)
  if (!synth) {
    if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
    return false;
  }

  return new Promise(function(resolve) {
    try {
      var utter = new SpeechSynthesisUtterance(cleanText);
      utter.lang = 'it-IT';
      utter.rate = 1.05;
      utter.pitch = 0.95;
      utter.volume = 1.0;

      if (!wsVoice) selectItalianVoice();
      if (wsVoice) utter.voice = wsVoice;

      utter.onend = function() {
        if (ttsQueue.length === 0 && !ttsQueueBusy) {
          if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
          document.dispatchEvent(new CustomEvent('savia-speech-ended'));
        }
        resolve(true);
      };
      utter.onerror = function() {
        if (ttsQueue.length === 0 && !ttsQueueBusy) {
          if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
          document.dispatchEvent(new CustomEvent('savia-speech-ended'));
        }
        resolve(false);
      };

      synth.speak(utter);
    } catch (e) {
      if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
      addTickerEvent('warn', 'Voice synthesis failed: ' + e.message);
      resolve(false);
    }
  });
}

// ============================================================
// CODA TTS INCREMENTALE — la voce parte durante la generazione
// Il testo in streaming viene letto frase per frase, senza aspettare
// che il messaggio completo sia finito.
// ============================================================
let ttsQueue = [];
let ttsQueueBusy = false;

async function processTtsQueue() {
  if (ttsQueueBusy) return;
  ttsQueueBusy = true;
  try {
    while (ttsQueue.length) {
      const chunk = ttsQueue.shift();
      await speakText(chunk);
    }
  } finally {
    ttsQueueBusy = false;
    if (!synth || (!synth.speaking && !synth.pending)) {
      if (typeof voiceAudioInProgress !== 'undefined') voiceAudioInProgress = false;
      document.dispatchEvent(new CustomEvent('savia-speech-ended'));
    }
  }
}

function queueSpeak(text) {
  if (!autoSpeak) return;
  const clean = String(text || '').replace(/\[TOOL\].*/gi, '')
    .replace(/\[ACTION:\w+\]/gi, '')
    .replace(/<\|.*?\|>/g, '').trim();
  if (!clean) return;
  ttsQueue.push(clean);
  processTtsQueue();
}

// Estrae le frasi complete (fino a . ! ? + spazio/fine) dal testo finora
// generato e le accoda alla sintesi. Restituisce il nuovo cursore letto.
function speakStreamedSentences(fullText, cursor) {
  if (!autoSpeak) return cursor;
  const rest = String(fullText || '').slice(cursor);
  let boundary = -1;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      const next = rest[i + 1];
      if (next === undefined || next === ' ' || next === '\n' || next === '\r' || next === '\t') {
        boundary = i + 1;
      }
    }
  }
  if (boundary <= 0) return cursor;
  const sentence = rest.slice(0, boundary).trim();
  if (sentence) queueSpeak(sentence);
  return cursor + boundary;
}

// ============================================================
// MCP TOOL DOCS — espone i tool MCP all'agente (window.MCP_TOOL_DOCS)
// ============================================================
function buildMcpToolDocs(tools) {
  window.MCP_TOOL_DOCS = (tools || []).map(t =>
    '- ' + t.serverName + '/' + t.name + ': ' + String(t.description || '').split('\n')[0].substring(0, 150)
  ).join('\n');
}

async function refreshMcpToolDocs() {
  if (!window.electronAPI || !window.electronAPI.mcpListTools) return;
  try {
    const res = await window.electronAPI.mcpListTools();
    buildMcpToolDocs(res && res.tools);
  } catch (e) { /* ignore */ }
}

refreshMcpToolDocs();
if (window.electronAPI && window.electronAPI.onMcpEvent) {
  window.electronAPI.onMcpEvent(() => refreshMcpToolDocs());
}




