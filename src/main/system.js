'use strict';

// ============================================================
// SYSTEM CONTROL — applicazioni, volume, luminosità, media,
// screenshot, ricerca file, info sistema.
// ============================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
const { app, ipcMain, desktopCapturer, shell } = require('electron');

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