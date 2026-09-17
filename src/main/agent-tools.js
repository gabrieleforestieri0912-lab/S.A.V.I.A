'use strict';

// ============================================================
// AGENT TOOLS — calendar / todo / reminder (local JSON store)
// + Calendar UI → scheduler sync (calendar-sync)
// ============================================================

const { ipcMain } = require('electron');
const agentStore = require('./agent-store');
const { parseDueDate } = require('./reminders');

const store = {
  calendar: { list: d => ({ success: true, events: d.calendar }) },
  todo: { list: d => ({ success: true, todos: d.todos }) },
  reminder: { list: d => ({ success: true, reminders: d.reminders }) }
};

let chronoTools = null;
try { chronoTools = require('chrono-node'); } catch (_) {}

function normalizeDueInput(dateStr, timeStr) {
  // Se dateStr contiene espressione naturale, prova a normalizzarla in YYYY-MM-DD + HH:MM
  const raw = [dateStr, timeStr].filter(Boolean).join(' ');
  if (chronoTools && raw && /[a-zA-Zà-ù]|tra |domani|dopodomani|oggi/i.test(raw)) {
    try {
      const d = chronoTools.it ? chronoTools.it.parseDate(raw, new Date(), { forwardDate: true }) : chronoTools.parseDate(raw, new Date(), { forwardDate: true });
      if (d && !isNaN(d.getTime())) {
        const yyyy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
        const hh = String(d.getHours()).padStart(2,'0'), mi = String(d.getMinutes()).padStart(2,'0');
        return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
      }
    } catch (_) {}
  }
  return { date: dateStr, time: timeStr };
}

function init() {
  ipcMain.handle('agent-tool', (event, { tool, args }) => {
    const data = agentStore.load();
    const parts = args.split('|').map(s => s.trim());

    switch (tool) {
      case 'calendar': {
        const action = parts[0]?.toLowerCase();
        if (action === 'list') return store.calendar.list(data);
        if (action === 'add' && parts.length >= 3) {
          const norm = normalizeDueInput(parts[2], parts[3] || '');
          data.calendar.push({
            id: Date.now(),
            title: parts[1],
            date: norm.date,
            time: norm.time || '',
            duration: parts[4] || '60min',
            desc: parts[5] || ''
          });
          agentStore.save(data);
          return { success: true, message: `Evento aggiunto per ${norm.date} ${norm.time}`.trim() };
        }
        if (action === 'delete' && parts[1]) {
          // UI event ids are base36 strings, AI ids numeric.
          data.calendar = data.calendar.filter(e => String(e.id) !== parts[1]);
          agentStore.save(data);
          return { success: true, message: 'Evento rimosso' };
        }
        return { success: false, message: 'Azione calendar non valida' };
      }

      case 'todo': {
        const action = parts[0]?.toLowerCase();
        if (action === 'list') return store.todo.list(data);
        if (action === 'add' && parts.length >= 2) {
          let dueRaw = parts[3] || '';
          if (dueRaw && chronoTools && /[a-zA-Zà-ù]|tra |domani|dopodomani/i.test(dueRaw)) {
            try {
              const d = chronoTools.it ? chronoTools.it.parseDate(dueRaw, new Date(), { forwardDate: true }) : chronoTools.parseDate(dueRaw, new Date(), { forwardDate: true });
              if (d) dueRaw = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            } catch (_) {}
          }
          data.todos.push({
            id: Date.now(),
            title: parts[1],
            priority: parts[2] || 'media',
            due: dueRaw || '',
            done: false,
            created: new Date().toISOString()
          });
          agentStore.save(data);
          return { success: true, message: 'Task aggiunto' };
        }
        if (action === 'done' && parts[1]) {
          const todo = data.todos.find(t => String(t.id) === parts[1]);
          if (todo) { todo.done = true; agentStore.save(data); return { success: true, message: 'Task completato' }; }
          return { success: false, message: 'Task non trovato' };
        }
        if (action === 'delete' && parts[1]) {
          const before = data.todos.length;
          data.todos = data.todos.filter(t => String(t.id) !== parts[1]);
          if (data.todos.length !== before) agentStore.save(data);
          return { success: true, message: 'Task rimosso' };
        }
        return { success: false, message: 'Azione todo non valida' };
      }

      case 'reminder': {
        const rAction = parts[0]?.toLowerCase();
        if (rAction === 'list') return store.reminder.list(data);
        if (rAction === 'delete' && parts[1]) {
          data.reminders = data.reminders.filter(r => String(r.id) !== parts[1]);
          agentStore.save(data);
          return { success: true, message: 'Promemoria rimosso' };
        }
        if (parts.length >= 2) {
          // supporta sia "set|testo|data|ora" che "testo|data|ora" o naturale "domani alle 15"
          let text = parts[1], date = parts[2] || '', time = parts[3] || '';
          // se primo part è "set", shift
          const first = parts[0]?.toLowerCase();
          if (first === 'set' && parts.length >= 2) { text = parts[1]; date = parts[2] || ''; time = parts[3] || ''; }
          else if (first !== 'set' && first !== 'list' && first !== 'delete' && parts.length === 2) { text = parts[0]; date = parts[1]; time = ''; }
          const norm = normalizeDueInput(date, time);
          // se testo contiene data naturale e date vuoto, prova a parsare dal testo
          let finalDate = norm.date, finalTime = norm.time;
          if (!finalDate && !finalTime && chronoTools && text) {
            try {
              const d = chronoTools.it ? chronoTools.it.parseDate(text, new Date(), { forwardDate: true }) : chronoTools.parseDate(text, new Date(), { forwardDate: true });
              if (d) { finalDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; finalTime = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
            } catch (_) {}
          }
          data.reminders.push({
            id: Date.now(),
            text,
            date: finalDate || '',
            time: finalTime || '',
            created: new Date().toISOString()
          });
          agentStore.save(data);
          return { success: true, message: `Promemoria impostato per ${finalDate || 'oggi'} ${finalTime}`.trim() };
        }
        return { success: false, message: 'Formato reminder: set|testo|data|ora' };
      }

      default:
        return { success: false, message: `Tool sconosciuto: ${tool}` };
    }
  });

  ipcMain.handle('calendar-sync', (event, events) => {
    try {
      const data = agentStore.load();
      const existing = new Map((data.calendar || []).map(e => [String(e.id), e]));
      const now = new Date();
      const incoming = (Array.isArray(events) ? events : []).map(e => {
        const prev = existing.get(String(e.id));
        const due = parseDueDate(e.date, e.time);
        return {
          id: e.id,
          title: e.title || 'Evento',
          date: e.date || '',
          time: e.time || '',
          duration: e.duration || '60min',
          desc: e.desc || '',
          // Only genuinely new UI events get tagged 'ui'; AI-sourced events keep
          // their original source so the all-day skip guard doesn't affect them.
          source: prev ? prev.source : 'ui',
          // Overdue events are marked fired so they never toast a stale notification.
          fired: due && due <= now ? true : (prev ? !!prev.fired : false)
        };
      });
      // Keep AI-created events (no matching UI id) + replace/merge UI ones
      const incomingIds = new Set(incoming.map(e => String(e.id)));
      const kept = (data.calendar || []).filter(e => !incomingIds.has(String(e.id)));
      data.calendar = [...kept, ...incoming];
      agentStore.save(data);
      return { success: true, count: data.calendar.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { init };