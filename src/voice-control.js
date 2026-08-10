/**
 * S.A.V.I.A - Complete Voice Control System
 * Wake word, STT, TTS, continuous conversation mode
 *
 * Optimized:
 *  - Single recognizer, no mic contention between wake/capture
 *  - Mic fully released during PROCESSING / SPEAKING (no echo self-trigger)
 *  - Command capture timeout + silence-aware end detection
 *  - Robust error handling with backoff (network) and fatal guards (not-allowed)
 */

const VoiceState = {
  IDLE: 'idle',
  WAKE_LISTEN: 'wake_listen',
  WAKE_HEARD: 'wake_heard',
  CAPTURING: 'capturing',
  PROCESSING: 'processing',
  SPEAKING: 'speaking'
};

let voiceState = VoiceState.IDLE;
let wakeActive = false;
let continuousMode = false;
let recognizer = null;
let captureTimeout = null;
let wakeListening = false;
let voiceAudioInProgress = false;
let restartTimer = null;
let commandTimeoutMs = 8000;

// DOM refs
const vcStatusDot = document.getElementById('vc-status-dot');
const vcStatusText = document.getElementById('vc-status-text');
const vcWakeToggle = document.getElementById('vc-wake-toggle');
const vcContinuousToggle = document.getElementById('vc-continuous-toggle');
const vcWakeIndicator = document.getElementById('vc-wake-indicator');
const chatVcMic = document.getElementById('chat-vc-mic');
const chatVcLabel = document.getElementById('chat-vc-label');

// Speach recognition API
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceSupported = !!SR;

// ── Wake word variants (Italian + English) ──────────────────────────
const WAKE_WORDS = ['hey savia', 'ehi savia', 'savia', 's.a.v.i.a.', 'save ya'];

function normalizeText(text) {
  return text.toLowerCase()
    .replace(/\./g, '')
    .replace(/[!\?,\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsWakeWord(text) {
  const norm = normalizeText(text);
  return WAKE_WORDS.some(w => norm.includes(w));
}

function extractCommand(text) {
  const norm = normalizeText(text);
  for (const w of WAKE_WORDS) {
    const idx = norm.indexOf(w);
    if (idx >= 0) {
      const cmd = text.substring(idx + w.length).trim();
      if (cmd) return cmd;
    }
  }
  return text.trim();
}

// ── State Machine ────────────────────────────────────────────────────

function updateChatMic(state) {
  if (!chatVcMic) return;
  var micStates = {
    idle: 'idle', wake_listen: 'listen', wake_heard: 'heard',
    capturing: 'capture', processing: 'process', speaking: 'speak'
  };
  chatVcMic.className = 'vc-mic ' + (micStates[state] || 'idle') + ' fas fa-microphone';
  if (chatVcMic.classList.contains('listen')) {
    chatVcMic.className = 'vc-mic listen fas fa-microphone';
    setTimeout(function() { chatVcMic.className = 'vc-mic listen fas fa-microphone-alt'; }, 500);
  }
  if (chatVcLabel) {
    var labels = { idle: 'VOCE', wake_listen: 'ASCOLTO', wake_heard: 'RICEVUTO',
      capturing: 'PARLA', processing: 'ELABORA', speaking: 'RISPONDE' };
    chatVcLabel.textContent = labels[state] || 'VOCE';
  }
}

function setVoiceState(newState) {
  const prev = voiceState;
  voiceState = newState;

  const dot = vcStatusDot;
  const text = vcStatusText;
  if (!dot) return;

  dot.className = 'vc-dot';
  switch (newState) {
    case VoiceState.IDLE:
      dot.classList.add('vc-idle');
      if (text) text.textContent = 'IDLE';
      break;
    case VoiceState.WAKE_LISTEN:
      dot.classList.add('vc-listen');
      if (text) text.textContent = 'IN ASCOLTO...';
      break;
    case VoiceState.WAKE_HEARD:
      dot.classList.add('vc-heard');
      if (text) text.textContent = 'RICEVUTO!';
      break;
    case VoiceState.CAPTURING:
      dot.classList.add('vc-capture');
      if (text) text.textContent = 'COMANDO...';
      break;
    case VoiceState.PROCESSING:
      dot.classList.add('vc-process');
      if (text) text.textContent = 'ELABORAZIONE...';
      break;
    case VoiceState.SPEAKING:
      dot.classList.add('vc-speak');
      if (text) text.textContent = 'RISPONDE...';
      break;
  }

  updateChatMic(newState);

  if (prev !== newState && newState === VoiceState.WAKE_HEARD) {
    playAudio(audioBeep);
  }

  // While SAVIA is thinking or speaking the mic is fully released:
  // avoids echo wake-triggers and frees the audio device for TTS.
  if (newState === VoiceState.PROCESSING || newState === VoiceState.SPEAKING) {
    releaseRecognizer();
  }
}

function releaseRecognizer() {
  if (captureTimeout) { clearTimeout(captureTimeout); captureTimeout = null; }
  if (recognizer) {
    try { recognizer.onend = null; recognizer.stop(); } catch(e) {}
    recognizer = null;
  }
  wakeListening = false;
}

// ── Recognizer factory ──────────────────────────────────────────────

function createRecognizer(opts) {
  const rec = new SR();
  rec.lang = 'it-IT';
  rec.continuous = !!opts.continuous;
  rec.interimResults = !!opts.interim;
  return rec;
}

function handleRecError(err) {
  const code = err.error;
  if (code === 'aborted') return; // our own stop()
  if (code === 'no-speech') {
    addTickerEvent('sys', 'Nessun input vocale rilevato.');
    return;
  }
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    wakeActive = false;
    updateWakeUI();
    addTickerEvent('error', 'Accesso microfono negato. Controlla i permessi.');
    if (vcStatusText) vcStatusText.textContent = 'MIC DENIED';
    return;
  }
  if (code === 'network') {
    addTickerEvent('warn', 'Servizio riconoscimento vocale: retry.');
    return;
  }
  addTickerEvent('warn', 'Riconoscimento vocale: ' + (code || 'errore sconosciuto'));
}

// ── Wake Word Listener ──────────────────────────────────────────────

function startWakeListener() {
  if (!voiceSupported || !wakeActive) return;
  if (voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING) return;
  if (wakeListening) return;

  releaseRecognizer();

  const rec = createRecognizer({ continuous: true, interim: true });
  recognizer = rec;
  wakeListening = true;
  let heardWake = false;

  rec.onresult = (event) => {
    if (heardWake) return;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (containsWakeWord(transcript)) {
        heardWake = true;
        setVoiceState(VoiceState.WAKE_HEARD);

        const command = extractCommand(transcript);
        const isFinal = event.results[i].isFinal;

        // Grab the most complete transcript available, then hand off.
        if (isFinal || command.length > 0) {
          releaseRecognizer();
          if (command && command.length > 1) {
            setTimeout(() => processVoiceCommand(command), 400);
          } else {
            setTimeout(() => startCommandCapture(), 400);
          }
        } else {
          heardWake = false;
        }
        break;
      }
    }
  };

  rec.onerror = (err) => {
    wakeListening = false;
    recognizer = null;
    handleRecError(err);
    if (wakeActive && voiceState === VoiceState.WAKE_LISTEN) scheduleWakeRestart(250);
  };

  rec.onend = () => {
    if (recognizer === rec) recognizer = null;
    wakeListening = false;
    if (wakeActive && !heardWake && voiceState === VoiceState.WAKE_LISTEN) {
      scheduleWakeRestart(200);
    }
  };

  try {
    rec.start();
    setVoiceState(VoiceState.WAKE_LISTEN);
  } catch(e) {
    recognizer = null;
    wakeListening = false;
    scheduleWakeRestart(300);
  }
}

function stopWakeListener() {
  releaseRecognizer();
}

function scheduleWakeRestart(delay) {
  if (!wakeActive || voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING) return;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (!wakeActive || voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING) return;
    startWakeListener();
  }, delay || 300);
}

// ── Command Capture ─────────────────────────────────────────────────

function startCommandCapture() {
  if (!voiceSupported || !wakeActive) return;

  releaseRecognizer();

  setVoiceState(VoiceState.CAPTURING);

  const rec = createRecognizer({ continuous: false, interim: true });
  recognizer = rec;
  wakeListening = true;
  let handled = false;

  captureTimeout = setTimeout(() => {
    if (handled) return;
    handled = true;
    releaseRecognizer();
    addTickerEvent('sys', 'Timeout comando vocale — nessun input.');
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) scheduleWakeRestart(250);
  }, commandTimeoutMs);

  rec.onresult = (event) => {
    let best = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) best = t;
    }
    if (!best) return;

    handled = true;
    releaseRecognizer();

    if (best.trim()) {
      processVoiceCommand(best.trim());
    } else {
      setVoiceState(VoiceState.IDLE);
      if (wakeActive) scheduleWakeRestart(200);
    }
  };

  rec.onerror = (err) => {
    if (handled) return;
    handled = true;
    releaseRecognizer();
    handleRecError(err);
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) scheduleWakeRestart(300);
  };

  rec.onend = () => {
    if (recognizer === rec) recognizer = null;
    wakeListening = false;
    if (handled) return;
    handled = true;
    releaseRecognizer();
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) scheduleWakeRestart(200);
  };

  try { rec.start(); } catch(e) {
    if (handled) return;
    handled = true;
    recognizer = null;
    wakeListening = false;
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) scheduleWakeRestart(300);
  }
}

// ── Process Command ─────────────────────────────────────────────────

async function processVoiceCommand(command) {
  if (!command) {
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) scheduleWakeRestart(200);
    return;
  }

  setVoiceState(VoiceState.PROCESSING);
  addTickerEvent('sys', `[VOCE] Comando: "${command}"`);

  appendLogMessage('user', `[VOCE] ${command}`, 'user');

  terminalInput.value = command;
  terminalForm.dispatchEvent(new Event('submit'));
}

// ── Response Handler ────────────────────────────────────────────────

document.addEventListener('savia-response-complete', (e) => {
  if (voiceState === VoiceState.PROCESSING && autoSpeak && e.detail.response) {
    setVoiceState(VoiceState.SPEAKING);
  }

  const resumeAfterAudio = () => {
    setVoiceState(VoiceState.IDLE);
    if (!wakeActive) return;
    if (continuousMode) {
      startCommandCapture();
    } else {
      startWakeListener();
    }
  };

  if (autoSpeak && e.detail.response) {
    waitForAudioEnd().then(resumeAfterAudio);
  } else {
    resumeAfterAudio();
  }
});

function waitForAudioEnd() {
  return new Promise((resolve) => {
    if (!voiceAudioInProgress) {
      resolve();
      return;
    }
    const check = setInterval(() => {
      if (!voiceAudioInProgress) {
        clearInterval(check);
        resolve();
      }
    }, 100);
    setTimeout(() => { clearInterval(check); resolve(); }, 30000);
  });
}

// ── UI Controls ─────────────────────────────────────────────────────

function toggleWake() {
  wakeActive = !wakeActive;
  localStorage.setItem('vc-wake', String(wakeActive));
  updateWakeUI();

  if (wakeActive) {
    if (voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING) {
      addTickerEvent('sys', 'Wake word pronto al termine della risposta.');
    } else {
      startWakeListener();
    }
    addTickerEvent('sys', 'Wake word attivato. Say "Hey SAVIA" per chiamarmi.');
  } else {
    stopWakeListener();
    setVoiceState(VoiceState.IDLE);
    addTickerEvent('sys', 'Wake word disattivato.');
  }
}

function toggleContinuous() {
  continuousMode = !continuousMode;
  if (vcContinuousToggle) {
    vcContinuousToggle.classList.toggle('active', continuousMode);
    const ind = vcContinuousToggle.querySelector('.indicator');
    if (ind) {
      ind.style.background = continuousMode ? '#00ff88' : '#555';
      ind.style.boxShadow = continuousMode ? '0 0 6px #00ff88' : 'none';
    }
  }
  localStorage.setItem('vc-continuous', String(continuousMode));
  addTickerEvent('sys', `Modalità conversazione continua: ${continuousMode ? 'ATTIVA' : 'DISATTIVA'}`);
}

function updateWakeUI() {
  if (vcWakeToggle) {
    vcWakeToggle.classList.toggle('active', wakeActive);
    const ind = vcWakeToggle.querySelector('.indicator');
    if (ind) {
      ind.style.background = wakeActive ? '#00ff88' : '#555';
      ind.style.boxShadow = wakeActive ? '0 0 6px #00ff88' : 'none';
    }
  }
  if (vcWakeIndicator) {
    vcWakeIndicator.classList.toggle('active', wakeActive);
  }
}

// ── Init ────────────────────────────────────────────────────────────

function initVoiceControl() {
  if (!voiceSupported) {
    if (vcStatusText) vcStatusText.textContent = 'NON SUPPORTATO';
    if (vcWakeToggle) vcWakeToggle.disabled = true;
    if (chatVcLabel) chatVcLabel.textContent = 'NON SUP.';
    return;
  }

  continuousMode = localStorage.getItem('vc-continuous') !== 'false';
  wakeActive = localStorage.getItem('vc-wake') !== 'false';
  if (vcContinuousToggle) {
    vcContinuousToggle.classList.toggle('active', continuousMode);
    const ind = vcContinuousToggle.querySelector('.indicator');
    if (ind) {
      ind.style.background = continuousMode ? '#00ff88' : '#555';
      ind.style.boxShadow = continuousMode ? '0 0 6px #00ff88' : 'none';
    }
  }

  if (vcWakeToggle) {
    vcWakeToggle.addEventListener('click', () => {
      if (typeof playAudio === 'function') playAudio(audioClick);
      toggleWake();
    });
  }

  if (vcContinuousToggle) {
    vcContinuousToggle.addEventListener('click', () => {
      if (typeof playAudio === 'function') playAudio(audioClick);
      toggleContinuous();
    });
  }

  setVoiceState(VoiceState.IDLE);

  if (wakeActive) {
    setTimeout(() => {
      startWakeListener();
      updateWakeUI();
      if (typeof addTickerEvent === 'function') {
        addTickerEvent('sys', 'Controllo vocale attivo. Di\' "Hey SAVIA" o parla liberamente.');
      }
    }, 4000);
  }
}

let voiceInitRetries = 0;

function retryVoiceInit() {
  if (voiceInitRetries > 5) return;
  voiceInitRetries++;
  setTimeout(function() {
    if (typeof addTickerEvent === 'function' && typeof voiceState !== 'undefined') {
      initVoiceControl();
    } else {
      retryVoiceInit();
    }
  }, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initVoiceControl, 3000);
  setTimeout(retryVoiceInit, 5000);
});
