'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { install } = require('./electron-mock.js');
const restore = install();
const savia = require('../main.js');
restore();

// ============================================================
// parseDueDate — parsing di date/ore per reminder & calendario
// ============================================================
describe('parseDueDate', () => {
  test('parsa data e ora complete', () => {
    const d = savia.parseDueDate('2026-08-08', '14:30');
    assert.ok(d instanceof Date);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 7); // 0-based: agosto
    assert.equal(d.getDate(), 8);
    assert.equal(d.getHours(), 14);
    assert.equal(d.getMinutes(), 30);
    assert.equal(d.getSeconds(), 0);
  });

  test('senza ora usa il default 09:00', () => {
    const d = savia.parseDueDate('2026-08-08', '');
    assert.equal(d.getHours(), 9);
    assert.equal(d.getMinutes(), 0);
  });

  test('senza data usa la data odierna', () => {
    const d = savia.parseDueDate(null, '22:05');
    const now = new Date();
    assert.equal(d.getFullYear(), now.getFullYear());
    assert.equal(d.getMonth(), now.getMonth());
    assert.equal(d.getDate(), now.getDate());
    assert.equal(d.getHours(), 22);
    assert.equal(d.getMinutes(), 5);
  });

  test('restituisce null se manca tutto', () => {
    assert.equal(savia.parseDueDate('', ''), null);
    assert.equal(savia.parseDueDate(null, null), null);
    assert.equal(savia.parseDueDate(undefined, undefined), null);
  });

  test('restituisce null per date malformate', () => {
    assert.equal(savia.parseDueDate('08-2026', '10:00'), null);
    assert.equal(savia.parseDueDate('ab-cd-ef', '10:00'), null);
  });
});

// ============================================================
// cosineSimilarity — matematica del retrieval (RAG)
// ============================================================
describe('cosineSimilarity', () => {
  test('vettori identici → 1', () => {
    assert.equal(savia.cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  });

  test('vettori con stessa direzione e lunghezza diversa → 1', () => {
    assert.ok(Math.abs(savia.cosineSimilarity([1, 0.5, 0.1], [2, 1, 0.2]) - 1) < 1e-9);
  });

  test('vettori ortogonali → 0', () => {
    assert.equal(savia.cosineSimilarity([1, 0], [0, 1]), 0);
  });

  test('vettore nullo → 0 (niente NaN)', () => {
    const r = savia.cosineSimilarity([0, 0], [1, 1]);
    assert.equal(r, 0);
    assert.ok(Number.isFinite(r));
  });

  test('lunghezze diverse → 0', () => {
    assert.equal(savia.cosineSimilarity([1, 2], [1]), 0);
  });

  test('input non validi → 0', () => {
    assert.equal(savia.cosineSimilarity(null, [1]), 0);
    assert.equal(savia.cosineSimilarity([1], undefined), 0);
    assert.equal(savia.cosineSimilarity([], []), 0);
  });
});

// ============================================================
// chunkText — suddivisione documenti RAG (1500 / overlap 200)
// ============================================================
describe('chunkText', () => {
  test('testo vuoto → nessun chunk', () => {
    assert.deepEqual(savia.chunkText('', 'file.md', 'doc1'), []);
  });

  test('testo breve → un solo chunk con metadati', () => {
    const chunks = savia.chunkText('riga uno\nriga due\n', '/tmp/file.md', 'doc_x');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].docId, 'doc_x');
    assert.equal(chunks[0].filepath, '/tmp/file.md');
    assert.equal(chunks[0].startLine, 0);
    assert.equal(chunks[0].endLine, 3);
    assert.match(chunks[0].text, /riga uno/);
    assert.match(chunks[0].text, /riga due/);
  });

  test('testo lungo → più chunk che coprono tutto il contenuto', () => {
    const lines = [];
    for (let i = 0; i < 50; i++) lines.push('Linea di test numero ' + i + ' '.repeat(20));
    const text = lines.join('\n');
    const chunks = savia.chunkText(text, 'f.txt', 'doc');
    assert.ok(chunks.length > 1, 'attesi più chunk, ottenuti ' + chunks.length);

    for (const line of lines) {
      const found = chunks.some(c => c.text.includes(line.trim()));
      assert.ok(found, 'nessun chunk contiene: ' + line.trim());
    }
  });

  test('nessun chunk supera chunkSize + overlap', () => {
    const text = Array.from({ length: 200 }, (_, i) => 'parola' + i + '\n').join('');
    const chunks = savia.chunkText(text, 'f.txt', 'doc');
    for (const c of chunks) {
      assert.ok(
        c.text.length <= savia.KB_CHUNK_SIZE + savia.KB_CHUNK_OVERLAP,
        `chunk di ${c.text.length} caratteri supera il limite`
      );
    }
  });

  test('startLine del primo chunk è 0 e endLine dell ultimo è il numero di righe', () => {
    const text = Array.from({ length: 40 }, (_, i) => 'riga ' + i + ' '.repeat(30)).join('\n');
    const chunks = savia.chunkText(text, 'f.txt', 'doc');
    assert.equal(chunks[0].startLine, 0);
    assert.equal(chunks[chunks.length - 1].endLine, 40);
  });
});

// ============================================================
// isDuplicate / dedupKey / escapeSingle — notifiche native
// ============================================================
describe('notifiche dedup', () => {
  beforeEach(() => savia.notificationDedup.clear());

  test('prima notifica → false, ripetizione immediata → true', () => {
    assert.equal(savia.isDuplicate('Titolo', 'Corpo'), false);
    assert.equal(savia.isDuplicate('Titolo', 'Corpo'), true);
  });

  test('titoli o corpi diversi → non considerati duplicati', () => {
    savia.isDuplicate('A', 'B');
    assert.equal(savia.isDuplicate('A', 'C'), false);
    assert.equal(savia.isDuplicate('X', 'B'), false);
  });

  test('dedupKey distingue title/body', () => {
    assert.notEqual(savia.dedupKey('A', 'B'), savia.dedupKey('A', 'C'));
    assert.equal(savia.dedupKey('A', 'B'), savia.dedupKey('A', 'B'));
  });
});

describe('escapeSingle', () => {
  test('raddoppia gli apostrofi (sicurezza PowerShell toast)', () => {
    assert.equal(savia.escapeSingle("O'Reilly"), "O''Reilly");
    assert.equal(savia.escapeSingle(''), '');
    assert.equal(savia.escapeSingle("it's a 'test'"), "it''s a ''test''");
  });
});

// ============================================================
// scanForProjects / getFolderSize — scansione directory reale
// ============================================================
describe('scanForProjects', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'savia-scan-'));
    fs.mkdirSync(path.join(tmp, 'proj-git', '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'proj-npm'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'proj-npm', 'package.json'), '{}');
    fs.mkdirSync(path.join(tmp, 'not-a-project'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.hidden-dir'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'node_modules', 'dep'), { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('rileva progetti con .git o package.json, ignora .hidden e node_modules', () => {
    const projects = savia.scanForProjects(tmp);
    const names = projects.map(p => path.basename(p));
    assert.ok(names.includes('proj-git'));
    assert.ok(names.includes('proj-npm'));
    assert.ok(!names.includes('.hidden-dir'));
    assert.ok(!names.includes('node_modules'));
  });

  test('directory inesistente → lista vuota', () => {
    assert.deepEqual(savia.scanForProjects(path.join(tmp, 'non-esiste')), []);
  });
});

describe('getFolderSize', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'savia-size-'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'X'.repeat(1000));
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'sub', 'b.txt'), 'Y'.repeat(500));
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('somma ricorsivamente le dimensioni dei file', () => {
    assert.equal(savia.getFolderSize(tmp), 1500);
  });
});

describe('fileSignature / getCpuUsage di base', () => {
  test('fileSignature include path e dimensioni', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'savia-sig-'));
    try {
      const f = path.join(tmp, 'f.txt');
      fs.writeFileSync(f, 'abc');
      const sig = savia.fileSignature(f);
      assert.ok(sig.includes(f));
      assert.ok(sig.includes('|3|'));
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test('getCpuUsage restituisce idle e total numerici', () => {
    const u = savia.getCpuUsage();
    assert.ok(typeof u.idle === 'number' && Number.isFinite(u.idle));
    assert.ok(typeof u.total === 'number' && Number.isFinite(u.total));
    assert.ok(u.total > 0);
  });
});