/**
 * S.A.V.I.A - Call Hotline Server
 *
 * Rende S.A.V.I.A raggiungibile telefonicamente:
 *   1) Twilio (numero) inoltra la chiamata al webhook /voice qui esposto
 *      tramite un tunnel (cloudflared) verso la rete pubblica.
 *   2) Il webhook risponde con TwiML <Connect><Stream> → WebSocket
 *      Media Streams (audio μ-law 8 kHz).
 *   3) Pipeline per ogni chiamata:
 *        μ-law → PCM → VAD → Whisper locale (STT) → Ollama (cervello)
 *        → ElevenLabs (TTS) → PCM → μ-law → rispedita su Media Streams.
 *
 * Nota: gira nel processo main (rete locale) così resta attivo anche
 * quando la finestra è minimizzata nella tray.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

// ============================================================
// CONFIGURAZIONE DI DEFAULT
// ============================================================
const DEFAULTS = {
  port: 8090,
  sttModel: 'Xenova/whisper-tiny',
  sttCacheDir: null,                    // impostata da main con userData
  sttLanguage: 'italian',
  brainHost: 'http://localhost:11434',
  brainModel: 'mistral',
  brainSystemPrompt: null,
  elevenLabsKey: '',
  elevenLabsVoiceId: '',
  twilioAccountSid: '',
  twilioAuthToken: '',
  twilioPhoneNumber: '',
  sttReady: false
};

let cfg = { ...DEFAULTS };
let server = null;
let wss = null;
let tunnelProc = null;
let publicUrl = null;
let tunnelStatus = 'off';
let activeSessions = new Map();
let onEvent = null; // callback (event, payload) verso main → UI

function setConfig(patch) { cfg = { ...cfg, ...(patch || {}) }; }
function setEventSink(cb) { onEvent = cb; }
function emit(type, payload) {
  if (onEvent) { try { onEvent(type, payload); } catch (e) { /* ignore */ } }
}

function status() {
  return {
    running: !!server,
    port: cfg.port,
    publicUrl,
    tunnelStatus,
    activeCalls: activeSessions.size,
    sttModel: cfg.sttModel,
    sttReady: cfg.sttReady,
    brainHost: cfg.brainHost,
    brainModel: cfg.brainModel,
    hasTwilio: !!(cfg.twilioAccountSid && cfg.twilioAuthToken && cfg.twilioPhoneNumber),
    hasElevenLabs: !!cfg.elevenLabsKey
  };
}

// Codice G.711 μ-law — tabella di decodifica (byte → Int16)
const MULAW_DECODE = new Int16Array(256);
for (let u = 0; u < 256; u++) {
  const mu = ~u;
  const sign = (mu & 0x80) ? -1 : 1;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  MULAW_DECODE[u] = sign * ((((mantissa << 3) | 0x84) << exponent) - 132);
}

function mulawDecodeToPcm16(base64Chunk) {
  const buf = Buffer.from(base64Chunk, 'base64');
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = MULAW_DECODE[buf[i]];
  return out;
}

function linearToMulaw(pcm) {
  let sign = (pcm >> 8) & 0x80;
  if (sign !== 0) pcm = -pcm;
  if (pcm > 32635) pcm = 32635;
  pcm += 132;
  let exponent = 7;
  let expMask = 0x4000;
  for (let e = 0; e < 8; e++) {
    if (pcm & expMask) { exponent = 7 - e; break; }
    expMask >>= 1;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function pcm16ToMulaw(chunk16) {
  const out = Buffer.alloc(chunk16.length);
  for (let i = 0; i < chunk16.length; i++) out[i] = linearToMulaw(chunk16[i]);
  return out;
}

// Resampler 8k→16k (interpolazione lineare)
function upsample8to16(pcm8) {
  if (pcm8.length === 0) return new Int16Array(0);
  const out = new Int16Array(pcm8.length * 2 - 1);
  for (let i = 0; i < pcm8.length - 1; i++) {
    out[2 * i] = pcm8[i];
    out[2 * i + 1] = Math.round((pcm8[i] + pcm8[i + 1]) / 2);
  }
  out[out.length - 1] = pcm8[pcm8.length - 1];
  return out;
}

// Downsample 16k→8k (decimazione)
function downsample16to8(pcm16) {
  const out = new Int16Array(Math.floor(pcm16.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = pcm16[2 * i];
  return out;
}

function int16ToFloat32(pcm16) {
  const out = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) out[i] = pcm16[i] / 32768;
  return out;
}

function rms(pcm16) {
  if (!pcm16.length) return 0;
  let s = 0;
  for (let i = 0; i < pcm16.length; i++) s += pcm16[i] * pcm16[i];
  return Math.sqrt(s / pcm16.length);
}

// ============================================================
// STT — Whisper locale (transformers.js, onnxruntime-node)
// ============================================================
let sttPipeline = null;

async function ensureSTT() {
  if (sttPipeline) return { ok: true };
  try {
    emit('stt', { status: 'loading', message: 'Caricamento modello Whisper locale...' });
    const { pipeline, env } = await import('@huggingface/transformers');
    if (cfg.sttCacheDir) env.cacheDir = cfg.sttCacheDir;
    sttPipeline = await pipeline('automatic-speech-recognition', cfg.sttModel, {
      dtype: 'q8',
      device: 'cpu'
    });
    cfg.sttReady = true;
    emit('stt', { status: 'ready', message: 'Modello STT pronto (' + cfg.sttModel + ')' });
    return { ok: true };
  } catch (e) {
    cfg.sttReady = false;
    emit('stt', { status: 'error', message: 'STT non disponibile: ' + (e.message || e) });
    return { ok: false, error: e.message };
  }
}

async function transcribe(pcm16) {
  if (!sttPipeline) {
    const r = await ensureSTT();
    if (!r.ok) return '';
  }
  const audio = int16ToFloat32(pcm16);
  try {
    const out = await sttPipeline(audio, { language: cfg.sttLanguage, task: 'transcribe' });
    return (out && out.text ? out.text : '').trim();
  } catch (e) {
    emit('call', { type: 'error', message: 'STT error: ' + e.message });
    return '';
  }
}

// ============================================================
// CERVELLO — Ollama
// ============================================================
async function askBrain(session, text) {
  const messages = [
    { role: 'system', content: cfg.brainSystemPrompt || 'You are S.A.V.I.A., a cybernetic AI assistant. Reply concisely, in the language of the user, with a sharp JARVIS tone.' },
    ...session.history,
    { role: 'user', content: text }
  ];

  try {
    const res = await fetch(cfg.brainHost + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.brainModel, messages, stream: false })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let reply = (data.message && data.message.content ? data.message.content : '').trim();
    reply = reply.replace(/\[ACTION:[^\]]*\]/gi, '').replace(/\[TOOL\][\s\S]*$/gi, '').replace(/\*\*/g, '').trim();
    return reply;
  } catch (e) {
    emit('call', { type: 'error', message: 'Ollama unreachable: ' + e.message });
    return 'Il mio cervello neurale è momentaneamente offline. Riprova tra poco, sir.';
  }
}

// ============================================================
// VOCE — ElevenLabs (PCM16 @16k → μ-law @8k)
// ============================================================
async function synthesize(text) {
  if (!cfg.elevenLabsKey || !cfg.elevenLabsVoiceId) return null;
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(cfg.elevenLabsVoiceId) + '?output_format=pcm_16000', {
      method: 'POST',
      headers: {
        'Accept': 'audio/pcm',
        'Content-Type': 'application/json',
        'xi-api-key': cfg.elevenLabsKey
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 }
      })
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const pcm16 = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    return pcm16;
  } catch (e) {
    emit('call', { type: 'error', message: 'TTS error: ' + e.message });
    return null;
  }
}

// ============================================================
// SESSIONE CHIAMATA (una per Media Stream)
// ============================================================
const VAD_THRESHOLD = 350;      // RMS Int16 sopra cui si considera "parlato"
const VAD_END_MS = 900;         // silenzio che conclude un'utterance
const VAD_MAX_MS = 20000;       // utterance massima
const BARGEIN_THRESHOLD = 400;

class CallSession {
  constructor(socket, streamSid) {
    this.socket = socket;
    this.streamSid = streamSid;
    this.history = [];
    this.playing = false;
    this.ended = false;

    // VAD / utterance
    this.buffer = [];          // Float32 16k accumulato
    this.speechActive = false;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.lastChunkMs = 0;
    this.processing = false;
    this.pending = false;
  }

  emitMsg(obj) {
    if (this.socket && this.socket.readyState === 1) {
      try { this.socket.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
    }
  }

  handleMedia(base64Payload, sampleRate) {
    const pcm8 = mulawDecodeToPcm16(base64Payload);
    const pcm16 = upsample8to16(pcm8);

    // barge-in durante la riproduzione
    if (this.playing && rms(pcm16) > BARGEIN_THRESHOLD) {
      this.stopPlayback();
    }

    // VAD su frame 16k
    this.feedVad(pcm16, sampleRate || 8000);
  }

  feedVad(pcm16, sourceRate) {
    const chunkMs = (pcm16.length / (sourceRate * 2)) * 1000; // 16k dopo upsample
    const r = rms(pcm16);

    if (r > VAD_THRESHOLD) {
      this.speechActive = true;
      this.silenceMs = 0;
      this.speechMs += chunkMs;
    } else if (this.speechActive) {
      this.silenceMs += chunkMs;
    }

    // accoda campioni
    const f = int16ToFloat32(pcm16);
    for (let i = 0; i < f.length; i++) this.buffer.push(f[i]);

    // taglio utterance
    if (this.speechActive && this.silenceMs >= VAD_END_MS) {
      this.cutUtterance();
    } else if (this.speechActive && this.speechMs >= VAD_MAX_MS) {
      this.cutUtterance();
    }
  }

  cutUtterance() {
    if (this.buffer.length < 1600) { // < 50ms@16k: rumore, scarta
      this.buffer.length = 0;
      this.speechActive = false;
      this.silenceMs = 0;
      this.speechMs = 0;
      return;
    }
    const seg = new Float32Array(this.buffer);
    const pcm16 = new Int16Array(seg.length);
    for (let i = 0; i < seg.length; i++) pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(seg[i] * 32768)));

    this.buffer.length = 0;
    this.speechActive = false;
    this.silenceMs = 0;
    this.speechMs = 0;

    if (this.processing) { this.pending = true; return; }
    this.processUtterance(pcm16);
  }

  async processUtterance(pcm16) {
    this.processing = true;
    try {
      emit('call', { type: 'stt_start' });
      const text = await transcribe(pcm16);
      if (!text) { emit('call', { type: 'stt_empty' }); return; }

      emit('call', { type: 'user', text, from: 'phone' });
      if (this.ended) return;

      const reply = await askBrain(this, text);
      if (this.ended) return;

      this.history.push({ role: 'user', content: text });
      this.history.push({ role: 'assistant', content: reply });
      if (this.history.length > 12) this.history = this.history.slice(-12);

      emit('call', { type: 'savia', text: reply, from: 'phone' });
      await this.playText(reply);
    } catch (e) {
      emit('call', { type: 'error', message: e.message });
    } finally {
      this.processing = false;
      if (this.pending) {
        this.pending = false;
        if (this.buffer.length) {
          const seg = new Float32Array(this.buffer);
          const p16 = new Int16Array(seg.length);
          for (let i = 0; i < seg.length; i++) p16[i] = Math.max(-32768, Math.min(32767, Math.round(seg[i] * 32768)));
          this.buffer.length = 0;
          this.processUtterance(p16);
        }
      }
    }
  }

  async playText(text) {
    if (!text || this.ended) return;
    const pcm16 = await synthesize(text);
    if (!pcm16 || pcm16.length === 0 || this.ended) return;

    const pcm8 = downsample16to8(pcm16);
    const mulaw = pcm16ToMulaw(pcm8);
    const CHUNK = 800; // 100ms @8k
    this.playing = true;

    for (let i = 0; i < mulaw.length && this.playing && !this.ended; i += CHUNK) {
      const piece = mulaw.slice(i, i + CHUNK);
      this.emitMsg({
        event: 'media',
        streamSid: this.streamSid,
        media: { track: 'outbound', chunk: piece.length, timestamp: '', payload: piece.toString('base64') }
      });
      // pacing ~ durata reale del pezzo
      await new Promise(r => setTimeout(r, Math.min(60, (piece.length / 8000) * 1000 + 10)));
    }
    this.playing = false;
  }

  stopPlayback() {
    this.playing = false;
    this.emitMsg({
      event: 'clear',
      streamSid: this.streamSid,
      clear: { track: 'outbound' }
    });
    emit('call', { type: 'bargein' });
  }

  async greet() {
    const greeting = 'S.A.V.I.A online. Dimmi pure, sir.';
    emit('call', { type: 'savia', text: greeting, from: 'phone' });
    await this.playText(greeting);
  }

  close() {
    this.ended = true;
    this.playing = false;
    this.socket = null;
  }
}

// ============================================================
// SERVER HTTP + WEBSOCKET
// ============================================================
function buildTwiML(req) {
  const host = req.headers.host || ('127.0.0.1:' + cfg.port);
  const wsUrl = 'wss://' + host + '/media-stream';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="language" value="it-IT"/>
    </Stream>
  </Connect>
</Response>`;
}

function start() {
  if (server) return { ok: true, alreadyRunning: true };

  server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (req.method === 'POST' && urlPath === '/voice') {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(buildTwiML(req));
      return;
    }
    if (req.method === 'POST' && urlPath === '/status') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const params = new URLSearchParams(body);
          emit('call', { type: 'callstatus', callStatus: params.get('CallStatus'), from: params.get('From'), to: params.get('To') });
        } catch (e) { /* ignore */ }
        res.writeHead(200); res.end('OK');
      });
      return;
    }
    if (req.method === 'GET' && (urlPath === '/' || urlPath === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'savia-hotline', activeCalls: activeSessions.size }));
      return;
    }
    res.writeHead(404); res.end('Not Found');
  });

  wss = new WebSocketServer({ server, path: '/media-stream' });

  wss.on('connection', (socket) => {
    let session = null;
    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }

      if (msg.event === 'connected') return;
      if (msg.event === 'start') {
        const sid = msg.streamSid;
        session = new CallSession(socket, sid);
        activeSessions.set(sid, session);
        emit('call', { type: 'ringing', streamSid: sid, callSid: msg.callSid });
        session.greet().catch(() => {});
        return;
      }
      if (!session) return;
      if (msg.event === 'media' && msg.media && msg.media.payload) {
        session.handleMedia(msg.media.payload, msg.media.track === 'outbound' ? 0 : 8000);
      }
      if (msg.event === 'stop') {
        if (session) session.close();
        activeSessions.delete(msg.streamSid);
        emit('call', { type: 'hangup', streamSid: msg.streamSid });
      }
    });
    socket.on('close', () => {
      if (session) { session.close(); activeSessions.delete(session.streamSid); }
      emit('call', { type: 'hangup' });
    });
    socket.on('error', () => {});
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, () => {
      emit('call', { type: 'server', message: 'Hotline in ascolto sulla porta ' + cfg.port });
      resolve({ ok: true, port: cfg.port });
    });
  });
}

function stop() {
  for (const s of activeSessions.values()) s.close();
  activeSessions.clear();
  stopTunnel();
  if (wss) { try { wss.close(); } catch (e) {} wss = null; }
  if (server) { try { server.close(); } catch (e) {} server = null; }
  emit('call', { type: 'server', message: 'Hotline fermata' });
  return { ok: true };
}

// ============================================================
// TUNNEL cloudflared (quick tunnel gratuito)
// ============================================================
function tunnelBinary() {
  const local = path.join(require('os').homedir(), '.cloudflared', 'cloudflared.exe');
  if (fs.existsSync(local)) return local;
  const userData = cfg.sttCacheDir ? path.dirname(cfg.sttCacheDir) : null;
  if (userData) {
    const p = path.join(userData, 'cloudflared.exe');
    if (fs.existsSync(p)) return p;
  }
  // fallback: PATH
  try {
    const { execSync } = require('child_process');
    execSync('cloudflared --version', { stdio: 'ignore', windowsHide: true });
    return 'cloudflared';
  } catch (e) { /* not on PATH */ }
  return null;
}

function ensureTunnelBinary() {
  if (tunnelBinary()) return tunnelBinary();
  // download auto di cloudflared (x64) in userData
  const userData = cfg.sttCacheDir ? path.dirname(cfg.sttCacheDir) : null;
  if (!userData) return null;
  const dest = path.join(userData, 'cloudflared.exe');
  const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  emit('tunnel', { status: 'downloading', message: 'Scaricamento cloudflared...' });
  const proc = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', `Invoke-WebRequest -Uri '${url}' -OutFile '${dest}'`
  ], { windowsHide: true, detached: true });
  return new Promise((resolve) => {
    proc.on('exit', (code) => {
      if (code === 0 && fs.existsSync(dest)) {
        emit('tunnel', { status: 'ok', message: 'cloudflared pronto' });
        resolve(dest);
      } else {
        emit('tunnel', { status: 'error', message: 'Download cloudflared fallito. Installalo manualmente o usa il PORT FORWARDING.' });
        resolve(null);
      }
    });
  });
}

function startTunnel() {
  return new Promise(async (resolve) => {
    stopTunnel();
    let bin = tunnelBinary();
    if (!bin) bin = await ensureTunnelBinary();
    if (!bin) { tunnelStatus = 'no-tunnel'; resolve(null); return; }

    tunnelStatus = 'starting';
    emit('tunnel', { status: 'starting', message: 'Avvio tunnel pubblico...' });

    tunnelProc = spawn(bin, ['tunnel', '--url', 'http://127.0.0.1:' + cfg.port], { windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { if (!publicUrl) { tunnelStatus = 'error'; resolve(null); } }, 20000);

    tunnelProc.stdout.on('data', (d) => {
      output += d.toString();
      const m = output.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
      if (m && !publicUrl) {
        publicUrl = m[0];
        tunnelStatus = 'up';
        clearTimeout(timer);
        emit('tunnel', { status: 'up', url: publicUrl });
        resolve(publicUrl);
      }
    });
    tunnelProc.stderr.on('data', (d) => { output += d.toString(); });
    tunnelProc.on('exit', () => {
      tunnelStatus = 'error';
      emit('tunnel', { status: 'error', message: 'Tunnel terminato' });
    });
  });
}

function stopTunnel() {
  if (tunnelProc) { try { tunnelProc.kill(); } catch (e) {} tunnelProc = null; }
  publicUrl = null;
  tunnelStatus = 'off';
}

// ============================================================
// TWILIO — auto-configurazione del numero (voiceUrl)
// ============================================================
async function updateTwilioWebhook() {
  if (!cfg.twilioAccountSid || !cfg.twilioAuthToken || !publicUrl) return { ok: false, reason: 'missing-config' };
  try {
    const auth = 'Basic ' + Buffer.from(cfg.twilioAccountSid + ':' + cfg.twilioAuthToken).toString('base64');
    const api = 'https://api.twilio.com/2010-04-01/Accounts/' + cfg.twilioAccountSid;

    // trova il SID del numero
    const qs = new URLSearchParams({ PhoneNumber: cfg.twilioPhoneNumber });
    const listRes = await fetch(api + '/IncomingPhoneNumbers.json?' + qs, { headers: { Authorization: auth } });
    const listData = await listRes.json();
    const number = (listData.incoming_phone_numbers || []).find(n => n.phoneNumber === cfg.twilioPhoneNumber);
    if (!number) return { ok: false, reason: 'number-not-found' };

    const form = new URLSearchParams({
      VoiceUrl: publicUrl + '/voice',
      VoiceMethod: 'POST',
      StatusCallback: publicUrl + '/status',
      StatusCallbackEvent: 'initiated ringing answered completed',
      StatusCallbackMethod: 'POST'
    });
    const updRes = await fetch(api + '/IncomingPhoneNumbers/' + number.sid + '.json', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    if (!updRes.ok) return { ok: false, reason: 'http-' + updRes.status };
    emit('tunnel', { status: 'configured', url: publicUrl });
    return { ok: true, url: publicUrl };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = {
  setConfig,
  setEventSink,
  status,
  start,
  stop,
  ensureSTT,
  startTunnel,
  stopTunnel,
  updateTwilioWebhook,
  // codec (esposti per test)
  _codec: { mulawDecodeToPcm16, pcm16ToMulaw, linearToMulaw }
};
