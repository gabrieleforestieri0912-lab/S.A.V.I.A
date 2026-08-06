# S.A.V.I.A — Cognitive HUD & AI Assistant

**Versione:** 4.0.0
**Runtime:** Electron 31 + Node.js
**AI Engine:** Ollama (llama3, nomic-embed-text) — modello selezionabile
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
10. [Dipendenza Zero](#10-dipendenza-zero)

---

## 1. Architettura Generale

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS (Node.js)                        │
│  main.js                                                         │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ Servizi: Telemetry, File System, Terminal, Memoria,       │   │
│  │ System Ops, RAG Pipeline, Agenti (calendar/todo/reminder) │   │
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
│  │ shared.js  agents.js  ollama.js  telemetry.js               │   │
│  │ memory.js  system-ops.js  voice-control.js                  │   │
│  │ dashboard.js  commander.js  knowledge-base.js               │   │
│  │ youtube.js  globe.js  particles.js                          │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Pattern di comunicazione:**

- **Richiesta/Risposta** (`ipcMain.handle` / `ipcRenderer.invoke`): per query e comandi che richiedono un risultato (listDirectory, kbSearch, systemOpenApp)
- **Push in tempo reale** (`webContents.send` / `ipcRenderer.on`): telemetry (ogni 2s), eventi file system, output terminale
- **Eventi DOM personalizzati**: `savia-response-complete` dispatcato da ollama.js e ascoltato da voice-control.js e system-ops.js

---

## 2. Struttura del Progetto

```
S.A.V.I.A/
├── package.json              # Metadati progetto, entry point Electron
├── main.js                   # Processo principale Electron (1326 righe)
├── preload.js                # Ponte IPC contextBridge (97 righe)
├── savia.png                 # Icona dell'app
│
├── src/
│   ├── index.html            # HUD principale — Terminale Cognitivo + Dashboard
│   ├── terminal.html         # Command Center — File Explorer + Terminale
│   ├── youtube.html          # Ricerca e riproduzione YouTube
│   ├── particles.html        # Motore 3D particelle neurali
│   ├── globe.html            # Mappa mondiale 3D con meteo
│   ├── knowledge.html        # Knowledge Base RAG
│   │
│   ├── style.css             # Foglio di stile cyberpunk HUD (2700+ righe)
│   │
│   ├── shared.js             # Utility condivise tra tutte le pagine
│   ├── agents.js             # Router multi-agente e definizioni
│   ├── ollama.js             # Ponte AI Ollama + chat + TTS
│   ├── telemetry.js          # Monitoraggio sistema in tempo reale
│   ├── memory.js             # Memoria contestuale personale
│   ├── system-ops.js         # Esecuzione comandi di sistema
│   ├── voice-control.js      # Wake word e speech-to-text
│   ├── dashboard.js          # Dashboard a gauges circolari
│   ├── commander.js          # File browser + emulatore terminale
│   ├── knowledge-base.js     # Interfaccia RAG
│   ├── globe.js              # Visualizzazione 3D Terra
│   └── particles.js          # Sistema particelle 3D
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
Embedding via Ollama nomic-embed-text
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
shared.js → agents.js → ollama.js → telemetry.js → memory.js
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
- Pannello dettagli con statistiche (view, like, commenti)
- Chiave API configurabile da interfaccia

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

---

## 6. Moduli Renderer

### `shared.js` — Utility Condivise

Caricato da ogni pagina HTML. Gestisce:
- Stato globale: `soundEnabled`, `overclockEnabled`, `scanlinesEnabled`, `ollamaOnline`
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

### `ollama.js` — Ponte AI

Il modulo centrale. Si connette a Ollama in locale, gestisce chat streaming, input vocale, comandi azione e TTS.

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
- Smart Scanner AI: descrive ogni file con Ollama (batch 5 file)

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
          │  Ollama        │      Stream risposta JSON
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
```

---

## 9. API Esterne

| Servizio | Endpoint | Utilizzo | Modulo |
|----------|----------|----------|--------|
| **Ollama** | `localhost:11434/api/tags` | Health check | ollama.js, commander.js |
| **Ollama** | `localhost:11434/api/chat` | Chat completion (llama3) | ollama.js, commander.js |
| **Ollama** | `localhost:11434/api/embeddings` | Embedding testi (nomic-embed-text) | main.js (RAG) |
| **ElevenLabs** | `api.elevenlabs.io/v1/text-to-speech/{voice}` | Text-to-speech | ollama.js |
| **YouTube** | `www.googleapis.com/youtube/v3/*` | Ricerca e statistiche video | youtube.js |
| **DuckDuckGo** | `api.duckduckgo.com` | Instant answer search | agents.js |
| **Open-Meteo** | `api.open-meteo.com/v1/forecast` | Meteo città | globe.js |
| **MediaPipe** | CDN `@mediapipe/hands` | Riconoscimento mani | globe.js, particles.js |
| **Three.js** | CDN r128 | Grafica 3D | globe.js, particles.js |

---

## 10. Novità v4.0.0

- **Boot sequence JARVIS**: overlay di accensione con log di sistema scorrevoli, reattore animato e suono sintetizzato (WebAudio, nessuna risorsa esterna).
- **Tray icon + hotkey globale**: S.A.V.I.A. vive nella system tray; `Ctrl+Alt+S` la mostra/nasconde da qualsiasi applicazione. Il pulsante di chiusura minimizza in tray invece di uscire.
- **Scheduler promemoria/calendario**: promemoria ed eventi salvati ora scattano davvero — notifica nativa Windows + toast in-app all'orario stabilito, anche a finestra nascosta.
- **Controllo media**: `[CMD] media:play/pausa/next/prev/stop` per il controllo riproduzione (VK codes).
- **Screenshot reale**: `[CMD] screenshot` cattura lo schermo e salva in `Pictures/SAVIA` (desktopCapturer).
- **Volume reale (CoreAudio)**: get/set volume tramite P/Invoke PowerShell (Add-Type), niente più hack SendKeys.
- **Batteria in telemetria**: Power Cell gauge nella sidebar con percentuale/stato di carica (Win32_Battery).
- **Modello AI selezionabile**: menu `AI MODEL` popolato da `/api/tags` — scegli il modello Ollama attivo (persistito in config).
- **Config file**: `savia-config.json` (userData) per chiavi API e impostazioni — la chiave ElevenLabs non è più hardcoded nel codice.
- **Saluto contestuale**: benvenuto JARVIS basato sull'ora del giorno (buongiorno/pomeriggio/sera) con fallback vocale locale.
- **Pannello UPCOMING SCHEDULE nella Dashboard**: agenda unificata (eventi + promemoria + todo + obiettivi) con countdown live, alert acustico/visivo alla scadenza con toggle volume, azioni inline complete/elimina con animazioni di fade-out, beep di conferma e notifica `OBIETTIVO COMPLETATO` con conteggio progressi.

## 11. Dipendenza Zero

Il progetto ha **zero dipendenze runtime** in produzione. L'unico devDependency è `electron ^31.0.0`. Tutte le librerie esterne (Three.js, MediaPipe, Font Awesome) sono caricate via CDN direttamente dalle pagine HTML. Le API AI e di sistema sono chiamate HTTP dirette a servizi locali o remoti.
