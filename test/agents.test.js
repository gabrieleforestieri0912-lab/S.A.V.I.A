'use strict';

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const agents = require('../src/agents.js');

// ============================================================
// classifyByKeywords — classificatore a keyword
// ============================================================
describe('classifyByKeywords', () => {
  test('query con più keyword tecniche → tecnico', () => {
    const r = agents.classifyByKeywords('il codice ha un bug e un errore nel debug');
    assert.equal(r.agentId, 'tecnico');
    assert.ok(r.confidence >= 2);
  });

  test('query ricerca web + meteo → ricercatore', () => {
    const r = agents.classifyByKeywords('cerca il meteo di oggi');
    assert.equal(r.agentId, 'ricercatore');
  });

  test('query organizzativa → organizzatore', () => {
    const r = agents.classifyByKeywords('organizza il mio calendario con i promemoria');
    assert.equal(r.agentId, 'organizzatore');
  });

  test('query creativa → creativo', () => {
    const r = agents.classifyByKeywords('crea un brainstorming di idee per un design');
    assert.equal(r.agentId, 'creativo');
  });

  test('query generica senza keyword → auto (confidence 0)', () => {
    const r = agents.classifyByKeywords('come stai?');
    assert.equal(r.agentId, 'auto');
    assert.equal(r.confidence, 0);
  });

  test('a parità di punteggio vince il primo agente in ordine di definizione', () => {
    // 'npm' → tecnico (1), 'notizie' → ricercatore (1): pareggio, vince tecnico
    const r = agents.classifyByKeywords('npm notizie');
    assert.equal(r.confidence, 1);
    assert.equal(r.agentId, 'tecnico');
  });
});

// ============================================================
// parseAgentTools — parsing dei tag [TOOL xxx:arg]
// ============================================================
describe('parseAgentTools', () => {
  const cases = [
    { pre: 'Ho trovato questo', input: '[TOOL] websearch:come coltivare basilico', tool: 'websearch' },
    { input: '[TOOL] webfetch:https://example.com', tool: 'webfetch' },
    { input: '[TOOL] kbsearch:retrieval RAG', tool: 'kbsearch' },
    { input: '[TOOL] calendar:list', tool: 'calendar' },
    { input: '[TOOL] todo:add|comprare latte|alta', tool: 'todo' },
    { input: '[TOOL] reminder:set|riunione|2026-08-10|10:30', tool: 'reminder' },
    { input: '[TOOL] imagine:un giardino cyberpunk', tool: 'imagine' },
    { input: '[TOOL] notify:messaggio | warn', tool: 'notify' }
  ];

  for (const c of cases) {
    test(`rileva [TOOL] ${c.tool}`, () => {
      const parts = c.input.replace(/\[TOOL\]\s*(\w+)\s*:\s*/, '');
      const parsed = agents.parseAgentTools(c.input);
      assert.equal(parsed.tool, c.tool);
      assert.equal(parsed.args, parts);
    });
  }

  test('case-insensitive rispetto al prefisso', () => {
    const parsed = agents.parseAgentTools('[tool] WEBSEARCH:moto elettrico');
    assert.equal(parsed.tool, 'websearch');
    assert.equal(parsed.args, 'moto elettrico');
  });

  test('testo senza tool → null', () => {
    assert.equal(agents.parseAgentTools('ciao come stai'), null);
    assert.equal(agents.parseAgentTools('[TOOL] sconosciuto:foo'), null);
  });
});

// ============================================================
// setActiveAgent / getActiveAgent / routeQuery
// ============================================================
describe('routing agente', () => {
  beforeEach(() => agents.setActiveAgent('auto'));

  test('override manuale vince su keywords e LLM', async () => {
    agents.setActiveAgent('ricercatore');
    assert.equal(await agents.routeQuery('il codice ha un bug'), 'ricercatore');
  });

  test('setActiveAgent auto cancella l override', () => {
    agents.setActiveAgent('tecnico');
    agents.setActiveAgent('auto');
    assert.equal(agents.getActiveAgent(), 'auto');
  });

  test('keyword con confidence >= 2 → agente senza chiamare LLM', async () => {
    const r = await agents.routeQuery('organizza il mio calendario con promemoria e scadenze');
    assert.equal(r, 'organizzatore');
  });

  test('query senza keyword (LLM offline) → auto', async () => {
    const r = await agents.routeQuery('buongiorno');
    assert.equal(r, 'auto');
  });
});

// ============================================================
// Integrità definizioni AGENTS — le keyword sono il cuore del router
// ============================================================
describe('definizioni AGENTS', () => {
  for (const id of ['tecnico', 'ricercatore', 'organizzatore', 'creativo']) {
    test(`agente ${id} ha i campi essenziali non vuoti`, () => {
      const a = agents.AGENTS[id];
      assert.ok(a, `AGENTS.${id} mancante`);
      assert.ok(a.name, 'nome mancante');
      assert.ok(a.color, 'colore mancante');
      assert.ok(Array.isArray(a.keywords) && a.keywords.length > 0, 'keywords mancanti');
      assert.ok(typeof a.prompt === 'string' && a.prompt.length > 0, 'prompt mancante');
    });
  }
});