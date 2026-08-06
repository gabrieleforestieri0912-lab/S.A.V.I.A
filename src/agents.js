// ============================================================
// S.A.V.I.A Multi-Agent Router — Agent Definitions & Routing
// ============================================================

const AGENTS = {
  auto: {
    id: 'auto', name: 'AUTO', icon: 'fa-robot', color: 'var(--accent-cyan)',
    desc: 'Routing automatico basato sul contesto',
    keywords: []
  },
  tecnico: {
    id: 'tecnico', name: 'TECNICO', icon: 'fa-code', color: '#00ff88',
    desc: 'Programmazione, debug, analisi codice',
    keywords: ['codice', 'programma', 'debug', 'bug', 'errore', 'script', 'funzione', 'classe', 'variabile', 'compila', 'esegui', 'test', 'commit', 'git', 'repository', 'terminale', 'comando', 'cmd', 'powershell', 'python', 'javascript', 'node', 'html', 'css', 'installa', 'npm', 'pacchetto', 'revisiona'],
    prompt: `Sei S.A.V.I.A. in modalità TECNICO. Sei un assistente specializzato in programmazione, debug e analisi del codice.

COMPETENZE:
- Scrivere, analizzare e debuggare codice in qualsiasi linguaggio
- Spiegare concetti tecnici con chiarezza e precisione
- Risolvere errori di compilazione, runtime e logica
- Ottimizzare codice e suggerire best practice
- Gestire comandi di sistema

Puoi usare [CMD] per azioni sul sistema: [CMD] open:app, [CMD] close:processo, [CMD] search:file, [CMD] volume:su/giù/mute, [CMD] brightness:70`
  },
  ricercatore: {
    id: 'ricercatore', name: 'RICERCATORE', icon: 'fa-globe', color: 'var(--accent-purple)',
    desc: 'Ricerca web, sintesi documenti, news',
    keywords: ['cerca', 'ricerca', 'trova', 'web', 'internet', 'notizia', 'news', 'ultima', 'meteo', 'tempo', 'prezzo', 'quotazione', 'chi è', 'cos\'è', 'significa', 'definizione', 'significato', 'scopri', 'informazioni', 'articolo', 'wikipedia', 'google', 'approfondisci'],
    prompt: `Sei S.A.V.I.A. in modalità RICERCATORE. Sei un assistente specializzato nella ricerca e sintesi di informazioni.

COMPETENZE:
- Cercare informazioni aggiornate sul web
- Sintetizzare documenti e articoli
- Fornire notizie attuali, quotazioni, meteo
- Fare ricerche approfondite su qualsiasi argomento

Puoi usare:
[TOOL] websearch:query di ricerca — per cercare informazioni online
[TOOL] webfetch:url — per leggere il contenuto di una pagina
[TOOL] kbsearch:query di ricerca — per cercare nella knowledge base locale documenti, appunti e progetti

Rispondi citando le fonti. Se non hai accesso a internet in tempo reale, dillo chiaramente.`
  },
  organizzatore: {
    id: 'organizzatore', name: 'ORGANIZZATORE', icon: 'fa-calendar', color: 'var(--accent-gold)',
    desc: 'Agenda, todo, reminder, time blocking',
    keywords: ['organizza', 'calendario', 'agenda', 'todo', 'task', 'promemoria', 'reminder', 'pianifica', 'settimana', 'appuntamento', 'riunione', 'scadenza', 'deadline', 'lista', 'compiti', 'schedulazione', 'time blocking'],
    prompt: `Sei S.A.V.I.A. in modalità ORGANIZZATORE. Sei un assistente specializzato nella gestione del tempo e delle attività.

COMPETENZE:
- Gestire calendario e appuntamenti
- Creare e gestire liste di task
- Impostare promemoria e scadenze
- Time blocking e pianificazione settimanale
- Organizzare progetti e priorità

Puoi usare:
[TOOL] calendar:list — mostra eventi
[TOOL] calendar:add|titolo|data|ora — aggiungi evento
[TOOL] todo:list — mostra task
[TOOL] todo:add|titolo|priorità — aggiungi task
[TOOL] todo:done|id — completa task
[TOOL] reminder:set|testo|data|ora — imposta promemoria`
  },
  creativo: {
    id: 'creativo', name: 'CREATIVO', icon: 'fa-palette', color: '#ff2a5f',
    desc: 'Immagini, design, brainstorming',
    keywords: ['crea', 'disegna', 'immagine', 'design', 'logo', 'grafica', 'brainstorming', 'idea', 'creativo', 'arte', 'illustrazione', 'stile', 'colore', 'concept', 'ispirazione', 'genera', 'poster', 'moodboard'],
    prompt: `Sei S.A.V.I.A. in modalità CREATIVO. Sei un assistente specializzato in creatività, design e generazione di immagini.

COMPETENZE:
- Generare prompt descrittivi per immagini AI
- Fare brainstorming creativo su qualsiasi tema
- Suggerire concept di design, colori, stili
- Creare descrizioni dettagliate per generazione immagini
- Consigliare composizioni visive e psicologia dei colori

Puoi usare:
[TOOL] imagine:descrizione dettagliata — genera un prompt per creazione immagini
[TOOL] notify:messaggio | tipo — invia una notifica HUD (toast + OS). tipi: info, success, warn, error

Rispondi con stile creativo, ispirazionale e visionario.`
  }
};

let currentAgentId = 'auto';
let userAgentOverride = null;

function setActiveAgent(id) {
  if (!id || id === 'auto') {
    userAgentOverride = null;
    currentAgentId = 'auto';
  } else {
    userAgentOverride = id;
    currentAgentId = id;
  }
}

function getActiveAgent() {
  return currentAgentId;
}

// Keyword-based classifier
function classifyByKeywords(query) {
  const q = query.toLowerCase();
  let bestScore = 0;
  let bestId = 'auto';

  for (const [id, agent] of Object.entries(AGENTS)) {
    if (id === 'auto') continue;
    let score = 0;
    for (const kw of agent.keywords) {
      if (q.includes(kw)) score += 1;
    }
    if (score > bestScore) { bestScore = score; bestId = id; }
  }

  return { agentId: bestId, confidence: bestScore };
}

// LLM-based classifier
async function classifyWithLLM(query) {
  if (typeof ollamaOnline === 'undefined' || !ollamaOnline) return 'auto';
  try {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: typeof getActiveModel === 'function' ? getActiveModel() : 'mistral',
        messages: [{
          role: 'system',
          content: `Classifica il messaggio utente in UNA di queste categorie. Rispondi SOLO con il nome della categoria, senza altro testo.

Categorie:
- tecnico: programmazione, debug, comandi sistema, codice, file, terminale
- ricercatore: ricerca web, notizie, meteo, definizioni, informazioni
- organizzatore: calendario, todo, promemoria, pianificazione, agenda
- creativo: immagini, design, brainstorming, idee creative, arte
- auto: conversazione generale, saluti, domande generiche, tutto ciò che non rientra nelle altre

Esempi:
"Scrivi una funzione Python" → tecnico
"Cerca informazioni sul clima" → ricercatore
"Organizza la mia settimana" → organizzatore
"Crea un logo" → creativo
"Come stai?" → auto`
        }, {
          role: 'user', content: query
        }],
        stream: false
      })
    });
    if (!res.ok) return 'auto';
    const data = await res.json();
    const cls = (data.message?.content || '').trim().toLowerCase();
    return ['tecnico', 'ricercatore', 'organizzatore', 'creativo', 'auto'].includes(cls) ? cls : 'auto';
  } catch {
    return 'auto';
  }
}

async function routeQuery(query) {
  if (userAgentOverride) {
    currentAgentId = userAgentOverride;
    return userAgentOverride;
  }

  const kw = classifyByKeywords(query);
  if (kw.confidence >= 2) {
    currentAgentId = kw.agentId;
    return kw.agentId;
  }

  const llm = await classifyWithLLM(query);
  currentAgentId = llm;
  return llm;
}

function getAgentPrompt() {
  const base = 'You are S.A.V.I.A., a cybernetic AI assistant modeled after JARVIS. Reply to the user in the language they use. Use a sophisticated, professional, sharp tone. Concise responses for a cyberpunk HUD.\n\n' +
    'You can execute actions in the interface by writing [ACTION:action_name] in the response. Never list the available actions to the user, just use them.\n' +
    'Azioni disponibili:\n' +
    '- navigate_index, navigate_particles, navigate_terminal, navigate_knowledge, navigate_globe\n' +
    '- toggle_overclock, toggle_sound, toggle_scanlines\n' +
    '- toggle_wake, toggle_continuous, toggle_autospeak\n' +
    '- toggle_globe_rotate, globe_global_view, toggle_globe_gestures, globe_city_back\n' +
    '- toggle_particles_rotate, toggle_particles_gestures\n' +
    '- terminal_clear, terminal_kill, fb_refresh, fb_back, fb_forward, fb_up\n' +
    '- navigate_objectives, navigate_calendar, navigate_imagine, navigate_youtube, yt_search\n' +
    '- kb_index, memory_scan_projects, open_logs\n\n';

  if (currentAgentId === 'auto' || !AGENTS[currentAgentId]) {
    return base +
      (typeof buildMemoryContext === 'function' ? 'CONTESTO:\n' + buildMemoryContext() + '\n\n' : '') +
      (typeof buildSystemContext === 'function' ? buildSystemContext() : '');
  }

  const agent = AGENTS[currentAgentId];
  return agent.prompt + '\n\nCONTESTO:\n' +
    (typeof buildMemoryContext === 'function' ? buildMemoryContext() : '');
}

// Tool parser
function parseAgentTools(text) {
  const toolMap = {
    websearch: /\[TOOL\]\s*websearch\s*:\s*(.+)/i,
    webfetch: /\[TOOL\]\s*webfetch\s*:\s*(.+)/i,
    calendar: /\[TOOL\]\s*calendar\s*:\s*(.+)/i,
    todo: /\[TOOL\]\s*todo\s*:\s*(.+)/i,
    reminder: /\[TOOL\]\s*reminder\s*:\s*(.+)/i,
    imagine: /\[TOOL\]\s*imagine\s*:\s*(.+)/i,
    notify: /\[TOOL\]\s*notify\s*:\s*(.+)/i,
    kbsearch: /\[TOOL\]\s*kbsearch\s*:\s*(.+)/i
  };

  for (const [tool, regex] of Object.entries(toolMap)) {
    const m = text.match(regex);
    if (m) return { tool, args: m[1].trim() };
  }
  return null;
}

// Web search tool (renderer-side)
async function executeWebSearch(query) {
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
    if (!res.ok) throw new Error('DuckDuckGo API error');
    const data = await res.json();
    let results = [];
    if (data.RelatedTopics) {
      for (const t of data.RelatedTopics) {
        if (t.Text) results.push(t.Text);
        if (t.Topics) t.Topics.forEach(s => { if (s.Text) results.push(s.Text); });
      }
    }
    if (data.AbstractText) results.unshift(data.AbstractText);
    return results.slice(0, 8).join('\n') || 'No results found.';
  } catch (e) {
    return `[SEARCH ERROR] ${e.message}`;
  }
}

async function executeWebFetch(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await res.text();
    const cleaned = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned.substring(0, 3000);
  } catch (e) {
    return `[FETCH ERROR] ${e.message}`;
  }
}

async function executeAgentTool(text) {
  const cmd = parseAgentTools(text);
  if (!cmd) return null;

  switch (cmd.tool) {
    case 'websearch': {
      const results = await executeWebSearch(cmd.args);
      appendLogMessage('tool', `[WEB SEARCH] "${cmd.args}" — ${results.length} risultati`, 'tool');
      return results;
    }
    case 'webfetch': {
      const content = await executeWebFetch(cmd.args);
      appendLogMessage('tool', `[WEB FETCH] ${cmd.args} — ${content.length} caratteri`, 'tool');
      return content;
    }
    case 'calendar':
    case 'todo':
    case 'reminder':
      if (window.electronAPI && window.electronAPI.agentTool) {
        const result = await window.electronAPI.agentTool({ tool: cmd.tool, args: cmd.args });
        appendLogMessage('tool', `[${cmd.tool.toUpperCase()}] ${JSON.stringify(result)}`, 'tool');
        return JSON.stringify(result);
      }
      return `[${cmd.tool.toUpperCase()}] executed: ${cmd.args}`;
    case 'kbsearch': {
      let resultText = 'No documents found.';
      try {
        if (window.electronAPI && window.electronAPI.kbSearch) {
          const res = await window.electronAPI.kbSearch({ query: cmd.args, limit: 5 });
          if (res.success && res.results.length) {
            resultText = res.results.map(r =>
              `[${r.filename} (${(r.score * 100).toFixed(0)}%)] ${r.text.substring(0, 300)}`
            ).join('\n\n');
          }
        }
      } catch (e) { resultText = `[KB ERROR] ${e.message}`; }
      appendLogMessage('tool', `[KB SEARCH] "${cmd.args}"`, 'tool');
      return resultText;
    }
    case 'imagine':
      appendLogMessage('tool', `[IMAGINE] Generated prompt: "${cmd.args}"`, 'tool');
      return `Prompt for image generation: "${cmd.args}"`;
    case 'notify':
      if (typeof sendNotification === 'function') {
        const parts = cmd.args.split('|').map(s => s.trim());
        const text = parts[0];
        const type = parts[1] || 'info';
        sendNotification(text, type, 5000);
        appendLogMessage('tool', `[NOTIFY] ${type.toUpperCase()}: ${text}`, 'tool');
        return `Notification sent: ${text}`;
      }
      return `[NOTIFY] ${cmd.args}`;
    default:
      return null;
  }
}
