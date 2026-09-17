/**
 * S.A.V.I.A - Proximity page controller (proximity.html)
 * Rilevamento dispositivi BLE + sblocco ADB automatico.
 */

const logEl = document.getElementById('pxLog');
const dotService = document.getElementById('dotService');
const lblService = document.getElementById('lblService');
const lblBackend = document.getElementById('lblBackend');
const lblPython = document.getElementById('lblPython');
const lblAdb = document.getElementById('lblAdb');
const lblAdbDevices = document.getElementById('lblAdbDevices');
const lblSignals = document.getElementById('lblSignals');
const lblKnown = document.getElementById('lblKnown');
const lblNear = document.getElementById('lblNear');
const nearbyList = document.getElementById('nearbyList');
const knownList = document.getElementById('knownList');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnDeps = document.getElementById('btnDeps');
const btnAdb = document.getElementById('btnAdb');
const btnSaveCfg = document.getElementById('btnSaveCfg');
const btnPair = document.getElementById('btnPair');
const btnConnect = document.getElementById('btnConnect');
const chkAuto = document.getElementById('chkAuto');
const cfgThreshold = document.getElementById('cfgThreshold');
const outThreshold = document.getElementById('outThreshold');
const cfgCooldown = document.getElementById('cfgCooldown');
const cfgAdbPath = document.getElementById('cfgAdbPath');

const clock = document.getElementById('clock-display');
setInterval(() => { clock.textContent = new Date().toTimeString().split(' ')[0]; }, 1000);

document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI?.windowMinimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI?.windowMaximize());
document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI?.windowClose());

let lastDevJSON = '';
let addFormHTML = '';

function log(level, msg) {
  const cls = { sys: 'ln-sys', ok: 'ln-ok', savia: 'ln-savia', warn: 'ln-warn', error: 'ln-error' }[level] || 'ln-sys';
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  logEl.appendChild(div);
  while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function setDot(el, state) { el.className = 'hl-status-dot ' + state; }

function rssiPct(rssi) {
  if (rssi == null) return 0;
  const min = -100, max = -30;
  return Math.max(4, Math.min(100, Math.round(((rssi - min) / (max - min)) * 100)));
}

function renderStatus(s) {
  if (!s) return;
  const on = !!s.running;
  setDot(dotService, on ? 'hl-on' : 'hl-off');
  lblService.textContent = on ? 'SCANNING' : 'OFF';
  const be = s.backend || 'stopped';
  lblBackend.textContent = be;
  lblBackend.style.color = be === 'up' ? '#00ff88' : be === 'missing-deps' || be === 'error' ? 'var(--accent-red)' : 'var(--accent-gold)';
  lblPython.textContent = s.python || '-';
  lblAdb.textContent = s.adbAvailable ? (s.adbPath || 'pronto') : 'NON TROVATO';
  lblAdb.style.color = s.adbAvailable ? '#00ff88' : 'var(--accent-red)';
  lblAdbDevices.textContent = (s.adbDevices || []).length;
  lblSignals.textContent = (s.nearby || []).length;
  lblKnown.textContent = (s.knownDevices || []).length;
  lblNear.textContent = (s.knownDevices || []).filter(d => d.near).length;
}

function renderNearby(list) {
  if (!list || !list.length) {
    nearbyList.innerHTML = '<div class="ln-sys">Nessun segnale. Avvia la scansione.</div>';
    document.getElementById('lblNearbyCount').textContent = '';
    return;
  }
  const known = (currentStatus && currentStatus.knownDevices) || [];
  const knownSet = new Set(known.map(d => d.mac));
  document.getElementById('lblNearbyCount').textContent = '(' + list.length + ')';
  nearbyList.innerHTML = list.map(dev => {
    const isKnown = knownSet.has(dev.mac);
    const lbl = dev.name || dev.mac;
    return `<div class="px-dev ${isKnown ? '' : 'clickable'}" data-mac="${dev.mac}" data-name="${escAttr(lbl)}" data-rssi="${dev.rssi}" style="cursor:pointer;" onclick="startAddDevice(this.dataset.mac, this.dataset.name)">
      <span style="font-size:10px;color:${isKnown ? '#00ff88' : '#fff'};">${isKnown ? '●' : '○'} ${escHtml(lbl)}</span>
      <span style="font-size:9px;color:rgba(255,255,255,0.3);">${dev.mac}</span>
      <div class="px-rssi-box"><div class="px-rssi-fill" style="width:${rssiPct(dev.rssi)}%"></div></div>
      <span style="font-size:10px;color:${dev.rssi > -50 ? '#00ff88' : dev.rssi > -68 ? 'var(--accent-gold)' : 'var(--accent-red)'};min-width:36px;text-align:right;">${dev.rssi}</span>
    </div>`;
  }).join('');
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escAttr(s) { return escHtml(s); }

function renderKnown(devices) {
  const json = JSON.stringify(devices);
  if (json === lastDevJSON && document.activeElement && !document.activeElement.closest('#knownList')) return;
  lastDevJSON = json;
  if (!devices || !devices.length) {
    knownList.innerHTML = '<div class="ln-sys">Nessun dispositivo aggiunto.</div>';
    return;
  }
  knownList.innerHTML = devices.map(d => {
    return `<div class="px-krow ${d.near ? 'near' : ''}" data-mac="${d.mac}">
      <div class="px-khead">
        <span class="px-kname">${escHtml(d.name || d.mac)}</span>
        <span class="px-kmeta">${(d.near ? '● VICINO ' : '○ ') + d.mac} · ${d.type || 'ble'} · ${d.near ? (d.rssi != null ? d.rssi + ' dBm (BLE)' : 'rete ADB') : 'lontano'}</span>
      </div>
      <div class="px-kcontrols">
        <input type="text" data-k="adbHost" value="${escAttr(d.adbHost || '')}" placeholder="ADB host (es. 192.168.1.50)" title="Host ADB Wireless Debugging" />
        <input type="text" data-k="adbPort" value="${escAttr(d.adbPort || '')}" placeholder="port" style="width:70px;" title="Porta ADB (sessione)" />
        <label class="px-check" style="font-size:9px;font-family:var(--font-mono);"><input type="checkbox" data-k="networkTrigger" ${d.networkTrigger ? 'checked' : ''}><span style="color:rgba(255,255,255,0.4);">sblocca su rete</span></label>
        <label class="px-check" style="font-size:9px;font-family:var(--font-mono);"><input type="checkbox" data-k="autoUnlock" ${d.autoUnlock ? 'checked' : ''}><span style="color:#00ff88;">AUTO-UNLOCK</span></label>
        <button class="px-mini-btn" data-act="save">SALVA</button>
        <button class="px-mini-btn green" data-act="test">TEST ADB</button>
        <button class="px-mini-btn green" data-act="unlock"><i class="fas fa-unlock-alt"></i> SBLOCCO</button>
        <button class="px-mini-btn danger" data-act="remove"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

// ── Pairing / connect helpers ───────────────────────────────────
function adbTarget(mode) {
  const ip = document.getElementById('adbIp').value.trim();
  const port = document.getElementById('adbPort').value.trim();
  if (!ip) { log('warn', 'Inserisci l\'IP del telefono.'); return null; }
  if (!port) { log('warn', 'Inserisci la porta.'); return null; }
  return ip + ':' + port;
}

btnPair?.addEventListener('click', async () => {
  const hp = adbTarget('pair');
  const code = document.getElementById('adbCode').value.trim();
  if (!hp || !code) { log('warn', 'Servono IP:porta e code di pairing.'); return; }
  log('warn', `Pairing con ${hp}...`);
  const r = await window.electronAPI.proximityPair(hp, code);
  log(r.ok ? 'savia' : 'error', r.ok ? `Coppia creata: ${hp}` : ('Pairing fallito: ' + (r.output || 'errore')));
  const c = await window.electronAPI.proximityConnect(hp);
  log(c.ok ? 'ok' : 'error', c.ok ? `ADB connesso: ${hp}` : ('ADB connect fallito: ' + (c.error || '')));
});

btnConnect?.addEventListener('click', async () => {
  const hp = adbTarget();
  if (!hp) return;
  const c = await window.electronAPI.proximityConnect(hp);
  log(c.ok ? 'ok' : 'error', hp + ': ' + (c.ok ? 'connesso' : (c.error || 'fallito')));
});

// ── Start/stop/config ───────────────────────────────────────────
btnStart?.addEventListener('click', async () => {
  await saveSettings();
  log('warn', 'Avvio scansione BLE...');
  const s = await window.electronAPI.proximityStart();
  renderStatus(s);
  if (s.backend === 'missing-deps') log('error', 'Backend non pronto: installa le dipendenze BLE.');
});

btnStop?.addEventListener('click', async () => {
  const s = await window.electronAPI.proximityStop();
  renderStatus(s);
  log('sys', 'Scansione fermata.');
});

btnDeps?.addEventListener('click', async () => {
  const r = await window.electronAPI.proximityInstallDeps();
  log(r.ok ? 'savia' : 'error', r.ok ? 'Dipendenze BLE installate.' : 'Installazione fallita: ' + (r.error || ''));
  const s = await window.electronAPI.proximityStatus();
  renderStatus(s);
});

btnAdb?.addEventListener('click', async () => {
  log('warn', 'Download platform-tools in corso...');
  const r = await window.electronAPI.proximityInstallAdb();
  log(r.ok ? 'ok' : 'error', r.ok ? 'ADB pronto: ' + r.path : ('Download/estrazione falliti: ' + (r.error || '')));
  const s = await window.electronAPI.proximityStatus();
  renderStatus(s);
});

btnSaveCfg?.addEventListener('click', async () => {
  await saveSettings();
  log('ok', 'Impostazioni salvate.');
});

async function saveSettings() {
  const patch = {
    proximityThreshold: parseInt(cfgThreshold.value, 10) || -65,
    proximityCooldownSec: parseInt(cfgCooldown.value, 10) || 60,
    proximityAdbPath: cfgAdbPath.value.trim(),
    proximityEnabled: chkAuto.checked
  };
  const s = await window.electronAPI.proximityConfig(patch);
  renderStatus(s);
  return s;
}

cfgThreshold?.addEventListener('input', () => { outThreshold.textContent = cfgThreshold.value; });

chkAuto?.addEventListener('change', () => saveSettings());

// ── Add / edit known device ─────────────────────────────────────
function startAddDevice(mac, name) {
  mac = mac.toUpperCase();
  const known = (currentStatus && currentStatus.knownDevices) || [];
  if (known.some(d => d.mac === mac)) { log('warn', 'Dispositivo già presente.'); return; }
  const panel = document.createElement('div');
  panel.className = 'px-krow';
  panel.innerHTML = `<div class="px-khead"><span class="px-kname">NUOVO: ${escHtml(name || mac)}</span><span class="px-kmeta">${mac}</span></div>
    <div class="px-kcontrols">
      <input type="text" id="newName" value="${escAttr(name || '')}" placeholder="Nome (es. Il mio telefono)" style="width:150px;" />
      <select id="newType" style="width:90px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:var(--accent-cyan);font-size:11px;padding:5px 7px;">
        <option value="android">Android</option>
        <option value="ios">iPhone</option>
        <option value="ble">Altro BLE</option>
      </select>
      <input type="text" id="newAdb" placeholder="ADB host:port sessione" style="width:150px;" title="Solo Android: IP:porta dalla schermata Wireless Debugging" />
      <button class="px-mini-btn green" id="newAdd">AGGIUNGI</button>
      <button class="px-mini-btn danger" id="newCancel">ANNULLA</button>
    </div>`;
  knownList.insertBefore(panel, knownList.firstChild);
  panel.querySelector('#newAdd').onclick = async () => {
    const dev = {
      mac,
      name: panel.querySelector('#newName').value.trim() || name || mac,
      type: panel.querySelector('#newType').value,
      adbHost: '',
      adbPort: '',
      autoUnlock: true,
      networkTrigger: false,
      rssi: 0
    };
    const adb = panel.querySelector('#newAdb').value.trim();
    if (dev.type === 'android' && adb.includes(':')) {
      const [h, p] = adb.split(':');
      dev.adbHost = h.trim(); dev.adbPort = p.trim();
    }
    const s = await window.electronAPI.proximityAddDevice(dev);
    currentStatus = s;
    lastDevJSON = '';
    renderKnown(s.knownDevices);
    log('ok', `Aggiunto: ${dev.name} (${dev.type})`);
  };
  panel.querySelector('#newCancel').onclick = () => { panel.remove(); };
}

// Event delegation su known list
knownList.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const row = btn.closest('.px-krow');
  if (!row) return;
  const mac = row.dataset.mac;
  const devices = (currentStatus && currentStatus.knownDevices) || [];
  const idx = devices.findIndex(d => d.mac === mac);
  if (idx < 0) return;
  const dev = { ...devices[idx] };

  const act = btn.dataset.act;
  if (act === 'remove') {
    const s = await window.electronAPI.proximityRemoveDevice(mac);
    currentStatus = s; lastDevJSON = ''; renderKnown(s.knownDevices);
    log('sys', 'Dispositivo rimosso: ' + (dev.name || mac));
    return;
  }
  if (act === 'save') {
    dev.adbHost = row.querySelector('[data-k="adbHost"]').value.trim();
    dev.adbPort = row.querySelector('[data-k="adbPort"]').value.trim();
    dev.networkTrigger = row.querySelector('[data-k="networkTrigger"]').checked;
    dev.autoUnlock = row.querySelector('[data-k="autoUnlock"]').checked;
    const s = await window.electronAPI.proximityAddDevice(dev);
    currentStatus = s; lastDevJSON = ''; renderKnown(s.knownDevices);
    log('ok', `Configurazione salvata per ${dev.name}.`);
    return;
  }
  if (act === 'test') {
    const hp = (dev.adbHost || '') + ':' + (dev.adbPort || '5555');
    if (!dev.adbHost) { log('warn', 'Host ADB non impostato per ' + dev.name); return; }
    const c = await window.electronAPI.proximityTestAdb(hp);
    log(c.ok ? 'ok' : 'error', `${dev.name}: ADB ${c.ok ? 'RAGGIUNGIBILE' : 'non raggiungibile (' + (c.output || '') + ')'}`);
    return;
  }
  if (act === 'unlock') {
    log('warn', `Tentativo sblocco ${dev.name}...`);
    const r = await window.electronAPI.proximityUnlockNow(mac);
    log(r.ok ? 'savia' : 'error', r.ok ? `Sbloccato ${dev.name}` : ('Sblocco fallito: ' + (r.error || '')));
  }
});

// ── Eventi da main ──────────────────────────────────────────────
window.electronAPI?.onProximityEvent((evt) => {
  if (!evt) return;
  const p = evt.payload || {};
  switch (evt.type) {
    case 'log': log(p.level || 'sys', p.msg); break;
    case 'backend':
      if (p.status === 'up') { log('savia', 'Backend BLE attivo.'); }
      else if (p.status === 'missing-deps') { log('error', 'bleak non installato: premi INSTALLA DIPENDENZE BLE.'); }
      else if (p.status === 'error') { log('error', 'Backend BLE error: ' + (p.error || '')); }
      else if (p.status === 'installing') { log('warn', 'Installazione bleak in corso...'); }
      else if (p.status === 'deps-ok') { log('savia', 'bleak pronto'); }
      else if (p.status === 'deps-fail') { log('error', 'Installazione bleak fallita'); }
      break;
    case 'device':
      if (p.state === 'near') { log('warn', `● ${p.name} VICINO (${p.method === 'ble' ? p.rssi + ' dBm' : 'rete'})`); }
      else if (p.state === 'away') { log('sys', `○ ${p.name} lontano`); }
      else if (p.state === 'unlocked') { log('savia', `📱 Sbloccato ${p.name}${p.serial ? ' (' + p.serial + ')' : ''}`); }
      else if (p.state === 'unlock-failed') { log('error', `Sblocco fallito ${p.name}: ${p.error || ''}`); }
      break;
    default: break;
  }
});

let currentStatus = null;

async function refresh() {
  currentStatus = await window.electronAPI.proximityStatus();
  renderStatus(currentStatus);
  renderNearby(currentStatus.nearby || []);
  renderKnown(currentStatus.knownDevices || []);
}

setInterval(refresh, 3000);

async function init() {
  const cfg = await window.electronAPI.configGet();
  if (cfg) {
    if (typeof cfg.proximityThreshold === 'number') { cfgThreshold.value = cfg.proximityThreshold; outThreshold.textContent = cfg.proximityThreshold; }
    if (cfg.proximityCooldownSec) cfgCooldown.value = cfg.proximityCooldownSec;
    if (cfg.proximityAdbPath) cfgAdbPath.value = cfg.proximityAdbPath;
    chkAuto.checked = !!cfg.proximityEnabled;
  }
  await refresh();
  log('sys', 'Avvio pagina proximity. Premi START per iniziare la scansione BLE.');
}

init();