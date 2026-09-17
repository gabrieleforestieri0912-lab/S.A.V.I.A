/**
 * S.A.V.I.A - JARVIS Boot Sequence
 * Power-on overlay with system logs + synthesized reactor hum.
 */

(function () {
  // Bail out if boot overlay is not present (only index.html uses it)
  const overlay = document.getElementById('boot-overlay');
  if (!overlay) return;

  const logEl = document.getElementById('boot-log');
  const barEl = document.getElementById('boot-bar');
  const stateEl = document.getElementById('boot-state');

  const BOOT_LINES = [
    '[SYS] S.A.V.I.A COGNITIVE CORE v4.0.0',
    '[SYS] Inizializzazione moduli neurali...',
    '[SYS] Calibrazione arc reactor...',
    '[NET] Collegamento ponte AI...',
    '[SEC] Verifica identità operatore...',
    '[SYS] Sincronizzazione memoria contestuale...',
    '[SYS] All systems nominal. Benvenuto.'
  ];

  let lineIdx = 0;

  // Synthesized reactor "power up" hum via WebAudio (no external assets)
  function playBootHum() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.05, now + 0.4);
      master.connect(ctx.destination);

      // Two detuned low oscillators = reactor whine
      [0, 1].forEach(function (i) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(55 + i * 3, now);
        osc.frequency.exponentialRampToValueAtTime(110 + i * 5, now + 1.6);
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 400;
        osc.connect(filt);
        filt.connect(master);
        osc.start(now);
        osc.stop(now + 1.8);
      });

      // Final "ding" when complete
      const ding = ctx.createOscillator();
      ding.type = 'sine';
      ding.frequency.setValueAtTime(880, now + 1.9);
      const dg = ctx.createGain();
      dg.gain.setValueAtTime(0.0001, now + 1.9);
      dg.gain.exponentialRampToValueAtTime(0.06, now + 1.92);
      dg.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
      ding.connect(dg);
      dg.connect(ctx.destination);
      ding.start(now + 1.9);
      ding.stop(now + 2.6);
    } catch (e) { /* audio non disponibile */ }
  }

  function appendBootLine(text) {
    if (!logEl) return;
    const div = document.createElement('div');
    div.className = 'boot-log-line';
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(pct) {
    if (barEl) barEl.style.width = pct + '%';
    if (stateEl) stateEl.textContent = pct + '%';
  }

  function step() {
    if (lineIdx < BOOT_LINES.length) {
      appendBootLine(BOOT_LINES[lineIdx]);
      setProgress(Math.round(((lineIdx + 1) / BOOT_LINES.length) * 100));
      lineIdx++;
      setTimeout(step, 260 + Math.random() * 180);
    } else {
      // Complete
      setTimeout(() => {
        overlay.classList.add('boot-complete');
        setTimeout(() => {
          overlay.remove();
          document.body.classList.remove('boot-locked');
          document.dispatchEvent(new CustomEvent('savia-boot-complete'));
          // Kick off contextual greeting once boot finishes
          if (typeof window.__saviaBootGreeting === 'function') {
            setTimeout(window.__saviaBootGreeting, 300);
          }
        }, 550);
      }, 300);
    }
  }

  document.body.classList.add('boot-locked');
  playBootHum();
  setTimeout(step, 400);

  // Safety net: se qualcosa interrompe la sequenza, rimuovi comunque l'overlay
  setTimeout(function () {
    if (document.getElementById('boot-overlay')) {
      overlay.classList.add('boot-complete');
      setTimeout(function () {
        overlay.remove();
        document.body.classList.remove('boot-locked');
        document.dispatchEvent(new CustomEvent('savia-boot-complete'));
        if (typeof window.__saviaBootGreeting === 'function') {
          window.__saviaBootGreeting();
        }
      }, 400);
    }
  }, 10000);
})();
