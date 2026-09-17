/**
 * S.A.V.I.A - System Stats Dashboard
 * Real-time scrolling canvas graphs for CPU, RAM, Network, GPU, Disk I/O, Temperature.
 * ALL data collection is async (non-blocking).
 */

(function () {
  'use strict';

  const MAX_POINTS = 120; // 2 minutes of 1s data
  const POLL_INTERVAL = 1000; // 1 second

  // ── Data stores ────────────────────────────────────────────
  const data = {
    cpu: [],
    ram: [],
    netIn: [],
    netOut: [],
    gpu: [],
    diskRead: [],
    diskWrite: [],
    temp: [],
    perCore: [] // array of arrays
  };

  let sysInfo = null;
  let extendedInfo = null;
  let lastNetBytes = { in: 0, out: 0 };
  let lastNetTime = Date.now();

  // ── Canvas contexts ────────────────────────────────────────
  const canvases = {};
  const ctxs = {};

  function initCanvases() {
    const ids = ['chart-cpu', 'chart-ram', 'chart-net-in', 'chart-net-out', 'chart-gpu', 'chart-disk-io', 'chart-temp', 'chart-per-core'];
    for (const id of ids) {
      const canvas = document.getElementById(id);
      if (!canvas) continue;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext('2d');
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      canvases[id] = canvas;
      ctxs[id] = ctx;
    }
  }

  // ── Scrolling chart drawer ─────────────────────────────────
  function drawChart(canvasId, values, color, maxVal, unit, fillAlpha) {
    const canvas = canvases[canvasId];
    const ctx = ctxs[canvasId];
    if (!canvas || !ctx) return;

    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;

    ctx.clearRect(0, 0, w, h);

    if (values.length < 2) return;

    const step = w / (MAX_POINTS - 1);
    const offset = (MAX_POINTS - values.length) * step;

    // Grid lines
    ctx.strokeStyle = '#1a2332';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Fill gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color + (fillAlpha || '40'));
    gradient.addColorStop(1, color + '05');

    ctx.beginPath();
    ctx.moveTo(offset, h);

    for (let i = 0; i < values.length; i++) {
      const x = offset + i * step;
      const y = h - (Math.min(values[i], maxVal) / maxVal) * h;
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.lineTo(offset + (values.length - 1) * step, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = offset + i * step;
      const y = h - (Math.min(values[i], maxVal) / maxVal) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Glow at the end
    if (values.length > 0) {
      const lastX = offset + (values.length - 1) * step;
      const lastY = h - (Math.min(values[values.length - 1], maxVal) / maxVal) * h;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
      ctx.fillStyle = color + '40';
      ctx.fill();
    }

    // Current value label
    if (values.length > 0) {
      const current = values[values.length - 1];
      const label = current.toFixed(1) + unit;
      ctx.font = '10px Share Tech Mono';
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.fillText(label, w - 4, 14);
    }
  }

  // ── Per-core bar chart ─────────────────────────────────────
  function drawPerCore(values) {
    const canvas = canvases['chart-per-core'];
    const ctx = ctxs['chart-per-core'];
    if (!canvas || !ctx) return;

    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    if (!values || values.length === 0) return;

    const barWidth = Math.max(4, (w / values.length) - 4);
    const gap = 4;
    const totalWidth = values.length * (barWidth + gap) - gap;
    const startX = (w - totalWidth) / 2;

    for (let i = 0; i < values.length; i++) {
      const x = startX + i * (barWidth + gap);
      const barH = (Math.min(values[i], 100) / 100) * (h - 20);
      const y = h - barH - 14;

      // Bar background
      ctx.fillStyle = '#1a2332';
      ctx.fillRect(x, 10, barWidth, h - 24);

      // Bar fill
      const hue = values[i] < 50 ? 140 : values[i] < 80 ? 40 : 0;
      const color = `hsl(${hue}, 100%, 50%)`;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth, barH);

      // Label
      ctx.font = '8px Share Tech Mono';
      ctx.fillStyle = '#888';
      ctx.textAlign = 'center';
      ctx.fillText(`C${i}`, x + barWidth / 2, h - 2);

      // Value on top
      ctx.fillStyle = color;
      ctx.fillText(values[i] + '%', x + barWidth / 2, y - 3);
    }
  }

  // ── Update displays ────────────────────────────────────────
  function updateValues() {
    // CPU
    const cpuVal = data.cpu.length > 0 ? data.cpu[data.cpu.length - 1] : 0;
    document.getElementById('cpu-val').textContent = cpuVal + '%';

    // RAM
    const ramVal = data.ram.length > 0 ? data.ram[data.ram.length - 1] : 0;
    document.getElementById('ram-val').textContent = ramVal.toFixed(1) + ' GB';

    // Network
    const netInVal = data.netIn.length > 0 ? data.netIn[data.netIn.length - 1] : 0;
    const netOutVal = data.netOut.length > 0 ? data.netOut[data.netOut.length - 1] : 0;
    document.getElementById('net-in-val').textContent = formatBytes(netInVal) + '/s';
    document.getElementById('net-out-val').textContent = formatBytes(netOutVal) + '/s';

    // GPU
    const gpuVal = data.gpu.length > 0 ? data.gpu[data.gpu.length - 1] : 0;
    document.getElementById('gpu-val').textContent = gpuVal + '%';

    // Disk I/O
    const diskRead = data.diskRead.length > 0 ? data.diskRead[data.diskRead.length - 1] : 0;
    const diskWrite = data.diskWrite.length > 0 ? data.diskWrite[data.diskWrite.length - 1] : 0;
    document.getElementById('disk-io-val').textContent = formatBytes(diskRead + diskWrite) + '/s';

    // Temperature
    const tempVal = data.temp.length > 0 ? data.temp[data.temp.length - 1] : 0;
    const tempEl = document.getElementById('temp-val');
    tempEl.textContent = tempVal + ' °C';
    tempEl.style.color = tempVal > 70 ? '#ff3366' : tempVal > 50 ? '#ffcc00' : '#00ff88';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function formatUptime(hrs, mins) {
    return `${hrs}h ${mins}m`;
  }

  // ── Push data point ────────────────────────────────────────
  function pushPoint(arr, val) {
    arr.push(val);
    if (arr.length > MAX_POINTS) arr.shift();
  }

  // ── Main poll loop ─────────────────────────────────────────
  async function pollStats() {
    try {
      // Real-time telemetry (CPU, RAM, per-core) — already pushed from main process
      // We just need extended stats

      // Network throughput
      if (window.electronAPI && window.electronAPI.getNetworkThroughput) {
        const netData = await window.electronAPI.getNetworkThroughput();
        if (netData && netData.interfaces) {
          let totalIn = 0, totalOut = 0;
          for (const iface of netData.interfaces) {
            totalIn += iface.bytesIn || 0;
            totalOut += iface.bytesOut || 0;
          }
          const now = Date.now();
          const dt = (now - lastNetTime) / 1000;
          if (dt > 0 && lastNetBytes.in > 0) {
            const rateIn = (totalIn - lastNetBytes.in) / dt;
            const rateOut = (totalOut - lastNetBytes.out) / dt;
            pushPoint(data.netIn, Math.max(0, rateIn));
            pushPoint(data.netOut, Math.max(0, rateOut));
          }
          lastNetBytes = { in: totalIn, out: totalOut };
          lastNetTime = now;
        }
      }

      // GPU usage
      if (window.electronAPI && window.electronAPI.getGpuUsage) {
        const gpuData = await window.electronAPI.getGpuUsage();
        if (gpuData) {
          pushPoint(data.gpu, gpuData.usage || 0);
        }
      }

      // Disk I/O
      if (window.electronAPI && window.electronAPI.getDiskIO) {
        const diskData = await window.electronAPI.getDiskIO();
        if (diskData) {
          pushPoint(data.diskRead, diskData.readBytesPerSec || 0);
          pushPoint(data.diskWrite, diskData.writeBytesPerSec || 0);
        }
      }

      // Temperature (synthetic)
      const cpuPct = data.cpu.length > 0 ? data.cpu[data.cpu.length - 1] : 0;
      const temp = Math.round(35 + (cpuPct / 100) * 40);
      pushPoint(data.temp, temp);

      // Draw all charts
      drawChart('chart-cpu', data.cpu, '#00ff88', 100, '%');
      drawChart('chart-ram', data.ram, '#00ccff', parseFloat(document.getElementById('stat-total-ram')?.textContent || '16'), ' GB');
      drawChart('chart-net-in', data.netIn, '#ff6b35', Math.max(1, ...data.netIn) * 1.2 || 1048576, '');
      drawChart('chart-net-out', data.netOut, '#ff3366', Math.max(1, ...data.netOut) * 1.2 || 1048576, '');
      drawChart('chart-gpu', data.gpu, '#aa66ff', 100, '%');
      drawChart('chart-disk-io', data.diskRead.map((r, i) => r + (data.diskWrite[i] || 0)), '#ffcc00', Math.max(1, ...data.diskRead.map((r, i) => r + (data.diskWrite[i] || 0))) * 1.2 || 10485760, '');
      drawChart('chart-temp', data.temp, '#ff4444', 100, '°C');
      drawPerCore(data.perCore);

      updateValues();
    } catch (e) {
      console.warn('Stats poll error:', e);
    }
  }

  // ── Telemetry listener (CPU, RAM, per-core from main) ─────
  function setupTelemetryListener() {
    if (window.electronAPI && window.electronAPI.onTelemetryUpdate) {
      window.electronAPI.onTelemetryUpdate((d) => {
        pushPoint(data.cpu, d.cpu || 0);
        pushPoint(data.ram, d.memGB || 0);
        data.perCore = d.perCore || [];

        // Update header info
        if (d.platform) document.getElementById('stat-platform').textContent = d.platform.toUpperCase();
        if (d.arch) document.getElementById('stat-arch').textContent = d.arch;
        if (d.uptimeHrs != null) document.getElementById('stat-uptime').textContent = formatUptime(d.uptimeHrs, d.uptimeMins);

        // Battery
        if (d.battery && d.battery.present) {
          const batEl = document.getElementById('stat-uptime');
          if (batEl) batEl.textContent += ` | BAT: ${d.battery.percent}%`;
        }
      });
    }
  }

  // ── Load extended info (once) ──────────────────────────────
  async function loadExtendedInfo() {
    if (!window.electronAPI) return;

    // System info
    if (window.electronAPI.getSystemInfo) {
      try {
        sysInfo = await window.electronAPI.getSystemInfo();
        if (sysInfo) {
          document.getElementById('stat-cpu-model').textContent = sysInfo.cpuModel || '-';
          document.getElementById('stat-cores').textContent = sysInfo.cpuCores || '-';
          document.getElementById('stat-total-ram').textContent = sysInfo.totalRAM || '-';
        }
      } catch (e) { /* ignore */ }
    }

    // Extended telemetry (GPU, disks, network interfaces)
    if (window.electronAPI.getExtendedTelemetry) {
      try {
        extendedInfo = await window.electronAPI.getExtendedTelemetry();
        if (extendedInfo) {
          renderDiskBars(extendedInfo.disks || []);
          renderNetInterfaces(extendedInfo.network || []);
        }
      } catch (e) { /* ignore */ }
    }

    // Process list
    refreshProcesses();
    setInterval(refreshProcesses, 5000);
  }

  async function refreshProcesses() {
    if (!window.electronAPI || !window.electronAPI.getProcessList) return;
    try {
      const result = await window.electronAPI.getProcessList();
      if (result && result.success) {
        const tbody = document.getElementById('process-list');
        if (tbody) {
          tbody.innerHTML = result.processes.map(p =>
            `<tr><td>${escapeHtml(p.name)}</td><td>${p.pid}</td><td>${p.cpu}</td><td>${p.memMB}</td></tr>`
          ).join('');
        }
      }
    } catch (e) { /* ignore */ }
  }

  function renderDiskBars(disks) {
    const container = document.getElementById('disk-bars');
    if (!container || disks.length === 0) {
      if (container) container.innerHTML = '<div style="color:#555;font-size:11px;">No disks detected</div>';
      return;
    }
    container.innerHTML = disks.map(d => {
      const cls = d.pct > 90 ? 'high' : d.pct > 70 ? 'mid' : 'low';
      return `
        <div class="disk-bar">
          <div class="disk-bar-label">
            <span>${d.drive}</span>
            <span>${d.used} / ${d.total} GB (${d.pct}%)</span>
          </div>
          <div class="disk-bar-track">
            <div class="disk-bar-fill ${cls}" style="width: ${d.pct}%"></div>
          </div>
        </div>`;
    }).join('');
  }

  function renderNetInterfaces(interfaces) {
    const container = document.getElementById('net-interfaces');
    if (!container || interfaces.length === 0) {
      if (container) container.innerHTML = '<div style="color:#555;font-size:11px;">No interfaces</div>';
      return;
    }
    container.innerHTML = interfaces.slice(0, 5).map(n =>
      `<div class="net-stat">
        <span class="label">${escapeHtml(n.name)}</span>
        <span class="val">${n.address}</span>
      </div>`
    ).join('');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Resize handler ─────────────────────────────────────────
  function handleResize() {
    for (const id of Object.keys(canvases)) {
      const canvas = canvases[id];
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext('2d');
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctxs[id] = ctx;
    }
  }

  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(handleResize, 200);
  });

  // ── Init ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initCanvases();
    setupTelemetryListener();
    loadExtendedInfo();

    // Start polling
    setInterval(pollStats, POLL_INTERVAL);
    // Initial poll
    setTimeout(pollStats, 500);

    addTickerEvent('sys', 'System Stats Dashboard loaded.');
  });

})();
