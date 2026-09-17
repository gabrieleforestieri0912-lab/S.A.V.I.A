'use strict';

// ============================================================
// S.A.V.I.A — MAIN PROCESS (composition root)
// Moduli: src/main/{notify,telemetry,knowledge,memory,system,
//          terminal,fs-index,explorer,agent-tools,reminders,agent-store}
// ============================================================

const { app, BrowserWindow, ipcMain, protocol, Tray, Menu, globalShortcut, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs');

const callServer = require('./src/call-server');
const proximity = require('./src/proximity-engine');
const mcpServers = require('./src/mcp-servers');
const notify = require('./src/main/notify');
const telemetry = require('./src/main/telemetry');
const knowledge = require('./src/main/knowledge');
const memory = require('./src/main/memory');
const systemControl = require('./src/main/system');
const terminal = require('./src/main/terminal');
const fsIndex = require('./src/main/fs-index');
const explorer = require('./src/main/explorer');
const agentTools = require('./src/main/agent-tools');
const reminders = require('./src/main/reminders');
const agentStore = require('./src/main/agent-store');

let mainWindow;
let isQuitting = false;
let tray = null;
let trayHintShown = false;

// ============================================================
// APP CONFIG (savia-config.json in userData)
// ============================================================
const CONFIG_FILE = path.join(app.getPath('userData'), 'savia-config.json');
let appConfig = {};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) appConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (e) { /* ignore */ }
  return appConfig;
}

function saveConfig(patch) {
  appConfig = { ...loadConfig(), ...patch };
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2), 'utf-8'); } catch (e) { /* ignore */ }
  return appConfig;
}

ipcMain.handle('config-get', () => loadConfig());
ipcMain.handle('config-set', (event, patch) => saveConfig(patch || {}));

// ============================================================
// TOOL WINDOWS — ogni strumento vive in una propria finestra,
// il centro di comando resta visibile
// ============================================================
const toolWindows = new Map(); // page → BrowserWindow

function sendToAll(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win && !win.isDestroyed()) {
      try { win.webContents.send(channel, payload); } catch (e) { /* ignore */ }
    }
  }
}

const TOOL_PAGES = new Set([
  'terminal.html', 'calendar.html', 'objectives.html', 'imagine.html',
  'particles.html', 'globe.html', 'knowledge.html', 'youtube.html',
  'hotline.html', 'proximity.html', 'face-training.html', 'mcp.html',
  'news.html', 'editor.html', 'stats.html'
]);

// ============================================================
// SERVICE: CALL HOTLINE (Twilio → tunnel → STT → AI → TTS)
// ============================================================
const hotlineCacheDir = path.join(app.getPath('userData'), 'hf-cache');

callServer.setConfig({
  port: (loadConfig().hotlinePort) || 8090,
  sttCacheDir: hotlineCacheDir,
  sttModel: loadConfig().hotlineSttModel || 'Xenova/whisper-tiny'
});
callServer.setEventSink((type, payload) => {
  sendToAll('call-event', { type, payload });
});

function hotlineApplyConfig() {
  const cfg = loadConfig();
  callServer.setConfig({
    port: cfg.hotlinePort || 8090,
    sttModel: cfg.hotlineSttModel || 'Xenova/whisper-tiny',
    elevenLabsKey: cfg.elevenLabsKey || '',
    elevenLabsVoiceId: cfg.hotlineVoiceId || '',
    twilioAccountSid: cfg.twilioAccountSid || '',
    twilioAuthToken: cfg.twilioAuthToken || '',
    twilioPhoneNumber: cfg.twilioPhoneNumber || ''
  });
}

ipcMain.handle('call-hotline-start', async () => {
  hotlineApplyConfig();
  const startRes = await callServer.start().catch(e => ({ ok: false, error: e.message }));
  if (!startRes.ok) return { ...startRes, tunnelStatus: callServer.status().tunnelStatus };

  const url = await callServer.startTunnel();
  let webhook = { ok: false, reason: 'no-tunnel' };
  if (url) webhook = await callServer.updateTwilioWebhook();
  return { ok: true, ...callServer.status(), webhook };
});

ipcMain.handle('call-hotline-stop', () => {
  callServer.stop();
  return callServer.status();
});

ipcMain.handle('call-hotline-status', () => callServer.status());

ipcMain.handle('call-hotline-config', (event, patch) => {
  saveConfig(patch || {});
  hotlineApplyConfig();
  return callServer.status();
});

ipcMain.handle('call-hotline-brain', (event, brain) => {
  callServer.setConfig({
    brainHost: (brain && brain.aiHost) || 'http://localhost:11434',
    brainModel: (brain && brain.model) || 'mistral',
    brainSystemPrompt: (brain && brain.systemPrompt) || null
  });
  return callServer.status();
});

ipcMain.handle('call-hotline-stt', async (event, model) => {
  if (model) callServer.setConfig({ sttModel: model });
  const r = await callServer.ensureSTT();
  return { ok: r.ok, ...callServer.status() };
});

// ============================================================
// STT LOCALE (Whisper via transformers.js) — fallback vocale
// ============================================================
ipcMain.handle('stt-load', async () => {
  const r = await callServer.ensureSTT();
  return { ok: r.ok, ready: callServer.status().sttReady, error: r.error };
});

ipcMain.handle('stt-transcribe', async (event, pcm16) => {
  try {
    const text = await callServer.transcribe(pcm16);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

// ============================================================
// SERVICE: PROXIMITY (BLE RSSI + ADB auto-unlock)
// ============================================================
function proximityApplyConfig() {
  const cfg = loadConfig();
  proximity.setConfig({
    pythonPath: cfg.proximityPythonPath || '',
    adbPath: cfg.proximityAdbPath || '',
    threshold: typeof cfg.proximityThreshold === 'number' ? cfg.proximityThreshold : -65,
    cooldownSec: cfg.proximityCooldownSec || 60,
    checkInterval: cfg.proximityCheckInterval || 3000,
    devices: cfg.proximityDevices || []
  });
}

proximity.setConfig({ pythonPath: '', adbPath: '' });
proximity.setEventSink((type, payload) => {
  sendToAll('proximity-event', { type, payload });
});

ipcMain.handle('proximity-status', async () => proximity.fullStatus());
ipcMain.handle('proximity-start', async () => proximity.start());
ipcMain.handle('proximity-stop', () => proximity.stop());
ipcMain.handle('proximity-config', (event, patch) => {
  if (patch) saveConfig(patch);
  proximityApplyConfig();
  return proximity.status();
});
ipcMain.handle('proximity-add-device', (event, dev) => {
  const res = proximity.addDevice(dev);
  proximity.setConfig({ devices: res.devices });
  saveConfig({ proximityDevices: res.devices });
  return proximity.status();
});
ipcMain.handle('proximity-remove-device', (event, mac) => {
  const res = proximity.removeDevice(mac);
  proximity.setConfig({ devices: res.devices });
  saveConfig({ proximityDevices: res.devices });
  return proximity.status();
});
ipcMain.handle('proximity-pair', (event, { hostPort, code }) => proximity.pair(hostPort, code));
ipcMain.handle('proximity-connect', (event, hostPort) => proximity.connect(hostPort));
ipcMain.handle('proximity-test-adb', (event, hostPort) => proximity.testAdb(hostPort));
ipcMain.handle('proximity-unlock-now', (event, mac) => proximity.unlockNow(mac));
ipcMain.handle('proximity-install-deps', () => proximity.installDeps());
ipcMain.handle('proximity-install-adb', () => proximity.downloadPlatformTools());

// ============================================================
// SERVICE: MCP SERVERS (Model Context Protocol → Any App)
// ============================================================
mcpServers.setConfig(loadConfig().mcpServers || []);
mcpServers.setEventSink((type, payload) => {
  sendToAll('mcp-event', { type, payload });
});

const mcpConfigSnapshot = () => mcpServers.getServers().map(s => ({
  id: s.id, name: s.name, transport: s.transport, command: s.command,
  args: s.args, cwd: s.cwd, env: s.env, url: s.url, headers: s.headers, enabled: s.enabled
}));

ipcMain.handle('mcp-status', () => ({
  servers: mcpServers.getServers(),
  tools: mcpServers.listTools()
}));

ipcMain.handle('mcp-save', async (event, input) => {
  const res = mcpServers.upsertServer(input || {});
  if (!res.ok) return res;
  saveConfig({ mcpServers: mcpConfigSnapshot() });
  if (res.server.enabled) return { ...res, start: await mcpServers.startServer(res.server.id) };
  return { ...res, start: { ok: true, status: 'off' } };
});

ipcMain.handle('mcp-remove', async (event, id) => {
  const res = await mcpServers.removeServer(id);
  saveConfig({ mcpServers: mcpConfigSnapshot() });
  return res;
});

const mcpAll = async r => r.ok
  ? { ok: true, servers: mcpServers.getServers(), tools: mcpServers.listTools() }
  : r;

ipcMain.handle('mcp-start', async (event, id) => mcpAll(await mcpServers.startServer(id)));
ipcMain.handle('mcp-stop', async (event, id) => mcpAll(await mcpServers.stopServer(id)));
ipcMain.handle('mcp-list-tools', () => ({ tools: mcpServers.listTools() }));
ipcMain.handle('mcp-call-tool', async (event, opts) => mcpServers.callTool(opts || {}));

// ============================================================
// WINDOW CONTROLS
// ============================================================
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});
ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  // La finestra principale si nasconde nella tray, gli strumenti si chiudono
  if (win === mainWindow) {
    if (tray) mainWindow.hide();
    else mainWindow.close();
  } else {
    win.close();
  }
});

// Power-on vocale: chiamando "Hey SAVIA" la finestra (nascosta nella tray)
// viene mostrata e portata in primo piano.
ipcMain.on('window-reveal', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
});

// ============================================================
// WINDOW CREATION
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    icon: path.join(__dirname, 'savia.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      backgroundThrottling: false
    },
    backgroundColor: '#070913',
    show: false
  });

  // Auto-start (flag --savia-hidden): parte già sbloccata su index.html,
  // in tray e in ascolto vocale — "Hey SAVIA" apre subito la dashboard.
  const hiddenStart = process.argv.includes('--savia-hidden');
  mainWindow.loadURL(hiddenStart ? 'savia://src/index.html' : 'savia://src/login.html');

  mainWindow.once('ready-to-show', () => {
    if (!hiddenStart) mainWindow.show();
    telemetry.startRealTelemetry();
    if (hiddenStart) {
      notify.sendWinToast('S.A.V.I.A', 'S.A.V.I.A è in ascolto nella tray — chiamala "Hey SAVIA" o premi Ctrl+Alt+S.', 'normal');
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
      if (!trayHintShown) {
        trayHintShown = true;
        notify.sendWinToast('S.A.V.I.A', 'Minimizzata nella tray — premi Ctrl+Alt+S o chiamala "Hey SAVIA" per riaprire.', 'normal');
      }
    }
  });

  mainWindow.on('closed', () => {
    stopAllServices();
    mainWindow = null;
  });
}

const MIME = {
  '.html':'text/html', '.js':'application/javascript', '.json':'application/json',
  '.bin':'application/octet-stream', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.css':'text/css', '.ico':'image/x-icon',
  '.woff':'font/woff', '.woff2':'font/woff2'
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'savia', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

// ============================================================
// TOOL WINDOW OPENING
// ============================================================
ipcMain.handle('open-tool-page', (event, page) => {
  page = path.basename(String(page || ''));

  // Centro di comando → focus della finestra principale (revive dalla tray)
  if (page === 'index.html' || page === 'login.html') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const win = mainWindow; // shadow local
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    return { ok: true, mode: 'focus-main' };
  }

  if (!TOOL_PAGES.has(page)) return { ok: false, mode: 'none' };

  const existing = toolWindows.get(page);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { ok: true, mode: 'focus-existing' };
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    icon: path.join(__dirname, 'savia.png'),
    backgroundColor: '#070913',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  win.loadURL('savia://src/' + page);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => toolWindows.delete(page));
  toolWindows.set(page, win);
  return { ok: true, mode: 'new-window' };
});

// ============================================================
// LOGIN & EDITOR IPC
// ============================================================
ipcMain.on('login-success', () => {
  if (mainWindow) mainWindow.loadURL('savia://src/index.html');
});

// Spegnimento richiesto dall'utente (chat/vocale) → esce davvero, non in tray
ipcMain.handle('app-quit', () => {
  isQuitting = true;
  app.quit();
  return { ok: true };
});

ipcMain.handle('open-editor', (event, filePath) => {
  openEditorWindow(filePath);
  return { success: true };
});

function openEditorWindow(filePath) {
  const page = 'editor.html';
  if (!TOOL_PAGES.has(page)) return false;
  const url = filePath ? page + '?file=' + encodeURIComponent(filePath) : page;
  const existing = toolWindows.get(page);
  if (existing && !existing.isDestroyed()) {
    if (filePath) {
      existing.loadURL('savia://src/' + url);
      existing.once('ready-to-show', () => { existing.show(); existing.focus(); });
    } else {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
    }
    return true;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    icon: path.join(__dirname, 'savia.png'),
    backgroundColor: '#070913',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });
  win.loadURL('savia://src/' + url);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => toolWindows.delete(page));
  toolWindows.set(page, win);
  return true;
}

ipcMain.handle('read-file', (event, filePath) => {
  try {
    return { success: true, content: fs.readFileSync(filePath, 'utf-8') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('write-file', (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================
// TRAY & GLOBAL SHORTCUT (summon S.A.V.I.A)
// ============================================================
function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (mainWindow.isVisible()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

// Tray icon fallback (base64 PNG a 16x16 cyan reactor)
const TRAY_ICON_FALLBACK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAQElEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFAABJLAH+H/7yxQAAAABJRU5ErkJggg==';

function toggleAutoStart() {
  const current = app.getLoginItemSettings();
  const next = !current.openAtLogin;
  app.setLoginItemSettings({
    openAtLogin: next,
    args: ['--savia-hidden']
  });
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu());
  notify.sendWinToast('S.A.V.I.A', next
    ? 'Avvio con Windows ATTIVO: S.A.V.I.A partirà in background nella tray.'
    : 'Avvio con Windows disattivato.', 'normal');
}

function buildTrayMenu() {
  const autoStartOn = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'Mostra / Nascondi S.A.V.I.A', click: toggleMainWindow },
    { type: 'separator' },
    { label: 'Avvia con Windows', type: 'checkbox', checked: autoStartOn, click: toggleAutoStart },
    { type: 'separator' },
    { label: 'Esci', click: () => { isQuitting = true; app.quit(); } }
  ]);
}

function setupTray() {
  try {
    const iconPath = path.join(__dirname, 'savia.png');
    let icon;
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
    } else {
      icon = nativeImage.createFromDataURL(TRAY_ICON_FALLBACK);
    }
    if (icon.isEmpty()) icon = nativeImage.createFromDataURL(TRAY_ICON_FALLBACK);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('S.A.V.I.A — Cognitive Interface');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', toggleMainWindow);
  } catch (e) {
    // tray non disponibile — app continua normalmente
  }
}

function registerGlobalShortcut() {
  try {
    globalShortcut.register('CommandOrControl+Alt+S', () => toggleMainWindow());
  } catch (e) { /* ignore */ }
}

// ============================================================
// LIFECYCLE
// ============================================================
function stopAllServices() {
  telemetry.stopTelemetry();
  fsIndex.stop();
  terminal.stop();
}

function saveAllOnQuit() {
  try { memory.saveMemory(memory.loadMemory()); } catch (e) { /* ignore */ }
  try { agentStore.persist(); } catch (e) { /* ignore */ }
}

app.whenReady().then(() => {
  protocol.handle('savia', (request) => {
    const urlPath = request.url.slice('savia://'.length).replace(/\?.*$/, '');
    const filePath = path.join(__dirname, urlPath);
    try {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' }
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });

  // Wiring moduli
  const ctx = { getMainWindow: () => mainWindow, sendToAll };
  notify.init(ctx);

  // Permessi microfono/audio sempre garantiti: il wake word ("Hey SAVIA")
  // e lo STT locale (getUserMedia + SpeechRecognition) devono poter accedere
  // al microfono anche a finestra nascosta nella tray.
  try {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(true);
    });
    session.defaultSession.setPermissionCheckHandler(() => true);
    session.defaultSession.setDevicePermissionHandler((details) => {
      return true;
    });
  } catch (e) { /* ignore */ }

  telemetry.init(ctx);
  reminders.init(ctx);
  knowledge.init();
  memory.init();
  systemControl.init();
  terminal.init(ctx);
  fsIndex.init(ctx);
  explorer.init(ctx);
  agentTools.init();

  // Cross-window terminal voice commands: any window can send, all windows receive
  ipcMain.on('terminal-voice-command', (event, payload) => {
    sendToAll('terminal-voice-command', payload);
  });

  // Cross-page voice commands: forward from any page to index.html for processing
  ipcMain.on('voice-from-page', (event, payload) => {
    sendToAll('voice-from-page', payload);
  });

  createWindow();
  setupTray();
  registerGlobalShortcut();
  telemetry.refreshBattery();
  setInterval(telemetry.refreshBattery, 15000);

  // Autostart hotline se abilitata in config
  if (loadConfig().hotlineEnabled) {
    hotlineApplyConfig();
    setTimeout(() => {
      callServer.start().catch(() => {});
      callServer.startTunnel().then(() => callServer.updateTwilioWebhook());
    }, 3000);
  }

  // Autostart proximity se abilitata in config
  if (loadConfig().proximityEnabled) {
    proximityApplyConfig();
    setTimeout(() => { proximity.start(); }, 4000);
  }

  // Autostart server MCP abilitati
  mcpServers.setConfig(loadConfig().mcpServers || []);
  setTimeout(() => { mcpServers.startAll(); }, 2500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  callServer.stop();
  proximity.stop();
  mcpServers.stopAll();
  for (const win of toolWindows.values()) {
    try { win.destroy(); } catch (e) { /* ignore */ }
  }
  toolWindows.clear();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  saveAllOnQuit();
  stopAllServices();
});

// Periodic auto-save every 60 seconds
setInterval(() => {
  try {
    const mem = memory.loadMemory();
    if (mem) memory.saveMemory(mem);
  } catch (e) { /* ignore */ }
}, 60000);

// ============================================================
// EXPORTS — logica pura accessibile ai test (main.test.js)
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseDueDate: reminders.parseDueDate,
    chunkText: knowledge.chunkText,
    cosineSimilarity: knowledge.cosineSimilarity,
    escapeSingle: notify.escapeSingle,
    dedupKey: notify.dedupKey,
    isDuplicate: notify.isDuplicate,
    getCpuUsage: telemetry.getCpuUsage,
    fileSignature: knowledge.fileSignature,
    scanForProjects: memory.scanForProjects,
    getFolderSize: memory.getFolderSize,
    KB_CHUNK_SIZE: knowledge.KB_CHUNK_SIZE,
    KB_CHUNK_OVERLAP: knowledge.KB_CHUNK_OVERLAP,
    NOTIF_COOLDOWN_MS: notify.NOTIF_COOLDOWN_MS,
    notificationDedup: notify.NOTIF_DEDUP
  };
}