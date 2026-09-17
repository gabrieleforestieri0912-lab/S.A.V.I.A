'use strict';

// ============================================================
// VECTOR FILE INDEXING — fs.watcher ricorsivo su una directory
// ============================================================

const path = require('path');
const os = require('os');
const fs = require('fs');
const { ipcMain } = require('electron');

let sendToAll = () => {};
let fsWatcherHandle = null;
let fsWatchedPath = null;
let fsIndexedFiles = [];

function scanDir(dir, depth, out) {
  if (depth > 4) return; // Safety limit
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        scanDir(fullPath, depth + 1, out);
      } else if (entry.isFile()) {
        out.push({
          name: entry.name,
          path: fullPath,
          ext: path.extname(entry.name).toLowerCase(),
          size: fs.statSync(fullPath).size
        });
      }
    });
  } catch (e) { /* permission errors ignored */ }
}

function stopWatcher() {
  if (fsWatcherHandle) {
    fsWatcherHandle.close();
    fsWatcherHandle = null;
  }
}

function init(ctx) {
  sendToAll = (ctx && ctx.sendToAll) || sendToAll;

  ipcMain.handle('fs-index-start', (event, dirPath) => {
    stopWatcher();
    const targetPath = dirPath || path.join(os.homedir(), 'Documents', 'Progetti');
    if (!fs.existsSync(targetPath)) return { success: false, error: `Path not found: ${targetPath}` };

    fsWatchedPath = targetPath;
    fsIndexedFiles = [];
    scanDir(targetPath, 0, fsIndexedFiles);

    try {
      fsWatcherHandle = fs.watch(targetPath, { recursive: true }, (eventType, filename) => {
        if (filename) {
          sendToAll('fs-event', {
            type: eventType,
            file: filename,
            path: path.join(targetPath, filename),
            time: new Date().toISOString()
          });
        }
      });
    } catch (e) { /* recursive watch not supported on all systems */ }

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
    stopWatcher();
    return { success: true, indexed: fsIndexedFiles.length };
  });

  ipcMain.handle('fs-index-status', () => ({
    active: !!fsWatcherHandle,
    watchedPath: fsWatchedPath,
    indexedCount: fsIndexedFiles.length
  }));
}

module.exports = { init, stop: stopWatcher };