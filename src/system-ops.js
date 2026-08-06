/**
 * S.A.V.I.A - System Operations Controller
 * Executes computer control commands from AI responses and voice
 */

const systemAPI = window.electronAPI;

// ── Scenarios ────────────────────────────────────────────────────────

const SCENARIOS = {
  'python-dev': {
    name: 'Ambiente Sviluppo Python',
    keywords: ['python', 'py dev', 'sviluppo python', 'python dev'],
    actions: [
      { type: 'log', text: 'Preparazione ambiente Python...' },
      { type: 'open', target: 'code' },
      { type: 'open', target: 'terminal' },
      { type: 'open', target: 'browser', args: 'https://docs.python.org/3/' }
    ]
  },
  'web-dev': {
    name: 'Ambiente Sviluppo Web',
    keywords: ['web', 'sviluppo web', 'frontend', 'html css'],
    actions: [
      { type: 'log', text: 'Configurazione ambiente Web...' },
      { type: 'open', target: 'code' },
      { type: 'open', target: 'terminal' },
      { type: 'open', target: 'browser', args: 'https://developer.mozilla.org/' }
    ]
  },
  'node-dev': {
    name: 'Ambiente Sviluppo Node.js',
    keywords: ['node', 'nodejs', 'javascript dev', 'npm'],
    actions: [
      { type: 'log', text: 'Avvio ambiente Node.js...' },
      { type: 'open', target: 'code' },
      { type: 'open', target: 'terminal' },
      { type: 'open', target: 'browser', args: 'https://nodejs.org/docs/latest/api/' }
    ]
  },
  'work': {
    name: 'Ambiente Lavoro',
    keywords: ['lavoro', 'ufficio', 'work mode', 'productivity'],
    actions: [
      { type: 'log', text: 'Allestimento ambiente lavoro...' },
      { type: 'open', target: 'code' },
      { type: 'open', target: 'browser' },
      { type: 'open', target: 'terminal' }
    ]
  },
  'gaming': {
    name: 'Modalità Gaming',
    keywords: ['gioco', 'gaming', 'giocare', 'game'],
    actions: [
      { type: 'log', text: 'Passaggio a modalità gaming...' },
      { type: 'close', target: 'code' },
      { type: 'close', target: 'browser' }
    ]
  },
  'cleanup': {
    name: 'Pulizia Desktop',
    keywords: ['pulisci', 'cleanup', 'pulizia', 'riordina'],
    actions: [
      { type: 'log', text: 'Pulizia desktop in corso...' },
      { type: 'close', target: 'notepad' },
      { type: 'close', target: 'calculator' }
    ]
  }
};

function findScenario(text) {
  const lower = text.toLowerCase();
  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    if (scenario.keywords.some(k => lower.includes(k))) {
      return key;
    }
  }
  return null;
}

// ── Action Executor ──────────────────────────────────────────────────

async function executeAction(action) {
  switch (action.type) {
    case 'log':
      addTickerEvent('sys', `[SYS] ${action.text}`);
      appendLogMessage('sys', action.text, 'system');
      break;

    case 'open':
      if (!systemAPI || !systemAPI.systemOpenApp) break;
      try {
        const result = await systemAPI.systemOpenApp({ name: action.target });
        if (result.success) {
          addTickerEvent('sys', `[SYS] ${result.action}`);
        } else {
          addTickerEvent('warn', `[SYS] ${result.error}`);
        }
      } catch (e) {
        addTickerEvent('warn', `[SYS] Errore apertura ${action.target}`);
      }
      break;

    case 'close':
      if (!systemAPI || !systemAPI.systemCloseApp) break;
      try {
        const result = await systemAPI.systemCloseApp(action.target);
        if (result.success) {
          addTickerEvent('sys', `[SYS] ${result.action}`);
        }
      } catch (e) { /* ignore */ }
      break;

    case 'open-file':
      if (!systemAPI || !systemAPI.systemOpenApp) break;
      try {
        const result = await systemAPI.systemOpenApp({ filePath: action.path });
        if (result.success) {
          addTickerEvent('sys', `[SYS] ${result.action}`);
        }
      } catch (e) { /* ignore */ }
      break;

    case 'search':
      if (!systemAPI || !systemAPI.systemSearchFiles) break;
      try {
        const result = await systemAPI.systemSearchFiles({ query: action.query });
        if (result.success && result.results.length > 0) {
          addTickerEvent('sys', `[SYS] Trovati ${result.results.length} file per "${action.query}"`);
          result.results.slice(0, 3).forEach(f => {
            appendLogMessage('sys', `📄 ${f.name} (${f.path})`, 'system');
          });
        } else {
          addTickerEvent('sys', `[SYS] Nessun file trovato per "${action.query}"`);
        }
      } catch (e) { /* ignore */ }
      break;

    case 'volume':
      if (!systemAPI || !systemAPI.systemVolume) break;
      try {
        const opts = {};
        if (action.subAction) opts.action = action.subAction;
        if (typeof action.value === 'number') opts.value = action.value;
        if (action.subAction === 'set') opts.action = 'set';
        const result = await systemAPI.systemVolume(opts);
        if (result.success && result.action) {
          addTickerEvent('sys', `[SYS] ${result.action}`);
        }
      } catch (e) { /* ignore */ }
      break;

    case 'brightness':
      if (!systemAPI || !systemAPI.systemBrightness) break;
      try {
        const result = await systemAPI.systemBrightness({ action: 'set', value: action.value });
        if (result.success && result.action) {
          addTickerEvent('sys', `[SYS] ${result.action}`);
        }
      } catch (e) { /* ignore */ }
      break;

    case 'media':
      if (!systemAPI || !systemAPI.systemMedia) break;
      try {
        const result = await systemAPI.systemMedia({ action: action.subAction || 'playpause' });
        if (result.success && result.action) {
          addTickerEvent('sys', `[SYS] ${result.action}`);
        } else if (!result.success) {
          addTickerEvent('warn', `[SYS] Media: ${result.error}`);
        }
      } catch (e) { /* ignore */ }
      break;

    case 'screenshot':
      if (!systemAPI || !systemAPI.systemScreenshot) break;
      try {
        const result = await systemAPI.systemScreenshot();
        if (result.success && result.path) {
          addTickerEvent('sys', `[SYS] Screenshot salvato: ${result.path}`);
          if (typeof sendNotification === 'function') {
            sendNotification(`Screenshot salvato in ${result.path}`, 'success', 6000);
          }
        } else {
          addTickerEvent('warn', `[SYS] Screenshot: ${result.error}`);
        }
      } catch (e) { /* ignore */ }
      break;
  }
}

// ── Run Scenario ─────────────────────────────────────────────────────

async function runScenario(scenarioKey) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) return false;

  addTickerEvent('sys', `[SYS] Esecuzione scenario: ${scenario.name}`);
  appendLogMessage('sys', `▶ Esecuzione scenario: ${scenario.name}`, 'system');
  appendLogMessage('sys', `⠙ Inizializzazione...`, 'system');

  for (let i = 0; i < scenario.actions.length; i++) {
    await executeAction(scenario.actions[i]);
    // Small delay between actions for visual feedback
    if (i < scenario.actions.length - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  appendLogMessage('sys', `✓ Scenario "${scenario.name}" completato.`, 'system');
  addTickerEvent('sys', `Scenario completato: ${scenario.name}`);
  return true;
}

// ── Parse AI Response for Commands ───────────────────────────────────

function parseAIResponse(text) {
  if (!text) return null;

  // Check for [CMD] directives in AI output
  const cmdRegex = /\[CMD\]\s*(\w+)(?:\s*:\s*(.+))?/gi;
  let match;
  const commands = [];

  while ((match = cmdRegex.exec(text)) !== null) {
    commands.push({ type: match[1].toLowerCase(), args: (match[2] || '').trim() });
  }

  return commands.length > 0 ? commands : null;
}

// ── Command Dispatcher (called from ollama.js after response) ────────

async function processSystemCommands(text) {
  const commands = parseAIResponse(text);
  if (!commands) return false;

  let executed = false;
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'open':
        await executeAction({ type: 'open', target: cmd.args || 'browser' });
        executed = true;
        break;

      case 'close':
        await executeAction({ type: 'close', target: cmd.args });
        executed = true;
        break;

      case 'search':
        await executeAction({ type: 'search', query: cmd.args });
        executed = true;
        break;

      case 'volume':
        const volArgs = cmd.args || '';
        if (volArgs.includes('%')) {
          const val = parseInt(volArgs);
          if (!isNaN(val)) await executeAction({ type: 'volume', subAction: 'set', value: val });
        } else if (volArgs.includes('mute') || volArgs.includes('silenzio')) {
          await executeAction({ type: 'volume', subAction: 'mute' });
        } else if (volArgs.includes('su')) {
          await executeAction({ type: 'volume', subAction: 'up' });
        } else if (volArgs.includes('giù') || volArgs.includes('down')) {
          await executeAction({ type: 'volume', subAction: 'down' });
        }
        executed = true;
        break;

      case 'brightness':
        const briArgs = cmd.args || '';
        const briVal = parseInt(briArgs);
        if (!isNaN(briVal)) await executeAction({ type: 'brightness', value: briVal });
        executed = true;
        break;

      case 'media':
        const mediaArgs = (cmd.args || '').toLowerCase();
        if (mediaArgs.includes('play') || mediaArgs.includes('pausa') || mediaArgs.includes('pause') || mediaArgs === '') {
          await executeAction({ type: 'media', subAction: 'playpause' });
        } else if (mediaArgs.includes('next') || mediaArgs.includes('prossim') || mediaArgs.includes('avanti')) {
          await executeAction({ type: 'media', subAction: 'next' });
        } else if (mediaArgs.includes('prev') || mediaArgs.includes('precedent') || mediaArgs.includes('indietro')) {
          await executeAction({ type: 'media', subAction: 'prev' });
        } else if (mediaArgs.includes('stop')) {
          await executeAction({ type: 'media', subAction: 'stop' });
        }
        executed = true;
        break;

      case 'screenshot':
        await executeAction({ type: 'screenshot' });
        executed = true;
        break;

      case 'move':
        const parts = cmd.args.split('→').map(s => s.trim());
        if (parts.length === 2 && systemAPI.systemMoveFile) {
          try {
            const result = await systemAPI.systemMoveFile({ source: parts[0], destination: parts[1] });
            if (result.success) addTickerEvent('sys', `[SYS] ${result.action}`);
          } catch (e) { /* ignore */ }
          executed = true;
        }
        break;
    }
  }

  return executed;
}

// ── Direct Command Interface (for voice/text shortcuts) ──────────────

async function executeDirectCommand(text) {
  const lower = text.toLowerCase();

  // Check scenarios first
  const scenarioKey = findScenario(text);
  if (scenarioKey) {
    await runScenario(scenarioKey);
    return true;
  }

  // Single commands
  if (lower.includes('volume')) {
    if (lower.includes('mute') || lower.includes('silenzio')) {
      await executeAction({ type: 'volume', subAction: 'mute' });
    } else if (lower.includes('su') || lower.includes('aumenta') || lower.includes('più alto')) {
      await executeAction({ type: 'volume', subAction: 'up' });
    } else if (lower.includes('giù') || lower.includes('diminuisci') || lower.includes('più basso')) {
      await executeAction({ type: 'volume', subAction: 'down' });
    }
    return true;
  }

  if (lower.includes('luminosità') || lower.includes('brightness')) {
    const match = lower.match(/(\d+)/);
    if (match) {
      await executeAction({ type: 'brightness', value: parseInt(match[1]) });
    }
    return true;
  }

  // Media control (voice/text: "metti play", "pausa", "prossima canzone")
  // Use word-boundary match for 'play' to avoid false positives (e.g. "player")
  const mediaPlay = /(^|\s)(play|riproduci|metti play)(\s|$)/.test(lower) || lower.includes('pausa') || lower.includes('pause');
  if (mediaPlay) {
    await executeAction({ type: 'media', subAction: 'playpause' });
    return true;
  }
  if (lower.includes('prossima canzone') || lower.includes('prossima traccia')) {
    await executeAction({ type: 'media', subAction: 'next' });
    return true;
  }
  if (lower.includes('canzone precedente') || lower.includes('traccia precedente')) {
    await executeAction({ type: 'media', subAction: 'prev' });
    return true;
  }

  if (lower.includes('screenshot') || lower.includes('cattura schermo')) {
    await executeAction({ type: 'screenshot' });
    return true;
  }

  const isAnalysis = lower.includes('analizza') || lower.includes('esamina') || lower.includes('leggi') || lower.includes('mostra contenuto');
  if ((lower.includes('apri') || lower.includes('avvia') || lower.includes('lancia')) && !isAnalysis) {
    const targets = ['vscode', 'code', 'chrome', 'firefox', 'edge', 'browser', 'terminal', 'cmd', 'notepad', 'explorer', 'spotify', 'slack', 'discord', 'telegram', 'calculator'];
    for (const t of targets) {
      if (lower.includes(t)) {
        await executeAction({ type: 'open', target: t });
        return true;
      }
    }
    // Generic open - try to extract app name
    const words = text.replace(/apri|avvia|lancia/gi, '').trim();
    if (words && !isAnalysis) {
      await executeAction({ type: 'open', target: words });
      return true;
    }
  }

  if (lower.includes('chiudi') || lower.includes('termina') || lower.includes('kill')) {
    const targets = ['vscode', 'code', 'chrome', 'firefox', 'edge', 'browser', 'terminal', 'notepad', 'calculator', 'spotify', 'slack', 'discord'];
    for (const t of targets) {
      if (lower.includes(t)) {
        await executeAction({ type: 'close', target: t });
        return true;
      }
    }
  }

  if (lower.includes('cerca') || lower.includes('trova') || lower.includes('search')) {
    const query = lower.replace(/cerca|trova|search/gi, '').trim();
    if (query) {
      await executeAction({ type: 'search', query });
      return true;
    }
  }

  return false;
}

// ── Hook into AI Response System ─────────────────────────────────────

// Listen for AI response completion
document.addEventListener('savia-response-complete', async (e) => {
  if (e.detail && e.detail.response) {
    const executed = await processSystemCommands(e.detail.response);
    if (executed) {
      addTickerEvent('sys', 'Comandi di sistema eseguiti dalla risposta AI.');
    }
  }
});

// ── Build Context for AI ─────────────────────────────────────────────

function buildSystemContext() {
  const scenarioNames = Object.values(SCENARIOS).map(s => s.name).join(', ');
  return `
SISTEMA: Hai il controllo completo del computer. Usa [CMD] SOLO se l'utente chiede ESPLICITAMENTE di aprire/chiudere qualcosa.
NON aprire MAI applicazioni se l'utente chiede solo di analizzare, leggere o esaminare file/cartelle/progetti.
NON aprire l'editor di codice se non richiesto esplicitamente.

Comandi disponibili:
[CMD] open:nomeapp - Apri un'app (SOLO su richiesta esplicita)
[CMD] close:nomeapp - Chiudi un'app
[CMD] volume:su/giù/mute/50% - Controlla volume
[CMD] brightness:70 - Imposta luminosità (0-100)
[CMD] search:query - Cerca file
[CMD] move:sorgente → destinazione - Sposta file
[CMD] media:play/pausa/next/prev/stop - Controllo riproduzione multimediale
[CMD] screenshot - Cattura lo schermo e salva in Pictures/SAVIA

Scenario predefiniti: ${scenarioNames}
Quando l'utente chiede esplicitamente di preparare un ambiente di lavoro, usa lo scenario appropriato con [CMD] e descrivi cosa hai fatto.
`.trim();
}

// ── Append to AI Context (called from memory.js buildMemoryContext eventually) ──
// This function is called from the system prompt builder

// ── Init ─────────────────────────────────────────────────────────────

addTickerEvent('sys', 'System Operations Controller caricato.');
