/**
 * S.A.V.I.A - Complete Voice Control System
 * Wake word, STT, TTS, continuous conversation mode
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
let wakeRecognizer = null;
let cmdRecognizer = null;
let restartTimeout = null;
let wakeListening = false;
let voiceAudioInProgress = false;

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
  const norm = text.toLowerCase();
  for (const w of WAKE_WORDS) {
    const idx = norm.indexOf(w);
    if (idx >= 0) {
      const cmd = text.substring(idx + w.length).trim();
      if (cmd) return cmd;
    }
  }
  // Try finding at start
  for (const w of WAKE_WORDS) {
    if (norm.startsWith(w)) {
      const cmd = text.substring(w.length).trim();
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
}

// ── Wake Word Listener ──────────────────────────────────────────────

let wakeHeartbeat = null;
let wakeRestartLock = false;

function startWakeListener() {
  if (!voiceSupported || !wakeActive || wakeRestartLock) return;

  wakeRestartLock = true;

  if (wakeRecognizer) {
    try { wakeRecognizer.stop(); } catch(e) {}
    wakeRecognizer = null;
  }

  wakeRecognizer = new SR();
  wakeRecognizer.lang = 'it-IT';
  wakeRecognizer.continuous = true;
  wakeRecognizer.interimResults = true;

  let heardWake = false;

  wakeRecognizer.onresult = (event) => {
    if (heardWake) return;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (containsWakeWord(transcript)) {
        heardWake = true;
        setVoiceState(VoiceState.WAKE_HEARD);

        const fullText = event.results[i][0].transcript;
        const command = extractCommand(fullText);

        try { wakeRecognizer.stop(); } catch(e) {}
        wakeListening = false;

        if (command && command.length > 1) {
          setTimeout(() => processVoiceCommand(command), 400);
        } else {
          setTimeout(() => startCommandCapture(), 400);
        }
        break;
      }
    }
  };

  wakeRecognizer.onerror = (err) => {
    heardWake = false;
    wakeListening = false;
    wakeRestartLock = false;
    if (wakeActive) scheduleWakeRestart();
  };

  wakeRecognizer.onend = () => {
    wakeListening = false;
    wakeRestartLock = false;
    if (wakeActive && !heardWake) {
      scheduleWakeRestart();
    }
  };

  try {
    wakeRecognizer.start();
    wakeListening = true;
    wakeRestartLock = false;
    setVoiceState(VoiceState.WAKE_LISTEN);
  } catch(e) {
    wakeRestartLock = false;
    scheduleWakeRestart();
  }

  if (wakeHeartbeat) clearInterval(wakeHeartbeat);
  wakeHeartbeat = setInterval(() => {
    if (wakeActive && !wakeListening && !wakeRestartLock && voiceState === VoiceState.WAKE_LISTEN) {
      startWakeListener();
    }
  }, 5000);
}

function stopWakeListener() {
  if (wakeHeartbeat) { clearInterval(wakeHeartbeat); wakeHeartbeat = null; }
  if (wakeRecognizer) {
    try { wakeRecognizer.stop(); } catch(e) {}
    wakeRecognizer = null;
  }
  wakeListening = false;
}

function scheduleWakeRestart() {
  if (!wakeActive || wakeRestartLock) return;
  if (restartTimeout) clearTimeout(restartTimeout);
  restartTimeout = setTimeout(() => {
    if (!wakeActive || wakeRestartLock) return;
    if (voiceState === VoiceState.CAPTURING || voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING) {
      scheduleWakeRestart();
      return;
    }
    startWakeListener();
  }, 300);
}

// ── Command Capture ─────────────────────────────────────────────────

function startCommandCapture() {
  if (!voiceSupported || !wakeActive) return;
  setVoiceState(VoiceState.CAPTURING);

  if (cmdRecognizer) {
    try { cmdRecognizer.stop(); } catch(e) {}
  }

  cmdRecognizer = new SR();
  cmdRecognizer.lang = 'it-IT';
  cmdRecognizer.continuous = false;
  cmdRecognizer.interimResults = false;

  cmdRecognizer.onresult = (event) => {
    const command = event.results[0][0].transcript;
    cmdRecognizer = null;
    if (command.trim()) {
      processVoiceCommand(command.trim());
    } else {
      setVoiceState(VoiceState.IDLE);
      if (wakeActive) startWakeListener();
    }
  };

  cmdRecognizer.onerror = () => {
    cmdRecognizer = null;
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) setTimeout(() => startWakeListener(), 200);
  };

  cmdRecognizer.onend = () => {
    cmdRecognizer = null;
    if (voiceState === VoiceState.CAPTURING) {
      setVoiceState(VoiceState.IDLE);
      if (wakeActive) setTimeout(() => startWakeListener(), 200);
    }
  };

  try { cmdRecognizer.start(); } catch(e) {
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) startWakeListener();
  }
}

// ── Process Command ─────────────────────────────────────────────────

async function processVoiceCommand(command) {
  if (!command) {
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) startWakeListener();
    return;
  }

  setVoiceState(VoiceState.PROCESSING);
  addTickerEvent('sys', `[VOCE] Comando: "${command}"`);

  // Append to chat
  appendLogMessage('user', `[VOCE] ${command}`, 'user');

  // Set input and submit
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
    startWakeListener();
    addTickerEvent('sys', 'Wake word attivato. Say "Hey SAVIA" per chiamarmi.');
  } else {
    stopWakeListener();
    if (cmdRecognizer) { try { cmdRecognizer.stop(); } catch(e) {} cmdRecognizer = null; }
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
