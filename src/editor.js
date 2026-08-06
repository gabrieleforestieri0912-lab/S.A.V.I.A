require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});

const editors = new Map();
let activeEditor = null;
let activeTab = null;
let activeFilePath = null;
let currentRootDir = null;
let fileTreeData = {};
let openTabs = [];
let unsavedFiles = new Set();
let findState = null;
let mouseX = 0;
let importedProjectRoot = null;
let importedProjectName = null;

const ICONS = {
  js: 'fab fa-js-square', ts: 'fab fa-js-square', html: 'fab fa-html5', css: 'fab fa-css3-alt',
  json: 'fas fa-brackets-curly', json2: 'fas fa-code', md: 'fab fa-markdown',
  py: 'fab fa-python', java: 'fab fa-java', c: 'fas fa-c', cpp: 'fas fa-c', cs: 'fas fa-c',
  go: 'fab fa-golang', rs: 'fas fa-gear', sh: 'fas fa-terminal', bat: 'fas fa-terminal',
  yaml: 'fas fa-file-lines', yml: 'fas fa-file-lines', xml: 'fas fa-file-code',
  sql: 'fas fa-database', php: 'fab fa-php', rb: 'fas fa-gem', lua: 'fas fa-gamepad',
  r: 'fab fa-r-project', kt: 'fas fa-code', swift: 'fab fa-swift', default: 'fas fa-file'
};

const EXT_TO_LANG = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', md: 'markdown', py: 'python', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  go: 'go', rs: 'rust', sh: 'shell', bat: 'shell', ps1: 'powershell',
  yaml: 'yaml', yml: 'yaml', xml: 'xml', sql: 'sql', php: 'php',
  rb: 'ruby', lua: 'lua', r: 'r', kt: 'kotlin', swift: 'swift',
  toml: 'ini', ini: 'ini', cfg: 'ini', env: 'plaintext', txt: 'plaintext'
};

function getFileIcon(name, isDir) {
  if (isDir) return '<span class="icon" style="color: #ffd700;"><i class="fas fa-folder"></i></span>';
  const ext = name.split('.').pop().toLowerCase();
  const icon = ICONS[ext] || 'fas fa-file';
  return `<span class="icon"><i class="${icon}"></i></span>`;
}

// ── Tabs ──────────────────────────────────────────────────────────────

function createTab(filePath, label) {
  const existing = openTabs.find(t => t.path === filePath);
  if (existing) { setActiveTab(filePath); return; }

  openTabs.push({ path: filePath, label: label || filePath.split('/').pop() });
  renderTabs();
  openEditorForFile(filePath);
}

function closeTab(filePath, event) {
  event.stopPropagation();
  if (unsavedFiles.has(filePath)) {
    if (!confirm(`"${filePath.split('/').pop()}" has unsaved changes. Close anyway?`)) return;
    unsavedFiles.delete(filePath);
  }

  const idx = openTabs.findIndex(t => t.path === filePath);
  if (idx >= 0) openTabs.splice(idx, 1);

  const ed = editors.get(filePath);
  if (ed) { ed.dispose(); editors.delete(filePath); }

  if (activeTab === filePath) {
    if (openTabs.length > 0) {
      const next = openTabs[Math.min(idx, openTabs.length - 1)];
      setActiveTab(next.path);
    } else {
      activeTab = null;
      activeEditor = null;
      activeFilePath = null;
      document.getElementById('editor-container').innerHTML = '';
      showWelcome();
    }
  }
  renderTabs();
  updateStatusBar();
}

function setActiveTab(filePath) {
  activeTab = filePath;
  document.querySelectorAll('.tab-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path === filePath);
  });

  document.querySelectorAll('.tree-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path === filePath);
  });

  const ed = editors.get(filePath);
  if (ed) {
    activeEditor = ed;
    activeFilePath = filePath;
    ed.getElement().style.display = 'block';
    ed.focus();
    updateStatusBar();
  }
}

function renderTabs() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';
  openTabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.path === activeTab ? ' active' : '') + (unsavedFiles.has(tab.path) ? ' unsaved' : '');
    el.dataset.path = tab.path;
    el.innerHTML = `
      <span class="unsaved-dot"></span>
      <span class="tab-icon">${getFileIcon(tab.label, false)}</span>
      <span class="tab-name">${tab.label}</span>
      <span class="tab-close" data-close="${tab.path}"><i class="fas fa-times"></i></span>
    `;
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close')) setActiveTab(tab.path);
    });
    bar.appendChild(el);
  });

  bar.querySelectorAll('.tab-close').forEach(btn => {
    btn.addEventListener('click', (e) => closeTab(btn.dataset.close, e));
  });
}

function showWelcome() {
  const container = document.getElementById('editor-container');
  container.innerHTML = `
    <div class="welcome-screen" id="welcome-screen">
      <div class="welcome-logo"><i class="fas fa-code"></i></div>
      <div class="welcome-title">S.A.V.I.A. EDITOR</div>
      <div class="welcome-sub">Open a file from the explorer to get started</div>
    </div>
  `;
}

// ── File Explorer ─────────────────────────────────────────────────────

function renderFileTree() {
  const tree = document.getElementById('file-tree');
  tree.innerHTML = '';
  if (!fileTreeData || Object.keys(fileTreeData).length === 0) {
    tree.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 12px;">No files loaded</div>';
    return;
  }

  function renderFolder(name, children, depth) {
    const isExpanded = true;
    const hasChildren = Object.keys(children).length > 0;
    const div = document.createElement('div');

    const folderHeader = document.createElement('div');
    folderHeader.className = 'tree-item folder-item';
    folderHeader.style.paddingLeft = (16 + depth * 18) + 'px';
    folderHeader.innerHTML = `
      <span class="chevron expanded"><i class="fas fa-chevron-right"></i></span>
      <span class="icon"><i class="fas fa-folder-open" style="color: var(--accent-gold);"></i></span>
      <span class="name">${name}</span>
    `;
    div.appendChild(folderHeader);

    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    Object.keys(children).sort((a, b) => {
      const aIsDir = children[a].type === 'dir';
      const bIsDir = children[b].type === 'dir';
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    }).forEach(childName => {
      const child = children[childName];
      if (child.type === 'dir') {
        childrenDiv.appendChild(renderFolder(childName, child.children, depth + 1));
      } else {
        const fileItem = document.createElement('div');
        fileItem.className = 'tree-item file-item';
        fileItem.style.paddingLeft = (16 + (depth + 1) * 18) + 'px';
        fileItem.dataset.path = child.path;
        fileItem.innerHTML = `
          <span class="icon"><i class="${ICONS[child.ext] || ICONS.default}"></i></span>
          <span class="name ${child.modified ? 'modified' : ''}">${child.name}</span>
        `;
        fileItem.addEventListener('click', () => openFile(child.path, child.name));
        childrenDiv.appendChild(fileItem);
      }
    });
    div.appendChild(childrenDiv);

    folderHeader.addEventListener('click', () => {
      const chevron = folderHeader.querySelector('.chevron');
      chevron.classList.toggle('expanded');
      childrenDiv.style.display = childrenDiv.style.display === 'none' ? '' : 'none';
      const folderIcon = folderHeader.querySelector('.icon i');
      folderIcon.className = childrenDiv.style.display === 'none' ? 'fas fa-folder' : 'fas fa-folder-open';
      folderIcon.style.color = 'var(--accent-gold)';
    });

    return div;
  }

  Object.keys(fileTreeData).sort().forEach(name => {
    const item = fileTreeData[name];
    if (item.type === 'dir') {
      tree.appendChild(renderFolder(name, item.children || {}, 0));
    } else {
      const el = document.createElement('div');
      el.className = 'tree-item file-item';
      el.dataset.path = item.path;
      el.innerHTML = `<span class="chevron"></span><span class="icon"><i class="${ICONS[item.ext] || ICONS.default}"></i></span><span class="name">${name}</span>`;
      el.addEventListener('click', () => openFile(item.path, name));
      tree.appendChild(el);
    }
  });
}

function openFile(filePath, fileName) {
  if (!filePath) return;
  const resp = window.electronAPI?.readFile(filePath);
  if (!resp) return;

  document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
  const treeItem = document.querySelector(`.tree-item[data-path="${filePath}"]`);
  if (treeItem) treeItem.classList.add('active');

  document.getElementById('welcome-screen')?.remove();
  createTab(filePath, fileName);

  if (resp.success && resp.content !== undefined) {
    const ed = editors.get(filePath);
    if (ed) {
      ed.setValue(resp.content);
      const ext = filePath.split('.').pop().toLowerCase();
      monaco.editor.setModelLanguage(ed.getModel(), EXT_TO_LANG[ext] || 'plaintext');
    }
  }
  updateStatusBar();
}

// ── Monaco editors ────────────────────────────────────────────────────

function openEditorForFile(filePath) {
  if (editors.has(filePath)) {
    setActiveTab(filePath);
    return;
  }

  const existing = document.querySelector('.monaco-editor');
  if (existing) existing.style.display = 'none';

  const container = document.createElement('div');
  container.id = 'monaco-' + filePath.replace(/[^a-zA-Z0-9]/g, '_');
  container.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';
  if (activeEditor) {
    const parent = activeEditor.getElement().parentElement;
    if (parent) parent.appendChild(container);
    else document.getElementById('editor-container').appendChild(container);
  } else {
    document.getElementById('editor-container').appendChild(container);
  }

  const ed = monaco.editor.create(container, {
    value: '// Loading...',
    language: 'plaintext',
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 14,
    fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    minimap: { enabled: true, scale: 1 },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    padding: { top: 8 },
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    autoIndent: 'full',
    formatOnPaste: true,
    lineNumbers: 'on',
    glyphMargin: true,
    folding: true,
    lineDecorationsWidth: 10,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    contextmenu: true,
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    parameterHints: { enabled: true },
    wordWrapColumn: 120,
    wrappingStrategy: 'advanced',
  });

  ed.getModel().onDidChangeContent(() => {
    unsavedFiles.add(filePath);
    updateTab(filePath);
    updateStatusBar();
  });

  ed.onDidChangeCursorPosition((e) => {
    document.getElementById('status-lines').textContent =
      `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });

  editors.set(filePath, ed);
  activeEditor = ed;
  activeFilePath = filePath;
  setActiveTab(filePath);

  if (window.electronAPI?.readFile) {
    window.electronAPI.readFile(filePath).then(resp => {
      if (resp.success) {
        ed.setValue(resp.content);
        const ext = filePath.split('.').pop().toLowerCase();
        monaco.editor.setModelLanguage(ed.getModel(), EXT_TO_LANG[ext] || 'plaintext');
        document.getElementById('status-lang').textContent =
          (EXT_TO_LANG[ext] || 'Plain Text').toUpperCase();
      }
    });
  } else {
    fetch(filePath).then(r => r.text()).then(txt => {
      ed.setValue(txt);
      const ext = filePath.split('.').pop().toLowerCase();
      monaco.editor.setModelLanguage(ed.getModel(), EXT_TO_LANG[ext] || 'plaintext');
    });
  }
}

function updateTab(filePath) {
  const tabEl = document.querySelector(`.tab-item[data-path="${filePath}"]`);
  if (tabEl) tabEl.classList.toggle('unsaved', unsavedFiles.has(filePath));
}

function switchToTab(filePath) {
  if (activeEditor) activeEditor.getElement().style.display = 'none';
  const ed = editors.get(filePath);
  if (ed) {
    ed.getElement().style.display = 'block';
    activeEditor = ed;
    activeFilePath = filePath;
    ed.focus();
    setActiveTab(filePath);
    updateStatusBar();
  }
}

// ── Save logic ────────────────────────────────────────────────────────

async function saveCurrentFile() {
  if (!activeEditor || !activeFilePath) return;
  const content = activeEditor.getValue();
  document.getElementById('status-text') && (document.getElementById('status-text').innerText = 'Salvataggio...');

  if (window.electronAPI?.writeFile) {
    const resp = await window.electronAPI.writeFile({ filePath: activeFilePath, content });
    if (resp.success) {
      unsavedFiles.delete(activeFilePath);
      updateTab(activeFilePath);
      updateStatusBar();
      addSystemMessage('File saved: ' + activeFilePath.split('/').pop());
    } else {
      addErrorMessage('Save failed: ' + resp.error);
    }
  }
  updateStatusBar();
}

// ── Terminal ──────────────────────────────────────────────────────────

function addTerminalLine(text, type = 'output') {
  const container = document.getElementById('terminal-container');
  const line = document.createElement('div');
  line.className = 'term-line ' + type;
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function executeCommand(cmd) {
  addTerminalLine(`$ ${cmd}`, 'command');
  const trimmed = cmd.trim();
  if (!trimmed) return;

  if (trimmed === 'clear' || trimmed === 'cls') {
    document.getElementById('terminal-container').innerHTML = '';
    return;
  }
  if (trimmed === 'help') {
    addTerminalLine('S.A.V.I.A. Editor Commands:', 'info');
    addTerminalLine('  help          - Show this help', 'info');
    addTerminalLine('  clear/cls     - Clear terminal', 'info');
    addTerminalLine('  save          - Save current file', 'info');
    addTerminalLine('  files/list    - List loaded files', 'info');
    addTerminalLine('  cd <path>     - Change directory', 'info');
    addTerminalLine('  pwd           - Print working directory', 'info');
    addTerminalLine('  run <file>    - Run a script', 'info');
    return;
  }
  if (trimmed === 'save') { saveCurrentFile(); return; }
  if (trimmed === 'files' || trimmed === 'list') {
    Object.keys(fileTreeData).forEach(k => addTerminalLine(`  ${k}`, 'output'));
    return;
  }
  if (trimmed === 'pwd') {
    addTerminalLine(currentRootDir || 'Unknown', 'output');
    return;
  }
  if (trimmed.startsWith('cd ')) {
    addTerminalLine(`Directory changed: ${trimmed.slice(3)}`, 'system');
    return;
  }
  if (trimmed.startsWith('run ')) {
    const f = trimmed.slice(4).trim();
    addTerminalLine(`Executing: ${f}...`, 'info');
    if (window.electronAPI?.terminalExecute) {
      window.electronAPI.terminalExecute(f).then(() => {
        addTerminalLine(`[Terminal process started for: ${f}]`, 'system');
      }).catch(e => addErrorMessage(e.message));
    } else {
      addTerminalLine('Terminal execution requires Electron environment.', 'error');
    }
    return;
  }

  if (window.electronAPI?.terminalExecute) {
    window.electronAPI.terminalExecute(trimmed);
  } else {
    addErrorMessage('Terminal not available (not running in Electron)');
  }
}

window.electronAPI?.onTerminalOutput?.((e) => {
  const { type, data } = e;
  if (type === 'stdout') addTerminalLine(data, 'output');
  else if (type === 'stderr') addTerminalLine(data, 'error');
  else if (type === 'exit') addTerminalLine(`[Process exited with code ${data}]`, 'system');
  else if (type === 'error') addTerminalLine(data, 'error');
});

// ── Find ──────────────────────────────────────────────────────────────

function openFind() {
  document.getElementById('find-bar').classList.add('visible');
  const input = document.getElementById('find-input');
  input.value = '';
  input.focus();
  findState = null;
}

function performFind(forward = true) {
  const query = document.getElementById('find-input').value;
  if (!query || !activeEditor) { document.getElementById('find-info').textContent = '0 results'; return; }

  const model = activeEditor.getModel();
  const matches = model.findMatches(query, false, true, false, null, true);
  if (matches.length === 0) {
    document.getElementById('find-info').textContent = 'No results';
    return;
  }
  document.getElementById('find-info').textContent = `${matches.length} results`;

  if (!findState || findState.query !== query) {
    findState = { query, index: forward ? 0 : matches.length - 1, matches };
  } else {
    findState.index += forward ? 1 : -1;
    if (findState.index >= matches.length) findState.index = 0;
    if (findState.index < 0) findState.index = matches.length - 1;
  }

  activeEditor.setSelection(matches[findState.index].range.startLineNumber, matches[findState.index].range.startColumn,
    matches[findState.index].range.endLineNumber, matches[findState.index].range.endColumn);
  activeEditor.revealRangeInCenter(matches[findState.index].range);
  activeEditor.focus();
}

function closeFind() {
  document.getElementById('find-bar').classList.remove('visible');
  findState = null;
}

// ── Activity Bar ──────────────────────────────────────────────────────

function switchActivity(panel) {
  document.querySelectorAll('.activity-icon').forEach(el => {
    el.classList.toggle('active', el.dataset.panel === panel);
  });
  const sidebar = document.getElementById('sidebar');
  if (panel === 'terminal-btn') toggleTerminal();
  else if (panel === 'search') openFind();
}

// ── Project / Folder Import ──────────────────────────────────────────

async function importFolder() {
  if (!window.electronAPI?.selectDirectoryDialog) {
    addErrorMessage('Folder picker requires Electron environment.');
    return;
  }

  addSystemMessage('Opening folder picker...');
  const result = await window.electronAPI.selectDirectoryDialog();
  if (!result.success || !result.path) {
    addSystemMessage('Folder selection cancelled.');
    return;
  }

  const folderPath = result.path;
  const folderName = folderPath.split(/[\\\/]/).filter(Boolean).pop() || folderPath;

  addSystemMessage(`Scanning project: ${folderName}`);
  addSystemMessage(`Path: ${folderPath}`);

  const dirResult = await window.electronAPI.listDirectory(folderPath);
  if (!dirResult.success) {
    addErrorMessage('Failed to read folder: ' + dirResult.error);
    return;
  }

  importedProjectRoot = folderPath;
  importedProjectName = folderName;

  const items = buildRecursiveTree(folderPath, dirResult.items, 0);

  fileTreeData = {};
  fileTreeData[folderName] = {
    type: 'dir',
    path: folderPath,
    children: items,
  };

  currentRootDir = folderPath;
  renderFileTree();
  updateProjectHeader(folderName, folderPath);
  syncTerminalCwd(folderPath);

  addSystemMessage(`Project loaded: ${folderName}`);
  addSystemMessage(`Files: ${countFiles(items)} | Root: ${folderPath}`);
}

function buildRecursiveTree(basePath, items, depth) {
  const tree = {};
  const maxDepth = 6;
  if (depth >= maxDepth) return tree;

  items.forEach(item => {
    if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === '.git') return;
    if (item.name.endsWith('.log')) return;

    const rel = item.path.replace(basePath + '\\', '').replace(basePath + '/', '');
    const parts = rel.split(/[\\\/]/);
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1 && !item.isDirectory) {
        const ext = p.split('.').pop().toLowerCase();
        current[p] = {
          type: 'file',
          path: item.path,
          name: p,
          ext,
          modified: false,
        };
      } else if (!current[p]) {
        current[p] = {
          type: 'dir',
          path: item.path,
          children: {},
        };
      }
      if (current[p].children) current = current[p].children;
    }
  });

  Object.keys(tree).forEach(k => {
    if (tree[k].type === 'dir') {
      Object.keys(tree[k].children).forEach(ck => {
        if (tree[k].children[ck].type === 'dir') {
          tree[k].children[ck] = {
            ...tree[k].children[ck],
            children: buildRecursiveTreeFromEmpty(tree[k].children[ck].path),
          };
        }
      });
    }
  });

  return tree;
}

async function buildRecursiveTreeFromEmpty(dirPath) {
  try {
    const res = await window.electronAPI?.listDirectory?.(dirPath);
    if (!res || !res.success) return {};
    return buildRecursiveTree(dirPath, res.items, 6);
  } catch {
    return {};
  }
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
  if (titleEl) titleEl.textContent = 'S.A.V.I.A // ' + (name || 'EDITOR');

  const branchEl = document.getElementById('status-branch');
  if (branchEl) branchEl.textContent = path || '';

  const sidebarTitle = document.getElementById('editor-sidebar-title');
  if (sidebarTitle) sidebarTitle.textContent = name ? name.toUpperCase() : 'ESPLORA PROGETTO';
}

function syncTerminalCwd(path) {
  if (!path || !window.electronAPI?.terminalSetCwd) return;
  window.electronAPI.terminalSetCwd(path).then(() => {
    addSystemMessage(`Terminal CWD set to: ${path}`);
  }).catch(() => {
    addSystemMessage('Terminal CWD update skipped (non-Electron env).');
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

function updateStatusBar() {
  const langEl = document.getElementById('status-lang');
  const branchEl = document.getElementById('status-branch');
  if (activeFilePath) {
    const ext = activeFilePath.split('.').pop().toLowerCase();
    langEl.textContent = (EXT_TO_LANG[ext] || 'Plain Text').toUpperCase();
    branchEl.textContent = activeFilePath;
  } else {
    langEl.textContent = 'PLAIN TEXT';
    branchEl.textContent = '';
  }
}

function addSystemMessage(msg) {
  const container = document.getElementById('terminal-container');
  const line = document.createElement('div');
  line.className = 'term-line system';
  line.textContent = '[SYS] ' + msg;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function addErrorMessage(msg) {
  const container = document.getElementById('terminal-container');
  const line = document.createElement('div');
  line.className = 'term-line error';
  line.textContent = '[ERR] ' + msg;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

function toggleTerminal() {
  document.getElementById('terminal-panel').classList.toggle('collapsed');
}

function refreshFileTree() {
  const root = importedProjectRoot || currentRootDir;
  if (!root || !window.electronAPI?.listDirectory) {
    addTickerEvent?.('sys', 'No project root loaded.');
    return;
  }
  window.electronAPI.listDirectory(root).then(res => {
    if (res.success) {
      if (importedProjectRoot && importedProjectName) {
        fileTreeData = {};
        fileTreeData[importedProjectName] = {
          type: 'dir',
          path: importedProjectRoot,
          children: buildRecursiveTree(importedProjectRoot, res.items, 0),
        };
        currentRootDir = importedProjectRoot;
      } else {
        buildFileTreeFromItems(res.items, res.path);
      }
      renderFileTree();
      addSystemMessage('File explorer refreshed');
    } else {
      addErrorMessage('Refresh failed: ' + res.error);
    }
  }).catch(e => addErrorMessage(e.message || String(e)));
}

function buildFileTreeFromItems(items, basePath) {
  const tempTree = {};
  items.forEach(item => {
    if (item.name.startsWith('.') || item.name === 'node_modules') return;
    const parts = item.path.replace(basePath, '').split(/[\\\/]/).filter(Boolean);
    let current = tempTree;
    parts.forEach((part, i) => {
      if (i === parts.length - 1 && !item.isDirectory) {
        const ext = item.name.split('.').pop().toLowerCase();
        current[part] = { type: 'file', path: item.path, name: item.name, ext, modified: false };
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

// ── Init ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  require(['vs/editor/editor.main'], function () {
    document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI?.windowMinimize());
    document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI?.windowMaximize());
    document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI?.windowClose());

    document.getElementById('btnSave').addEventListener('click', saveCurrentFile);

    document.querySelectorAll('.activity-icon').forEach(el => {
      el.addEventListener('click', () => switchActivity(el.dataset.panel));
    });

    document.getElementById('btn-new-file').addEventListener('click', () => {
      const name = prompt('New file name:');
      if (name && window.electronAPI?.writeFile && currentRootDir) {
        const sep = currentRootDir.endsWith('/') || currentRootDir.endsWith('\\') ? '' : '/';
        window.electronAPI.writeFile({ filePath: currentRootDir + sep + name, content: '' }).then(res => {
          if (res.success) { refreshFileTree(); addSystemMessage('Created: ' + name); }
          else addErrorMessage('Failed: ' + res.error);
        }).catch(e => addErrorMessage(e.message || String(e)));
      }
    });

    document.getElementById('btn-new-folder').addEventListener('click', () => {
      const name = prompt('New folder name:');
      if (name && window.electronAPI?.terminalExecute && currentRootDir) {
        const sep = currentRootDir.endsWith('/') || currentRootDir.endsWith('\\') ? '' : '/';
        const fullPath = currentRootDir + sep + name;
        window.electronAPI.terminalExecute(`mkdir "${fullPath}"`).then(() => {
          refreshFileTree();
          addSystemMessage('Created folder: ' + name);
        }).catch(() => {
          addErrorMessage('Could not create folder (requires Electron)');
        });
      }
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
      refreshFileTree();
      addSystemMessage('File explorer refreshed');
    });

    document.getElementById('btn-term-toggle').addEventListener('click', toggleTerminal);
    document.getElementById('terminal-bar-toggle')?.addEventListener('click', toggleTerminal);
    document.getElementById('btn-term-clear').addEventListener('click', () => {
      document.getElementById('terminal-container').innerHTML = '';
    });

    document.getElementById('terminal-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = e.target;
        executeCommand(input.value);
        input.value = '';
      }
    });

    document.getElementById('find-input').addEventListener('input', () => performFind(true));
    document.getElementById('find-next').addEventListener('click', () => performFind(true));
    document.getElementById('find-prev').addEventListener('click', () => performFind(false));
    document.getElementById('find-close').addEventListener('click', closeFind);

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') { e.preventDefault(); saveCurrentFile(); }
        if (e.key === 'w') { e.preventDefault(); if (activeTab) closeTab(activeTab, e); }
        if (e.key === 'p') { e.preventDefault(); openFind(); }
        if (e.key === 'b') { e.preventDefault(); document.getElementById('sidebar').classList.toggle('collapsed'); }
      }
      if (e.key === 'Escape') closeFind();
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        toggleTerminal();
      }
    });

    window.addEventListener('resize', () => {
      editors.forEach(ed => ed.layout());
    });

    document.getElementById('btn-new-file').addEventListener('click', () => {
      const name = prompt('New file name:');
      if (name && window.electronAPI?.writeFile && currentRootDir) {
        const sep = currentRootDir.endsWith('/') || currentRootDir.endsWith('\\') ? '' : '/';
        window.electronAPI.writeFile({ filePath: currentRootDir + sep + name, content: '' }).then(res => {
          if (res.success) { refreshFileTree(); addSystemMessage('Created: ' + name); }
          else addErrorMessage('Failed: ' + res.error);
        }).catch(e => addErrorMessage(e.message || String(e)));
      }
    });

    document.getElementById('btn-new-folder').addEventListener('click', () => {
      const name = prompt('New folder name:');
      if (name && window.electronAPI?.terminalExecute && currentRootDir) {
        const sep = currentRootDir.endsWith('/') || currentRootDir.endsWith('\\') ? '' : '/';
        const fullPath = currentRootDir + sep + name;
        window.electronAPI.terminalExecute(`mkdir "${fullPath}"`).then(() => {
          refreshFileTree();
          addSystemMessage('Created folder: ' + name);
        }).catch(() => {
          addErrorMessage('Could not create folder (requires Electron)');
        });
      }
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
      refreshFileTree();
      addSystemMessage('File explorer refreshed');
    });

    document.getElementById('btn-new-file')?.setAttribute('title', 'New File');
    document.getElementById('btn-new-folder')?.setAttribute('title', 'New Folder');
    document.getElementById('btn-refresh')?.setAttribute('title', 'Refresh');

    const openFolderBtn = document.getElementById('btn-open-folder');
    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', importFolder);
      openFolderBtn.setAttribute('title', 'Import Project Folder');
    }
    const origRefresh = document.getElementById('btn-refresh')?.addEventListener;

    document.getElementById('btn-term-toggle').addEventListener('click', toggleTerminal);
    document.getElementById('terminal-bar-toggle')?.addEventListener('click', toggleTerminal);
    document.getElementById('btn-term-clear').addEventListener('click', () => {
      document.getElementById('terminal-container').innerHTML = '';
    });

    document.getElementById('terminal-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = e.target;
        executeCommand(input.value);
        input.value = '';
      }
    });

    document.getElementById('find-input').addEventListener('input', () => performFind(true));
    document.getElementById('find-next').addEventListener('click', () => performFind(true));
    document.getElementById('find-prev').addEventListener('click', () => performFind(false));
    document.getElementById('find-close').addEventListener('click', closeFind);

    window.addEventListener('resize', () => {
      editors.forEach(ed => ed.layout());
    });

    if (window.electronAPI?.getHomeDir) {
      window.electronAPI.getHomeDir().then(home => {
        currentRootDir = home.path;
        if (window.electronAPI?.listDirectory) {
          window.electronAPI.listDirectory(home.path).then(res => {
            if (res.success) buildFileTreeFromItems(res.items, res.path);
          });
        }
      });
    }

    addSystemMessage('S.A.V.I.A. Editor initialized');
    addSystemMessage('Ctrl+S: Save  |  Ctrl+W: Close tab  |  Ctrl+P: Find  |  Ctrl+B: Toggle sidebar');
    addSystemMessage('Ctrl+` : Toggle terminal');
  });
});

window.electronAPI?.onLoadFile?.((filePath) => {
  if (activeEditor) activeEditor.getElement().style.display = 'none';
  document.getElementById('welcome-screen')?.remove();
  createTab(filePath, filePath.split('/').pop());
});
