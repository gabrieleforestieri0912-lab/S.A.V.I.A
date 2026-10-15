/**
 * S.A.V.I.A - Real-Time OS Telemetry & Control Toggles Module
 */

window.telemetryData = {};

function applyRealTelemetry(data) {
  window.telemetryData = data;
  // La pagina terminale non ha le card: esci senza errori
  if (typeof fillCpu === 'undefined' || !fillCpu || !txtCpuLoad) return;
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
// (bottoni rimossi dalla sidebar: restano via voce/chat + API globali)
function saviaToggleOverclock() {
  overclockEnabled = !overclockEnabled;
  const btn = document.getElementById('btn-overclock');
  if (btn) {
    btn.classList.toggle('active', overclockEnabled);
    const indicator = btn.querySelector('.indicator');
    if (indicator) {
      indicator.style.background = overclockEnabled ? '#00ff88' : '#555';
      indicator.style.boxShadow = overclockEnabled ? '0 0 6px #00ff88' : 'none';
    }
  }
  if (overclockEnabled) {
    if (ringSegmented) ringSegmented.style.animationDuration = '4s';
    if (ringInner) ringInner.style.animationDuration = '2s';
    addTickerEvent('sys', 'Overclock attivo.');
  } else {
    if (ringSegmented) ringSegmented.style.animationDuration = '12s';
    if (ringInner) ringInner.style.animationDuration = '8s';
    addTickerEvent('sys', 'Overclock disattivato.');
  }
  return overclockEnabled;
}

function saviaToggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('btn-sound');
  if (btn) {
    btn.classList.toggle('active', soundEnabled);
    const indicator = btn.querySelector('.indicator');
    if (indicator) {
      indicator.style.background = soundEnabled ? '#00ff88' : '#555';
      indicator.style.boxShadow = soundEnabled ? '0 0 6px #00ff88' : 'none';
    }
  }
  if (soundEnabled && typeof playAudio === 'function' && typeof audioClick !== 'undefined') playAudio(audioClick);
  return soundEnabled;
}

function saviaToggleScanlines() {
  scanlinesEnabled = !scanlinesEnabled;
  const btn = document.getElementById('btn-scanlines');
  if (btn) {
    btn.classList.toggle('active', scanlinesEnabled);
    const indicator = btn.querySelector('.indicator');
    if (indicator) {
      indicator.style.background = scanlinesEnabled ? '#00ff88' : '#555';
      indicator.style.boxShadow = scanlinesEnabled ? '0 0 6px #00ff88' : 'none';
    }
  }
  const scanlinesEl = document.getElementById('hud-scanlines');
  if (scanlinesEl) {
    if (scanlinesEnabled) scanlinesEl.classList.remove('disabled');
    else scanlinesEl.classList.add('disabled');
  }
  return scanlinesEnabled;
}

window.saviaToggleOverclock = saviaToggleOverclock;
window.saviaToggleSound = saviaToggleSound;
window.saviaToggleScanlines = saviaToggleScanlines;

(function bindLegacyToggleButtons() {
  const wire = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', function() {
      if (typeof playAudio === 'function' && typeof audioClick !== 'undefined') playAudio(audioClick);
      fn();
    });
  };
  wire('btn-overclock', saviaToggleOverclock);
  wire('btn-sound', saviaToggleSound);
  wire('btn-scanlines', saviaToggleScanlines);
})();
