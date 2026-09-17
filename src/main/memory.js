'use strict';

// ============================================================
// MEMORY CORE — personal context & memory store
// + scansione progetto (scanForProjects / getFolderSize)
// ============================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, ipcMain } = require('electron');

const MEMORY_FILE = path.join(app.getPath('userData'), 'savia-memory.json');

const DEFAULT_MEMORY = {
  conversations: [],
  projects: [],
  goals: { shortTerm: [], longTerm: [] },
  people: [],
  dailySummaries: [],
  lastDailySummaryDate: ''
};

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return { ...DEFAULT_MEMORY, ...JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')) };
    }
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_MEMORY));
}

function saveMemory(data) {
  try {
    if (data.conversations && data.conversations.length > 50) {
      data.conversations = data.conversations.slice(-50);
    }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) { return false; }
}

function scanForProjects(dirPath, depth = 1) {
  if (depth > 3) return [];
  const projects = [];
  try {
    const entries = fs.existsSync(dirPath) ? fs.readdirSync(dirPath, { withFileTypes: true }) : [];

    const hasGit = entries.some(e => e.isDirectory() && e.name === '.git');
    const hasPackageJson = entries.some(e => e.isFile() && e.name === 'package.json');
    const hasProjectFile = entries.some(e => e.isFile() && (
      e.name === 'Cargo.toml' ||
      e.name === 'go.mod' ||
      e.name === 'requirements.txt' ||
      e.name === 'composer.json' ||
      e.name.endsWith('.sln') ||
      e.name.endsWith('.csproj')
    ));

    if (hasGit || hasPackageJson || hasProjectFile) return [dirPath];

    const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules');
    for (const subdir of subdirs) {
      projects.push(...scanForProjects(path.join(dirPath, subdir.name), depth + 1));
    }

    // Fallback: livello 2 senza sotto-progetti → tratta le sottodirectory come progetti
    if (depth === 2 && projects.length === 0) {
      for (const subdir of subdirs) projects.push(path.join(dirPath, subdir.name));
    }
  } catch (e) { /* ignore */ }
  return projects;
}

function getFolderSize(dirPath) {
  try {
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) total += getFolderSize(fullPath);
      else if (entry.isFile()) total += fs.statSync(fullPath).size;
    }
    return total;
  } catch { return 0; }
}

const README_NAMES = ['README.md', 'README.txt', 'Readme.md', 'readme.md'];

function describeProject(dirPath, files, tags, hasPackageJson, hasSrc) {
  let description = '';
  try {
    if (hasPackageJson) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf-8'));
      if (pkg.description) description = pkg.description;
      if (pkg.name) tags.push(pkg.name);
    }
    for (const rn of README_NAMES) {
      if (!description && files.includes(rn)) {
        const firstLine = fs.readFileSync(path.join(dirPath, rn), 'utf-8').trim().split('\n')[0].replace(/^#\s*/, '').trim();
        if (firstLine) { description = firstLine; break; }
      }
    }
  } catch (e) { /* ignore */ }

  if (!description) {
    const hints = ['python', 'dotnet', 'java', 'rust', 'go', 'csharp']
      .filter(t => tags.includes(t))
      .map(hint => ({ python: 'Python', dotnet: '.NET', java: 'Java', rust: 'Rust', go: 'Go', csharp: 'C#' })[hint]);
    if (hasPackageJson && !hints.length) hints.push('Node.js');
    description = hints.length
      ? `Progetto ${hints.join('/')}`
      : `Progetto "${path.basename(dirPath)}" — nessuna descrizione disponibile`;
  }
  return description;
}

async function scanProjects(basePath) {
  const targetPath = basePath || path.join(os.homedir(), 'Documents', 'Progetti');
  if (!fs.existsSync(targetPath)) return { success: true, projects: [] };

  const projects = [];
  for (const dirPath of scanForProjects(targetPath)) {
    const files = fs.readdirSync(dirPath);
    const tags = [];
    const hasPackageJson = files.includes('package.json');
    const hasGit = files.includes('.git');
    const hasSrc = files.some(f => f === 'src' || f === 'source');

    if (hasPackageJson) tags.push('node');
    if (hasGit) tags.push('git');
    if (files.some(f => f.endsWith('.sln') || f.endsWith('.csproj'))) tags.push('dotnet');
    if (files.some(f => f.endsWith('.py'))) tags.push('python');
    if (files.some(f => f.endsWith('.java'))) tags.push('java');
    if (files.some(f => f === 'Cargo.toml')) tags.push('rust');
    if (files.some(f => f === 'go.mod')) tags.push('go');
    if (files.some(f => f.endsWith('.cs'))) tags.push('csharp');
    if (hasSrc) tags.push('structured');

    try {
      const stat = fs.statSync(dirPath);
      projects.push({
        name: path.basename(dirPath),
        path: dirPath,
        description: describeProject(dirPath, files, tags, hasPackageJson, hasSrc),
        tags,
        lastAccessed: new Date(stat.mtimeMs).toISOString().split('T')[0],
        size: getFolderSize(dirPath)
      });
    } catch (e) { /* ignore */ }
  }
  projects.sort((a, b) => b.lastAccessed.localeCompare(a.lastAccessed));
  return { success: true, projects };
}

function init() {
  ipcMain.handle('memory-load', () => loadMemory());
  ipcMain.handle('memory-save', (event, data) => ({ success: saveMemory(data) }));
  ipcMain.handle('memory-scan-projects', (event, basePath) => scanProjects(basePath));

  ipcMain.handle('memory-add-conversation', (event, conversation) => {
    const memory = loadMemory();
    memory.conversations.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      date: new Date().toISOString(),
      summary: conversation.summary || 'Conversazione',
      messages: (conversation.messages || []).slice(-20)
    });
    saveMemory(memory);
    return { success: true, count: memory.conversations.length };
  });

  ipcMain.handle('memory-daily-summary', (event, summaryData) => {
    const memory = loadMemory();
    const today = new Date().toISOString().split('T')[0];
    const entry = {
      date: today,
      summary: summaryData.summary || 'Nessuna attività registrata',
      activities: summaryData.activities || []
    };
    const existingIdx = memory.dailySummaries.findIndex(s => s.date === today);
    if (existingIdx >= 0) memory.dailySummaries[existingIdx] = entry;
    else {
      memory.dailySummaries.unshift(entry);
      if (memory.dailySummaries.length > 30) memory.dailySummaries = memory.dailySummaries.slice(0, 30);
    }
    memory.lastDailySummaryDate = today;
    saveMemory(memory);
    return { success: true };
  });
}

module.exports = {
  init,
  loadMemory,
  saveMemory,
  scanForProjects,
  getFolderSize
};