'use strict';

// ============================================================
// KNOWLEDGE BASE (RAG) — index / embed / search
// Logica pura (chunkText, cosineSimilarity) esportata per i test.
// ============================================================

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { app, ipcMain } = require('electron');

const kbPath = path.join(app.getPath('userData'), 'knowledge-base.json');
const LOCAL_EMBED = 'http://localhost:11434/api/embeddings';

const KB_CHUNK_SIZE = 1500;
const KB_CHUNK_OVERLAP = 200;

function loadKB() {
  try {
    if (fs.existsSync(kbPath)) return JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
  } catch (e) { /* ignore */ }
  return { documents: [] };
}

function saveKB(data) {
  fs.writeFileSync(kbPath, JSON.stringify(data, null, 2), 'utf-8');
}

function chunkText(text, filepath, docId) {
  const chunks = [];
  const lines = text.split('\n');
  let current = '';
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    if (current.length + lines[i].length > KB_CHUNK_SIZE && current.length > 0) {
      chunks.push({ docId, filepath, text: current.trim(), startLine, endLine: i });
      const overlap = current.slice(-KB_CHUNK_OVERLAP);
      current = overlap + '\n' + lines[i];
      startLine = Math.max(0, i - Math.round(KB_CHUNK_OVERLAP / 80));
    } else {
      current += lines[i] + '\n';
    }
  }
  if (current.trim()) {
    chunks.push({ docId, filepath, text: current.trim(), startLine, endLine: lines.length });
  }
  return chunks;
}

async function embedText(text) {
  try {
    const res = await fetch(LOCAL_EMBED, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text.substring(0, 8000) })
    });
    if (!res.ok) throw new Error(`Embedding API: ${res.status}`);
    const data = await res.json();
    return data.embedding || [];
  } catch (e) {
    throw new Error(`Embedding failed: ${e.message}`);
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function fileSignature(filepath) {
  try {
    const stat = fs.statSync(filepath);
    return `${filepath}|${stat.size}|${stat.mtimeMs}`;
  } catch { return filepath; }
}

const TEXT_EXTS = new Set(['.txt', '.md', '.js', '.ts', '.py', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.sql', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.m', '.r', '.lua', '.pdf', '.docx']);

function extractTextFromFile(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  if (ext === '.pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(filepath);
      // pdf-parse è async ma offriamo sync via deasync-like: usa versione sync con require
      // fallback: ritorna placeholder per indicizzazione async (gestita in indexFile)
      return `[PDF:${path.basename(filepath)}:${buf.length}bytes:use-async]`;
    } catch (e) {
      return `[PDF extraction failed: ${e.message}]`;
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth = require('mammoth');
      const buf = fs.readFileSync(filepath);
      return `[DOCX:${path.basename(filepath)}:${buf.length}bytes:use-async]`;
    } catch (e) {
      return `[DOCX extraction failed: ${e.message}]`;
    }
  }

  if (TEXT_EXTS.has(ext)) {
    return fs.readFileSync(filepath, 'utf-8');
  }
  return null;
}

async function extractTextAsync(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  if (ext === '.pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(filepath);
      const data = await pdfParse(buf);
      return (data.text || '').trim() || '[PDF vuoto]';
    } catch (e) {
      return `[PDF extraction failed: ${e.message}]`;
    }
  }
  if (ext === '.docx') {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filepath });
      return (result.value || '').trim() || '[DOCX vuoto]';
    } catch (e) {
      return `[DOCX extraction failed: ${e.message}]`;
    }
  }
  return extractTextFromFile(filepath);
}

async function indexFile(filePath) {
  if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
  const stat = fs.statSync(filePath);
  if (stat.size > 50 * 1024 * 1024) return { success: false, error: 'File > 50MB' };

  const ext = path.extname(filePath).toLowerCase();
  const text = (ext === '.pdf' || ext === '.docx') ? await extractTextAsync(filePath) : extractTextFromFile(filePath);
  if (!text) return { success: false, error: 'Unsupported file type' };

  const kb = loadKB();
  const sig = fileSignature(filePath);
  const existing = kb.documents.find(d => d.signature === sig);
  if (existing) return { success: true, message: 'Already indexed', docId: existing.id, chunks: existing.chunks.length };

  const docId = 'doc_' + Date.now() + '_' + path.basename(filePath).replace(/[^a-zA-Z0-9_\-.]/g, '_');
  const chunks = chunkText(text, filePath, docId);

  let embedded = 0;
  for (const chunk of chunks) {
    try { chunk.embedding = await embedText(chunk.text); embedded++; }
    catch { chunk.embedding = null; }
  }

  const entry = {
    id: docId, filepath: filePath, filename: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase(), size: stat.size,
    indexed: new Date().toISOString(), signature: sig,
    chunks: chunks.filter(c => c.embedding)
  };
  kb.documents.push(entry);
  saveKB(kb);
  return { success: true, docId, filename: entry.filename, chunks: entry.chunks.length, embedded };
}

async function indexDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return { success: false, error: 'Directory not found' };
  const didx = new Set(['.txt', '.md', '.js', '.ts', '.py', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.sh', '.bat', '.ps1', '.sql', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.m', '.r', '.lua', '.pdf', '.docx']);

  const files = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('node_modules')) walk(full);
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (didx.has(ext) && !e.name.startsWith('.')) files.push(full);
      }
    }
  }
  walk(dirPath);

  const kb = loadKB();
  const sigs = new Set(kb.documents.map(d => d.signature));
  const processed = { success: 0, skipped: 0, failed: 0, errors: [] };

  for (const f of files) {
    try {
      const stat = fs.statSync(f);
      const sig = `${f}|${stat.size}|${stat.mtimeMs}`;
      if (sigs.has(sig)) { processed.skipped++; continue; }

      const ext2 = path.extname(f).toLowerCase();
      const text = (ext2 === '.pdf' || ext2 === '.docx') ? await extractTextAsync(f) : extractTextFromFile(f);
      if (!text) { processed.skipped++; continue; }

      const docId = 'doc_' + Date.now() + '_' + path.basename(f).replace(/[^a-zA-Z0-9_\-.]/g, '_');
      const chunks = chunkText(text, f, docId);

      let embedded = 0;
      for (const chunk of chunks) {
        try { chunk.embedding = await embedText(chunk.text); embedded++; }
        catch { chunk.embedding = null; }
      }

      kb.documents.push({
        id: docId, filepath: f, filename: path.basename(f),
        ext: path.extname(f).toLowerCase(), size: stat.size,
        indexed: new Date().toISOString(), signature: sig,
        chunks: chunks.filter(c => c.embedding)
      });
      processed.success++;
    } catch (e) {
      processed.failed++;
      processed.errors.push({ file: f, error: e.message });
    }
  }

  saveKB(kb);
  return { success: true, ...processed, total: files.length };
}

function init() {
  ipcMain.handle('kb-index-file', (event, filePath) => indexFile(filePath));
  ipcMain.handle('kb-index-directory', (event, dirPath) => indexDirectory(dirPath));

  ipcMain.handle('kb-search', async (event, { query, limit = 5 }) => {
    try {
      const kb = loadKB();
      if (!kb.documents.length) return { success: true, results: [] };
      const qe = await embedText(query);
      if (!qe || !qe.length) return { success: false, error: 'Embedding failed' };

      const scored = [];
      for (const doc of kb.documents) {
        for (const chunk of doc.chunks) {
          if (!chunk.embedding) continue;
          const score = cosineSimilarity(qe, chunk.embedding);
          scored.push({
            docId: doc.id, filename: doc.filename, filepath: doc.filepath, ext: doc.ext,
            text: chunk.text.substring(0, 500), score, startLine: chunk.startLine, endLine: chunk.endLine
          });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return { success: true, results: scored.slice(0, Math.min(limit, scored.length)), total: scored.length };
    } catch (e) {
      return { success: false, error: e.message, results: [] };
    }
  });

  ipcMain.handle('kb-list', () => {
    const kb = loadKB();
    return {
      success: true,
      documents: kb.documents.map(d => ({
        id: d.id, filename: d.filename, filepath: d.filepath, ext: d.ext,
        size: d.size, indexed: d.indexed, chunks: d.chunks.length
      }))
    };
  });

  ipcMain.handle('kb-delete', (event, docId) => {
    const kb = loadKB();
    const before = kb.documents.length;
    kb.documents = kb.documents.filter(d => d.id !== docId);
    if (kb.documents.length < before) {
      saveKB(kb);
      return { success: true, message: 'Deleted' };
    }
    return { success: false, message: 'Not found' };
  });

  ipcMain.handle('kb-status', () => {
    const kb = loadKB();
    const chunkCount = kb.documents.reduce((s, d) => s + d.chunks.length, 0);
    return { success: true, docCount: kb.documents.length, chunkCount, storage: kbPath };
  });
}

module.exports = {
  init,
  chunkText,
  cosineSimilarity,
  fileSignature,
  KB_CHUNK_SIZE,
  KB_CHUNK_OVERLAP
};