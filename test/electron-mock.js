'use strict';

// ============================================================
// Electron mock — permette di caricare main.js in Node senza il
// runtime Electron. Installa un mock per il modulo 'electron' e
// neutralizza i timer globali durante le require, così gli
// interval/setTimeout di main.js non mantengono vivo il processo
// né eseguono PowerShell / notifiche in un contesto di test.
// ============================================================

const path = require('path');
const os = require('os');
const Module = require('module');

function noop() {}

const ELECTRON_MOCK = {
  app: {
    getPath: () => path.join(os.tmpdir(), 'savia-test-userdata'),
    getVersion: () => '4.0.0',
    on: noop,
    whenReady: () => new Promise(() => {}), // mai risolta → nessun window/realtime
    quit: noop
  },
  BrowserWindow: class {
    constructor() {
      this.webContents = { send: noop };
    }
    loadURL() { return Promise.resolve(); }
    on() {} once() {} show() {} hide() {} close() {} focus() {} restore() {}
    isDestroyed() { return false; }
    isMinimized() { return false; }
    isMaximized() { return false; }
    isVisible() { return false; }
    minimize() {} unmaximize() {} maximize() {}
    static getAllWindows() { return []; }
  },
  ipcMain: { handle: noop, on: noop },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  desktopCapturer: { getSources: async () => [] },
  Notification: function () {
    this.show = noop;
    this.on = noop;
  },
  protocol: { registerSchemesAsPrivileged: noop, handle: noop },
  Tray: function () {
    this.setToolTip = noop;
    this.setContextMenu = noop;
    this.on = noop;
    this.resize = () => this;
  },
  Menu: { buildFromTemplate: () => [] },
  globalShortcut: { register: () => true, unregisterAll: noop },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }),
    createFromDataURL: () => ({ isEmpty: () => false, resize: () => ({}) })
  }
};
ELECTRON_MOCK.Notification.isSupported = () => true;

// Installa mock di 'electron' + stub dei timer; restituisce restore().
function install() {
  const originalLoad = Module._load;
  const originalSetInterval = global.setInterval;
  const originalSetTimeout = global.setTimeout;
  const originalClearInterval = global.clearInterval;
  const originalClearTimeout = global.clearTimeout;

  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return ELECTRON_MOCK;
    return originalLoad.apply(this, arguments);
  };
  global.setInterval = () => 0;
  global.setTimeout = () => 0;
  global.clearInterval = noop;
  global.clearTimeout = noop;

  return function restore() {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    global.setTimeout = originalSetTimeout;
    global.clearInterval = originalClearInterval;
    global.clearTimeout = originalClearTimeout;
  };
}

module.exports = { install, ELECTRON_MOCK };