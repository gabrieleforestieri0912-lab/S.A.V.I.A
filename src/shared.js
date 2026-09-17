let soundEnabled = true;
let overclockEnabled = true;
let scanlinesEnabled = true;
let aiOnline = false;
let aiProvider = 'openrouter'; // solo OpenRouter
let openrouterApiKey = ''; // caricato da savia-config.json via configGet (mai hardcodare)
let openrouterBaseUrl = 'https://openrouter.ai/api/v1';
let systemLogsBuffer = [];

const audioClick = document.getElementById('audio-click');
const audioBeep = document.getElementById('audio-beep');

function playAudio(audio) {
  if (soundEnabled && audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }
}

const btnMin = document.getElementById('btn-minimize');
const btnMax = document.getElementById('btn-maximize');
const btnClose = document.getElementById('btn-close');

if (btnMin) btnMin.addEventListener('click', () => {
  playAudio(audioClick);
  if (window.electronAPI) window.electronAPI.minimize();
});
if (btnMax) btnMax.addEventListener('click', () => {
  playAudio(audioClick);
  if (window.electronAPI) window.electronAPI.maximize();
});
if (btnClose) btnClose.addEventListener('click', () => {
  playAudio(audioClick);
  if (window.electronAPI) window.electronAPI.close();
});

function updateClock() {
  const clockEl = document.getElementById('clock-display');
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  }
}
setInterval(updateClock, 1000);
updateClock();

const clockDisplay = document.getElementById('clock-display');
if (clockDisplay) {
  clockDisplay.style.cursor = 'pointer';
  clockDisplay.title = 'Click to open Global Timeline';
  clockDisplay.addEventListener('click', function () {
    playAudio(audioClick);
    window.saviaOpen('globe.html');
  });
}

const fillCpu = document.getElementById('fill-cpu');
const txtCpuLoad = document.getElementById('txt-cpu-load');
const fillMem = document.getElementById('fill-mem');
const txtMemLoad = document.getElementById('txt-mem-load');
const fillPing = document.getElementById('fill-ping');
const txtPingLoad = document.getElementById('txt-ping-load');
const telemetryFreq = document.getElementById('telemetry-freq');
const telemetryTemp = document.getElementById('telemetry-temp');
const ringSegmented = document.querySelector('.ring-segmented');
const ringInner = document.querySelector('.ring-inner');
const tickerEvents = document.getElementById('ticker-events');
const modalLogsList = document.getElementById('modal-logs-list');
const modalLogsCount = document.getElementById('modal-logs-count');
const svcCognitive = document.getElementById('svc-cognitive');
const svcTelemetry = document.getElementById('svc-telemetry');
const svcFileIndexing = document.getElementById('svc-fileindexing');

function setServiceStatus(el, status) {
  if (!el) return;
  el.classList.toggle('active-service', status === 'online' || status === 'active');
  const desc = el.querySelector('.item-desc');
  if (desc) {
    if (status === 'online') desc.style.color = 'var(--accent-cyan)';
    else if (status === 'warning') desc.style.color = 'var(--accent-gold)';
    else if (status === 'offline') desc.style.color = 'var(--accent-red)';
    else desc.style.color = '';
  }
}

function addTickerEvent(prefix, msg) {
  if (msg === undefined) {
    msg = prefix;
    prefix = 'sys';
    if (msg.startsWith('[')) {
      const endIdx = msg.indexOf(']');
      if (endIdx > 1) {
        prefix = msg.substring(1, endIdx).toLowerCase();
        msg = msg.substring(endIdx + 1).trim();
      }
    }
  }

  prefix = prefix.toLowerCase();
  if (prefix === 'ai' || prefix === 'cognitive' || prefix === 'cognitive_bridge') {
    prefix = 'ai';
  } else if (prefix === 'sys_err' || prefix === 'error' || prefix === 'warning') {
    prefix = 'warn';
  } else if (prefix !== 'sys' && prefix !== 'particles' && prefix !== 'ai' && prefix !== 'warn') {
    prefix = 'sys';
  }

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const logEntry = { time: timeStr, prefix, text: msg };
  systemLogsBuffer.push(logEntry);

  if ((prefix === 'warn' || prefix === 'error') && typeof sendNotification === 'function') {
    const dedupMs = 30000;
    if (!window.__NOTIF_DEDUP) window.__NOTIF_DEDUP = {};
    const now = Date.now();
    const key = `ticker:${msg}`;
    if (!window.__NOTIF_DEDUP[key] || (now - window.__NOTIF_DEDUP[key]) >= dedupMs) {
      window.__NOTIF_DEDUP[key] = now;
      sendNotification(msg, prefix === 'error' ? 'error' : 'warn', 6000);
    }
  }

  if (tickerEvents) {
    const tickerItem = document.createElement('div');
    tickerItem.className = 'ticker-item';
    tickerItem.textContent = `[${timeStr}] [${prefix.toUpperCase()}] ${msg}`;
    tickerEvents.appendChild(tickerItem);
    if (tickerEvents.children.length > 5) {
      tickerEvents.removeChild(tickerEvents.firstChild);
    }
  }

  appendLogToModal(logEntry);
  updateLogsCount();
}

function appendLogToModal(logEntry) {
  if (!modalLogsList) return;
  const item = document.createElement('div');
  item.className = `modal-log-item ${logEntry.prefix}`;
  item.setAttribute('data-prefix', logEntry.prefix);

  const stamp = document.createElement('span');
  stamp.className = 'modal-log-stamp';
  stamp.textContent = `[${logEntry.time}]`;

  const badge = document.createElement('span');
  badge.className = `modal-log-badge ${logEntry.prefix}`;
  badge.textContent = logEntry.prefix;

  const text = document.createElement('span');
  text.className = 'modal-log-text';
  text.innerHTML = logEntry.text;

  item.appendChild(stamp);
  item.appendChild(badge);
  item.appendChild(text);

  modalLogsList.appendChild(item);

  const body = document.getElementById('modal-logs-body');
  if (body) body.scrollTop = body.scrollHeight;
}

function updateLogsCount() {
  if (modalLogsCount) modalLogsCount.textContent = systemLogsBuffer.length;
}

const logsModal = document.getElementById('logs-modal');
const logsTicker = document.getElementById('system-logs-ticker');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCloseModalFooter = document.getElementById('btn-close-modal-footer');
const btnClearLogs = document.getElementById('btn-clear-modal-logs');
const modalClock = document.getElementById('modal-clock');

function updateModalClock() {
  if (modalClock && logsModal && !logsModal.classList.contains('hidden-modal')) {
    modalClock.textContent = new Date().toTimeString().split(' ')[0];
  }
}
setInterval(updateModalClock, 1000);

if (logsTicker) {
  logsTicker.addEventListener('click', () => {
    playAudio(audioClick);
    logsModal.classList.remove('hidden-modal');
    updateModalClock();
    const body = document.getElementById('modal-logs-body');
    setTimeout(() => { if (body) body.scrollTop = body.scrollHeight; }, 50);
    addTickerEvent('sys', 'Detailed log console expanded.');
  });
}

function dismissLogsModal() {
  playAudio(audioClick);
  logsModal.classList.add('hidden-modal');
}
if (btnCloseModal) btnCloseModal.addEventListener('click', dismissLogsModal);
if (btnCloseModalFooter) btnCloseModalFooter.addEventListener('click', dismissLogsModal);

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', () => {
    playAudio(audioBeep);
    systemLogsBuffer = [];
    modalLogsList.innerHTML = '';
    updateLogsCount();
    addTickerEvent('sys', 'System log buffer wiped.');
  });
}

const filterButtons = document.querySelectorAll('.filter-btn');
filterButtons.forEach(btn => {
  btn.addEventListener('click', function() {
    playAudio(audioClick);
    filterButtons.forEach(b => b.classList.remove('active'));
    this.classList.add('active');

    const filterType = this.getAttribute('data-filter');
    const logItems = modalLogsList.querySelectorAll('.modal-log-item');
    logItems.forEach(item => {
      const p = item.getAttribute('data-prefix');
      if (filterType === 'all') { item.style.display = 'flex'; }
      else if (filterType === 'warn') { item.style.display = (p === 'warn' || p === 'error' || p === 'sys_err') ? 'flex' : 'none'; }
      else { item.style.display = p === filterType ? 'flex' : 'none'; }
    });
  });
});

async function initSystemInfo() {
  if (!window.electronAPI || !window.electronAPI.getSystemInfo) {
    addTickerEvent('sys', 'Frameless HUD renderer contexts bound [env: browser].');
    return;
  }
  try {
    const info = await window.electronAPI.getSystemInfo();
    addTickerEvent('sys', `Host: ${info.hostname} | User: ${info.username} | OS: ${info.platform}/${info.arch}`);
    addTickerEvent('sys', `CPU: ${info.cpuModel} (${info.cpuCores} cores) | RAM: ${info.totalMemGB}GB`);
    addTickerEvent('sys', `Runtime: Electron ${info.electronVersion} / Node ${info.nodeVersion}`);
    addTickerEvent('sys', 'HUD renderer contexts bound. IPC bridge secured.');

    if (svcCognitive) {
      const desc = svcCognitive.querySelector('.item-desc');
      if (desc) desc.textContent = 'AI Bridge Initializing...';
    }
  } catch(e) {
    addTickerEvent('warn', `System info query failed: ${e.message}`);
  }
}

let vectorIndexingActive = false;

async function startVectorIndexing() {
  if (!window.electronAPI || !window.electronAPI.fsIndexStart) {
    addTickerEvent('warn', 'Vector Indexing: IPC bridge unavailable.');
    return;
  }
  if (vectorIndexingActive) {
    const result = await window.electronAPI.fsIndexStop();
    vectorIndexingActive = false;
    if (svcFileIndexing) {
      const desc = svcFileIndexing.querySelector('.item-desc');
      if (desc) { desc.textContent = 'Filesystem Watcher'; desc.style.color = ''; }
      setServiceStatus(svcFileIndexing, 'offline');
    }
    addTickerEvent('sys', `Vector indexing stopped. ${result.indexed} files deregistered.`);
    return;
  }

  addTickerEvent('sys', 'Vector indexing service starting...');
  if (svcFileIndexing) {
    const desc = svcFileIndexing.querySelector('.item-desc');
    if (desc) { desc.textContent = 'Scanning...'; desc.style.color = 'var(--accent-gold)'; }
  }

  const result = await window.electronAPI.fsIndexStart(null);
  if (result.success) {
    vectorIndexingActive = true;
    setServiceStatus(svcFileIndexing, 'online');
    if (svcFileIndexing) {
      const desc = svcFileIndexing.querySelector('.item-desc');
      if (desc) { desc.textContent = `${result.indexedCount} files indexed`; desc.style.color = 'var(--accent-cyan)'; }
    }
    addTickerEvent('sys', `Vector indexing ACTIVE. Path: ${result.watchedPath}`);
    addTickerEvent('sys', `Indexed ${result.indexedCount} files. Live watcher armed.`);

    const byExt = result.summary.byExt;
    const top = Object.entries(byExt).sort((a,b)=>b[1]-a[1]).slice(0,5);
    if (top.length) {
      addTickerEvent('sys', `Top file types: ${top.map(([e,c])=>`${e}(${c})`).join(' | ')}`);
    }
  } else {
    addTickerEvent('warn', `Vector indexing failed: ${result.error}`);
    setServiceStatus(svcFileIndexing, 'offline');
  }
}

if (window.electronAPI && window.electronAPI.onFsEvent) {
  window.electronAPI.onFsEvent((ev) => {
    addTickerEvent('sys', `FS_WATCH [${ev.type.toUpperCase()}] ${ev.file}`);
  });
}

if (svcFileIndexing) {
  svcFileIndexing.style.cursor = 'pointer';
  svcFileIndexing.title = 'Click to toggle Vector Indexing filesystem watcher';
  svcFileIndexing.addEventListener('click', () => { playAudio(audioClick); startVectorIndexing(); });
}

if (svcTelemetry) {
  svcTelemetry.style.cursor = 'default';
  svcTelemetry.title = 'Real-time OS telemetry — always active';
  setServiceStatus(svcTelemetry, 'warning');
  const desc = svcTelemetry.querySelector('.item-desc');
  if (desc) desc.textContent = 'Waiting for first push...';
}

if (svcCognitive) {
  svcCognitive.style.cursor = 'default';
  svcCognitive.title = 'Cognitive Core — status mirrors AI bridge';
}

initSystemInfo();

// ── Toast Notification System ──────────────────────────────────

const TOAST_CONTAINER = (() => {
  const existing = document.getElementById('toast-container');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'toast-container';
  el.style.cssText = 'position:fixed;bottom:60px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:6px;pointer-events:none;';
  document.body.appendChild(el);
  return el;
})();

function showToast(msg, type = 'info', duration = 3000) {
  const colors = { info: 'var(--accent-cyan)', success: '#00ff88', warn: 'var(--accent-gold)', error: 'var(--accent-red)' };
  const icons = { info: 'fa-info-circle', success: 'fa-check-circle', warn: 'fa-exclamation-triangle', error: 'fa-times-circle' };
  const color = colors[type] || colors.info;

  const el = document.createElement('div');
  el.style.cssText = `
    background:rgba(7,9,19,0.92);border:1px solid ${color};border-radius:4px;
    padding:8px 14px;font-family:'Share Tech Mono',monospace;font-size:11px;
    color:#c4d1f5;display:flex;align-items:center;gap:8px;
    box-shadow:0 0 12px rgba(0,0,0,0.6),0 0 4px ${color};
    opacity:0;transform:translateX(20px);transition:all 0.25s ease-out;
    pointer-events:auto;max-width:360px;
  `;
  el.innerHTML = `<i class="fas ${icons[type] || icons.info}" style="color:${color};font-size:12px;"></i> ${msg}`;
  TOAST_CONTAINER.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(0)';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 250);
  }, duration);
}

// ── Unified Notification System ───────────────────────────────
// Sends in-app toast + native OS notification + logs to ticker

const URGENCY_MAP = { info: 'normal', success: 'normal', warn: 'critical', error: 'critical' };

function sendNotification(msg, type = 'info', duration = 4000) {
  showToast(msg, type, duration);
  addTickerEvent(type, msg);

  if (window.electronAPI && window.electronAPI.sendNotification) {
    const titles = { info: 'ℹ S.A.V.I.A', success: '✓ S.A.V.I.A', warn: '⚠ S.A.V.I.A', error: '✖ S.A.V.I.A' };
    window.electronAPI.sendNotification({
      title: titles[type] || 'S.A.V.I.A',
      body: msg,
      urgency: URGENCY_MAP[type] || 'normal'
    });
  }
}

// ── Reminder / Calendar fired (push from main process) ─────────────
if (window.electronAPI && window.electronAPI.onReminderFired) {
  window.electronAPI.onReminderFired((data) => {
    const label = data.type === 'calendar' ? 'EVENTO' : 'PROMEMORIA';
    if (typeof showToast === 'function') {
      showToast(`[${label}] ${data.text || ''}`, data.type === 'calendar' ? 'info' : 'warn', 8000);
    }
    if (typeof addTickerEvent === 'function') {
      addTickerEvent('sys', `${label} scattato: ${data.text}`);
    }
  });
}

// ── Unified Navigation System ─────────────────────────────────

const NAV_HISTORY = [];
const NAV_PAGES = {
  'index.html':       { title: 'TERMINALE_COGNITIVO', section: 'view-terminal', icon: 'fa-brain' },
  'dashboard':        { title: 'CRUSCOTTO',          section: 'view-dashboard', icon: 'fa-gauge-high' },
  'editor':           { title: 'EDITOR_CODICE',      section: 'view-editor',    icon: 'fa-code' },
  'calendar.html':    { title: 'CALENDARIO',         external: true },
  'objectives.html':  { title: 'HUB_OBIETTIVI',      external: true },
  'imagine.html':     { title: 'AI_IMMAGINA',        external: true },
  'particles.html':   { title: 'PARTICELLE_NERALI',  external: true },
  'terminal.html':    { title: 'CENTRO_COMANDI',     external: true },
  'globe.html':       { title: 'LINEA_TEMPORALE',    external: true },
  'knowledge.html':   { title: 'BASE_CONOSCENZA',    external: true },
  'youtube.html':     { title: 'CONTROLLO_YOUTUBE',  external: true },
  'mcp.html':         { title: 'MCP_SERVERS',        external: true },
};

// True quando la pagina corrente vive in una finestra-strumento dedicata
// (in tal caso "index.html" deve riportare al centro di comando, non cambiare vista)
const IS_TOOL_WINDOW = /(?:terminal|calendar|objectives|imagine|particles|globe|knowledge|youtube|hotline|proximity|face-training|mcp)\.html$/.test(location.pathname);

let navReady = false;
let currentNavPage = null;

function navigateTo(pageId, params = null, pushHistory = true) {
  const page = NAV_PAGES[pageId];
  if (!page) return;

  if (pushHistory && currentNavPage && currentNavPage !== pageId) {
    NAV_HISTORY.push({ page: currentNavPage, params: null });
    if (NAV_HISTORY.length > 50) NAV_HISTORY.shift();
  }

  currentNavPage = pageId;

  // Pagine "esterna" (strumenti a schermo intero) → nuova finestra desktop;
  // da una finestra-strumento anche il ritorno al comando passa dal main process
  if (page.external || (IS_TOOL_WINDOW && pageId === 'index.html')) {
    let url = pageId;
    if (params && typeof params === 'object') {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += '?' + qs;
    }
    window.saviaOpen(url);
    return;
  }

  if (!navReady) return;

  const app = document.getElementById('app-workspace');
  if (app) {
    app.style.opacity = '0';
    app.style.transition = 'opacity 0.12s ease-out';
  }

  setTimeout(() => {
    hideAllViews();

    const sectionId = page.section;
    const section = document.getElementById(sectionId);
    if (section) section.classList.remove('hidden');

    updateSidebarActive(pageId);
    updateBreadcrumb(page);
    updateClockTitle(page.title);

    if (pageId === 'dashboard') startDashboard();
    else stopDashboard();

    if (pageId === 'editor') {
      setTimeout(() => initEditor && initEditor(), 80);
    }

    if (app) {
      app.style.opacity = '1';
      app.style.transition = 'opacity 0.18s ease-in';
    }
  }, 120);
}

function updateSidebarActive(pageId) {
  const map = {
    'index.html': ['proj-saviacore'],
    'dashboard':  ['nav-dashboard'],
    'editor':     ['nav-editor'],
    'calendar.html': [], 'objectives.html': [], 'imagine.html': [],
    'particles.html': [], 'terminal.html': [], 'globe.html': [],
    'knowledge.html': [], 'youtube.html': [],
  };
  const ids = map[pageId] || [];
  document.querySelectorAll('#left-sidebar .nav-rail-item').forEach(function(el) {
    el.classList.remove('active');
    const dot = el.querySelector('.item-status');
    if (dot && ids.includes(el.id)) {
      dot.className = 'item-status online';
      el.classList.add('active');
    } else if (dot) {
      dot.className = 'item-status offline';
    }
  });
}

function updateBreadcrumb(page) {
  const el = document.querySelector('.breadcrumb');
  if (el) el.textContent = 'SISTEMA_ROOT // ' + page.title;
}

function updateClockTitle(title) {
  const el = document.querySelector('.header-center');
  if (el && title) el.innerHTML = '<span class="breadcrumb">SISTEMA_ROOT // ' + title + '</span>';
}

function goBack() {
  if (NAV_HISTORY.length === 0) return;
  const prev = NAV_HISTORY.pop();
  navigateTo(prev.page, null, false);
}

function goForward() {
  // Simple re-navigation to current resets transient state
  if (currentNavPage) navigateTo(currentNavPage, null, false);
}

document.addEventListener('keydown', function(e) {
  if ((e.altKey || e.metaKey) && e.key === 'ArrowLeft') {
    e.preventDefault();
    goBack();
  }
  if ((e.altKey || e.metaKey) && e.key === 'ArrowRight') {
    e.preventDefault();
    goForward();
  }
  if ((e.altKey || e.metaKey) && e.key === 'ArrowUp') {
    e.preventDefault();
    navigateTo('index.html', null, true);
  }
});

// Override legacy inline navigations for in-app views
window.navigateTo = navigateTo;

document.addEventListener('DOMContentLoaded', function() {
  navReady = true;
  currentNavPage = 'index.html';
  updateSidebarActive('index.html');
  updateClockTitle(NAV_PAGES['index.html'].title);

  document.querySelectorAll('#left-sidebar .nav-rail-item').forEach(function(el) {
    if (el.getAttribute('onclick')) return;
    const onclick = el.getAttribute('onclick');
    el.addEventListener('click', function() {
      const pageId = el.dataset.navPage;
      if (pageId) navigateTo(pageId);
    });
  });

  document.getElementById('clock-display')?.addEventListener('click', function() {
    navigateTo('globe.html');
  });

  document.getElementById('btn-test-notif')?.addEventListener('click', function() {
    sendNotification('Navigazione attiva', 'info');
  });
});

// Wire legacy onclick navigations after load
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    document.querySelectorAll('#left-sidebar .nav-rail-item[onclick]').forEach(function(el) {
      const raw = el.getAttribute('onclick') || '';
      const m = raw.match(/window\.location\.href='([^']+)'/);
      if (m) {
        const pageId = m[1];
        if (NAV_PAGES[pageId]) {
          el.removeAttribute('onclick');
          el.setAttribute('data-nav-page', pageId);
          el.addEventListener('click', function() { navigateTo(pageId); });
        }
      }
    });
  }, 50);
});

// ── Apertura scheda/finestra: attiva le animazioni (html.savia-open)
// quando la finestra diventa visibile → l'entrata è visibile in ogni pagina.
(function () {
  function triggerOpenAnim() {
    var root = document.documentElement;
    root.classList.remove('savia-open');
    void root.offsetWidth;
    root.classList.add('savia-open');
  }
  function onVisible() {
    if (document.visibilityState === 'visible') triggerOpenAnim();
  }
  document.addEventListener('visibilitychange', onVisible);
  if (document.visibilityState === 'visible') {
    if (document.readyState === 'complete') {
      setTimeout(triggerOpenAnim, 60);
    } else {
      window.addEventListener('load', function () { setTimeout(triggerOpenAnim, 60); });
    }
  }
})();
