'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { installRenderStubs } = require('./helpers.js');
installRenderStubs();
const yt = require('../src/youtube.js');

// ============================================================
// parseDuration — conversione ISO 8601 (PT…H…M…S) → formato YouTube
// Senza ore restituisce MM:SS (00:45, 05:00), con ore HH:MM:SS.
// ============================================================
describe('parseDuration', () => {
  test('durata completa ore:min:sec', () => {
    assert.equal(yt.parseDuration('PT1H2M3S'), '01:02:03');
  });

  test('solo minuti (sotto l ora) → MM:SS', () => {
    assert.equal(yt.parseDuration('PT5M'), '05:00');
  });

  test('solo secondi → MM:SS', () => {
    assert.equal(yt.parseDuration('PT45S'), '00:45');
  });

  test('solo ore → HH:MM:SS', () => {
    assert.equal(yt.parseDuration('PT1H'), '01:00:00');
  });

  test('zero secondi', () => {
    assert.equal(yt.parseDuration('PT0S'), '00:00');
  });

  test('formato non valido → stringa vuota (nessun crash)', () => {
    assert.equal(yt.parseDuration('garbage'), '');
    assert.equal(yt.parseDuration('P1DT4H'), '');
    assert.equal(yt.parseDuration(''), '');
    assert.equal(yt.parseDuration(null), '');
  });

  test('valori a una cifra → zero padding', () => {
    assert.equal(yt.parseDuration('PT9M9S'), '09:09');
    assert.equal(yt.parseDuration('PT2H5M1S'), '02:05:01');
  });
});

// ============================================================
// escHtml — sanitizzazione output HTML (anti XSS nei risultati)
// ============================================================
describe('escHtml', () => {
  test('scapeggia tag HTML', () => {
    const out = yt.escHtml('<script>alert(1)</script>');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
  });

  test('scapeggia ampersand e virgolette', () => {
    assert.ok(yt.escHtml('a & b').includes('a &amp; b'));
    assert.ok(yt.escHtml('"dita"').includes('&quot;'));
  });

  test('valori null/undefined → stringa vuota', () => {
    assert.equal(yt.escHtml(null), '');
    assert.equal(yt.escHtml(undefined), '');
  });

  test('testo innocuo resta invariato', () => {
    assert.ok(yt.escHtml('Ciao mondo').includes('Ciao mondo'));
  });
});

// ============================================================
// YT_CHANNELS — integrità dati di configurazione
// ============================================================
describe('YT_CHANNELS', () => {
  test('ogni canale ha nome, lingua (IT/EN) e categoria', () => {
    assert.ok(Array.isArray(yt.YT_CHANNELS) && yt.YT_CHANNELS.length > 0);
    for (const ch of yt.YT_CHANNELS) {
      assert.ok(typeof ch.name === 'string' && ch.name.length > 0, 'nome mancante');
      assert.ok(ch.lang === 'IT' || ch.lang === 'EN', `lang non valido: ${ch.lang}`);
      assert.ok(typeof ch.cat === 'string' && ch.cat.length > 0, 'categoria mancante');
      assert.doesNotMatch(ch.name, /[<>&"]/, 'nome canale contiene caratteri HTML pericolosi');
    }
  });
});