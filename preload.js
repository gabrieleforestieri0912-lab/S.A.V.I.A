const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

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
  // COMMAND CENTER — TERMINAL
  // ============================================================
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

  // ============================================================
  // APP CONFIG (savia-config.json — API keys, model, settings)
  // ============================================================
  configGet: () => ipcRenderer.invoke('config-get'),
  configSet: (patch) => ipcRenderer.invoke('config-set', patch),

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
