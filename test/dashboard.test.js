'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { installRenderStubs } = require('./helpers.js');
installRenderStubs();
const dash = require('../src/dashboard.js');

// ============================================================
// getGaugeColor — colori dinamici dei gauges (verde→giallo→rosso)
// ============================================================
describe('getGaugeColor', () => {
  test('temp: soglie 50% oro / 80% rosso', () => {
    assert.equal(dash.getGaugeColor(0.3, 'temp'), '#00ff88');
    assert.equal(dash.getGaugeColor(0.6, 'temp'), 'var(--accent-gold)');
    assert.equal(dash.getGaugeColor(0.85, 'temp'), 'var(--accent-red)');
  });

  test('disk: soglie 75% oro / 90% rosso', () => {
    assert.equal(dash.getGaugeColor(0.5, 'disk'), 'var(--accent-cyan)');
    assert.equal(dash.getGaugeColor(0.8, 'disk'), 'var(--accent-gold)');
    assert.equal(dash.getGaugeColor(0.95, 'disk'), 'var(--accent-red)');
  });

  test('ram: soglie 70% oro / 85% rosso', () => {
    assert.equal(dash.getGaugeColor(0.5, 'ram'), 'var(--accent-purple)');
    assert.equal(dash.getGaugeColor(0.75, 'ram'), 'var(--accent-gold)');
    assert.equal(dash.getGaugeColor(0.9, 'ram'), 'var(--accent-red)');
  });

  test('tipo sconosciuto → null', () => {
    assert.equal(dash.getGaugeColor(0.3, 'cpu'), null);
    assert.equal(dash.getGaugeColor(0.3, ''), null);
  });

  test('confini inclusivi (soglia esclusa, valore sotto soglia ok)', () => {
    // temp: 0.5 non è > 0.5 quindi verde, 0.8 non è > 0.8 quindi oro
    assert.equal(dash.getGaugeColor(0.5, 'temp'), '#00ff88');
    assert.equal(dash.getGaugeColor(0.8, 'temp'), 'var(--accent-gold)');
  });
});

// ============================================================
// parseAgentDueDuplicata — stessa semantica di parseDueDate in main.js
// ============================================================
describe('parseAgentDue', () => {
  test('data e ora valide', () => {
    const d = dash.parseAgentDue('2026-08-08', '14:30');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 7);
    assert.equal(d.getDate(), 8);
    assert.equal(d.getHours(), 14);
    assert.equal(d.getMinutes(), 30);
  });

  test('default 09:00 senza ora', () => {
    assert.equal(dash.parseAgentDue('2026-08-08', '').getHours(), 9);
  });

  test('null quando manca tutto o formato sbagliato', () => {
    assert.equal(dash.parseAgentDue('', ''), null);
    assert.equal(dash.parseAgentDue('08-2026', '10:00'), null);
  });
});

// ============================================================
// fmtUpcomingCountdown — format del countdown T-
// ============================================================
describe('fmtUpcomingCountdown', () => {
  test('ms <= 0 → 00:00 (evita numeri negativi)', () => {
    assert.equal(dash.fmtUpcomingCountdown(0), '00:00');
    assert.equal(dash.fmtUpcomingCountdown(-5000), '00:00');
  });

  test('sotto l ora → MM:SS padded', () => {
    assert.equal(dash.fmtUpcomingCountdown(45000), '00:45');
    assert.equal(dash.fmtUpcomingCountdown(60000), '01:00');
  });

  test('nell ora → HH:MM:SS', () => {
    const oneHourOneMinOneSec = (60 * 60 + 60 + 1) * 1000; // 3661000 ms
    assert.equal(dash.fmtUpcomingCountdown(oneHourOneMinOneSec), '01:01:01');
  });

  test('oltre le 24h → "d g GH" (giorni non padded)', () => {
    const threeDays2h = (3 * 86400 + 2 * 3600) * 1000;
    assert.equal(dash.fmtUpcomingCountdown(threeDays2h), '3g 02h');
  });
});

// ============================================================
// fmtUpcomingDay — label OGGI / DOMANI / IERI / SCADUTO / data
// ============================================================
describe('fmtUpcomingDay', () => {
  test('scadenza oggi → OGGI', () => {
    const now = new Date();
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0);
    assert.equal(dash.fmtUpcomingDay('s', todayNoon), 'OGGI');
  });

  test('scadenza domani → DOMANI', () => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0);
    assert.equal(dash.fmtUpcomingDay('x', tomorrow), 'DOMANI');
  });

  test('scadenza ieri → IERI', () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0);
    assert.equal(dash.fmtUpcomingDay('x', yesterday), 'IERI');
  });

  test('scadenza in passato remoto → SCADUTO', () => {
    const now = new Date();
    const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 12, 0);
    assert.equal(dash.fmtUpcomingDay('x', past), 'SCADUTO');
  });

  test('scadenza futura >1 giorno → data it-IT (dd/mm)', () => {
    const now = new Date();
    const future = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 12, 0);
    assert.match(dash.fmtUpcomingDay('x', future), /^\d{2}\/\d{2}$/);
  });

  test('senza due valido → stringa raw', () => {
    assert.equal(dash.fmtUpcomingDay('2026-08-08', null), '2026-08-08');
  });
});