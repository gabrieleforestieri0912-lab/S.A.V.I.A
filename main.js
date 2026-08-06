const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, Notification, protocol, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

let mainWindow;
let isQuitting = false;
let tray = null;
let trayHintShown = false;

// ============================================================
// SYSTEM SERVICES STATE
// ============================================================
let fsWatcherHandle = null;
let fsWatchedPath = null;
let fsIndexedFiles = [];
let telemetryInterval = null;
let lastBattery = { present: false };

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
      webSecurity: false
    },
    backgroundColor: '#070913',
    show: false
  });

  mainWindow.loadURL('savia://src/login.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    startRealTelemetry();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
      if (!trayHintShown) {
        trayHintShown = true;
        sendWinToast('S.A.V.I.A', 'Minimizzata nella tray — premi Ctrl+Alt+S per riaprire.', 'normal');
      }
    }
  });

  mainWindow.on('closed', () => {
    stopAllServices();
    mainWindow = null;
  });
}

const MIME = {
  '.html':'text/html','.js':'application/javascript','.json':'application/json',
  '.bin':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg',
  '.svg':'image/svg+xml','.css':'text/css','.ico':'image/x-icon',
  '.woff':'font/woff','.woff2':'font/woff2'
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'savia', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

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
  createWindow();
  setupTray();
  registerGlobalShortcut();
  refreshBattery();
  setInterval(refreshBattery, 15000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================
// WINDOW CONTROLS
// ============================================================
ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => {
  if (mainWindow) {
    if (tray) mainWindow.hide();
    else mainWindow.close();
  }
});

// ============================================================
// LOGIN & EDITOR IPC HANDLERS
// ============================================================
ipcMain.on('login-success', () => {
  if (mainWindow) {
    mainWindow.loadURL('savia://src/index.html');
  }
});

ipcMain.handle('open-editor', (event, filePath) => {
  if (mainWindow) {
    var target = 'index.html?view=editor';
    if (filePath) target += '&file=' + encodeURIComponent(filePath);
    mainWindow.loadURL('savia://src/' + target);
  }
  return { success: true };
});

ipcMain.handle('read-file', (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content };
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
// SERVICE: REAL-TIME OS TELEMETRY
// ============================================================
function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (let type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

let lastCpuMeasure = getCpuUsage();

function startRealTelemetry() {
  telemetryInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // CPU usage delta calculation
    const current = getCpuUsage();
    const idleDiff = current.idle - lastCpuMeasure.idle;
    const totalDiff = current.total - lastCpuMeasure.total;
    const cpuPercent = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
    lastCpuMeasure = current;

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memGB = (usedMem / (1024 ** 3)).toFixed(2);
    const totalGB = (totalMem / (1024 ** 3)).toFixed(1);
    const memPercent = Math.round((usedMem / totalMem) * 100);

    // CPU frequency & load average
    const cpus = os.cpus();
    const cpuFreqGHz = cpus.length > 0 ? (cpus[0].speed / 1000).toFixed(2) : '?.??';
    const loadAvg = os.loadavg()[0].toFixed(2); // 1-min load average

    // Uptime
    const uptimeSecs = Math.round(os.uptime());
    const uptimeHrs = Math.floor(uptimeSecs / 3600);
    const uptimeMins = Math.floor((uptimeSecs % 3600) / 60);

    const payload = {
      cpu: cpuPercent,
      memGB: parseFloat(memGB),
      memPercent,
      totalGB: parseFloat(totalGB),
      cpuFreqGHz,
      loadAvg,
      uptimeHrs,
      uptimeMins,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      battery: lastBattery
    };

    mainWindow.webContents.send('telemetry-update', payload);
  }, 2000);
}

// ============================================================
// SERVICE: VECTOR FILE INDEXING (fs watcher)
// ============================================================
ipcMain.handle('fs-index-start', (event, dirPath) => {
  // Stop previous watcher if any
  if (fsWatcherHandle) {
    fsWatcherHandle.close();
    fsWatcherHandle = null;
  }

  const targetPath = dirPath || path.join(os.homedir(), 'Documents', 'Progetti');

  if (!fs.existsSync(targetPath)) {
    return { success: false, error: `Path not found: ${targetPath}` };
  }

  fsWatchedPath = targetPath;
  fsIndexedFiles = [];

  // Initial recursive scan
  function scanDir(dir, depth = 0) {
    if (depth > 4) return; // Safety limit
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach(entry => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          fsIndexedFiles.push({
            name: entry.name,
            path: fullPath,
            ext: path.extname(entry.name).toLowerCase(),
            size: fs.statSync(fullPath).size
          });
        }
      });
    } catch (e) { /* permission errors ignored */ }
  }

  scanDir(targetPath);

  // Start live watcher
  try {
    fsWatcherHandle = fs.watch(targetPath, { recursive: true }, (eventType, filename) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (filename) {
        mainWindow.webContents.send('fs-event', {
          type: eventType,
          file: filename,
          path: path.join(targetPath, filename),
          time: new Date().toISOString()
        });
      }
    });
  } catch(e) {
    // recursive watch not supported on all systems, fall back gracefully
  }

  return {
    success: true,
    watchedPath: targetPath,
    indexedCount: fsIndexedFiles.length,
    summary: {
      total: fsIndexedFiles.length,
      byExt: fsIndexedFiles.reduce((acc, f) => {
        acc[f.ext || 'no-ext'] = (acc[f.ext || 'no-ext'] || 0) + 1;
        return acc;
      }, {})
    }
  };
});

ipcMain.handle('fs-index-stop', () => {
  if (fsWatcherHandle) {
    fsWatcherHandle.close();
    fsWatcherHandle = null;
  }
  return { success: true, indexed: fsIndexedFiles.length };
});

ipcMain.handle('fs-index-status', () => {
  return {
    active: !!fsWatcherHandle,
    watchedPath: fsWatchedPath,
    indexedCount: fsIndexedFiles.length
  };
});

// ============================================================
// SERVICE: SYSTEM INFO
// ============================================================
ipcMain.handle('get-system-info', () => {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown',
    cpuCores: cpus.length,
    totalMemGB: (os.totalmem() / (1024 ** 3)).toFixed(2),
    nodeVersion: process.version,
    electronVersion: process.versions.electron,
    uptime: os.uptime(),
    homedir: os.homedir(),
    username: os.userInfo().username
  };
});

// ============================================================
// SERVICE: COMMAND CENTER — FILE EXPLORER
// ============================================================

ipcMain.handle('list-directory', async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = entries
      .filter(entry => !entry.name.startsWith('.'))
      .map(entry => {
        const fullPath = path.join(dirPath, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: entry.isFile() ? stat.size : 0,
            modifiedTime: stat.mtimeMs
          };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);

    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return { success: true, items, path: dirPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-item', async (event, itemPath) => {
  try {
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      fs.rmSync(itemPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(itemPath);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('rename-item', async (event, oldPath, newName) => {
  try {
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);
    fs.renameSync(oldPath, newPath);
    return { success: true, newPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('select-directory-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  return { success: true, path: result.filePaths[0] };
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Codice', extensions: ['js', 'ts', 'html', 'css', 'py', 'json', 'c', 'cpp', 'java', 'go', 'rs', 'md', 'yaml', 'yml', 'xml', 'sh', 'sql', 'rb', 'php', 'lua', 'r', 'swift', 'kt'] },
      { name: 'Tutti i file', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  return { success: true, path: result.filePaths[0] };
});

// ── Native OS Notifications ────────────────────────────────────
// Fires Windows native toast that persists in Action Center
// Works even when app is minimized, closed, or in background

const ACTIVE_NOTIFS = []; // prevent GC
const NOTIF_DEDUP = new Map(); // key → timestamp (ms)
const NOTIF_COOLDOWN_MS = 30000; // same notification suppressed for 30s

function dedupKey(title, body) {
  return `${title}||${body}`;
}

function isDuplicate(title, body) {
  const key = dedupKey(title, body);
  const last = NOTIF_DEDUP.get(key);
  const now = Date.now();
  if (last && (now - last) < NOTIF_COOLDOWN_MS) return true;
  NOTIF_DEDUP.set(key, now);
  // Housekeeping: purge entries older than 2x cooldown
  if (NOTIF_DEDUP.size > 50) {
    for (const [k, t] of NOTIF_DEDUP) {
      if ((now - t) > NOTIF_COOLDOWN_MS * 2) NOTIF_DEDUP.delete(k);
    }
  }
  return false;
}

function escapeSingle(s) { return s.replace(/'/g, "''"); }

async function sendWinToast(title, body, urgency) {
  if (isDuplicate(title, body)) return;

  // 1) Electron Notification (instant toast popup)
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title,
        body,
        urgency: urgency === 'critical' ? 'critical' : 'normal',
      });
      n.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show(); mainWindow.focus();
        }
      });
      n.on('close', () => { const i = ACTIVE_NOTIFS.indexOf(n); if (i>-1) ACTIVE_NOTIFS.splice(i,1); });
      ACTIVE_NOTIFS.push(n);
      n.show();
    }
  } catch (e) { /* electron notif failed */ }

  // 2) PowerShell Windows Toast → persists in Action Center even after app exits
  try {
    const appId = 'S.A.V.I.A';
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue';
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);
$textNodes = $template.GetElementsByTagName('text');
$textNodes.Item(0).AppendChild($template.CreateTextNode('${escapeSingle(title)}')) | Out-Null;
$textNodes.Item(1).AppendChild($template.CreateTextNode('${escapeSingle(body)}')) | Out-Null;
$toast = [Windows.UI.Notifications.ToastNotification]::new($template);
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${escapeSingle(appId)}').Show($toast);
`;
    const psPath = path.join(os.tmpdir(), `savia_notif_${Date.now()}.ps1`);
    fs.writeFileSync(psPath, psScript, 'utf-8');
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psPath
    ], { stdio: 'ignore', windowsHide: true, detached: true });
    child.unref();
    setTimeout(() => { try { fs.unlinkSync(psPath); } catch {} }, 5000);
  } catch (e) { /* pwsh notif failed */ }
}

ipcMain.handle('send-notification', (event, { title, body, urgency }) => {
  sendWinToast(title, body, urgency);
});

ipcMain.handle('get-home-dir', () => {
  return { path: os.homedir() };
});

ipcMain.handle('open-in-explorer', (event, itemPath) => {
  try {
    const { shell } = require('electron');
    shell.showItemInFolder(itemPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-drives', () => {
  const drives = [];
  if (process.platform === 'win32') {
    try {
      for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const drivePath = `${letter}:\\`;
        if (fs.existsSync(drivePath)) {
          drives.push({ name: drivePath, path: drivePath });
        }
      }
    } catch (e) { /* ignore */ }
  }
  return drives;
});

// ============================================================
// SERVICE: COMMAND CENTER — TERMINAL
// ============================================================

let terminalCwd = os.homedir();
let terminalProcesses = {};

ipcMain.handle('terminal-set-cwd', (event, newCwd) => {
  try {
    if (fs.existsSync(newCwd) && fs.statSync(newCwd).isDirectory()) {
      terminalCwd = path.resolve(newCwd);
      return { success: true, cwd: terminalCwd };
    }
    return { success: false, error: 'Directory not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('terminal-get-cwd', () => {
  return { cwd: terminalCwd };
});

ipcMain.handle('terminal-execute', (event, command) => {
  const procId = Date.now().toString() + Math.random().toString(36).substr(2, 5).toUpperCase();

  try {
    const proc = spawn(command, [], {
      cwd: terminalCwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, PATH: process.env.PATH || '', FORCE_COLOR: '1' }
    });

    terminalProcesses[procId] = proc;

    proc.stdout.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-output', {
          procId, type: 'stdout', data: data.toString()
        });
      }
    });

    proc.stderr.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-output', {
          procId, type: 'stderr', data: data.toString()
        });
      }
    });

    proc.on('close', (code) => {
      delete terminalProcesses[procId];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-output', {
          procId, type: 'exit', data: code
        });
      }
    });

    proc.on('error', (err) => {
      delete terminalProcesses[procId];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-output', {
          procId, type: 'error', data: err.message
        });
      }
    });

    return { success: true, procId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('terminal-kill', (event, procId) => {
  if (terminalProcesses[procId]) {
    try {
      terminalProcesses[procId].kill();
    } catch (e) { /* ignore */ }
    delete terminalProcesses[procId];
    return { success: true };
  }
  return { success: false, error: 'Process not found' };
});

ipcMain.handle('terminal-stdin', (event, { procId, data }) => {
  if (terminalProcesses[procId]) {
    try {
      terminalProcesses[procId].stdin.write(data + '\n');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'Process not found' };
});

// ============================================================
// SERVICE: MEMORY CORE (Personal Context & Memory)
// ============================================================

const MEMORY_FILE = path.join(app.getPath('userData'), 'savia-memory.json');

const DEFAULT_MEMORY = {
  conversations: [],
  projects: [],
  goals: { shortTerm: [], longTerm: [] },
  people: [],
  dailySummaries: [],
  lastDailySummaryDate: ''
};

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
      return { ...DEFAULT_MEMORY, ...JSON.parse(data) };
    }
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_MEMORY));
}

function saveMemory(data) {
  try {
    if (data.conversations && data.conversations.length > 50) {
      data.conversations = data.conversations.slice(-50);
    }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) { return false; }
}

ipcMain.handle('memory-load', () => {
  return loadMemory();
});

ipcMain.handle('memory-save', (event, data) => {
  return { success: saveMemory(data) };
});

function scanForProjects(dirPath, depth = 1) {
  if (depth > 3) return [];
  const projects = [];
  try {
    const entries = fs.existsSync(dirPath) ? fs.readdirSync(dirPath, { withFileTypes: true }) : [];
    
    // Check if this directory contains typical project identifier files/directories
    const hasGit = entries.some(e => e.isDirectory() && e.name === '.git');
    const hasPackageJson = entries.some(e => e.isFile() && e.name === 'package.json');
    const hasProjectFile = entries.some(e => e.isFile() && (
      e.name === 'Cargo.toml' || 
      e.name === 'go.mod' || 
      e.name === 'requirements.txt' || 
      e.name === 'composer.json' || 
      e.name.endsWith('.sln') || 
      e.name.endsWith('.csproj')
    ));
    
    // If it has direct project indicators, mark it as a project and don't go deeper
    if (hasGit || hasPackageJson || hasProjectFile) {
      return [dirPath];
    }
    
    const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules');
    
    // Scan subdirectories
    for (const subdir of subdirs) {
      const subPath = path.join(dirPath, subdir.name);
      const subProjects = scanForProjects(subPath, depth + 1);
      projects.push(...subProjects);
    }
    
    // Fallback: if we are at depth 2 (e.g. Progetti/Tech/ProjectFolder) and we found no sub-projects,
    // and it has no further subdirectories, let's treat the subdirectories of this level as projects.
    if (depth === 2 && projects.length === 0) {
      for (const subdir of subdirs) {
        projects.push(path.join(dirPath, subdir.name));
      }
    }
  } catch (e) { /* ignore */ }
  return projects;
}

ipcMain.handle('memory-scan-projects', async (event, basePath) => {
  const targetPath = basePath || path.join(os.homedir(), 'Documents', 'Progetti');
  const projects = [];

  try {
    if (!fs.existsSync(targetPath)) return { success: true, projects: [] };

    const projectPaths = scanForProjects(targetPath);

    for (const dirPath of projectPaths) {
      const dirName = path.basename(dirPath);
      let description = '';
      let tags = [];
      let hasSrc = false;
      let hasPackageJson = false;
      let hasGit = false;

      try {
        const files = fs.readdirSync(dirPath);
        hasPackageJson = files.includes('package.json');
        hasGit = files.includes('.git');
        hasSrc = files.some(f => f === 'src' || f === 'source');

        if (hasPackageJson) tags.push('node');
        if (hasGit) tags.push('git');

        // Read real metadata instead of guessing
        if (hasPackageJson) {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf-8'));
            if (pkg.description) description = pkg.description;
            if (pkg.name) tags.push(pkg.name);
          } catch (e) { /* ignore */ }
        }

        // Read README for real description
        if (!description) {
          const readmeNames = ['README.md', 'README.txt', 'Readme.md', 'readme.md'];
          for (const rn of readmeNames) {
            const readmePath = path.join(dirPath, rn);
            if (files.includes(rn)) {
              try {
                const content = fs.readFileSync(readmePath, 'utf-8').trim();
                const firstLine = content.split('\n')[0].replace(/^#\s*/, '').trim();
                if (firstLine) description = firstLine;
              } catch (e) { /* ignore */ }
              break;
            }
          }
        }

        // Detect tech stack from files — use as tags only, not description
        if (files.some(f => f.endsWith('.sln') || f.endsWith('.csproj'))) tags.push('dotnet');
        if (files.some(f => f.endsWith('.py'))) tags.push('python');
        if (files.some(f => f.endsWith('.java'))) tags.push('java');
        if (files.some(f => f === 'Cargo.toml')) tags.push('rust');
        if (files.some(f => f === 'go.mod')) tags.push('go');
        if (files.some(f => f.endsWith('.cs'))) tags.push('csharp');

        if (!description) {
          // Only use file-based hints if no real metadata
          const extHints = [];
          if (tags.includes('python')) extHints.push('Python');
          if (tags.includes('dotnet')) extHints.push('.NET');
          if (tags.includes('java')) extHints.push('Java');
          if (tags.includes('rust')) extHints.push('Rust');
          if (tags.includes('go')) extHints.push('Go');
          if (tags.includes('csharp')) extHints.push('C#');
          if (hasPackageJson && !extHints.length) extHints.push('Node.js');
          if (extHints.length) {
            description = `Progetto ${extHints.join('/')}`;
          } else {
            description = `Progetto "${dirName}" — nessuna descrizione disponibile`;
          }
        }
        if (hasSrc) tags.push('structured');
      } catch (e) { /* ignore */ }

      const stat = fs.statSync(dirPath);
      projects.push({
        name: dirName,
        path: dirPath,
        description,
        tags,
        lastAccessed: new Date(stat.mtimeMs).toISOString().split('T')[0],
        size: getFolderSize(dirPath)
      });
    }

    projects.sort((a, b) => b.lastAccessed.localeCompare(a.lastAccessed));
    return { success: true, projects };
  } catch (e) {
    return { success: false, error: e.message, projects: [] };
  }
});

function getFolderSize(dirPath) {
  try {
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getFolderSize(fullPath);
      } else if (entry.isFile()) {
        total += fs.statSync(fullPath).size;
      }
    }
    return total;
  } catch { return 0; }
}

ipcMain.handle('memory-add-conversation', (event, conversation) => {
  const memory = loadMemory();
  memory.conversations.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
    date: new Date().toISOString(),
    summary: conversation.summary || 'Conversazione',
    messages: (conversation.messages || []).slice(-20) // keep last 20 messages
  });
  saveMemory(memory);
  return { success: true, count: memory.conversations.length };
});

ipcMain.handle('memory-daily-summary', (event, summaryData) => {
  const memory = loadMemory();
  const today = new Date().toISOString().split('T')[0];

  const existingIdx = memory.dailySummaries.findIndex(s => s.date === today);
  const entry = {
    date: today,
    summary: summaryData.summary || 'Nessuna attività registrata',
    activities: summaryData.activities || []
  };

  if (existingIdx >= 0) {
    memory.dailySummaries[existingIdx] = entry;
  } else {
    memory.dailySummaries.unshift(entry);
    if (memory.dailySummaries.length > 30) memory.dailySummaries = memory.dailySummaries.slice(0, 30);
  }

  memory.lastDailySummaryDate = today;
  saveMemory(memory);
  return { success: true };
});

// ============================================================
// SERVICE: SYSTEM CONTROL (Computer-wide operations)
// ============================================================

const APP_MAP = {
  'vscode': { cmd: 'code', path: null, process: 'Code.exe' },
  'code': { cmd: 'code', path: null, process: 'Code.exe' },
  'chrome': { cmd: 'start chrome', path: null, process: 'chrome.exe' },
  'firefox': { cmd: 'start firefox', path: null, process: 'firefox.exe' },
  'edge': { cmd: 'start msedge', path: null, process: 'msedge.exe' },
  'browser': { cmd: 'start', path: null, process: null },
  'terminal': { cmd: 'start wt', path: null, process: 'WindowsTerminal.exe' },
  'cmd': { cmd: 'start cmd', path: null, process: 'cmd.exe' },
  'explorer': { cmd: 'explorer', path: null, process: 'explorer.exe' },
  'notepad': { cmd: 'notepad', path: null, process: 'notepad.exe' },
  'calculator': { cmd: 'calc', path: null, process: 'calc.exe' },
  'spotify': { cmd: 'start spotify', path: null, process: 'Spotify.exe' },
  'slack': { cmd: 'start slack', path: null, process: 'slack.exe' },
  'discord': { cmd: 'start discord', path: null, process: 'Discord.exe' },
  'telegram': { cmd: 'start telegram', path: null, process: 'Telegram.exe' }
};

// Resolve app paths on init
function resolveAppPaths() {
  const local = process.env.LOCALAPPDATA || '';
  if (APP_MAP.vscode && !APP_MAP.vscode.path) {
    const paths = [
      path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe')
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) { APP_MAP.vscode.path = p; APP_MAP.vscode.cmd = `"${p}"`; break; }
    }
  }
}

resolveAppPaths();

ipcMain.handle('system-open-app', async (event, { name, filePath }) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      spawn('cmd.exe', ['/c', 'start', '', filePath], { windowsHide: true, detached: true });
      return { success: true, action: `Aperto: ${filePath}` };
    }

    const appKey = name.toLowerCase().trim();
    const app = APP_MAP[appKey] || APP_MAP[Object.keys(APP_MAP).find(k => appKey.includes(k))];

    if (app) {
      spawn('cmd.exe', ['/c', app.cmd], { windowsHide: true, detached: true });
      return { success: true, action: `Avviato: ${appKey}` };
    }

    // Try as direct executable name
    try {
      spawn('cmd.exe', ['/c', 'start', '', name], { windowsHide: true, detached: true });
      return { success: true, action: `Tentativo apertura: ${name}` };
    } catch(e) {
      return { success: false, error: `Applicazione non trovata: ${name}` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('system-close-app', async (event, processName) => {
  try {
    const app = APP_MAP[processName.toLowerCase()];
    const proc = (app && app.process) || (processName.endsWith('.exe') ? processName : processName + '.exe');
    execSync(`taskkill /f /im "${proc}" 2>nul`, { windowsHide: true });
    return { success: true, action: `Chiuso: ${proc}` };
  } catch (e) {
    return { success: false, error: `Impossibile chiudere ${processName}: ${e.message}` };
  }
});

ipcMain.handle('system-move-file', async (event, { source, destination }) => {
  try {
    if (!fs.existsSync(source)) return { success: false, error: `File non trovato: ${source}` };
    const destDir = path.dirname(destination);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(source, destination);
    return { success: true, action: `Spostato: ${path.basename(source)} → ${destination}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('system-search-files', async (event, { query, basePath }) => {
  try {
    const target = basePath || os.homedir();
    const results = [];
    const maxResults = 15;

    // Use PowerShell for fast searching
    const safeQuery = query.replace(/"/g, '""');
    const psCommand = `Get-ChildItem -Path "${target}" -Recurse -Filter "*${safeQuery}*" -ErrorAction SilentlyContinue | Select-Object -First ${maxResults} FullName, Length, LastWriteTime | ConvertTo-Json`;

    const stdout = execSync(`powershell -NoProfile -Command "${psCommand.replace(/"/g, '\\"')}"`, {
      windowsHide: true, timeout: 10000, encoding: 'utf-8'
    }).trim();

    if (stdout) {
      const parsed = JSON.parse(stdout);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      items.forEach(item => {
        results.push({
          path: item.FullName,
          name: path.basename(item.FullName),
          size: item.Length || 0,
          modified: item.LastWriteTime || ''
        });
      });
    }

    return { success: true, results, query };
  } catch (e) {
    // Fallback to simple dir search
    try {
      const results = [];
      const psFallback = `cmd /c dir /s /b "${basePath || os.homedir()}\\*${query}*" 2>nul`;
      const stdout = execSync(psFallback, { windowsHide: true, timeout: 8000, encoding: 'utf-8' }).trim();
      if (stdout) {
        stdout.split('\r\n').filter(Boolean).slice(0, 15).forEach(line => {
          results.push({ path: line, name: path.basename(line), size: 0, modified: '' });
        });
      }
      return { success: true, results, query };
    } catch(e2) {
      return { success: false, error: e2.message, results: [] };
    }
  }
});

// ── CoreAudio volume control (real get/set via PowerShell Add-Type) ──
const VOLUME_PS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out int c);
  int SetMasterVolumeLevel(float f, ref Guid g);
  int SetMasterVolumeLevelScalar(float f, ref Guid g);
  int GetMasterVolumeLevel(out float f);
  int GetMasterVolumeLevelScalar(out float f);
  int SetChannelVolumeLevel(uint c, float f, ref Guid g);
  int SetChannelVolumeLevelScalar(uint c, float f, ref Guid g);
  int GetChannelVolumeLevel(uint c, out float f);
  int GetChannelVolumeLevelScalar(uint c, out float f);
  int SetMute(bool m, ref Guid g);
  int GetMute(out bool m);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDevice ppDevices);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume ppInterface);
}
public class Vol {
  static IAudioEndpointVolume Endpoint() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice dev;
    en.EnumAudioEndpoints(0, 1, out dev);
    Guid g = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume v;
    dev.Activate(ref g, 23, IntPtr.Zero, out v);
    return v;
  }
  public static string Get() {
    float f; bool m;
    var v = Endpoint();
    v.GetMasterVolumeLevelScalar(out f);
    v.GetMute(out m);
    return ((int)Math.Round(f * 100)).ToString() + '|' + (m ? '1' : '0');
  }
  public static void Set(float level) {
    Guid g = Guid.Empty;
    Endpoint().SetMasterVolumeLevelScalar(level, ref g);
  }
}
'@
$cmd = $args[0]
if ($cmd -eq 'get') { [Vol]::Get() }
elseif ($cmd -eq 'set') { [Vol]::Set([float]$args[1] / 100.0); Write-Output 'ok' }
`;

function runVolumePs(psArgs) {
  const psPath = path.join(os.tmpdir(), `savia_vol_${Date.now()}.ps1`);
  fs.writeFileSync(psPath, VOLUME_PS, 'utf-8');
  try {
    return execSync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psPath}" ${psArgs}`, {
      windowsHide: true, timeout: 8000, encoding: 'utf-8'
    }).trim();
  } finally {
    try { fs.unlinkSync(psPath); } catch (e) { /* ignore */ }
  }
}

ipcMain.handle('system-volume', async (event, { action, value }) => {
  try {
    if (action === 'get') {
      const out = runVolumePs('-get');
      const parts = (out || '0|0').split('|');
      return { success: true, value: parseInt(parts[0]) || 0, muted: parts[1] === '1' };
    }

    if (action === 'set' && typeof value === 'number') {
      runVolumePs(`-set ${Math.max(0, Math.min(100, Math.round(value)))}`);
      return { success: true, action: `Volume impostato a ${value}%` };
    }

    if (action === 'mute') {
      execSync(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`, { windowsHide: true });
      return { success: true, action: 'Volume mutato/riattivato' };
    }

    if (action === 'up') {
      execSync(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"`, { windowsHide: true });
      return { success: true, action: 'Volume aumentato' };
    }

    if (action === 'down') {
      execSync(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"`, { windowsHide: true });
      return { success: true, action: 'Volume diminuito' };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('system-brightness', async (event, { action, value }) => {
  try {
    if (action === 'set' && typeof value === 'number') {
      const level = Math.max(0, Math.min(100, value));
      execSync(`powershell -NoProfile -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${level})"`, { windowsHide: true, timeout: 5000 });
      return { success: true, action: `Luminosità impostata a ${level}%` };
    }
    if (action === 'get') {
      const stdout = execSync(`powershell -NoProfile -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"`, { windowsHide: true, timeout: 5000, encoding: 'utf-8' }).trim();
      return { success: true, value: parseInt(stdout) || 50 };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message, action: 'Brightness control non disponibile su questo sistema' };
  }
});

ipcMain.handle('system-list-processes', async () => {
  try {
    const stdout = execSync(`powershell -NoProfile -Command "Get-Process | Select-Object -First 30 Name,Id,CPU,WorkingSet | ConvertTo-Json"`, { windowsHide: true, timeout: 5000, encoding: 'utf-8' }).trim();
    const parsed = JSON.parse(stdout);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return { success: true, processes: items.map(p => ({ name: p.Name, pid: p.Id, cpu: p.CPU, mem: p.WorkingSet })) };
  } catch (e) {
    return { success: false, error: e.message, processes: [] };
  }
});

// ============================================================
// SERVICE: MEDIA CONTROL (play/pause/next/prev via VK codes)
// ============================================================

const MEDIA_KEYS = {
  playpause: 0xB3, // VK_MEDIA_PLAY_PAUSE
  next: 0xB0,      // VK_MEDIA_NEXT_TRACK
  prev: 0xB1,      // VK_MEDIA_PREV_TRACK
  stop: 0xB2,      // VK_MEDIA_STOP
  mute: 0xAD       // VK_VOLUME_MUTE
};

ipcMain.handle('system-media', async (event, { action }) => {
  try {
    const vk = MEDIA_KEYS[action];
    if (!vk) return { success: false, error: `Azione media non valida: ${action}` };
    execSync(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]${vk})"`, { windowsHide: true });
    const labels = { playpause: 'Play/Pausa', next: 'Traccia successiva', prev: 'Traccia precedente', stop: 'Stop', mute: 'Muto' };
    return { success: true, action: `Media: ${labels[action] || action}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================
// SERVICE: SCREENSHOT (desktopCapturer → Pictures/SAVIA)
// ============================================================

ipcMain.handle('system-screenshot', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    if (!sources.length) return { success: false, error: 'Nessuno schermo rilevato' };
    const primary = sources.find(s => s.display_id === '0') || sources[0];
    const image = primary.thumbnail;
    const dir = path.join(app.getPath('pictures'), 'SAVIA');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `savia_${Date.now()}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { success: true, path: file };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================
// SERVICE: REMINDER & CALENDAR SCHEDULER (fires native toasts)
// ============================================================

function parseDueDate(dateStr, timeStr) {
  if (!dateStr && !timeStr) return null;
  const today = new Date();
  let y, m, d, hh, mm;

  if (dateStr) {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    y = parseInt(parts[0]); m = parseInt(parts[1]) - 1; d = parseInt(parts[2]);
  } else { y = today.getFullYear(); m = today.getMonth(); d = today.getDate(); }

  if (timeStr && timeStr.includes(':')) {
    const tp = timeStr.split(':');
    hh = parseInt(tp[0]); mm = parseInt(tp[1]);
  } else { hh = 9; mm = 0; }

  const due = new Date(y, m, d, hh, mm, 0);
  return isNaN(due.getTime()) ? null : due;
}

function checkDueReminders() {
  const data = loadAgentData();
  const now = new Date();
  let changed = false;

  (data.reminders || []).forEach(r => {
    if (r.fired) return;
    if (!r.date && !r.time) return;
    const due = parseDueDate(r.date, r.time);
    if (due && due <= now) {
      r.fired = true;
      changed = true;
      sendWinToast('S.A.V.I.A — Promemoria', r.text || 'Promemoria', 'critical');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('reminder-fired', { type: 'reminder', text: r.text });
      }
    }
  });

  (data.calendar || []).forEach(ev => {
    if (ev.fired || !ev.date) return;
    // UI all-day events (created without a time) are treated as non-timed:
    // they never auto-fire a toast on their own.
    if (ev.source === 'ui' && !ev.time) return;
    const due = parseDueDate(ev.date, ev.time);
    if (due && due <= now) {
      ev.fired = true;
      changed = true;
      sendWinToast('S.A.V.I.A — Evento', `${ev.title || 'Evento'}${ev.time ? ' alle ' + ev.time : ''}`, 'normal');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('reminder-fired', { type: 'calendar', text: ev.title });
      }
    }
  });

  if (changed) saveAgentData(data);

  // Housekeeping: drop fired reminders/events older than 24h to keep the store tidy
  try {
    const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
    const prevRem = (data.reminders || []).length;
    const prevCal = (data.calendar || []).length;
    data.reminders = (data.reminders || []).filter(r => {
      if (!r.fired) return true;
      const due = parseDueDate(r.date, r.time);
      return !due || due.getTime() >= cutoff;
    });
    data.calendar = (data.calendar || []).filter(ev => {
      if (!ev.fired) return true;
      const due = parseDueDate(ev.date, ev.time);
      return !due || due.getTime() >= cutoff;
    });
    if (data.reminders.length !== prevRem || data.calendar.length !== prevCal) {
      saveAgentData(data);
    }
  } catch (e) { /* ignore */ }
}

setInterval(checkDueReminders, 30000);
setTimeout(checkDueReminders, 5000);

// ============================================================
// SERVICE: TRAY ICON & GLOBAL SHORTCUT (summon S.A.V.I.A)
// ============================================================

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (mainWindow.isVisible()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

// ── Tray icon fallback (base64 PNG a 16x16 cyan reactor) ─────────────
const TRAY_ICON_FALLBACK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAQElEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFAABJLAH+H/7yxQAAAABJRU5ErkJggg==';

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
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostra / Nascondi S.A.V.I.A', click: toggleMainWindow },
      { type: 'separator' },
      { label: 'Esci', click: () => { isQuitting = true; app.quit(); } }
    ]));
    tray.on('click', toggleMainWindow);
  } catch (e) {
    // tray non disponibile — app continua normalmente
  }
}

function registerGlobalShortcut() {
  try {
    globalShortcut.register('CommandOrControl+Alt+S', () => {
      toggleMainWindow();
    });
  } catch (e) { /* ignore */ }
}

// ============================================================
// SERVICE: BATTERY MONITOR (cached, pushed with telemetry)
// ============================================================

function refreshBattery() {
  try {
    const stdout = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress"`,
      { windowsHide: true, timeout: 5000, encoding: 'utf-8' }
    ).trim();
    if (!stdout) { lastBattery = { present: false }; return; }
    const parsed = JSON.parse(stdout);
    lastBattery = {
      present: true,
      percent: parsed.EstimatedChargeRemaining != null ? Math.round(parsed.EstimatedChargeRemaining) : null,
      charging: parsed.BatteryStatus === 2,
      status: parsed.BatteryStatus
    };
  } catch (e) {
    lastBattery = { present: false };
  }
}

// ============================================================
// SERVICE: EXTENDED TELEMETRY (Dashboard: GPU/Net/Disk/Temp/Processes)
// ============================================================

ipcMain.handle('get-extended-telemetry', async () => {
  const result = { gpu: [], network: [], disks: [], temps: [] };

  try {
    // GPU info
    const gpuOut = execSync(
      `powershell -NoProfile -Command "Get-WmiObject Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoModeDescription | ConvertTo-Json"`,
      { windowsHide: true, timeout: 5000, encoding: 'utf-8' }
    ).trim();
    if (gpuOut) {
      const parsed = JSON.parse(gpuOut);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      result.gpu = items.map(g => ({
        name: g.Name || 'N/A',
        vram: g.AdapterRAM ? Math.round(g.AdapterRAM / 1073741824 * 10) / 10 : 0,
        driver: g.DriverVersion || '',
        mode: g.VideoModeDescription || ''
      }));
    }
  } catch (e) { result.gpu = [{ name: 'N/A', vram: 0 }]; }

  try {
    // Network interfaces
    const nets = os.networkInterfaces();
    result.network = [];
    Object.keys(nets).forEach(name => {
      nets[name].forEach(info => {
        if (!info.internal) {
          result.network.push({ name, address: info.address, family: info.family, mac: info.mac });
        }
      });
    });
  } catch (e) { /* ignore */ }

  try {
    // Disk usage
    const diskOut = execSync(
      `powershell -NoProfile -Command "Get-WmiObject Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json"`,
      { windowsHide: true, timeout: 5000, encoding: 'utf-8' }
    ).trim();
    if (diskOut) {
      const parsed = JSON.parse(diskOut);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      result.disks = items.map(d => ({
        drive: d.DeviceID || '',
        total: d.Size ? Math.round(d.Size / 1073741824) : 0,
        free: d.FreeSpace ? Math.round(d.FreeSpace / 1073741824) : 0,
        used: d.Size && d.FreeSpace ? Math.round((d.Size - d.FreeSpace) / 1073741824) : 0,
        pct: d.Size && d.FreeSpace ? Math.round((1 - d.FreeSpace / d.Size) * 100) : 0
      }));
    }
  } catch (e) { result.disks = []; }

  try {
    // Temperature (synthetic from load average since WMI thermal requires admin)
    const load = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    result.temps = [
      { sensor: 'CPU Package', value: Math.round(35 + load / cpuCount * 25) }
    ];
  } catch (e) { result.temps = []; }

  return result;
});

ipcMain.handle('get-process-list', async () => {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 20 Name,Id,CPU,@{N='MemMB';E={[math]::Round($_.WorkingSet/1MB,1)}} | ConvertTo-Json"`,
      { windowsHide: true, timeout: 5000, encoding: 'utf-8' }
    ).trim();
    if (!out) return { success: true, processes: [] };
    const parsed = JSON.parse(out);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return {
      success: true,
      processes: items.map(p => ({
        name: p.Name || 'unknown',
        pid: p.Id || 0,
        cpu: p.CPU != null ? Math.round(p.CPU * 10) / 10 : 0,
        memMB: p.MemMB || 0
      }))
    };
  } catch (e) {
    return { success: false, error: e.message, processes: [] };
  }
});

// ============================================================
// AGENT TOOLS — Calendar, Todo, Reminder (local JSON store)
// ============================================================

const agentDataPath = path.join(app.getPath('userData'), 'agent-data.json');

function loadAgentData() {
  try {
    if (fs.existsSync(agentDataPath)) {
      return JSON.parse(fs.readFileSync(agentDataPath, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return { calendar: [], todos: [], reminders: [] };
}

function saveAgentData(data) {
  fs.writeFileSync(agentDataPath, JSON.stringify(data, null, 2), 'utf-8');
}

ipcMain.handle('agent-tool', async (event, { tool, args }) => {
  const data = loadAgentData();
  const parts = args.split('|').map(s => s.trim());

  switch (tool) {
    case 'calendar': {
      const action = parts[0]?.toLowerCase();
      if (action === 'list') {
        return { success: true, events: data.calendar };
      }
      if (action === 'add' && parts.length >= 3) {
        data.calendar.push({
          id: Date.now(),
          title: parts[1],
          date: parts[2],
          time: parts[3] || '',
          duration: parts[4] || '60min',
          desc: parts[5] || ''
        });
        saveAgentData(data);
        return { success: true, message: 'Evento aggiunto' };
      }
      if (action === 'delete' && parts[1]) {
        // Compare as strings: UI event ids are base36 strings, AI ids numeric.
        data.calendar = data.calendar.filter(e => String(e.id) !== parts[1]);
        saveAgentData(data);
        return { success: true, message: 'Evento rimosso' };
      }
      return { success: false, message: 'Azione calendar non valida' };
    }

    case 'todo': {
      const action = parts[0]?.toLowerCase();
      if (action === 'list') {
        return { success: true, todos: data.todos };
      }
      if (action === 'add' && parts.length >= 2) {
        data.todos.push({
          id: Date.now(),
          title: parts[1],
          priority: parts[2] || 'media',
          due: parts[3] || '',
          done: false,
          created: new Date().toISOString()
        });
        saveAgentData(data);
        return { success: true, message: 'Task aggiunto' };
      }
      if (action === 'done' && parts[1]) {
        const todo = data.todos.find(t => String(t.id) === parts[1]);
        if (todo) { todo.done = true; saveAgentData(data); return { success: true, message: 'Task completato' }; }
        return { success: false, message: 'Task non trovato' };
      }
      if (action === 'delete' && parts[1]) {
        const before = data.todos.length;
        data.todos = data.todos.filter(t => String(t.id) !== parts[1]);
        if (data.todos.length !== before) saveAgentData(data);
        return { success: true, message: 'Task rimosso' };
      }
      return { success: false, message: 'Azione todo non valida' };
    }

    case 'reminder': {
      const rAction = parts[0]?.toLowerCase();
      if (rAction === 'list') {
        return { success: true, reminders: data.reminders };
      }
      if (rAction === 'delete' && parts[1]) {
        data.reminders = data.reminders.filter(r => String(r.id) !== parts[1]);
        saveAgentData(data);
        return { success: true, message: 'Promemoria rimosso' };
      }
      if (parts.length >= 2) {
        data.reminders.push({
          id: Date.now(),
          text: parts[1],
          date: parts[2] || '',
          time: parts[3] || '',
          created: new Date().toISOString()
        });
        saveAgentData(data);
        return { success: true, message: 'Promemoria impostato' };
      }
      return { success: false, message: 'Formato reminder: set|testo|data|ora' };
    }

    default:
      return { success: false, message: `Tool sconosciuto: ${tool}` };
  }
});

// ── Calendar UI → scheduler sync ───────────────────────────────────
// Merges events created in calendar.html into agent-data.json so the
// reminder/calendar scheduler can fire native toasts for them too.
// Preserves the `fired` flag on re-sync to avoid duplicate toasts.

ipcMain.handle('calendar-sync', (event, events) => {
  try {
    const data = loadAgentData();
    const existing = new Map((data.calendar || []).map(e => [String(e.id), e]));
    const now = new Date();
    const incoming = (Array.isArray(events) ? events : []).map(e => {
      const prev = existing.get(String(e.id));
      const due = parseDueDate(e.date, e.time);
      return {
        id: e.id,
        title: e.title || 'Evento',
        date: e.date || '',
        time: e.time || '',
        duration: e.duration || '60min',
        desc: e.desc || '',
        // Only genuinely new UI events get tagged 'ui'; AI-sourced events keep
        // their original source so the all-day skip guard doesn't affect them.
        source: prev ? prev.source : 'ui',
        // Overdue events (due <= now) are marked as already fired so they never
        // toast a stale notification — this also survives the 24h prune (UI's
        // localStorage copy has no 'fired' flag, so a re-sync would otherwise
        // resurrect the event and toast it again).
        fired: due && due <= now ? true : (prev ? !!prev.fired : false)
      };
    });
    // Keep AI-created events (no matching UI id) + replace/merge UI ones
    const incomingIds = new Set(incoming.map(e => String(e.id)));
    const kept = (data.calendar || []).filter(e => !incomingIds.has(String(e.id)));
    data.calendar = [...kept, ...incoming];
    saveAgentData(data);
    return { success: true, count: data.calendar.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================
// KNOWLEDGE BASE (RAG) — Index, Embed, Search
// ============================================================

const kbPath = path.join(app.getPath('userData'), 'knowledge-base.json');
const OLLAMA_EMBED = 'http://localhost:11434/api/embeddings';

function loadKB() {
  try {
    if (fs.existsSync(kbPath)) return JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
  } catch (e) { /* ignore */ }
  return { documents: [] };
}

function saveKB(data) {
  fs.writeFileSync(kbPath, JSON.stringify(data, null, 2), 'utf-8');
}

const KB_CHUNK_SIZE = 1500;
const KB_CHUNK_OVERLAP = 200;

function chunkText(text, filepath, docId) {
  const chunks = [];
  const lines = text.split('\n');
  let current = '';
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    if (current.length + lines[i].length > KB_CHUNK_SIZE && current.length > 0) {
      chunks.push({ docId, filepath, text: current.trim(), startLine, endLine: i });
      const overlap = current.slice(-KB_CHUNK_OVERLAP);
      current = overlap + '\n' + lines[i];
      startLine = Math.max(0, i - Math.round(KB_CHUNK_OVERLAP / 80));
    } else {
      current += lines[i] + '\n';
    }
  }
  if (current.trim()) {
    chunks.push({ docId, filepath, text: current.trim(), startLine, endLine: lines.length });
  }
  return chunks;
}

async function embedText(text) {
  try {
    const res = await fetch(OLLAMA_EMBED, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text.substring(0, 8000) })
    });
    if (!res.ok) throw new Error(`Embedding API: ${res.status}`);
    const data = await res.json();
    return data.embedding || [];
  } catch (e) {
    throw new Error(`Embedding failed: ${e.message}`);
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function extractTextFromFile(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const textExts = ['.txt', '.md', '.js', '.ts', '.py', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.sql', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.m', '.r', '.lua'];

  if (textExts.includes(ext)) {
    return fs.readFileSync(filepath, 'utf-8');
  }

  if (ext === '.pdf') {
    try {
      const out = execSync(
        `powershell -NoProfile -Command "try { $p = \"${filepath.replace(/'/g, "''")}\"; Add-Type -AssemblyName System.Speech; $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer; Write-Output 'PDF extraction requires additional libraries' } catch { Write-Output 'PDF extraction unavailable' }"`,
        { windowsHide: true, timeout: 5000, encoding: 'utf-8' }
      ).trim();
      return out || '[PDF extraction not available]';
    } catch { return '[PDF extraction failed]'; }
  }

  if (ext === '.docx') {
    try {
      const out = execSync(
        `powershell -NoProfile -Command "try { $p = \"${filepath.replace(/'/g, "''")}\"; $o = New-Object -ComObject Word.Application; $o.Visible = $false; $d = $o.Documents.Open($p); $t = $d.Content.Text; $d.Close(); $o.Quit(); Write-Output $t } catch { Write-Output 'DOCX extraction failed: $($_.Exception.Message)' }"`,
        { windowsHide: true, timeout: 10000, encoding: 'utf-8' }
      ).trim();
      return out || '[DOCX extraction failed]';
    } catch { return '[DOCX extraction failed]'; }
  }

  return null;
}

// Compute MD5-like hash for dedup
function fileSignature(filepath) {
  try {
    const stat = fs.statSync(filepath);
    return `${filepath}|${stat.size}|${stat.mtimeMs}`;
  } catch { return filepath; }
}

ipcMain.handle('kb-index-file', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    const stat = fs.statSync(filePath);
    if (stat.size > 50 * 1024 * 1024) return { success: false, error: 'File > 50MB' };

    const text = extractTextFromFile(filePath);
    if (!text) return { success: false, error: 'Unsupported file type' };

    const kb = loadKB();
    const sig = fileSignature(filePath);

    // Skip if already indexed (same path + size + mtime)
    const existing = kb.documents.find(d => d.signature === sig);
    if (existing) return { success: true, message: 'Already indexed', docId: existing.id, chunks: existing.chunks.length };

    const docId = 'doc_' + Date.now() + '_' + path.basename(filePath).replace(/[^a-zA-Z0-9_\-.]/g, '_');
    const chunks = chunkText(text, filePath, docId);

    // Embed each chunk
    let embedded = 0;
    for (let i = 0; i < chunks.length; i++) {
      try {
        chunks[i].embedding = await embedText(chunks[i].text);
        embedded++;
      } catch (e) {
        chunks[i].embedding = null;
      }
    }

    const entry = {
      id: docId,
      filepath: filePath,
      filename: path.basename(filePath),
      ext: path.extname(filePath).toLowerCase(),
      size: stat.size,
      indexed: new Date().toISOString(),
      signature: sig,
      chunks: chunks.filter(c => c.embedding)
    };

    kb.documents.push(entry);
    saveKB(kb);

    return { success: true, docId, filename: entry.filename, chunks: entry.chunks.length, embedded };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('kb-index-directory', async (event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) return { success: false, error: 'Directory not found' };
    const extWhitelist = new Set(['.txt', '.md', '.js', '.ts', '.py', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.sql', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.m', '.r', '.lua', '.pdf', '.docx']);

    const files = [];
    function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('node_modules')) {
          walk(full);
        } else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if (extWhitelist.has(ext) && !e.name.startsWith('.')) files.push(full);
        }
      }
    }
    walk(dirPath);

    // Process sequentially
    const kb = loadKB();
    const sigs = new Set(kb.documents.map(d => d.signature));
    const processed = { success: 0, skipped: 0, failed: 0, errors: [] };

    for (const f of files) {
      try {
        const stat = fs.statSync(f);
        const sig = `${f}|${stat.size}|${stat.mtimeMs}`;
        if (sigs.has(sig)) { processed.skipped++; continue; }

        const text = extractTextFromFile(f);
        if (!text) { processed.skipped++; continue; }

        const docId = 'doc_' + Date.now() + '_' + path.basename(f).replace(/[^a-zA-Z0-9_\-.]/g, '_');
        const chunks = chunkText(text, f, docId);

        let embedded = 0;
        for (let i = 0; i < chunks.length; i++) {
          try { chunks[i].embedding = await embedText(chunks[i].text); embedded++; }
          catch { chunks[i].embedding = null; }
        }

        const entry = {
          id: docId, filepath: f, filename: path.basename(f),
          ext: path.extname(f).toLowerCase(), size: stat.size,
          indexed: new Date().toISOString(), signature: sig,
          chunks: chunks.filter(c => c.embedding)
        };

        kb.documents.push(entry);
        processed.success++;
      } catch (e) {
        processed.failed++;
        processed.errors.push({ file: f, error: e.message });
      }
    }

    saveKB(kb);
    return { success: true, ...processed, total: files.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('kb-search', async (event, { query, limit = 5 }) => {
  try {
    const kb = loadKB();
    if (!kb.documents.length) return { success: true, results: [] };

    const queryEmbedding = await embedText(query);
    if (!queryEmbedding || !queryEmbedding.length) return { success: false, error: 'Embedding failed' };

    const scored = [];
    for (const doc of kb.documents) {
      for (const chunk of doc.chunks) {
        if (!chunk.embedding) continue;
        const score = cosineSimilarity(queryEmbedding, chunk.embedding);
        scored.push({ docId: doc.id, filename: doc.filename, filepath: doc.filepath, ext: doc.ext, text: chunk.text.substring(0, 500), score, startLine: chunk.startLine, endLine: chunk.endLine });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(limit, scored.length));

    return { success: true, results: top, total: scored.length };
  } catch (e) {
    return { success: false, error: e.message, results: [] };
  }
});

ipcMain.handle('kb-list', async () => {
  const kb = loadKB();
  return {
    success: true,
    documents: kb.documents.map(d => ({
      id: d.id, filename: d.filename, filepath: d.filepath, ext: d.ext,
      size: d.size, indexed: d.indexed, chunks: d.chunks.length
    }))
  };
});

ipcMain.handle('kb-delete', async (event, docId) => {
  const kb = loadKB();
  const before = kb.documents.length;
  kb.documents = kb.documents.filter(d => d.id !== docId);
  if (kb.documents.length < before) {
    saveKB(kb);
    return { success: true, message: 'Deleted' };
  }
  return { success: false, message: 'Not found' };
});

ipcMain.handle('kb-status', async () => {
  const kb = loadKB();
  const totalChunks = kb.documents.reduce((s, d) => s + d.chunks.length, 0);
  return {
    success: true,
    docCount: kb.documents.length,
    chunkCount: totalChunks,
    storage: kbPath
  };
});

// ============================================================
// SERVICE: FILE PREVIEW (for scanner analysis)
// ============================================================

ipcMain.handle('read-file-preview', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    const stat = fs.statSync(filePath);
    if (stat.size > 100 * 1024) return { success: false, error: 'File > 100KB' };
    const textExts = ['.js','.ts','.py','.html','.css','.json','.xml','.yaml','.yml','.md','.txt','.ini','.cfg','.conf','.sh','.bat','.ps1','.sql','.rs','.go','.java','.c','.cpp','.h','.hpp','.rb','.php','.swift','.kt','.m','.lua','.toml','.env','.gitignore','.dockerfile','.cs','.fs','.fsx'];
    const ext = path.extname(filePath).toLowerCase();
    if (!textExts.includes(ext)) return { success: false, error: 'Unsupported file type' };
    const content = fs.readFileSync(filePath, 'utf-8').substring(0, 500);
    const lines = content.split('\n').slice(0, 5).join('\n').trim();
    return { success: true, preview: lines || '(vuoto)' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================
// AUTO-SAVE ON QUIT
// ============================================================

function saveAllOnQuit() {
  try {
    const mem = loadMemory();
    if (mem) saveMemory(mem);
  } catch (e) { /* ignore */ }
  try {
    const data = loadAgentData();
    if (data) saveAgentData(data);
  } catch (e) { /* ignore */ }
}

app.on('before-quit', () => {
  isQuitting = true;
  saveAllOnQuit();
  stopAllServices();
});

// Periodic auto-save every 60 seconds
setInterval(() => {
  try {
    const mem = loadMemory();
    if (mem) saveMemory(mem);
  } catch (e) { /* ignore */ }
}, 60000);

// ============================================================
// CLEANUP
// ============================================================
function stopAllServices() {
  if (telemetryInterval) clearInterval(telemetryInterval);
  if (fsWatcherHandle) { fsWatcherHandle.close(); fsWatcherHandle = null; }
  Object.keys(terminalProcesses).forEach(id => {
    try { terminalProcesses[id].kill(); } catch (e) { /* ignore */ }
  });
  terminalProcesses = {};
}
