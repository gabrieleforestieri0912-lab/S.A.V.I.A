/**
 * S.A.V.I.A - System Operations Controller
 * Executes computer control commands from AI responses and voice
 */

const systemAPI = window.electronAPI;

// ── Scenarios ────────────────────────────────────────────────────────

const SCENARIOS = [
  'Ambiente Sviluppo Python',
  'Ambiente Sviluppo Web',
  'Ambiente Sviluppo Node.js',
  'Ambiente Lavoro',
  'Modalità Gaming',
  'Pulizia Desktop'
];

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

    case 'whatsapp':
      try {
        const waNumber = (action.phone || '').replace(/[^0-9+]/g, '');
        const waText = encodeURIComponent(action.message || '');
        const waUrl = waNumber
          ? `whatsapp://send?phone=${waNumber}&text=${waText}`
          : `whatsapp://send?text=${waText}`;
        if (systemAPI && systemAPI.systemOpenUrl) {
          await systemAPI.systemOpenUrl(waUrl);
        } else {
          window.open(waUrl, '_blank');
        }
        addTickerEvent('sys', `[SYS] WhatsApp: messaggio preparato${waNumber ? ` per ${waNumber}` : ''}`);
        if (typeof sendNotification === 'function') {
          sendNotification(`WhatsApp: messaggio preparato`, 'success', 3000);
        }
      } catch (e) {
        addTickerEvent('warn', `[SYS] WhatsApp errore: ${e.message}`);
      }
      break;

    case 'sms':
      try {
        const smsNumber = (action.phone || '').replace(/[^0-9+]/g, '');
        const smsText = encodeURIComponent(action.message || '');
        const smsUrl = smsNumber
          ? `sms:${smsNumber}?body=${smsText}`
          : `sms:?body=${smsText}`;
        if (systemAPI && systemAPI.systemOpenUrl) {
          await systemAPI.systemOpenUrl(smsUrl);
        } else {
          window.open(smsUrl, '_blank');
        }
        addTickerEvent('sys', `[SYS] SMS: messaggio preparato${smsNumber ? ` per ${smsNumber}` : ''}`);
        if (typeof sendNotification === 'function') {
          sendNotification(`SMS: messaggio preparato`, 'success', 3000);
        }
      } catch (e) {
        addTickerEvent('warn', `[SYS] SMS errore: ${e.message}`);
      }
      break;
  }
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

      case 'whatsapp':
        const waParts = (cmd.args || '').match(/^(\+?[\d\s\-().]+)\s*[-:]\s*(.+)$/s);
        if (waParts) {
          await executeAction({ type: 'whatsapp', phone: waParts[1].trim(), message: waParts[2].trim() });
        } else {
          await executeAction({ type: 'whatsapp', message: cmd.args || '' });
        }
        executed = true;
        break;

      case 'sms':
        const smsParts = (cmd.args || '').match(/^(\+?[\d\s\-().]+)\s*[-:]\s*(.+)$/s);
        if (smsParts) {
          await executeAction({ type: 'sms', phone: smsParts[1].trim(), message: smsParts[2].trim() });
        } else {
          await executeAction({ type: 'sms', message: cmd.args || '' });
        }
        executed = true;
        break;

      case 'quit':
      case 'shutdown':
      case 'exit':
      case 'esci':
      case 'spegni':
        if (systemAPI && systemAPI.quitApp) {
          systemAPI.quitApp();
          executed = true;
        }
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
  const scenarioNames = SCENARIOS.join(', ');
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
[CMD] whatsapp:numero - messaggio - Invia un messaggio WhatsApp (formato: numero - testo)
[CMD] sms:numero - messaggio - Invia un SMS (formato: numero - testo)
[CMD] quit - Spegni completamente S.A.V.I.A (SOLO su richiesta esplicita dell'utente)

Scenario predefiniti: ${scenarioNames}
Quando l'utente chiede esplicitamente di preparare un ambiente di lavoro, usa lo scenario appropriato con [CMD] e descrivi cosa hai fatto.
`.trim();
}

// ── Append to AI Context (called from memory.js buildMemoryContext eventually) ──
// This function is called from the system prompt builder

// ── Init ─────────────────────────────────────────────────────────────

addTickerEvent('sys', 'System Operations Controller caricato.');
