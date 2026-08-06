let editorInstance = null;
let editorInitialized = false;
let editorCurrentFile = null;
let projectRootPath = null;

function initEditor() {
  if (editorInitialized) {
    if (editorInstance) editorInstance.layout();
    return;
  }

  require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

  require(['vs/editor/editor.main'], function () {
    var container = document.getElementById('monaco-editor-container');
    if (!container) return;

    editorInstance = monaco.editor.create(container, {
      value: '// S.A.V.I.A. Code Editor\n// Apri un file o importa un progetto\n// Ctrl+S per salvare\n',
      language: 'javascript',
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 14,
      fontFamily: "'Consolas', 'Courier New', monospace",
      minimap: { enabled: true, scale: 1 },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      padding: { top: 10 }
    });

    editorInitialized = true;

    editorInstance.onDidChangeCursorPosition(function (e) {
      var el = document.getElementById('editor-cursor-pos');
      if (el) el.textContent = 'LN ' + e.position.lineNumber + ', COL ' + e.position.column;
    });

    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
      saveEditorFile();
    });

    document.getElementById('btnEditorSave').addEventListener('click', saveEditorFile);
    document.getElementById('btnEditorOpen').addEventListener('click', openFileDialog);
    document.getElementById('btnEditorNew').addEventListener('click', newFile);
    document.getElementById('btn-close-tree').addEventListener('click', function () {
      document.getElementById('editor-file-tree').classList.add('hidden');
    });

    var sideSave = document.getElementById('sidebar-btn-editor-save');
    if (sideSave) sideSave.addEventListener('click', saveEditorFile);
  });
}

window.loadFileInEditor = function (filePath) {
  initEditor();
  var checkReady = setInterval(function () {
    if (editorInitialized) {
      clearInterval(checkReady);
      loadEditorFile(filePath);
    }
  }, 100);
};

function updateSidebarEditorInfo(filePath) {
  var nameEl = document.getElementById('sidebar-editor-filename');
  if (nameEl) nameEl.textContent = filePath || 'NESSUNA FILE';
  var saveBtn = document.getElementById('sidebar-btn-editor-save');
  if (saveBtn) saveBtn.style.display = filePath ? '' : 'none';
}

async function loadEditorFile(filePath) {
  if (!window.electronAPI) return;
  editorCurrentFile = filePath;
  var nameEl = document.getElementById('editor-filename');
  if (nameEl) nameEl.textContent = filePath;
  var filePathEl = document.getElementById('editor-file-path');
  if (filePathEl) filePathEl.textContent = filePath;
  updateSidebarEditorInfo(filePath);
  var statusEl = document.getElementById('editor-status-text');
  if (statusEl) statusEl.textContent = 'CARICAMENTO...';

  var ext = filePath.split('.').pop().toLowerCase();
  var langMap = {
    'js': 'javascript', 'ts': 'typescript', 'json': 'json', 'html': 'html',
    'css': 'css', 'py': 'python', 'java': 'java', 'c': 'c', 'cpp': 'cpp',
    'cs': 'csharp', 'go': 'go', 'rs': 'rust', 'md': 'markdown',
    'sh': 'shell', 'yml': 'yaml', 'yaml': 'yaml', 'xml': 'xml',
    'php': 'php', 'rb': 'ruby', 'swift': 'swift', 'kt': 'kotlin',
    'sql': 'sql', 'r': 'r', 'pl': 'perl', 'lua': 'lua'
  };
  var language = langMap[ext] || 'plaintext';

  try {
    var res = await window.electronAPI.readFile(filePath);
    if (res.success) {
      if (editorInstance) {
        editorInstance.setValue(res.content);
        monaco.editor.setModelLanguage(editorInstance.getModel(), language);
      }
      if (statusEl) statusEl.textContent = 'APERTO: ' + language.toUpperCase();
      var pos = document.getElementById('editor-cursor-pos');
      if (pos) pos.textContent = 'LN 1, COL 1';
    } else {
      if (statusEl) statusEl.textContent = 'ERRORE: ' + res.error;
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = 'ERRORE: ' + err.message;
  }
}

async function saveEditorFile() {
  if (!editorCurrentFile || !window.electronAPI || !editorInstance) return;
  var statusEl = document.getElementById('editor-status-text');
  if (statusEl) statusEl.textContent = 'SALVATAGGIO...';

  try {
    var res = await window.electronAPI.writeFile({ filePath: editorCurrentFile, content: editorInstance.getValue() });
    if (statusEl) statusEl.textContent = res.success ? 'SALVATO ALLE ' + new Date().toLocaleTimeString() : 'ERRORE: ' + res.error;
  } catch (err) {
    if (statusEl) statusEl.textContent = 'ERRORE: ' + err.message;
  }
}

async function openFileDialog() {
  if (!window.electronAPI) return;
  var res = await window.electronAPI.openFileDialog();
  if (res.success) {
    loadEditorFile(res.path);
  }
}

async function newFile() {
  if (!window.electronAPI) return;
  var base = projectRootPath || (editorCurrentFile ? editorCurrentFile.replace(/[^\\/]+$/, '') : await getDefaultDir());
  var name = 'nuovo_file_' + Date.now() + '.txt';
  var filePath = base + '\\' + name;
  editorCurrentFile = filePath;
  var nameEl = document.getElementById('editor-filename');
  if (nameEl) nameEl.textContent = filePath;
  var filePathEl = document.getElementById('editor-file-path');
  if (filePathEl) filePathEl.textContent = filePath;
  updateSidebarEditorInfo(filePath);
  if (editorInstance) {
    editorInstance.setValue('');
    monaco.editor.setModelLanguage(editorInstance.getModel(), 'plaintext');
  }
  var statusEl = document.getElementById('editor-status-text');
  if (statusEl) statusEl.textContent = 'NUOVO FILE (non salvato)';
  var pos = document.getElementById('editor-cursor-pos');
  if (pos) pos.textContent = 'LN 1, COL 1';
}

async function getDefaultDir() {
  try {
    var home = await window.electronAPI.getHomeDir();
    return home + '\\Documents';
  } catch (e) {
    return 'C:\\';
  }
}

async function importProject() {
  if (!window.electronAPI) return;
  initEditor();
  var res = await window.electronAPI.selectDirectoryDialog();
  if (!res.success) return;
  projectRootPath = res.path;
  var treeEl = document.getElementById('editor-file-tree');
  var titleEl = document.getElementById('file-tree-title');
  if (titleEl) titleEl.textContent = res.path.split('\\').pop() || res.path;
  if (treeEl) treeEl.classList.remove('hidden');
  await populateFileTree(res.path);
  addTickerEvent('project', 'Progetto importato: ' + res.path);
}

async function populateFileTree(dirPath) {
  var listEl = document.getElementById('file-tree-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="tree-loading">CARICAMENTO...</div>';
  try {
    var entries = await window.electronAPI.listDirectory(dirPath);
    if (!entries.success) {
      listEl.innerHTML = '<div class="tree-error">ERRORE: ' + (entries.error || 'Sconosciuto') + '</div>';
      return;
    }
    listEl.innerHTML = '';
    if (projectRootPath && dirPath !== projectRootPath) {
      var parent = dirPath.replace(/\\[^\\]+$/, '');
      var backBtn = document.createElement('div');
      backBtn.className = 'tree-item tree-folder';
      backBtn.innerHTML = '<i class="fas fa-level-up-alt"></i> ..';
      backBtn.addEventListener('dblclick', function () { populateFileTree(parent); });
      backBtn.addEventListener('click', function () {
        document.querySelectorAll('.tree-item').forEach(function (e) { e.classList.remove('selected'); });
        backBtn.classList.add('selected');
      });
      listEl.appendChild(backBtn);
    }
    entries.items.forEach(function (entry) {
      var item = document.createElement('div');
      item.className = 'tree-item ' + (entry.isDirectory ? 'tree-folder' : 'tree-file');
      var icon = entry.isDirectory ? '<i class="fas fa-folder"></i> ' : '<i class="fas fa-file-code"></i> ';
      item.innerHTML = icon + entry.name;
      if (entry.isDirectory) {
        item.addEventListener('dblclick', function () {
          populateFileTree(entry.path);
        });
      } else {
        item.addEventListener('click', function () {
          document.querySelectorAll('.tree-item').forEach(function (e) { e.classList.remove('selected'); });
          item.classList.add('selected');
        });
        item.addEventListener('dblclick', function () {
          loadEditorFile(entry.path);
          var treeEl = document.getElementById('editor-file-tree');
          if (treeEl && !document.querySelector('.editor-header-toggle-panel:checked')) {
            if (window.innerWidth < 1100) treeEl.classList.add('hidden');
          }
        });
      }
      listEl.appendChild(item);
    });
  } catch (err) {
    listEl.innerHTML = '<div class="tree-error">ERRORE: ' + err.message + '</div>';
  }
}

// Expose importProject globally for the sidebar button or future use
window.importProject = importProject;

// Check for file param after a short delay (in case Monaco hasn't loaded yet)
document.addEventListener('DOMContentLoaded', function () {
  var params = new URLSearchParams(window.location.search);
  var filePath = params.get('file');
  if (filePath) {
    var decoded = decodeURIComponent(filePath);
    var check = setInterval(function () {
      if (editorInitialized) {
        clearInterval(check);
        loadEditorFile(decoded);
      }
    }, 200);
  }
});
