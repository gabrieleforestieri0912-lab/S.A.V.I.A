/**
 * S.A.V.I.A - Command Center Module (File Explorer + Terminal)
 */

const fbState = {
  currentPath: '',
  history: [],
  historyIndex: -1,
  selectedItem: null,
  renaming: false,
  apiAvailable: !!(window.electronAPI && window.electronAPI.listDirectory)
};

const termState = {
  currentCwd: '',
  running: false,
  currentProcId: null,
  commandHistory: [],
  historyIndex: -1,
  apiAvailable: !!(window.electronAPI && window.electronAPI.terminalExecute)
};

const fbList = document.getElementById('fb-list');
const fbPathText = document.getElementById('fb-path-text');
const fbStatus = document.getElementById('fb-status');
const fbFooterText = document.getElementById('fb-footer-text');
const fbBack = document.getElementById('fb-back');
const fbForward = document.getElementById('fb-forward');
const fbUp = document.getElementById('fb-up');
const fbRefresh = document.getElementById('fb-refresh');
const fbSelectDir = document.getElementById('fb-select-dir');

const termOutput = document.getElementById('term-output');
const termInput = document.getElementById('term-input');
const termForm = document.getElementById('terminal-command-form');
const termCwdLabel = document.getElementById('term-cwd');
const termStatus = document.getElementById('term-status');
const termClear = document.getElementById('term-clear');
const termKill = document.getElementById('term-kill');
const terminalPanel = document.getElementById('commander-terminal');

const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmOk = document.getElementById('confirm-ok');
const confirmCancel = document.getElementById('confirm-cancel');

const contextMenu = document.getElementById('context-menu');
const ctxRename = document.getElementById('ctx-rename');
const ctxDelete = document.getElementById('ctx-delete');
const ctxCopyPath = document.getElementById('ctx-copy-path');
const ctxOpenExplorer = document.getElementById('ctx-open-explorer');

let contextTarget = null;

// ============================================================
// FILE BROWSER
// ============================================================

async function initFileBrowser() {
  if (!fbState.apiAvailable) {
    fbList.innerHTML = '<div class="fb-error">FILE_BROWSER UNAVAILABLE (IPC bridge required)</div>';
    return;
  }
  showDriveList();
}

async function showDriveList() {
  fbState.currentPath = '';
  fbState.history = [];
  fbState.historyIndex = -1;
  fbPathText.textContent = 'COMPUTER';
  fbList.innerHTML = '';
  updateNavButtons();

  try {
    const drives = await window.electronAPI.getDrives();
    drives.forEach(drive => {
      const el = document.createElement('div');
      el.className = 'fb-item';
      el.innerHTML = `
        <span class="fb-item-icon"><i class="fas fa-laptop"></i></span>
        <span class="fb-item-name dir">${drive.name}</span>
        <span class="fb-item-size"></span>
        <span class="fb-item-date"></span>
      `;
      el.addEventListener('click', () => navigateTo(drive.path));
      el.addEventListener('dblclick', () => navigateTo(drive.path));
      fbList.appendChild(el);
    });
    fbStatus.textContent = `${drives.length} drives`;
    fbFooterText.textContent = 'SELECT A DRIVE TO BROWSE';
  } catch (e) {
    fbStatus.textContent = 'ERROR';
    fbFooterText.textContent = 'Failed to enumerate drives';
  }
}

async function navigateTo(dirPath, addToHistory = true) {
  if (!dirPath) return;
  fbList.innerHTML = '<div class="fb-loading">SCANNING...</div>';

  const result = await window.electronAPI.listDirectory(dirPath);
  if (!result.success) {
    fbList.innerHTML = `<div class="fb-error">ERROR: ${result.error}</div>`;
    return;
  }

  fbState.currentPath = result.path;
  fbPathText.textContent = result.path;

  if (addToHistory) {
    fbState.history = fbState.history.slice(0, fbState.historyIndex + 1);
    fbState.history.push(result.path);
    fbState.historyIndex = fbState.history.length - 1;
  }

  updateNavButtons();
  renderFileList(result.items);
  updateFileBrowserStatus(result.items);

  if (termState.apiAvailable) {
    await window.electronAPI.terminalSetCwd(result.path);
    termState.currentCwd = result.path;
    termCwdLabel.textContent = result.path;
  }
}

function renderFileList(items) {
  fbList.innerHTML = '';
  fbState.selectedItem = null;

  const parentItem = document.createElement('div');
  parentItem.className = 'fb-item';
  parentItem.innerHTML = `
    <span class="fb-item-icon"><i class="fas fa-folder"></i></span>
    <span class="fb-item-name dir">.. (parent directory)</span>
    <span class="fb-item-size"></span>
    <span class="fb-item-date"></span>
  `;
  parentItem.addEventListener('click', () => goUp());
  parentItem.addEventListener('dblclick', () => goUp());
  fbList.appendChild(parentItem);

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'fb-item';
    el.dataset.path = item.path;
    el.dataset.isDir = item.isDirectory;
    el.dataset.name = item.name;

    const icon = item.isDirectory ? '<i class="fas fa-folder"></i>' : getFileIcon(item.name);
    const sizeStr = item.isDirectory ? '' : formatSize(item.size);
    const dateStr = formatDate(item.modifiedTime);

    el.innerHTML = `
      <span class="fb-item-icon">${icon}</span>
      <span class="fb-item-name ${item.isDirectory ? 'dir' : ''}">${item.name}</span>
      <span class="fb-item-size">${sizeStr}</span>
      <span class="fb-item-date">${dateStr}</span>
    `;

    el.addEventListener('click', (e) => { e.stopPropagation(); selectItem(el); });
    el.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      if (item.isDirectory) {
        navigateTo(item.path);
      } else {
        if (window.electronAPI && window.electronAPI.openEditor) {
          await window.electronAPI.openEditor(item.path);
        }
      }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      selectItem(el);
      showContextMenu(e.clientX, e.clientY, item.path, item.name, item.isDirectory);
    });

    fbList.appendChild(el);
  });
}

function selectItem(el) {
  document.querySelectorAll('.fb-item.selected').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  fbState.selectedItem = el;
}

function updateNavButtons() {
  fbBack.disabled = fbState.historyIndex <= 0;
  fbForward.disabled = fbState.historyIndex >= fbState.history.length - 1;
}

function updateFileBrowserStatus(items) {
  const dirs = items.filter(i => i.isDirectory).length;
  const files = items.filter(i => !i.isDirectory).length;
  fbStatus.textContent = `${items.length} items`;
  fbFooterText.textContent = `${dirs} dirs // ${files} files`;
}

function goUp() {
  if (!fbState.currentPath) return;
  if (fbState.currentPath.match(/^[A-Z]:\\$/i)) {
    showDriveList();
    return;
  }
  const parent = getParentPath(fbState.currentPath);
  if (parent) navigateTo(parent);
}

function goBack() {
  if (fbState.historyIndex > 0) {
    fbState.historyIndex--;
    navigateTo(fbState.history[fbState.historyIndex], false);
  }
}

function goForward() {
  if (fbState.historyIndex < fbState.history.length - 1) {
    fbState.historyIndex++;
    navigateTo(fbState.history[fbState.historyIndex], false);
  }
}

function getParentPath(p) {
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return p.match(/^[A-Z]:/i) ? p.substring(0, 2) + ':\\' : '/';
  const parent = normalized.substring(0, idx);
  const isWin = navigator.platform.includes('Win') || navigator.platform === 'Win32';
  return isWin ? parent.replace(/\//g, '\\') : parent;
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const iconMap = {
    'js': '<i class="fab fa-js"></i>', 'jsx': '<i class="fab fa-react"></i>',
    'ts': '<i class="fas fa-code"></i>', 'tsx': '<i class="fab fa-react"></i>',
    'json': '<i class="fas fa-brackets-curly"></i>', 'html': '<i class="fab fa-html5"></i>',
    'css': '<i class="fab fa-css3-alt"></i>', 'scss': '<i class="fab fa-sass"></i>',
    'md': '<i class="fas fa-file-alt"></i>', 'txt': '<i class="fas fa-file-alt"></i>',
    'py': '<i class="fab fa-python"></i>', 'java': '<i class="fab fa-java"></i>',
    'cpp': '<i class="fas fa-file-code"></i>', 'c': '<i class="fas fa-file-code"></i>',
    'h': '<i class="fas fa-file-code"></i>', 'cs': '<i class="fab fa-windows"></i>',
    'go': '<i class="fas fa-file-code"></i>', 'rs': '<i class="fas fa-file-code"></i>',
    'yaml': '<i class="fas fa-cog"></i>', 'yml': '<i class="fas fa-cog"></i>',
    'toml': '<i class="fas fa-cog"></i>', 'xml': '<i class="fas fa-file-code"></i>',
    'svg': '<i class="fas fa-vector-square"></i>', 'png': '<i class="fas fa-image"></i>',
    'jpg': '<i class="fas fa-image"></i>', 'jpeg': '<i class="fas fa-image"></i>',
    'gif': '<i class="fas fa-film"></i>', 'ico': '<i class="fas fa-circle"></i>',
    'exe': '<i class="fas fa-cogs"></i>', 'dll': '<i class="fas fa-cubes"></i>',
    'zip': '<i class="fas fa-file-archive"></i>', 'tar': '<i class="fas fa-file-archive"></i>',
    'gz': '<i class="fas fa-file-archive"></i>', 'rar': '<i class="fas fa-file-archive"></i>',
    'pdf': '<i class="fas fa-file-pdf"></i>', 'doc': '<i class="fas fa-file-word"></i>',
    'docx': '<i class="fas fa-file-word"></i>', 'xls': '<i class="fas fa-file-excel"></i>',
    'xlsx': '<i class="fas fa-file-excel"></i>', 'ppt': '<i class="fas fa-file-powerpoint"></i>',
    'pptx': '<i class="fas fa-file-powerpoint"></i>', 'sh': '<i class="fas fa-terminal"></i>',
    'bat': '<i class="fas fa-terminal"></i>', 'ps1': '<i class="fas fa-terminal"></i>',
    'cmd': '<i class="fas fa-terminal"></i>', 'mp3': '<i class="fas fa-music"></i>',
    'wav': '<i class="fas fa-music"></i>', 'mp4': '<i class="fas fa-video"></i>',
    'avi': '<i class="fas fa-video"></i>', 'mov': '<i class="fas fa-video"></i>',
    'sln': '<i class="fas fa-project-diagram"></i>', 'csproj': '<i class="fas fa-project-diagram"></i>',
    'php': '<i class="fab fa-php"></i>', 'rb': '<i class="fas fa-gem"></i>',
    'swift': '<i class="fab fa-swift"></i>', 'kt': '<i class="fas fa-file-code"></i>',
    'sql': '<i class="fas fa-database"></i>', 'db': '<i class="fas fa-database"></i>',
    'gitignore': '<i class="fab fa-git-alt"></i>', 'dockerfile': '<i class="fab fa-docker"></i>',
    'lock': '<i class="fas fa-lock"></i>'
  };
  return iconMap[ext] || '<i class="fas fa-file"></i>';
}

function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

fbBack.addEventListener('click', goBack);
fbForward.addEventListener('click', goForward);
fbUp.addEventListener('click', goUp);
fbRefresh.addEventListener('click', () => navigateTo(fbState.currentPath, false));

fbSelectDir.addEventListener('click', async () => {
  const result = await window.electronAPI.selectDirectoryDialog();
  if (result.success) navigateTo(result.path);
});

// ============================================================
// CONTEXT MENU
// ============================================================

function showContextMenu(x, y, itemPath, itemName, isDir) {
  contextTarget = { path: itemPath, name: itemName, isDir };
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove('hidden');
}

document.addEventListener('click', () => {
  if (!contextMenu.classList.contains('hidden')) contextMenu.classList.add('hidden');
});

ctxRename.addEventListener('click', () => {
  contextMenu.classList.add('hidden');
  if (contextTarget) startRename(contextTarget.path, contextTarget.name);
});

ctxDelete.addEventListener('click', () => {
  contextMenu.classList.add('hidden');
  if (contextTarget) confirmDelete(contextTarget.path, contextTarget.name, contextTarget.isDir);
});

ctxCopyPath.addEventListener('click', () => {
  contextMenu.classList.add('hidden');
  if (contextTarget) {
    navigator.clipboard.writeText(contextTarget.path).catch(console.error);
    addTickerEvent('sys', `Path copied: ${contextTarget.path}`);
  }
});

ctxOpenExplorer.addEventListener('click', async () => {
  contextMenu.classList.add('hidden');
  if (contextTarget && window.electronAPI && window.electronAPI.openInExplorer) {
    await window.electronAPI.openInExplorer(contextTarget.path);
  }
});

// ============================================================
// RENAME
// ============================================================

function startRename(itemPath, currentName) {
  if (fbState.renaming) return;
  fbState.renaming = true;

  const items = document.querySelectorAll('.fb-item');
  let targetEl = null;
  items.forEach(el => { if (el.dataset.path === itemPath) targetEl = el; });
  if (!targetEl) { fbState.renaming = false; return; }

  const nameEl = targetEl.querySelector('.fb-item-name');
  const oldHtml = nameEl.innerHTML;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fb-item-rename-input';
  input.value = currentName;
  const selEnd = currentName.lastIndexOf('.') > 0 ? currentName.lastIndexOf('.') : currentName.length;
  input.setSelectionRange(0, selEnd);

  nameEl.innerHTML = '';
  nameEl.appendChild(input);
  input.focus();

  const finishRename = async () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      const result = await window.electronAPI.renameItem(itemPath, newName);
      if (result.success) {
        addTickerEvent('sys', `Renamed: ${currentName} \u2192 ${newName}`);
        navigateTo(fbState.currentPath, false);
      } else {
        addTickerEvent('warn', `Rename failed: ${result.error}`);
        nameEl.innerHTML = oldHtml;
      }
    } else {
      nameEl.innerHTML = oldHtml;
    }
    fbState.renaming = false;
  };

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); nameEl.innerHTML = oldHtml; fbState.renaming = false; }
  });
}

// ============================================================
// CONFIRM DELETE
// ============================================================

function confirmDelete(itemPath, itemName, isDir) {
  confirmTitle.textContent = isDir ? 'DELETE DIRECTORY' : 'DELETE FILE';
  confirmMessage.innerHTML = `Permanently delete <strong>${itemName}</strong>?<br><br><span style="color:var(--accent-red);font-size:11px;">${itemPath}</span>`;
  confirmOk.style.display = 'inline-block';
  confirmModal.classList.remove('hidden-modal');

  confirmOk.onclick = async () => {
    confirmModal.classList.add('hidden-modal');
    const result = await window.electronAPI.deleteItem(itemPath);
    if (result.success) {
      addTickerEvent('sys', `Deleted: ${itemName}`);
      navigateTo(fbState.currentPath, false);
    } else {
      addTickerEvent('warn', `Delete failed: ${result.error}`);
    }
  };

  confirmCancel.onclick = () => {
    confirmModal.classList.add('hidden-modal');
  };
}

// ============================================================
// TERMINAL
// ============================================================

async function initTerminal() {
  if (!termState.apiAvailable) {
    addTermLine('TERMINAL UNAVAILABLE (IPC bridge required)', 'stderr');
    return;
  }

  try {
    const result = await window.electronAPI.terminalGetCwd();
    termState.currentCwd = result.cwd;
    termCwdLabel.textContent = result.cwd;
    addTermLine(`Terminal initialized // ${result.cwd}`, 'exit');
    addTermLine('Type a command and press Enter to execute.', 'exit');
  } catch (e) {
    addTermLine(`Terminal init error: ${e.message}`, 'stderr');
  }

  if (window.electronAPI && window.electronAPI.onTerminalOutput) {
    window.electronAPI.onTerminalOutput((data) => {
      if (data.type === 'stdout') addTermLine(data.data);
      else if (data.type === 'stderr') addTermLine(data.data, 'stderr');
      else if (data.type === 'exit') {
        termState.running = false;
        termState.currentProcId = null;
        termStatus.textContent = 'IDLE';
        termStatus.style.color = '';
        addTermLine(`Process exited with code ${data.data}`, 'exit');
      } else if (data.type === 'error') {
        termState.running = false;
        termState.currentProcId = null;
        termStatus.textContent = 'ERROR';
        addTermLine(`Error: ${data.data}`, 'stderr');
      }
    });
  }
}

function addTermLine(text, className = '') {
  const line = document.createElement('div');
  line.className = `term-line ${className}`;
  line.innerHTML = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  termOutput.appendChild(line);
  termOutput.scrollTop = termOutput.scrollHeight;
}

termForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cmd = termInput.value.trim();
  if (!cmd) return;

  playAudio(audioClick);

  termState.commandHistory.push(cmd);
  termState.historyIndex = termState.commandHistory.length;

  if (termState.running && termState.currentProcId) {
    addTermLine(`${cmd}`, 'prompt');
    termInput.value = '';
    if (window.electronAPI && window.electronAPI.terminalStdin) {
      await window.electronAPI.terminalStdin(termState.currentProcId, cmd);
    }
    return;
  }

  addTermLine(`${termState.currentCwd}> ${cmd}`, 'prompt');
  termInput.value = '';

  if (cmd.startsWith('cd ')) {
    await handleCd(cmd.substring(3).trim());
    return;
  }

  if (!termState.apiAvailable) return;

  termState.running = true;
  termState.currentProcId = null;
  termStatus.textContent = 'RUNNING';
  termStatus.style.color = 'var(--accent-cyan)';

  const result = await window.electronAPI.terminalExecute(cmd);
  if (result.success) {
    termState.currentProcId = result.procId;
  } else {
    termState.running = false;
    termStatus.textContent = 'ERROR';
    addTermLine(`Failed to execute: ${result.error}`, 'stderr');
  }
});

async function handleCd(target) {
  let newPath = target;
  const isWin = navigator.platform.includes('Win') || navigator.platform === 'Win32';

  if (target.startsWith('~')) {
    try {
      const home = await window.electronAPI.getHomeDir();
      newPath = home.path + target.substring(1);
    } catch (e) { /* keep original */ }
  }

  if (!target.includes(':') && !target.startsWith('/') && !target.startsWith('\\')) {
    newPath = termState.currentCwd + (isWin ? '\\' : '/') + target;
  }

  if (termState.apiAvailable) {
    const result = await window.electronAPI.terminalSetCwd(newPath);
    if (result.success) {
      termState.currentCwd = result.cwd;
      termCwdLabel.textContent = result.cwd;
      if (fbState.currentPath) navigateTo(result.cwd, true);
    } else {
      addTermLine(`cd: ${result.error}`, 'stderr');
    }
  }
}

termInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (termState.commandHistory.length > 0) {
      termState.historyIndex = Math.max(0, termState.historyIndex - 1);
      termInput.value = termState.commandHistory[termState.historyIndex] || '';
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (termState.historyIndex < termState.commandHistory.length - 1) {
      termState.historyIndex++;
      termInput.value = termState.commandHistory[termState.historyIndex] || '';
    } else {
      termState.historyIndex = termState.commandHistory.length;
      termInput.value = '';
    }
  }
});

termClear.addEventListener('click', () => {
  playAudio(audioClick);
  termOutput.innerHTML = '';
  addTermLine('Output cleared.', 'exit');
});

termKill.addEventListener('click', async () => {
  if (termState.currentProcId && termState.apiAvailable) {
    await window.electronAPI.terminalKill(termState.currentProcId);
    termState.running = false;
    termStatus.textContent = 'KILLED';
    addTermLine('Process terminated.', 'exit');
  }
});

// ============================================================
// FILE SCANNER WITH AI DESCRIPTIONS
// ============================================================

const SCANNER_OLLAMA_HOST = 'http://localhost:11434';
let scannerAIOnline = false;
let scanItems = [];
let scanDescriptions = {};
let scanDescribing = false;

const scanPanel = document.getElementById('commander-scanner');
const scanResults = document.getElementById('scan-results');
const scanStatus = document.getElementById('scan-status');
const scanFooterText = document.getElementById('scan-footer-text');
const scanDescribeAll = document.getElementById('scan-describe-all');
const scanClose = document.getElementById('scan-close');
const scanBtn = document.getElementById('fb-scan-btn');

async function checkScannerOllama() {
  try {
    const res = await fetch(`${SCANNER_OLLAMA_HOST}/api/tags`, { method: 'GET' });
    scannerAIOnline = res.ok;
  } catch {
    scannerAIOnline = false;
  }
}

function getFileType(name) {
  if (!name.includes('.')) return 'unknown';
  return name.split('.').pop().toLowerCase();
}

function getFileCategory(ext) {
  const code = ['js','jsx','ts','tsx','py','java','cpp','c','h','hpp','cs','go','rs','rb','php','swift','kt','scala'];
  const web = ['html','htm','css','scss','sass','less','xml','svg'];
  const config = ['json','yaml','yml','toml','ini','cfg','conf','env'];
  const data = ['csv','tsv','sql','db','sqlite','mdb'];
  const docs = ['md','txt','pdf','doc','docx','xls','xlsx','ppt','pptx','rtf'];
  const media = ['png','jpg','jpeg','gif','bmp','webp','ico','mp3','wav','mp4','avi','mov','mkv','flac'];
  const archive = ['zip','tar','gz','rar','7z','bz2'];
  const binary = ['exe','dll','so','dylib','bin','dat','obj','lib','o'];
  if (code.includes(ext)) return 'code';
  if (web.includes(ext)) return 'web';
  if (config.includes(ext)) return 'config';
  if (data.includes(ext)) return 'data';
  if (docs.includes(ext)) return 'document';
  if (media.includes(ext)) return 'media';
  if (archive.includes(ext)) return 'archive';
  if (binary.includes(ext)) return 'binary';
  return 'other';
}

let scanAbortController = null;

async function startScan() {
  if (!fbState.currentPath) {
    addTickerEvent('warn', 'Scanner: Navigate to a directory first.');
    return;
  }

  scanBtn.classList.add('active');
  scanStatus.textContent = 'SCANNING...';
  scanFooterText.textContent = 'Collecting file properties...';

  const result = await window.electronAPI.listDirectory(fbState.currentPath);
  if (!result.success) {
    scanStatus.textContent = 'ERROR';
    scanFooterText.textContent = `Scan failed: ${result.error}`;
    return;
  }

  scanItems = result.items.filter(i => !i.isDirectory);
  scanDescriptions = {};

  terminalPanel.classList.add('hidden');
  scanPanel.classList.remove('hidden');

  renderScanResults(scanItems);
  scanStatus.textContent = `${scanItems.length} FILES`;
  scanFooterText.textContent = `Ready. Press describe button for AI analysis.`;

  await checkScannerOllama();
  if (scannerAIOnline) {
    scanFooterText.textContent += ' // AI READY';
  }
}

function renderScanResults(items) {
  scanResults.innerHTML = '';

  if (items.length === 0) {
    scanResults.innerHTML = '<div class="scan-info">No files found in this directory.</div>';
    return;
  }

  const header = document.createElement('div');
  header.className = 'scan-header-row';
  header.innerHTML = `
    <span class="scan-h-name">NAME</span>
    <span class="scan-h-type">TYPE</span>
    <span class="scan-h-size">SIZE</span>
    <span class="scan-h-desc">DESCRIPTION</span>
  `;
  scanResults.appendChild(header);

  items.forEach(item => {
    const ext = getFileType(item.name);
    const cat = getFileCategory(ext);
    const el = document.createElement('div');
    el.className = 'scan-item';
    el.dataset.path = item.path;

    const desc = scanDescriptions[item.path] || '';

    el.innerHTML = `
      <span class="scan-name" title="${item.name}">${item.name}</span>
      <span class="scan-type scan-type-${cat}">${ext}</span>
      <span class="scan-size">${formatSize(item.size)}</span>
      <span class="scan-desc ${desc ? '' : 'scan-desc-pending'}">${desc || '<span class="scan-pending">pending AI analysis...</span>'}</span>
    `;

    scanResults.appendChild(el);
  });
}

// Read first lines of a text file for analysis (via IPC)
async function readFilePreview(filePath) {
  try {
    if (!window.electronAPI || !window.electronAPI.readFilePreview) return null;
    const result = await window.electronAPI.readFilePreview(filePath);
    if (result.success) return result.preview;
    return null;
  } catch { return null; }
}

async function describeAllFiles() {
  if (scanDescribing) return;
  if (scanItems.length === 0) return;

  scanDescribing = true;
  scanDescribeAll.classList.add('active');
  scanStatus.textContent = 'DESCRIBING...';
  scanFooterText.textContent = 'Analisi file in corso...';

  if (scanAbortController) scanAbortController.abort();
  scanAbortController = new AbortController();

  for (let i = 0; i < scanItems.length; i++) {
    const item = scanItems[i];
    if (scanDescriptions[item.path]) continue;

    const ext = getFileType(item.name);
    const preview = await readFilePreview(item.path);

    let description;

    if (preview) {
      // Use AI to analyze actual content
      if (scannerAIOnline) {
        const prompt = `Analizza questo file in italiano (max 20 parole). Descrivi cosa fa REALMENTE in base al suo contenuto, non solo dal nome.\n\nNOME: ${item.name}\nCONTENUTO (prime righe):\n${preview}`;
        try {
          const res = await fetch(`${SCANNER_OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: scanAbortController.signal,
            body: JSON.stringify({
              model: 'llama3',
              messages: [{ role: 'user', content: prompt }],
              stream: false
            })
          });
          if (res.ok) {
            const data = await res.json();
            description = data.message?.content?.trim() || 'N/A';
          }
        } catch (e) {
          if (e.name === 'AbortError') break;
        }
      }
      if (!description) {
        // Fallback: show actual first line as description
        description = preview.split('\n')[0].substring(0, 80) || `File ${ext}`;
      }
    } else {
      // Binary or unsupported file — use factual metadata only
      const sizeLabel = formatSize(item.size);
      description = `File ${ext.toUpperCase()} • ${sizeLabel} — impossibile analizzare il contenuto`;
    }

    scanDescriptions[item.path] = description || 'N/A';

    // Update UI
    const items = scanResults.querySelectorAll('.scan-item');
    const idx = scanItems.indexOf(item);
    if (items[idx + 1]) {
      const descEl = items[idx + 1].querySelector('.scan-desc');
      descEl.textContent = description;
      descEl.classList.remove('scan-desc-pending');
    }

    scanFooterText.textContent = `Analisi: ${Object.keys(scanDescriptions).length}/${scanItems.length} file`;

    if (i < scanItems.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  scanDescribing = false;
  scanDescribeAll.classList.remove('active');
  scanStatus.textContent = `${scanItems.length} FILES`;
  scanFooterText.textContent = `Analisi completata: ${Object.keys(scanDescriptions).length}/${scanItems.length} file`;
  addTickerEvent('sys', `Scanner: analizzati ${Object.keys(scanDescriptions).length} file.`);
}

function closeScanner() {
  if (scanAbortController) {
    scanAbortController.abort();
    scanAbortController = null;
  }
  scanDescribing = false;
  scanDescribeAll.classList.remove('active');
  scanBtn.classList.remove('active');
  scanPanel.classList.add('hidden');
  terminalPanel.classList.remove('hidden');
  scanStatus.textContent = 'READY';
  scanFooterText.textContent = 'IDLE';
}

if (scanBtn) {
  scanBtn.addEventListener('click', () => {
    playAudio(audioClick);
    if (!scanPanel.classList.contains('hidden')) {
      closeScanner();
    } else {
      startScan();
    }
  });
}

if (scanDescribeAll) {
  scanDescribeAll.addEventListener('click', () => {
    playAudio(audioClick);
    describeAllFiles();
  });
}

if (scanClose) {
  scanClose.addEventListener('click', () => {
    playAudio(audioClick);
    closeScanner();
  });
}

// Add scanner module to sidebar
const scannerModule = document.getElementById('svc-scanner');
if (scannerModule) {
  scannerModule.addEventListener('click', () => {
    playAudio(audioClick);
    if (fbState.currentPath) {
      startScan();
    } else {
      addTickerEvent('sys', 'Scanner: Navigate to a directory first via File Explorer.');
    }
  });
}

// Auto-initialize on page load
setTimeout(() => {
  initFileBrowser();
  initTerminal();
}, 100);
