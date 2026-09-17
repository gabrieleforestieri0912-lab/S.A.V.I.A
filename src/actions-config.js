/**
 * S.A.V.I.A - Azioni & Comandi (ACTION_MAP / ACTION_KEYWORDS / dispatcher)
 * Caricato PRIMA di ollama.js in index.html. Espone le stesse globali
 * che ollama.js dichiarava (executeAction resta per compatibilità con
 * system-ops.js, che lo sovrascrive come da ordine di caricamento).
 */

const YT_CMD_KEY = 'yt-cmd';

const YT_CONTROL_PAGES = ['index.html', 'particles.html', 'terminal.html', 'knowledge.html', 'globe.html', 'objectives.html', 'imagine.html', 'calendar.html', 'youtube.html', 'face-training.html', 'hotline.html', 'proximity.html', 'mcp.html'];

function getCurrentPage() {
  const p = window.location.pathname.split('/').pop();
  return p || 'index.html';
}

let actionPayload = '';

// Invia un intento alla finestra di controllo YouTube via localStorage:
// la finestra youtube.html (già aperta o da aprire) lo consuma con un storage event
// oppure sulla prima lettura al DOMContentLoaded.
function sendYtCommand(op) {
  const payload = cleanActionPayload(actionPayload);
  localStorage.setItem(YT_CMD_KEY, JSON.stringify({ op, payload, ts: Date.now() }));
  window.saviaOpen('youtube.html');
  addTickerEvent('yt', `YOUTUBE INTENT :: ${op}${payload ? ` — ${payload}` : ''}`);
}

const ACTION_MAP = {
  // ── Navigation ──
  navigate_index:        { el: null, fn: () => { window.saviaOpen('index.html'); }, pages: ['particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  navigate_particles:    { el: null, fn: () => { window.saviaOpen('particles.html'); }, pages: ['index.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  navigate_terminal:     { el: null, fn: () => { window.saviaOpen('terminal.html'); }, pages: ['index.html','particles.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  navigate_knowledge:    { el: null, fn: () => { window.saviaOpen('knowledge.html'); }, pages: ['index.html','particles.html','terminal.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  navigate_globe:        { el: null, fn: () => { window.saviaOpen('globe.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','objectives.html','imagine.html','calendar.html'] },
  navigate_objectives:   { el: null, fn: () => { window.saviaOpen('objectives.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','youtube.html','imagine.html','calendar.html'] },
  navigate_calendar:     { el: null, fn: () => { window.saviaOpen('calendar.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','youtube.html','objectives.html','imagine.html'] },
  navigate_imagine:      { el: null, fn: () => { window.saviaOpen('imagine.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','youtube.html','objectives.html','calendar.html'] },

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
  particles_creation_mode: { el: 'btn-creation-mode', fn: null, pages: ['particles.html'] },
  particles_physics:     { el: 'btn-physics', fn: null, pages: ['particles.html'] },
  particles_wireframe:   { el: 'btn-wireframe', fn: null, pages: ['particles.html'] },
  particles_reset_scene: { el: 'btn-reset-scene', fn: null, pages: ['particles.html'] },
  particles_screenshot:  { el: 'btn-screenshot', fn: null, pages: ['particles.html'] },
  particles_gesture_rotate: { el: 'btn-gesture-rotate', fn: null, pages: ['particles.html'] },
  particles_gesture_create: { el: 'btn-gesture-create', fn: null, pages: ['particles.html'] },
  particles_gesture_delete: { el: 'btn-gesture-delete', fn: null, pages: ['particles.html'] },
  particles_gesture_move:   { el: 'btn-gesture-move', fn: null, pages: ['particles.html'] },

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
  navigate_youtube:      { el: null, fn: () => { window.saviaOpen('youtube.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html'] },
  navigate_face_training:{ el: null, fn: () => { window.saviaOpen('face-training.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html','youtube.html'] },
  navigate_hotline:      { el: null, fn: () => { window.saviaOpen('hotline.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html','youtube.html'] },
  navigate_proximity:    { el: null, fn: () => { window.saviaOpen('proximity.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html','youtube.html'] },
  navigate_mcp:          { el: null, fn: () => { window.saviaOpen('mcp.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html','youtube.html'] },
  navigate_news:         { el: null, fn: () => { window.saviaOpen('news.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html','youtube.html','face-training.html','hotline.html','proximity.html','mcp.html'] },
  navigate_stats:        { el: null, fn: () => { window.saviaOpen('stats.html'); }, pages: ['index.html','particles.html','terminal.html','knowledge.html','globe.html','objectives.html','imagine.html','calendar.html','youtube.html','face-training.html','hotline.html','proximity.html','mcp.html','news.html'] },
  yt_search:             { el: null, fn: () => sendYtCommand('search'), pages: YT_CONTROL_PAGES },
  yt_playlist_add:       { el: null, fn: () => sendYtCommand('playlist_add'), pages: YT_CONTROL_PAGES },
  yt_playlist_remove:    { el: null, fn: () => sendYtCommand('playlist_remove'), pages: YT_CONTROL_PAGES },
  yt_subscribe:          { el: null, fn: () => sendYtCommand('subscribe'), pages: YT_CONTROL_PAGES },
  yt_analyze:            { el: null, fn: () => sendYtCommand('analyze'), pages: YT_CONTROL_PAGES },

  // ── Logs ──
  open_logs:             { el: 'system-logs-ticker', fn: null, pages: ['index.html','particles.html','terminal.html','globe.html','knowledge.html','youtube.html','objectives.html'] },

  // ── Messaging ──
  send_whatsapp: { el: null, fn: () => {
    const payload = cleanActionPayload(actionPayload);
    const parts = payload.match(/^(.+?)\s+[-:]\s*(.+)$/s);
    const phone = parts ? parts[1].trim() : '';
    const message = parts ? parts[2].trim() : payload;
    if (typeof executeAction === 'function') {
      executeAction({ type: 'whatsapp', phone, message });
    }
  }, pages: YT_CONTROL_PAGES },
  send_sms: { el: null, fn: () => {
    const payload = cleanActionPayload(actionPayload);
    const parts = payload.match(/^(.+?)\s+[-:]\s*(.+)$/s);
    const phone = parts ? parts[1].trim() : '';
    const message = parts ? parts[2].trim() : payload;
    if (typeof executeAction === 'function') {
      executeAction({ type: 'sms', phone, message });
    }
  }, pages: YT_CONTROL_PAGES },
};

function executeConfigAction(actionId, sourcePage) {
  const action = ACTION_MAP[actionId];
  if (!action) { addTickerEvent('warn', `Unknown action: ${actionId}`); return false; }

  const current = sourcePage || getCurrentPage();
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

  if (el.tagName === 'SELECT') el.dispatchEvent(new Event('change'));
  else el.click();
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
  'addestra il volto': 'navigate_face_training',
  'apri face training': 'navigate_face_training',
  'vai al face training': 'navigate_face_training',
  'addestramento facciale': 'navigate_face_training',
  'vai alla hotline': 'navigate_hotline',
  'apri la hotline': 'navigate_hotline',
  'apri hotline': 'navigate_hotline',
  'chiamata telefonica': 'navigate_hotline',
  'vai alla prossimità': 'navigate_proximity',
  'apri la prossimità': 'navigate_proximity',
  'dispositivi vicini': 'navigate_proximity',
  'sblocca telefono': 'navigate_proximity',
  'vai alla pagina mcp': 'navigate_mcp',
  'apri la pagina mcp': 'navigate_mcp',
  'gestisci server mcp': 'navigate_mcp',
  'server mcp': 'navigate_mcp',
  'strumenti mcp': 'navigate_mcp',

  // News feed
  'apri le notizie': 'navigate_news',
  'vai alle notizie': 'navigate_news',
  'apri le news': 'navigate_news',
  'mostra le notizie': 'navigate_news',
  'ultime notizie': 'navigate_news',
  'notizie tech': 'navigate_news',
  'notizie ai': 'navigate_news',
  'vai a imagine': 'navigate_imagine',
  'vai alla generazione immagini': 'navigate_imagine',
  'apri imagine': 'navigate_imagine',
  'genera immagine': 'navigate_imagine',

  // Stats
  'vai alle statistiche': 'navigate_stats',
  'apri statistiche': 'navigate_stats',
  'mostra statistiche': 'navigate_stats',
  'vai ai dati sistema': 'navigate_stats',
  'apri dati sistema': 'navigate_stats',
  'dashboard system': 'navigate_stats',
  'stats': 'navigate_stats',
  'statistiche': 'navigate_stats',

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
  'attiva modalita creazione': 'particles_creation_mode',
  'disattiva modalita creazione': 'particles_creation_mode',
  'crea particelle': 'particles_creation_mode',
  'attiva fisica': 'particles_physics',
  'disattiva fisica': 'particles_physics',
  'attiva wireframe': 'particles_wireframe',
  'disattiva wireframe': 'particles_wireframe',
  'resetta scena': 'particles_reset_scene',
  'reset scena': 'particles_reset_scene',
  'cattura schermata': 'particles_screenshot',
  'screenshot': 'particles_screenshot',
  'modalita rotazione': 'particles_gesture_rotate',
  'modalita creazione': 'particles_gesture_create',
  'modalita elimina': 'particles_gesture_delete',
  'modalita sposta': 'particles_gesture_move',

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

  // YouTube — azioni (il testo finale del comando viaggia come payload)
  'vai su youtube': 'navigate_youtube',
  'apri youtube': 'navigate_youtube',
  'vai al controllo youtube': 'navigate_youtube',
  'cerca video su youtube': 'yt_search',
  'cerca su youtube': 'yt_search',
  'cerca video': 'yt_search',
  'aggiungi alla playlist': 'yt_playlist_add',
  'aggiungi a playlist': 'yt_playlist_add',
  'salva in playlist': 'yt_playlist_add',
  'rimuovi dalla playlist': 'yt_playlist_remove',
  'rimuovi da playlist': 'yt_playlist_remove',
  'iscriviti al canale youtube': 'yt_subscribe',
  'iscriviti al canale': 'yt_subscribe',
  'iscriviti a': 'yt_subscribe',
  'iscriviti': 'yt_subscribe',
  'analizza il canale': 'yt_analyze',
  'analizza canale': 'yt_analyze',
  'analisi del canale': 'yt_analyze',
  'analisi canale': 'yt_analyze',

  // Memory
  'scansiona progetti': 'memory_scan_projects',

  // WhatsApp
  'invia whatsapp': 'send_whatsapp',
  'manda whatsapp': 'send_whatsapp',
  'invia messaggio whatsapp': 'send_whatsapp',
  'manda messaggio whatsapp': 'send_whatsapp',
  'scrivi su whatsapp': 'send_whatsapp',
  'whatsapp': 'send_whatsapp',

  // SMS
  'invia sms': 'send_sms',
  'manda sms': 'send_sms',
  'invia messaggio sms': 'send_sms',
  'manda messaggio sms': 'send_sms',
  'scrivi un sms': 'send_sms',
  'mandami un sms': 'send_sms',
  'sms': 'send_sms',

  // Logs
  'apri log': 'open_logs',
  'mostra log': 'open_logs',
  'apri system log': 'open_logs',
};

// Strozza congiunzioni/articoli iniziali dal payload vocale
// (es. "al canale mazzucchelli" → "mazzucchelli", "sviluppo personale" resta invariato).
function cleanActionPayload(raw) {
  let s = String(raw || '').replace(/^[\s,.:!?;]+/, '').trim();
  for (let i = 0; i < 3; i++) {
    const m = s.match(/^(al|alle|alla|ai|agli|a|il|lo|la|i|gli|di|del|della|delle|dei|dello|su|nel|nella|nello|in|per|una|uno|un)\s+/i);
    if (m) s = s.slice(m[0].length).trim();
    else break;
  }
  return s.replace(/[\s,.;:!?]+$/, '').trim();
}

// Frasi che spengono completamente S.A.V.I.A (chat o voce).
// Verificate direttamente qui: il dispatcher generico executeConfigAction()
// è ombreggiato da system-ops.js (caricato dopo), quindi l'app non
// resterebbe raggiungibile attraverso ACTION_MAP.
const SHUTDOWN_KEYWORDS = [
  /^spegni( tantissimo)?( il)?( completamente)? savia/i,
  /^spegni( la| il)?( applicazione| programma| app| software| sistema costruttivo)?$/i,
  /^spegni tutto$/i,
  /^spegni il computer$/i,
  /^spegniti$/i,
  /^vai a dormire$/i,
  /^chiudi( completamente)?( la| il)?( applicazione| programma| app| software| savia)?$/i,
  /^esci( da savia)?( dal programma)?$/i,
  /^termina( il)?( programma| savia)?$/i,
  /^arresta( savia)?( il programma)?$/i,
  /^shutdown$/i,
  /^power off$/i,
];

function isShutdownRequest(query) {
  const q = query.trim();
  return SHUTDOWN_KEYWORDS.some(rx => rx.test(q));
}

function detectAndExecuteAction(query, sourcePage) {
  const lower = query.toLowerCase().trim();

  if (isShutdownRequest(query)) {
    addTickerEvent('sys', '[SYS] Spegnimento richiesto da utente.');
    if (typeof sendNotification === 'function') {
      sendNotification('Spegnimento di S.A.V.I.A in corso…', 'warn', 3000);
    }
    if (window.electronAPI && window.electronAPI.quitApp) {
      window.electronAPI.quitApp();
    } else {
      window.close();
    }
    return true;
  }

  for (const [keyword, actionId] of Object.entries(ACTION_KEYWORDS)) {
    if (lower === keyword || lower.startsWith(keyword + ' ') || lower.startsWith(keyword + '.') || lower.startsWith(keyword + ',')) {
      actionPayload = lower === keyword ? '' : cleanActionPayload(query.slice(keyword.length));
      addTickerEvent('agent', `Command recognized: "${keyword}"${actionPayload ? ` → "${actionPayload}"` : ''} → ${actionId}`);
      const ok = executeConfigAction(actionId, sourcePage);
      actionPayload = '';
      return ok;
    }
  }
  return false;
}