/**
 * S.A.V.I.A — PROXIMITY ENGINE
 * Rilevamento dispositivi vicini via BLE RSSI (backend bleak/Python)
 * e sblocco telefonico automatico via ADB Wireless Debugging.
 * (Main process / Node.js — nessuna dipendenza DOM)
 */

const { spawn, execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DEFAULTS = {
  pythonPath: '',
  adbPath: '',
  threshold: -65,     // RSSI (dBm) per considerare un device "vicino"
  cooldownSec: 60,    // min secondi tra due sblocchi dello stesso device
  checkInterval: 3000, // ms per il ciclo di valutazione prossimità
  devices: []         // {name, mac, type:'android'|'ios'|'ble', adbHost, adbPort, autoUnlock, networkTrigger}
};

let cfg = { ...DEFAULTS };
let scanner = null;          // child python
let scannerReady = false;
let scannerFatal = null;     // msg errore backend
let bleakOk = null;          // bool | null (non testato)
let backendChecked = false;
let ads = new Map();         // mac -> {mac,name,rssi,lastSeen}
let conn = new Map();        // hostPort -> {ok, lastTry, error}
let states = new Map();      // mac -> {near, lastUnlock, lastNetOk}
let onEvent = null;          // (type, payload) → main → UI
let tickTimer = null;
let resPython = null;        // cache risoluzione python
let resAdb = null;           // cache risoluzione adb

function setConfig(patch) {
  cfg = { ...cfg, ...(patch || {}) };
  if (!Array.isArray(cfg.devices)) cfg.devices = [];
  resPython = null;
  resAdb = null;
}

function setEventSink(cb) { onEvent = cb; }

function emit(type, payload) {
  if (onEvent) { try { onEvent(type, payload); } catch (e) { /* ignore */ } }
}

function log(msg, level = 'sys') {
  emit('log', { level, msg, time: new Date().toISOString() });
}

function execFileSafe(cmd, args, timeout = 6000) {
  try {
    const out = execFileSync(cmd, args, { timeout, encoding: 'utf-8', windowsHide: true });
    return (out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Python discovery ────────────────────────────────────────────
function findPython() {
  if (resPython) return resPython;
  if (cfg.pythonPath && fs.existsSync(cfg.pythonPath)) { resPython = cfg.pythonPath; return resPython; }
  const onPath = [];
  onPath.push(...execFileSafe('where', ['python']));
  onPath.push(...execFileSafe('where', ['py']));
  const home = os.homedir();
  const roots = [
    path.join(home, 'AppData', 'Local', 'Programs', 'Python'),
    'C:\\Python311', 'C:\\Python312', 'C:\\Python313',
    'C:\\Program Files\\Python311', 'C:\\Program Files\\Python312',
    'C:\\Program Files\\Python313'
  ];
  const exes = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    try {
      for (const d of fs.readdirSync(r)) {
        if (d.toLowerCase().startsWith('python') && d.toLowerCase().endsWith('.exe')) exes.push(path.join(r, d));
      }
    } catch { /* ignore */ }
  }
  for (const p of [...onPath, ...exes]) {
    try {
      execFileSync(p, ['-c', 'import sys;sys.exit(0)'], { timeout: 4000, windowsHide: true, stdio: 'ignore' });
      resPython = p;
      return resPython;
    } catch { /* continue */ }
  }
  resPython = onPath[0] || 'python';
  return resPython;
}

// ── ADB helpers ─────────────────────────────────────────────────
function findAdb() {
  if (resAdb) return resAdb;
  if (cfg.adbPath && fs.existsSync(cfg.adbPath)) { resAdb = cfg.adbPath; return resAdb; }
  const local = path.join(__dirname, '..', 'tools', 'platform-tools', 'adb.exe');
  if (fs.existsSync(local)) { resAdb = local; return resAdb; }
  const paths = execFileSafe('where', ['adb']);
  resAdb = paths[0] || null;
  return resAdb;
}

function adbRun(args, timeout = 8000) {
  return new Promise((resolve) => {
    const bin = findAdb();
    if (!bin) return resolve({ ok: false, error: 'adb non trovato' });
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: (err.message || ''), output: ((stdout || '') + (stderr || '')).trim() });
        return;
      }
      resolve({ ok: true, output: (stdout || stderr || '').trim() });
    });
  });
}

async function adbDevices() {
  const r = await adbRun(['devices', '-l']);
  if (!r.ok) return { ok: false, devices: [], error: r.error };
  const devices = [];
  for (const line of r.output.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\S+)/);
    if (m && (m[2] === 'device' || m[2] === 'unauthorized')) {
      devices.push({ serial: m[1], state: m[2] });
    }
  }
  return { ok: true, devices };
}

async function adbEnsureConnected(hostPort) {
  if (!hostPort) return { ok: false, error: 'ADB host:port mancante' };
  const prev = conn.get(hostPort);
  const now = Date.now();
  if (prev && prev.ok && (now - prev.lastTry) < 20000) return { ok: true, serial: hostPort };
  const r = await adbRun(['connect', hostPort]);
  const ok = r.ok && /connected|already/i.test(r.output);
  const errTxt = ok ? null : (r.output || r.error);
  conn.set(hostPort, { ok, lastTry: now, error: errTxt });
  if (!ok && errTxt) log(`ADB connect ${hostPort}: ${errTxt}`, 'warn');
  return { ok, serial: hostPort, error: errTxt };
}

async function adbUnlock(hostPort) {
  const st = await adbEnsureConnected(hostPort);
  if (!st.ok) return { ok: false, error: (st.error) || 'non connesso' };
  const serial = hostPort;
  await adbRun(['-s', serial, 'shell', 'input', 'keyevent', '224']); // KEYCODE_WAKEUP
  await adbRun(['-s', serial, 'shell', 'wm', 'dismiss-keyguard']);
  return { ok: true, serial };
}

// ── BLE scanner process ─────────────────────────────────────────
function ensureBleak() {
  return new Promise((resolve) => {
    const py = findPython();
    execFile(py, ['-c', 'import bleak'], { timeout: 6000, windowsHide: true }, (err) => {
      bleakOk = !err;
      resolve(!err);
    });
  });
}

async function start() {
  if (scanner) return status();
  const py = findPython();
  if (!backendChecked) {
    const hasBleak = await ensureBleak();
    backendChecked = true;
    if (!hasBleak) {
      scannerFatal = `bleak non installato in "${py}" (usa INSTALLA DIPENDENZE BLE)`;
      log(scannerFatal, 'error');
      emit('backend', { status: 'missing-deps', python: py });
      return status();
    }
  }
  scannerReady = false;
  scannerFatal = null;
  const script = path.join(__dirname, '..', 'tools', 'ble-scan.py');
  scanner = spawn(py, [script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

  let buf = '';
  scanner.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { handleBleRecord(JSON.parse(line)); } catch { /* righe non JSON */ }
    }
  });
  scanner.stderr.on('data', (d) => log('ble-scan: ' + d.toString().trim(), 'warn'));
  scanner.on('close', (code) => {
    const wasAlive = !scannerFatal;
    scanner = null;
    scannerReady = false;
    if (wasAlive) log(`scanner BLE terminato (codice ${code})`, 'warn');
    emit('backend', { status: 'stopped' });
  });
  scanner.on('error', (e) => {
    scannerFatal = e.message;
    scanner = null;
    log('avvio scanner BLE fallito: ' + e.message, 'error');
    emit('backend', { status: 'error', error: e.message });
  });

  if (!tickTimer) tickTimer = setInterval(evaluate, cfg.checkInterval || 3000);
  return status();
}

function stop() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (scanner) { try { scanner.kill(); } catch { /* ignore */ } scanner = null; }
  scannerReady = false;
  emit('backend', { status: 'stopped' });
  return status();
}

function handleBleRecord(rec) {
  if (rec.t === 'ready') {
    scannerReady = true;
    log('scanner BLE attivo (backend bleak)', 'ok');
    emit('backend', { status: 'up' });
    return;
  }
  if (rec.t === 'fatal') {
    scannerFatal = rec.msg;
    log('scanner BLE fatal: ' + rec.msg, 'error');
    emit('backend', { status: 'error', error: rec.msg });
    return;
  }
  if (rec.t === 'adv') {
    ads.set(rec.mac, {
      mac: rec.mac,
      name: rec.name || '',
      rssi: typeof rec.rssi === 'number' ? rec.rssi : -100,
      lastSeen: Date.now()
    });
  }
}

// ── Prossimità + sblocco ────────────────────────────────────────
function avgRssi(mac, recentMs = 4000) {
  const v = ads.get(mac);
  if (!v || (Date.now() - v.lastSeen) > recentMs) return null;
  return v.rssi;
}

function stateFor(mac) {
  if (!states.has(mac)) states.set(mac, { near: false, lastUnlock: 0, lastNetOk: 0 });
  return states.get(mac);
}

async function evaluate() {
  const known = cfg.devices;
  if (!known.length) return;
  const now = Date.now();

  for (const dev of known) {
    if (!dev.mac) continue;
    const st = stateFor(dev.mac);
    const rssi = avgRssi(dev.mac);
    const bleNear = rssi !== null && rssi >= cfg.threshold;

    let netOk = false;
    if (dev.networkTrigger && dev.adbHost) {
      if (st.near) {
        netOk = true;
      } else if ((now - st.lastNetOk) > 15000) {
        const c = await adbEnsureConnected(dev.adbHost + ':' + (dev.adbPort || 5555));
        netOk = c.ok;
        if (netOk) st.lastNetOk = now;
      }
    }

    const near = bleNear || netOk;
    if (near) {
      if (!st.near) {
        st.near = true;
        emit('device', { mac: dev.mac, name: dev.name, state: 'near', rssi, method: bleNear ? 'ble' : 'network' });
        log(`Device vicino: ${dev.name} (${bleNear ? 'BLE ' + rssi + ' dBm' : 'rete ADB'})`, 'savia');
        if (dev.autoUnlock && dev.adbHost && (now - st.lastUnlock) >= (cfg.cooldownSec * 1000)) {
          st.lastUnlock = now;
          const res = await unlockDevice(dev);
          if (res.ok) emit('device', { mac: dev.mac, name: dev.name, state: 'unlocked', serial: res.serial });
          else emit('device', { mac: dev.mac, name: dev.name, state: 'unlock-failed', error: res.error });
        }
      }
    } else if (st.near) {
      st.near = false;
      emit('device', { mac: dev.mac, name: dev.name, state: 'away' });
      log(`Device lontano: ${dev.name}`, 'sys');
    }
  }
}

async function unlockDevice(dev) {
  if (!dev.adbHost) return { ok: false, error: 'Nessun host ADB configurato per ' + dev.name };
  const hostPort = dev.adbHost + ':' + (dev.adbPort || 5555);
  const res = await adbUnlock(hostPort);
  if (res.ok) log(`Sbloccato ${dev.name} (${hostPort})`, 'ok');
  else log(`Sblocco fallito ${dev.name}: ${res.error}`, 'error');
  return res;
}

// ── Download platform-tools (adb) ──────────────────────────────
function downloadPlatformTools() {
  return new Promise((resolve) => {
    const url = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
    const toolsDir = path.join(__dirname, '..', 'tools');
    const zipPath = path.join(toolsDir, 'platform-tools.zip');
    const targetDir = path.join(toolsDir, 'platform-tools');
    if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
    log('Download platform-tools (~10MB)...', 'warn');
    emit('adb', { status: 'downloading' });

    const https = require('https');
    const file = fs.createWriteStream(zipPath);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 400) {
        file.close();
        log('Download adb fallito (HTTP ' + res.statusCode + ')', 'error');
        return resolve({ ok: false, error: 'HTTP ' + res.statusCode });
      }
      res.pipe(file);
      file.on('finish', async () => {
        file.close();
        try {
          const { execFileSync } = require('child_process');
          const ps = [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${toolsDir}' -Force`
          ];
          execFileSync('powershell.exe', ps, { timeout: 60000, windowsHide: true, encoding: 'utf-8' });
          const adbExe = path.join(targetDir, 'adb.exe');
          if (!fs.existsSync(adbExe)) return resolve({ ok: false, error: 'adb.exe non trovato dopo l\'estrazione' });
          cfg.adbPath = adbExe;
          log('ADB pronto: ' + adbExe, 'ok');
          emit('adb', { status: 'ok', path: adbExe });
          resolve({ ok: true, path: adbExe });
        } catch (e) {
          log('Estrazione platform-tools fallita: ' + e.message, 'error');
          resolve({ ok: false, error: e.message });
        } finally {
          try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
        }
      });
    });
    req.on('error', (e) => {
      file.close();
      log('Download adb fallito: ' + e.message, 'error');
      resolve({ ok: false, error: e.message });
    });
    try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
  });
}

// ── Manage devices ──────────────────────────────────────────────
function addDevice(dev) {
  const clean = { ...(dev || {}) };
  if (clean.mac) clean.mac = clean.mac.toUpperCase();
  cfg.devices = (cfg.devices || []).filter(d => !(d.mac && d.mac.toUpperCase() === clean.mac));
  cfg.devices.push(clean);
  return { ok: true, devices: cfg.devices };
}

function removeDevice(mac) {
  const target = (mac || '').toUpperCase();
  cfg.devices = (cfg.devices || []).filter(d => !(d.mac && d.mac.toUpperCase() === target));
  return { ok: true, devices: cfg.devices };
}

// ── Status ──────────────────────────────────────────────────────
function nearbyList() {
  const now = Date.now();
  return Array.from(ads.values())
    .filter(a => (now - a.lastSeen) < 6000)
    .sort((a, b) => b.rssi - a.rssi)
    .slice(0, 40);
}

function status() {
  const known = (cfg.devices || []).map(dev => {
    const st = stateFor(dev.mac);
    const rssi = avgRssi(dev.mac);
    const connState = dev.adbHost ? conn.get(dev.adbHost + ':' + (dev.adbPort || 5555)) : null;
    return {
      ...dev,
      near: !!st.near,
      rssi,
      adbConnected: !!(connState && connState.ok)
    };
  });
  const adb = findAdb();
  return {
    running: !!scanner,
    scannerReady,
    backend: scannerFatal ? 'error' : (scannerReady ? 'up' : (backendChecked && bleakOk === false ? 'missing-deps' : 'stopped')),
    backendError: scannerFatal,
    python: findPython(),
    adbPath: adb,
    adbAvailable: !!adb,
    adbDevices: [],
    threshold: cfg.threshold,
    cooldownSec: cfg.cooldownSec,
    nearby: nearbyList(),
    knownDevices: known
  };
}

async function fullStatus() {
  const s = status();
  if (s.adbAvailable) {
    const r = await adbDevices();
    s.adbDevices = r.devices || [];
  }
  return s;
}

function installDeps() {
  return new Promise((resolve) => {
    const py = findPython();
    log(`Installazione bleak via "${py}"...`, 'warn');
    emit('backend', { status: 'installing' });
    const p = spawn(py, ['-m', 'pip', 'install', '--quiet', 'bleak'], { windowsHide: true });
    p.on('close', (code) => {
      backendChecked = false;
      if (code === 0) { log('bleak installato', 'ok'); emit('backend', { status: 'deps-ok' }); resolve({ ok: true }); }
      else { log('installazione bleak fallita', 'error'); emit('backend', { status: 'deps-fail' }); resolve({ ok: false }); }
    });
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

module.exports = {
  setConfig, setEventSink, status, fullStatus,
  start, stop,
  addDevice, removeDevice,
  installDeps, downloadPlatformTools,
  pair: async (hostPort, code) => {
    const r = await adbRun(['pair', hostPort, String(code || '')]);
    if (r.ok) log(`ADB pairing riuscito: ${hostPort}`, 'ok');
    else log(`ADB pairing fallito: ${r.output || r.error}`, 'error');
    return { ok: r.ok, output: r.output || r.error };
  },
  connect: async (hostPort) => {
    hostPort = String(hostPort || '').replace(/ /g, '');
    if (!/^\d+\.\d+\.\d+\.\d+:\d+$/.test(hostPort)) return { ok: false, error: 'Formato host:port non valido' };
    const r = await adbEnsureConnected(hostPort);
    if (r.ok) log(`ADB connesso: ${hostPort}`, 'ok');
    return r;
  },
  testAdb: async (hostPort) => {
    const r = await adbRun(['-s', hostPort, 'get-state']);
    return { ok: r.ok && r.output.trim() === 'device', output: r.output || r.error };
  },
  unlockNow: async (mac) => {
    const dev = (cfg.devices || []).find(d => d.mac && d.mac.toUpperCase() === String(mac || '').toUpperCase());
    if (!dev) return { ok: false, error: 'Dispositivo non noto' };
    stateFor(dev.mac).lastUnlock = 0;
    const res = await unlockDevice(dev);
    if (res.ok) emit('device', { mac: dev.mac, name: dev.name, state: 'unlocked', manual: true, serial: res.serial });
    else emit('device', { mac: dev.mac, name: dev.name, state: 'unlock-failed', manual: true, error: res.error });
    return res;
  }
};