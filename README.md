# S.A.V.I.A — Cognitive HUD & AI Assistant

**S.A.V.I.A** = **Smart Artificial Virtual Intelligence Assistant**

**Versione:** 4.0.0
**Runtime:** Electron 31 + Node.js
**AI Engine:** Multi-provider (OpenRouter / OpenCode / Local) — modello selezionabile
**Tema:** Cyberpunk HUD — Ispirato a JARVIS

---

## Indice

1. [Architettura Generale](#1-architettura-generale)
2. [Struttura del Progetto](#2-struttura-del-progetto)
3. [Main Process (main.js) — Backend Node.js](#3-main-process)
4. [Preload — Ponte IPC](#4-preload)
5. [Pagine HTML — Le Interfacce](#5-pagine-html)
6. [Moduli Renderer — Il Cuore dell'App](#6-moduli-renderer)
7. [Flusso AI — Dalla domanda alla risposta](#7-flusso-ai)
8. [Sistema Vocale](#8-sistema-vocale)
9. [API Esterne](#9-api-esterne)
10. [Novità v4.0.0](#10-novità-v400)
11. [Dipendenze](#11-dipendenze)

---

## 1. Architettura Generale

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS (Node.js)                        │
│  main.js                                                         │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Servizi: Telemetry, File System, Terminal, Memoria,       │   │
│  │ System Ops, RAG Pipeline, Agenti (calendar/todo/reminder), │   │
│  │ Hotline, Proximity (BLE), MCP Servers                      │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ IPC (contextBridge)
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    RENDERER PROCESS (Chromium)                    │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Pagine: index.html  terminal.html  youtube.html            │   │
│  │         particles.html  globe.html  knowledge.html         │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Moduli Renderer:                                            │   │
│  │ shared.js  agents.js  cognitive.js  telemetry.js            │   │
│  │ memory.js  system-ops.js  voice-control.js                  │   │
│  │ dashboard.js  commander.js  knowledge-base.js               │   │
│  │ youtube.js  globe.js  particles.js                          │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Pattern di comunicazione:**

- **Richiesta/Risposta** (`ipcMain.handle` / `ipcRenderer.invoke`): per query e comandi che richiedono un risultato (listDirectory, kbSearch, systemOpenApp)
- **Push in tempo reale** (`webContents.send` / `ipcRenderer.on`): telemetry (ogni 2s), eventi file system, output terminale
- **Eventi DOM personalizzati**: `savia-response-complete` dispatcato da cognitive.js e ascoltato da voice-control.js e system-ops.js

---

## 2. Struttura del Progetto

```
S.A.V.I.A/
├── package.json              # Metadati progetto, entry point Electron
├── main.js                   # Processo principale Electron (2236 righe)
├── preload.js                # Ponte IPC contextBridge (187 righe)
├── public/
│   └── savia.png             # Icona dell'app
│
├── src/
│   ├── index.html            # HUD principale — Terminale Cognitivo + Dashboard
│   ├── terminal.html         # Command Center — File Explorer + Terminale
│   ├── youtube.html          # Ricerca e riproduzione YouTube
│   ├── news.html             # News Feed Tech & AI + watchdog segnalazioni
│   ├── particles.html        # Motore 3D particelle neurali
│   ├── globe.html            # Mappa mondiale 3D con meteo
│   ├── knowledge.html        # Knowledge Base RAG
│   ├── mcp.html              # Hub server MCP (Model Context Protocol)
│   │
│   ├── style.css             # Foglio di stile cyberpunk HUD (2700+ righe)
│   │
│   ├── shared.js             # Utility condivise tra tutte le pagine
│   ├── agents.js             # Router multi-agente e definizioni
│   ├── cognitive.js          # Ponte AI multi-provider + chat + TTS + STAND BY
│   ├── telemetry.js          # Monitoraggio sistema in tempo reale
│   ├── memory.js             # Memoria contestuale personale
│   ├── system-ops.js         # Esecuzione comandi di sistema
│   ├── voice-control.js      # Wake word e speech-to-text
│   ├── dashboard.js          # Dashboard a gauges circolari
│   ├── commander.js          # File browser + emulatore terminale
│   ├── knowledge-base.js     # Interfaccia RAG
│   ├── globe.js              # Visualizzazione 3D Terra
│   ├── particles.js          # Sistema particelle 3D
│   ├── mcp-servers.js        # Servizio MCP (main process) — client SDK
│   ├── mcp.js                # Controller pagina MCP (renderer)
│   └── news.js               # Feed notizie + watchdog Tech/AI (condiviso index/news)
```

---

## 3. Main Process

**File:** `main.js`

Il processo principale Electron. Crea la finestra, gestisce i servizi di sistema e tutti gli handler IPC.

### Servizi esposti

| Servizio | Canali IPC | Descrizione |
|----------|-----------|-------------|
| **Finestra** | `window-minimize`, `window-maximize`, `window-close` | Gestione finestra frameless |
| **Telemetry** | `telemetry-update` (push) | Ogni 2 secondi: CPU%, RAM, frequenza, carico, uptime |
| **File Indexing** | `fs-index-start/stop/status`, `fs-event` (push) | Scansione ricorsiva directory + fs.watch |
| **File Explorer** | `list-directory`, `delete-item`, `rename-item`, `select-directory-dialog`, `get-home-dir`, `open-in-explorer`, `get-drives` | CRUD file system |
| **Terminale** | `terminal-set-cwd`, `terminal-get-cwd`, `terminal-execute`, `terminal-kill`, `terminal-output` (push) | Shell reale (cmd.exe su Windows, bash su Unix) |
| **Memoria** | `memory-load`, `memory-save`, `memory-scan-projects`, `memory-add-conversation`, `memory-daily-summary` | Persistenza JSON in `savia-memory.json` |
| **System Ops** | `system-open-app`, `system-close-app`, `system-move-file`, `system-search-files`, `system-screenshot`, `system-volume`, `system-brightness`, `system-list-processes` | Controllo completo del computer |
| **Telemetry Estesa** | `get-extended-telemetry`, `get-process-list` | GPU, rete, dischi, processi (PowerShell WMI) |
| **Agenti** | `agent-tool` | CRUD calendario, todo, reminder (JSON) |
| **RAG** | `kb-index-file`, `kb-index-directory`, `kb-search`, `kb-list`, `kb-delete`, `kb-status` | Pipeline RAG completa |
| **MCP Servers** | `mcp-status`, `mcp-save`, `mcp-remove`, `mcp-start`, `mcp-stop`, `mcp-list-tools`, `mcp-call-tool`, `mcp-event` (push) | Client MCP (stdio/SSE/HTTP) → tool esposti all'agente AI |

### Servizio MCP (Model Context Protocol)

`src/mcp-servers.js` è un servizio del main process costruito sull'SDK ufficiale `@modelcontextprotocol/sdk`. Gestisce la connessione a qualunque server MCP e ne espone i tool all'intero sistema:

- **Trasporti supportati**: `stdio` (processo locale: `npx`, `node`, `python`...), `sse` (Server-Sent Events) e `streamable-http`.
- **Discovery tool**: ogni server connesso espone la sua lista `tools/list`; i tool confluiscono in una lista piatta disponibile all'agente cognitivo (`listTools`).
- **Chiamata tool**: `callTool` inoltra la richiesta al server e converte la risposta (testo, immagini, risorse) in testo leggibile per l'AI.
- **Eventi**: `status` e `tools` vengono inoltrati a tutta la UI via `mcp-event` (push) — la cache `window.MCP_TOOL_DOCS` in `cognitive.js` si aggiorna live.
- **Config + autostart**: l'elenco server vive in `savia-config.json` (`mcpServers`); all'avvio di S.A.V.I.A vengono connessi automaticamente i server con `enabled: true`.
- **Agent tool**: l'AI può chiamare qualunque tool MCP con `[TOOL] mcp:<serverId> <toolName> <json>` (vedi `parseAgentTools`).
- **UI**: pagina `mcp.html` per aggiungere/modificare/rimuovere server, avviarli/fermarli e testarne i tool manualmente (JSON args + CALL).

### Pipeline RAG (Knowledge Base)

```
File (txt/md/pdf/docx/code)
    │
    ▼
Estrazione testo (per tipo file)
    │
    ▼
Chunking (1500 caratteri, 200 overlap)
    │
    ▼
Embedding via Local AI (nomic-embed-text)
    │
    ▼
Salvataggio in knowledge-base.json
    │
    ▼
Ricerca: query → embedding → cosine similarity → risultati ordinati
```

---

## 4. Preload

**File:** `preload.js`

Usa `contextBridge.exposeInMainWorld` per esporre `window.electronAPI` al renderer. Ogni metodo IPC è esposto come funzione asincrona, mantenendo l'isolamento del contesto (`contextIsolation: true`, `nodeIntegration: false`).

---

## 5. Pagine HTML

### `index.html` — HUD Principale

Layout a 3 pannelli:
- **Sinistra:** Navigazione moduli, link progetti, indicatori servizi
- **Centro:** Animazione reattore SVG + Terminale Cognitivo (chat)
- **Destra:** Gauges telemetry, modalità sistema, selettore agente, controlli vocali, Memoria

**Scripts caricati:**
```
shared.js → agents.js → cognitive.js → telemetry.js → memory.js
→ system-ops.js → voice-control.js → dashboard.js → knowledge-base.js
```

**Viste:**
- `Terminale` (default) — chat con AI
- `Dashboard` — gauges SVG circolari (CPU, RAM, GPU, Temp, Disk, Net) + lista processi + pannello **UPCOMING SCHEDULE**

### `terminal.html` — Command Center

- **Centro:** File explorer (toolbar + lista file) + emulatore terminale + scanner AI
- **Destra:** Telemetry + log ticker + mode toggles

### `youtube.html` — YouTube Player

- Ricerca video con filtri (ordine, durata, safeSearch)
- Pannello dettagli con statistiche (view, like, commenti) e azioni rapide (PLAYLIST, ISCRIVITI, ANALIZZA)
- Tab **PLAYLIST**: playlist locali (crea/apri/elimina, aggiungi e rimuovi video dal dettaglio)
- Tab **ISCRITTI**: iscrizioni locali ai canali (dedup, rimozione, apertura canale)
- Tab **ANALISI**: report di performance del canale (iscritti, visualizzazioni, engagement, medie, top video, durata media)
- **Comandi vocali / testo** dall'index (che attraversano le finestre via localStorage `yt-cmd`):
  `cerca su youtube …`, `aggiungi alla playlist …`, `rimuovi dalla playlist …`, `iscriviti al canale …`, `analizza canale …`
- Chiave API configurabile da interfaccia

### `news.html` — News Feed Tech & AI

- Feed unificato da **Hacker News** (Algolia), **DEV Community** e **Google News IT** (via proxy allorigins) — senza API key
- Categorie **TUTTE / AI / TECH** (classificazione automatica del titolo), ricerca, selezione sorgenti
- **Watchdog S.A.V.I.A**: nella finestra principale controlla le sorgenti ogni N minuti (configurabile); quando trova notizie nuove avvisa con notifica di sistema + toast + voce e logga le segnalazioni
- Dedup tramite cursor in localStorage: le notizie già viste non vengono ripetute
- Salvataggio locale "per dopo" delle notizie
- Comandi vocali/testo dall'index: `apri le notizie`, `ultime notizie`, `vai alle notizie`…

### `particles.html` — Particelle Neurali

- Three.js: forme sfera, ipercubo, galassia a spirale
- Controlli: conteggio (1k-10k), dimensione, colori, rotazione
- Gesture: movimento mano ruota, pinch scala, flick resetta

### `globe.html` — Mappa Mondiale 3D

- Three.js: Terra texturizzata con atmosfera, nuvole, stelle
- 15 città mondiali con orario locale e meteo (Open-Meteo API)
- Gesture: mano ruota globo, pinch zoom, puntamento seleziona città

### `knowledge.html` — Knowledge Base

- Lista documenti indicizzati con eliminazione
- Ricerca semantica con punteggio di similarità (cosine similarity)

### `mcp.html` — MCP Servers (Connect Any App)

- Pannello sinistro: form AGGIUNGI/MODIFICA server (nome, trasporto, comando/URL, args, env/headers JSON, auto-connect) + lista server configurati con stato, pulsanti CONNETTI/STOP/MODIFICA/RIMUOVI + log MCP
- Pannello destro: **TOOL DISCOVERED** — tutti i tool dei server connessi, descrizione e runner di test (args JSON + CALL) con output inline
- Accessibile dal nav rail di tutte le pagine (`MCP_SERVERS`), dal comando vocale e dall'agent (`navigate_mcp`)

---

## 6. Moduli Renderer

### `shared.js` — Utility Condivise

Caricato da ogni pagina HTML. Gestisce:
- Stato globale: `soundEnabled`, `overclockEnabled`, `scanlinesEnabled`, `aiOnline`
- `updateClock()` — aggiorna orologio HUD ogni secondo
- `addTickerEvent(prefix, msg)` — eventi nel ticker e log modale
- `setServiceStatus(el, status)` — indicatori stato servizi
- `initSystemInfo()` — rileva hostname, OS, CPU, RAM all'avvio
- Log modale con filtri

### `agents.js` — Router Multi-Agente

Definisce 4 agenti specializzati + routing automatico.

| Agente | Colore | Keywords | Competenze |
|--------|--------|----------|------------|
| **TECNICO** | `#00ff88` | codice, programma, debug, bug, errore, git, npm | Programmazione, debug, analisi codice |
| **RICERCATORE** | `#9d4edd` | cerca, ricerca, web, notizie, meteo, wikipedia | Ricerca web, sintesi documenti |
| **ORGANIZZATORE** | `#ffb703` | calendario, agenda, todo, task, promemoria | Gestione tempo e attività |
| **CREATIVO** | `#ff2a5f` | crea, disegna, immagine, design, brainstorming | Design, immagini, idee |

**Routing (routeQuery):**
```
1. Override manuale dell'utente → usa quello
2. Keyword matching (≥2 match) → agente selezionato
3. LLM classifier (llama3) → classifica la richiesta
```

**Tools eseguibili dall'AI:**
- `[TOOL] websearch:query` — cerca su DuckDuckGo
- `[TOOL] webfetch:url` — legge contenuto pagina
- `[TOOL] kbsearch:query` — cerca nella knowledge base
- `[TOOL] calendar:list|add|...` — gestione calendario
- `[TOOL] todo:list|add|done` — gestione task
- `[TOOL] reminder:set|...` — promemoria
- `[TOOL] imagine:descrizione` — genera prompt immagini
- `[TOOL] mcp:<serverId> <toolName> {json}` — chiama un tool di un server MCP connesso (server/args autodiscovery)

### `cognitive.js` — Ponte AI (brain multi-provider)

Il modulo centrale. Si connette al provider AI selezionato (OpenRouter / OpenCode / Local), gestisce chat streaming, input vocale, comandi azione e TTS.

**Flusso chat (submit del form):**

```
Input utente
    │
    ▼
detectAndExecuteAction() ─── se comando diretto → esegue azione UI
    │ (non è un comando azione)
    ▼
routeQuery() → seleziona agente
    │
    ▼
POST /api/chat (llama3) → stream risposta
    │
    ▼
Parsing risposta:
    ├── [TOOL ...] → executeAgentTool()
    ├── [ACTION:...] → executeAction() (click UI)
    └── [CMD ...] → processSystemCommands()
    │
    ▼
Pulisce tag [TOOL]/[ACTION] dal testo
    │
    ▼
Auto-speak (ElevenLabs TTS) + log conversazione in memoria
```

**Action Mappings:** L'AI può eseguire azioni UI scrivendo `[ACTION:nome]` nella risposta. Oltre 30 azioni mappate: navigazione pagine, toggle modalità, comandi terminale, controllo globe/particelle.

**STAND BY (pausa/ripresa):** mentre una risposta viene generata o letta ad alta voce, S.A.V.I.A può essere messa in pausa e ripresa **esattamente dal punto in cui era rimasta**:
- Comandi rapidi: **"mettiti in pausa" / "pausa" / "standby"** e **"ricomincia" / "riprendi" / "riparti"** — intercettati come fast-path *prima* di `stopSpeaking()`, per non cancellare la sintesi in corso.
- **TTS in corso** → pausa/ripresa nativa (`synth.pause()/resume()` su Web Speech, `audio.pause()/play()` su ElevenLabs): la voce riprende dalla parola esatta.
- **Stream AI in corso** → il loop di generazione si blocca su un gate (`waitIfStandby`) e riprende dal token successivo; `streamActive` viene azzerato nei `catch` e da `resetStandby()` quando arriva una nuova query.
- **UI**: pulsante `STAND BY (PAUSA)` ⇄ `RIPRENDI (RICOMINCIA)` nel pannello VOICE INTERFACE, indicatore gold su `agent-status-text`/`agent-dot`, ticker + notifica.
- **API**: `window.saviaStandbyPause()` / `window.saviaStandbyResume()`.
- Stato vocale: il consumo di un comando standby emette `savia-standby-command`, che ripristina il riconoscimento vocale (evita di restare bloccati in `PROCESSING`).

### `telemetry.js` — Monitoraggio Sistema

Riceve push ogni 2 secondi dal main process e aggiorna:
- Barra CPU (fill + percentuale)
- Barra RAM (fill + percentuale)
- Frequenza CPU
- Temperatura (stimata dal carico)
- Stato servizi (online/offline)

### `memory.js` — Memoria Contestuale

Persiste in `savia-memory.json`:
- **Conversazioni:** ultime 50, con riassunto
- **Progetti:** scansione automatica da `~/Documents/Progetti`
- **Obiettivi:** short-term e long-term con CRUD
- **Persone:** contatti con contesto e ultimo contatto
- **Riassunti giornalieri:** ultimi 30

Il contesto viene iniettato nel prompt di sistema dell'AI via `buildMemoryContext()`:
progetti attivi, obiettivi in corso, persone chiave, attività odierna.

### `system-ops.js` — Operazioni di Sistema

Esegue comandi reali sul computer. L'AI può usare `[CMD]`:
- `[CMD] open:chrome/vscode/spotify/...` — apre applicazioni
- `[CMD] close:nome_processo` — chiude processi
- `[CMD] search:query` — cerca file
- `[CMD] screenshot` — cattura schermo
- `[CMD] volume:su/giù/mute`
- `[CMD] brightness:70`

Include scenari predefiniti: `python-dev`, `web-dev`, `node-dev`, `work`, `gaming`, `cleanup`

### `voice-control.js` — Controllo Vocale

Macchina a stati:

```
IDLE → WAKE_LISTEN → "Hey SAVIA" → WAKE_HEARD
    └── se già ho comando → PROCESSING
    └── altrimenti → CAPTURING (ascolta comando) → PROCESSING
                                              → AI risponde → SPEAKING (TTS)
                                                              → se modalità continua → CAPTURING
                                                              → altrimenti → WAKE_LISTEN
```

- Wake word: "hey savia", "ehi savia", "savia", "s.a.v.i.a."
- Riconoscimento: Web Speech API, italiano (`it-IT`)
- Heartbeat ogni 5s che riavvia il recognizer se morto silenziosamente
- Modalità continua: dopo la risposta, riascolta subito senza wake word

### `dashboard.js` — Gauges Dashboard + UPCOMING SCHEDULE

**Gauges SVG circolari:**
- `setGauge(id, percentuale, label)` — aggiorna stroke-dashoffset
- `getGaugeColor(pct, type)` — colore dinamico (verde < giallo < rosso)
- Refresh ogni 3 secondi

**Pannello UPCOMING SCHEDULE** — agenda unificata in tempo reale con countdown:

- **Fonti dati**: eventi calendario e promemoria (`agent-data.json` via `agentTool`) + todo AI + obiettivi attivi (`savia-goals` in localStorage), fusi in un'unica lista ordinata per scadenza (all-day in coda).
- **Countdown live**: ticker al secondo che mostra `T-` HH:MM:SS, stato `SCADUTO` a zero e label `OGGI`/`DOMANI`/data; i todo scaduti restano visibili (lo scheduler non li marca `fired`).
- **Alert di scadenza**: alla transizione a scaduto, chime WebAudio (doppio beep 880/660Hz) + anello rosso pulsante sul pannello + contatore `⚠ N SCADUTI` lampeggiante — il tutto **dedupato** (una sola volta per item) e **controllabile** dal toggle volume nell'header (persistito in localStorage).
- **Azione inline**: bottone 🗑 per eliminare eventi/promemoria/todo/obiettivi (con sync `calendar-sync` e pulizia della copia locale `calendar-events` per evitare resurrect) e checkbox ✓ per completare todo/obiettivi.
- **Feedback animato**: completamento → check verde + strikethrough + fade-out a destra; eliminazione → fade-out rosso a sinistra. Il refresh 3s viene sospeso durante le animazioni (flag `upcomingAnimating`).
- **Beep di conferma**: tono ascendente (523→784Hz) al completamento; notifica `OBIETTIVO COMPLETATO — X/Y` quando si completa l'ultimo todo/obiettivo.

### `commander.js` — File Explorer + Terminale

**File Explorer:**
- Lista drive all'avvio
- Navigazione con cronologia (back/forward/up)
- Icone per tipo file (100+ mappature)
- Menu contestuale: Rinomina, Elimina, Copia percorso, Apri in Explorer
- Smart Scanner AI: descrive ogni file con AI locale (batch 5 file)

**Terminale Emulatore:**
- Shell reale via IPC (cmd.exe/bash)
- Output stdout/stderr in tempo reale
- Cronologia comandi (freccia su/giù)
- `cd` sincronizzato con file explorer
- Clear output, kill processo

### `knowledge-base.js` — Interfaccia RAG

- `kbRefreshStatus()` — conteggio documenti/chunk
- `kbIndexDirectory()` — indicizzazione directory
- `kbSearchInput(query)` — ricerca semantica con debounce 400ms
- Risultati con punteggio di similarità

### `globe.js` — Terra 3D

- Three.js: Earth texture + atmosphere glow + clouds + 2000 stelle
- 15 città con marker cliccabili, orario locale, meteo (Open-Meteo)
- Camera zoom animata su città selezionata
- MediaPipe: mano ruota globo, pinch zoom, puntamento seleziona città

### `particles.js` — Particelle 3D

- Three.js: 3 forme (Sfera, Ipercubo, Galassia)
- Controlli: conteggio, dimensione, colori base/accento, rotazione
- MediaPipe: mano ruota campo, pinch scala, flick resetta

### `youtube.js` — YouTube API

- Connessione a YouTube Data API v3
- Ricerca con filtri (order, duration, safeSearch)
- Statistiche video (view, like, commenti)
- Durata ISO 8601 → HH:MM:SS
- Chiave API configurabile e salvata in localStorage

---

## 7. Flusso AI

*Nota: prima ancora del routing, i comandi STAND BY (`pausa`/`ricomincia`) vengono intercettati come fast-path nel submit handler — gestiti in modo sincrono, senza passare dall'AI né fermare la sintesi in corso.*

```
          ┌───────────────┐
          │  Input utente  │  (testo o voce)
          └───────┬───────┘
                  │
          ┌───────▼───────┐
          │   È un'azione  │─── Sì → Esegui azione UI
          │   diretta?     │      (es. "apri terminale")
          └───────┬───────┘
                  │ No
                  │
          ┌───────▼───────┐
          │ Classifica con │─── Keyword match ≥ 2
          │  keywords      │      → seleziona agente
          └───────┬───────┘
                  │ Low confidence
                  │
          ┌───────▼───────┐
          │ Classifica con │─── llama3 classifica
          │  LLM           │      in 5 categorie
          └───────┬───────┘
                  │
          ┌───────▼───────┐
          │ Costruisci     │─── Prompt = agente + contesto
          │ system prompt  │      + comandi disponibili
          └───────┬───────┘
                  │
          ┌───────▼───────┐
          │  Chat con      │─── POST /api/chat → llama3
          │  AI Provider   │      Stream risposta JSON
          └───────┬───────┘
                  │
          ┌───────▼───────┐
          │  Esegui tools  │─── websearch, webfetch,
          │  e azioni      │      kbsearch, calendar,
          │                │      todo, [ACTION], [CMD]
          └───────┬───────┘
                  │
          ┌───────▼───────┐
          │  Pulisci tag   │─── Rimuove [TOOL] e
          │  e mostra      │      [ACTION] dal testo
          └───────┬───────┘
                  │
          ┌───────▼───────┐
          │  TTS + Memoria │─── ElevenLabs (se attivo)
          │                │      + salva conversazione
          └───────────────┘
```

---

## 8. Sistema Vocale

```
Wake Word: "Hey SAVIA" / "Ehi SAVIA" / "SAVIA"

Stati: IDLE → WAKE_LISTEN → WAKE_HEARD → CAPTURING
       → PROCESSING → SPEAKING → IDLE o WAKE_LISTEN

- Riconoscitore continuo con heartbeat (riavvio ogni 5s)
- Se il wake word contiene già il comando, salta CAPTURING
- Modalità continua: dopo TTS, riascolta immediatamente
- TTS: ElevenLabs multilingua, voce persistente in localStorage
- Un comando STAND BY consumato emette `savia-standby-command`, che riporta lo stato vocale a IDLE e riavvia l'ascolto (wake o continuo) senza rimanere bloccati in PROCESSING
- **Power-on vocale**: quando la finestra è nascosta nella tray, chiamarla ("Hey SAVIA") la riapre e la porta in primo piano via IPC `window-reveal`; `backgroundThrottling: false` mantiene l'ascolto attivo anche a finestra nascosta
- **STT locale (fallback Whisper)**: se lo Speech API cloud va in "retry" di rete (3 errori consecutivi) o non è disponibile, S.A.V.I.A passa automaticamente alla trascrizione locale (`src/stt-local.js`: mic + VAD → IPC → Whisper `Xenova/whisper-tiny` via transformers.js nel main process) — nessuna dipendenza dal cloud, riusa il pipeline STT della hotline (`call-server.transcribe`)
```

---

## 9. API Esterne

| Servizio | Endpoint | Utilizzo | Modulo |
|----------|----------|----------|--------|
| **Local AI** | `localhost:11434/api/tags` | Health check | cognitive.js, commander.js |
| **Local AI** | `localhost:11434/api/chat` | Chat completion | cognitive.js, commander.js |
| **Local AI** | `localhost:11434/api/embeddings` | Embedding testi (nomic-embed-text) | main.js (RAG) |
| **ElevenLabs** | `api.elevenlabs.io/v1/text-to-speech/{voice}` | Text-to-speech | cognitive.js |
| **YouTube** | `www.googleapis.com/youtube/v3/*` | Ricerca e statistiche video | youtube.js |
| **DuckDuckGo** | `api.duckduckgo.com` | Instant answer search | agents.js |
| **Open-Meteo** | `api.open-meteo.com/v1/forecast` | Meteo città | globe.js |
| **MediaPipe** | CDN `@mediapipe/hands` | Riconoscimento mani | globe.js, particles.js |
| **Three.js** | CDN r128 | Grafica 3D | globe.js, particles.js |

---

## 10. Novità v4.0.0

- **Boot sequence JARVIS**: overlay di accensione con log di sistema scorrevoli, reattore animato e suono sintetizzato (WebAudio, nessuna risorsa esterna).
- **Tray icon + hotkey globale**: S.A.V.I.A. vive nella system tray; `Ctrl+Alt+S` la mostra/nasconde da qualsiasi applicazione. Il pulsante di chiusura minimizza in tray invece di uscire.
- **Avvio con Windows (tray)**: voce "Avvia con Windows" nel menu della tray (persistita in registro). All'avvio di Windows S.A.V.I.A parte direttamente in background (flag `--savia-hidden`, nessuna finestra all'apertura di sessione) con ascolto vocale e watchdog attivi: basta chiamarla con "Hey SAVIA" o usare `Ctrl+Alt+S`.
- **Scheduler promemoria/calendario**: promemoria ed eventi salvati ora scattano davvero — notifica nativa Windows + toast in-app all'orario stabilito, anche a finestra nascosta.
- **Controllo media**: `[CMD] media:play/pausa/next/prev/stop` per il controllo riproduzione (VK codes).
- **Screenshot reale**: `[CMD] screenshot` cattura lo schermo e salva in `Pictures/SAVIA` (desktopCapturer).
- **Volume reale (CoreAudio)**: get/set volume tramite P/Invoke PowerShell (Add-Type), niente più hack SendKeys.
- **Batteria in telemetria**: Power Cell gauge nella sidebar con percentuale/stato di carica (Win32_Battery).
- **Modello AI selezionabile**: menu `AI MODEL` popolato da `/api/tags` — scegli il modello AI attivo (persistito in config).
- **Config file**: `savia-config.json` (userData) per chiavi API e impostazioni — la chiave ElevenLabs non è più hardcoded nel codice.
- **Saluto contestuale**: benvenuto JARVIS basato sull'ora del giorno (buongiorno/pomeriggio/sera) con fallback vocale locale.
- **Pannello UPCOMING SCHEDULE nella Dashboard**: agenda unificata (eventi + promemoria + todo + obiettivi) con countdown live, alert acustico/visivo alla scadenza con toggle volume, azioni inline complete/elimina con animazioni di fade-out, beep di conferma e notifica `OBIETTIVO COMPLETATO` con conteggio progressi.
- **MCP Servers (Connect Any App)**: connessione a qualunque app/agent tramite Model Context Protocol (stdio / SSE / HTTP) con l'SDK ufficiale. Pagina `mcp.html` per gestire i server e testare i tool; i tool MCP diventano utilizzabili dall'agente AI con `[TOOL] mcp:...` e dai comandi vocali.
- **STAND BY**: pausa/ripresa dell'azione in corso (generazione streaming + TTS) esattamente dal punto in cui era rimasta — via chat ("pausa"/"ricomincia"), pulsante HUD o API `saviaStandbyPause/Resume`.

## 11. Dipendenze

Dipendenza principale in dev: `electron ^31.0.0`. Dipendenze runtime (pure JavaScript/node):
- `@modelcontextprotocol/sdk` — client MCP (stdio/SSE/streamable-http) per il servizio `mcp-servers.js`
- `@huggingface/transformers` + `onnxruntime-node` — STT locale (Whisper) per la Hotline
- `ws` — WebSocket server per la Hotline (Twilio media stream)
- `@vladmandic/face-api` — riconoscimento facciale (login/faccia)

Le librerie di rendering (Three.js, MediaPipe, Font Awesome, Monaco) sono caricate via CDN dalle pagine HTML.
