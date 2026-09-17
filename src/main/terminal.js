'use strict';

const os = require('os');
const path = require('path');
const { ipcMain } = require('electron');

let sendToAll = () => {};
const ptys = {};

function getDefaultShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function emit(ptyId, type, data) {
  sendToAll('terminal-pty-data', { ptyId, type, data });
}

function init(ctx) {
  sendToAll = (ctx && ctx.sendToAll) || sendToAll;

  ipcMain.handle('terminal-pty-create', (event, opts = {}) => {
    const ptyId = opts.id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5).toUpperCase();
    const cwd = opts.cwd || os.homedir();
    const shell = getDefaultShell();
    const cols = opts.cols || 120;
    const rows = opts.rows || 30;

    try {
      const pty = require('node-pty').spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' }
      });

      ptys[ptyId] = { pty, shell, cwd };

      pty.onData((data) => emit(ptyId, 'data', data));
      pty.onExit(({ exitCode }) => {
        delete ptys[ptyId];
        emit(ptyId, 'exit', exitCode);
      });

      return { success: true, ptyId, shell, cwd };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('terminal-pty-write', (event, { ptyId, data }) => {
    if (ptys[ptyId]) {
      try {
        ptys[ptyId].pty.write(data);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: 'PTY not found' };
  });

  ipcMain.handle('terminal-pty-resize', (event, { ptyId, cols, rows }) => {
    if (ptys[ptyId]) {
      try {
        ptys[ptyId].pty.resize(cols, rows);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: 'PTY not found' };
  });

  ipcMain.handle('terminal-pty-kill', (event, { ptyId }) => {
    if (ptys[ptyId]) {
      try {
        ptys[ptyId].pty.kill();
        delete ptys[ptyId];
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: 'PTY not found' };
  });

  ipcMain.handle('terminal-pty-cwd', (event, { ptyId }) => {
    if (ptys[ptyId]) {
      return { success: true, cwd: ptys[ptyId].cwd };
    }
    return { success: false, error: 'PTY not found' };
  });

  // Legacy support: keep old handlers working
  ipcMain.handle('terminal-set-cwd', (event, newCwd) => {
    return { success: true, cwd: newCwd };
  });

  ipcMain.handle('terminal-get-cwd', () => ({ cwd: os.homedir() }));
}

function stop() {
  Object.keys(ptys).forEach(id => {
    try { ptys[id].pty.kill(); } catch (e) { /* ignore */ }
    delete ptys[id];
  });
}

module.exports = { init, stop };
