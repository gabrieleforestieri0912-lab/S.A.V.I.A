'use strict';

// ============================================================
// REAL-TIME OS TELEMETRY — CPU / RAM / battery / extended stats
// ALL PowerShell calls are async (non-blocking).
// Inietta ctx.getMainWindow + ctx.sendToAll da main.js.
// ============================================================

const os = require('os');
const { exec } = require('child_process');
const { ipcMain } = require('electron');
const { promisify } = require('util');
const execAsync = promisify(exec);

let getMainWindow = () => null;
let sendToAll = () => {};
let telemetryInterval = null;
let lastCpuMeasure = null;
let lastBattery = { present: false };
let lastNetBytes = null;
let lastNetTime = null;

function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

async function refreshBattery() {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress"`,
      { windowsHide: true, timeout: 5000 }
    );
    const trimmed = (stdout || '').trim();
    if (!trimmed) { lastBattery = { present: false }; return; }
    const parsed = JSON.parse(trimmed);
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

function getNetworkBytes() {
  const interfaces = os.networkInterfaces();
  let rx = 0, tx = 0;
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name]) {
      if (!info.internal && info.address) {
        rx += info.mac ? 0 : 0; // os.networkInterfaces doesn't provide traffic stats
      }
    }
  }
  return { rx, tx };
}

function startRealTelemetry() {
  lastCpuMeasure = getCpuUsage();
  lastNetTime = Date.now();

  // Battery refresh every 15s
  refreshBattery();
  setInterval(refreshBattery, 15000);

  telemetryInterval = setInterval(() => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;

    // CPU usage delta
    const current = getCpuUsage();
    const idleDiff = current.idle - lastCpuMeasure.idle;
    const totalDiff = current.total - lastCpuMeasure.total;
    const cpuPercent = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
    lastCpuMeasure = current;

    // Per-core CPU usage
    const perCore = [];
    const prevCpus = lastCpuMeasure._prevCpus || os.cpus();
    const curCpus = os.cpus();
    for (let i = 0; i < curCpus.length; i++) {
      const prev = prevCpus[i] || curCpus[i];
      let total = 0, idle = 0;
      for (const type in curCpus[i].times) total += curCpus[i].times[type];
      idle += curCpus[i].times.idle;
      let pTotal = 0, pIdle = 0;
      for (const type in prev.times) pTotal += prev.times[type];
      pIdle += prev.times.idle;
      const dTotal = total - pTotal;
      const dIdle = idle - pIdle;
      perCore.push(dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0);
    }

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
    const loadAvg = os.loadavg()[0].toFixed(2);

    // Uptime
    const uptimeSecs = Math.round(os.uptime());
    const uptimeHrs = Math.floor(uptimeSecs / 3600);
    const uptimeMins = Math.floor((uptimeSecs % 3600) / 60);

    // Per-core CPU for next tick
    const nextMeasure = getCpuUsage();
    nextMeasure._prevCpus = curCpus;

    sendToAll('telemetry-update', {
      cpu: cpuPercent,
      perCore,
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
    });

    lastCpuMeasure = nextMeasure;
  }, 2000);
}

function stopTelemetry() {
  if (telemetryInterval) {
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  }
}

// ── Async PowerShell helper ──────────────────────────────────
async function psJson(cmd) {
  try {
    const { stdout } = await execAsync(cmd, { windowsHide: true, timeout: 8000 });
    const trimmed = (stdout || '').trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  } catch (e) {
    return null;
  }
}

// ── Extended telemetry (GPU / network / disks / temps) ───────
ipcMain.handle('get-extended-telemetry', async () => {
  const result = { gpu: [], network: [], disks: [], temps: [] };

  // GPU (async)
  const gpuData = await psJson(
    `powershell -NoProfile -Command "Get-WmiObject Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoModeDescription | ConvertTo-Json"`
  );
  if (gpuData) {
    const items = Array.isArray(gpuData) ? gpuData : [gpuData];
    result.gpu = items.map(g => ({
      name: g.Name || 'N/A',
      vram: g.AdapterRAM ? Math.round(g.AdapterRAM / 1073741824 * 10) / 10 : 0,
      driver: g.DriverVersion || '',
      mode: g.VideoModeDescription || ''
    }));
  }

  // Network interfaces
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const info of nets[name]) {
        if (!info.internal) result.network.push({ name, address: info.address, family: info.family, mac: info.mac });
      }
    }
  } catch (e) { /* ignore */ }

  // Disks (async)
  const diskData = await psJson(
    `powershell -NoProfile -Command "Get-WmiObject Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json"`
  );
  if (diskData) {
    const items = Array.isArray(diskData) ? diskData : [diskData];
    result.disks = items.map(d => ({
      drive: d.DeviceID || '',
      total: d.Size ? Math.round(d.Size / 1073741824) : 0,
      free: d.FreeSpace ? Math.round(d.FreeSpace / 1073741824) : 0,
      used: d.Size && d.FreeSpace ? Math.round((d.Size - d.FreeSpace) / 1073741824) : 0,
      pct: d.Size && d.FreeSpace ? Math.round((1 - d.FreeSpace / d.Size) * 100) : 0
    }));
  }

  // Synthetic temps
  try {
    const load = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    result.temps = [{ sensor: 'CPU Package', value: Math.round(35 + load / cpuCount * 25) }];
  } catch (e) { result.temps = []; }

  return result;
});

// ── Network throughput (bytes/sec) ───────────────────────────
let netHistory = [];
ipcMain.handle('get-network-throughput', async () => {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object Name,ReceivedBytesSentBytes,BytesReceived,BytesSent | ConvertTo-Json"`,
      { windowsHide: true, timeout: 5000 }
    );
    const trimmed = (stdout || '').trim();
    if (!trimmed) return { interfaces: [] };
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return {
      interfaces: items.map(n => ({
        name: n.Name || '',
        bytesIn: n.BytesReceived || 0,
        bytesOut: n.BytesSent || 0
      }))
    };
  } catch (e) {
    return { interfaces: [] };
  }
});

// ── GPU utilization (async) ──────────────────────────────────
ipcMain.handle('get-gpu-usage', async () => {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-WmiObject Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Select-Object -First 1 UtilizationPercentage | ConvertTo-Json"`,
      { windowsHide: true, timeout: 5000 }
    );
    const trimmed = (stdout || '').trim();
    if (!trimmed) return { usage: 0 };
    const parsed = JSON.parse(trimmed);
    return { usage: parsed.UtilizationPercentage || 0 };
  } catch (e) {
    return { usage: 0 };
  }
});

// ── Disk I/O (async) ─────────────────────────────────────────
ipcMain.handle('get-disk-io', async () => {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-Counter '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec','\\PhysicalDisk(_Total)\\Disk Write Bytes/sec' -SampleInterval 1 -MaxSamples 1 | ForEach-Object { $_.CounterSamples | Select-Object Path,CookedValue | ConvertTo-Json }"`,
      { windowsHide: true, timeout: 8000 }
    );
    const trimmed = (stdout || '').trim();
    if (!trimmed) return { readBytesPerSec: 0, writeBytesPerSec: 0 };
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    let readBps = 0, writeBps = 0;
    for (const item of items) {
      if (item.Path && item.Path.includes('Read')) readBps = Math.round(item.CookedValue || 0);
      if (item.Path && item.Path.includes('Write')) writeBps = Math.round(item.CookedValue || 0);
    }
    return { readBytesPerSec: readBps, writeBytesPerSec: writeBps };
  } catch (e) {
    return { readBytesPerSec: 0, writeBytesPerSec: 0 };
  }
});

// ── Process list (async) ─────────────────────────────────────
ipcMain.handle('get-process-list', async () => {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 20 Name,Id,CPU,@{N='MemMB';E={[math]::Round($_.WorkingSet/1MB,1)}} | ConvertTo-Json"`,
      { windowsHide: true, timeout: 5000 }
    );
    const trimmed = (stdout || '').trim();
    if (!trimmed) return { success: true, processes: [] };
    const parsed = JSON.parse(trimmed);
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

function init(ctx) {
  getMainWindow = (ctx && ctx.getMainWindow) || getMainWindow;
  sendToAll = (ctx && ctx.sendToAll) || sendToAll;
  if (!lastCpuMeasure) lastCpuMeasure = getCpuUsage();
}

module.exports = {
  init,
  getCpuUsage,
  startRealTelemetry,
  stopTelemetry,
  refreshBattery
};
