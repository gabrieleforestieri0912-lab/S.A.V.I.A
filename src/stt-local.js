/**
 * S.A.V.I.A - Local Speech-To-Text (fallback offline)
 *
 * Mic (getUserMedia) + VAD su RMS -> PCM16 @16kHz -> IPC -> Whisper
 * (transformers.js / onnxruntime-node nel main process).
 *
 * Il cloud Speech-to-Text di Chromium va spesso in "retry" di rete (in
 * particolare su protocolli custom): questo modulo lo sostituisce con
 * trascrizione locale, senza dipendenze di rete.
 */
(function () {
  const TARGET_RATE = 16000;
  const VAD_THRESHOLD = 0.012;
  const SILENCE_END_MS = 550;
  const MIN_SPEECH_MS = 200;
  const MAX_UTTER_MS = 12000;

  let stream = null;
  let audioCtx = null;
  let zeroGain = null;
  let processor = null;
  let running = false;
  let transcribing = false;
  let modelPromise = null;

  let utterance = [];
  let speechMs = 0;
  let silenceMs = 0;
  let inSpeech = false;
  let callbacks = { onUtterance: null, onStatus: null };

  function setStatus(s) {
    if (callbacks.onStatus) callbacks.onStatus(s);
  }

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      window.electronAPI && window.electronAPI.sttTranscribe);
  }

  function ensureModel() {
    if (modelPromise) return modelPromise;
    modelPromise = (async () => {
      if (!window.electronAPI || !window.electronAPI.sttLoad) return { ok: false };
      try {
        const r = await window.electronAPI.sttLoad();
        return { ok: r && r.ok === true };
      } catch (e) {
        return { ok: false };
      }
    })();
    return modelPromise;
  }

  function resampleTo16k(chunks, sampleRate) {
      let total = 0;
    for (const c of chunks) total += c.length;
    const mixed = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { mixed.set(c, off); off += c.length; }
    if (sampleRate === TARGET_RATE) return mixed;
    const outLen = Math.round(mixed.length * TARGET_RATE / sampleRate);
    const out = new Float32Array(outLen);
    const ratio = sampleRate / TARGET_RATE;
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, mixed.length - 1);
      const frac = pos - i0;
      out[i] = mixed[i0] + (mixed[i1] - mixed[i0]) * frac;
    }
    return out;
  }

  function floatToInt16(f) {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      out[i] = Math.round(s * 32767);
    }
    return out;
  }

  function resetState() {
    utterance = [];
    speechMs = 0;
    silenceMs = 0;
    inSpeech = false;
  }

  async function endUtterance(sampleRate) {
    if (transcribing) { resetState(); return; }
    if (speechMs < MIN_SPEECH_MS) { resetState(); return; }
    transcribing = true;
    const audio16 = floatToInt16(resampleTo16k(utterance, sampleRate));
    resetState();
    setStatus('ELABORA...');
    let text = '';
    try {
      const r = await window.electronAPI.sttTranscribe(audio16);
      if (r && r.ok) text = (r.text || '').trim();
      else if (r && r.error) console.warn('LocalSTT error:', r.error);
    } catch (e) {
      console.error('LocalSTT transcribe failed', e);
    }
    transcribing = false;
    if (callbacks.onUtterance) callbacks.onUtterance(text);
  }

  function start(opts) {
    if (running) return Promise.resolve();
    callbacks = opts || {};
    return new Promise((resolve, reject) => {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((s) => {
          stream = s;
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          if (audioCtx.resume) audioCtx.resume().catch(() => {});
          const source = audioCtx.createMediaStreamSource(stream);
          processor = audioCtx.createScriptProcessor(4096, 1, 1);
          zeroGain = audioCtx.createGain();
          zeroGain.gain.value = 0;
          source.connect(processor);
          processor.connect(zeroGain);
          zeroGain.connect(audioCtx.destination);
          const sampleRate = audioCtx.sampleRate || 48000;
          const durMs = (4096 / sampleRate) * 1000;

          processor.onaudioprocess = (e) => {
            if (!running || transcribing) return;
            const data = e.inputBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
            const rms = Math.sqrt(sum / data.length);
            if (rms > VAD_THRESHOLD) {
              utterance.push(new Float32Array(data));
              speechMs += durMs;
              silenceMs = 0;
              inSpeech = true;
            } else if (inSpeech) {
              silenceMs += durMs;
              if (silenceMs >= SILENCE_END_MS) {
                endUtterance(sampleRate);
                inSpeech = false;
              }
            }
            if (inSpeech && speechMs >= MAX_UTTER_MS) {
              endUtterance(sampleRate);
              inSpeech = false;
            }
          };

          running = true;
          setStatus('LOCAL STT');
          resolve(true);
        })
        .catch((err) => reject(err));
    });
  }

  function stop() {
    if (processor) {
      try { processor.disconnect(); } catch (e) {}
      try { processor.onaudioprocess = null; } catch (e) {}
      processor = null;
    }
    if (zeroGain) { try { zeroGain.disconnect(); } catch (e) {} zeroGain = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      stream = null;
    }
    running = false;
    resetState();
  }

  window.LocalSTT = { supported, ensureModel, start, stop };
})();