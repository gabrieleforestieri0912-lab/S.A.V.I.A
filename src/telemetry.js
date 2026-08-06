/**
 * S.A.V.I.A - Real-Time OS Telemetry & Control Toggles Module
 */

window.telemetryData = {};

function applyRealTelemetry(data) {
  window.telemetryData = data;
  const cpuVal = Math.min(100, data.cpu);
  fillCpu.style.width = `${cpuVal}%`;
  txtCpuLoad.textContent = `${cpuVal}%`;

  fillMem.style.width = `${data.memPercent}%`;
  txtMemLoad.textContent = `${data.memGB} GB`;

  if (telemetryFreq) telemetryFreq.textContent = data.cpuFreqGHz;

  if (telemetryTemp) {
    const syntheticTemp = (38 + Math.min(4, data.loadAvg) * 12).toFixed(1);
    telemetryTemp.textContent = syntheticTemp;
    if (parseFloat(syntheticTemp) > 70) {
      addTickerEvent('warn', `Core load elevated. Synthetic thermal estimate: ${syntheticTemp}°C (load: ${data.loadAvg})`);
    }
  }

  if (svcTelemetry) {
    const desc = svcTelemetry.querySelector('.item-desc');
    if (desc) {
      desc.textContent = `CPU: ${cpuVal}% | RAM: ${data.memGB}/${data.totalGB}GB`;
      desc.style.color = 'var(--accent-cyan)';
    }
    setServiceStatus(svcTelemetry, 'online');
  }

  // Battery (Power Cell) — from main process Win32_Battery
  if (data.battery) {
    const fillBattery = document.getElementById('fill-battery');
    const txtBattery = document.getElementById('txt-battery-load');
    const batteryMicro = document.getElementById('battery-micro');
    if (fillBattery && txtBattery) {
      if (data.battery.present && data.battery.percent != null) {
        const pct = data.battery.percent;
        txtBattery.textContent = pct + '%' + (data.battery.charging ? ' ⚡' : '');
        fillBattery.style.width = pct + '%';
        if (pct <= 20) {
          fillBattery.className = 'gauge-fill neon-red-glow';
          if (batteryMicro) batteryMicro.textContent = 'POWER CRITICAL // CHARGE REQUIRED';
        } else if (pct <= 40) {
          fillBattery.className = 'gauge-fill neon-gold-glow';
          if (batteryMicro) batteryMicro.textContent = data.battery.charging ? 'POWER CELL // CHARGING' : 'POWER CELL // LOW';
        } else {
          fillBattery.className = 'gauge-fill neon-cyan-glow';
          if (batteryMicro) batteryMicro.textContent = data.battery.charging ? 'POWER CELL // CHARGING' : 'ARC REACTOR // NOMINAL';
        }
      } else {
        txtBattery.textContent = 'N/A';
        fillBattery.style.width = '0%';
        fillBattery.className = 'gauge-fill neon-cyan-glow';
        if (batteryMicro) batteryMicro.textContent = 'ARC REACTOR // NO BATTERY';
      }
    }
  }

  if (Math.random() > 0.82) {
    addTickerEvent('sys', `OS telemetry: CPU ${cpuVal}% | RAM ${data.memGB}/${data.totalGB}GB | Freq ${data.cpuFreqGHz}GHz | Load ${data.loadAvg}`);
  }
}

if (window.electronAPI && window.electronAPI.onTelemetryUpdate) {
  window.electronAPI.onTelemetryUpdate(applyRealTelemetry);
} else {
  setInterval(() => {
    const cpuVal = Math.round(15 + Math.random() * 30);
    fillCpu.style.width = `${cpuVal}%`;
    txtCpuLoad.textContent = `${cpuVal}%`;
    const memVal = (4.5 + Math.random() * 0.5).toFixed(2);
    fillMem.style.width = `${Math.round(parseFloat(memVal)/16*100)}%`;
    txtMemLoad.textContent = `${memVal} GB`;
  }, 2000);
}

// ── Controls Toggles ─────────────────────────────────────────────────

document.getElementById('btn-overclock').addEventListener('click', function() {
  playAudio(audioClick);
  overclockEnabled = !overclockEnabled;
  this.classList.toggle('active', overclockEnabled);

  const indicator = this.querySelector('.indicator');
  if (overclockEnabled) {
    indicator.style.background = '#00ff88';
    indicator.style.boxShadow = '0 0 6px #00ff88';
    if (ringSegmented) ringSegmented.style.animationDuration = '4s';
    if (ringInner) ringInner.style.animationDuration = '2s';
    addTickerEvent("[SYS] COGNITIVE OVERCLOCK ACTIVATED. Freq boosted to 4.20GHz.");
  } else {
    indicator.style.background = '#555';
    indicator.style.boxShadow = 'none';
    if (ringSegmented) ringSegmented.style.animationDuration = '12s';
    if (ringInner) ringInner.style.animationDuration = '8s';
    addTickerEvent("[SYS] Overclock disabled. Reverting to base power profile.");
  }
});

document.getElementById('btn-sound').addEventListener('click', function() {
  soundEnabled = !soundEnabled;
  this.classList.toggle('active', soundEnabled);
  const indicator = this.querySelector('.indicator');
  indicator.style.background = soundEnabled ? '#00ff88' : '#555';
  indicator.style.boxShadow = soundEnabled ? '0 0 6px #00ff88' : 'none';
  if (soundEnabled) playAudio(audioClick);
});

const scanlinesEl = document.getElementById('hud-scanlines');
document.getElementById('btn-scanlines').addEventListener('click', function() {
  playAudio(audioClick);
  scanlinesEnabled = !scanlinesEnabled;
  this.classList.toggle('active', scanlinesEnabled);
  const indicator = this.querySelector('.indicator');
  indicator.style.background = scanlinesEnabled ? '#00ff88' : '#555';
  indicator.style.boxShadow = scanlinesEnabled ? '0 0 6px #00ff88' : 'none';

  if (scanlinesEnabled) scanlinesEl.classList.remove('disabled');
  else scanlinesEl.classList.add('disabled');
});
