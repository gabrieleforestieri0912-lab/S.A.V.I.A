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
let lastRecActivity = Date.now();

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
const cloudSupported = !!SR;
const micSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const voiceSupported = cloudSupported || micSupported;

// Fallback STT locale (Whisper) quando il cloud va in retry di rete
let localMode = false;
let cloudNetworkFailures = 0;

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

// ============================================================
// STT LOCALE (fallback Whisper) — sostituisce il cloud quando va in retry
// ============================================================

function localArmed() {
  return localMode && !!window.LocalSTT && window.LocalSTT.supported();
}

function activateLocalVoice(reason) {
  if (localMode) return;
  localMode = true;
  if (typeof addTickerEvent === 'function') {
    if (reason) addTickerEvent('warn', reason);
    addTickerEvent('sys', 'Riconoscimento vocale locale (Whisper) attivo.');
  }
  if (vcStatusText) vcStatusText.textContent = 'STT LOCALE...';
  releaseRecognizer();
  if (!wakeActive) return;
  // Pre-carica il modello in background (per non perdere le prime chiamate),
  // ma NON bloccarsi: il microfono ascolta subito e la trascrizione carica
  // il modello lazy se serve. Riprova da sola in caso di errore di rete.
  if (window.LocalSTT) {
    window.LocalSTT.ensureModel().catch(() => {
      if (typeof addTickerEvent === 'function') addTickerEvent('warn', 'Caricamento modello Whisper rinviato: verrà riprovato in background.');
    });
  }
  startWakeListener();
}

function startLocalArm(mode) {
  if (!localMode || !window.LocalSTT) return;
  if (voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING) return;
  if (wakeListening) return;
  window.LocalSTT.start({
    onUtterance: (text) => handleLocalUtterance(text),
    onStatus: (s) => { if (vcStatusText && s) vcStatusText.textContent = s; }
  }).then(() => {
    wakeListening = true;
    setVoiceState(mode === 'capture' ? VoiceState.CAPTURING : VoiceState.WAKE_LISTEN);
  }).catch((err) => {
    wakeListening = false;
    const name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'NotFoundError') {
      handleRecError({ error: 'not-allowed' });
    } else {
      scheduleWakeRestart(600);
    }
  });
}

function handleLocalUtterance(text) {
  if (!text) { scheduleLocalRearm('wake'); return; }
  if (voiceState === VoiceState.CAPTURING) {
    processVoiceCommand(text);
    return;
  }
  if (voiceState === VoiceState.WAKE_LISTEN) {
    if (containsWakeWord(text)) {
      setVoiceState(VoiceState.WAKE_HEARD);
      if (window.electronAPI && typeof window.electronAPI.revealWindow === 'function') {
        window.electronAPI.revealWindow();
      }
      const command = extractCommand(text);
      if (command && command.length > 1) {
        setTimeout(() => processVoiceCommand(command), 250);
      } else {
        setTimeout(() => scheduleLocalRearm('capture'), 250);
      }
    } else {
      scheduleLocalRearm('wake');
    }
  } else {
    scheduleLocalRearm('wake');
  }
}

function scheduleLocalRearm(mode) {
  if (!localArmed() || !wakeActive) return;
  if (voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING) return;
  setTimeout(() => {
    if (!wakeActive) return;
    if (voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING) return;
    if (mode === 'capture') startCommandCapture();
    else startWakeListener();
  }, 300);
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
  if (window.LocalSTT) window.LocalSTT.stop();
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
    cloudNetworkFailures++;
    addTickerEvent('warn', 'Servizio riconoscimento vocale: retry (' + cloudNetworkFailures + ').');
    if (window.LocalSTT && cloudNetworkFailures >= 3) {
      activateLocalVoice('Il riconoscimento vocale cloud è in retry continuo — passaggio al motore locale Whisper.');
    }
    return;
  }
  addTickerEvent('warn', 'Riconoscimento vocale: ' + (code || 'errore sconosciuto'));
}

// ── Wake Word Listener ──────────────────────────────────────────────

function startWakeListener() {
  if (!voiceSupported || !wakeActive) return;
  if (voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING) return;
  if (wakeListening) return;

  if (localArmed()) { startLocalArm('wake'); return; }

  releaseRecognizer();

  const rec = createRecognizer({ continuous: true, interim: true });
  recognizer = rec;
  wakeListening = true;
  let heardWake = false;

  rec.onresult = (event) => {
    if (heardWake) return;
    lastRecActivity = Date.now();

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (containsWakeWord(transcript)) {
        heardWake = true;
        setVoiceState(VoiceState.WAKE_HEARD);

        // Power-on vocale: se la finestra è nascosta nella tray la riapriamo
        // (no-op sicuro quando è già visibile).
        if (window.electronAPI && typeof window.electronAPI.revealWindow === 'function') {
          window.electronAPI.revealWindow();
        }

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
    lastRecActivity = Date.now();
    wakeListening = false;
    recognizer = null;
    handleRecError(err);
    if (wakeActive && voiceState === VoiceState.WAKE_LISTEN) scheduleWakeRestart(250);
  };

  rec.onend = () => {
    lastRecActivity = Date.now();
    if (recognizer === rec) recognizer = null;
    wakeListening = false;
    if (wakeActive && !heardWake && voiceState === VoiceState.WAKE_LISTEN) {
      scheduleWakeRestart(200);
    }
  };

  try {
    rec.start();
    lastRecActivity = Date.now();
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

  if (localArmed()) { startLocalArm('capture'); return; }

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

// ── Terminal Voice Commands ──────────────────────────────────────────
const TERMINAL_CMD_PATTERNS = [
  { pattern: /^(?:esegui|run|avvia|launch|exec|execute)\s+(.+)/i, handler: (m) => ({ type: 'execute', command: m[1] }) },
  { pattern: /^(?:nuovo tab|new tab|apri tab|open tab)/i, handler: () => ({ type: 'new-tab' }) },
  { pattern: /^(?:chiudi tab|close tab)/i, handler: () => ({ type: 'close-tab' }) },
  { pattern: /^(?:dividi orizzontale|split orizzontale|split horizontal)/i, handler: () => ({ type: 'split-h' }) },
  { pattern: /^(?:dividi verticale|split verticale|split vertical)/i, handler: () => ({ type: 'split-v' }) },
  { pattern: /^(?:tab successivo|next tab|tab dopo)/i, handler: () => ({ type: 'next-tab' }) },
  { pattern: /^(?:tab precedente|previous tab|tab prima)/i, handler: () => ({ type: 'prev-tab' }) },
  { pattern: /^(?:pannello successivo|next pane|prossimo pannello)/i, handler: () => ({ type: 'focus-next' }) },
  { pattern: /^(?:pannello precedente|previous pane)/i, handler: () => ({ type: 'focus-prev' }) },
  { pattern: /^(?:pannello sopra|pannello superiore|pane up|focus up|up)/i, handler: () => ({ type: 'focus-up' }) },
  { pattern: /^(?:pannello sotto|pannello inferiore|pane down|focus down|down)/i, handler: () => ({ type: 'focus-down' }) },
  { pattern: /^(?:ferma|stop|kill|interrompi|termina)\s*(processo|process|processo)?/i, handler: () => ({ type: 'kill' }) },
  { pattern: /^(?:pulisci|clear|svuota)\s*(terminale|terminal|schermo|screen)?/i, handler: () => ({ type: 'clear' }) },
  { pattern: /^(?:apri esplora|open explorer|apri cartella|open folder|apri directory)/i, handler: () => ({ type: 'open-explorer' }) },
];

function matchTerminalCommand(text) {
  for (const { pattern, handler } of TERMINAL_CMD_PATTERNS) {
    const match = text.match(pattern);
    if (match) return handler(match);
  }
  return null;
}

function dispatchTerminalVoice(terminalAction) {
  // Use IPC to send command cross-window to terminal.html
  if (window.electronAPI && window.electronAPI.sendTerminalVoiceCommand) {
    window.electronAPI.sendTerminalVoiceCommand(terminalAction);
  }
}

// ── Process Command ─────────────────────────────────────────────────

async function processVoiceCommand(command, sourcePage) {
  if (!command) {
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) scheduleWakeRestart(200);
    return;
  }

  setVoiceState(VoiceState.PROCESSING);
  addTickerEvent('sys', `[VOCE] Comando: "${command}"`);

  appendLogMessage('user', `[VOCE] ${command}`, 'user');

  // Check if this is a terminal-specific command
  const terminalAction = matchTerminalCommand(command);
  if (terminalAction) {
    addTickerEvent('sys', `[VOCE] Terminal command: ${terminalAction.type}`);

    dispatchTerminalVoice(terminalAction);

    // Notify user
    if (typeof sendNotification === 'function') {
      sendNotification(`Comando terminale: ${command}`, 'info', 3000);
    }
    setVoiceState(VoiceState.IDLE);
    if (wakeActive) scheduleWakeRestart(200);
    return;
  }

  // Default: send to AI chat terminal
  terminalInput.value = command;
  terminalForm.dispatchEvent(new CustomEvent('submit', { detail: { sourcePage } }));
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

document.addEventListener('savia-standby-command', () => {
  // Un comando STAND BY (pausa/ricomincia) è stato consumato dal fast-path:
  // ripristina lo stato vocale, altrimenti resterebbe bloccato in PROCESSING.
  setVoiceState(VoiceState.IDLE);
  if (wakeActive) {
    if (continuousMode) startCommandCapture();
    else startWakeListener();
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

let voiceControlInitialized = false;

function initVoiceControl() {
  if (voiceControlInitialized) {
    // Re-init (da retryVoiceInit): riarma solo l'ascolto se è morto,
    // senza toccare lo stato macchina già avviato.
    if (wakeActive && !wakeListening &&
        voiceState !== VoiceState.PROCESSING && voiceState !== VoiceState.SPEAKING) {
      startWakeListener();
    }
    return;
  }
  voiceControlInitialized = true;

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
      if (!cloudSupported && micSupported) {
        activateLocalVoice('Speech API cloud non disponibile — attivo riconoscimento locale Whisper.');
      } else {
        startWakeListener();
        updateWakeUI();
        if (typeof addTickerEvent === 'function') {
          addTickerEvent('sys', 'Controllo vocale attivo. Di\' "Hey SAVIA" o parla liberamente.');
        }
      }
    }, 4000);
  }

  // Heartbeat: se il riconoscimento muore in silenzio (finestra nascosta in
  // tray, speech service interrotto, modello locale che fallisce), viene
  // riarmato automaticamente ogni 5 secondi.
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!wakeActive) return;
    if (voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING ||
        voiceState === VoiceState.WAKE_HEARD || voiceState === VoiceState.CAPTURING) return;
    // Riconoscimento cloud "bloccato" senza nessun evento per 25s → riavvia.
    if (!localMode && wakeListening && Date.now() - lastRecActivity > 25000) {
      releaseRecognizer();
      startWakeListener();
      if (typeof addTickerEvent === 'function') addTickerEvent('warn', 'Riconoscimento vocale bloccato — riavviato.');
      return;
    }
    if (wakeListening) return;
    startWakeListener();
    if (typeof addTickerEvent === 'function') addTickerEvent('sys', 'Riconoscimento vocale riarmato dal heartbeat.');
  }, 5000);
}

let heartbeatTimer = null;
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

  // Cross-page voice commands: receive from other pages via IPC
  if (window.electronAPI && window.electronAPI.onVoiceFromPage) {
    window.electronAPI.onVoiceFromPage((payload) => {
      if (!payload || !payload.command) return;
      addTickerEvent('sys', `[VOCE-${payload.page || '?'}] Comando: "${payload.command}"`);
      processVoiceCommand(payload.command, payload.page);
    });
  }
});
