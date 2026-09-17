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

function init() {
  ipcMain.handle('agent-tool', (event, { tool, args }) => {
    const data = agentStore.load();
    const parts = args.split('|').map(s => s.trim());

    switch (tool) {
      case 'calendar': {
        const action = parts[0]?.toLowerCase();
        if (action === 'list') return store.calendar.list(data);
        if (action === 'add' && parts.length >= 3) {
          data.calendar.push({
            id: Date.now(),
            title: parts[1],
            date: parts[2],
            time: parts[3] || '',
            duration: parts[4] || '60min',
            desc: parts[5] || ''
          });
          agentStore.save(data);
          return { success: true, message: 'Evento aggiunto' };
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
          data.todos.push({
            id: Date.now(),
            title: parts[1],
            priority: parts[2] || 'media',
            due: parts[3] || '',
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
          data.reminders.push({
            id: Date.now(),
            text: parts[1],
            date: parts[2] || '',
            time: parts[3] || '',
            created: new Date().toISOString()
          });
          agentStore.save(data);
          return { success: true, message: 'Promemoria impostato' };
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