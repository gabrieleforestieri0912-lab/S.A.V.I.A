'use strict';

// ============================================================
// Native OS Notifications (Windows toasts + PowerShell Action Center)
// Pure, browser-free: dedup logic + toast emission.
// `getWindow` è iniettato da main.js (mainWindow) per il focus on-click.
// ============================================================

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { Notification, ipcMain } = require('electron');

const ACTIVE_NOTIFS = []; // prevent GC
const NOTIF_DEDUP = new Map(); // key → timestamp (ms)
const NOTIF_COOLDOWN_MS = 30000; // same notification suppressed for 30s

let getWindow = () => null;

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

function revealMain() {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  }
}

async function sendWinToast(title, body, urgency) {
  if (isDuplicate(title, body)) return;

  // 1) Electron Notification (instant toast popup)
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title,
        body,
        urgency: urgency === 'critical' ? 'critical' : 'normal'
      });
      n.on('click', revealMain);
      n.on('close', () => {
        const i = ACTIVE_NOTIFS.indexOf(n);
        if (i > -1) ACTIVE_NOTIFS.splice(i, 1);
      });
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

function init(ctx) {
  getWindow = (ctx && ctx.getMainWindow) || getWindow;
  ipcMain.handle('send-notification', (event, { title, body, urgency }) => {
    sendWinToast(title, body, urgency);
  });
}

module.exports = {
  init,
  sendWinToast,
  dedupKey,
  isDuplicate,
  escapeSingle,
  NOTIF_DEDUP,
  NOTIF_COOLDOWN_MS
};