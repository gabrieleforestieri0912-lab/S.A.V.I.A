// ============================================================
// KNOWLEDGE BASE (RAG) — Semantic Document Search
// ============================================================

async function kbRefreshStatus() {
  try {
    const status = await window.electronAPI.kbStatus();
    const el = document.getElementById('kb-status-text');
    if (el) el.textContent = status.success ? `${status.docCount} docs, ${status.chunkCount} chunks` : 'OFFLINE';
    const docCount = document.getElementById('kb-doc-count');
    if (docCount) docCount.textContent = `${status.docCount} docs`;
    const statDocs = document.getElementById('kb-stat-docs');
    if (statDocs) statDocs.textContent = `${status.docCount} documents`;
    const statChunks = document.getElementById('kb-stat-chunks');
    if (statChunks) statChunks.textContent = `${status.chunkCount} chunks indexed`;
    return status;
  } catch { return { docCount: 0, chunkCount: 0 }; }
}

async function kbIndexDirectory() {
  const btn = document.getElementById('kb-index-btn');
  if (btn) btn.disabled = true;

  try {
    const res = await window.electronAPI.selectDirectoryDialog();
    if (!res.success || !res.path) { if (btn) btn.disabled = false; return; }
    const dir = res.path;

    addTickerEvent('kb', `Indexing directory: ${dir}`);
    const result = await window.electronAPI.kbIndexDirectory(dir);

    if (result.success) {
      addTickerEvent('kb', `Indexed ${result.success} files from ${dir} (${result.skipped} skipped, ${result.failed} failed)`);
    } else {
      addTickerEvent('warn', `KB index failed: ${result.error}`);
    }

    await kbRefreshStatus();
    await kbRenderDocumentList();
  } catch (e) {
    addTickerEvent('warn', `KB error: ${e.message}`);
  }
  if (btn) btn.disabled = false;
}

async function kbRenderDocumentList() {
  const list = document.getElementById('kb-doc-list');
  if (!list) return;
  try {
    const res = await window.electronAPI.kbList();
    if (!res.success || !res.documents.length) {
      list.innerHTML = '<div class="kb-empty">Nessun documento indicizzato.<br><br>Usa INDEX DIRECTORY per aggiungere documenti alla knowledge base.</div>';
      return;
    }
    list.innerHTML = res.documents.map(d => `
      <div class="kb-doc-item" data-id="${d.id}">
        <div class="kb-doc-icon">${getFileIcon(d.ext)}</div>
        <div class="kb-doc-info">
          <span class="kb-doc-name" title="${d.filepath}">${d.filename}</span>
          <span class="kb-doc-meta">${d.chunks} chunks · ${formatSize(d.size)}</span>
        </div>
        <button class="kb-doc-del" data-id="${d.id}" title="Remove"><i class="fas fa-times"></i></button>
      </div>
    `).join('');

    list.querySelectorAll('.kb-doc-del').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        await window.electronAPI.kbDelete(btn.dataset.id);
        await kbRefreshStatus();
        await kbRenderDocumentList();
      });
    });
  } catch {
    list.innerHTML = '<div class="kb-empty">Error loading document list</div>';
  }
}

function getFileIcon(ext) {
  const icons = {
    '.pdf': 'fa-file-pdf', '.txt': 'fa-file-alt', '.md': 'fa-file-alt',
    '.js': 'fa-file-code', '.ts': 'fa-file-code', '.py': 'fa-file-code',
    '.html': 'fa-file-code', '.css': 'fa-file-code', '.json': 'fa-file-code',
    '.xml': 'fa-file-code', '.yaml': 'fa-file-code', '.yml': 'fa-file-code',
    '.docx': 'fa-file-word', '.rs': 'fa-file-code', '.go': 'fa-file-code',
    '.java': 'fa-file-code', '.c': 'fa-file-code', '.cpp': 'fa-file-code',
    '.sh': 'fa-terminal', '.bat': 'fa-terminal', '.ps1': 'fa-terminal'
  };
  return `<i class="fas ${icons[ext] || 'fa-file'}"></i>`;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

let kbSearchTimeout = null;

async function kbSearchInput(query) {
  const resultsEl = document.getElementById('kb-search-results');
  if (!resultsEl) return;

  if (!query || query.length < 2) {
    resultsEl.innerHTML = '<div class="kb-hint">Inserisci una query per cercare semanticamente nei documenti indicizzati.</div>';
    return;
  }

  resultsEl.innerHTML = '<div class="kb-searching"><i class="fas fa-spinner fa-spin"></i> Cercando...</div>';

  try {
    const res = await window.electronAPI.kbSearch({ query, limit: 12 });
    if (!res.success || !res.results.length) {
      resultsEl.innerHTML = '<div class="kb-empty">Nessun risultato trovato. Prova con termini diversi.</div>';
      return;
    }
    resultsEl.innerHTML = res.results.map((r, i) => `
      <div class="kb-result-item" style="--i:${i}">
        <div class="kb-result-header">
          <span class="kb-result-file"><i class="fas fa-file"></i> ${r.filename}</span>
          <span class="kb-result-score">${(r.score * 100).toFixed(0)}%</span>
        </div>
        <div class="kb-result-text">${escapeHtml(r.text)}</div>
        <div class="kb-result-meta">Linee ${r.startLine}-${r.endLine} · score: ${r.score.toFixed(4)}</div>
      </div>
    `).join('');
  } catch (e) {
    resultsEl.innerHTML = `<div class="kb-empty">Error: ${e.message}</div>`;
  }
}

function escapeHtml(t) {
  const el = document.createElement('span');
  el.textContent = t;
  return el.innerHTML;
}

// Semantic search tool for agents
async function kbSemanticSearch(query, limit = 5) {
  try {
    const res = await window.electronAPI.kbSearch({ query, limit });
    if (!res.success || !res.results.length) return null;
    return res.results.map(r =>
      `[${r.filename} (${(r.score * 100).toFixed(0)}%)] ${r.text.substring(0, 300)}`
    ).join('\n\n');
  } catch { return null; }
}

function initKB() {
  kbRefreshStatus();
  kbRenderDocumentList();

  const searchInput = document.getElementById('kb-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(kbSearchTimeout);
      kbSearchTimeout = setTimeout(() => kbSearchInput(searchInput.value), 400);
    });
  }

  const indexBtn = document.getElementById('kb-index-btn');
  if (indexBtn) indexBtn.addEventListener('click', kbIndexDirectory);
}

function openEditor() {
  if (window.electronAPI?.openEditor) {
    window.electronAPI.openEditor();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initKB, 500);
});
