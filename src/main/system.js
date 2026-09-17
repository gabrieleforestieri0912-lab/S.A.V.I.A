'use strict';

// ============================================================
// SYSTEM CONTROL — applicazioni, volume, luminosità, media,
// screenshot, ricerca file, info sistema.
// ============================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
const { app, ipcMain, desktopCapturer, shell, dialog, BrowserWindow } = require('electron');

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

function resolveAppPaths() {
  const local = process.env.LOCALAPPDATA || '';
  if (!APP_MAP.vscode.path) {
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

function openLoose(pathOrName) {
  spawn('cmd.exe', ['/c', 'start', '', pathOrName], { windowsHide: true, detached: true });
}

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

const MEDIA_KEYS = {
  playpause: 0xB3, next: 0xB0, prev: 0xB1, stop: 0xB2, mute: 0xAD
};
const MEDIA_LABELS = { playpause: 'Play/Pausa', next: 'Traccia successiva', prev: 'Traccia precedente', stop: 'Stop', mute: 'Muto' };

function sendKey(vk) {
  execSync(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]${vk})"`, { windowsHide: true });
}

// ── A: Full Access — Audit, Allowlist, Confirmation ──────────────────
const SYSTEM_LOG = path.join(app.getPath('userData'), 'savia-system-audit.log');
const ALLOWLIST = [
  os.homedir(),
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Documents', 'Progetti'),
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'Downloads'),
  app.getPath('userData'),
];
const BLOCKLIST = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'System32'),
  path.join(process.env.WINDIR || 'C:\\Windows', 'SysWOW64'),
  'C:\\Windows\\System32\\config',
];

let systemAccessMode = 'full'; // full | restricted | readonly — persistito via config
try {
  const cfgPath = path.join(app.getPath('userData'), 'savia-config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    if (['full','restricted','readonly'].includes(cfg.systemAccessMode)) systemAccessMode = cfg.systemAccessMode;
  }
} catch {}

function isAdminSync() {
  try {
    execSync('net session', { windowsHide: true, timeout: 3000 });
    return true;
  } catch { return false; }
}

function isPathAllowed(target) {
  if (!target) return false;
  const norm = path.resolve(target).toLowerCase();
  if (BLOCKLIST.some(b => norm.startsWith(path.resolve(b).toLowerCase()))) return false;
  if (systemAccessMode === 'readonly') return false;
  if (systemAccessMode === 'full') return true;
  // restricted: only allowlist
  return ALLOWLIST.some(a => norm.startsWith(path.resolve(a).toLowerCase()));
}

function auditLog(action, details, result) {
  const line = JSON.stringify({ ts: new Date().toISOString(), user: os.userInfo().username, action, details, result: String(result).slice(0, 800) });
  try { fs.appendFileSync(SYSTEM_LOG, line + '\n', 'utf-8'); } catch {}
}

async function requestConfirmation(title, message) {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    const res = await dialog.showMessageBox(win || null, {
      type: 'question',
      buttons: ['Annulla', 'Esegui'],
      defaultId: 0,
      cancelId: 0,
      title,
      message,
      detail: 'Richiesto da S.A.V.I.A. — accesso completo (A). Puoi revocare in SYSTEM ACCESS.',
    });
    return res.response === 1;
  } catch { return false; }
}

function init() {
  ipcMain.handle('system-open-app', async (event, { name, filePath }) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        openLoose(filePath);
        return { success: true, action: `Aperto: ${filePath}` };
      }
      const appKey = name.toLowerCase().trim();
      const app = APP_MAP[appKey] || APP_MAP[Object.keys(APP_MAP).find(k => appKey.includes(k))];
      if (app) {
        spawn('cmd.exe', ['/c', app.cmd], { windowsHide: true, detached: true });
        return { success: true, action: `Avviato: ${appKey}` };
      }
      try {
        openLoose(name);
        return { success: true, action: `Tentativo apertura: ${name}` };
      } catch (e) {
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
      const safeQuery = query.replace(/"/g, '""');
      const psCommand = `Get-ChildItem -Path "${target}" -Recurse -Filter "*${safeQuery}*" -ErrorAction SilentlyContinue | Select-Object -First 15 FullName, Length, LastWriteTime | ConvertTo-Json`;
      const stdout = execSync(`powershell -NoProfile -Command "${psCommand.replace(/"/g, '\\"')}"`, {
        windowsHide: true, timeout: 10000, encoding: 'utf-8'
      }).trim();
      if (!stdout) return { success: true, results: [], query };
      const parsed = JSON.parse(stdout);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return {
        success: true,
        query,
        results: items.map(item => ({
          path: item.FullName,
          name: path.basename(item.FullName),
          size: item.Length || 0,
          modified: item.LastWriteTime || ''
        }))
      };
    } catch (e) {
      // Fallback: ricerca semplice via cmd
      try {
        const stdout = execSync(`cmd /c dir /s /b "${basePath || os.homedir()}\\*${query}*" 2>nul`, {
          windowsHide: true, timeout: 8000, encoding: 'utf-8'
        }).trim();
        return {
          success: true,
          query,
          results: stdout.split('\r\n').filter(Boolean).slice(0, 15).map(line => ({
            path: line, name: path.basename(line), size: 0, modified: ''
          }))
        };
      } catch (e2) {
        return { success: false, error: e2.message, results: [] };
      }
    }
  });

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
      if (action === 'mute') { sendKey(173); return { success: true, action: 'Volume mutato/riattivato' }; }
      if (action === 'up') { sendKey(175); return { success: true, action: 'Volume aumentato' }; }
      if (action === 'down') { sendKey(174); return { success: true, action: 'Volume diminuito' }; }
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

  ipcMain.handle('system-media', async (event, { action }) => {
    try {
      const vk = MEDIA_KEYS[action];
      if (!vk) return { success: false, error: `Azione media non valida: ${action}` };
      sendKey(vk);
      return { success: true, action: `Media: ${MEDIA_LABELS[action] || action}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('system-screenshot', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
      if (!sources.length) return { success: false, error: 'Nessuno schermo rilevato' };
      const primary = sources.find(s => s.display_id === '0') || sources[0];
      const dir = path.join(app.getPath('pictures'), 'SAVIA');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `savia_${Date.now()}.png`);
      fs.writeFileSync(file, primary.thumbnail.toPNG());
      return { success: true, path: file };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('system-open-url', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── A: Full Access handlers ────────────────────────────────────────
  ipcMain.handle('system-is-admin', () => ({ isAdmin: isAdminSync(), mode: systemAccessMode, allowlist: ALLOWLIST, blocklist: BLOCKLIST, logPath: SYSTEM_LOG }));
  ipcMain.handle('system-set-access-mode', (event, mode) => {
    if (!['full','restricted','readonly'].includes(mode)) return { success: false, error: 'mode invalido' };
    systemAccessMode = mode;
    try {
      const cfgPath = path.join(app.getPath('userData'), 'savia-config.json');
      const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) : {};
      cfg.systemAccessMode = mode;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch {}
    auditLog('set-access-mode', { mode }, 'ok');
    return { success: true, mode };
  });
  ipcMain.handle('system-exec', async (event, { command, cwd }) => {
    if (!command || typeof command !== 'string') return { success: false, error: 'comando vuoto' };
    if (systemAccessMode === 'readonly') return { success: false, error: 'Modalità sola lettura — esecuzione bloccata' };
    const destructive = /rm\s+-rf|del\s+\/[sfq]|format\s+[a-z]:|shutdown|reg\s+delete|mkfs|:\(\)\{\s*:\|:&\s*;\}/i.test(command) || /C:\\Windows/i.test(command);
    if (destructive && !isPathAllowed(cwd || os.homedir())) {
      const ok = await requestConfirmation('Conferma esecuzione', `Comando distruttivo rilevato:\n${command}\n\nCWD: ${cwd || os.homedir()}\n\nEseguire?`);
      if (!ok) { auditLog('system-exec', { command, cwd }, 'blocked: user denied'); return { success: false, error: 'Esecuzione annullata da utente' }; }
    }
    try {
      const out = execSync(command, { windowsHide: true, timeout: 15000, encoding: 'utf-8', cwd: cwd || os.homedir(), maxBuffer: 2 * 1024 * 1024 });
      auditLog('system-exec', { command, cwd }, out.slice(0, 400));
      return { success: true, output: out.slice(0, 8000) };
    } catch (e) {
      const msg = e.stdout ? String(e.stdout) : e.message;
      auditLog('system-exec', { command, cwd }, `error: ${msg.slice(0,400)}`);
      return { success: false, error: msg.slice(0, 2000) };
    }
  });
  ipcMain.handle('system-fs-read', async (event, filePath) => {
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      auditLog('fs-read', { filePath }, `ok ${data.length}`);
      return { success: true, content: data.slice(0, 50000) };
    } catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('system-fs-write', async (event, { filePath, content }) => {
    if (systemAccessMode === 'readonly') return { success: false, error: 'readonly' };
    if (!isPathAllowed(filePath)) {
      const ok = await requestConfirmation('Conferma scrittura', `Scrittura fuori allowlist:\n${filePath}\n\nConsentire?`);
      if (!ok) return { success: false, error: 'Scrittura annullata' };
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content || '', 'utf-8');
      auditLog('fs-write', { filePath }, `ok ${String(content).length}`);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('system-fs-delete', async (event, targetPath) => {
    if (systemAccessMode === 'readonly') return { success: false, error: 'readonly' };
    if (!isPathAllowed(targetPath)) {
      const ok = await requestConfirmation('Conferma eliminazione', `Eliminazione fuori allowlist:\n${targetPath}`);
      if (!ok) return { success: false, error: 'annullata' };
    }
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true });
      else fs.unlinkSync(targetPath);
      auditLog('fs-delete', { targetPath }, 'ok');
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('system-fs-list', async (event, dirPath) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(dirPath, e.name) }));
      return { success: true, entries };
    } catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('system-registry', async (event, { action, hive, key, name, value, type }) => {
    if (systemAccessMode !== 'full') return { success: false, error: 'registry richiede modalità full' };
    if (!isAdminSync()) return { success: false, error: 'richiede avvio come amministratore' };
    try {
      if (action === 'get') {
        const out = execSync(`reg query "${hive}\\${key}" /v "${name}"`, { windowsHide: true, encoding: 'utf-8', timeout: 5000 }).trim();
        auditLog('reg-get', { hive, key, name }, out.slice(0,400));
        return { success: true, output: out };
      }
      if (action === 'set') {
        const t = type || 'REG_SZ';
        execSync(`reg add "${hive}\\${key}" /v "${name}" /t ${t} /d "${String(value).replace(/"/g,'\\"')}" /f`, { windowsHide: true, timeout: 5000 });
        auditLog('reg-set', { hive, key, name, value }, 'ok');
        return { success: true };
      }
      return { success: false, error: 'action get|set' };
    } catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('system-service', async (event, { action, name }) => {
    if (systemAccessMode !== 'full') return { success: false, error: 'service richiede full' };
    if (!isAdminSync()) return { success: false, error: 'richiede admin' };
    try {
      const cmd = action === 'start' ? `net start "${name}"` : action === 'stop' ? `net stop "${name}"` : `sc query "${name}"`;
      const out = execSync(cmd, { windowsHide: true, encoding: 'utf-8', timeout: 8000 }).trim();
      auditLog('service', { action, name }, out.slice(0,400));
      return { success: true, output: out };
    } catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('system-audit-log', () => {
    try {
      const data = fs.existsSync(SYSTEM_LOG) ? fs.readFileSync(SYSTEM_LOG, 'utf-8').split('\n').filter(Boolean).slice(-100).join('\n') : '';
      return { success: true, log: data };
    } catch (e) { return { success: false, error: e.message }; }
  });

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
}

module.exports = { init };