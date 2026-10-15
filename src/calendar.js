/**
 * S.A.V.I.A - Calendar (Month View, eventi locali)
 */

let calDate = new Date();
let calEvents = [];
try {
  const stored = localStorage.getItem('calendar-events');
  if (stored) calEvents = JSON.parse(stored) || [];
} catch (e) { calEvents = []; }

// DOM refs
const grid = document.getElementById('cal-grid');
const monthLabel = document.getElementById('cal-month-label');
const prevBtn = document.getElementById('cal-prev');
const nextBtn = document.getElementById('cal-next');
const todayBtn = document.getElementById('cal-today');
const eventPanel = document.getElementById('cal-event-panel');
const eventDateLabel = document.getElementById('cal-event-date-label');
const eventList = document.getElementById('cal-event-list');
const eventInput = document.getElementById('cal-event-input');
const eventTime = document.getElementById('cal-event-time');
const eventAdd = document.getElementById('cal-event-add');
const eventClose = document.getElementById('cal-event-close');
const calStatCount = document.getElementById('cal-stat-count');
const calStatMonth = document.getElementById('cal-stat-month');

let selectedDay = null;

// ── Calendar Logic ──

function getMonthEvents(month, year) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59);
  return calEvents.filter(e => {
    const d = new Date(e.date);
    return d >= start && d <= end;
  });
}

function renderCalendar() {
  const year = calDate.getFullYear();
  const month = calDate.getMonth();

  monthLabel.textContent = new Date(year, month).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }).toUpperCase();
  if (calStatMonth) calStatMonth.textContent = new Date(year, month).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  const monthEvents = getMonthEvents(month, year);
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  grid.innerHTML = '';

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayEvents = monthEvents.filter(e => e.date === dateStr);
    const isToday = dateStr === todayStr;

    const el = document.createElement('div');
    el.className = `cal-day${isToday ? ' today' : ''}${dayEvents.length > 0 ? ' has-events' : ''}`;
    el.innerHTML = `
      <span class="cal-day-num">${d}</span>
      ${dayEvents.length > 0 ? `<span class="cal-day-dot"></span>` : ''}
    `;
    el.addEventListener('click', () => showDayEvents(dateStr));
    grid.appendChild(el);
  }

  if (calStatCount) {
    const allMonthEvents = monthEvents.length;
    calStatCount.textContent = `${allMonthEvents} eventi`;
  }
}

function showDayEvents(dateStr) {
  selectedDay = dateStr;
  const d = new Date(dateStr + 'T12:00:00');
  eventDateLabel.textContent = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  eventPanel?.classList.remove('hidden');
  renderDayEvents(dateStr);
}

function renderDayEvents(dateStr) {
  if (!eventList) return;
  const dayEvents = calEvents.filter(e => e.date === dateStr);
  eventList.innerHTML = '';

  if (dayEvents.length === 0) {
    eventList.innerHTML = '<div class="cal-event-empty">Nessun evento per questo giorno.</div>';
    return;
  }

  dayEvents.forEach(e => {
    const el = document.createElement('div');
    el.className = 'cal-event-item';
    el.innerHTML = `
      <span class="cal-event-time">${e.time || '--:--'}</span>
      <span class="cal-event-title">${escHtml(e.title)}</span>
      <button class="cal-event-del" data-id="${escHtml(String(e.id))}" title="Elimina evento"><i class="fas fa-trash-alt"></i></button>
    `;
    eventList.appendChild(el);
  });

  eventList.querySelectorAll('.cal-event-del').forEach(btn => {
    btn.addEventListener('click', () => deleteCalendarEvent(btn.getAttribute('data-id')));
  });
}

async function addCalendarEvent() {
  const text = eventInput?.value?.trim();
  if (!text || !selectedDay) return;

  const event = {
    id: Date.now().toString(36),
    title: text,
    date: selectedDay,
    time: eventTime?.value || ''
  };

  calEvents.push(event);
  persistCalEvents();
  syncCalendarToMain();
  renderCalendar();
  renderDayEvents(selectedDay);
  eventInput.value = '';
  if (eventTime) eventTime.value = '';
}

function deleteCalendarEvent(id) {
  if (!id || !selectedDay) return;
  calEvents = calEvents.filter(e => String(e.id) !== id);
  persistCalEvents();
  syncCalendarToMain();
  renderCalendar();
  renderDayEvents(selectedDay);
  addCalLog('Evento eliminato.');
}

function addCalLog(msg) {
  if (typeof addTickerEvent === 'function') addTickerEvent('sys', `[CAL] ${msg}`);
}

// ── Persistence + Main-process sync (so scheduler fires toasts) ──

function persistCalEvents() {
  try { localStorage.setItem('calendar-events', JSON.stringify(calEvents)); } catch (e) { /* ignore */ }
}

function syncCalendarToMain() {
  if (window.electronAPI && window.electronAPI.calendarSync) {
    window.electronAPI.calendarSync(calEvents).catch(() => {});
  }
}

async function loadAgentCalendarEvents() {
  if (!window.electronAPI || !window.electronAPI.agentTool) return;
  try {
    const res = await window.electronAPI.agentTool({ tool: 'calendar', args: 'list' });
    if (res && res.success && Array.isArray(res.events)) {
      const localIds = new Set(calEvents.map(e => String(e.id)));
      let added = 0;
      res.events.forEach(ev => {
        if (!localIds.has(String(ev.id))) {
          calEvents.push({ id: ev.id, title: ev.title || 'Evento', date: ev.date || '', time: ev.time || '' });
          localIds.add(String(ev.id));
          added++;
        }
      });
      if (added) {
        persistCalEvents();
        renderCalendar();
        if (selectedDay) renderDayEvents(selectedDay);
      }
    }
  } catch (e) { /* ignore */ }
}

function escHtml(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}

// ── Navigation ──

function prevMonth() { calDate.setMonth(calDate.getMonth() - 1); renderCalendar(); }
function nextMonth() { calDate.setMonth(calDate.getMonth() + 1); renderCalendar(); }
function goToday() { calDate = new Date(); renderCalendar(); }

// ── Event Listeners ──

if (prevBtn) prevBtn.addEventListener('click', prevMonth);
if (nextBtn) nextBtn.addEventListener('click', nextMonth);
if (todayBtn) todayBtn.addEventListener('click', goToday);
if (eventClose) eventClose.addEventListener('click', () => eventPanel?.classList.add('hidden'));
if (eventAdd) eventAdd.addEventListener('click', addCalendarEvent);
if (eventInput) eventInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); eventAdd?.click(); } });

function openEditor() {
  if (window.electronAPI?.openEditor) {
    window.electronAPI.openEditor();
  }
}

// ── Init ──

document.addEventListener('DOMContentLoaded', () => {
  renderCalendar();
  syncCalendarToMain();
  loadAgentCalendarEvents();
});
