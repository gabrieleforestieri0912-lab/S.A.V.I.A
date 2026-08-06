// ============================================================
// DASHBOARD HUD — System Monitor View
// ============================================================

const DASH_CIRCUMFERENCE = 2 * Math.PI * 55;

function setGauge(id, pct, label) {
  const el = document.getElementById(id);
  if (!el) return;
  const offset = DASH_CIRCUMFERENCE * (1 - Math.min(Math.max(pct, 0), 1));
  el.style.strokeDasharray = `${DASH_CIRCUMFERENCE}`;
  el.style.strokeDashoffset = `${offset}`;
}

function getGaugeColor(pct, type) {
  if (type === 'temp') {
    if (pct > 0.8) return 'var(--accent-red)';
    if (pct > 0.5) return 'var(--accent-gold)';
    return '#00ff88';
  }
  if (type === 'disk') {
    if (pct > 0.9) return 'var(--accent-red)';
    if (pct > 0.75) return 'var(--accent-gold)';
    return 'var(--accent-cyan)';
  }
  if (type === 'ram') {
    if (pct > 0.85) return 'var(--accent-red)';
    if (pct > 0.7) return 'var(--accent-gold)';
    return 'var(--accent-purple)';
  }
  return null;
}

function applyGaugeColor(el, pct, type) {
  const color = getGaugeColor(pct, type);
  if (color) el.style.stroke = color;
}

async function refreshDashboard() {
  try {
    const api = window.electronAPI || window.api;
    const ext = api ? await api.getExtendedTelemetry() : { gpu: [], temps: [], disks: [], network: [] };

    // CPU
    if (window.telemetryData && window.telemetryData.cpu != null) {
      const pct = window.telemetryData.cpu / 100;
      setGauge('dg-cpu', pct, 'CPU');
      document.getElementById('dg-cpu-val').textContent = `${window.telemetryData.cpu}%`;
    }

    // RAM
    if (window.telemetryData && window.telemetryData.memPercent != null) {
      const pct = window.telemetryData.memPercent / 100;
      setGauge('dg-ram', pct, 'RAM');
      document.getElementById('dg-ram-val').textContent = `${window.telemetryData.memGB} GB`;
      applyGaugeColor(document.getElementById('dg-ram'), pct, 'ram');
    }

    // GPU
    if (ext.gpu && ext.gpu.length > 0) {
      const gpu = ext.gpu[0];
      document.getElementById('dg-gpu-val').textContent = gpu.name.length > 12
        ? gpu.name.slice(0, 12) + '..'
        : gpu.name || 'N/A';
      const hasGpu = gpu.name !== 'N/A';
      setGauge('dg-gpu', hasGpu ? 1 : 0, 'GPU');
    }

    // Temperature
    if (ext.temps && ext.temps.length > 0) {
      const temp = ext.temps[0].value;
      const pct = Math.min(temp / 100, 1);
      document.getElementById('dg-temp-val').textContent = `${temp}°C`;
      setGauge('dg-temp', pct, 'TEMP');
      applyGaugeColor(document.getElementById('dg-temp'), pct, 'temp');
    }

    // Disk
    if (ext.disks && ext.disks.length > 0) {
      const disk = ext.disks[0];
      const pct = disk.pct / 100;
      document.getElementById('dg-disk-val').textContent = `${disk.pct}%`;
      setGauge('dg-disk', pct, 'DISK');
      applyGaugeColor(document.getElementById('dg-disk'), pct, 'disk');
    }

    // Network
    if (ext.network && ext.network.length > 0) {
      document.getElementById('dg-net-val').textContent = ext.network.length > 1
        ? `ACTIVE (${ext.network.length})`
        : 'ONLINE';
      setGauge('dg-net', 1, 'NET');
    }
  } catch (e) {
    console.warn('[DASHBOARD] refresh error:', e);
  }
}

async function refreshProcessList() {
  try {
    const api = window.electronAPI || window.api;
    const res = api ? await api.getProcessList() : { success: false, processes: [] };
    const list = document.getElementById('dash-proc-list');
    if (!res.success || !res.processes || res.processes.length === 0) {
      list.innerHTML = '<div class="dash-proc-loading">Nessun dato processi disponibile</div>';
      return;
    }
    document.getElementById('dash-proc-count').textContent = `${res.processes.length} processi`;
    list.innerHTML = res.processes.map(p => `
      <div class="dash-proc-row">
        <span title="${p.name}.exe" class="dash-proc-name">${p.name}.exe</span>
        <span class="dash-proc-pid">PID ${p.pid}</span>
        <span class="dash-proc-cpu">${p.cpu.toFixed(1)}s CPU</span>
        <span class="dash-proc-mem">${p.memMB.toFixed(1)} MB</span>
      </div>
    `).join('');
  } catch (e) {
    console.warn('[DASHBOARD] process error:', e);
  }
}

// ── Upcoming Schedule (calendar events + reminders with countdown) ──

let upcomingCache = [];
let upcomingTickTimer = null;
let lastUpcomingSig = null;
let alertedDues = new Set(); // due timestamps already alerted (fire once per item)
let upcomingAnimating = false; // completion animation in flight → pause schedule re-render
let dashAlertSound = true;
try { dashAlertSound = localStorage.getItem('savia-dash-alert') !== 'off'; } catch (e) { /* ignore */ }

function parseAgentDue(dateStr, timeStr) {
  if (!dateStr && !timeStr) return null;
  const today = new Date();
  let y, m, d, hh, mm;
  if (dateStr) {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    y = parseInt(parts[0]); m = parseInt(parts[1]) - 1; d = parseInt(parts[2]);
  } else { y = today.getFullYear(); m = today.getMonth(); d = today.getDate(); }
  if (timeStr && timeStr.includes(':')) {
    const tp = timeStr.split(':');
    hh = parseInt(tp[0]); mm = parseInt(tp[1]);
  } else { hh = 9; mm = 0; }
  const due = new Date(y, m, d, hh, mm, 0);
  return isNaN(due.getTime()) ? null : due;
}

function fmtUpcomingCountdown(ms) {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}g ${String(h).padStart(2, '0')}h`;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function fmtUpcomingDay(dateStr, due) {
  if (!due) return dateStr || '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.round((startDue - startToday) / 86400000);
  if (diffDays === 0) return 'OGGI';
  if (diffDays === 1) return 'DOMANI';
  if (diffDays === -1) return 'IERI';
  if (diffDays < 0) return 'SCADUTO';
  return due.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function escHtml(text) {
  const d = document.createElement('div');
  d.textContent = text == null ? '' : String(text);
  return d.innerHTML;
}

async function refreshUpcoming() {
  // A completion animation is in flight: let it finish before re-rendering,
  // otherwise the 3s interval could destroy the fading row mid-transition.
  if (upcomingAnimating) return;
  const list = document.getElementById('dash-upcoming-list');
  if (!list) return;
  const api = window.electronAPI || window.api;
  if (!api || !api.agentTool) {
    list.innerHTML = '<div class="dash-upcoming-empty">IPC SCHEDULE NON DISPONIBILE</div>';
    return;
  }
  try {
    const [calRes, remRes, todoRes] = await Promise.all([
      api.agentTool({ tool: 'calendar', args: 'list' }),
      api.agentTool({ tool: 'reminder', args: 'list' }),
      api.agentTool({ tool: 'todo', args: 'list' })
    ]);
    const now = Date.now();
    const items = [];

    (calRes.success && calRes.events ? calRes.events : []).forEach(ev => {
      if (ev.fired) return;
      if (ev.source === 'ui' && !ev.time) {
        // All-day UI event: show date label, no countdown (never auto-fires)
        items.push({ kind: 'event', id: ev.id, title: ev.title || 'Evento', date: ev.date, allDay: true, due: null });
        return;
      }
      const due = parseAgentDue(ev.date, ev.time);
      if (!due || due.getTime() < now - 60000) return;
      items.push({ kind: 'event', id: ev.id, title: ev.title || 'Evento', date: ev.date, allDay: false, due });
    });

    (remRes.success && remRes.reminders ? remRes.reminders : []).forEach(r => {
      if (r.fired) return;
      const due = parseAgentDue(r.date, r.time);
      if (!due || due.getTime() < now - 60000) return;
      items.push({ kind: 'reminder', id: r.id, title: r.text || 'Promemoria', date: r.date, allDay: false, due });
    });

    // Active AI-created todos (not yet done). Unlike events/reminders the
    // scheduler never marks todos `fired`, so we keep past-due ones visible
    // as SCADUTO instead of applying the 60s grace filter.
    (todoRes.success && todoRes.todos ? todoRes.todos : []).forEach(t => {
      if (t.done) return;
      const due = parseAgentDue(t.due || '', '');
      if (!due) {
        // No due date: ongoing item, no countdown
        items.push({ kind: 'todo', id: t.id, title: t.title || 'Task', date: '', allDay: true, due: null, label: 'TODO' });
        return;
      }
      items.push({ kind: 'todo', id: t.id, title: t.title || 'Task', date: t.due || '', allDay: false, due });
    });

    // Active objectives from the Objectives Hub (localStorage savia-goals)
    try {
      const rawGoals = localStorage.getItem('savia-goals');
      const goals = rawGoals ? JSON.parse(rawGoals) : null;
      if (goals) {
        let goalCount = 0;
        const pushActive = (list, goalType) => {
          (list || []).filter(g => !g.done).forEach(g => {
            if (goalCount >= 4) return;
            goalCount++;
            items.push({ kind: 'goal', id: g.id, goalType, title: g.text || 'Obiettivo', date: '', allDay: true, due: null, label: 'OBIETTIVO' });
          });
        };
        pushActive(goals.shortTerm, 'shortTerm');
        pushActive(goals.longTerm, 'longTerm');
      }
    } catch (e) { /* localStorage non disponibile */ }

    items.sort((a, b) => {
      const ta = a.allDay ? Infinity : a.due.getTime();
      const tb = b.allDay ? Infinity : b.due.getTime();
      return ta - tb;
    });
    const totalItems = items.length;
    upcomingCache = items.slice(0, 10);

    const countEl = document.getElementById('dash-upcoming-count');
    if (countEl) {
      countEl.textContent = upcomingCache.length < totalItems
        ? `${upcomingCache.length} di ${totalItems} in programma`
        : `${totalItems} in programma`;
    }
    // Only re-render when the item set actually changed (ids + due times),
    // so the 3s dashboard refresh doesn't churn the DOM; the 1s ticker
    // keeps countdowns live without touching the markup.
    const sig = JSON.stringify(upcomingCache.map(i => ({
      kind: i.kind, id: String(i.id || ''), title: i.title, date: i.date,
      allDay: i.allDay, due: i.due ? i.due.getTime() : 0, label: i.label || ''
    })));
    if (sig !== lastUpcomingSig) {
      lastUpcomingSig = sig;
      renderUpcoming(list);
    }
    // Prune alert-tracked dues that left the list (fired/expired) so the
    // Set never grows unbounded.
    const liveDues = new Set(upcomingCache.filter(i => i.due).map(i => i.due.getTime()));
    for (const d of alertedDues) {
      if (!liveDues.has(d)) alertedDues.delete(d);
    }
    updateOverdueBadge();
  } catch (e) {
    list.innerHTML = '<div class="dash-upcoming-empty">ERRORE SCHEDULE</div>';
  }
}

// ── Due alert: acoustic chime + pulsing visual badge ────────────
// Fires ONCE per item when its countdown crosses zero (transition), in
// addition to the native toast the main-process scheduler sends.

function playDueAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    master.connect(ctx.destination);
    // Two rapid warning beeps (JARVIS alert chime)
    [[880, 0], [660, 0.22]].forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const t = now + offset;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    setTimeout(() => { if (ctx.close) ctx.close(); }, 800);
  } catch (e) { /* audio non disponibile */ }
}

function triggerDueAlert(title) {
  if (dashAlertSound) playDueAlert();
  // Log to the system ticker; the native notification is handled by the
  // main-process scheduler, so we avoid duplicating it here.
  if (typeof addTickerEvent === 'function') {
    addTickerEvent('sys', `SCADUTO: ${title}`);
  }
}

// Soft ascending confirmation tone played when a todo/objective is completed.
function playSuccessBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // Two ascending sine notes = pleasant confirmation
    [[523.25, 0], [783.99, 0.14]].forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const t = now + offset;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    setTimeout(() => { if (ctx.close) ctx.close(); }, 500);
  } catch (e) { /* audio non disponibile */ }
}

function updateOverdueBadge(overdueCount) {
  const panel = document.querySelector('.dash-upcoming-panel');
  const countEl = document.getElementById('dash-upcoming-count');
  const n = overdueCount != null
    ? overdueCount
    : document.querySelectorAll('#dash-upcoming-list .dash-up-cd.overdue').length;
  // Alert visuals (panel pulse + blinking counter) are gated by the toggle;
  // the SCADUTO rows and the count text remain informative either way.
  const alerting = dashAlertSound && n > 0;
  if (panel) panel.classList.toggle('has-overdue', alerting);
  if (countEl) {
    if (n > 0) {
      countEl.textContent = `\u26A0 ${n} SCADUT${n === 1 ? 'O' : 'I'}`;
    }
    countEl.classList.toggle('overdue', alerting);
  }
}

function initAlertToggle() {
  const btn = document.getElementById('dash-alert-toggle');
  if (!btn) return;
  const icon = btn.querySelector('i');
  const apply = () => {
    btn.classList.toggle('active', dashAlertSound);
    if (icon) icon.className = dashAlertSound ? 'fas fa-volume-up' : 'fas fa-volume-mute';
    btn.title = dashAlertSound ? 'Alert acustico attivo — click per disattivare' : 'Alert acustico disattivato — click per attivare';
  };
  btn.addEventListener('click', () => {
    dashAlertSound = !dashAlertSound;
    try { localStorage.setItem('savia-dash-alert', dashAlertSound ? 'on' : 'off'); } catch (e) { /* ignore */ }
    apply();
    if (typeof addTickerEvent === 'function') {
      addTickerEvent('sys', `Alert scadenza ${dashAlertSound ? 'attivato' : 'disattivato'}`);
    }
    updateOverdueBadge();
  });
  apply();
}

function renderUpcoming(list) {
  if (upcomingCache.length === 0) {
    list.innerHTML = '<div class="dash-upcoming-empty">NESSUN IMPEGNO IN PROGRAMMA</div>';
    return;
  }
  list.innerHTML = upcomingCache.map(item => {
    const icons = { event: 'fa-calendar-alt', reminder: 'fa-bell', todo: 'fa-check-square', goal: 'fa-bullseye' };
    const icon = icons[item.kind] || 'fa-calendar-alt';
    const dayLabel = item.allDay ? (item.label || 'ALL DAY') : fmtUpcomingDay(item.date, item.due);
    const timeStr = (!item.allDay && item.due)
      ? item.due.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : '';
    const isDue = !item.allDay && item.due.getTime() <= Date.now();
    const cdHtml = item.allDay
      ? '<span class="dash-up-cd">--:--</span>'
      : `<span class="dash-up-cd${isDue ? ' overdue' : ''}" data-due="${item.due.getTime()}">${isDue ? 'SCADUTO' : 'T-' + fmtUpcomingCountdown(item.due.getTime() - Date.now())}</span>`;
    const target = (item.kind === 'event' || item.kind === 'reminder') ? 'calendar.html' : 'objectives.html';
    const itemId = String(item.id != null ? item.id : '');
    // Checkbox to complete todos/objectives inline (never for events/reminders)
    const checkBtn = (item.kind === 'todo' || item.kind === 'goal') && itemId
      ? `<button class="dash-up-check" data-kind="${item.kind}" data-id="${escHtml(itemId)}" title="Completa" onclick="event.stopPropagation(); completeUpcomingItem('${item.kind}','${escHtml(itemId)}')"><i class="fas fa-check"></i></button>`
      : '';
    const delBtn = itemId
      ? `<button class="dash-up-del" data-kind="${item.kind}" data-id="${escHtml(itemId)}" title="Elimina" onclick="event.stopPropagation(); deleteUpcomingItem('${item.kind}','${escHtml(itemId)}')"><i class="fas fa-trash-alt"></i></button>`
      : '';
    return `
      <div class="dash-up-row type-${item.kind}" data-kind="${item.kind}" data-id="${escHtml(itemId)}" title="${escHtml(item.title)} — ${dayLabel}${timeStr ? ' ' + timeStr : ''}" onclick="window.location.href='${target}'">
        <span class="dash-up-icon"><i class="fas ${icon}"></i></span>
        <span class="dash-up-title">${escHtml(item.title)}</span>
        <span class="dash-up-when">${dayLabel}${timeStr ? ' ' + timeStr : ''}</span>
        ${cdHtml}
        ${checkBtn}
        ${delBtn}
      </div>`;
  }).join('');
}

// ── Row animations: check-and-fade (complete) / red fade (remove) ──
// Shared helper: pauses the 3s schedule refresh while the row animates out,
// so the transition is never cut short, then refreshes to drop the item.

function animateUpcomingRow(kind, id, className, timeoutMs, markChecked) {
  const row = document.querySelector(`.dash-up-row[data-kind="${kind}"][data-id="${escHtml(String(id))}"]`);
  if (!row) {
    // Row already gone (concurrent refresh): fall back to immediate refresh
    refreshUpcoming();
    return;
  }
  if (markChecked) {
    const check = row.querySelector('.dash-up-check');
    if (check) check.classList.add('checked');
  }
  row.classList.add(className);
  upcomingAnimating = true;
  setTimeout(() => {
    upcomingAnimating = false;
    refreshUpcoming();
  }, timeoutMs);
}

function animateUpcomingComplete(kind, id) {
  animateUpcomingRow(kind, id, 'completing', 750, true);
}

function animateUpcomingRemove(kind, id) {
  animateUpcomingRow(kind, id, 'removing', 600, false);
}

async function completeUpcomingItem(kind, id) {
  if (!id) return;
  const api = window.electronAPI || window.api;
  const item = upcomingCache.find(i => i.kind === kind && String(i.id) === String(id));
  try {
    if (kind === 'todo') {
      if (api && api.agentTool) {
        const res = await api.agentTool({ tool: 'todo', args: `done|${id}` });
        if (!res || !res.success) {
          if (typeof addTickerEvent === 'function') {
            addTickerEvent('warn', `Completamento fallito: ${(res && res.message) || 'errore'}`);
          }
          return;
        }
        // Celebrate if this was the last remaining todo
        try {
          const listRes = await api.agentTool({ tool: 'todo', args: 'list' });
          if (listRes && listRes.success && Array.isArray(listRes.todos) && listRes.todos.length > 0) {
            const done = listRes.todos.filter(t => t.done).length;
            const remaining = listRes.todos.length - done;
            if (remaining === 0 && typeof sendNotification === 'function') {
              sendNotification(`OBIETTIVO COMPLETATO — ${done}/${listRes.todos.length} task completati`, 'success', 6000);
            }
          }
        } catch (e) { /* ignore */ }
      }
    } else if (kind === 'goal') {
      // Goals live only in localStorage savia-goals (objectives hub)
      try {
        const raw = localStorage.getItem('savia-goals');
        if (raw) {
          const goals = JSON.parse(raw);
          const list = (item && item.goalType === 'longTerm') ? goals.longTerm : goals.shortTerm;
          const goal = (list || []).find(g => String(g.id) === String(id));
          if (goal) {
            goal.done = true;
            localStorage.setItem('savia-goals', JSON.stringify(goals));
            // Celebrate if this was the last remaining objective
            const all = [...(goals.shortTerm || []), ...(goals.longTerm || [])];
            const done = all.filter(g => g.done).length;
            const remaining = all.length - done;
            if (all.length > 0 && remaining === 0 && typeof sendNotification === 'function') {
              sendNotification(`OBIETTIVO COMPLETATO — ${done}/${all.length} obiettivi completati`, 'success', 6000);
            }
          }
        }
      } catch (e) { /* ignore */ }
    }
    if (typeof addTickerEvent === 'function') {
      addTickerEvent('sys', `Completato ${kind}: ${item ? item.title : id}`);
    }
    // Confirmation beep (respects the alert-sound toggle), then play the
    // check-and-fade animation before removing the item from the panel
    if (dashAlertSound) playSuccessBeep();
    animateUpcomingComplete(kind, id);
  } catch (e) {
    if (typeof addTickerEvent === 'function') {
      addTickerEvent('warn', `Completamento fallito: ${e.message}`);
    }
  }
}

async function deleteUpcomingItem(kind, id) {
  if (!id) return;
  const api = window.electronAPI || window.api;
  const item = upcomingCache.find(i => i.kind === kind && String(i.id) === String(id));
  try {
    if (kind === 'event') {
      if (api && api.agentTool) {
        await api.agentTool({ tool: 'calendar', args: `delete|${id}` });
      }
      // Keep the calendar UI local copy in sync so a later re-sync
      // (calendar.html → calendar-sync) can't resurrect the event.
      try {
        const raw = localStorage.getItem('calendar-events');
        if (raw) {
          const events = JSON.parse(raw);
          const filtered = events.filter(e => String(e.id) !== String(id));
          if (filtered.length !== events.length) {
            localStorage.setItem('calendar-events', JSON.stringify(filtered));
          }
        }
      } catch (e) { /* ignore */ }
    } else if (kind === 'reminder') {
      if (api && api.agentTool) await api.agentTool({ tool: 'reminder', args: `delete|${id}` });
    } else if (kind === 'todo') {
      if (api && api.agentTool) await api.agentTool({ tool: 'todo', args: `delete|${id}` });
    } else if (kind === 'goal') {
      // Goals live only in localStorage savia-goals (objectives hub)
      try {
        const raw = localStorage.getItem('savia-goals');
        if (raw) {
          const goals = JSON.parse(raw);
          goals.shortTerm = (goals.shortTerm || []).filter(g => String(g.id) !== String(id));
          goals.longTerm = (goals.longTerm || []).filter(g => String(g.id) !== String(id));
          localStorage.setItem('savia-goals', JSON.stringify(goals));
        }
      } catch (e) { /* ignore */ }
    }
    if (typeof addTickerEvent === 'function') {
      addTickerEvent('sys', `Rimosso ${kind}: ${item ? item.title : id}`);
    }
    // Play a brief red fade-out, then remove the item from the panel
    animateUpcomingRemove(kind, id);
  } catch (e) {
    if (typeof addTickerEvent === 'function') {
      addTickerEvent('warn', `Eliminazione fallita: ${e.message}`);
    }
  }
}

function tickUpcomingCountdown() {
  if (upcomingCache.length === 0) return;
  const now = Date.now();
  let overdueCount = 0;
  document.querySelectorAll('#dash-upcoming-list .dash-up-cd[data-due]').forEach(el => {
    const due = parseInt(el.getAttribute('data-due'), 10);
    if (!due) return;
    const diff = due - now;
    if (diff <= 0) {
      overdueCount++;
      if (!alertedDues.has(due)) {
        alertedDues.add(due);
        const row = el.closest('.dash-up-row');
        const title = row ? row.querySelector('.dash-up-title').textContent : 'Evento';
        triggerDueAlert(title || 'Evento');
      }
      el.textContent = 'SCADUTO';
      el.classList.add('overdue');
      el.classList.remove('due-soon');
    } else {
      el.textContent = 'T-' + fmtUpcomingCountdown(diff);
      el.classList.remove('overdue');
      el.classList.toggle('due-soon', diff < 3600000);
    }
  });
  updateOverdueBadge(overdueCount);
}

function startUpcomingTicker() {
  if (upcomingTickTimer) return;
  upcomingTickTimer = setInterval(tickUpcomingCountdown, 1000);
}

function stopUpcomingTicker() {
  if (upcomingTickTimer) {
    clearInterval(upcomingTickTimer);
    upcomingTickTimer = null;
  }
}

let dashInterval = null;

function startDashboard() {
  refreshDashboard();
  refreshProcessList();
  refreshUpcoming();
  startUpcomingTicker();
  if (dashInterval) clearInterval(dashInterval);
  dashInterval = setInterval(() => {
    refreshDashboard();
    refreshProcessList();
    refreshUpcoming();
  }, 3000);
}

function stopDashboard() {
  if (dashInterval) {
    clearInterval(dashInterval);
    dashInterval = null;
  }
  stopUpcomingTicker();
}

document.addEventListener('DOMContentLoaded', () => {
  const navDash = document.getElementById('nav-dashboard');
  const viewDash = document.getElementById('view-dashboard');
  const viewTerm = document.getElementById('view-terminal');

  if (navDash && viewDash && viewTerm) {
    const navItems = document.querySelectorAll('.nav-rail-item');
    navItems.forEach(item => {
      item.addEventListener('click', function (e) {
        navItems.forEach(n => n.classList.remove('active'));
        const dot = this.querySelector('.item-status');
        if (dot) dot.className = 'item-status online';

        if (this.id === 'nav-dashboard') {
          viewTerm.classList.add('hidden');
          viewDash.classList.remove('hidden');
          startDashboard();
        }
      });
    });

    // Return to terminal by clicking other nav items
    document.querySelector('#left-sidebar .nav-rail-item:not(#nav-dashboard)').addEventListener('click', () => {
      if (!viewDash.classList.contains('hidden')) {
        viewDash.classList.add('hidden');
        viewTerm.classList.remove('hidden');
        stopDashboard();
      }
    });
  }

  initAlertToggle();

  // Notification test button
  const btn = document.getElementById('btn-test-notif');
  if (btn) {
    btn.addEventListener('click', () => {
      const types = ['info', 'success', 'warn', 'error'];
      const labels = ['INFORMAZIONE', 'OPERAZIONE COMPLETATA', 'ATTENZIONE', 'ERRORE'];
      const icons = ['\u2139', '\u2713', '\u26A0', '\u2716'];
      const i = Math.floor(Math.random() * types.length);
      sendNotification(`[TEST] Notifica ${labels[i]} dal sistema S.A.V.I.A`, types[i], 5000);
      sendNotification('Usa sendNotification() nel codice per notifiche rapide', 'info', 3000);
    });
  }
});
