/**
 * S.A.V.I.A - Call Hotline page controller
 * Gestione della hotline telefonica (hotline.html).
 */

const logEl = document.getElementById('hlLog');
const dotService = document.getElementById('dotService');
const lblService = document.getElementById('lblService');
const lblPort = document.getElementById('lblPort');
const lblTunnel = document.getElementById('lblTunnel');
const lblCalls = document.getElementById('lblCalls');
const lblStt = document.getElementById('lblStt');
const lblBrain = document.getElementById('lblBrain');
const lblUrl = document.getElementById('lblUrl');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnLoadStt = document.getElementById('btnLoadStt');
const btnSave = document.getElementById('btnSave');
const btnTestTwi = document.getElementById('btnTestTwi');
const chkAuto = document.getElementById('chkAuto');
const cfgPort = document.getElementById('cfgPort');
const cfgSttModel = document.getElementById('cfgSttModel');
const cfgTwilioSid = document.getElementById('cfgTwilioSid');
const cfgTwilioToken = document.getElementById('cfgTwilioToken');
const cfgTwilioNumber = document.getElementById('cfgTwilioNumber');
const cfgVoiceId = document.getElementById('cfgVoiceId');

const clock = document.getElementById('clock-display');
setInterval(() => { clock.textContent = new Date().toTimeString().split(' ')[0]; }, 1000);

document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI?.windowMinimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI?.windowMaximize());
document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI?.windowClose());

function log(type, msg) {
  const cls = { sys: 'ln-sys', user: 'ln-user', savia: 'ln-savia', warn: 'ln-warn', error: 'ln-error' }[type] || 'ln-sys';
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  logEl.appendChild(div);
  while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function setDot(el, state) {
  el.className = 'hl-status-dot ' + state; // hl-on | hl-off | hl-stby
}

function renderStatus(s) {
  if (!s) return;
  const on = !!s.running;
  setDot(dotService, on ? 'hl-on' : 'hl-off');
  lblService.textContent = on ? 'ONLINE' : 'OFF';
  lblPort.textContent = s.port || '-';
  lblTunnel.textContent = s.tunnelStatus || 'off';
  lblCalls.textContent = s.activeCalls || 0;
  lblStt.textContent = s.sttReady ? ('PRONTO · ' + (s.sttModel || '')) : 'NON CARICATO';
  lblBrain.textContent = (s.brainModel || '?').toUpperCase();
  if (s.publicUrl) lblUrl.textContent = s.publicUrl + '/voice\n' + s.publicUrl + '/status';
}

function applyStatusEvent(payload) {
  if (!payload) return;
  switch (payload.type) {
    case 'server': log('sys', payload.message); break;
    case 'ringing': log('sys', 'CHIAMATA IN ARRIVO (' + (payload.callSid || '?') + ')'); break;
    case 'callstatus': log('sys', 'STATO: ' + (payload.callStatus || '') + ' · da ' + (payload.from || '?')); break;
    case 'user': log('user', 'TU: ' + payload.text); break;
    case 'savia': log('savia', 'S.A.V.I.A: ' + payload.text); break;
    case 'stt_start': log('sys', 'Trascrizione...'); break;
    case 'stt_empty': log('warn', 'Nessun testo riconosciuto.'); break;
    case 'bargein': log('sys', 'Barge-in: riproduzione interrotta.'); break;
    case 'hangup': log('sys', 'Chiamata terminata.'); break;
    case 'error': log('error', payload.message); break;
  }
}

function applyTunnelEvent(payload) {
  if (!payload) return;
  switch (payload.status) {
    case 'starting': log('sys', 'Avvio tunnel pubblico...'); break;
    case 'downloading': log('warn', payload.message); break;
    case 'ok': log('sys', payload.message); break;
    case 'up': log('sys', 'Tunnel attivo: ' + payload.url); break;
    case 'configured': log('sys', 'Webhook Twilio aggiornato: ' + payload.url); break;
    case 'error': log('error', payload.message); break;
  }
}

function applySttEvent(payload) {
  if (!payload) return;
  if (payload.status === 'loading') log('sys', payload.message);
  if (payload.status === 'ready') { log('sys', payload.message); refreshStatus(); }
  if (payload.status === 'error') log('error', payload.message);
}

window.electronAPI?.onCallEvent(({ type, payload }) => {
  if (type === 'call') applyStatusEvent(payload);
  else if (type === 'tunnel') applyTunnelEvent(payload);
  else if (type === 'stt') applySttEvent(payload);
});

async function refreshStatus() {
  const s = await window.electronAPI.callHotlineStatus();
  renderStatus(s);
  return s;
}

function readForm() {
  return {
    hotlinePort: parseInt(cfgPort.value) || 8090,
    hotlineSttModel: cfgSttModel.value.trim() || 'Xenova/whisper-tiny',
    twilioAccountSid: cfgTwilioSid.value.trim(),
    twilioAuthToken: cfgTwilioToken.value.trim(),
    twilioPhoneNumber: cfgTwilioNumber.value.trim(),
    hotlineVoiceId: cfgVoiceId.value.trim()
  };
}

async function loadConfig() {
  const cfg = await window.electronAPI.configGet();
  if (cfg) {
    if (cfg.hotlinePort) cfgPort.value = cfg.hotlinePort;
    if (cfg.hotlineSttModel) cfgSttModel.value = cfg.hotlineSttModel;
    if (cfg.twilioAccountSid) cfgTwilioSid.value = cfg.twilioAccountSid;
    if (cfg.twilioAuthToken) cfgTwilioToken.value = cfg.twilioAuthToken;
    if (cfg.twilioPhoneNumber) cfgTwilioNumber.value = cfg.twilioPhoneNumber;
    if (cfg.hotlineVoiceId) cfgVoiceId.value = cfg.hotlineVoiceId;
    chkAuto.checked = !!cfg.hotlineEnabled;
  }
}

btnStart?.addEventListener('click', async () => {
  await window.electronAPI.callHotlineConfig(readForm());
  log('sys', 'Avvio hotline...');
  const r = await window.electronAPI.callHotlineStart();
  renderStatus(r);
  if (r && r.webhook) {
    if (r.webhook.ok) log('sys', 'Webhook Twilio configurato.');
    else if (r.webhook.reason === 'no-tunnel') log('warn', 'Tunnel non disponibile: controlla cloudflared.');
    else if (r.webhook.reason === 'missing-config') log('warn', 'Credenziali Twilio mancanti: webhook da impostare manualmente.');
    else if (r.webhook.reason === 'number-not-found') log('error', 'Numero Twilio non trovato sull\'account.');
    else log('warn', 'Webhook non aggiornato: ' + r.webhook.reason);
  }
});

btnStop?.addEventListener('click', async () => {
  const r = await window.electronAPI.callHotlineStop();
  renderStatus(r);
  log('sys', 'Hotline fermata.');
});

btnLoadStt?.addEventListener('click', async () => {
  await window.electronAPI.callHotlineConfig({ hotlineSttModel: cfgSttModel.value.trim() });
  log('sys', 'Caricamento modello STT (la prima volta scarica ~75MB)...');
  btnLoadStt.disabled = true;
  const r = await window.electronAPI.callHotlineStt(cfgSttModel.value.trim());
  btnLoadStt.disabled = false;
  renderStatus(r);
});

btnSave?.addEventListener('click', async () => {
  const patch = readForm();
  patch.hotlineEnabled = chkAuto.checked;
  await window.electronAPI.callHotlineConfig(patch);
  log('sys', 'Configurazione salvata.');
});

btnTestTwi?.addEventListener('click', async () => {
  log('sys', 'Riavvio tunnel + aggiornamento webhook...');
  const r = await window.electronAPI.callHotlineStart();
  renderStatus(r);
  if (r && r.webhook && r.webhook.ok) log('sys', 'Webhook aggiornato: ' + r.webhook.url);
});

chkAuto?.addEventListener('change', async () => {
  await window.electronAPI.callHotlineConfig({ hotlineEnabled: chkAuto.checked });
  log('sys', 'Autostart hotline: ' + (chkAuto.checked ? 'ATTIVO' : 'DISATTIVO'));
});

// Push del "cervello" corrente (modello + prompt della dashboard)
function pushBrain() {
  const model = (typeof getActiveModel === 'function') ? getActiveModel() : null;
  const systemPrompt = (typeof getAgentPrompt === 'function') ? getAgentPrompt() : null;
  if (window.electronAPI?.callHotlineBrain && model) {
    window.electronAPI.callHotlineBrain({ model, systemPrompt, aiHost: 'http://localhost:11434' });
  }
}

async function init() {
  await loadConfig();
  await refreshStatus();
  pushBrain();
}

init();
