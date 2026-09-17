// ═══════════════════════════════════════════════════════════════════
// S.A.V.I.A. IDE — Complete code editor (VSCode/Cursor-like)
// ═══════════════════════════════════════════════════════════════════

require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});

// ── State ─────────────────────────────────────────────────────────
const editors = new Map();
let activeEditor = null;
let activeTab = null;
let activeFilePath = null;
let currentRootDir = null;
let fileTreeData = {};
let openTabs = [];
let unsavedFiles = new Set();
let findState = null;
let importedProjectRoot = null;
let importedProjectName = null;
let activePanel = 'explorer';
let isDirty = false;
let activeBottomTab = 'problems';
let problems = [];
let outputLines = [];
let lastSearchResults = [];
let terminalCount = 1;
let searchDebounce = null;
let decorations = [];
let currentTheme = 'vs-dark';
let sidebarVisible = true;
let bottomPanelVisible = true;
let autoSaveEnabled = false;
let autoSaveTimer = null;
let zenMode = false;
let splitEditorActive = false;

const editorSettings = {
  fontSize: 14,
  fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
  tabSize: 2,
  wordWrap: 'on',
  minimap: true,
  lineNumbers: true,
  renderWhitespace: 'selection',
  formatOnSave: false,
  formatOnPaste: true,
  autoSave: false,
  cursorBlinking: 'smooth',
  smoothScrolling: true,
  bracketPairColorization: true,
  renderLineHighlight: 'all',
  scrollBeyondLastLine: false,
  stickyScroll: true,
  guides: { indentation: true, bracketPairs: true },
  theme: 'savia-dark',
  terminalFontSize: 13,
};

const ICONS = {
  js: 'fab fa-js-square', jsx: 'fab fa-js-square',
  ts: 'fab fa-js-square', tsx: 'fab fa-js-square',
  html: 'fab fa-html5', htm: 'fab fa-html5',
  css: 'fab fa-css3-alt', scss: 'fab fa-css3-alt', less: 'fab fa-css3-alt',
  json: 'fas fa-brackets-curly', md: 'fab fa-markdown', mdx: 'fab fa-markdown',
  py: 'fab fa-python', java: 'fab fa-java',
  c: 'fas fa-c', h: 'fas fa-c', cpp: 'fas fa-c', hpp: 'fas fa-c', cs: 'fas fa-c',
  go: 'fab fa-golang', rs: 'fas fa-gear', sh: 'fas fa-terminal', bash: 'fas fa-terminal', bat: 'fas fa-terminal',
  yaml: 'fas fa-file-lines', yml: 'fas fa-file-lines', toml: 'fas fa-file-lines', ini: 'fas fa-file-lines',
  xml: 'fas fa-file-code', svg: 'fas fa-file-image',
  sql: 'fas fa-database', db: 'fas fa-database', sqlite: 'fas fa-database',
  php: 'fab fa-php', rb: 'fas fa-gem', lua: 'fas fa-gamepad',
  r: 'fab fa-r-project', kt: 'fas fa-code', swift: 'fab fa-swift',
  txt: 'fas fa-file-alt', log: 'fas fa-file-alt',
  env: 'fas fa-key', lock: 'fas fa-lock',
  gitignore: 'fas fa-eye-slash', dockerfile: 'fab fa-docker',
  png: 'fas fa-file-image', jpg: 'fas fa-file-image', jpeg: 'fas fa-file-image', gif: 'fas fa-file-image', ico: 'fas fa-file-image',
  pdf: 'fas fa-file-pdf', zip: 'fas fa-file-archive', rar: 'fas fa-file-archive', tar: 'fas fa-file-archive', gz: 'fas fa-file-archive',
  mp4: 'fas fa-file-video', mp3: 'fas fa-file-audio', wav: 'fas fa-file-audio',
  default: 'fas fa-file'
};

const EXT_TO_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less', sass: 'scss',
  json: 'json', jsonc: 'json',
  md: 'markdown', mdx: 'markdown',
  py: 'python', pyi: 'python', pyw: 'python',
  java: 'java', kt: 'kotlin', scala: 'scala',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  cs: 'csharp', fs: 'fsharp', vb: 'vb',
  go: 'go', rs: 'rust',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', bat: 'bat', ps1: 'powershell',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  php: 'php', rb: 'ruby', lua: 'lua', perl: 'perl', pl: 'perl',
  r: 'r', swift: 'swift', dart: 'dart', vue: 'html', svelte: 'html',
  txt: 'plaintext', env: 'plaintext', log: 'plaintext',
  dockerfile: 'dockerfile', makefile: 'makefile',
};

const LANG_BY_FILENAME = {
  'dockerfile': 'dockerfile',
  'makefile': 'makefile',
  '.gitignore': 'plaintext',
  '.env': 'plaintext',
  '.envrc': 'plaintext',
};

const FILE_ICONS_BY_NAME = {
  'package.json': 'fab fa-node-js',
  'package-lock.json': 'fab fa-npm',
  'yarn.lock': 'fab fa-yarn',
  'pnpm-lock.yaml': 'fab fa-npm',
  'tsconfig.json': 'fas fa-code',
  'jsconfig.json': 'fas fa-code',
  'webpack.config.js': 'fas fa-cog',
  'vite.config.js': 'fas fa-cog',
  'vite.config.ts': 'fas fa-cog',
  'rollup.config.js': 'fas fa-cog',
  'tailwind.config.js': 'fas fa-wind',
  'postcss.config.js': 'fas fa-cog',
  '.eslintrc': 'fas fa-shield-alt',
  '.eslintrc.json': 'fas fa-shield-alt',
  '.prettierrc': 'fas fa-paint-roller',
  'readme.md': 'fab fa-markdown',
  'license': 'fas fa-balance-scale',
  'license.md': 'fas fa-balance-scale',
  'dockerfile': 'fab fa-docker',
  'docker-compose.yml': 'fab fa-docker',
  '.gitignore': 'fas fa-eye-slash',
};

// ── Utilities ─────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function basename(p) { return (p || '').split(/[\\\/]/).pop() || p; }
function dirname(p) {
  if (!p) return '';
  const clean = p.replace(/[\\\/]+$/, '');
  const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return i > 0 ? clean.slice(0, i) : '';
}
function getExt(name) { const m = (name || '').toLowerCase().match(/\.([^.]+)$/); return m ? m[1] : ''; }

function getLangForFile(name) {
  const lc = (name || '').toLowerCase();
  if (LANG_BY_FILENAME[lc]) return LANG_BY_FILENAME[lc];
  const ext = getExt(name);
  return EXT_TO_LANG[ext] || 'plaintext';
}
const getLangForFileFixed = (name) => {
  const lc = (name || '').toLowerCase();
  if (LANG_BY_FILENAME[lc]) return LANG_BY_FILENAME[lc];
  const ext = getExt(name);
  return EXT_TO_LANG[ext] || 'plaintext';
};

function getFileIcon(name, isDir) {
  if (isDir) return '<i class="fas fa-folder" style="color: var(--accent-gold);"></i>';
  const lc = (name || '').toLowerCase();
  if (FILE_ICONS_BY_NAME[lc]) return `<i class="${FILE_ICONS_BY_NAME[lc]}"></i>`;
  const ext = getExt(name);
  return `<i class="${ICONS[ext] || ICONS.default}"></i>`;
}

function joinPath(...parts) {
  return parts.filter(Boolean).join('/').replace(/[\\\/]+/g, '/');
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function toast(message, type = 'info', title = null, duration = 4000) {
  const c = $('#toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}<div class="toast-msg">${escapeHtml(message)}</div>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; t.style.transition = 'all 0.3s'; setTimeout(() => t.remove(), 300); }, duration);
}

function showContextMenu(x, y, items) {
  const menu = $('#context-menu');
  menu.innerHTML = '';
  items.forEach(it => {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'cm-sep';
      menu.appendChild(s);
      return;
    }
    const el = document.createElement('div');
    el.className = 'cm-item' + (it.disabled ? ' disabled' : '');
    el.innerHTML = `<i class="${it.icon || 'fas fa-circle'}"></i> <span>${escapeHtml(it.label)}</span>${it.shortcut ? `<span class="shortcut">${escapeHtml(it.shortcut)}</span>` : ''}`;
    if (!it.disabled) {
      el.addEventListener('click', () => { hideContextMenu(); try { it.action(); } catch(e) { console.error(e); } });
    }
    menu.appendChild(el);
  });
  menu.style.display = 'block';
  // Position with bounds
  const w = menu.offsetWidth || 240;
  const h = menu.offsetHeight || 200;
  const maxX = window.innerWidth - w - 4;
  const maxY = window.innerHeight - h - 4;
  menu.style.left = Math.min(x, maxX) + 'px';
  menu.style.top = Math.min(y, maxY) + 'px';
}

function hideContextMenu() {
  const m = $('#context-menu');
  if (m) m.style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#context-menu')) hideContextMenu();
  if (!e.target.closest('.palette-overlay') && !e.target.closest('[data-menu]')) {
    $$('.menu-dropdown').forEach(d => d.classList.remove('open'));
    $$('.menu-item').forEach(m => m.classList.remove('active'));
  }
});
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('#context-menu') && !e.target.closest('.monaco-editor')) hideContextMenu();
});

// Export to window
window.toast = toast;
window.showContextMenu = showContextMenu;
window.hideContextMenu = hideContextMenu;

// ═══════════════════════════════════════════════════════════════════
// TABS MANAGEMENT
// ═══════════════════════════════════════════════════════════════════
function createTab(filePath, label) {
  const existing = openTabs.find(t => t.path === filePath);
  if (existing) { setActiveTab(filePath); return; }
  openTabs.push({ path: filePath, label: label || basename(filePath) });
  renderTabs();
  renderOpenEditors();
  openEditorForFile(filePath);
}

function closeTab(filePath, event) {
  if (event) event.stopPropagation();
  if (unsavedFiles.has(filePath)) {
    if (!confirm(`"${basename(filePath)}" has unsaved changes. Close anyway?`)) return;
    unsavedFiles.delete(filePath);
  }
  const idx = openTabs.findIndex(t => t.path === filePath);
  if (idx >= 0) openTabs.splice(idx, 1);
  const ed = editors.get(filePath);
  if (ed) { ed.dispose(); editors.delete(filePath); }
  if (activeTab === filePath) {
    if (openTabs.length > 0) {
      const next = openTabs[Math.min(idx, openTabs.length - 1)] || openTabs[openTabs.length - 1];
      setActiveTab(next.path);
    } else {
      activeTab = null; activeEditor = null; activeFilePath = null;
      $('#editor-container').innerHTML = '';
      showWelcome();
    }
  }
  renderTabs();
  renderOpenEditors();
  updateBreadcrumb();
  updateStatusBar();
  refreshOutline();
}

function closeAllTabs() {
  const dirty = openTabs.filter(t => unsavedFiles.has(t.path));
  if (dirty.length && !confirm(`${dirty.length} file(s) have unsaved changes. Close all anyway?`)) return;
  [...openTabs].forEach(t => { const ed = editors.get(t.path); if (ed) { ed.dispose(); editors.delete(t.path); } });
  openTabs = [];
  unsavedFiles.clear();
  activeTab = null; activeEditor = null; activeFilePath = null;
  $('#editor-container').innerHTML = '';
  showWelcome();
  renderTabs();
  renderOpenEditors();
  updateStatusBar();
  refreshOutline();
}

function closeOthersTabs(keepPath) {
  openTabs.filter(t => t.path !== keepPath).forEach(t => {
    if (unsavedFiles.has(t.path)) { if (!confirm(`"${basename(t.path)}" unsaved. Close?`)) return; unsavedFiles.delete(t.path); }
    const ed = editors.get(t.path); if (ed) { ed.dispose(); editors.delete(t.path); }
  });
  openTabs = openTabs.filter(t => t.path === keepPath);
  setActiveTab(keepPath);
  renderTabs();
  renderOpenEditors();
}

function setActiveTab(filePath) {
  activeTab = filePath;
  $$('.tab-item').forEach(el => el.classList.toggle('active', el.dataset.path === filePath));
  $$('.open-editor-item').forEach(el => el.classList.toggle('active', el.dataset.path === filePath));
  $$('.tree-item').forEach(el => el.classList.toggle('active', el.dataset.path === filePath));
  editors.forEach((ed, p) => { ed.getContainerDomNode().style.display = (p === filePath) ? 'block' : 'none'; });
  const ed = editors.get(filePath);
  if (ed) {
    activeEditor = ed;
    activeFilePath = filePath;
    ed.focus();
    updateStatusBar();
    updateBreadcrumb();
    refreshOutline();
    refreshProblems();
  } else {
    activeEditor = null;
    activeFilePath = filePath;
    updateStatusBar();
    updateBreadcrumb();
  }
}

function renderTabs() {
  const bar = $('#tab-bar');
  bar.innerHTML = '';
  openTabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.path === activeTab ? ' active' : '') + (unsavedFiles.has(tab.path) ? ' unsaved' : '');
    el.dataset.path = tab.path;
    el.title = tab.path;
    el.draggable = true;
    el.innerHTML = `
      <span class="tab-icon">${getFileIcon(tab.label, false)}</span>
      <span class="tab-name">${escapeHtml(tab.label)}</span>
      <span class="tab-close" title="Close"><i class="fas fa-times"></i></span>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) return;
      if (e.button === 1) { e.preventDefault(); closeTab(tab.path, e); return; }
      setActiveTab(tab.path);
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); closeTab(tab.path, e); }
    });
    el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.path, e); } });
    el.querySelector('.tab-close').addEventListener('click', (e) => closeTab(tab.path, e));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { icon: 'fas fa-times', label: 'Close', action: () => closeTab(tab.path, {}) },
        { icon: 'fas fa-times-circle', label: 'Close Others', action: () => closeOthersTabs(tab.path) },
        { sep: true },
        { icon: 'fas fa-copy', label: 'Copy Path', action: () => { navigator.clipboard.writeText(tab.path); toast('Path copied', 'success', null, 2000); } },
        { icon: 'fas fa-folder-open', label: 'Reveal in Explorer', action: () => window.electronAPI?.openInExplorer?.(tab.path) },
      ]);
    });
    bar.appendChild(el);
  });
  // Scroll active into view
  const active = bar.querySelector('.tab-item.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function renderOpenEditors() {
  const wrap = $('#open-editors');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!openTabs.length) {
    wrap.innerHTML = '<div style="padding:12px 14px; color: var(--text-muted); font-size: 12px;">No editors open</div>';
    return;
  }
  openTabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'open-editor-item' + (tab.path === activeTab ? ' active' : '') + (unsavedFiles.has(tab.path) ? ' dirty' : '');
    el.dataset.path = tab.path;
    el.title = tab.path;
    el.innerHTML = `
      <span class="file-icon">${getFileIcon(tab.label, false)}</span>
      <span class="file-name">${escapeHtml(tab.label)}</span>
      <span class="dirty-dot" title="Unsaved"></span>
      <span class="close-x" title="Close"><i class="fas fa-times"></i></span>
    `;
    el.addEventListener('click', (e) => { if (!e.target.closest('.close-x')) setActiveTab(tab.path); });
    el.querySelector('.close-x').addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.path, e); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { icon: 'fas fa-times', label: 'Close', action: () => closeTab(tab.path, {}) },
        { icon: 'fas fa-times-circle', label: 'Close Others', action: () => closeOthersTabs(tab.path) },
      ]);
    });
    wrap.appendChild(el);
  });
}

function showWelcome() {
  $('#editor-container').innerHTML = `
    <div class="welcome-screen" id="welcome-screen">
      <div class="welcome-logo"><i class="fas fa-code"></i></div>
      <div class="welcome-title">S.A.V.I.A. IDE</div>
      <div class="welcome-sub">Editing evolved — open a file or folder to begin</div>
      <div class="welcome-actions">
        <div class="welcome-action" data-action="open-folder"><i class="fas fa-folder-open"></i> Open Folder</div>
        <div class="welcome-action" data-action="open-file"><i class="fas fa-file"></i> Open File</div>
        <div class="welcome-action" data-action="clone"><i class="fas fa-code-branch"></i> Clone Repository</div>
        <div class="welcome-action" data-action="new-file"><i class="fas fa-plus"></i> New File</div>
      </div>
      <div class="welcome-shortcuts">
        <div><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> &nbsp;Command Palette</div>
        <div><kbd>Ctrl</kbd>+<kbd>P</kbd> &nbsp;Quick Open &nbsp;·&nbsp; <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> &nbsp;Search</div>
        <div><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> &nbsp;Extensions &nbsp;·&nbsp; <kbd>Ctrl</kbd>+<kbd>,</kbd> &nbsp;Settings</div>
      </div>
    </div>`;
  $$('.welcome-action').forEach(el => {
    el.addEventListener('click', () => {
      const a = el.dataset.action;
      if (a === 'open-folder') importFolder();
      else if (a === 'open-file') openSingleFile();
      else if (a === 'clone') promptCloneRepo();
      else if (a === 'new-file') createNewFile();
    });
  });
}

function updateBreadcrumb() {
  const bcFile = $('#bc-file');
  const bcProj = $('#bc-project');
  if (!activeFilePath) {
    bcFile.textContent = '—';
    bcProj.innerHTML = '<i class="fas fa-folder"></i> ' + (importedProjectName || 'no folder');
    $('#bc-sep-symbol').style.display = 'none';
    $('#bc-symbol').style.display = 'none';
    return;
  }
  bcFile.textContent = basename(activeFilePath);
  bcProj.innerHTML = '<i class="fas fa-folder"></i> ' + (importedProjectName || 'no folder');
  // Symbol from cursor
  if (activeEditor) {
    const pos = activeEditor.getPosition();
    const model = activeEditor.getModel();
    if (model && pos) {
      const word = model.getWordAtPosition(pos);
      $('#bc-symbol').textContent = word ? word.word : '—';
      $('#bc-sep-symbol').style.display = '';
      $('#bc-symbol').style.display = '';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// FILE EXPLORER
// ═══════════════════════════════════════════════════════════════════
function renderFileTree() {
  const tree = $('#file-tree');
  tree.innerHTML = '';
  if (!fileTreeData || Object.keys(fileTreeData).length === 0) {
    tree.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px;">You have not opened or specified a folder.<br><br>Open Folder</div>';
    return;
  }
  const renderFolder = (name, children, depth) => {
    const div = document.createElement('div');
    const folderHeader = document.createElement('div');
    folderHeader.className = 'tree-item folder-item';
    folderHeader.style.paddingLeft = (8 + depth * 12) + 'px';
    folderHeader.innerHTML = `
      <span class="chevron expanded"><i class="fas fa-chevron-right"></i></span>
      <span class="icon"><i class="fas fa-folder-open"></i></span>
      <span class="name">${escapeHtml(name)}</span>
    `;
    div.appendChild(folderHeader);
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    const keys = Object.keys(children).sort((a, b) => {
      const aD = children[a].type === 'dir';
      const bD = children[b].type === 'dir';
      if (aD && !bD) return -1;
      if (!aD && bD) return 1;
      return a.localeCompare(b);
    });
    keys.forEach(childName => {
      const child = children[childName];
      if (child.type === 'dir') childrenDiv.appendChild(renderFolder(childName, child.children, depth + 1));
      else childrenDiv.appendChild(renderFile(child, depth + 1));
    });
    div.appendChild(childrenDiv);
    folderHeader.addEventListener('click', () => {
      const chevron = folderHeader.querySelector('.chevron');
      const icon = folderHeader.querySelector('.icon i');
      const isCollapsed = chevron.classList.toggle('expanded');
      // toggle('expanded') returns true if added (now expanded). We want to toggle to the OPPOSITE.
      if (chevron.classList.contains('expanded')) {
        childrenDiv.style.display = '';
        icon.className = 'fas fa-folder-open';
      } else {
        childrenDiv.style.display = 'none';
        icon.className = 'fas fa-folder';
      }
    });
    return div;
  };
  const renderFile = (child, depth) => {
    const fileItem = document.createElement('div');
    fileItem.className = 'tree-item file-item';
    fileItem.style.paddingLeft = (8 + depth * 12) + 'px';
    fileItem.dataset.path = child.path;
    if (child.path === activeTab) fileItem.classList.add('active');
    fileItem.innerHTML = `
      <span class="chevron" style="visibility:hidden;"><i class="fas fa-chevron-right"></i></span>
      <span class="icon">${getFileIcon(child.name, false)}</span>
      <span class="name">${escapeHtml(child.name)}</span>
    `;
    fileItem.addEventListener('click', (e) => { e.stopPropagation(); openFile(child.path, child.name); });
    fileItem.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { icon: 'fas fa-external-link-alt', label: 'Open', action: () => openFile(child.path, child.name) },
        { icon: 'fas fa-pen', label: 'Rename', action: () => renameItem(child.path) },
        { icon: 'fas fa-trash', label: 'Delete', action: () => deleteItem(child.path) },
        { sep: true },
        { icon: 'fas fa-copy', label: 'Copy Path', action: () => { navigator.clipboard.writeText(child.path); toast('Path copied', 'success', null, 1500); } },
        { icon: 'fas fa-folder-open', label: 'Reveal', action: () => window.electronAPI?.openInExplorer?.(child.path) },
      ]);
    });
    return fileItem;
  };
  Object.keys(fileTreeData).sort().forEach(name => {
    const item = fileTreeData[name];
    if (item.type === 'dir') tree.appendChild(renderFolder(name, item.children || {}, 0));
    else tree.appendChild(renderFile(item, 0));
  });
}

function openFile(filePath, fileName) {
  if (!filePath) return;
  if (window.electronAPI?.readFile) {
    window.electronAPI.readFile(filePath).then(resp => {
      if (!resp.success) { toast('Cannot open file: ' + (resp.error || ''), 'error'); return; }
      document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
      const treeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(filePath)}"]`);
      if (treeItem) treeItem.classList.add('active');
      $('#welcome-screen')?.remove();
      const doOpen = () => {
        createTab(filePath, fileName);
        const ed = editors.get(filePath);
        if (ed && resp.content !== undefined) {
          ed.setValue(resp.content);
          const lang = getLangForFileFixed(fileName || filePath);
          monaco.editor.setModelLanguage(ed.getModel(), lang);
        }
        addRecentFile(filePath);
        try { localStorage.setItem('savia.lastFile', filePath); } catch(e) {}
        updateStatusBar();
      };
      if (window.monaco && monacoBooted) doOpen();
      else ensureMonacoLoaded(doOpen);
    });
  }
}

function openSingleFile() {
  if (!window.electronAPI?.openFileDialog) { toast('Requires Electron', 'warning'); return; }
  window.electronAPI.openFileDialog().then(res => {
    if (res?.success && res.path) {
      const fp = res.path;
      openFile(fp, basename(fp));
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// MONACO EDITOR MANAGEMENT
// ═══════════════════════════════════════════════════════════════════
function openEditorForFile(filePath) {
  if (editors.has(filePath)) { setActiveTab(filePath); return; }
  const container = document.createElement('div');
  container.className = 'monaco-host';
  container.id = 'monaco-' + filePath.replace(/[^a-zA-Z0-9]/g, '_');
  container.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';
  $('#editor-container').appendChild(container);

  const ed = monaco.editor.create(container, {
    value: '// Loading ' + basename(filePath) + '...',
    language: 'plaintext',
    theme: editorSettings.theme,
    automaticLayout: true,
    fontSize: editorSettings.fontSize,
    fontFamily: editorSettings.fontFamily,
    fontLigatures: true,
    minimap: { enabled: editorSettings.minimap, scale: 1, renderCharacters: false },
    scrollBeyondLastLine: editorSettings.scrollBeyondLastLine,
    smoothScrolling: editorSettings.smoothScrolling,
    cursorBlinking: editorSettings.cursorBlinking,
    cursorSmoothCaretAnimation: 'on',
    padding: { top: 8, bottom: 8 },
    renderWhitespace: editorSettings.renderWhitespace,
    bracketPairColorization: { enabled: editorSettings.bracketPairColorization },
    guides: editorSettings.guides,
    renderLineHighlight: editorSettings.renderLineHighlight,
    stickyScroll: { enabled: editorSettings.stickyScroll },
    autoIndent: 'full',
    formatOnPaste: editorSettings.formatOnPaste,
    lineNumbers: editorSettings.lineNumbers ? 'on' : 'off',
    glyphMargin: true,
    folding: true,
    foldingStrategy: 'indentation',
    lineDecorationsWidth: 10,
    lineNumbersMinChars: 3,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    contextmenu: true,
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    parameterHints: { enabled: true },
    tabSize: editorSettings.tabSize,
    wordWrap: editorSettings.wordWrap,
    wrappingStrategy: 'advanced',
    multiCursorModifier: 'alt',
    snippetSuggestions: 'inline',
    suggestSelection: 'first',
    occurrencesHighlight: 'singleFile',
    selectionHighlight: true,
    codeLens: true,
    lightbulb: { enabled: true },
    'semanticHighlighting.enabled': true,
  });

  ed.getModel().onDidChangeContent(() => {
    if (!unsavedFiles.has(filePath)) {
      unsavedFiles.add(filePath);
      updateTabIndicator(filePath);
      renderTabs();
      renderOpenEditors();
    }
    if (autoSaveEnabled) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => { if (unsavedFiles.has(filePath)) saveCurrentFile(); }, 1500);
    }
    refreshProblems();
  });

  ed.onDidChangeCursorPosition((e) => {
    if (ed === activeEditor) {
      $('#status-cursor').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
      updateBreadcrumb();
    }
  });

  ed.onDidChangeModelLanguage((e) => {
    if (ed === activeEditor) updateStatusBar();
  });

  // Diagnostics (problems)
  monaco.editor.onDidChangeMarkers(() => {
    refreshProblems();
  });

  // Multi-cursor: Alt+Click is built-in via multiCursorModifier: 'alt'
  // Add command: Ctrl+D (add selection to next find match)
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
    ed.action('editor.action.addSelectionToNextFindMatch');
  });
  // Ctrl+Shift+L: select all occurrences
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL, () => {
    ed.action('editor.action.selectHighlights');
  });
  // Shift+Alt+Up/Down: duplicate line
  ed.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
    ed.action('editor.action.copyLinesUpAction');
  });
  ed.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
    ed.action('editor.action.copyLinesDownAction');
  });
  // Alt+Up/Down: move line
  ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
    ed.action('editor.action.moveLinesUpAction');
  });
  ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
    ed.action('editor.action.moveLinesDownAction');
  });
  // Ctrl+/: toggle comment
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash, () => {
    ed.action('editor.action.commentLine');
  });
  // Shift+Alt+F: format
  ed.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
    formatDocument();
  });
  // Ctrl+G: go to line
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
    showGoToLine();
  });
  // Ctrl+Shift+O: go to symbol
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, () => {
    showGoToSymbol();
  });
  // Ctrl+Shift+P, F1: command palette handled globally
  // Alt+Click handled by multiCursorModifier

  editors.set(filePath, ed);
  setActiveTab(filePath);

  // Load file
  if (window.electronAPI?.readFile) {
    window.electronAPI.readFile(filePath).then(resp => {
      if (resp.success) {
        ed.setValue(resp.content || '');
        const lang = getLangForFileFixed(basename(filePath));
        monaco.editor.setModelLanguage(ed.getModel(), lang);
      } else {
        ed.setValue('// Failed to load: ' + (resp.error || 'unknown'));
      }
    });
  } else {
    fetch(filePath).then(r => r.text()).then(txt => {
      ed.setValue(txt);
      const lang = getLangForFileFixed(basename(filePath));
      monaco.editor.setModelLanguage(ed.getModel(), lang);
    }).catch(e => ed.setValue('// Could not load: ' + filePath));
  }
}

function updateTabIndicator(filePath) {
  const el = document.querySelector(`.tab-item[data-path="${CSS.escape(filePath)}"]`);
  if (el) el.classList.toggle('unsaved', unsavedFiles.has(filePath));
  const oe = document.querySelector(`.open-editor-item[data-path="${CSS.escape(filePath)}"]`);
  if (oe) oe.classList.toggle('dirty', unsavedFiles.has(filePath));
}

// ═══════════════════════════════════════════════════════════════════
// SAVE / SAVE AS / FORMAT
// ═══════════════════════════════════════════════════════════════════
async function saveCurrentFile() {
  if (!activeEditor || !activeFilePath) return;
  const content = activeEditor.getValue();
  setStatusText('Saving...');
  if (window.electronAPI?.writeFile) {
    const resp = await window.electronAPI.writeFile({ filePath: activeFilePath, content });
    if (resp.success) {
      unsavedFiles.delete(activeFilePath);
      updateTabIndicator(activeFilePath);
      renderTabs();
      renderOpenEditors();
      updateStatusBar();
      addOutputLine('extension', `[Save] Saved: ${basename(activeFilePath)}`);
      if (editorSettings.formatOnSave) await formatDocument();
      toast('Saved ' + basename(activeFilePath), 'success', null, 2000);
    } else {
      toast('Save failed: ' + (resp.error || ''), 'error');
    }
  }
  setStatusText('Ready');
}

async function saveAs() {
  if (!activeEditor || !activeFilePath) { toast('No active file', 'warning'); return; }
  const newPath = prompt('Save as (full path):', activeFilePath);
  if (!newPath) return;
  const content = activeEditor.getValue();
  if (window.electronAPI?.writeFile) {
    const resp = await window.electronAPI.writeFile({ filePath: newPath, content });
    if (resp.success) {
      // Replace the tab
      const oldPath = activeFilePath;
      unsavedFiles.delete(oldPath);
      editors.delete(oldPath);
      const ed = activeEditor;
      const idx = openTabs.findIndex(t => t.path === oldPath);
      if (idx >= 0) openTabs.splice(idx, 1);
      ed.dispose();
      openTabs.push({ path: newPath, label: basename(newPath) });
      renderTabs();
      renderOpenEditors();
      openEditorForFile(newPath);
      toast('Saved as ' + basename(newPath), 'success');
    } else {
      toast('Save failed', 'error');
    }
  }
}

async function saveAll() {
  const dirty = [...unsavedFiles];
  for (const p of dirty) {
    const ed = editors.get(p);
    if (!ed) continue;
    if (window.electronAPI?.writeFile) {
      const resp = await window.electronAPI.writeFile({ filePath: p, content: ed.getValue() });
      if (resp.success) {
        unsavedFiles.delete(p);
        updateTabIndicator(p);
      }
    }
  }
  renderTabs();
  renderOpenEditors();
  toast(`Saved ${dirty.length} file(s)`, 'success');
}

async function formatDocument() {
  if (!activeEditor) return;
  try {
    await activeEditor.getAction('editor.action.formatDocument').run();
    toast('Formatted', 'success', null, 1500);
  } catch (e) {
    toast('No formatter available for this language', 'warning');
  }
}

function setStatusText(text) {
  // Could be a transient status; for now we don't have a status-text field, so use the first status item
  const first = $('#status-branch');
  if (first && text) { first.dataset.transient = '1'; first.textContent = text; setTimeout(() => { if (first.dataset.transient) { first.innerHTML = '<i class="fas fa-code-branch"></i> ' + (gitBranch || 'main'); first.dataset.transient = ''; } }, 2000); }
}

// ═══════════════════════════════════════════════════════════════════
// PROJECT / FOLDER IMPORT
// ═══════════════════════════════════════════════════════════════════
async function importFolder(folderPathArg) {
  let folderPath = folderPathArg;
  if (!folderPath) {
    if (!window.electronAPI?.selectDirectoryDialog) { toast('Folder picker requires Electron', 'warning'); return; }
    addSystemMessage('Opening folder picker...');
    const result = await window.electronAPI.selectDirectoryDialog();
    if (!result.success || !result.path) { addSystemMessage('Folder selection cancelled.'); return; }
    folderPath = result.path;
  }
  const folderName = basename(folderPath) || folderPath;
  addSystemMessage(`Scanning project: ${folderName}`);
  setStatusText('Loading project...');
  const dirResult = await window.electronAPI.listDirectory(folderPath);
  if (!dirResult.success) { toast('Failed to read folder: ' + (dirResult.error || ''), 'error'); return; }
  importedProjectRoot = folderPath;
  importedProjectName = folderName;
  fileTreeData = {};
  fileTreeData[folderName] = { type: 'dir', path: folderPath, children: buildRecursiveTree(folderPath, dirResult.items, 0) };
  currentRootDir = folderPath;
  renderFileTree();
  updateProjectHeader(folderName, folderPath);
  syncTerminalCwd(folderPath);
  addSystemMessage(`Project loaded: ${folderName}`);
  addSystemMessage(`Files: ${countFiles(fileTreeData[folderName].children)}`);
  addRecentProject(folderPath);
  setStatusText('Ready');
  toast('Opened ' + folderName, 'success');
  refreshGitPanel();
}

function buildRecursiveTree(basePath, items, depth) {
  const tree = {};
  const maxDepth = 8;
  if (depth >= maxDepth) return tree;
  items.forEach(item => {
    if (!item || !item.name) return;
    if (item.name.startsWith('.') && item.name !== '.gitignore' && item.name !== '.env') return;
    if (item.name === 'node_modules' || item.name === '.git' || item.name === 'dist' || item.name === 'build' || item.name === 'target' || item.name === 'out') return;
    if (item.name.endsWith('.log')) return;
    const rel = item.path.replace(basePath, '').replace(/^[\\\/]/, '');
    const parts = rel.split(/[\\\/]/).filter(Boolean);
    if (!parts.length) return;
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1 && !item.isDirectory) {
        const ext = getExt(p);
        current[p] = { type: 'file', path: item.path, name: p, ext, modified: false };
      } else if (!current[p]) {
        current[p] = { type: 'dir', path: item.path, children: {} };
      }
      if (current[p] && current[p].children) current = current[p].children;
    }
  });
  return tree;
}

function countFiles(obj) {
  let count = 0;
  Object.values(obj).forEach(item => {
    if (item.type === 'file') count++;
    else if (item.children) count += countFiles(item.children);
  });
  return count;
}

function updateProjectHeader(name, path) {
  const titleEl = document.querySelector('.title-text');
  if (titleEl) titleEl.textContent = 'S.A.V.I.A // ' + (name || 'IDE');
  const projectName = $('#project-name');
  if (projectName) projectName.textContent = (name || 'PROJECT').toUpperCase();
  const bcProj = $('#bc-project');
  if (bcProj) bcProj.innerHTML = '<i class="fas fa-folder"></i> ' + (name || 'no folder');
  const branchEl = $('#status-branch');
  if (branchEl && !branchEl.dataset.transient) branchEl.innerHTML = '<i class="fas fa-code-branch"></i> main';
}

function syncTerminalCwd(path) {
  if (!path || !window.electronAPI?.terminalSetCwd) return;
  window.electronAPI.terminalSetCwd(path).then(() => addSystemMessage(`Terminal CWD: ${path}`)).catch(() => {});
}

function refreshFileTree() {
  const root = importedProjectRoot || currentRootDir;
  if (!root) { toast('No project root', 'warning'); return; }
  if (!window.electronAPI?.listDirectory) return;
  window.electronAPI.listDirectory(root).then(res => {
    if (res.success) {
      if (importedProjectRoot && importedProjectName) {
        fileTreeData = {};
        fileTreeData[importedProjectName] = {
          type: 'dir', path: importedProjectRoot,
          children: buildRecursiveTree(importedProjectRoot, res.items, 0)
        };
      } else {
        buildFileTreeFromItems(res.items, res.path);
      }
      renderFileTree();
      refreshGitPanel();
    }
  }).catch(e => toast('Refresh failed: ' + e.message, 'error'));
}

function buildFileTreeFromItems(items, basePath) {
  const tempTree = {};
  items.forEach(item => {
    if (!item?.name) return;
    if (item.name.startsWith('.')) return;
    if (item.name === 'node_modules') return;
    const parts = item.path.replace(basePath, '').split(/[\\\/]/).filter(Boolean);
    let current = tempTree;
    parts.forEach((part, i) => {
      if (i === parts.length - 1 && !item.isDirectory) {
        const ext = getExt(part);
        current[part] = { type: 'file', path: item.path, name: part, ext, modified: false };
      } else if (!current[part]) {
        current[part] = { type: 'dir', path: item.path, children: {} };
      }
      if (current[part].children) current = current[part].children;
    });
  });
  fileTreeData = tempTree;
  currentRootDir = basePath;
  renderFileTree();
}

function collapseAllFolders() {
  $$('#file-tree .tree-children').forEach(c => { c.style.display = 'none'; });
  $$('#file-tree .chevron').forEach(c => c.classList.remove('expanded'));
  $$('#file-tree .folder-item .icon i').forEach(i => { i.className = 'fas fa-folder'; });
}

function createNewFile(folderPath, presetName) {
  const name = presetName || prompt('New file name (with extension):', 'untitled.txt');
  if (!name || !currentRootDir) return;
  const base = folderPath || currentRootDir;
  const full = joinPath(base, name);
  if (window.electronAPI?.writeFile) {
    window.electronAPI.writeFile({ filePath: full, content: '' }).then(res => {
      if (res.success) { refreshFileTree(); toast('Created ' + name, 'success'); setTimeout(() => openFile(full, name), 200); }
      else toast('Create failed: ' + (res.error || ''), 'error');
    });
  } else if (window.electronAPI?.terminalExecute) {
    window.electronAPI.terminalExecute(`touch "${full}"`).then(() => { refreshFileTree(); toast('Created ' + name, 'success'); });
  }
}

function createNewFolder() {
  const name = prompt('New folder name:', 'new-folder');
  if (!name || !currentRootDir) return;
  const full = joinPath(currentRootDir, name);
  if (window.electronAPI?.terminalExecute) {
    window.electronAPI.terminalExecute(`mkdir -p "${full}"`).then(() => { refreshFileTree(); toast('Created folder ' + name, 'success'); });
  } else if (window.electronAPI?.writeFile) {
    // fallback
    window.electronAPI.writeFile({ filePath: full + '/.gitkeep', content: '' }).then(() => refreshFileTree());
  }
}

function renameItem(oldPath) {
  const newName = prompt('New name:', basename(oldPath));
  if (!newName) return;
  if (window.electronAPI?.renameItem) {
    window.electronAPI.renameItem(oldPath, newName).then(res => {
      if (res.success) { refreshFileTree(); toast('Renamed', 'success'); }
      else toast('Rename failed: ' + (res.error || ''), 'error');
    });
  } else if (window.electronAPI?.terminalExecute) {
    const parent = oldPath.substring(0, oldPath.length - basename(oldPath).length);
    const newPath = joinPath(parent, newName);
    window.electronAPI.terminalExecute(`mv "${oldPath}" "${newPath}"`).then(() => { refreshFileTree(); toast('Renamed', 'success'); });
  }
}

function deleteItem(targetPath) {
  if (!confirm(`Delete "${basename(targetPath)}"?\n\nThis cannot be undone.`)) return;
  if (window.electronAPI?.deleteItem) {
    window.electronAPI.deleteItem(targetPath).then(res => {
      if (res.success) { refreshFileTree(); toast('Deleted', 'success'); }
      else toast('Delete failed: ' + (res.error || ''), 'error');
    });
  } else if (window.electronAPI?.terminalExecute) {
    window.electronAPI.terminalExecute(`rm -rf "${targetPath}"`).then(() => { refreshFileTree(); toast('Deleted', 'success'); });
  }
}

function promptCloneRepo() {
  const url = prompt('Git repository URL:');
  if (!url) return;
  if (window.electronAPI?.terminalExecute && currentRootDir) {
    window.electronAPI.terminalExecute(`git clone "${url}"`).then(() => { refreshFileTree(); toast('Clone started', 'info'); });
  } else {
    toast('Open a folder first to clone into', 'warning');
  }
}

// ── Recent files / projects ─────────────────────────────────────
function addRecentFile(p) {
  try {
    const list = JSON.parse(localStorage.getItem('savia.recentFiles') || '[]');
    const filtered = list.filter(x => x !== p);
    filtered.unshift(p);
    localStorage.setItem('savia.recentFiles', JSON.stringify(filtered.slice(0, 20)));
  } catch (e) {}
}
function addRecentProject(p) {
  try {
    const list = JSON.parse(localStorage.getItem('savia.recentProjects') || '[]');
    const filtered = list.filter(x => x !== p);
    filtered.unshift(p);
    localStorage.setItem('savia.recentProjects', JSON.stringify(filtered.slice(0, 20)));
  } catch (e) {}
}
function getRecentFiles() { try { return JSON.parse(localStorage.getItem('savia.recentFiles') || '[]'); } catch (e) { return []; } }
function getRecentProjects() { try { return JSON.parse(localStorage.getItem('savia.recentProjects') || '[]'); } catch (e) { return []; } }
function clearRecent(kind) {
  localStorage.removeItem(kind === 'files' ? 'savia.recentFiles' : 'savia.recentProjects');
}

// ═══════════════════════════════════════════════════════════════════
// BOTTOM PANEL — Terminal / Problems / Output / Debug
// ═══════════════════════════════════════════════════════════════════
function switchBottomTab(tab) {
  activeBottomTab = tab;
  $$('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.panel-body-section').forEach(s => s.classList.toggle('active', s.dataset.tabBody === tab));
  if (tab === 'terminal') setTimeout(() => $('#terminal-input')?.focus(), 50);
  if (tab === 'problems') refreshProblems();
  if (tab === 'output') renderOutput();
}

function toggleBottomPanel(force) {
  const p = $('#bottom-panel');
  if (typeof force === 'boolean') {
    p.classList.toggle('collapsed', !force);
    bottomPanelVisible = force;
  } else {
    p.classList.toggle('collapsed');
    bottomPanelVisible = !p.classList.contains('collapsed');
  }
  setTimeout(() => editors.forEach(ed => ed.layout()), 250);
}

// ── Terminal ───────────────────────────────────────────────────
function addTerminalLine(text, type = 'output') {
  const container = $('#terminal-container');
  if (!container) return;
  const line = document.createElement('div');
  line.className = 'term-line ' + type;
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function addSystemMessage(msg) {
  addTerminalLine('[SYS] ' + msg, 'system');
}

function addErrorMessage(msg) {
  addTerminalLine('[ERR] ' + msg, 'error');
}

function clearTerminal() {
  $('#terminal-container').innerHTML = '';
}

function executeCommand(cmd) {
  addTerminalLine(`$ ${cmd}`, 'command');
  const trimmed = cmd.trim();
  if (!trimmed) return;
  if (trimmed === 'clear' || trimmed === 'cls') { clearTerminal(); return; }
  if (trimmed === 'help') {
    addTerminalLine('Built-in commands:', 'info');
    addTerminalLine('  help         - This help', 'info');
    addTerminalLine('  clear/cls    - Clear terminal', 'info');
    addTerminalLine('  save         - Save current file', 'info');
    addTerminalLine('  saveall      - Save all dirty files', 'info');
    addTerminalLine('  files        - List open files', 'info');
    addTerminalLine('  close        - Close current tab', 'info');
    addTerminalLine('  closeall     - Close all tabs', 'info');
    addTerminalLine('  pwd          - Show current directory', 'info');
    addTerminalLine('  theme <name> - Change theme (vs-dark/vs/light)', 'info');
    addTerminalLine('  autosave     - Toggle autosave', 'info');
    addTerminalLine('  zen          - Toggle Zen mode', 'info');
    addTerminalLine('  problems     - List current problems', 'info');
    addTerminalLine('  open <path>  - Open file (relative to project)', 'info');
    addTerminalLine('  new <name>   - Create new file in project root', 'info');
    return;
  }
  if (trimmed === 'save') { saveCurrentFile(); return; }
  if (trimmed === 'saveall') { saveAll(); return; }
  if (trimmed === 'files') {
    openTabs.forEach(t => addTerminalLine(`  ${t.path}${unsavedFiles.has(t.path) ? ' *' : ''}`, 'output'));
    return;
  }
  if (trimmed === 'close' && activeTab) { closeTab(activeTab, {}); return; }
  if (trimmed === 'closeall') { closeAllTabs(); return; }
  if (trimmed === 'pwd') { addTerminalLine(currentRootDir || '~/', 'output'); return; }
  if (trimmed === 'autosave') { autoSaveEnabled = !autoSaveEnabled; editorSettings.autoSave = autoSaveEnabled; addSystemMessage('Auto-save: ' + (autoSaveEnabled ? 'ON' : 'OFF')); return; }
  if (trimmed === 'zen') { toggleZenMode(); return; }
  if (trimmed === 'problems') { switchBottomTab('problems'); refreshProblems(); return; }
  if (trimmed.startsWith('theme ')) {
    const name = trimmed.slice(6).trim();
    setTheme(name);
    return;
  }
  if (trimmed.startsWith('open ')) {
    const p = trimmed.slice(5).trim();
    if (currentRootDir) {
      const full = p.startsWith('/') || /[a-zA-Z]:[\\\/]/.test(p) ? p : joinPath(currentRootDir, p);
      openFile(full, basename(full));
    } else {
      openFile(p, basename(p));
    }
    return;
  }
  if (trimmed.startsWith('new ')) {
    const name = trimmed.slice(4).trim();
    if (currentRootDir) createNewFile(currentRootDir, name);
    return;
  }
  if (window.electronAPI?.terminalExecute) {
    window.electronAPI.terminalExecute(trimmed).then(res => {
      if (res && res.success && res.procId) {
        terminalProcIds.add(res.procId);
      } else if (res && res.error) {
        addErrorMessage(res.error);
      }
    }).catch(err => addErrorMessage(err.message));
  } else {
    addErrorMessage('Shell execution requires Electron environment');
  }
}

function addNewTerminal() {
  terminalCount++;
  const id = terminalCount;
  const tabsWrap = $('#terminal-tabs');
  if (!tabsWrap) return;
  const addBtn = tabsWrap.querySelector('.terminal-tab-add');
  const newTab = document.createElement('div');
  newTab.className = 'terminal-tab';
  newTab.dataset.term = String(id);
  newTab.innerHTML = `<i class="fas fa-terminal"></i> shell ${id}<span class="term-close"><i class="fas fa-times"></i></span>`;
  tabsWrap.insertBefore(newTab, addBtn);
  $$('.terminal-tab').forEach(t => t.classList.remove('active'));
  newTab.classList.add('active');
  clearTerminal();
  addSystemMessage(`Terminal ${id} ready`);
  bindTerminalTabEvents();
}

function bindTerminalTabEvents() {
  $$('.terminal-tab').forEach(t => {
    t.onclick = (e) => {
      if (e.target.closest('.term-close')) {
        const all = $$('.terminal-tab');
        if (all.length <= 1) { addSystemMessage('Cannot close last terminal'); return; }
        t.remove();
        if (t.classList.contains('active')) {
          const first = $$('.terminal-tab')[0];
          if (first) { first.classList.add('active'); addSystemMessage('Switched to ' + first.dataset.term); }
        }
        return;
      }
      $$('.terminal-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
    };
  });
}

function wireTerminalTabEvents() {
  const tabsWrap = $('#terminal-tabs');
  if (!tabsWrap) return;
  tabsWrap.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const tab = e.target.closest('.terminal-tab');
    if (!tab || tab.classList.contains('terminal-tab-add')) return;
    e.preventDefault();
    const all = $$('.terminal-tab');
    if (all.length <= 1) { addSystemMessage('Cannot close last terminal'); return; }
    tab.remove();
    if (tab.classList.contains('active')) {
      const remaining = $$('.terminal-tab');
      if (remaining[0]) { remaining[0].classList.add('active'); addSystemMessage('Switched to ' + remaining[0].dataset.term); }
    }
  });
  tabsWrap.addEventListener('click', (e) => {
    const close = e.target.closest('.term-close');
    if (!close) return;
    const tab = close.closest('.terminal-tab');
    if (!tab || tab.classList.contains('terminal-tab-add')) return;
    e.stopPropagation();
    e.preventDefault();
    const all = $$('.terminal-tab');
    if (all.length <= 1) { addSystemMessage('Cannot close last terminal'); return; }
    tab.remove();
    if (tab.classList.contains('active')) {
      const remaining = $$('.terminal-tab');
      if (remaining[0]) { remaining[0].classList.add('active'); addSystemMessage('Switched to ' + remaining[0].dataset.term); }
    }
  });
  if (document.getElementById('terminal-input')) {
    document.getElementById('terminal-input').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault(); addNewTerminal(); return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'w' && activeBottomTab === 'terminal') {
        e.preventDefault();
        const active = $('.terminal-tab.active');
        if (active && !active.classList.contains('terminal-tab-add')) {
          const all = $$('.terminal-tab');
          if (all.length <= 1) { addSystemMessage('Cannot close last terminal'); return; }
          active.remove();
          if (active.classList.contains('active')) {
            const remaining = $$('.terminal-tab');
            if (remaining[0]) { remaining[0].classList.add('active'); addSystemMessage('Switched to ' + remaining[0].dataset.term); }
          }
        }
      }
    });
  }
}

// ── Output Panel ─────────────────────────────────────────────
function addOutputLine(channel, text) {
  outputLines.push({ channel, text, time: Date.now() });
  if (outputLines.length > 1000) outputLines.shift();
  if (activeBottomTab === 'output') renderOutput();
}

function renderOutput() {
  const ch = $('#output-channel-select')?.value || 'extension';
  const target = $('#output-content');
  if (!target) return;
  const lines = outputLines.filter(l => l.channel === ch);
  if (!lines.length) {
    target.innerHTML = `<div class="output-line" style="color: var(--text-muted);">No output for channel "${ch}".</div>`;
    return;
  }
  target.innerHTML = lines.map(l => `<div class="output-line">${escapeHtml(l.text)}</div>`).join('');
  target.scrollTop = target.scrollHeight;
}

// ── Problems Panel ───────────────────────────────────────────
function refreshProblems() {
  if (!window.monaco) return;
  const list = $('#problems-list');
  if (!list) return;
  const all = [];
  editors.forEach((ed, path) => {
    const model = ed.getModel();
    if (!model) return;
    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    markers.forEach(m => {
      all.push({
        severity: m.severity,
        message: m.message,
        source: m.source || 'monaco',
        path,
        startLineNumber: m.startLineNumber,
        startColumn: m.startColumn,
        endLineNumber: m.endLineNumber,
        endColumn: m.endColumn,
      });
    });
  });
  problems = all;
  if (!all.length) {
    list.innerHTML = '<div class="problem-empty">No problems have been detected in the workspace.</div>';
  } else {
    list.innerHTML = all.map(p => {
      const sev = p.severity === 8 ? 'error' : p.severity === 4 ? 'warning' : 'info';
      const sevIcon = p.severity === 8 ? 'fa-times' : p.severity === 4 ? 'fa-exclamation' : 'fa-info';
      return `<div class="problem-item ${sev}" data-path="${escapeHtml(p.path)}" data-line="${p.startLineNumber}" data-col="${p.startColumn}">
        <span class="sev"><i class="fas ${sevIcon}"></i></span>
        <span class="msg">${escapeHtml(p.message)}</span>
        <span class="file">${escapeHtml(basename(p.path))}:${p.startLineNumber}</span>
      </div>`;
    }).join('');
    $$('#problems-list .problem-item').forEach(el => {
      el.addEventListener('click', () => {
        const p = el.dataset.path;
        const ln = parseInt(el.dataset.line);
        const col = parseInt(el.dataset.col);
        if (openTabs.find(t => t.path === p)) setActiveTab(p);
        else openFile(p, basename(p));
        setTimeout(() => {
          const ed = editors.get(p);
          if (ed) {
            ed.revealLineInCenter(ln);
            ed.setPosition({ lineNumber: ln, column: col });
            ed.focus();
          }
        }, 100);
      });
    });
  }
  // Update badge
  const errs = all.filter(p => p.severity === 8).length;
  const warns = all.filter(p => p.severity === 4).length;
  const badge = $('#problems-count');
  if (badge) {
    badge.textContent = all.length;
    const tab = $$('.panel-tab').find(t => t.dataset.tab === 'problems');
    if (tab) {
      tab.classList.toggle('has-error', errs > 0);
      tab.classList.toggle('has-warn', warns > 0 && errs === 0);
    }
  }
  const statusErr = $('#status-errors');
  const statusWarn = $('#status-warnings');
  if (statusErr) { statusErr.innerHTML = `<i class="fas fa-times-circle"></i> ${errs}`; statusErr.classList.toggle('error', errs > 0); }
  if (statusWarn) { statusWarn.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${warns}`; statusWarn.classList.toggle('warning', warns > 0); }
}

// ═══════════════════════════════════════════════════════════════════
// OUTLINE (Document symbols via Monaco)
// ═══════════════════════════════════════════════════════════════════
let outlineCache = null;
let outlineCacheFile = null;

function refreshOutline() {
  const tree = $('#outline-tree');
  if (!tree) return;
  if (!activeEditor || !activeFilePath) {
    tree.innerHTML = '<div class="outline-empty">No symbol information for the active file</div>';
    return;
  }
  if (outlineCacheFile === activeFilePath && outlineCache) {
    renderOutline(outlineCache);
    return;
  }
  const model = activeEditor.getModel();
  if (!model) return;
  monaco.languages.getDocumentSymbols(model.uri.toString()).then(symbols => {
    outlineCache = symbols || [];
    outlineCacheFile = activeFilePath;
    renderOutline(outlineCache);
  }).catch(() => {
    tree.innerHTML = '<div class="outline-empty">Outline not available for this language</div>';
  });
}

function renderOutline(symbols) {
  const tree = $('#outline-tree');
  if (!tree) return;
  if (!symbols || !symbols.length) {
    tree.innerHTML = '<div class="outline-empty">No symbols found</div>';
    return;
  }
  const render = (sym, depth) => {
    let html = '';
    if (sym.range) {
      const icon = sym.kind === 11 || sym.kind === 10 ? 'fa-cube' : sym.kind === 5 || sym.kind === 4 ? 'fa-cog' : sym.kind === 12 || sym.kind === 13 ? 'fa-function' : 'fa-code';
      const kindName = ['file','module','namespace','package','class','method','property','field','constructor','enum','interface','function','variable','constant','string','number','boolean','array','object','key','null','enum-member','struct','event','operator','type-parameter'][sym.kind] || 'symbol';
      html += `<div class="outline-item" data-line="${sym.range.startLineNumber}">
        <span class="icon"><i class="fas ${icon}"></i></span>
        <span class="name">${escapeHtml(sym.name)}</span>
        <span class="range">${kindName}</span>
      </div>`;
    }
    if (sym.children && sym.children.length) {
      sym.children.forEach(c => { html += render(c, depth + 1); });
    }
    return html;
  };
  tree.innerHTML = symbols.map(s => render(s, 0)).join('');
  $$('#outline-tree .outline-item').forEach(el => {
    el.addEventListener('click', () => {
      const ln = parseInt(el.dataset.line);
      if (activeEditor) {
        activeEditor.revealLineInCenter(ln);
        activeEditor.setPosition({ lineNumber: ln, column: 1 });
        activeEditor.focus();
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH PANEL
// ═══════════════════════════════════════════════════════════════════
let searchOptions = { matchCase: false, wholeWord: false, regex: false, preserveCase: false };

function runProjectSearch() {
  const query = $('#search-input')?.value || '';
  const results = $('#search-results');
  if (!results) return;
  if (!query) { results.innerHTML = '<div class="problem-empty">Type to search across files</div>'; return; }
  if (!currentRootDir) { results.innerHTML = '<div class="problem-empty">Open a folder to search</div>'; return; }
  results.innerHTML = '<div class="problem-empty"><span class="spinner"></span> Searching...</div>';
  // Use a simple synchronous search via file reads
  const files = collectAllFiles(fileTreeData);
  if (!files.length) { results.innerHTML = '<div class="problem-empty">No files in project</div>'; return; }
  let re;
  try {
    re = searchOptions.regex
      ? new RegExp(query, searchOptions.matchCase ? 'g' : 'gi')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), searchOptions.matchCase ? 'g' : 'gi');
  } catch (e) {
    results.innerHTML = `<div class="problem-empty">Invalid regex: ${escapeHtml(e.message)}</div>`;
    return;
  }
  const promises = files.slice(0, 500).map(f =>
    window.electronAPI?.readFile ? window.electronAPI.readFile(f.path).then(r => ({ f, r })) : Promise.resolve({ f, r: { success: false } })
  );
  Promise.all(promises).then(all => {
    const matches = [];
    all.forEach(({ f, r }) => {
      if (!r.success || !r.content) return;
      const lines = r.content.split('\n');
      lines.forEach((ln, i) => {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(ln)) !== null) {
          if (searchOptions.wholeWord) {
            const before = ln[m.index - 1] || '';
            const after = ln[m.index + m[0].length] || '';
            if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
          }
          matches.push({ file: f, line: i + 1, col: m.index + 1, text: ln, match: m[0] });
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      });
    });
    lastSearchResults = matches;
    if (!matches.length) { results.innerHTML = '<div class="problem-empty">No results found</div>'; return; }
    const byFile = {};
    matches.forEach(m => { (byFile[m.file.path] = byFile[m.file.path] || { file: m.file, items: [] }).items.push(m); });
    results.innerHTML = Object.values(byFile).map(g => `
      <div class="search-file-group">
        <div class="search-file-header" data-path="${escapeHtml(g.file.path)}">
          <span class="icon"><i class="fas fa-chevron-right"></i></span>
          ${getFileIcon(g.file.name, false)}
          <span>${escapeHtml(g.file.name)}</span>
          <span class="count">${g.items.length}</span>
        </div>
        ${g.items.map(m => {
          const before = m.text.slice(0, m.col - 1);
          const matchTxt = m.text.slice(m.col - 1, m.col - 1 + m.match.length);
          const after = m.text.slice(m.col - 1 + m.match.length);
          return `<div class="search-match" data-path="${escapeHtml(g.file.path)}" data-line="${m.line}" data-col="${m.col}">
            <span class="ln">${m.line}:</span>
            <span class="text">${escapeHtml(before)}<span class="hl">${escapeHtml(matchTxt)}</span>${escapeHtml(after)}</span>
          </div>`;
        }).join('')}
      </div>
    `).join('');
    $$('#search-results .search-file-header').forEach(el => {
      el.addEventListener('click', () => {
        const group = el.closest('.search-file-group');
        const items = group.querySelectorAll('.search-match');
        const collapsed = items[0]?.style.display === 'none';
        items.forEach(i => i.style.display = collapsed ? '' : 'none');
        el.querySelector('.icon i').className = collapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-down';
      });
    });
    $$('#search-results .search-match').forEach(el => {
      el.addEventListener('click', () => {
        const p = el.dataset.path, ln = parseInt(el.dataset.line);
        if (openTabs.find(t => t.path === p)) setActiveTab(p);
        else openFile(p, basename(p));
        setTimeout(() => {
          const ed = editors.get(p);
          if (ed) { ed.revealLineInCenter(ln); ed.setPosition({ lineNumber: ln, column: parseInt(el.dataset.col) }); ed.focus(); }
        }, 200);
      });
    });
  });
}

function collectAllFiles(obj, out = []) {
  Object.values(obj).forEach(item => {
    if (item.type === 'file') out.push(item);
    else if (item.children) collectAllFiles(item.children, out);
  });
  return out;
}

function replaceAllInProject() {
  const query = $('#search-input')?.value || '';
  const replacement = $('#replace-input')?.value || '';
  if (!query) { toast('Enter search text first', 'warning'); return; }
  if (!confirm(`Replace all occurrences of "${query}" with "${replacement}" across project?`)) return;
  const files = collectAllFiles(fileTreeData);
  if (!files.length) return;
  let re;
  try {
    re = searchOptions.regex
      ? new RegExp(query, searchOptions.matchCase ? 'g' : 'gi')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), searchOptions.matchCase ? 'g' : 'gi');
  } catch (e) { toast('Invalid regex', 'error'); return; }
  let count = 0;
  const promises = files.map(f =>
    window.electronAPI?.readFile ? window.electronAPI.readFile(f.path).then(r => ({ f, r })) : Promise.resolve({ f, r: null })
  );
  Promise.all(promises).then(all => {
    all.forEach(({ f, r }) => {
      if (!r?.success || !r.content) return;
      const before = r.content;
      const after = before.replace(re, replacement);
      if (before !== after) {
        const occurrences = (before.match(re) || []).length;
        count += occurrences;
        window.electronAPI.writeFile({ filePath: f.path, content: after });
        const ed = editors.get(f.path);
        if (ed) ed.setValue(after);
      }
    });
    toast(`Replaced ${count} occurrence(s)`, 'success');
    setTimeout(runProjectSearch, 200);
  });
}

// ═══════════════════════════════════════════════════════════════════
// EXTENSIONS PANEL (mock + add suggestion to add real ones)
// ═══════════════════════════════════════════════════════════════════
const BUILTIN_EXTENSIONS = [
  { id: 'savia.theme-cyberpunk', name: 'Cyberpunk Theme', desc: 'Neon-on-dark color theme for S.A.V.I.A. IDE', installed: true, icon: 'fas fa-palette' },
  { id: 'savia.theme-light', name: 'S.A.V.I.A. Light', desc: 'Light theme variant', installed: false, icon: 'fas fa-sun' },
  { id: 'savia.markdown-preview', name: 'Enhanced Markdown', desc: 'Live preview and shortcuts for Markdown files', installed: true, icon: 'fab fa-markdown' },
  { id: 'savia.python-tools', name: 'Python Tools', desc: 'Linting and formatting for Python', installed: false, icon: 'fab fa-python' },
  { id: 'savia.docker', name: 'Docker', desc: 'Dockerfile and docker-compose language support', installed: true, icon: 'fab fa-docker' },
  { id: 'savia.indent-rainbow', name: 'Indent Rainbow', desc: 'Colorizes indentation levels for readability', installed: false, icon: 'fas fa-indent' },
  { id: 'savia.ai-copilot', name: 'AI Copilot', desc: 'Inline code completions powered by Ollama', installed: false, icon: 'fas fa-robot' },
  { id: 'savia.git-graph', name: 'Git Graph', desc: 'Visualize git history as a graph', installed: false, icon: 'fas fa-project-diagram' },
  { id: 'savia.live-server', name: 'Live Server', desc: 'Launch a local dev server with hot reload', installed: false, icon: 'fas fa-server' },
  { id: 'savia.snippets', name: 'Code Snippets', desc: 'Collection of useful code snippets', installed: true, icon: 'fas fa-puzzle-piece' },
];

function renderExtensions(filter) {
  const tree = $('#extensions-tree');
  if (!tree) return;
  const list = BUILTIN_EXTENSIONS.filter(e => !filter || e.name.toLowerCase().includes(filter.toLowerCase()) || e.desc.toLowerCase().includes(filter.toLowerCase()));
  if (!list.length) { tree.innerHTML = '<div class="git-empty">No extensions match "' + escapeHtml(filter) + '"</div>'; return; }
  tree.innerHTML = list.map(e => `
    <div class="ext-item">
      <div class="ext-icon"><i class="${e.icon}"></i></div>
      <div class="ext-info">
        <div class="ext-name">${escapeHtml(e.name)}</div>
        <div class="ext-desc">${escapeHtml(e.desc)}</div>
      </div>
      <div class="ext-actions">
        <button class="ext-btn ${e.installed ? 'installed' : ''}" data-id="${e.id}">${e.installed ? 'Installed' : 'Install'}</button>
      </div>
    </div>
  `).join('');
  $$('#extensions-tree .ext-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const ext = BUILTIN_EXTENSIONS.find(x => x.id === id);
      if (ext.installed) { toast('Already installed', 'info', null, 1500); return; }
      btn.textContent = 'Installing...';
      btn.disabled = true;
      setTimeout(() => {
        ext.installed = true;
        renderExtensions($('#ext-search')?.value || '');
        toast('Installed ' + ext.name, 'success');
      }, 600);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// ACTIVITY BAR / SIDEBAR SWITCHING
// ═══════════════════════════════════════════════════════════════════
function switchActivity(panel) {
  if (panel === 'settings') { openSettings(); return; }
  if (panel === 'terminal-btn') { toggleBottomPanel(true); switchBottomTab('terminal'); return; }
  const icon = $(`.activity-icon[data-panel="${panel}"]`);
  if (!icon) return;
  if (activePanel === panel) {
    toggleSidebar();
    return;
  }
  activePanel = panel;
  $$('.activity-icon').forEach(el => el.classList.toggle('active', el.dataset.panel === panel));
  $$('.sidebar-panel').forEach(p => p.classList.toggle('active', p.dataset.panelId === panel));
  if (!sidebarVisible) {
    sidebarVisible = true;
    $('#sidebar').classList.remove('collapsed');
    setTimeout(() => editors.forEach(ed => ed.layout()), 220);
  }
  if (panel === 'outline') refreshOutline();
  if (panel === 'search') setTimeout(() => $('#search-input')?.focus(), 100);
  if (panel === 'extensions' && !$$('#extensions-tree .ext-item').length) renderExtensions('');
}

function toggleSidebar(force) {
  const sb = $('#sidebar');
  if (typeof force === 'boolean') { sb.classList.toggle('collapsed', !force); sidebarVisible = force; }
  else { sb.classList.toggle('collapsed'); sidebarVisible = !sb.classList.contains('collapsed'); }
  setTimeout(() => editors.forEach(ed => ed.layout()), 220);
}

// ═══════════════════════════════════════════════════════════════════
// FIND / REPLACE BAR
// ═══════════════════════════════════════════════════════════════════
let findOpts = { matchCase: false, wholeWord: false, regex: false };

function openFind() {
  const bar = $('#find-bar');
  bar.classList.add('visible');
  const input = $('#find-input');
  if (activeEditor) {
    const sel = activeEditor.getSelection();
    if (sel && !sel.isEmpty()) {
      const t = activeEditor.getModel().getValueInRange(sel);
      if (t && t.length < 200 && !/\n/.test(t)) input.value = t;
    }
  }
  input.focus();
  input.select();
  setTimeout(() => performFind(true), 50);
}

function closeFind() {
  $('#find-bar').classList.remove('visible');
  findState = null;
  if (activeEditor) activeEditor.focus();
}

function performFind(forward = true) {
  const query = $('#find-input')?.value || '';
  if (!query || !activeEditor) { $('#find-info').textContent = 'No results'; return; }
  const model = activeEditor.getModel();
  let matches;
  try {
    matches = model.findMatches(query, false, findOpts.regex, findOpts.matchCase, findOpts.wholeWord ? '\\b' + query + '\\b' : null, true);
  } catch (e) {
    $('#find-info').textContent = 'Invalid regex';
    return;
  }
  if (!matches.length) { $('#find-info').textContent = 'No results'; return; }
  $('#find-info').textContent = `${matches.length} result${matches.length !== 1 ? 's' : ''}`;
  if (!findState || findState.query !== query + JSON.stringify(findOpts)) {
    findState = { query: query + JSON.stringify(findOpts), index: forward ? 0 : matches.length - 1, matches };
  } else {
    findState.index += forward ? 1 : -1;
    if (findState.index >= matches.length) findState.index = 0;
    if (findState.index < 0) findState.index = matches.length - 1;
  }
  const m = matches[findState.index];
  activeEditor.setSelection(m.range);
  activeEditor.revealRangeInCenter(m.range);
  activeEditor.focus();
}

function findReplace() {
  if (!activeEditor) return;
  const query = $('#find-input')?.value || '';
  const replacement = $('#replace-input-2')?.value || '';
  if (!query) return;
  const sel = activeEditor.getSelection();
  const model = activeEditor.getModel();
  const selText = model.getValueInRange(sel);
  const matches = selText === query;
  if (matches) {
    const preserveCase = searchOptions.preserveCase && /^([A-Z][a-z]*)+$/.test(query);
    let rep = replacement;
    if (preserveCase) {
      if (query === query.toUpperCase()) rep = replacement.toUpperCase();
      else if (query[0] === query[0].toUpperCase()) rep = replacement[0].toUpperCase() + replacement.slice(1);
    }
    activeEditor.executeEdits('find-replace', [{ range: sel, text: rep, forceMoveMarkers: true }]);
  }
  performFind(true);
}

function findReplaceAll() {
  if (!activeEditor) return;
  const query = $('#find-input')?.value || '';
  const replacement = $('#replace-input-2')?.value || '';
  if (!query) return;
  const model = activeEditor.getModel();
  const matches = model.findMatches(query, false, findOpts.regex, findOpts.matchCase, findOpts.wholeWord ? '\\b' + query + '\\b' : null, true);
  if (!matches.length) { toast('No matches', 'info', null, 1500); return; }
  activeEditor.executeEdits('find-replace-all', matches.reverse().map(m => ({ range: m.range, text: replacement, forceMoveMarkers: true })));
  toast(`Replaced ${matches.length} occurrence(s)`, 'success');
  $('#find-info').textContent = `${matches.length} replaced`;
}

// ═══════════════════════════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════════════════════════
function updateStatusBar() {
  const langEl = $('#status-lang');
  if (!langEl) return;
  if (activeFilePath) {
    const lang = getLangForFileFixed(basename(activeFilePath));
    langEl.textContent = lang.toUpperCase();
    if (activeEditor) {
      const pos = activeEditor.getPosition();
      $('#status-cursor').textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
      const model = activeEditor.getModel();
      const tabSize = model.getOptions().tabSize;
      $('#status-indent').textContent = `Spaces: ${tabSize}`;
    }
    const eol = activeEditor?.getModel()?.getEOL() || '\n';
    $('#status-eol').textContent = eol === '\n' ? 'LF' : 'CRLF';
  } else {
    langEl.textContent = 'PLAIN TEXT';
    $('#status-cursor').textContent = 'Ln 1, Col 1';
  }
  // Update problems
  refreshProblems();
}

// ═══════════════════════════════════════════════════════════════════
// COMMAND PALETTE
// ═══════════════════════════════════════════════════════════════════
const COMMANDS = [
  { id: 'file.open', label: 'File: Open File...', shortcut: 'Ctrl+O', icon: 'fas fa-file', action: openSingleFile },
  { id: 'file.openFolder', label: 'File: Open Folder...', shortcut: 'Ctrl+K Ctrl+O', icon: 'fas fa-folder-open', action: importFolder },
  { id: 'file.new', label: 'File: New File', shortcut: 'Ctrl+N', icon: 'fas fa-plus', action: createNewFile },
  { id: 'file.save', label: 'File: Save', shortcut: 'Ctrl+S', icon: 'fas fa-save', action: saveCurrentFile },
  { id: 'file.saveAs', label: 'File: Save As...', shortcut: 'Ctrl+Shift+S', icon: 'fas fa-save', action: saveAs },
  { id: 'file.saveAll', label: 'File: Save All', shortcut: 'Ctrl+K Ctrl+S', icon: 'fas fa-save', action: saveAll },
  { id: 'file.close', label: 'File: Close Editor', shortcut: 'Ctrl+W', icon: 'fas fa-times', action: () => activeTab && closeTab(activeTab, {}) },
  { id: 'file.closeAll', label: 'File: Close All Editors', icon: 'fas fa-times-circle', action: closeAllTabs },
  { id: 'file.reveal', label: 'File: Reveal Active File in Explorer', shortcut: 'Ctrl+Shift+R', icon: 'fas fa-folder-open', action: () => activeFilePath && window.electronAPI?.openInExplorer?.(activeFilePath) },

  { id: 'edit.undo', label: 'Edit: Undo', shortcut: 'Ctrl+Z', icon: 'fas fa-undo', action: () => activeEditor?.trigger('keyboard', 'undo', null) },
  { id: 'edit.redo', label: 'Edit: Redo', shortcut: 'Ctrl+Y', icon: 'fas fa-redo', action: () => activeEditor?.trigger('keyboard', 'redo', null) },
  { id: 'edit.cut', label: 'Edit: Cut', shortcut: 'Ctrl+X', icon: 'fas fa-cut', action: () => activeEditor?.trigger('keyboard', 'editor.action.clipboardCutAction', null) },
  { id: 'edit.copy', label: 'Edit: Copy', shortcut: 'Ctrl+C', icon: 'fas fa-copy', action: () => activeEditor?.trigger('keyboard', 'editor.action.clipboardCopyAction', null) },
  { id: 'edit.paste', label: 'Edit: Paste', shortcut: 'Ctrl+V', icon: 'fas fa-paste', action: () => activeEditor?.trigger('keyboard', 'editor.action.clipboardPasteAction', null) },
  { id: 'edit.find', label: 'Edit: Find', shortcut: 'Ctrl+F', icon: 'fas fa-search', action: openFind },
  { id: 'edit.replace', label: 'Edit: Replace', shortcut: 'Ctrl+H', icon: 'fas fa-exchange-alt', action: openFind },
  { id: 'edit.format', label: 'Edit: Format Document', shortcut: 'Shift+Alt+F', icon: 'fas fa-indent', action: formatDocument },
  { id: 'edit.comment', label: 'Edit: Toggle Line Comment', shortcut: 'Ctrl+/', icon: 'fas fa-comment', action: () => activeEditor?.trigger('keyboard', 'editor.action.commentLine', null) },
  { id: 'edit.duplicate', label: 'Edit: Copy Line Down', shortcut: 'Shift+Alt+Down', icon: 'fas fa-clone', action: () => activeEditor?.trigger('keyboard', 'editor.action.copyLinesDownAction', null) },
  { id: 'edit.moveUp', label: 'Edit: Move Line Up', shortcut: 'Alt+Up', icon: 'fas fa-arrow-up', action: () => activeEditor?.trigger('keyboard', 'editor.action.moveLinesUpAction', null) },
  { id: 'edit.moveDown', label: 'Edit: Move Line Down', shortcut: 'Alt+Down', icon: 'fas fa-arrow-down', action: () => activeEditor?.trigger('keyboard', 'editor.action.moveLinesDownAction', null) },

  { id: 'sel.selectAll', label: 'Selection: Select All', shortcut: 'Ctrl+A', icon: 'fas fa-i-cursor', action: () => activeEditor?.trigger('keyboard', 'editor.action.selectAll', null) },
  { id: 'sel.addCursorAbove', label: 'Selection: Add Cursor Above', shortcut: 'Ctrl+Alt+Up', icon: 'fas fa-plus', action: () => activeEditor?.trigger('keyboard', 'editor.action.insertCursorAbove', null) },
  { id: 'sel.addCursorBelow', label: 'Selection: Add Cursor Below', shortcut: 'Ctrl+Alt+Down', icon: 'fas fa-plus', action: () => activeEditor?.trigger('keyboard', 'editor.action.insertCursorBelow', null) },
  { id: 'sel.addOccurrence', label: 'Selection: Add Next Occurrence', shortcut: 'Ctrl+D', icon: 'fas fa-plus', action: () => activeEditor?.trigger('keyboard', 'editor.action.addSelectionToNextFindMatch', null) },
  { id: 'sel.allOccurrences', label: 'Selection: Select All Occurrences', shortcut: 'Ctrl+Shift+L', icon: 'fas fa-mouse-pointer', action: () => activeEditor?.trigger('keyboard', 'editor.action.selectHighlights', null) },

  { id: 'view.explorer', label: 'View: Show Explorer', shortcut: 'Ctrl+Shift+E', icon: 'fas fa-copy', action: () => switchActivity('explorer') },
  { id: 'view.search', label: 'View: Show Search', shortcut: 'Ctrl+Shift+F', icon: 'fas fa-search', action: () => switchActivity('search') },
  { id: 'view.git', label: 'View: Show Source Control', shortcut: 'Ctrl+Shift+G', icon: 'fas fa-code-branch', action: () => switchActivity('git') },
  { id: 'view.debug', label: 'View: Show Run and Debug', shortcut: 'Ctrl+Shift+D', icon: 'fas fa-bug', action: () => switchActivity('debug') },
  { id: 'view.extensions', label: 'View: Show Extensions', shortcut: 'Ctrl+Shift+X', icon: 'fas fa-th-large', action: () => switchActivity('extensions') },
  { id: 'view.outline', label: 'View: Show Outline', icon: 'fas fa-list-ul', action: () => switchActivity('outline') },
  { id: 'view.terminal', label: 'View: Toggle Terminal', shortcut: 'Ctrl+`', icon: 'fas fa-terminal', action: () => toggleBottomPanel() },
  { id: 'view.problems', label: 'View: Toggle Problems Panel', shortcut: 'Ctrl+Shift+M', icon: 'fas fa-exclamation-triangle', action: () => { toggleBottomPanel(true); switchBottomTab('problems'); } },
  { id: 'view.output', label: 'View: Show Output', icon: 'fas fa-desktop', action: () => { toggleBottomPanel(true); switchBottomTab('output'); } },
  { id: 'view.toggleSidebar', label: 'View: Toggle Primary Side Bar', shortcut: 'Ctrl+B', icon: 'fas fa-columns', action: () => toggleSidebar() },
  { id: 'view.zen', label: 'View: Toggle Zen Mode', shortcut: 'Ctrl+K Z', icon: 'fas fa-expand', action: toggleZenMode },
  { id: 'view.wordwrap', label: 'View: Toggle Word Wrap', shortcut: 'Alt+Z', icon: 'fas fa-text-width', action: toggleWordWrap },

  { id: 'go.file', label: 'Go: Go to File...', shortcut: 'Ctrl+P', icon: 'fas fa-file', action: showQuickOpen },
  { id: 'go.symbol', label: 'Go: Go to Symbol in File...', shortcut: 'Ctrl+Shift+O', icon: 'fas fa-at', action: showGoToSymbol },
  { id: 'go.line', label: 'Go: Go to Line/Column...', shortcut: 'Ctrl+G', icon: 'fas fa-hashtag', action: showGoToLine },
  { id: 'go.def', label: 'Go: Go to Definition', shortcut: 'F12', icon: 'fas fa-external-link-alt', action: () => activeEditor?.trigger('keyboard', 'editor.action.revealDefinition', null) },
  { id: 'go.refs', label: 'Go: Show References', shortcut: 'Shift+F12', icon: 'fas fa-search', action: () => activeEditor?.trigger('keyboard', 'editor.action.referenceSearch.trigger', null) },
  { id: 'go.bracket', label: 'Go: Go to Matching Bracket', shortcut: 'Ctrl+Shift+\\', icon: 'fas fa-code', action: () => activeEditor?.trigger('keyboard', 'editor.action.jumpToBracket', null) },

  { id: 'run.run', label: 'Run: Run File', icon: 'fas fa-play', action: runActiveFile },
  { id: 'run.stop', label: 'Run: Stop', icon: 'fas fa-stop', action: () => toast('Stop not available', 'info') },

  { id: 'terminal.new', label: 'Terminal: Create New Terminal', shortcut: 'Ctrl+Shift+`', icon: 'fas fa-plus', action: addNewTerminal },
  { id: 'terminal.clear', label: 'Terminal: Clear', icon: 'fas fa-ban', action: clearTerminal },
  { id: 'terminal.kill', label: 'Terminal: Kill Current Terminal', icon: 'fas fa-skull', action: () => { $$('.terminal-tab.active .term-close').forEach(c => c.click()); } },

  { id: 'prefs.settings', label: 'Preferences: Open Settings', shortcut: 'Ctrl+,', icon: 'fas fa-cog', action: openSettings },
  { id: 'prefs.theme', label: 'Preferences: Color Theme', icon: 'fas fa-palette', action: cycleTheme },
  { id: 'prefs.autosave', label: 'Preferences: Toggle Auto Save', icon: 'fas fa-save', action: () => { autoSaveEnabled = !autoSaveEnabled; editorSettings.autoSave = autoSaveEnabled; toast('Auto Save: ' + (autoSaveEnabled ? 'ON' : 'OFF'), 'info'); } },

  { id: 'help.welcome', label: 'Help: Show Welcome', icon: 'fas fa-hand-sparkles', action: () => { activeTab = null; activeEditor = null; activeFilePath = null; $('#editor-container').innerHTML = ''; showWelcome(); } },
  { id: 'help.about', label: 'Help: About S.A.V.I.A. IDE', icon: 'fas fa-info-circle', action: () => toast('S.A.V.I.A. IDE v1.0', 'info', 'A complete editing experience') },
];

function openCommandPalette() {
  const overlay = $('#palette-overlay');
  const list = $('#palette-list');
  const input = $('#palette-input');
  overlay.classList.add('visible');
  input.value = '';
  renderPaletteList('');
  setTimeout(() => input.focus(), 50);
}
function closeCommandPalette() { $('#palette-overlay').classList.remove('visible'); }

function renderPaletteList(query) {
  const list = $('#palette-list');
  const q = (query || '').toLowerCase();
  const items = q
    ? COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
    : COMMANDS;
  if (!items.length) {
    list.innerHTML = '<div class="palette-empty">No commands found. Try a different search.</div>';
    return;
  }
  list.innerHTML = items.map((c, i) => `
    <div class="palette-item${i === 0 ? ' active' : ''}" data-id="${c.id}">
      <span class="pi-icon"><i class="${c.icon}"></i></span>
      <span class="pi-label">${escapeHtml(c.label)}</span>
      <span class="pi-shortcut">${escapeHtml(c.shortcut || '')}</span>
    </div>
  `).join('');
  $$('#palette-list .palette-item').forEach(el => {
    el.addEventListener('click', () => {
      const c = COMMANDS.find(x => x.id === el.dataset.id);
      if (c) { closeCommandPalette(); try { c.action(); } catch (e) { console.error(e); toast('Command failed: ' + e.message, 'error'); } }
    });
  });
  list.scrollTop = 0;
  paletteActiveIndex = 0;
}

let paletteActiveIndex = 0;
function paletteNavigate(dir) {
  const items = $$('#palette-list .palette-item');
  if (!items.length) return;
  items[paletteActiveIndex]?.classList.remove('active');
  paletteActiveIndex = (paletteActiveIndex + dir + items.length) % items.length;
  items[paletteActiveIndex]?.classList.add('active');
  items[paletteActiveIndex]?.scrollIntoView({ block: 'nearest' });
}
function paletteSelect() {
  const items = $$('#palette-list .palette-item');
  if (items[paletteActiveIndex]) items[paletteActiveIndex].click();
}

// ═══════════════════════════════════════════════════════════════════
// QUICK OPEN (Ctrl+P)
// ═══════════════════════════════════════════════════════════════════
let qoMode = 'file'; // 'file' | 'symbol' | 'line'
function showQuickOpen(initial) {
  const overlay = $('#quick-open-overlay');
  const input = $('#qo-input');
  overlay.classList.add('visible');
  input.value = initial || '';
  qoMode = 'file';
  renderQuickOpenList();
  setTimeout(() => input.focus(), 50);
}
function closeQuickOpen() { $('#quick-open-overlay').classList.remove('visible'); }
let qoActiveIndex = 0;

function fuzzyScore(query, str) {
  if (!query) return 1;
  query = query.toLowerCase();
  str = str.toLowerCase();
  if (str.includes(query)) return 100 - (str.indexOf(query) / 10);
  let qi = 0, score = 0, prevMatch = -1;
  for (let i = 0; i < str.length && qi < query.length; i++) {
    if (str[i] === query[qi]) {
      score += prevMatch === i - 1 ? 10 : 1;
      prevMatch = i;
      qi++;
    }
  }
  return qi === query.length ? score : 0;
}

function renderQuickOpenList() {
  const input = $('#qo-input').value;
  const list = $('#qo-list');
  // Mode prefix
  if (input.startsWith('@')) {
    qoMode = 'symbol';
    return renderQuickOpenSymbols(input.slice(1));
  } else if (input.startsWith(':')) {
    qoMode = 'line';
    return renderQuickOpenLine(input.slice(1));
  } else if (input.startsWith('>')) {
    qoMode = 'command';
    return renderQuickOpenCommands(input.slice(1));
  } else {
    qoMode = 'file';
  }
  const allFiles = collectAllFiles(fileTreeData);
  const recents = getRecentFiles().slice(0, 10);
  // Combine files + recents, dedupe
  const items = [];
  const seen = new Set();
  recents.forEach(p => {
    const f = allFiles.find(x => x.path === p);
    if (f) {
      seen.add(p);
      items.push({ file: f, recent: true });
    }
  });
  allFiles.forEach(f => { if (!seen.has(f.path)) items.push({ file: f, recent: false }); });
  // Filter
  const filtered = input
    ? items.map(it => ({ ...it, score: fuzzyScore(input, it.file.name) })).filter(it => it.score > 0).sort((a, b) => b.score - a.score)
    : items;
  if (!filtered.length) { list.innerHTML = '<div class="palette-empty">No files match. Open a folder first.</div>'; return; }
  list.innerHTML = filtered.slice(0, 50).map((it, i) => {
    const name = it.file.name;
    const q = (input || '').toLowerCase();
    let displayName = escapeHtml(name);
    if (q && name.toLowerCase().includes(q)) {
      const idx = name.toLowerCase().indexOf(q);
      displayName = escapeHtml(name.slice(0, idx)) + '<span class="match">' + escapeHtml(name.slice(idx, idx + q.length)) + '</span>' + escapeHtml(name.slice(idx + q.length));
    }
    return `<div class="qo-item${i === 0 ? ' active' : ''}" data-path="${escapeHtml(it.file.path)}">
      <span class="qi-icon">${getFileIcon(name, false)}</span>
      <span class="qi-name">${displayName}</span>
      <span class="qi-path">${escapeHtml(it.file.path)}${it.recent ? ' • recent' : ''}</span>
    </div>`;
  }).join('');
  $$('#qo-list .qo-item').forEach(el => {
    el.addEventListener('click', () => {
      closeQuickOpen();
      openFile(el.dataset.path, basename(el.dataset.path));
    });
  });
  qoActiveIndex = 0;
  list.scrollTop = 0;
}

function renderQuickOpenSymbols(query) {
  const list = $('#qo-list');
  if (!activeEditor || !activeFilePath) { list.innerHTML = '<div class="palette-empty">Open a file to search symbols</div>'; return; }
  const model = activeEditor.getModel();
  monaco.languages.getDocumentSymbols(model.uri.toString()).then(syms => {
    const flat = [];
    const walk = (s) => { flat.push(s); if (s.children) s.children.forEach(walk); };
    syms.forEach(walk);
    const filtered = query ? flat.filter(s => s.name.toLowerCase().includes(query.toLowerCase())) : flat;
    if (!filtered.length) { list.innerHTML = '<div class="palette-empty">No symbols match</div>'; return; }
    list.innerHTML = filtered.slice(0, 50).map((s, i) => {
      const q = (query || '').toLowerCase();
      let name = escapeHtml(s.name);
      if (q && s.name.toLowerCase().includes(q)) {
        const idx = s.name.toLowerCase().indexOf(q);
        name = escapeHtml(s.name.slice(0, idx)) + '<span class="match">' + escapeHtml(s.name.slice(idx, idx + q.length)) + '</span>' + escapeHtml(s.name.slice(idx + q.length));
      }
      return `<div class="qo-item${i === 0 ? ' active' : ''}" data-line="${s.range.startLineNumber}">
        <span class="qi-icon"><i class="fas fa-code"></i></span>
        <span class="qi-name">${name}</span>
        <span class="qi-path">line ${s.range.startLineNumber}</span>
      </div>`;
    }).join('');
    $$('#qo-list .qo-item').forEach(el => {
      el.addEventListener('click', () => {
        const ln = parseInt(el.dataset.line);
        closeQuickOpen();
        setTimeout(() => {
          if (activeEditor) { activeEditor.revealLineInCenter(ln); activeEditor.setPosition({ lineNumber: ln, column: 1 }); activeEditor.focus(); }
        }, 100);
      });
    });
  });
}

function renderQuickOpenLine(query) {
  const list = $('#qo-list');
  if (!activeEditor) { list.innerHTML = '<div class="palette-empty">No active editor</div>'; return; }
  const ln = parseInt(query);
  if (!ln || ln < 1) { list.innerHTML = '<div class="palette-empty">Enter a valid line number (prefix with :)</div>'; return; }
  activeEditor.revealLineInCenter(ln);
  activeEditor.setPosition({ lineNumber: ln, column: 1 });
  activeEditor.focus();
  closeQuickOpen();
}

function renderQuickOpenCommands(query) {
  const list = $('#qo-list');
  const q = (query || '').toLowerCase();
  const items = q ? COMMANDS.filter(c => c.label.toLowerCase().includes(q)) : COMMANDS;
  list.innerHTML = items.slice(0, 50).map((c, i) => `
    <div class="qo-item${i === 0 ? ' active' : ''}" data-id="${c.id}">
      <span class="qi-icon"><i class="${c.icon}"></i></span>
      <span class="qi-name">${escapeHtml(c.label)}</span>
      <span class="qi-path">${escapeHtml(c.shortcut || '')}</span>
    </div>
  `).join('');
  $$('#qo-list .qo-item').forEach(el => {
    el.addEventListener('click', () => {
      const c = COMMANDS.find(x => x.id === el.dataset.id);
      if (c) { closeQuickOpen(); try { c.action(); } catch (e) {} }
    });
  });
}

function qoNavigate(dir) {
  const items = $$('#qo-list .qo-item');
  if (!items.length) return;
  items[qoActiveIndex]?.classList.remove('active');
  qoActiveIndex = (qoActiveIndex + dir + items.length) % items.length;
  items[qoActiveIndex]?.classList.add('active');
  items[qoActiveIndex]?.scrollIntoView({ block: 'nearest' });
}
function qoSelect() { $$('#qo-list .qo-item')[qoActiveIndex]?.click(); }

// ═══════════════════════════════════════════════════════════════════
// GO TO LINE / SYMBOL (Inline inputs in palette)
// ═══════════════════════════════════════════════════════════════════
function showGoToLine() {
  const overlay = $('#quick-open-overlay');
  $('#qo-input').value = ':';
  overlay.classList.add('visible');
  setTimeout(() => { const i = $('#qo-input'); i.focus(); i.setSelectionRange(1, 1); }, 50);
}
function showGoToSymbol() {
  const overlay = $('#quick-open-overlay');
  $('#qo-input').value = '@';
  overlay.classList.add('visible');
  setTimeout(() => { const i = $('#qo-input'); i.focus(); i.setSelectionRange(1, 1); }, 50);
}

// ═══════════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════════
function setTheme(name) {
  if (!['savia-dark', 'vs-dark', 'vs', 'hc-black'].includes(name)) name = 'savia-dark';
  editorSettings.theme = name;
  currentTheme = name;
  if (window.monaco) monaco.editor.setTheme(name);
  // Update document background
  if (name === 'vs') {
    document.documentElement.style.setProperty('--bg-primary', '#ffffff');
    document.documentElement.style.setProperty('--bg-secondary', '#f3f3f3');
    document.documentElement.style.setProperty('--bg-tertiary', '#ececec');
    document.documentElement.style.setProperty('--text-primary', '#222');
    document.documentElement.style.setProperty('--text-secondary', '#666');
    document.documentElement.style.setProperty('--border-color', '#d4d4d4');
    document.documentElement.style.setProperty('--border-subtle', '#e5e5e5');
  } else if (name === 'hc-black') {
    document.documentElement.style.setProperty('--bg-primary', '#000000');
    document.documentElement.style.setProperty('--bg-secondary', '#0a0a0a');
    document.documentElement.style.setProperty('--bg-tertiary', '#1a1a1a');
  } else {
    document.documentElement.style.setProperty('--bg-primary', '#0d1117');
    document.documentElement.style.setProperty('--bg-secondary', '#161b22');
    document.documentElement.style.setProperty('--bg-tertiary', '#1c2128');
    document.documentElement.style.setProperty('--text-primary', '#e6edf3');
    document.documentElement.style.setProperty('--text-secondary', '#8b949e');
    document.documentElement.style.setProperty('--border-color', '#30363d');
    document.documentElement.style.setProperty('--border-subtle', '#21262d');
  }
  addOutputLine('extension', `[Theme] Switched to ${name}`);
  toast('Theme: ' + name, 'info', null, 1500);
}
function cycleTheme() {
  const order = ['savia-dark', 'vs-dark', 'vs', 'hc-black'];
  const next = order[(order.indexOf(editorSettings.theme) + 1) % order.length];
  setTheme(next);
}

// ═══════════════════════════════════════════════════════════════════
// ZEN MODE / WORD WRAP
// ═══════════════════════════════════════════════════════════════════
function toggleZenMode() {
  zenMode = !zenMode;
  document.body.classList.toggle('zen-mode', zenMode);
  const app = $('#app');
  app.style.transition = 'opacity 0.2s';
  if (zenMode) {
    $('#sidebar').classList.add('collapsed');
    $('#bottom-panel').classList.add('collapsed');
    $('#tab-bar').style.display = 'none';
    $('#breadcrumb').style.display = 'none';
    $('#status-bar').style.display = 'none';
    $$('.activity-icon').forEach(a => a.style.display = 'none');
    sidebarVisible = false;
    bottomPanelVisible = false;
  } else {
    $('#tab-bar').style.display = '';
    $('#breadcrumb').style.display = '';
    $('#status-bar').style.display = '';
    $$('.activity-icon').forEach(a => a.style.display = '');
  }
  setTimeout(() => editors.forEach(ed => ed.layout()), 220);
  toast('Zen Mode: ' + (zenMode ? 'ON' : 'OFF'), 'info');
}

function toggleWordWrap() {
  editorSettings.wordWrap = editorSettings.wordWrap === 'on' ? 'off' : 'on';
  editors.forEach(ed => ed.updateOptions({ wordWrap: editorSettings.wordWrap }));
  toast('Word Wrap: ' + editorSettings.wordWrap, 'info', null, 1200);
}

function runActiveFile() {
  if (!activeFilePath) { toast('No active file', 'warning'); return; }
  const ext = getExt(basename(activeFilePath));
  const runner = {
    js: 'node', py: 'python', sh: 'bash', bat: 'cmd', ps1: 'powershell',
    html: 'echo Open in browser', css: 'echo No runner for CSS'
  }[ext];
  if (!runner) { toast('No runner for .' + ext, 'warning'); return; }
  switchBottomTab('terminal');
  toggleBottomPanel(true);
  const escName = activeFilePath.replace(/"/g, '\\"');
  executeCommand(`${runner} "${escName}"`);
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════
function openSettings() {
  const overlay = $('#settings-overlay');
  overlay.classList.add('visible');
  renderSettingsSection('general');
}
function closeSettings() { $('#settings-overlay').classList.remove('visible'); }

function renderSettingsSection(section) {
  $$('.ms-item').forEach(el => el.classList.toggle('active', el.dataset.section === section));
  const content = $('#settings-content');
  if (section === 'general') {
    content.innerHTML = `
      <div class="settings-group">
        <h3>Appearance</h3>
        <div class="settings-row">
          <label>Color Theme<span class="desc">Editor color theme</span></label>
          <select id="set-theme">
            <option value="savia-dark" ${editorSettings.theme === 'savia-dark' ? 'selected' : ''}>S.A.V.I.A. Dark (default)</option>
            <option value="vs-dark" ${editorSettings.theme === 'vs-dark' ? 'selected' : ''}>VS Dark</option>
            <option value="vs" ${editorSettings.theme === 'vs' ? 'selected' : ''}>Light</option>
            <option value="hc-black" ${editorSettings.theme === 'hc-black' ? 'selected' : ''}>High Contrast</option>
          </select>
        </div>
        <div class="settings-row">
          <label>Auto Save<span class="desc">Save dirty files automatically</span></label>
          <input type="checkbox" id="set-autosave" ${editorSettings.autoSave ? 'checked' : ''}>
        </div>
      </div>
      <div class="settings-group">
        <h3>Files</h3>
        <div class="settings-row">
          <label>Format On Save<span class="desc">Run formatter when saving</span></label>
          <input type="checkbox" id="set-format-on-save" ${editorSettings.formatOnSave ? 'checked' : ''}>
        </div>
        <div class="settings-row">
          <label>Format On Paste<span class="desc">Format pasted content automatically</span></label>
          <input type="checkbox" id="set-format-on-paste" ${editorSettings.formatOnPaste ? 'checked' : ''}>
        </div>
      </div>
    `;
    bindSettings();
  } else if (section === 'editor') {
    content.innerHTML = `
      <div class="settings-group">
        <h3>Editor</h3>
        <div class="settings-row">
          <label>Font Size<span class="desc">Controls the editor font size in pixels</span></label>
          <input type="number" id="set-fontsize" min="8" max="32" value="${editorSettings.fontSize}">
        </div>
        <div class="settings-row">
          <label>Tab Size<span class="desc">Spaces per tab</span></label>
          <input type="number" id="set-tabsize" min="1" max="8" value="${editorSettings.tabSize}">
        </div>
        <div class="settings-row">
          <label>Word Wrap<span class="desc">Wrap long lines</span></label>
          <select id="set-wordwrap">
            <option value="on" ${editorSettings.wordWrap === 'on' ? 'selected' : ''}>On</option>
            <option value="off" ${editorSettings.wordWrap === 'off' ? 'selected' : ''}>Off</option>
          </select>
        </div>
        <div class="settings-row">
          <label>Minimap<span class="desc">Show a minimap on the right</span></label>
          <input type="checkbox" id="set-minimap" ${editorSettings.minimap ? 'checked' : ''}>
        </div>
        <div class="settings-row">
          <label>Line Numbers<span class="desc">Show line numbers in the gutter</span></label>
          <input type="checkbox" id="set-linenumbers" ${editorSettings.lineNumbers ? 'checked' : ''}>
        </div>
        <div class="settings-row">
          <label>Render Whitespace<span class="desc">Render whitespace characters</span></label>
          <select id="set-whitespace">
            <option value="none" ${editorSettings.renderWhitespace === 'none' ? 'selected' : ''}>None</option>
            <option value="selection" ${editorSettings.renderWhitespace === 'selection' ? 'selected' : ''}>Selection</option>
            <option value="all" ${editorSettings.renderWhitespace === 'all' ? 'selected' : ''}>All</option>
          </select>
        </div>
        <div class="settings-row">
          <label>Bracket Pair Colorization<span class="desc">Colorize matching brackets</span></label>
          <input type="checkbox" id="set-brackets" ${editorSettings.bracketPairColorization ? 'checked' : ''}>
        </div>
        <div class="settings-row">
          <label>Sticky Scroll<span class="desc">Show current scope at the top</span></label>
          <input type="checkbox" id="set-sticky" ${editorSettings.stickyScroll ? 'checked' : ''}>
        </div>
        <div class="settings-row">
          <label>Smooth Scrolling<span class="desc">Animate scrolling</span></label>
          <input type="checkbox" id="set-smooth" ${editorSettings.smoothScrolling ? 'checked' : ''}>
        </div>
      </div>
    `;
    bindSettings();
  } else if (section === 'terminal') {
    content.innerHTML = `
      <div class="settings-group">
        <h3>Terminal</h3>
        <div class="settings-row">
          <label>Font Size<span class="desc">Terminal text size</span></label>
          <input type="number" id="set-term-fontsize" min="8" max="32" value="${editorSettings.terminalFontSize}">
        </div>
        <div class="settings-row">
          <label>Cursor Blinking<span class="desc">Cursor blink style</span></label>
          <select id="set-cursor-blink">
            <option value="smooth" ${editorSettings.cursorBlinking === 'smooth' ? 'selected' : ''}>Smooth</option>
            <option value="blink" ${editorSettings.cursorBlinking === 'blink' ? 'selected' : ''}>Blink</option>
            <option value="phase" ${editorSettings.cursorBlinking === 'phase' ? 'selected' : ''}>Phase</option>
            <option value="expand" ${editorSettings.cursorBlinking === 'expand' ? 'selected' : ''}>Expand</option>
            <option value="solid" ${editorSettings.cursorBlinking === 'solid' ? 'selected' : ''}>Solid</option>
          </select>
        </div>
      </div>
    `;
    bindSettings();
  } else if (section === 'workspace') {
    content.innerHTML = `
      <div class="settings-group">
        <h3>Workspace</h3>
        <div class="settings-row">
          <label>Project<span class="desc">Currently open folder</span></label>
          <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">${escapeHtml(importedProjectRoot || 'No project opened')}</span>
        </div>
        <div class="settings-row">
          <label>Open Recent Files<span class="desc">Recently opened files</span></label>
          <button class="ext-btn" id="btn-show-recent-files">View List</button>
        </div>
        <div class="settings-row">
          <label>Open Recent Projects<span class="desc">Recently opened projects</span></label>
          <button class="ext-btn" id="btn-show-recent-projects">View List</button>
        </div>
        <div class="settings-row">
          <label>Trust<span class="desc">Current workspace trust: trusted</span></label>
          <span style="color: var(--accent-green);"><i class="fas fa-shield-alt"></i> Trusted</span>
        </div>
      </div>
    `;
    $('#btn-show-recent-files')?.addEventListener('click', () => showRecentList('files'));
    $('#btn-show-recent-projects')?.addEventListener('click', () => showRecentList('projects'));
  } else if (section === 'keyboard') {
    content.innerHTML = `
      <div class="settings-group">
        <h3>Keyboard Shortcuts</h3>
        <div class="settings-row"><label>Command Palette</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+Shift+P</kbd></div>
        <div class="settings-row"><label>Quick Open File</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+P</kbd></div>
        <div class="settings-row"><label>Search in Files</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+Shift+F</kbd></div>
        <div class="settings-row"><label>Go to Line</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+G</kbd></div>
        <div class="settings-row"><label>Go to Symbol</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+Shift+O</kbd></div>
        <div class="settings-row"><label>Find / Replace</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+F / Ctrl+H</kbd></div>
        <div class="settings-row"><label>Save</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+S</kbd></div>
        <div class="settings-row"><label>Save As</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+Shift+S</kbd></div>
        <div class="settings-row"><label>Save All</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+K Ctrl+S</kbd></div>
        <div class="settings-row"><label>Format Document</label><kbd style="color:var(--text-primary);font-family:monospace;">Shift+Alt+F</kbd></div>
        <div class="settings-row"><label>Toggle Comment</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+/</kbd></div>
        <div class="settings-row"><label>Multi-cursor (Add Next)</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+D</kbd></div>
        <div class="settings-row"><label>Add Cursor Above</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+Alt+Up</kbd></div>
        <div class="settings-row"><label>Add Cursor Below</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+Alt+Down</kbd></div>
        <div class="settings-row"><label>Duplicate Line Down</label><kbd style="color:var(--text-primary);font-family:monospace;">Shift+Alt+Down</kbd></div>
        <div class="settings-row"><label>Move Line Up/Down</label><kbd style="color:var(--text-primary);font-family:monospace;">Alt+Up / Alt+Down</kbd></div>
        <div class="settings-row"><label>Toggle Terminal</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+\`</kbd></div>
        <div class="settings-row"><label>Toggle Sidebar</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+B</kbd></div>
        <div class="settings-row"><label>Close Tab</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+W</kbd></div>
        <div class="settings-row"><label>Settings</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+,</kbd></div>
        <div class="settings-row"><label>Zen Mode</label><kbd style="color:var(--text-primary);font-family:monospace;">Ctrl+K Z</kbd></div>
      </div>
    `;
  } else if (section === 'about') {
    content.innerHTML = `
      <div class="settings-group">
        <h3>About</h3>
        <div class="settings-row"><label>Product</label><span>S.A.V.I.A. IDE</span></div>
        <div class="settings-row"><label>Version</label><span>1.0.0</span></div>
        <div class="settings-row"><label>Engine</label><span>Monaco Editor 0.45.0</span></div>
        <div class="settings-row"><label>Shell</label><span>Electron + Node.js</span></div>
        <div class="settings-row"><label>Build</label><span>${new Date().toISOString().slice(0, 10)}</span></div>
        <div class="settings-row"><label>License</label><span>MIT</span></div>
        <div class="settings-row"><label>Author</label><span>Gabriele Forestieri</span></div>
      </div>
    `;
  }
}

function bindSettings() {
  $('#set-theme')?.addEventListener('change', (e) => setTheme(e.target.value));
  $('#set-autosave')?.addEventListener('change', (e) => { editorSettings.autoSave = e.target.checked; autoSaveEnabled = e.target.checked; });
  $('#set-format-on-save')?.addEventListener('change', (e) => { editorSettings.formatOnSave = e.target.checked; });
  $('#set-format-on-paste')?.addEventListener('change', (e) => { editorSettings.formatOnPaste = e.target.checked; editors.forEach(ed => ed.updateOptions({ formatOnPaste: e.target.checked })); });
  $('#set-fontsize')?.addEventListener('change', (e) => { editorSettings.fontSize = parseInt(e.target.value) || 14; editors.forEach(ed => ed.updateOptions({ fontSize: editorSettings.fontSize })); });
  $('#set-tabsize')?.addEventListener('change', (e) => { editorSettings.tabSize = parseInt(e.target.value) || 2; editors.forEach(ed => ed.updateOptions({ tabSize: editorSettings.tabSize })); });
  $('#set-wordwrap')?.addEventListener('change', (e) => { editorSettings.wordWrap = e.target.value; editors.forEach(ed => ed.updateOptions({ wordWrap: editorSettings.wordWrap })); });
  $('#set-minimap')?.addEventListener('change', (e) => { editorSettings.minimap = e.target.checked; editors.forEach(ed => ed.updateOptions({ minimap: { enabled: e.target.checked } })); });
  $('#set-linenumbers')?.addEventListener('change', (e) => { editorSettings.lineNumbers = e.target.checked; editors.forEach(ed => ed.updateOptions({ lineNumbers: e.target.checked ? 'on' : 'off' })); });
  $('#set-whitespace')?.addEventListener('change', (e) => { editorSettings.renderWhitespace = e.target.value; editors.forEach(ed => ed.updateOptions({ renderWhitespace: editorSettings.renderWhitespace })); });
  $('#set-brackets')?.addEventListener('change', (e) => { editorSettings.bracketPairColorization = e.target.checked; editors.forEach(ed => ed.updateOptions({ bracketPairColorization: { enabled: e.target.checked } })); });
  $('#set-sticky')?.addEventListener('change', (e) => { editorSettings.stickyScroll = e.target.checked; editors.forEach(ed => ed.updateOptions({ stickyScroll: { enabled: e.target.checked } })); });
  $('#set-smooth')?.addEventListener('change', (e) => { editorSettings.smoothScrolling = e.target.checked; editors.forEach(ed => ed.updateOptions({ smoothScrolling: e.target.checked })); });
  $('#set-term-fontsize')?.addEventListener('change', (e) => { editorSettings.terminalFontSize = parseInt(e.target.value) || 13; document.documentElement.style.setProperty('--terminal-font', editorSettings.terminalFontSize + 'px'); });
  $('#set-cursor-blink')?.addEventListener('change', (e) => { editorSettings.cursorBlinking = e.target.value; editors.forEach(ed => ed.updateOptions({ cursorBlinking: e.target.value })); });
}

function showRecentList(kind) {
  const list = kind === 'files' ? getRecentFiles() : getRecentProjects();
  if (!list.length) { toast('No recent ' + kind, 'info'); return; }
  const overlay = $('#quick-open-overlay');
  const list2 = $('#qo-list');
  $('#qo-input').value = '';
  overlay.classList.add('visible');
  list2.innerHTML = list.map((p, i) => `
    <div class="qo-item${i === 0 ? ' active' : ''}" data-path="${escapeHtml(p)}">
      <span class="qi-icon"><i class="fas fa-clock"></i></span>
      <span class="qi-name">${escapeHtml(basename(p))}</span>
      <span class="qi-path">${escapeHtml(p)}</span>
    </div>
  `).join('');
  $$('#qo-list .qo-item').forEach(el => {
    el.addEventListener('click', () => {
      closeQuickOpen();
      if (kind === 'files') openFile(el.dataset.path, basename(el.dataset.path));
      else importFolder(el.dataset.path);
    });
  });
  qoActiveIndex = 0;
  setTimeout(() => $('#qo-input').focus(), 50);
}

// ═══════════════════════════════════════════════════════════════════
// BOOTSTRAP + UI WIRING (init, menus, shortcut, terminal, git, debug)
// ═══════════════════════════════════════════════════════════════════

let monacoBooted = false;
let monacoBootQueue = [];
let terminalProcIds = new Set();    // procId emessi dal nostro terminale
let lastClickTarget = null;         // target per "Reveal in Explorer"

// ── Terminal runtime state (aggiunto per stdin / kill) ──
let termActive = { running: false, procId: null };

// ── Debug runtime ──
let debugSession = { running: false, procId: null, name: null };

// ── Git panel state ──
let gitFiles = [];                  // files con status
let gitBranch = 'main';

function ensureMonacoLoaded(cb) {
  if (monacoBooted && window.monaco) return cb();
  monacoBootQueue.push(cb);
  if (monacoBooted && window.monaco) return;
  if (monacoBooted) return; // già avviati, in attesa del callback
  monacoBooted = true;
  if (!window.require) {
    console.error('Monaco loader (require) non disponibile');
    monacoBooted = false;
    return;
  }
  require(['vs/editor/editor.main'], function () {
    // definisci un tema "savia" personalizzato
    try {
      monaco.editor.defineTheme('savia-dark', {
        base: 'vs-dark', inherit: true,
        rules: [
          { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
          { token: 'keyword', foreground: '569cd6' },
          { token: 'string', foreground: 'ce9178' },
          { token: 'number', foreground: 'b5cea8' },
          { token: 'type', foreground: '4ec9b0' },
          { token: 'function', foreground: 'dcdcaa' }
        ],
        colors: { 'editor.background': '#0d1117', 'editor.lineHighlightBackground': '#10161d', 'editorIndentGuide.background': '#21262d' }
      });
      monaco.editor.setTheme('savia-dark');
    } catch (e) {}
    monacoBooted = true;
    const queue = monacoBootQueue.slice();
    monacoBootQueue = [];
    queue.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
  });
}

// ── File tree toggle helper (espandi/collassa in modo corretto) ──
function toggleTreeFolderHeader(header, childrenDiv) {
  const chevron = header ? header.querySelector('.chevron') : null;
  const icon = header ? header.querySelector('.icon i') : null;
  if (childrenDiv.style.display === 'none') {
    childrenDiv.style.display = '';
    if (chevron) chevron.classList.add('expanded');
    if (icon) icon.className = 'fas fa-folder-open';
  } else {
    childrenDiv.style.display = 'none';
    if (chevron) chevron.classList.remove('expanded');
    if (icon) icon.className = 'fas fa-folder';
  }
}

// ═══════════════════════════════════════════════════════════════════
// TITLE BAR — window controls + menu bar
// ═══════════════════════════════════════════════════════════════════
const MENU_DEFINITIONS = {
  file: [
    { label: 'New File', shortcut: 'Ctrl+N', icon: 'fas fa-plus', action: () => createNewFile(currentRootDir) },
    { label: 'New Folder...', icon: 'fas fa-folder-plus', action: () => createNewFolder() },
    { label: 'Open File...', shortcut: 'Ctrl+O', icon: 'fas fa-file', action: openSingleFile },
    { label: 'Open Folder...', shortcut: 'Ctrl+K Ctrl+O', icon: 'fas fa-folder-open', action: importFolder },
    { label: 'Open Recent', icon: 'fas fa-history', sub: [
      { label: 'Recent Files', icon: 'fas fa-file', action: () => showRecentList('files') },
      { label: 'Recent Projects', icon: 'fas fa-folder', action: () => showRecentList('projects') },
      { label: 'Clear All Recent', icon: 'fas fa-trash', action: () => { clearRecent('files'); clearRecent('projects'); toast('Recent cleared', 'info'); } }
    ]},
    { sep: true },
    { label: 'Save', shortcut: 'Ctrl+S', icon: 'fas fa-save', action: saveCurrentFile },
    { label: 'Save As...', shortcut: 'Ctrl+Shift+S', icon: 'fas fa-save', action: saveAs },
    { label: 'Save All', shortcut: 'Ctrl+K Ctrl+S', icon: 'fas fa-save', action: saveAll },
    { sep: true },
    { label: 'Close Editor', shortcut: 'Ctrl+W', icon: 'fas fa-times', action: () => activeTab && closeTab(activeTab, {}) },
    { label: 'Close All Editors', icon: 'fas fa-times-circle', action: closeAllTabs },
    { sep: true },
    { label: 'Reveal Active File in Explorer', icon: 'fas fa-folder-open', action: () => activeFilePath && window.electronAPI?.openInExplorer?.(activeFilePath) },
    { sep: true },
    { label: 'Exit', shortcut: 'Alt+F4', icon: 'fas fa-power-off', action: () => window.electronAPI?.windowClose?.() }
  ],
  edit: [
    { label: 'Undo', shortcut: 'Ctrl+Z', icon: 'fas fa-undo', action: () => activeEditor?.trigger('keyboard', 'undo', null) },
    { label: 'Redo', shortcut: 'Ctrl+Y', icon: 'fas fa-redo', action: () => activeEditor?.trigger('keyboard', 'redo', null) },
    { sep: true },
    { label: 'Cut', shortcut: 'Ctrl+X', icon: 'fas fa-cut', action: () => activeEditor?.trigger('keyboard', 'editor.action.clipboardCutAction', null) },
    { label: 'Copy', shortcut: 'Ctrl+C', icon: 'fas fa-copy', action: () => activeEditor?.trigger('keyboard', 'editor.action.clipboardCopyAction', null) },
    { label: 'Paste', shortcut: 'Ctrl+V', icon: 'fas fa-paste', action: () => activeEditor?.trigger('keyboard', 'editor.action.clipboardPasteAction', null) },
    { sep: true },
    { label: 'Find', shortcut: 'Ctrl+F', icon: 'fas fa-search', action: openFind },
    { label: 'Replace', shortcut: 'Ctrl+H', icon: 'fas fa-exchange-alt', action: openFind },
    { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', icon: 'fas fa-search', action: () => { switchActivity('search'); setTimeout(() => $('#search-input')?.focus(), 50); } },
    { sep: true },
    { label: 'Toggle Line Comment', shortcut: 'Ctrl+/', icon: 'fas fa-comment', action: () => activeEditor?.trigger('keyboard', 'editor.action.commentLine', null) },
    { label: 'Format Document', shortcut: 'Shift+Alt+F', icon: 'fas fa-indent', action: formatDocument },
    { label: 'Copy Line Down', shortcut: 'Shift+Alt+Down', icon: 'fas fa-clone', action: () => activeEditor?.trigger('keyboard', 'editor.action.copyLinesDownAction', null) }
  ],
  selection: [
    { label: 'Select All', shortcut: 'Ctrl+A', icon: 'fas fa-i-cursor', action: () => activeEditor?.trigger('keyboard', 'editor.action.selectAll', null) },
    { label: 'Add Cursor Above', shortcut: 'Ctrl+Alt+Up', icon: 'fas fa-plus', action: () => activeEditor?.trigger('keyboard', 'editor.action.insertCursorAbove', null) },
    { label: 'Add Cursor Below', shortcut: 'Ctrl+Alt+Down', icon: 'fas fa-plus', action: () => activeEditor?.trigger('keyboard', 'editor.action.insertCursorBelow', null) },
    { label: 'Add Next Occurrence', shortcut: 'Ctrl+D', icon: 'fas fa-plus', action: () => activeEditor?.trigger('keyboard', 'editor.action.addSelectionToNextFindMatch', null) },
    { label: 'Select All Occurrences', shortcut: 'Ctrl+Shift+L', icon: 'fas fa-mouse-pointer', action: () => activeEditor?.trigger('keyboard', 'editor.action.selectHighlights', null) }
  ],
  view: [
    { label: 'Command Palette...', shortcut: 'Ctrl+Shift+P', icon: 'fas fa-search-plus', action: openCommandPalette },
    { label: 'Open View...', shortcut: 'Ctrl+P', icon: 'fas fa-file', action: showQuickOpen },
    { sep: true },
    { label: 'Explorer', shortcut: 'Ctrl+Shift+E', icon: 'fas fa-copy', action: () => switchActivity('explorer') },
    { label: 'Search', shortcut: 'Ctrl+Shift+F', icon: 'fas fa-search', action: () => switchActivity('search') },
    { label: 'Source Control', shortcut: 'Ctrl+Shift+G', icon: 'fas fa-code-branch', action: () => switchActivity('git') },
    { label: 'Run and Debug', shortcut: 'Ctrl+Shift+D', icon: 'fas fa-bug', action: () => switchActivity('debug') },
    { label: 'Extensions', shortcut: 'Ctrl+Shift+X', icon: 'fas fa-th-large', action: () => switchActivity('extensions') },
    { label: 'Outline', icon: 'fas fa-list-ul', action: () => switchActivity('outline') },
    { sep: true },
    { label: 'Problems', shortcut: 'Ctrl+Shift+M', icon: 'fas fa-exclamation-triangle', action: () => { toggleBottomPanel(true); switchBottomTab('problems'); } },
    { label: 'Output', icon: 'fas fa-desktop', action: () => { toggleBottomPanel(true); switchBottomTab('output'); } },
    { label: 'Terminal', shortcut: 'Ctrl+`', icon: 'fas fa-terminal', action: () => { toggleBottomPanel(true); switchBottomTab('terminal'); } },
    { sep: true },
    { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', icon: 'fas fa-columns', action: () => toggleSidebar() },
    { label: 'Toggle Word Wrap', shortcut: 'Alt+Z', icon: 'fas fa-text-width', action: toggleWordWrap },
    { label: 'Zen Mode', shortcut: 'Ctrl+K Z', icon: 'fas fa-expand', action: toggleZenMode },
    { sep: true },
    { label: 'Show All Commands', shortcut: 'F1', icon: 'fas fa-terminal', action: openCommandPalette }
  ],
  go: [
    { label: 'Back', shortcut: 'Alt+Left', icon: 'fas fa-arrow-left', action: () => toast('Use file explorer history', 'info') },
    { label: 'Forward', shortcut: 'Alt+Right', icon: 'fas fa-arrow-right', action: () => toast('Use file explorer history', 'info') },
    { sep: true },
    { label: 'Go to File...', shortcut: 'Ctrl+P', icon: 'fas fa-file', action: showQuickOpen },
    { label: 'Go to Symbol in File...', shortcut: 'Ctrl+Shift+O', icon: 'fas fa-at', action: showGoToSymbol },
    { label: 'Go to Line/Column...', shortcut: 'Ctrl+G', icon: 'fas fa-hashtag', action: showGoToLine },
    { sep: true },
    { label: 'Go to Definition', shortcut: 'F12', icon: 'fas fa-external-link-alt', action: () => activeEditor?.trigger('keyboard', 'editor.action.revealDefinition', null) },
    { label: 'Go to References', shortcut: 'Shift+F12', icon: 'fas fa-search', action: () => activeEditor?.trigger('keyboard', 'editor.action.referenceSearch.trigger', null) },
    { label: 'Go to Matching Bracket', shortcut: 'Ctrl+Shift+\\', icon: 'fas fa-code', action: () => activeEditor?.trigger('keyboard', 'editor.action.jumpToBracket', null) }
  ],
  run: [
    { label: 'Run Active File', icon: 'fas fa-play', action: runActiveFile },
    { label: 'Run in Python', icon: 'fab fa-python', action: () => runWithRunner('python') },
    { label: 'Run with Node', icon: 'fab fa-node-js', action: () => runWithRunner('node') },
    { label: 'Open in Browser (HTML)', icon: 'fab fa-chrome', action: () => openHtmlInBrowser() },
    { sep: true },
    { label: 'Start Debugging', shortcut: 'F5', icon: 'fas fa-bug', action: startDebug },
    { label: 'Stop Debugging', shortcut: 'Shift+F5', icon: 'fas fa-stop', action: stopDebug },
    { label: 'Configure launch.json...', icon: 'fas fa-cog', action: () => configureLaunchJson() }
  ],
  terminal: [
    { label: 'New Terminal', shortcut: 'Ctrl+Shift+`', icon: 'fas fa-plus', action: addNewTerminal },
    { label: 'Run Task...', icon: 'fas fa-tasks', action: () => toast('Use terminal commands', 'info') },
    { sep: true },
    { label: 'Clear Terminal', icon: 'fas fa-ban', action: clearTerminal },
    { label: 'Kill Current Terminal', icon: 'fas fa-skull', action: () => { if (termActive.procId) { window.electronAPI?.terminalKill?.(termActive.procId); termActive.running = false; termActive.procId = null; addSystemMessage('Terminale terminato'); } } }
  ],
  help: [
    { label: 'Interactive Playground', icon: 'fas fa-rocket', action: () => showWelcome() },
    { label: 'Documentation', icon: 'fas fa-book', action: () => toast('S.A.V.I.A. IDE — documentazione integrata', 'info') },
    { sep: true },
    { label: 'About', icon: 'fas fa-info-circle', action: () => window.openSettings?.() || openAbout() }
  ]
};

function renderDropdown(menuEl) {
  const key = menuEl.dataset.menu;
  const defs = MENU_DEFINITIONS[key];
  if (!defs) return;
  let dd = menuEl.querySelector('.menu-dropdown');
  if (!dd) {
    dd = document.createElement('div');
    dd.className = 'menu-dropdown';
    menuEl.appendChild(dd);
  }
  dd.innerHTML = defs.map(item => {
    if (item.sep) return '<div class="dd-sep"></div>';
    if (item.sub) {
      return `<div class="dd-item" data-sub="${key}"><span>${escapeHtml(item.label)}</span><i class="fas fa-chevron-right"></i></div>`;
    }
    return `<div class="dd-item" data-action="${key}-${item.label}" style="justify-content:flex-start;gap:10px;">
      <i class="${item.icon}"></i><span style="flex:1">${escapeHtml(item.label)}</span>${item.shortcut ? `<span class="shortcut">${escapeHtml(item.shortcut)}</span>` : ''}
    </div>`;
  }).join('');
  dd.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      closeAllMenus();
      const label = el.dataset.action.slice(key.length + 1);
      const item = defs.find(i => i.label === label);
      if (item && item.action) { try { item.action(); } catch (e) { toast('Action failed: ' + e.message, 'error'); } }
    });
  });
  dd.querySelectorAll('[data-sub]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      // Piccolo flyout per submenu recent
      showSubmenu(el);
    });
  });
}

function showSubmenu(anchorEl) {
  const defs = MENU_DEFINITIONS[anchorEl.dataset.sub];
  // apri un quick-open-style list per il submenu
  const overlay = $('#quick-open-overlay');
  const input = $('#qo-input');
  const list = $('#qo-list');
  overlay.classList.add('visible');
  input.value = '';
  input.placeholder = 'Recent...';
  list.innerHTML = defs.map((d, i) => `<div class="qo-item${i === 0 ? ' active' : ''}" data-idx="${i}">
    <span class="qi-icon"><i class="${d.icon}"></i></span>
    <span class="qi-name">${escapeHtml(d.label)}</span>
    <span class="qi-path">${escapeHtml(d.shortcut || '')}</span>
  </div>`).join('');
  $$('#qo-list .qo-item').forEach(el => {
    el.addEventListener('click', () => {
      closeQuickOpen();
      const d = defs[parseInt(el.dataset.idx)];
      if (d && d.action) { try { d.action(); } catch (e) {} }
    });
  });
  qoActiveIndex = 0;
  setTimeout(() => input.focus(), 30);
  closeAllMenus();
}

function closeAllMenus() {
  $$('.menu-dropdown').forEach(d => d.classList.remove('open'));
  $$('.menu-item').forEach(m => m.classList.remove('active'));
}



// ═══════════════════════════════════════════════════════════════════
// RUN HELPERS
// ═══════════════════════════════════════════════════════════════════
function runWithRunner(runner) {
  if (!activeFilePath) { toast('No active file', 'warning'); return; }
  switchBottomTab('terminal');
  toggleBottomPanel(true);
  executeCommand(`${runner} "${activeFilePath.replace(/"/g, '\\"')}"`);
}

function openHtmlInBrowser() {
  if (!activeFilePath) { toast('No active file', 'warning'); return; }
  const ext = getExt(activeFilePath);
  if (ext !== 'html' && ext !== 'htm') { toast('Active file is not HTML', 'warning'); return; }
  window.electronAPI?.systemOpenApp?.({ app: 'browser', target: activeFilePath }).then(r => {
    toast(r?.success !== false ? 'Opened in browser' : 'Open failed', r?.success !== false ? 'success' : 'error');
  }).catch(e => {
    // fallback: apri con shell
    if (window.electronAPI?.terminalExecute) executeCommand(`start "" "${activeFilePath.replace(/"/g, '\\"')}"`);
    else toast('No browser opener', 'warning');
  });
}

// ═══════════════════════════════════════════════════════════════════
// TERMINAL — output streaming / stdin / tabs / history
// ═══════════════════════════════════════════════════════════════════
function wireTerminal() {
  const input = $('#terminal-input');
  if (!input) return;
  if (window.electronAPI?.terminalGetCwd) {
    window.electronAPI.terminalGetCwd().then(r => {
      if (r && r.cwd) { currentRootDir = currentRootDir || r.cwd; $('#terminal-prompt').textContent = '❯'; }
    }).catch(() => {});
  }
  // history
  let hist = [];
  let histIdx = -1;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value;
      if (!cmd.trim()) return;
      hist.push(cmd);
      histIdx = hist.length;
      input.value = '';
      // assegnazione prompt in cwd se cd
      executeCommand(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histIdx > 0) { histIdx--; input.value = hist[histIdx]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx < hist.length - 1) { histIdx++; input.value = hist[histIdx]; }
      else { histIdx = hist.length; input.value = ''; }
    }
  });

  // kill button nell'header (btn-panel-clear è clear; usiamo terminal-kill via menu)
}
// feedback output da main → router unico globale:
//  - procId in captureMap → risolve la Promise del chiamante (git, ecc.)
//  - procId in terminalProcIds → stampa sul terminale UI
let captureMap = new Map(); // procId → { resolve, out, err, timer }
function wireTerminalOutput() {
  if (!window.electronAPI?.onTerminalOutput) return;
  window.electronAPI.onTerminalOutput((data) => {
    const cap = captureMap.get(data.procId);
    if (cap) {
      if (data.type === 'stdout') cap.out += data.data;
      else if (data.type === 'stderr') cap.err += data.data;
      else if (data.type === 'exit' || data.type === 'error') {
        if (data.type === 'error') cap.err += ' ' + data.data;
        captureMap.delete(data.procId);
        clearTimeout(cap.timer);
        const ok = data.type === 'exit' ? data.data === 0 : false;
        cap.resolve({ ok, out: cap.out, err: cap.err, code: data.data });
      }
      return;
    }
    if (data.procId && terminalProcIds.has(data.procId)) {
      if (activeBottomTab !== 'terminal') { switchBottomTab('terminal'); toggleBottomPanel(true); }
      if (data.type === 'stdout') addTerminalLine(data.data, 'output');
      else if (data.type === 'stderr') addTerminalLine(data.data, 'stderr');
      else if (data.type === 'exit') {
        termActive.running = false;
        termActive.procId = null;
        addTerminalLine(`[process exited code ${data.data}]`, 'system');
        terminalProcIds.delete(data.procId);
      } else if (data.type === 'error') {
        termActive.running = false;
        termActive.procId = null;
        addErrorMessage(String(data.data));
      }
    }
  });
}

// Esegue un comando e ne cattura l'output (silenzioso) per git/debug.
// restituisce Promise<{ ok, out, err, code }>.
function runCommandCapture(cmd, { cwd, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    if (!window.electronAPI?.terminalExecute) return resolve({ ok: false, out: '', err: 'No electron API' });
    if (cwd) window.electronAPI.terminalSetCwd(cwd).catch(() => {});
    window.electronAPI.terminalExecute(cmd).then(res => {
      if (!res || !res.success) {
        return resolve({ ok: false, out: '', err: (res && res.error) || 'Command failed' });
      }
      const procId = res.procId;
      const entry = { resolve, out: '', err: '', timer: null };
      entry.timer = setTimeout(() => {
        captureMap.delete(procId);
        window.electronAPI.terminalKill?.(procId).catch(() => {});
        resolve({ ok: false, out: entry.out, err: (entry.err || '') + ' | timeout', code: -1 });
      }, timeout);
      captureMap.set(procId, entry);
    }).catch(e => resolve({ ok: false, out: '', err: e.message }));
  });
}

// ═══════════════════════════════════════════════════════════════════
// GIT PANEL — funzionale via runCommandCapture
// ═══════════════════════════════════════════════════════════════════
function gitFileIcon(status) {
  if (status === 'M') return '<i class="fas fa-pen" style="color:var(--accent-gold);"></i>';
  if (status === 'A' || status === '??') return '<i class="fas fa-plus-circle" style="color:var(--accent-green);"></i>';
  if (status === 'D') return '<i class="fas fa-minus-circle" style="color:var(--accent-magenta);"></i>';
  if (status === 'R') return '<i class="fas fa-exchange-alt" style="color:var(--accent-purple);"></i>';
  if (status === 'U' || /[ADU]{2}/.test(status)) return '<i class="fas fa-exclamation-triangle" style="color:var(--accent-magenta);"></i>';
  return '<i class="fas fa-file" style="color:var(--text-muted);"></i>';
}

function gitStatusHint(st) {
  if (st === '??') return 'U';
  if (st === 'M' || st === 'MM') return 'M';
  if (st === 'A') return 'A';
  if (st === 'D') return 'D';
  if (st.startsWith('R')) return 'R';
  if (st.startsWith('U') || st.includes('U')) return 'U';
  return st.slice(0, 1) || 'U';
}

async function refreshGitPanel() {
  const tree = $('#git-tree');
  if (!tree) return;
  if (!currentRootDir || !window.electronAPI?.terminalExecute) {
    tree.innerHTML = '<div class="git-empty">' + (currentRootDir ? 'Git requires Electron' : 'No folder opened<br><br>Open a folder to use source control') + '</div>';
    return;
  }
  tree.innerHTML = '<div class="git-empty"><span class="spinner"></span> Loading git status...</div>';
  try {
    // branch
    const branchRes = await runCommandCapture('git rev-parse --abbrev-ref HEAD || git branch --show-current', { cwd: currentRootDir });
    if (branchRes.out && branchRes.out.trim()) gitBranch = branchRes.out.trim().split('\n')[0] || 'main';
    else gitBranch = 'main';
    // status
    const res = await runCommandCapture('git status --porcelain', { cwd: currentRootDir });
    gitFiles = [];
    if (res.out && res.out.trim()) {
      res.out.split('\n').forEach(line => {
        const m = line.match(/^(\S+)\s+(.+)$/);
        if (!m) return;
        const status = m[1];
        const path = m[2].trim();
        gitFiles.push({ path, status });
      });
    }
    renderGit();
  } catch (e) {
    tree.innerHTML = '<div class="git-empty">Git error: ' + escapeHtml(e.message) + '</div>';
  }
}

function renderGit() {
  const tree = $('#git-tree');
  const badge = $('#git-badge');
  if (badge) { badge.textContent = gitFiles.length; badge.classList.toggle('hidden', gitFiles.length === 0); }
  if (!gitFiles.length) {
    tree.innerHTML = '<div class="git-empty"><i class="fas fa-check-circle" style="color:var(--accent-green);margin-right:6px;"></i>No changes<br><br><span style="font-size:11px;">' + escapeHtml(gitBranch || 'main') + '</span></div>';
    return;
  }
  tree.innerHTML = `<div class="git-item" style="color:var(--text-secondary);font-size:11px;padding-bottom:4px;"><i class="fas fa-code-branch"></i> ${escapeHtml(gitBranch)} — ${gitFiles.length} change${gitFiles.length !== 1 ? 's' : ''}</div>` +
    gitFiles.map((f, i) => `<div class="git-item ${gitClass(f.status)}" data-idx="${i}">
      <span class="icon">${gitFileIcon(f.status)}</span>
      <span class="name">${escapeHtml(f.path)}</span>
      <span class="name" style="flex:0 0 20px;margin-left:6px;color:var(--text-muted);font-size:11px;">${gitStatusHint(f.status)}</span>
    </div>`).join('');
  $$('#git-tree .git-item[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const f = gitFiles[parseInt(el.dataset.idx)];
      if (!f) return;
      const full = joinPath(currentRootDir, f.path);
      showContextMenu(el.getBoundingClientRect().left, el.getBoundingClientRect().bottom, [
        { icon: 'fas fa-external-link-alt', label: 'Open', action: () => openFile(full, basename(f.path)) },
        { icon: 'fas fa-check-circle', label: 'Stage (git add)', action: () => gitStage(f.path) },
        { icon: 'fas fa-undo', label: 'Discard Changes', action: () => gitDiscard(f.path) },
        { sep: true },
        { icon: 'fas fa-copy', label: 'Copy Path', action: () => { navigator.clipboard.writeText(full); toast('Path copied', 'success', null, 1500); } }
      ]);
    });
  });
}

function gitClass(status) {
  if (status === '??') return 'untracked';
  if (status.startsWith('M')) return 'modified';
  if (status.startsWith('A')) return 'added';
  if (status.startsWith('D')) return 'deleted';
  return '';
}

function gitStage(path) {
  runCommandCapture(`git add "${path.replace(/"/g, '\\"')}"`, { cwd: currentRootDir }).then(() => {
    toast('Staged: ' + path, 'success', null, 1500);
    refreshGitPanel();
  });
}

function gitDiscard(path) {
  if (!confirm(`Discard all changes to "${path}"?`)) return;
  const safe = path.replace(/"/g, '\\"');
  (async () => {
    await runCommandCapture(`git checkout -- "${safe}"`, { cwd: currentRootDir });
    await runCommandCapture(`git clean -fd -- "${safe}"`, { cwd: currentRootDir });
    refreshGitPanel();
    toast('Discarded: ' + path, 'success', null, 1500);
  })();
}

async function gitCommit() {
  if (!gitFiles.length) { toast('No staged changes — stage files first', 'warning'); return; }
  const msg = prompt('Commit message:');
  if (!msg) return;
  await runCommandCapture(`git add -A`, { cwd: currentRootDir });
  const res = await runCommandCapture(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: currentRootDir });
  addOutputLine('git', res.out || res.err);
  if (res.ok) { toast('Commit created', 'success'); addSystemMessage('Commit: ' + msg); }
  else toast('Commit: ' + (res.err || res.out || 'failed'), 'error');
  refreshGitPanel();
}

async function gitPush() {
  const res = await runCommandCapture('git push', { cwd: currentRootDir });
  addOutputLine('git', res.out || res.err);
  toast(res.ok ? 'Pushed' : 'Push: ' + (res.err || 'failed'), res.ok ? 'success' : 'error');
  refreshGitPanel();
}

async function gitPull() {
  const res = await runCommandCapture('git pull', { cwd: currentRootDir });
  addOutputLine('git', res.out || res.err);
  toast(res.ok ? 'Pulled' : 'Pull: ' + (res.err || 'failed'), res.ok ? 'success' : 'error');
  refreshGitPanel();
}

async function gitInit() {
  const res = await runCommandCapture('git init', { cwd: currentRootDir });
  toast(res.ok ? 'Repository initialized' : 'Init failed', res.ok ? 'success' : 'error');
  refreshGitPanel();
}

// ═══════════════════════════════════════════════════════════════════
// RUN & DEBUG
// ═══════════════════════════════════════════════════════════════════
function debugPanelText(msg, type = '') {
  const dc = $('#debug-content');
  if (!dc) return;
  const div = document.createElement('div');
  div.className = 'output-line ' + type;
  div.textContent = msg;
  dc.appendChild(div);
  dc.scrollTop = dc.scrollHeight;
}

async function buildDebugTree() {
  const tree = $('#debug-tree');
  if (!tree) return;
  // launch config files
  const launchPath = currentRootDir ? joinPath(currentRootDir, '.vscode', 'launch.json') : null;
  let hasLaunch = false;
  if (launchPath && window.electronAPI?.readFile) {
    try {
      const r = await window.electronAPI.readFile(launchPath);
      hasLaunch = !!(r && r.success);
    } catch (e) {}
  }
  tree.innerHTML = `
    ${hasLaunch
      ? '<div class="git-item" style="font-size:11px;color:var(--accent-green);"><i class="fas fa-check-circle"></i> launch.json configurato</div>'
      : '<div class="git-item" style="font-size:11px;color:var(--text-secondary);"><i class="fas fa-exclamation-triangle"></i> Nessuna configurazione</div>'}
    <div class="git-item" data-action="run" style="margin-top:6px;"><i class="fas fa-play" style="color:var(--accent-green);"></i> Esegui il file attivo</div>
    <div class="git-item" data-action="node"><i class="fab fa-node-js"></i> Esegui con Node</div>
    <div class="git-item" data-action="python"><i class="fab fa-python"></i> Esegui con Python</div>
    <div class="git-item" data-action="config"><i class="fas fa-cog"></i> Crea launch.json</div>
  `;
  $$('#debug-tree .git-item[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const a = el.dataset.action;
      if (a === 'run') runActiveFile();
      else if (a === 'node') runWithRunner('node');
      else if (a === 'python') runWithRunner('python');
      else if (a === 'config') configureLaunchJson();
    });
  });
}

async function configureLaunchJson() {
  if (!currentRootDir) { toast('Open a folder first', 'warning'); return; }
  const launchPath = joinPath(currentRootDir, '.vscode', 'launch.json');
  const content = JSON.stringify({
    version: '0.2.0',
    configurations: [
      { name: 'Run with Node', type: 'node', request: 'launch', program: '${file}', skipFiles: ['<node_internals>/**'] },
      { name: 'Run Python', type: 'python', request: 'launch', program: '${file}', console: 'integratedTerminal' }
    ]
  }, null, 2);
  if (window.electronAPI?.writeFile) {
    const r = await window.electronAPI.writeFile({ filePath: launchPath, content });
    toast(r.success ? 'launch.json creato' : 'Errore: ' + r.error, r.success ? 'success' : 'error');
    if (r.success) { refreshFileTree(); buildDebugTree(); }
  }
}

async function startDebug() {
  if (!activeFilePath) { toast('Open a file to debug', 'warning'); return; }
  debugPanelText('▶ Starting debug session...');
  const ext = getExt(activeFilePath);
  const runner = ext === 'py' ? 'python' : ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'ts' ? 'node' : null;
  if (!runner) { debugPanelText('No debug runner for .' + ext, 'error'); toast('No debug runner available', 'warning'); return; }
  switchBottomTab('debug');
  toggleBottomPanel(true);
  debugSession.running = true;
  const cmd = `${runner} "${activeFilePath.replace(/"/g, '\\"')}"`;
  const res = await window.electronAPI.terminalExecute(cmd);
  if (res && res.success) {
    debugSession.procId = res.procId;
    debugSession.name = basename(activeFilePath);
    terminalProcIds.add(res.procId);
    debugPanelText('Running: ' + cmd, '');
  } else {
    debugSession.running = false;
    debugPanelText('Failed to start: ' + ((res && res.error) || ''), 'error');
  }
}

function stopDebug() {
  if (!debugSession.running) { toast('No active debug session', 'info'); return; }
  if (debugSession.procId) window.electronAPI?.terminalKill?.(debugSession.procId);
  terminalProcIds.delete(debugSession.procId);
  debugSession.procId = null;
  debugSession.running = false;
  debugPanelText('■ Debug stopped');
  toast('Debug stopped', 'info');
}

// ═══════════════════════════════════════════════════════════════════
// SPLIT VIEW (editor affiancato + versione "diff" semplice)
// ═══════════════════════════════════════════════════════════════════
function openSplitEditor() {
  if (!activeFilePath) { toast('Open a file first', 'warning'); return; }
  const splitEl = $('#editor-split');
  if (!splitEl) return;
  if (window._splitEditor) { closeSplitEditor(); return; }
  const right = document.createElement('div');
  right.id = 'split-editor-right';
  right.style.cssText = 'flex:1;min-width:0;position:relative;';
  right.innerHTML = '<div style="position:absolute;inset:0;"></div>';
  splitEl.appendChild(right);
  const ed2 = monaco.editor.create(right.firstChild, {
    value: '',
    language: 'plaintext',
    theme: editorSettings.theme,
    automaticLayout: true,
    readOnly: false,
    minimap: { enabled: false },
    fontSize: editorSettings.fontSize
  });
  window.electronAPI?.readFile?.(activeFilePath).then(r => {
    if (r && r.success) ed2.setValue(r.content || '');
  });
  window._splitEditor = ed2;
  splitEditorActive = true;
  toast('Split view opened', 'info');
}
function closeSplitEditor() {
  if (window._splitEditor) { window._splitEditor.dispose(); window._splitEditor = null; }
  $('#split-editor-right')?.remove();
  splitEditorActive = false;
}

// ═══════════════════════════════════════════════════════════════════
// ABOUT
// ═══════════════════════════════════════════════════════════════════
function openAbout() {
  toast('S.A.V.I.A. IDE', 'info', 'Monaco Editor · Electron', 3000);
}

// ═══════════════════════════════════════════════════════════════════
// URL PARAM + IPC open-editor / load-file
// ═══════════════════════════════════════════════════════════════════
function handleLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  const file = params.get('file');
  const folder = params.get('folder');
  if (file) { setTimeout(() => { openFile(decodeURIComponent(file), basename(decodeURIComponent(file))); }, 400); }
  else if (folder) { importFolder(decodeURIComponent(folder)); }
}

function wireEditorIpc() {
  if (window.electronAPI?.onLoadFile) {
    window.electronAPI.onLoadFile((filePath) => {
      if (filePath) openFile(filePath, basename(filePath));
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN INIT
// ═══════════════════════════════════════════════════════════════════
function initIDE() {
  ensureMonacoLoaded(function () {
    // welcome screen è già in html; assicuriamoci che ci sia
    if (!$('#welcome-screen')) showWelcome();
    // stato persistito
    try {
      const sp = localStorage.getItem('savia.ide.settings');
      if (sp) Object.assign(editorSettings, JSON.parse(sp));
      const recentFile = localStorage.getItem('savia.lastProject');
    } catch (e) {}
    const lastProj = getRecentProjects()[0];
    if (lastProj) { /* non aprire automaticamente; segnala */ }
    // riapertura ultima sessione file (se presente)
    const lastFile = localStorage.getItem('savia.lastFile');
    if (lastFile && !window.location.search.includes('file=')) {
      // apriamo dopo un piccolo ritardo
      setTimeout(() => { if (window.electronAPI?.readFile) openFile(lastFile, basename(lastFile)); }, 300);
    }
  });
  wireTitleBar();
  wireMenus();
  wireActivityBar();
  wireSidebar();
  wireFindBar();
  wireSearchPanel();
  wireBottomPanel();
  wireStatusBar();
  wireTerminal();
  wireTerminalOutput();
  wireGlobalShortcuts();
  wireEditorIpc();
  handleLaunchParams();
  // stato iniziale
  renderExtensions('');
  renderOutput();
  refreshOutline();
  // badge terminale
  $('#terminal-badge').textContent = '1';
}

function wireTitleBar() {
  $('#btn-minimize')?.addEventListener('click', () => window.electronAPI?.windowMinimize?.() || window.electronAPI?.minimize?.());
  $('#btn-maximize')?.addEventListener('click', () => window.electronAPI?.windowMaximize?.() || window.electronAPI?.maximize?.());
  $('#btn-close')?.addEventListener('click', () => window.electronAPI?.windowClose?.() || window.electronAPI?.close?.());
}

function wireMenus() {
  $$('.menu-item[data-menu]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      renderDropdown(el);
      const dd = el.querySelector('.menu-dropdown');
      const isOpen = dd.classList.contains('open');
      closeAllMenus();
      if (!isOpen) { dd.classList.add('open'); el.classList.add('active'); }
    });
  });
}

function wireActivityBar() {
  $$('.activity-icon').forEach(el => {
    el.addEventListener('click', () => {
      const panel = el.dataset.panel;
      const action = el.dataset.action;
      if (action) {
        if (action === 'settings') { openSettings(); }
        else if (action === 'terminal-btn') { toggleBottomPanel(true); switchBottomTab('terminal'); }
        return;
      }
      if (panel) switchActivity(panel);
    });
  });
}

function wireSidebar() {
  // resizer
  const resizer = $('#sidebar-resizer');
  if (resizer) {
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizer.classList.add('active');
      const startX = e.clientX;
      const startW = $('#sidebar').offsetWidth;
      const move = (ev) => {
        const w = Math.max(150, Math.min(600, startW + (ev.clientX - startX)));
        $('#sidebar').style.width = w + 'px';
      };
      const up = () => {
        resizer.classList.remove('active');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        localStorage.setItem('savia.sidebarWidth', $('#sidebar').offsetWidth);
        setTimeout(() => editors.forEach(ed => ed.layout()), 50);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    try { const w = parseInt(localStorage.getItem('savia.sidebarWidth')); if (w) $('#sidebar').style.width = w + 'px'; } catch (e) {}
  }
  // explorer actions
  $('#btn-new-file')?.addEventListener('click', () => createNewFile(currentRootDir));
  $('#btn-new-folder')?.addEventListener('click', createNewFolder);
  $('#btn-refresh')?.addEventListener('click', refreshFileTree);
  $('#btn-collapse-all')?.addEventListener('click', collapseAllFolders);
  $('#btn-open-folder')?.addEventListener('click', importFolder);
  // search actions
  $('#btn-refresh-search')?.addEventListener('click', runProjectSearch);
  $('#btn-collapse-search')?.addEventListener('click', () => { $('#search-results').innerHTML = '<div class="problem-empty">Type to search across files</div>'; });
  // git actions
  $('#btn-git-refresh')?.addEventListener('click', refreshGitPanel);
  $('#btn-git-commit')?.addEventListener('click', gitCommit);
  $('#btn-git-more')?.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.left, r.bottom, [
      { icon: 'fas fa-chevron-up', label: 'Pull', action: gitPull },
      { icon: 'fas fa-chevron-down', label: 'Push', action: gitPush },
      { sep: true },
      { icon: 'fas fa-plus', label: 'Initialize Repository', action: gitInit }
    ]);
  });
  // debug
  $('#btn-debug-config')?.addEventListener('click', configureLaunchJson);
  // outline collapse
  $('#btn-outline-collapse')?.addEventListener('click', () => { $('#outline-tree').innerHTML = ''; });
  // section toggles
  $('#open-editors-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const body = $('#open-editors-wrap');
    body.classList.toggle('collapsed');
    $('#open-editors-toggle .chevron i').className = 'fas fa-chevron-' + (body.classList.contains('collapsed') ? 'right' : 'down');
  });
  $('#file-tree-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const body = $('#file-tree-wrap');
    body.classList.toggle('collapsed');
    $('#file-tree-toggle .chevron i').className = 'fas fa-chevron-' + (body.classList.contains('collapsed') ? 'right' : 'down');
  });
  // search input wiring
  $('#search-input')?.addEventListener('input', debounce(() => runProjectSearch(), 400));
  $('#replace-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') replaceAllInProject(); });
  // option checkboxes
  ['opt-match-case', 'opt-whole-word', 'opt-regex', 'opt-preserve-case'].forEach(id => {
    const cb = $('#' + id);
    if (cb) cb.addEventListener('change', () => { searchOptions[id.replace('opt-', '')] = cb.checked; runProjectSearch(); });
  });
  // ext search
  $('#ext-search')?.addEventListener('input', (e) => renderExtensions(e.target.value));
}

function debounce(fn, ms) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

function wireFindBar() {
  const input = $('#find-input');
  const rep = $('#replace-input-2');
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); performFind(!e.shiftKey); }
    else if (e.key === 'Escape') closeFind();
  });
  rep?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) findReplaceAll(); else findReplace(); }
  });
  $('#find-prev')?.addEventListener('click', () => performFind(false));
  $('#find-next')?.addEventListener('click', () => performFind(true));
  $('#find-replace-btn')?.addEventListener('click', findReplace);
  $('#find-replace-all')?.addEventListener('click', findReplaceAll);
  $('#find-close')?.addEventListener('click', closeFind);
  $('#find-toggle-case')?.addEventListener('click', () => { findOpts.matchCase = !findOpts.matchCase; toggleBtn($('#find-toggle-case'), findOpts.matchCase); });
  $('#find-toggle-word')?.addEventListener('click', () => { findOpts.wholeWord = !findOpts.wholeWord; toggleBtn($('#find-toggle-word'), findOpts.wholeWord); });
  $('#find-toggle-regex')?.addEventListener('click', () => { findOpts.regex = !findOpts.regex; toggleBtn($('#find-toggle-regex'), findOpts.regex); });
}
function toggleBtn(btn, on) { if (btn) btn.classList.toggle('active', on); }

function wireSearchPanel() {
  const wrap = $('#search-input-wrap');
  if (wrap) wrap.addEventListener('click', () => $('#search-input')?.focus());
}

function wireBottomPanel() {
  $$('.panel-tab').forEach(t => t.addEventListener('click', () => switchBottomTab(t.dataset.tab)));
  $('#btn-panel-toggle')?.addEventListener('click', () => toggleBottomPanel());
  $('#btn-panel-clear')?.addEventListener('click', () => {
    if (activeBottomTab === 'terminal') clearTerminal();
    else if (activeBottomTab === 'output') { const ch = $('#output-channel-select')?.value || 'extension'; outputLines = []; renderOutput(); }
    else if (activeBottomTab === 'debug') $('#debug-content').innerHTML = '';
  });
  $('#btn-panel-split')?.addEventListener('click', () => openSplitEditor());
  $('#output-channel-select')?.addEventListener('change', renderOutput);
  // terminal add
  $('.terminal-tab-add')?.addEventListener('click', addNewTerminal);
  wireTerminalTabEvents();
}

function wireStatusBar() {
  $('#status-branch')?.addEventListener('click', () => { switchActivity('git'); refreshGitPanel(); });
  $('#status-notifications')?.addEventListener('click', () => toast('Nessuna notifica', 'info', null, 1200));
  $('#status-lang')?.addEventListener('click', () => { switchActivity('extensions'); });
  $('#status-indent')?.addEventListener('click', () => { editorSettings.tabSize = editorSettings.tabSize === 2 ? 4 : 2; editors.forEach(ed => ed.updateOptions({ tabSize: editorSettings.tabSize })); updateStatusBar(); });
  $('#status-eol')?.addEventListener('click', () => {
    if (!activeEditor) return;
    const model = activeEditor.getModel();
    const next = model.getEOL() === '\n' ? '\r\n' : '\n';
    model.pushEOL(next);
    updateStatusBar();
  });
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════
function wireGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const tag = (e.target.tagName || '').toLowerCase();
    // Ignora quando fai digitare dentro input/textarea/terminal (se non sono shortcut esplicite di salvataggio)
    const inInput = (tag === 'input' || tag === 'textarea');

    // Palette (Ctrl+Shift+P, F1)
    if ((mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) || e.key === 'F1') {
      if (!inInput) { e.preventDefault(); openCommandPalette(); return; }
    }
    // Quick open (Ctrl+P)
    if (mod && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
      if (!inInput) { e.preventDefault(); showQuickOpen(); return; }
    }
    // Save
    if (mod && (e.key === 's' || e.key === 'S')) {
      if (e.shiftKey) { e.preventDefault(); saveAs(); }
      else { e.preventDefault(); saveCurrentFile(); }
      return;
    }
    // Save all (Ctrl+K Ctrl+S)
    if (mod && e.key === 's' && e.altKey) { e.preventDefault(); saveAll(); return; }
    // Alt+Z word wrap
    if (e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); toggleWordWrap(); return; }
    // Ctrl+B sidebar
    if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleSidebar(); return; }
    // Ctrl+` terminal
    if (mod && (e.key === '`' || e.key === '\u00F9' || e.key === 'ù')) { e.preventDefault(); toggleBottomPanel(); return; }
    // Ctrl+Shift+` new terminal
    if (mod && e.shiftKey && (e.key === '`')) { e.preventDefault(); addNewTerminal(); return; }
    // Ctrl+W close tab
    if (mod && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
      if (!inInput) { e.preventDefault(); if (activeTab) closeTab(activeTab, {}); return; }
    }
    // Ctrl+F find
    if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      if (!inInput) { e.preventDefault(); openFind(); return; }
    }
    // Ctrl+Shift+F search panel
    if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); switchActivity('search'); setTimeout(() => $('#search-input')?.focus(), 50); return; }
    // Ctrl+Shift+E / G / D / X
    if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); switchActivity('explorer'); return; }
    if (mod && e.shiftKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); switchActivity('git'); refreshGitPanel(); return; }
    if (mod && e.shiftKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); switchActivity('debug'); buildDebugTree(); return; }
    if (mod && e.shiftKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); switchActivity('extensions'); return; }
    // Ctrl+, settings
    if (mod && (e.key === ',')) { e.preventDefault(); openSettings(); return; }
    // Ctrl+G go to line
    if (mod && !e.shiftKey && (e.key === 'g' || e.key === 'G')) { if (!inInput) { e.preventDefault(); showGoToLine(); return; } }
    // Ctrl+Shift+O symbol
    if (mod && e.shiftKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); showGoToSymbol(); return; }
    // Ctrl+Shift+M problems
    if (mod && e.shiftKey && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); switchBottomTab('problems'); toggleBottomPanel(true); return; }
    // Ctrl+O open
    if (mod && !e.shiftKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openSingleFile(); return; }
    // Ctrl+N new file
    if (mod && !e.shiftKey && (e.key === 'n' || e.key === 'N')) { if (!inInput) { e.preventDefault(); createNewFile(currentRootDir); } return; }
    // F5 start debug / Shift+F5 stop
    if (e.key === 'F5') { if (e.shiftKey) { stopDebug(); } else { startDebug(); } e.preventDefault(); return; }
    // F12 go to definition
    if (e.key === 'F12') { if (!e.shiftKey) activeEditor?.trigger('keyboard', 'editor.action.revealDefinition', null); else activeEditor?.trigger('keyboard', 'editor.action.referenceSearch.trigger', null); e.preventDefault(); }
  });

  // Palette navigation
  $('#palette-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteNavigate(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteNavigate(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); paletteSelect(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); }
  });
  $('#palette-input')?.addEventListener('input', () => renderPaletteList($('#palette-input').value));

  // Quick open navigation
  $('#qo-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); qoNavigate(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); qoNavigate(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); qoSelect(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeQuickOpen(); }
  });
  $('#qo-input')?.addEventListener('input', () => renderQuickOpenList());

  // overlay close on click outside
  $('#palette-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'palette-overlay') closeCommandPalette(); });
  $('#quick-open-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'quick-open-overlay') closeQuickOpen(); });

  // welcome actions
  $('#welcome-open-folder')?.addEventListener('click', importFolder);
  $('#welcome-open-file')?.addEventListener('click', openSingleFile);
  $('#welcome-clone')?.addEventListener('click', promptCloneRepo);
  $('#welcome-new-file')?.addEventListener('click', () => createNewFile(currentRootDir));

  // modal close
  $('#settings-close')?.addEventListener('click', closeSettings);
  $$('.ms-item').forEach(el => el.addEventListener('click', () => renderSettingsSection(el.dataset.section)));
  $('#settings-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'settings-overlay') closeSettings(); });
}

// ═══════════════════════════════════════════════════════════════════
// AVVIO
// ═══════════════════════════════════════════════════════════════════
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIDE);
} else {
  initIDE();
}

// ── Apertura scheda/finestra: attiva le animazioni (html.savia-open)
// quando la finestra diventa visibile → l'entrata è visibile in ogni pagina.
(function () {
  function triggerOpenAnim() {
    var root = document.documentElement;
    root.classList.remove('savia-open');
    void root.offsetWidth;
    root.classList.add('savia-open');
  }
  function onVisible() {
    if (document.visibilityState === 'visible') triggerOpenAnim();
  }
  document.addEventListener('visibilitychange', onVisible);
  if (document.visibilityState === 'visible') {
    if (document.readyState === 'complete') {
      setTimeout(triggerOpenAnim, 60);
    } else {
      window.addEventListener('load', function () { setTimeout(triggerOpenAnim, 60); });
    }
  }
})();
