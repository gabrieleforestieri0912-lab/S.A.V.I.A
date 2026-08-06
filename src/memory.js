/**
 * S.A.V.I.A - Memory Core (Personal Context & Memory System)
 */

let memoryData = null;
let projectsCache = [];

// Start loading the memory data immediately as soon as the script is evaluated
window.memoryLoadedPromise = (async () => {
  if (window.electronAPI && window.electronAPI.memoryLoad) {
    try {
      memoryData = await window.electronAPI.memoryLoad();
      return memoryData;
    } catch (e) {
      console.error("Failed to load memory data:", e);
    }
  }
  return null;
})();

const memBadge = document.getElementById('mem-badge');
const memProjectsList = document.getElementById('mem-projects-list');
const memProjectsCount = document.getElementById('mem-projects-count');
const memGoalsList = document.getElementById('mem-goals-list');
const memGoalsCount = document.getElementById('mem-goals-count');
const memPeopleList = document.getElementById('mem-people-list');
const memPeopleCount = document.getElementById('mem-people-count');
const memDailyText = document.getElementById('mem-daily-text');
const memGoalInput = document.getElementById('mem-goal-input');
const memGoalAdd = document.getElementById('mem-goal-add');
const memPeopleInput = document.getElementById('mem-people-input');
const memPeopleAdd = document.getElementById('mem-people-add');
const memScanBtn = document.getElementById('mem-scan-btn');

async function initMemoryCore() {
  if (!window.electronAPI || !window.electronAPI.memoryLoad) return;
  try {
    await window.memoryLoadedPromise;
    if (memoryData) {
      renderMemory();
      memBadge.textContent = 'READY';
      memBadge.style.color = 'var(--accent-cyan)';
    } else {
      throw new Error("No memory data loaded");
    }
  } catch (e) {
    memBadge.textContent = 'OFF';
    memBadge.style.color = 'var(--accent-red)';
  }
}

function renderMemory() {
  if (!memoryData) return;
  renderProjects();
  renderGoals();
  renderPeople();
  renderDailySummary();
}

// ── Projects ─────────────────────────────────────────────────────────

function renderProjects() {
  if (!memProjectsList) return;
  memProjectsList.innerHTML = '';
  const projects = memoryData.projects || [];
  memProjectsCount.textContent = projects.length;

  projects.slice(0, 5).forEach(p => {
    const el = document.createElement('div');
    el.className = 'mem-item';
    el.title = `${p.path}\n${p.description}\nUltimo accesso: ${p.lastAccessed}`;
    el.innerHTML = `
      <span class="mem-item-icon"><i class="fas fa-folder"></i></span>
      <span class="mem-item-name">${p.name}</span>
      ${p.tags && p.tags.length ? `<span class="mem-item-tag">${p.tags[0]}</span>` : ''}
    `;
    memProjectsList.appendChild(el);
  });

  if (projects.length === 0) {
    memProjectsList.innerHTML = '<div class="mem-item"><span class="mem-item-name" style="color:rgba(255,255,255,0.2);font-style:italic;">Nessun progetto rilevato</span></div>';
  }
}

async function scanProjects() {
  if (!window.electronAPI || !window.electronAPI.memoryScanProjects) {
    if (memBadge) { memBadge.textContent = 'NO IPC'; memBadge.style.color = 'var(--accent-red)'; }
    return;
  }
  if (!memScanBtn) return;
  memScanBtn.classList.add('scanning');
  memScanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> SCANNING...';
  try {
    const result = await window.electronAPI.memoryScanProjects();
    if (result.success && result.projects) {
      // Guard: memoryData might still be null if memory core failed to load
      if (!memoryData) {
        memoryData = { conversations: [], projects: [], goals: { shortTerm: [], longTerm: [] }, people: [], dailySummaries: [] };
      }
      memoryData.projects = result.projects;
      await saveMemory();
      renderProjects();
      if (memBadge) { memBadge.textContent = `${result.projects.length} PROJ`; memBadge.style.color = 'var(--accent-cyan)'; }
      setTimeout(() => { if (memBadge) memBadge.textContent = 'READY'; }, 3000);
    } else if (!result.success) {
      console.error('Project scan failed:', result.error);
      if (memProjectsList) memProjectsList.innerHTML = '<div class="mem-item"><span class="mem-item-name" style="color:var(--accent-red);font-style:italic;">Errore scansione: ' + (result.error || 'sconosciuto') + '</span></div>';
    }
  } catch (e) {
    console.error('scanProjects exception:', e);
    if (memProjectsList) memProjectsList.innerHTML = '<div class="mem-item"><span class="mem-item-name" style="color:var(--accent-red);font-style:italic;">Errore: ' + e.message + '</span></div>';
  }
  memScanBtn.classList.remove('scanning');
  memScanBtn.innerHTML = '<i class="fas fa-sync-alt"></i> SCAN PROJECTS';
}

if (memScanBtn) {
  memScanBtn.addEventListener('click', () => {
    playAudio(audioClick);
    scanProjects();
  });
}

// ── Goals ────────────────────────────────────────────────────────────

function renderGoals() {
  if (!memGoalsList) return;
  memGoalsList.innerHTML = '';
  const goals = memoryData.goals || { shortTerm: [], longTerm: [] };
  const all = [...(goals.shortTerm || []), ...(goals.longTerm || [])];
  memGoalsCount.textContent = all.length;

  if (all.length === 0) {
    memGoalsList.innerHTML = '<div class="mem-item"><span class="mem-item-name" style="color:rgba(255,255,255,0.2);font-style:italic;">Nessun obiettivo</span></div>';
    return;
  }

  all.forEach(g => {
    const el = document.createElement('div');
    el.className = 'mem-item';
    el.innerHTML = `
      <button class="mem-goal-check ${g.done ? 'done' : ''}" data-id="${g.id}">${g.done ? '<i class="fas fa-check"></i>' : ''}</button>
      <span class="mem-goal-text ${g.done ? 'done' : ''}">${g.text}</span>
      <button class="mem-item-del" data-id="${g.id}"><i class="fas fa-times"></i></button>
    `;
    el.querySelector('.mem-goal-check').addEventListener('click', () => toggleGoal(g.id));
    el.querySelector('.mem-item-del').addEventListener('click', () => deleteGoal(g.id));
    memGoalsList.appendChild(el);
  });
}

function addGoal(text) {
  if (!text || !memoryData) return;
  const goals = memoryData.goals || { shortTerm: [], longTerm: [] };
  const goal = { id: Date.now().toString(36), text, done: false, created: new Date().toISOString().split('T')[0] };
  goals.shortTerm.unshift(goal);
  memoryData.goals = goals;
  saveMemory();
  renderGoals();
}

function toggleGoal(id) {
  if (!memoryData) return;
  const goals = memoryData.goals || { shortTerm: [], longTerm: [] };
  for (const list of ['shortTerm', 'longTerm']) {
    const g = goals[list].find(x => x.id === id);
    if (g) { g.done = !g.done; break; }
  }
  memoryData.goals = goals;
  saveMemory();
  renderGoals();
}

function deleteGoal(id) {
  if (!memoryData) return;
  const goals = memoryData.goals || { shortTerm: [], longTerm: [] };
  goals.shortTerm = goals.shortTerm.filter(g => g.id !== id);
  goals.longTerm = goals.longTerm.filter(g => g.id !== id);
  memoryData.goals = goals;
  saveMemory();
  renderGoals();
}

if (memGoalAdd) {
  memGoalAdd.addEventListener('click', () => {
    const text = memGoalInput.value.trim();
    if (text) { addGoal(text); memGoalInput.value = ''; }
  });
}
if (memGoalInput) {
  memGoalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); memGoalAdd.click(); }
  });
}

// ── People ───────────────────────────────────────────────────────────

function renderPeople() {
  if (!memPeopleList) return;
  memPeopleList.innerHTML = '';
  const people = memoryData.people || [];
  memPeopleCount.textContent = people.length;

  if (people.length === 0) {
    memPeopleList.innerHTML = '<div class="mem-item"><span class="mem-item-name" style="color:rgba(255,255,255,0.2);font-style:italic;">Nessuna persona</span></div>';
    return;
  }

  people.forEach(p => {
    const el = document.createElement('div');
    el.className = 'mem-item';
    el.title = p.relation ? `Relazione: ${p.relation}` : '';
    el.innerHTML = `
      <span class="mem-item-icon"><i class="fas fa-user"></i></span>
      <span class="mem-item-name">${p.name}</span>
      ${p.relation ? `<span class="mem-item-tag">${p.relation}</span>` : ''}
      <button class="mem-item-del" data-id="${p.id}"><i class="fas fa-times"></i></button>
    `;
    el.querySelector('.mem-item-del').addEventListener('click', () => deletePerson(p.id));
    memPeopleList.appendChild(el);
  });
}

function addPerson(name) {
  if (!name || !memoryData) return;
  const people = memoryData.people || [];
  people.unshift({ id: Date.now().toString(36), name, relation: '', context: '', lastContact: new Date().toISOString().split('T')[0] });
  memoryData.people = people;
  saveMemory();
  renderPeople();
}

function deletePerson(id) {
  if (!memoryData) return;
  memoryData.people = (memoryData.people || []).filter(p => p.id !== id);
  saveMemory();
  renderPeople();
}

if (memPeopleAdd) {
  memPeopleAdd.addEventListener('click', () => {
    const name = memPeopleInput.value.trim();
    if (name) { addPerson(name); memPeopleInput.value = ''; }
  });
}
if (memPeopleInput) {
  memPeopleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); memPeopleAdd.click(); }
  });
}

// ── Daily Summary ────────────────────────────────────────────────────

function renderDailySummary() {
  if (!memDailyText) return;
  const summaries = memoryData.dailySummaries || [];
  const today = new Date().toISOString().split('T')[0];
  const todaySummary = summaries.find(s => s.date === today);
  if (todaySummary) {
    memDailyText.textContent = todaySummary.summary;
  } else {
    const last = summaries[0];
    memDailyText.textContent = last ? `Ultimo: ${last.date} - ${last.summary}` : 'Nessun riepilogo disponibile. Inizia a conversare con S.A.V.I.A.';
  }
}

// ── Persistence ──────────────────────────────────────────────────────

async function saveMemory() {
  if (!window.electronAPI || !window.electronAPI.memorySave) return;
  try {
    await window.electronAPI.memorySave(memoryData);
  } catch (e) { /* ignore */ }
}

// ── Conversation Logging ─────────────────────────────────────────────

async function logConversation(userMsg, aiMsg) {
  if (!window.electronAPI || !window.electronAPI.memoryAddConversation) return;
  try {
    const summary = userMsg.length > 80 ? userMsg.substring(0, 80) + '...' : userMsg;
    
    // Update local memoryData in renderer to keep current session conversations in sync
    if (memoryData) {
      if (!memoryData.conversations) memoryData.conversations = [];
      memoryData.conversations.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        date: new Date().toISOString(),
        summary: `Utente: ${summary}`,
        messages: [
          { sender: 'user', text: userMsg, timestamp: new Date().toISOString() },
          { sender: 'savia', text: aiMsg, timestamp: new Date().toISOString() }
        ]
      });
      if (memoryData.conversations.length > 50) {
        memoryData.conversations = memoryData.conversations.slice(0, 50);
      }
    }

    await window.electronAPI.memoryAddConversation({
      summary: `Utente: ${summary}`,
      messages: [
        { sender: 'user', text: userMsg, timestamp: new Date().toISOString() },
        { sender: 'savia', text: aiMsg, timestamp: new Date().toISOString() }
      ]
    });
    memBadge.textContent = 'SAVED';
    setTimeout(() => { if (memBadge) memBadge.textContent = 'READY'; }, 2000);
  } catch (e) { /* ignore */ }
}

// ── AI Context Builder ───────────────────────────────────────────────

function buildMemoryContext() {
  if (!memoryData) return '';
  const parts = [];

  const projects = memoryData.projects || [];
  if (projects.length > 0) {
    const active = projects.slice(0, 5);
    parts.push(`Progetti attivi: ${active.map(p => `${p.name} (${p.description})`).join(', ')}`);
  }

  const goals = memoryData.goals || { shortTerm: [], longTerm: [] };
  const activeGoals = [...(goals.shortTerm || []), ...(goals.longTerm || [])].filter(g => !g.done);
  if (activeGoals.length > 0) {
    parts.push(`Obiettivi in corso: ${activeGoals.map(g => g.text).join(', ')}`);
  }

  const people = memoryData.people || [];
  if (people.length > 0) {
    parts.push(`Persone di riferimento: ${people.map(p => p.name + (p.relation ? ` (${p.relation})` : '')).join(', ')}`);
  }

  const today = new Date().toISOString().split('T')[0];
  const summaries = memoryData.dailySummaries || [];
  const todaySummary = summaries.find(s => s.date === today);
  if (todaySummary) {
    parts.push(`Riepilogo odierno: ${todaySummary.summary}`);
  }

  return parts.length > 0 ? `\n\nCONTESTO PERSONALE:\n${parts.join('\n')}` : '';
}

// ── Init ─────────────────────────────────────────────────────────────

setTimeout(initMemoryCore, 2000);
