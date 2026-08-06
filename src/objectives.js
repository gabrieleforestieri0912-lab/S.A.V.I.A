/**
 * S.A.V.I.A - Objectives Hub (Goals, Daily Summary, Notion Sync)
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

let notionKey = localStorage.getItem('notion-api-key') || '';
let notionDbGoals = localStorage.getItem('notion-db-goals') || '';
let notionDbDaily = localStorage.getItem('notion-db-daily') || '';

let goalsData = loadLocalGoals();
let dailyData = loadLocalDaily();

// DOM refs
const shortTermList = document.getElementById('obj-short-term-list');
const longTermList = document.getElementById('obj-long-term-list');
const shortInput = document.getElementById('obj-short-input');
const longInput = document.getElementById('obj-long-input');
const shortAdd = document.getElementById('obj-short-add');
const longAdd = document.getElementById('obj-long-add');
const dailyText = document.getElementById('obj-daily-text');
const dailyInput = document.getElementById('obj-daily-input');
const dailySave = document.getElementById('obj-daily-save');
const dailyDate = document.getElementById('obj-daily-date');
const statGoals = document.getElementById('obj-stat-goals');
const statDone = document.getElementById('obj-stat-done');
const notionStatusText = document.getElementById('notion-status-text');
const notionStatusDot = document.getElementById('notion-status-dot');
const notionKeyInput = document.getElementById('obj-notion-key');
const notionDbGoalsInput = document.getElementById('obj-notion-db-goals');
const notionDbDailyInput = document.getElementById('obj-notion-db-daily');
const notionVerifyBtn = document.getElementById('obj-notion-verify');
const notionSaveConfig = document.getElementById('obj-notion-save-config');
const notionLog = document.getElementById('obj-notion-log');
const configToggle = document.getElementById('obj-config-toggle');
const configBody = document.getElementById('obj-config-body');

// ── Local Storage Persistence ─────────────────────────────────

function loadLocalGoals() {
  try {
    const raw = localStorage.getItem('savia-goals');
    return raw ? JSON.parse(raw) : { shortTerm: [], longTerm: [] };
  } catch { return { shortTerm: [], longTerm: [] }; }
}

function saveLocalGoals() {
  localStorage.setItem('savia-goals', JSON.stringify(goalsData));
}

function loadLocalDaily() {
  try {
    const raw = localStorage.getItem('savia-daily');
    return raw ? JSON.parse(raw) : { summaries: [] };
  } catch { return { summaries: [] }; }
}

function saveLocalDaily() {
  localStorage.setItem('savia-daily', JSON.stringify(dailyData));
}

// ── Notion API ────────────────────────────────────────────────

async function notionRequest(endpoint, options = {}) {
  if (!notionKey) throw new Error('Notion API key non configurata');
  const res = await fetch(`${NOTION_API}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Notion API: ${res.status}`);
  }
  return res.json();
}

async function notionVerifyConnection() {
  if (!notionKey) { setNotionStatus('offline', 'API key mancante'); return false; }
  setNotionStatus('checking', 'Verifica...');
  try {
    const data = await notionRequest('/users/me');
    setNotionStatus('online', `Connesso come ${data.name || data.id}`);
    return true;
  } catch (e) {
    setNotionStatus('offline', `Errore: ${e.message}`);
    return false;
  }
}

async function notionQueryDatabase(databaseId, filter) {
  const body = { page_size: 50 };
  if (filter) body.filter = filter;
  return notionRequest(`/databases/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

async function notionCreatePage(databaseId, properties) {
  return notionRequest('/pages', {
    method: 'POST',
    body: JSON.stringify({ parent: { database_id: databaseId }, properties })
  });
}

async function notionUpdatePage(pageId, properties) {
  return notionRequest(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties })
  });
}

function notionGoalToProperties(goal, type) {
  return {
    Name: { title: [{ text: { content: goal.text } }] },
    Status: { select: goal.done ? { name: 'Done' } : { name: 'In Progress' } },
    Type: { select: { name: type } },
    Created: { date: { start: goal.created || new Date().toISOString().split('T')[0] } }
  };
}

function notionPropertiesToGoal(properties, id) {
  return {
    id,
    text: properties.Name?.title?.[0]?.text?.content || '',
    done: properties.Status?.select?.name === 'Done',
    type: properties.Type?.select?.name || 'shortTerm',
    created: properties.Created?.date?.start || ''
  };
}

function notionDailyToProperties(text, date) {
  return {
    Date: { title: [{ text: { content: date } }] },
    Summary: { rich_text: [{ text: { content: text } }] }
  };
}

function notionPropertiesToDaily(properties) {
  return {
    date: properties.Date?.title?.[0]?.text?.content || '',
    summary: properties.Summary?.rich_text?.map(r => r.text?.content).join('') || ''
  };
}

async function syncGoalsFromNotion() {
  if (!notionDbGoals) return;
  try {
    const data = await notionQueryDatabase(notionDbGoals);
    const shortTerm = [];
    const longTerm = [];
    for (const page of data.results) {
      const goal = notionPropertiesToGoal(page.properties, page.id);
      if (goal.type === 'longTerm') longTerm.push(goal);
      else shortTerm.push(goal);
    }
    goalsData = { shortTerm, longTerm };
    saveLocalGoals();
    renderGoals();
  } catch (e) {
    addLog(`Sync goals fallito: ${e.message}`);
  }
}

async function syncDailyFromNotion() {
  if (!notionDbDaily) return;
  try {
    const data = await notionQueryDatabase(notionDbDaily);
    dailyData.summaries = data.results.map(p => notionPropertiesToDaily(p.properties));
    saveLocalDaily();
    renderDaily();
  } catch (e) {
    addLog(`Sync daily fallito: ${e.message}`);
  }
}

// ── Goals CRUD ────────────────────────────────────────────────

function renderGoals() {
  if (!shortTermList || !longTermList) return;
  renderGoalList(shortTermList, goalsData.shortTerm || [], 'shortTerm');
  renderGoalList(longTermList, goalsData.longTerm || [], 'longTerm');
  updateStats();
}

function renderGoalList(container, goals, type) {
  container.innerHTML = '';
  if (!goals.length) {
    container.innerHTML = `<div class="obj-empty">Nessun obiettivo ${type === 'shortTerm' ? 'a breve termine' : 'a lungo termine'}.</div>`;
    return;
  }
  // Show undone first
  const sorted = [...goals].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  for (const g of sorted) {
    const el = document.createElement('div');
    el.className = `obj-goal-item${g.done ? ' done' : ''}`;
    el.innerHTML = `
      <button class="obj-goal-check ${g.done ? 'done' : ''}" data-id="${g.id}" data-type="${type}">${g.done ? '<i class="fas fa-check"></i>' : ''}</button>
      <span class="obj-goal-text ${g.done ? 'done' : ''}">${escHtml(g.text)}</span>
      <button class="obj-goal-del" data-id="${g.id}" data-type="${type}"><i class="fas fa-times"></i></button>
    `;
    el.querySelector('.obj-goal-check').addEventListener('click', () => toggleGoal(g.id, type));
    el.querySelector('.obj-goal-del').addEventListener('click', () => deleteGoal(g.id, type));
    container.appendChild(el);
  }
}

function addGoal(text, type) {
  if (!text) return;
  const goal = { id: Date.now().toString(36), text, done: false, created: new Date().toISOString().split('T')[0] };
  if (type === 'longTerm') {
    if (!goalsData.longTerm) goalsData.longTerm = [];
    goalsData.longTerm.unshift(goal);
  } else {
    if (!goalsData.shortTerm) goalsData.shortTerm = [];
    goalsData.shortTerm.unshift(goal);
  }
  saveLocalGoals();
  renderGoals();
  pushToNotion(goal, type);
}

function toggleGoal(id, type) {
  const list = type === 'longTerm' ? goalsData.longTerm : goalsData.shortTerm;
  const goal = list?.find(g => g.id === id);
  if (!goal) return;
  goal.done = !goal.done;
  saveLocalGoals();
  renderGoals();
  updateNotionGoal(goal, type);
}

function deleteGoal(id, type) {
  const list = type === 'longTerm' ? goalsData.longTerm : goalsData.shortTerm;
  if (!list) return;
  const idx = list.findIndex(g => g.id === id);
  if (idx === -1) return;
  const goal = list[idx];
  list.splice(idx, 1);
  saveLocalGoals();
  renderGoals();
}

async function pushToNotion(goal, type) {
  if (!notionDbGoals || !notionKey) return;
  try {
    const data = await notionCreatePage(notionDbGoals, notionGoalToProperties(goal, type));
    goal.id = data.id;
    saveLocalGoals();
  } catch (e) {
    addLog(`Notion push fallito: ${e.message}`);
  }
}

async function updateNotionGoal(goal, type) {
  if (!notionDbGoals || !notionKey) return;
  if (!goal.id || goal.id.length < 10) return;
  try {
    await notionUpdatePage(goal.id, notionGoalToProperties(goal, type));
  } catch (e) {
    addLog(`Notion update fallito: ${e.message}`);
  }
}

// ── Daily Summary ─────────────────────────────────────────────

function renderDaily() {
  if (!dailyText || !dailyDate) return;
  const today = new Date().toISOString().split('T')[0];
  dailyDate.innerHTML = `<i class="fas fa-calendar-day"></i> ${today}`;
  const todaySummary = dailyData.summaries?.find(s => s.date === today);
  if (todaySummary) {
    dailyText.textContent = todaySummary.summary;
  } else {
    const last = dailyData.summaries?.[0];
    dailyText.textContent = last
      ? `Nessun riepilogo per oggi.\nUltimo: ${last.date} — ${last.summary}`
      : 'Nessun riepilogo disponibile. Scrivine uno qui sotto.';
  }
}

async function saveDailySummary() {
  const text = dailyInput?.value?.trim();
  if (!text) return;
  const today = new Date().toISOString().split('T')[0];
  const existing = dailyData.summaries?.findIndex(s => s.date === today);
  const entry = { date: today, summary: text };
  if (existing >= 0) {
    dailyData.summaries[existing] = entry;
  } else {
    if (!dailyData.summaries) dailyData.summaries = [];
    dailyData.summaries.unshift(entry);
  }
  saveLocalDaily();
  renderDaily();
  dailyInput.value = '';

  if (notionDbDaily && notionKey) {
    try {
      if (existing >= 0) {
        const data = await notionQueryDatabase(notionDbDaily, {
          property: 'Date', title: { equals: today }
        });
        if (data.results.length) {
          await notionUpdatePage(data.results[0].id, notionDailyToProperties(text, today));
        } else {
          await notionCreatePage(notionDbDaily, notionDailyToProperties(text, today));
        }
      } else {
        await notionCreatePage(notionDbDaily, notionDailyToProperties(text, today));
      }
      addLog('Daily summary sincronizzato con Notion.');
    } catch (e) {
      addLog(`Notion sync daily fallito: ${e.message}`);
    }
  }
}

// ── Notion Config ─────────────────────────────────────────────

function loadNotionConfig() {
  notionKey = localStorage.getItem('notion-api-key') || '';
  notionDbGoals = localStorage.getItem('notion-db-goals') || '';
  notionDbDaily = localStorage.getItem('notion-db-daily') || '';
  if (notionKeyInput) notionKeyInput.value = notionKey;
  if (notionDbGoalsInput) notionDbGoalsInput.value = notionDbGoals;
  if (notionDbDailyInput) notionDbDailyInput.value = notionDbDaily;
  if (notionKey) notionVerifyConnection();
  else setNotionStatus('offline', 'Non configurato');
}

function saveNotionConfig() {
  notionKey = notionKeyInput?.value?.trim() || '';
  notionDbGoals = notionDbGoalsInput?.value?.trim() || '';
  notionDbDaily = notionDbDailyInput?.value?.trim() || '';
  localStorage.setItem('notion-api-key', notionKey);
  localStorage.setItem('notion-db-goals', notionDbGoals);
  localStorage.setItem('notion-db-daily', notionDbDaily);
  addLog('Configurazione Notion salvata.');
  if (notionKey) notionVerifyConnection();
}

function setNotionStatus(state, text) {
  if (notionStatusDot) {
    notionStatusDot.className = `item-status ${state}`;
  }
  if (notionStatusText) notionStatusText.textContent = text;
}

function addLog(msg) {
  if (!notionLog) return;
  const el = document.createElement('div');
  el.className = 'obj-log-entry';
  el.textContent = `[${new Date().toLocaleTimeString('it-IT')}] ${msg}`;
  notionLog.appendChild(el);
  notionLog.scrollTop = notionLog.scrollHeight;
}

function escHtml(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}

function updateStats() {
  if (!statGoals || !statDone) return;
  const all = [...(goalsData.shortTerm || []), ...(goalsData.longTerm || [])];
  const done = all.filter(g => g.done).length;
  statGoals.textContent = `${all.length} obiettivi`;
  statDone.textContent = `${done} completati`;
}

// ── Event Listeners ───────────────────────────────────────────

if (shortAdd) {
  shortAdd.addEventListener('click', () => {
    const text = shortInput?.value?.trim();
    if (text) { addGoal(text, 'shortTerm'); shortInput.value = ''; }
  });
}
if (shortInput) {
  shortInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); shortAdd?.click(); }
  });
}

if (longAdd) {
  longAdd.addEventListener('click', () => {
    const text = longInput?.value?.trim();
    if (text) { addGoal(text, 'longTerm'); longInput.value = ''; }
  });
}
if (longInput) {
  longInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); longAdd?.click(); }
  });
}

if (dailySave) {
  dailySave.addEventListener('click', saveDailySummary);
}
if (dailyInput) {
  dailyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); dailySave?.click(); }
  });
}

if (notionVerifyBtn) {
  notionVerifyBtn.addEventListener('click', () => {
    notionKey = notionKeyInput?.value?.trim() || '';
    notionDbGoals = notionDbGoalsInput?.value?.trim() || '';
    notionDbDaily = notionDbDailyInput?.value?.trim() || '';
    notionVerifyConnection();
  });
}

if (notionSaveConfig) {
  notionSaveConfig.addEventListener('click', saveNotionConfig);
}

if (configToggle && configBody) {
  configToggle.addEventListener('click', () => {
    const isHidden = configBody.style.display === 'none';
    configBody.style.display = isHidden ? 'block' : 'none';
    const arrow = configToggle.querySelector('.obj-config-arrow i');
    if (arrow) arrow.className = isHidden ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
  });
  configBody.style.display = 'none';
}

// ── Init ──────────────────────────────────────────────────────

function openEditor() {
  if (window.electronAPI?.openEditor) {
    window.electronAPI.openEditor();
  }
}

function initObjectives() {
  renderGoals();
  renderDaily();
  loadNotionConfig();
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initObjectives, 500);
});
