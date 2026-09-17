'use strict';

// ============================================================
// REMINDER & CALENDAR SCHEDULER — fires native toasts
// ============================================================

const agentStore = require('./agent-store');
const notify = require('./notify');

let sendToAll = () => {};

function parseDueDate(dateStr, timeStr) {
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

function checkDueReminders() {
  const data = agentStore.load();
  const now = new Date();
  let changed = false;

  (data.reminders || []).forEach(r => {
    if (r.fired) return;
    if (!r.date && !r.time) return;
    const due = parseDueDate(r.date, r.time);
    if (due && due <= now) {
      r.fired = true;
      changed = true;
      notify.sendWinToast('S.A.V.I.A — Promemoria', r.text || 'Promemoria', 'critical');
      sendToAll('reminder-fired', { type: 'reminder', text: r.text });
    }
  });

  (data.calendar || []).forEach(ev => {
    if (ev.fired || !ev.date) return;
    // UI all-day events (created without a time) never auto-fire a toast.
    if (ev.source === 'ui' && !ev.time) return;
    const due = parseDueDate(ev.date, ev.time);
    if (due && due <= now) {
      ev.fired = true;
      changed = true;
      notify.sendWinToast('S.A.V.I.A — Evento', `${ev.title || 'Evento'}${ev.time ? ' alle ' + ev.time : ''}`, 'normal');
      sendToAll('reminder-fired', { type: 'calendar', text: ev.title });
    }
  });

  if (changed) agentStore.save(data);

  // Housekeeping: drop fired items older than 24h
  try {
    const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
    const prevRem = (data.reminders || []).length;
    const prevCal = (data.calendar || []).length;
    data.reminders = (data.reminders || []).filter(r => {
      if (!r.fired) return true;
      const due = parseDueDate(r.date, r.time);
      return !due || due.getTime() >= cutoff;
    });
    data.calendar = (data.calendar || []).filter(ev => {
      if (!ev.fired) return true;
      const due = parseDueDate(ev.date, ev.time);
      return !due || due.getTime() >= cutoff;
    });
    if (data.reminders.length !== prevRem || data.calendar.length !== prevCal) agentStore.save(data);
  } catch (e) { /* ignore */ }
}

function init(ctx) {
  sendToAll = (ctx && ctx.sendToAll) || sendToAll;
  setInterval(checkDueReminders, 30000);
  setTimeout(checkDueReminders, 5000);
}

module.exports = { init, parseDueDate, checkDueReminders };