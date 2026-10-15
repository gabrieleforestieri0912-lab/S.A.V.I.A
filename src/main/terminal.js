'use strict';

// ============================================================
// TERMINAL (PTY) — shell selezionabile + PATH arricchito per npm/node
// Supporta: cmd, powershell, pwsh, git-bash, wsl (win) / bash, zsh,
// sh, fish (posix). Lo shell di default resta quello di sistema.
// ============================================================

const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const { ipcMain } = require('electron');

let sendToAll = () => {};
const ptys = {};

// ── PATH arricchito: dove npm/node vivono davvero su Windows ──────────
function extraPathDirs() {
  const dirs = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(
      path.join(pf, 'nodejs'),
      path.join(pf86, 'nodejs'),
      path.join(appData, 'npm'),
      path.join(localApp, 'Volta', 'bin'),
      path.join(home, '.volta', 'bin'),
      path.join(appData, 'nvm'),
      path.join(home, 'scoop', 'shims'),
      path.join(localApp, 'fnm', 'multishells'),
      'C:\\Windows\\System32',
      'C:\\Windows'
    );
    // nvm-windows: versione attiva via symlink
    try {
      const nvmDir = path.join(appData, 'nvm');
      if (fs.existsSync(nvmDir)) {
        for (const e of fs.readdirSync(nvmDir)) {
          const p = path.join(nvmDir, e);
          try { if (fs.statSync(p).isDirectory() && /^v?\d+\.\d+/.test(e)) dirs.push(p); } catch (err) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }
    // fnm multishells: sottocartelle con node
    try {
      const multi = path.join(localApp, 'fnm', 'multishells');
      if (fs.existsSync(multi)) {
        for (const e of fs.readdirSync(multi)) dirs.push(path.join(multi, e, 'bin'));
      }
    } catch (e) { /* ignore */ }
  } else {
    dirs.push(
      '/usr/local/bin', '/opt/homebrew/bin', path.join(home, '.nvm'),
      path.join(home, '.volta', 'bin'), path.join(home, '.fnm'),
      path.join(home, '.local', 'bin')
    );
  }
  return dirs.filter(d => { try { return fs.existsSync(d); } catch (e) { return false; } });
}

function buildEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' };
  const sep = process.platform === 'win32' ? ';' : ':';
  const current = (env.PATH || env.Path || '').split(sep).filter(Boolean);
  const seen = new Set(current.map(c => c.toLowerCase()));
  for (const d of extraPathDirs()) {
    if (!seen.has(d.toLowerCase())) { current.push(d); seen.add(d.toLowerCase()); }
  }
  env.PATH = current.join(sep);
  if (process.platform === 'win32') env.Path = env.PATH;
  return env;
}

function whichSync(cmd) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where', [cmd], { windowsHide: true, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
      return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || null;
    }
    const out = execFileSync('which', [cmd], { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() || null;
  } catch (e) {
    return null;
  }
}

// ── Shell disponibili ────────────────────────────────────────────────
function candidateShells() {
  if (process.platform === 'win32') {
    const gitBash = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe')
    ].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
    return [
      { id: 'cmd', label: 'CMD', exe: process.env.COMSPEC || 'cmd.exe', args: [], kind: 'cmd' },
      { id: 'powershell', label: 'PowerShell', exe: 'powershell.exe', args: ['-NoLogo'], kind: 'ps' },
      { id: 'pwsh', label: 'PowerShell 7 (pwsh)', exe: 'pwsh.exe', args: ['-NoLogo'], kind: 'ps' },
      ...(gitBash ? [{ id: 'git-bash', label: 'Git Bash', exe: gitBash, args: ['--login', '-i'], kind: 'bash' }] : []),
      { id: 'wsl', label: 'WSL', exe: 'wsl.exe', args: [], kind: 'bash' }
    ];
  }
  return [
    { id: 'bash', label: 'Bash', exe: process.env.SHELL && process.env.SHELL.includes('bash') ? process.env.SHELL : '/bin/bash', args: ['--login'], kind: 'bash' },
    { id: 'zsh', label: 'Zsh', exe: '/bin/zsh', args: ['-l'], kind: 'bash' },
    { id: 'sh', label: 'sh', exe: '/bin/sh', args: [], kind: 'bash' },
    { id: 'fish', label: 'Fish', exe: '/usr/bin/fish', args: [], kind: 'bash' }
  ];
}

function listShells() {
  const envPath = buildEnv();
  const savedPath = process.env.PATH;
  try { process.env.PATH = envPath.PATH; } catch (e) { /* ignore */ }
  const out = candidateShells().map(s => {
    let available = false;
    try {
      if (path.isAbsolute(s.exe)) available = fs.existsSync(s.exe);
      else available = !!whichSync(s.exe.replace(/\.exe$/, ''));
    } catch (e) { available = false; }
    if (s.id === 'cmd') available = true;
    return { id: s.id, label: s.label, kind: s.kind, available };
  });
  try { if (savedPath !== undefined) process.env.PATH = savedPath; } catch (e) { /* ignore */ }
  return out;
}

function resolveShell(id) {
  const cands = candidateShells();
  let sel = cands.find(s => s.id === id);
  if (!sel) sel = cands[0];
  // Se lo shell scelto non è disponibile, ripiega sul primo disponibile
  const avail = listShells();
  if (!avail.find(s => s.id === sel.id && s.available)) {
    const fallback = avail.find(s => s.available);
    if (fallback) sel = cands.find(s => s.id === fallback.id) || cands[0];
  }
  return sel;
}

function getDefaultShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
  return process.env.SHELL || '/bin/bash';
}

function emit(ptyId, type, data) {
  sendToAll('terminal-pty-data', { ptyId, type, data });
}

// Controllo rapido node/npm con PATH arricchito (per badge UI).
// Su Windows npm è npm.cmd: serve il fallback esplicito (spawnSync non
// risolve PATHEXT senza shell).
function envCheck() {
  const env = buildEnv();
  const run = (cmd, args) => {
    try {
      let r;
      if (process.platform === 'win32' && !cmd.endsWith('.exe')) {
        // .cmd/.bat non sono eseguibili diretti per spawn: passa da cmd.exe
        r = spawnSync('cmd.exe', ['/d', '/s', '/c', cmd + ' ' + args.join(' ')], { env, windowsHide: true, encoding: 'utf-8', timeout: 8000 });
      } else {
        r = spawnSync(cmd, args, { env, windowsHide: true, encoding: 'utf-8', timeout: 8000 });
      }
      if (r.status === 0) {
        const out = ((r.stdout || '') + ' ' + (r.stderr || '')).trim();
        return { ok: true, version: out.split(/\r?\n/)[0].trim().substring(0, 60) };
      }
      const errName = r.error ? r.error.code || r.error.message : 'exit ' + r.status;
      return { ok: false, version: String(errName).substring(0, 60) };
    } catch (e) {
      return { ok: false, version: String(e.message).substring(0, 60) };
    }
  };
  return { node: run('node', ['--version']), npm: run('npm', ['--version']) };
}

function init(ctx) {
  sendToAll = (ctx && ctx.sendToAll) || sendToAll;

  ipcMain.handle('terminal-shells', () => ({ success: true, shells: listShells() }));
  ipcMain.handle('terminal-env-check', () => ({ success: true, ...envCheck() }));

  ipcMain.handle('terminal-pty-create', (event, opts = {}) => {
    const ptyId = opts.id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5).toUpperCase();
    const cwd = opts.cwd || os.homedir();
    const sel = opts.shell ? resolveShell(String(opts.shell)) : null;
    const shell = sel ? sel.exe : getDefaultShell();
    const shellArgs = sel ? sel.args : [];
    const shellId = sel ? sel.id : 'default';
    const cols = opts.cols || 120;
    const rows = opts.rows || 30;

    try {
      const pty = require('node-pty').spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: buildEnv()
      });

      ptys[ptyId] = { pty, shell, shellId, cwd };

      pty.onData((data) => emit(ptyId, 'data', data));
      pty.onExit(({ exitCode }) => {
        delete ptys[ptyId];
        emit(ptyId, 'exit', exitCode);
      });

      return { success: true, ptyId, shell, shellId, cwd };
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
      return { success: true, cwd: ptys[ptyId].cwd, shellId: ptys[ptyId].shellId };
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

module.exports = { init, stop, listShells, resolveShell, envCheck };
