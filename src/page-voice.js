/**
 * S.A.V.I.A - Lightweight Page Voice Listener
 * Loads on ALL pages. Listens for voice commands via SpeechRecognition
 * and forwards them to index.html via IPC for processing by the full
 * voice-control.js (wake word, action dispatch, AI chat).
 *
 * This file is intentionally minimal — no wake word, no TTS, no state machine.
 * Just STT → IPC → index.html handles everything.
 */
(function () {
  'use strict';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (!window.electronAPI || !window.electronAPI.sendVoiceFromPage) return;

  // Don't double-init on index.html (it has full voice-control.js)
  const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
  if (page === 'index.html' || page === '' || page === '/') return;

  let recognition = null;
  let listening = false;
  let fab = null;
  let active = false;

  function normalizeText(text) {
    return text.toLowerCase()
      .replace(/\./g, '')
      .replace(/[!\?,\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const WAKE_WORDS = ['hey savia', 'ehi savia', 'savia', 's.a.v.i.a.', 'save ya'];

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

  function forwardCommand(text) {
    if (!text || !text.trim()) return;
    window.electronAPI.sendVoiceFromPage({
      command: text.trim(),
      page: page
    });
  }

  function createFab() {
    if (fab) return;
    fab = document.createElement('div');
    fab.id = 'savia-page-voice-fab';
    fab.innerHTML = '<i class="fas fa-microphone"></i>';
    fab.title = 'S.A.V.I.A Voice — click to toggle';
    Object.assign(fab.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      background: 'rgba(10,12,18,0.85)',
      border: '2px solid #00ff88',
      color: '#00ff88',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      zIndex: '99999',
      fontSize: '16px',
      transition: 'all 0.3s ease',
      boxShadow: '0 0 10px rgba(0,255,136,0.3)'
    });
    fab.addEventListener('click', toggleListening);
    document.body.appendChild(fab);
  }

  function updateFabState() {
    if (!fab) return;
    if (active) {
      fab.style.borderColor = '#ff3366';
      fab.style.color = '#ff3366';
      fab.style.boxShadow = '0 0 15px rgba(255,51,102,0.5)';
      fab.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    } else {
      fab.style.borderColor = '#00ff88';
      fab.style.color = '#00ff88';
      fab.style.boxShadow = '0 0 10px rgba(0,255,136,0.3)';
      fab.innerHTML = '<i class="fas fa-microphone"></i>';
    }
  }

  function startListening() {
    if (listening) return;
    releaseRecognizer();

    const rec = new SR();
    rec.lang = 'it-IT';
    rec.continuous = true;
    rec.interimResults = true;
    recognition = rec;
    listening = true;
    active = true;
    updateFabState();

    let heardWake = false;

    rec.onresult = function (event) {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;

        if (!heardWake) {
          if (containsWakeWord(transcript)) {
            heardWake = true;
            const command = extractCommand(transcript);
            if (command && command.length > 1) {
              forwardCommand(command);
              heardWake = false;
            }
          }
        } else if (event.results[i].isFinal) {
          const cmd = transcript.trim();
          if (cmd) forwardCommand(cmd);
          heardWake = false;
        }
      }
    };

    rec.onerror = function (err) {
      if (err.error === 'aborted') return;
      if (err.error === 'not-allowed') {
        active = false;
        updateFabState();
        return;
      }
      // Auto-restart on other errors
      if (active) {
        listening = false;
        setTimeout(startListening, 500);
      }
    };

    rec.onend = function () {
      listening = false;
      if (active) {
        setTimeout(startListening, 200);
      }
    };

    try {
      rec.start();
    } catch (e) {
      listening = false;
    }
  }

  function stopListening() {
    active = false;
    releaseRecognizer();
    updateFabState();
  }

  function toggleListening() {
    if (active) {
      stopListening();
    } else {
      startListening();
    }
  }

  function releaseRecognizer() {
    if (recognition) {
      try { recognition.onend = null; recognition.abort(); } catch (e) {}
      recognition = null;
    }
    listening = false;
  }

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFab);
  } else {
    createFab();
  }
})();

// ── Apertura scheda/finestra: attiva le animazioni (html.savia-open)
// quando la finestra diventa visibile → l'entrata è visibile in ogni pagina.
(function () {
  function triggerOpenAnim() {
    var root = document.documentElement;
    root.classList.remove('savia-open');
    void root.offsetWidth;
    root.classList.add('savia-open');
  }
  function onVisible() {
    if (document.visibilityState === 'visible') triggerOpenAnim();
  }
  document.addEventListener('visibilitychange', onVisible);
  if (document.visibilityState === 'visible') {
    if (document.readyState === 'complete') {
      setTimeout(triggerOpenAnim, 60);
    } else {
      window.addEventListener('load', function () { setTimeout(triggerOpenAnim, 60); });
    }
  }
})();
