'use strict';

// ============================================================
// COMMAND CENTER — file explorer (filesystem + dialog native)
// ============================================================

const path = require('path');
const os = require('os');
const fs = require('fs');
const { dialog, shell, ipcMain } = require('electron');

let getMainWindow = () => null;

function init(ctx) {
  getMainWindow = (ctx && ctx.getMainWindow) || getMainWindow;

  ipcMain.handle('list-directory', (event, dirPath) => {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true })
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
          } catch (e) { return null; }
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

  ipcMain.handle('delete-item', (event, itemPath) => {
    try {
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) fs.rmSync(itemPath, { recursive: true, force: true });
      else fs.unlinkSync(itemPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('rename-item', (event, oldPath, newName) => {
    try {
      const newPath = path.join(path.dirname(oldPath), newName);
      fs.renameSync(oldPath, newPath);
      return { success: true, newPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('select-directory-dialog', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      filters: [
        { name: 'Codice', extensions: ['js', 'ts', 'html', 'css', 'py', 'json', 'c', 'cpp', 'java', 'go', 'rs', 'md', 'yaml', 'yml', 'xml', 'sh', 'sql', 'rb', 'php', 'lua', 'r', 'swift', 'kt'] },
        { name: 'Tutti i file', extensions: ['*'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle('get-home-dir', () => ({ path: os.homedir() }));

  ipcMain.handle('open-in-explorer', (event, itemPath) => {
    try {
      shell.showItemInFolder(itemPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-drives', () => {
    const drives = [];
    if (process.platform === 'win32') {
      for (let i = 65; i <= 90; i++) {
        const drivePath = `${String.fromCharCode(i)}:\\`;
        if (fs.existsSync(drivePath)) drives.push({ name: drivePath, path: drivePath });
      }
    }
    return drives;
  });

  ipcMain.handle('read-file-preview', (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
      if (fs.statSync(filePath).size > 100 * 1024) return { success: false, error: 'File > 100KB' };
      const textExts = ['.js', '.ts', '.py', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.md', '.txt', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.sql', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.m', '.lua', '.toml', '.env', '.gitignore', '.dockerfile', '.cs', '.fs', '.fsx'];
      const ext = path.extname(filePath).toLowerCase();
      if (!textExts.includes(ext)) return { success: false, error: 'Unsupported file type' };
      const lines = fs.readFileSync(filePath, 'utf-8').substring(0, 500).split('\n').slice(0, 5).join('\n').trim();
      return { success: true, preview: lines || '(vuoto)' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { init };