# S.A.V.I.A — Second Brain Remote Control

Bot Telegram (Node.js + TypeScript) che riceve messaggi in linguaggio naturale,
li interpreta tramite **OpenRouter** (stessa chiave di S.A.V.I.A) e — dalla Fase 2 — esegue realmente
l'agente di coding richiesto (OpenCode) su un branch Git dedicato.

## Prerequisiti
- Node.js 18+ (testato con v25)
- Un bot Telegram creato via [BotFather](https://t.me/BotFather)
- La tua chiave **OpenRouter** (`OPENROUTER_API_KEY` — la stessa già usata in S.A.V.I.A → `savia-config.json`)
- `opencode` installato e raggiungibile da PATH (agente primario)
- `git` installato (simple-git lo invoca)
- `gh` CLI installata e autenticata (`gh auth login`) — per l'apertura della PR (Fase 3).
  Il bot **non** installa `gh` se manca: lo rileva e te lo notifica.
- Per ogni progetto in `projects.config.json`: un repository Git con remote `origin` configurato
  e credenziali di sistema valide (SSH key o Git Credential Manager Windows). Non viene gestita
  alcuna credenziale nuova: si riusa quella già presente sul sistema.

## Setup

1. Crea il bot su BotFather e copia il **token**.
2. Ottieni il tuo **chat ID** Telegram (es. scrivi al bot e usa `@userinfobot`, oppure
   leggi `chat_id` dai log locali dopo un primo messaggio di test).
3. Copia il file di configurazione d'esempio e compilalo:

   ```powershell
   cd bot
   Copy-Item .env.example .env.local
   ```

    `.env.local`:
    ```
    TELEGRAM_BOT_TOKEN=il_tuo_token
    OPENROUTER_API_KEY=la_stessa_chiave_di_savia-config.json
    ALLOWED_CHAT_ID=il_tuo_chat_id
    OPENROUTER_MODEL=nvidia/nemotron-3.5-lightning:free
    AGENT_TIMEOUT_MS=600000
    ```

4. Compila `projects.config.json` con i tuoi progetti reali (i percorsi devono essere
   repository Git puliti prima di lanciare un task).

## Installazione ed avvio

```powershell
cd bot
npm install
npm run dev
```

`npm run dev` avvia il bot in modalità long polling (nessun webhook, nessuna porta aperta).

## Flusso (Fase 2)
1. Messaggio → parsing (progetto/agente/intento) via Claude.
2. Se `ambiguous` → il bot chiede un chiarimento e si ferma.
3. Se chiaro → crea un branch `savia/<timestamp>-<slug>` sul progetto, lancia l'agente,
   cattura l'output, fa `commit` se ci sono modifiche, poi torna al branch originale.
4. Notifica il risultato su Telegram (branch, file modificati, comando per rivedere).

### Coda dei job
- I task sul **mese progetto** sono serializzati (FIFO, in-memory); quelli su progetti
  diversi girano in parallelo.
- Se arriva un messaggio mentre un task è in corso sullo stesso progetto, il bot risponde
  "⏳ in attesa" e lo esegue al termine del precedente.

### Guardrail
- Non parte mai su un working tree sporco (aborta e avvisa).
- In caso di timeout/errore con modifiche a metà, **non committata** lo stato parziale:
  lo mette in `stash` sul branch `savia/...` e ti dice come recuperarlo
  (`git checkout <branch> && git stash pop`).
- Alla fine di ogni job (successo/fallimento/timeout) il repo torna sempre sul branch originale.

## Fase 3 — Push & PR (nessun auto-merge)
Dopo il commit (Fase 2) il bot:
1. **Verifica `gh`** all'inizio del job (prima di far lavorare l'agente): se `gh auth status`
   fallisce, avvisa subito su Telegram e prosegue comunque con il branch locale, ma salterà la PR.
2. **Push** del branch `savia/...` su `origin` (`git push -u origin <branch>`).
3. **Apre la PR** con `gh pr create` (titolo = `intent_summary` troncato a 72 char, corpo con
   intento originale, agente, file modificati, timestamp, e la nota "🤖 PR generata automaticamente
   da S.A.V.I.A. — revisionare prima del merge"). Il base branch è rilevato dinamicamente via
   `gh repo view --json defaultBranchRef` (mai hardcoded a `main`).
4. **Notifica** il risultato con granularità: distingue commit ok / push ok / PR ok, e in caso di
   errore su uno step dice chiaramente cosa è recuperabile a mano.

Esempio di notifica end-to-end (tutto ok):
```
✅ Completato — PR aperta
Progetto: curriculuxe
Branch: savia/20260826-143012-fix-validazione-email
File modificati: 3
  - src/components/SignupForm.tsx
  - src/lib/validation.ts
  - src/lib/validation.test.ts

🔗 Revisiona qui: https://github.com/<owner>/<repo>/pull/42
```

Esempio se `gh` non è autenticato (avviso iniziale + push ok, PR saltata):
```
✅ Commit + push fatti sul branch locale
❌ PR non aperta: gh non autenticato/disponibile (vedi avviso iniziale)
Progetto: curriculuxe
Branch: savia/20260826-143012-fix-validazione-email
File modificati: 3
  - src/components/SignupForm.tsx
  - src/lib/validation.ts
  - src/lib/validation.test.ts

🔗 Push riuscito — apri la PR a mano: gh pr create --head savia/20260826-143012-fix-validazione-email
```

### Guardrail (Fase 3)
- **Nessun merge automatico, mai.** Il flusso si ferma alla PR aperta.
- Se il push o la PR falliscono, il branch locale resta intatto e committato; il bot te lo dice.
- Se `gh` manca nel PATH, non viene installato: il bot lo rileva e notifica cosa manca.

## Verifica headless degli agenti (importante)
Ho verificato i CLI sul sistema al momento dello sviluppo:

- **OpenCode** — `opencode run "<prompt>"` è la modalità headless (senza TUI). Per non
  restare appeso in attesa di conferme, il runner lancia con il flag `--auto`
  ("auto-approve permissions that are not explicitly denied"). Se nella tua versione
  installata `--auto` non basta (es. servono preset di permessi specifici), dovrai
  adattare `src/agents/openCodeRunner.ts`. Opzionale: per evitare il cold-start dei
  server MCP su task ravvicinati, puoi tenere attivo `opencode serve` e lanciare con
  `opencode run --attach http://localhost:PORT "<prompt>"` (da implementare se serve).
- **FreeBuff** — `freebuff --help` **non espone alcun flag headless/non-interattivo**
  (`--print`, `--yes`, `--headless`, `--non-interactive` assenti). Costruito su TUI
  interattiva, viene pilotato tramite **pseudo-terminale** (`node-pty`): il runner
  apre un PTY, lancia `freebuff --cwd <project>`, attende l'avvio, scrive il prompt
  seguito da invio, e cattura l'output grezzo (strip degli escape ANSI per il log).
  Poiché non c'è un segnale di "fatto" affidabile, il completamento è rilevato con
  una di queste euristiche (tutte configurabili in `.env.local`):
  - `FREEBUFF_DONE_PATTERN` — regex che, se trovata nell'output pulito, indica la fine.
  - `FREEBUFF_QUIET_MS` — se non arriva più output per N ms (dopo averne visto), si assume
    terminato (FreeBuff è tornato al prompt interattivo). Default 3000.
  - `FREEBUFF_STARTUP_MS` — attesa prima di inviare il prompt, per lasciare inizializzare
    la TUI. Default 3000.
  - `AGENT_TIMEOUT_MS` — cap duro: scaduto, il PTY viene chiuso (Ctrl-C + kill tree) e il
    job è gestito come timeout (stash delle modifiche parziali, nessun commit).
  Nota di fragilità: il comportamento esatto dipende dalla TUI di FreeBuff; potresti
  dover tarare `FREEBUFF_STARTUP_MS` / `FREEBUFF_QUIET_MS` / `FREEBUFF_DONE_PATTERN` sul
  tuo sistema. FreeBuff deve essere già autenticato (`freebuff login`) o resterà appeso
  alla richiesta di login.

## Struttura
- `src/index.ts` — entry point: bot Telegram, whitelist, routing, coda
- `src/config.ts` — caricamento env e `projects.config.json`
- `src/parser.ts` — chiamata a OpenRouter e parsing del JSON di risposta
- `src/agents/` — `AgentRunner`, `OpenCodeRunner`, `FreeBuffRunner`
- `src/gitOps.ts` — operazioni Git (clean check, branch, commit, push, stash, cleanup)
- `src/prOps.ts` — interazione con `gh` (auth check, default branch, creazione PR)
- `src/jobQueue.ts` — coda per-progetto FIFO in-memory
- `src/executor.ts` — orchestrazione del job (branch → agente → commit → notifica)
- `src/logger.ts` — logging su `logs/savia.log` in formato JSON lines
- `src/util.ts` — utilità (kill tree su timeout)
- `projects.config.json` — definizione progetti/alias
- `logs/savia.log` — log di esecuzione (non committato)

## Note
- Il bot risponde **solo** al `ALLOWED_CHAT_ID` configurato; gli altri messaggi sono ignorati.
- Ogni risposta utile include l'immagine `savia.png` (alla radice del repo, `../savia.png`
  rispetto alla cartella `bot/`) inviata come foto con il testo in didascalia.
- I secret vivono in `.env.local` (mai committato). `.env.example` è solo un template.
- In caso di errore il bot risponde con un messaggio leggibile e non crasha.
