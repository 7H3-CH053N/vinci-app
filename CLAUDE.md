# CLAUDE.md — Agent-Anleitungen

Diese Datei ist für **Claude Code Agents (Mac, Windows, alle)**, die in diesem Repo arbeiten. Lies sie als allererstes wenn du einen neuen Task übernimmst.

## Projektkontext in einem Satz

VINCI Mac ist ein Voice-first KI-Assistent in Electron+React, der mit Gemini 2.5 Flash chattet, Apple-Apps + Home Assistant über AppleScript/REST steuert, einen automatisch wachsenden Knowledge-Graph in Obsidian pflegt und einen WordPress-Blog importiert.

## Tech-Stack — was du wissen musst

- **Sprache:** JavaScript ESM (kein TypeScript). Imports nutzen `.js`-Endung explizit.
- **Process-Modell:** Electron Main + Preload + Renderer. Tools laufen im Main, UI im Renderer, IPC dazwischen mit `lyra:`-Prefix.
- **Frontend:** React 18 + Zustand + Three.js (für 4 Orb-Stile, Default `particle`).
- **Build:** electron-vite (Vite + Rollup) + electron-builder (DMG).
- **Tests:** vitest, ~132 Tests in `src/main/modules/__tests__/`. Pflicht-grün vor jedem Commit.
- **LLM:** Gemini 2.5 Flash (Cloud) als Default-Chat. Ollama (`gemma3:4b`) für Memory + Knowledge-Graph (lokal).
- **Plattform:** macOS arm64 only. Windows-Variante hat **eigene Codebase** in einem anderen Repo.

## Wo was liegt

```
src/main/
├── index.js                          # App-Bootstrap
├── ipc.js                            # ALLE lyra:*-IPC-Handler
├── preload.js                        # contextBridge → window.lyra
├── store.js                          # Settings-Defaults + Persist
├── scheduler.js                      # Tasks-Cron + Briefing
├── tasks.js                          # Tasks-CRUD
├── taskExecutor.js                   # Tasks ausführen
└── modules/
    ├── gemini.js                     # System-Prompt + Tool-Loop + 4 Empty-STOP-Sicherheitsnetze
    ├── ollama.js                     # Hybrid Chat (Provider=ollama)
    ├── registry.js                   # Module-Registry für Tool-Dispatch
    ├── memory.js                     # SQLite + Tainted-Filter
    ├── memoryWorker.js               # Background-Fact-Extraction (Ollama)
    ├── obsidian.js                   # Vault Search/Read/Create + detectMultipleVaults
    ├── obsidianGraph.js              # Live-Entity-Writes mit Hard-Reject + Domain-Force + Auto-Alias-Hook
    ├── _aliasBuilder.js              # Vor-/Nachname-Auto-Merge
    ├── _graphCategories.js           # Single-Source-of-Truth für Kategorien (Personen/Tiere/Firmen/Orte/Themen/Quellen)
    ├── _vaultMigration.js            # Mac-Waisen → kanonisch (mit native zip-Subprocess)
    ├── _wikilinkEngine.js            # Body-Pass + Backlinks + Auto-Firma-Detection
    ├── graphCleaner.js               # One-Shot-Cleanup-Tool
    ├── blogImporter.js               # WordPress-REST-Sync
    ├── webSave.js                    # web_saveToVault-Helper
    ├── web.js                        # Tavily-Suche
    ├── system.js                     # CPU/RAM/Disk (APFS Data-Volume), Akku, Top-Prozesse
    ├── weather.js, news.js, n8n.js, strom.js
    ├── homeassistant.js              # HA REST mit LAN→Tailscale-Failover
    ├── calendar.js, mail.js, reminders.js, contacts.js, messages.js
    ├── edgeTTS.js                    # Python-Subprocess-Wrapper
    └── __tests__/                    # vitest-Suites

src/renderer/
├── App.jsx                           # Top-Level + Layout
├── main.jsx                          # React-Mount
├── components/
│   ├── ChatPanel.jsx                 # Eingabe + Verlauf
│   ├── Settings.jsx                  # Settings-Tabs (KI/Stimme/Aufgaben/Mail/Dienste/Design)
│   ├── About.jsx                     # About-Screen v2.1.0
│   ├── Tasks.jsx                     # Tasks-CRUD
│   ├── LyraOrb*.jsx                  # 4 Orb-Stile
│   ├── MessageBubble.jsx, Icons.jsx, useTTS.js
└── styles/index.css                  # CSS mit calc(var(--fs) * X) für Schriftskalierung

docs/
├── superpowers/
│   ├── specs/2026-05-06-vault-graph-redesign-design.md   # Architektur-Spec für v2.1
│   └── plans/2026-05-06-vault-graph-redesign.md          # Implementation-Plan (8 Phasen)
└── PLATFORM-SYNC.md                                       # Mac vs. Windows
```

## Konventionen

### Sprache & Ton in Logs / Errors / UI
- **UI: Deutsch (Du-Form, klares Hochdeutsch)**
- Console-Logs: gemischt — System-Strings auf Englisch ok, User-relevante Strings auf Deutsch
- Commit-Messages: konventionell (`feat`, `fix`, `chore`, `test`, `docs`)

### IPC-Channels
Alle mit Prefix `lyra:` (z. B. `lyra:chat`, `lyra:settings:save`, `lyra:cleaner:scan`). **Niemals** ohne Prefix.

### Tool-Naming
Format: `<modul>_<aktion>` (z. B. `obsidian_search`, `n8n_getStatus`, `web_saveToVault`). Wird automatisch aufgelöst von `registry.dispatch()` → `<modul>.actions[<aktion>](params, ctx)`.

### TDD-Pflicht für Logic
Bei neuen Logikmodulen (kein UI):
1. Test schreiben → fail
2. Minimal-Implementation → pass
3. Refactor
4. Commit

UI-Änderungen (`*.jsx`) werden manuell verifiziert (App starten, klicken).

### Was NIEMALS commited wird
- `node_modules/`, `out/`, `release/`, `*.log`, `.DS_Store`, `.vinci-archive/`, `.vinci-test-vault/` (siehe `.gitignore`)
- Echte Settings/Tokens (die liegen in `~/Library/Application Support/vinci/`, nicht im Repo)

### Fenster-Persistenz
Window-State wird in `~/Library/Application Support/vinci/vinci-window.json` gespeichert. Nicht im Code hardcoden.

## Bekannte Quirks (vorbeugen statt fixen)

### Gemini 2.5 Flash gibt manchmal `finishReason: STOP` mit 0 Content-Parts
**Symptom:** Anfrage geht durch, Antwort ist leer, kein Tool-Call.
**Lösung in [gemini.js](src/main/modules/gemini.js#L317):** Nach Empty-Response-Check prüfen wir, ob die User-Frage zu einem bekannten Tool-Pattern passt und rufen das Tool selbst auf.
**Wenn du neue Tools hinzufügst:** prüfe ob ein zusätzliches Sicherheitsnetz nötig ist und füge es zum if/else-Chain in `runWith` hinzu.

### Backticks im System-Prompt brechen das Template-Literal
Der System-Prompt in `gemini.js` ist eine Template-Literal-String. **Niemals Backticks darin verwenden** (auch nicht für Code-Highlighting). Stattdessen normale Quotes oder einfach Inline-Text.

### APFS-Disk-Metric
`df /` auf macOS zeigt nur den signed System-Snapshot (~13 GB). User-Daten liegen unter `/System/Volumes/Data`. Code in [system.js](src/main/modules/system.js) nutzt das mit Fallback auf `/`.

### Schrift-Skalierung
CSS verwendet `calc(var(--fs) * X)` statt hardcoded Pixel — der User-Slider in Settings → Design wirkt sonst nur im Chat. Bei neuen UI-Komponenten: bitte ebenfalls `calc(var(--fs) * X)` für font-size verwenden, nicht 12px/13px etc.

### archiver-Dep ist absichtlich raus
Brachte zwei kollidierende `archiver-utils`-Versionen rein (eigene + electron-builder), kaputte Asar-Packaging. **Nicht wieder hinzufügen.** Für Zip-Operations: `child_process.spawn('zip', […])` (siehe `_vaultMigration.js zipDirectory()`).

### "notiert" ist nicht "speichern"
Vergangenheits-Form `notiert` ist eine Such-Anfrage, NICHT ein Save-Command. Save-Pattern muss Imperativ sein (`speichere`, `notiere mir/dir/das/es`, `merk dir`, `kopier`, `in das vault`, `in obsidian`).

## Commands die du wahrscheinlich brauchst

```bash
# Setup
npm install
ollama pull gemma3:4b           # für Memory-Worker

# Development
npm run dev                     # electron-vite dev (Hot-Reload für Renderer)
npm test                        # einmalige Test-Run
npm run test:watch              # Watch-Modus

# Build
npm run build                   # → release/VINCI-2.1.0-arm64.dmg

# Dev-Prozesse beenden (vor build oder bei Hängern)
pkill -9 -f "node_modules/electron"
pkill -9 -f "electron-vite"
```

## Wenn du eine neue Phase / großes Feature baust

1. Lies das letzte Spec/Plan-Pärchen unter `docs/superpowers/` als Vorlage
2. Brainstorm-Skill: `docs/superpowers/specs/<datum>-<topic>-design.md`
3. Plan-Skill: `docs/superpowers/plans/<datum>-<topic>.md`
4. Implementier subagent-driven, je Task ein Subagent
5. Vor jedem Commit: `npm test` muss grün sein
6. Nach jedem Schritt: `npm run dev` neu starten + manuell verifizieren (User-zentriert)

## Test-vor-Go-Prinzip

Der User ist sehr klar: erst testen, dann committen, dann nächster Schritt. Das gilt für alles:
- Migration-Scripts gegen Test-Vault, dann gegen echten
- Cleaner mit Dry-Run, dann Apply
- UI-Changes manuell verifizieren bevor du "fertig" sagst
- "Du sagst es funktioniert" ≠ "es funktioniert" — beweise es per Log-Ausgabe oder Test-Output

## Wenn etwas kaputt geht

1. **Logs zuerst:** `/tmp/vinci-dev.log` enthält die letzten Dev-Runs. `grep -E "CHAT|TOOL|GEMINI|error" /tmp/vinci-dev.log | tail -30`.
2. **Tests:** `npm test` als Sanity-Check.
3. **Bei Gemini-Auffälligkeiten:** prüfe ob der Empty-STOP-Quirk zutrifft (siehe oben). Diagnostic-Log ist schon im Code (`[GEMINI] Empty response. finishReason: ...`).
4. **Bei Vault-Auffälligkeiten:** check `~/Documents/VINCI Vault/VINCI/_quarantine/` ob was fälschlich rausgeflogen ist.
5. **Eskalieren:** wenn du nach 2-3 Versuchen nicht weiterkommst, dem User berichten — nicht raten.

## Dont's

- ❌ Default-Modell auf `qwen2.5:3b` zurückschrauben — gemma3:4b ist besser für Deutsch
- ❌ Hardcoded Pixel font-sizes in Settings/About hinzufügen — `calc(var(--fs) * X)` verwenden
- ❌ Tool-Calls ohne `lyra:`-Prefix
- ❌ Backticks im System-Prompt
- ❌ archiver oder andere Bundle-fragile Deps reinholen
- ❌ Direct delete im Cleaner — immer `_quarantine/` als Trash-Pattern
- ❌ Vault-Pfad auf Parent setzen (Multi-Vault-Detection wird's blocken, aber peinlich)
- ❌ Tests skippen vor Commits

## Do's

- ✅ Spec/Plan vor großen Features
- ✅ Subagent-driven Development für Multi-Task-Phasen
- ✅ Test-Vault unter `~/.vinci-test-vault/` für riskante Operations
- ✅ Backups als ZIP nach `~/.vinci-archive/` vor jeder Mutation
- ✅ Idempotente Operations (zweiter Run = 0 Diffs)
- ✅ Honest error messages statt fake confirmations ("Erledigt." ist reserviert für HA)
- ✅ Sicherheitsnetz für jeden neuen kritischen Tool-Call (Empty-STOP-Quirk antizipieren)

---

Bei Unsicherheiten: User fragen. Der ist Prompt Rocker, weiß meistens was er will.
