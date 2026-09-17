const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

  // Power-on vocale: risveglia la finestra principale dalla tray
  revealWindow: () => ipcRenderer.send('window-reveal'),

  // STT locale (Whisper via main process) — fallback al cloud Speech API
  sttLoad: () => ipcRenderer.invoke('stt-load'),
  sttTranscribe: (pcm16) => ipcRenderer.invoke('stt-transcribe', pcm16),

  // Tool windows: apri pagina tool in nuova finestra (index.html → focus main)
  openToolPage: (page) => ipcRenderer.invoke('open-tool-page', page),

  // Spegnimento completo di S.A.V.I.A (chiesto da chat/vocale)
  quitApp: () => ipcRenderer.invoke('app-quit'),

  // Real-time telemetry receiver (push from main)
  onTelemetryUpdate: (callback) => {
    ipcRenderer.on('telemetry-update', (event, data) => callback(data));
  },

  // Filesystem events receiver (push from main)
  onFsEvent: (callback) => {
    ipcRenderer.on('fs-event', (event, data) => callback(data));
  },

  // Vector Indexing service
  fsIndexStart: (dirPath) => ipcRenderer.invoke('fs-index-start', dirPath),
  fsIndexStop: () => ipcRenderer.invoke('fs-index-stop'),
  fsIndexStatus: () => ipcRenderer.invoke('fs-index-status'),

  // System info query
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // Home directory
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),

  // Open in Explorer
  openInExplorer: (itemPath) => ipcRenderer.invoke('open-in-explorer', itemPath),

  // ============================================================
  // COMMAND CENTER — FILE EXPLORER
  // ============================================================
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
  deleteItem: (itemPath) => ipcRenderer.invoke('delete-item', itemPath),
  renameItem: (oldPath, newName) => ipcRenderer.invoke('rename-item', oldPath, newName),
  selectDirectoryDialog: () => ipcRenderer.invoke('select-directory-dialog'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  getDrives: () => ipcRenderer.invoke('get-drives'),

  // ============================================================
  // COMMAND CENTER — TERMINAL (PTY-based)
  // ============================================================
  terminalPtyCreate: (opts) => ipcRenderer.invoke('terminal-pty-create', opts),
  terminalPtyWrite: (ptyId, data) => ipcRenderer.invoke('terminal-pty-write', { ptyId, data }),
  terminalPtyResize: (ptyId, cols, rows) => ipcRenderer.invoke('terminal-pty-resize', { ptyId, cols, rows }),
  terminalPtyKill: (ptyId) => ipcRenderer.invoke('terminal-pty-kill', { ptyId }),
  terminalPtyCwd: (ptyId) => ipcRenderer.invoke('terminal-pty-cwd', { ptyId }),
  onTerminalPtyData: (callback) => {
    ipcRenderer.on('terminal-pty-data', (event, data) => callback(data));
  },
  removeTerminalPtyListeners: () => {
    ipcRenderer.removeAllListeners('terminal-pty-data');
  },
  // Cross-window terminal voice commands
  sendTerminalVoiceCommand: (payload) => ipcRenderer.send('terminal-voice-command', payload),
  onTerminalVoiceCommand: (callback) => {
    ipcRenderer.on('terminal-voice-command', (event, data) => callback(data));
  },
  // Cross-page voice commands: any page → main → index.html
  sendVoiceFromPage: (payload) => ipcRenderer.send('voice-from-page', payload),
  onVoiceFromPage: (callback) => {
    ipcRenderer.on('voice-from-page', (event, data) => callback(data));
  },
  // Legacy (kept for backward compat)
  terminalSetCwd: (newCwd) => ipcRenderer.invoke('terminal-set-cwd', newCwd),
  terminalGetCwd: () => ipcRenderer.invoke('terminal-get-cwd'),
  terminalExecute: (command) => ipcRenderer.invoke('terminal-execute', command),
  terminalStdin: (procId, data) => ipcRenderer.invoke('terminal-stdin', { procId, data }),
  terminalKill: (procId) => ipcRenderer.invoke('terminal-kill', procId),
  onTerminalOutput: (callback) => {
    ipcRenderer.on('terminal-output', (event, data) => callback(data));
  },
  removeTerminalOutputListeners: () => {
    ipcRenderer.removeAllListeners('terminal-output');
  },

  // ============================================================
  // MEMORY CORE (Personal Context & Memory)
  // ============================================================
  memoryLoad: () => ipcRenderer.invoke('memory-load'),
  memorySave: (data) => ipcRenderer.invoke('memory-save', data),
  memoryScanProjects: (basePath) => ipcRenderer.invoke('memory-scan-projects', basePath),
  memoryAddConversation: (conversation) => ipcRenderer.invoke('memory-add-conversation', conversation),
  memoryDailySummary: (summaryData) => ipcRenderer.invoke('memory-daily-summary', summaryData),

  // ============================================================
  // SYSTEM CONTROL (Computer-wide operations)
  // ============================================================
  systemOpenApp: (opts) => ipcRenderer.invoke('system-open-app', opts),
  systemCloseApp: (processName) => ipcRenderer.invoke('system-close-app', processName),
  systemMoveFile: (opts) => ipcRenderer.invoke('system-move-file', opts),
  systemSearchFiles: (opts) => ipcRenderer.invoke('system-search-files', opts),
  systemVolume: (opts) => ipcRenderer.invoke('system-volume', opts),
  systemBrightness: (opts) => ipcRenderer.invoke('system-brightness', opts),
  systemListProcesses: () => ipcRenderer.invoke('system-list-processes'),
  systemMedia: (opts) => ipcRenderer.invoke('system-media', opts),
  systemScreenshot: () => ipcRenderer.invoke('system-screenshot'),
  systemOpenUrl: (url) => ipcRenderer.invoke('system-open-url', url),
  // ── A: Full Access ────────────────────────────────────────────
  systemIsAdmin: () => ipcRenderer.invoke('system-is-admin'),
  systemSetAccessMode: (mode) => ipcRenderer.invoke('system-set-access-mode', mode),
  systemExec: (opts) => ipcRenderer.invoke('system-exec', opts),
  systemFsRead: (filePath) => ipcRenderer.invoke('system-fs-read', filePath),
  systemFsWrite: (opts) => ipcRenderer.invoke('system-fs-write', opts),
  systemFsDelete: (targetPath) => ipcRenderer.invoke('system-fs-delete', targetPath),
  systemFsList: (dirPath) => ipcRenderer.invoke('system-fs-list', dirPath),
  systemRegistry: (opts) => ipcRenderer.invoke('system-registry', opts),
  systemService: (opts) => ipcRenderer.invoke('system-service', opts),
  systemAuditLog: () => ipcRenderer.invoke('system-audit-log'),

  // Extended stats (async, non-blocking)
  getNetworkThroughput: () => ipcRenderer.invoke('get-network-throughput'),
  getGpuUsage: () => ipcRenderer.invoke('get-gpu-usage'),
  getDiskIO: () => ipcRenderer.invoke('get-disk-io'),

  // ============================================================
  // APP CONFIG (savia-config.json — API keys, model, settings)
  // ============================================================
  configGet: () => ipcRenderer.invoke('config-get'),
  configSet: (patch) => ipcRenderer.invoke('config-set', patch),

  // ============================================================
  // MCP SERVERS (Model Context Protocol → Any App)
  // ============================================================
  mcpStatus: () => ipcRenderer.invoke('mcp-status'),
  mcpSave: (server) => ipcRenderer.invoke('mcp-save', server),
  mcpRemove: (id) => ipcRenderer.invoke('mcp-remove', id),
  mcpStart: (id) => ipcRenderer.invoke('mcp-start', id),
  mcpStop: (id) => ipcRenderer.invoke('mcp-stop', id),
  mcpListTools: () => ipcRenderer.invoke('mcp-list-tools'),
  mcpCallTool: (opts) => ipcRenderer.invoke('mcp-call-tool', opts),
  onMcpEvent: (callback) => {
    ipcRenderer.on('mcp-event', (event, data) => callback(data));
  },

  // ============================================================
  // REMINDER / CALENDAR FIRED (push from main)
  // ============================================================
  onReminderFired: (callback) => {
    ipcRenderer.on('reminder-fired', (event, data) => callback(data));
  },

  // ============================================================
  // EXTENDED TELEMETRY (Dashboard)
  // ============================================================
  getExtendedTelemetry: () => ipcRenderer.invoke('get-extended-telemetry'),
  getProcessList: () => ipcRenderer.invoke('get-process-list'),

  // ============================================================
  // AGENT TOOLS (Calendar, Todo, Reminder)
  // ============================================================
  agentTool: (opts) => ipcRenderer.invoke('agent-tool', opts),
  calendarSync: (events) => ipcRenderer.invoke('calendar-sync', events),  // merge UI calendar events into scheduler store

  // ============================================================
  // KNOWLEDGE BASE (RAG)
  // ============================================================
  kbIndexFile: (filePath) => ipcRenderer.invoke('kb-index-file', filePath),
  kbIndexDirectory: (dirPath) => ipcRenderer.invoke('kb-index-directory', dirPath),
  kbSearch: (opts) => ipcRenderer.invoke('kb-search', opts),
  kbList: () => ipcRenderer.invoke('kb-list'),
  kbDelete: (docId) => ipcRenderer.invoke('kb-delete', docId),
  kbStatus: () => ipcRenderer.invoke('kb-status'),

  // ============================================================
  // FILE PREVIEW (Read first lines for truthful scanner)
  // ============================================================
  readFilePreview: (filePath) => ipcRenderer.invoke('read-file-preview', filePath),

  // ============================================================
  // NOTIFICATIONS (Native OS + in-app)
  // ============================================================
  sendNotification: (opts) => ipcRenderer.invoke('send-notification', opts),

  // ============================================================
  // CALL HOTLINE (Twilio + tunnel + STT/AI/TTS)
  // ============================================================
  callHotlineStart: () => ipcRenderer.invoke('call-hotline-start'),
  callHotlineStop: () => ipcRenderer.invoke('call-hotline-stop'),
  callHotlineStatus: () => ipcRenderer.invoke('call-hotline-status'),
  callHotlineConfig: (patch) => ipcRenderer.invoke('call-hotline-config', patch),
  callHotlineBrain: (brain) => ipcRenderer.invoke('call-hotline-brain', brain),
  callHotlineStt: (model) => ipcRenderer.invoke('call-hotline-stt', model),
  onCallEvent: (callback) => {
    ipcRenderer.on('call-event', (event, data) => callback(data));
  },

  // ============================================================
  // PROXIMITY (BLE RSSI + ADB auto-unlock)
  // ============================================================
  proximityStatus: () => ipcRenderer.invoke('proximity-status'),
  proximityStart: () => ipcRenderer.invoke('proximity-start'),
  proximityStop: () => ipcRenderer.invoke('proximity-stop'),
  proximityConfig: (patch) => ipcRenderer.invoke('proximity-config', patch),
  proximityAddDevice: (dev) => ipcRenderer.invoke('proximity-add-device', dev),
  proximityRemoveDevice: (mac) => ipcRenderer.invoke('proximity-remove-device', mac),
  proximityPair: (hostPort, code) => ipcRenderer.invoke('proximity-pair', { hostPort, code }),
  proximityConnect: (hostPort) => ipcRenderer.invoke('proximity-connect', hostPort),
  proximityTestAdb: (hostPort) => ipcRenderer.invoke('proximity-test-adb', hostPort),
  proximityUnlockNow: (mac) => ipcRenderer.invoke('proximity-unlock-now', mac),
  proximityInstallDeps: () => ipcRenderer.invoke('proximity-install-deps'),
  proximityInstallAdb: () => ipcRenderer.invoke('proximity-install-adb'),
  onProximityEvent: (callback) => {
    ipcRenderer.on('proximity-event', (event, data) => callback(data));
  },

  // ============================================================
  // LOGIN & EDITOR
  // ============================================================
  loginSuccess: () => ipcRenderer.send('login-success'),
  openEditor: (filePath) => ipcRenderer.invoke('open-editor', filePath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (opts) => ipcRenderer.invoke('write-file', opts),
  onLoadFile: (callback) => {
    ipcRenderer.on('load-file', (event, filePath) => callback(filePath));
  }
});
