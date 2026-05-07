# VINCI 2.1 — Persönlicher KI-Assistent für macOS

> Alex Januschewsky / Prompt Rocker
> Stack: Electron · React · Three.js · Gemini 2.5 · Edge TTS · Home Assistant · Obsidian

VINCI ist ein Voice-first Mac-Assistent, der lokal läuft und über deine bestehenden macOS-Apps (Calendar, Mail, Notes, Reminders, iMessage, Contacts) sowie deine Heim-Automation (Home Assistant) verfügt. Sprachausgabe wahlweise über macOS-Stimmen oder Microsoft Edge TTS (`de-AT-IngridNeural` & Co. — kostenlos, sehr natürlich). Selbstwachsender Knowledge-Graph in Obsidian, eigener Blog-Importer, Web-Recherche mit Speicher-Workflow.

📓 **Notion-Projekt-Page:** [VINCI Mac](https://www.notion.so/35831de70cf9811593b9ea113b3f3f75)
📐 **Architektur-Spec:** [docs/superpowers/specs/2026-05-06-vault-graph-redesign-design.md](docs/superpowers/specs/2026-05-06-vault-graph-redesign-design.md)
🛠 **Implementation-Plan:** [docs/superpowers/plans/2026-05-06-vault-graph-redesign.md](docs/superpowers/plans/2026-05-06-vault-graph-redesign.md)
🤖 **Für Claude Code Agents:** [CLAUDE.md](CLAUDE.md)
🪟 **Mac/Windows-Sync:** [docs/PLATFORM-SYNC.md](docs/PLATFORM-SYNC.md)

---

## Was ist neu in 2.1 — "Vault & Knowledge-Graph Redesign"

**8 Phasen ausgeliefert am 6. Mai 2026, 132 Tests, ~50 Commits.**

### 🔍 Web-Suche reaktiviert + gehärtet
- Klare TRIGGER-Regeln im Gemini-Prompt mit 5 Few-Shot-Beispielen
- Bearer-Auth-Header für Tavily (zukunftssicher)
- **4 Empty-STOP-Sicherheitsnetze** für Gemini-2.5-Flash-Quirks: bei leerer Antwort ruft VINCI Tools selbst auf (web_search / system_getStatus / n8n_getStatus / blog_sync / weather_getCurrent / mail_getUnread / obsidian_search / web_saveToVault) und lässt das Modell nur synthesieren

### 📚 Vault-Korrektur
- Multi-Vault-Detection: Settings warnt inline wenn der Pfad ein Parent mit mehreren `.obsidian/` ist
- Mac-Schreiberei landet wieder im kanonischen `~/Documents/VINCI Vault/` (Sync mit Windows-Version)
- Migration-Script führt orphan Mac-Vaults ein (Token-Overlap-Dedup, ZIP-Backup, Quarantine statt Delete)

### 🧹 Knowledge-Graph aufgeräumt
- Neue Kategorie **`Quellen/`** für News-Domains
- Hard-Reject-Filter: Telefon-Nummern, Daten, Tarif-Namen, Modell-Versionen, System-Begriffe werden nie zu Entitäten
- Domain-Detection: `9to5google.com` → `Quellen/`, nicht `Themen/`
- Auto-Alias-Builder: `Tobias.md` + `Tobias Januschewsky.md` mergen automatisch + `_aliases.json` wird gepflegt
- One-Shot-Cleaner mit Plan/Dry-Run/Apply, per-Proposal-Toggle, ZIP-Backup
- Default-Modell für Memworker: `gemma3:4b` (deutsche Extraction-Qualität deutlich besser als `qwen2.5:3b`)

### 📰 Blog-Importer (`blog_sync`)
- WordPress-REST-Endpoint mit Pagination, vault-derived Cursor (max `published`)
- HTML→Markdown via `turndown`
- Idempotent: zweiter Sync produziert 0 Diffs
- 4 Trigger: Sprache, Chat-Text, Settings-Button, Cron-Task
- Ersetzt n8n-Workflow auf dem Windows-PC

### 🔗 Body-Wikilink-Pass
- Scannt alle Blog-Posts, setzt `[[Wikilinks]]` auf erste Vorkommnisse
- Längster Match zuerst (`Iron Maiden` schlägt `Maiden`)
- Pflegt `mentions:` im YAML, hängt `Erwähnt in [[post-slug]]` an Entity-Notes
- Auto-Anlage neuer Firmen ab 2 Mentions in verschiedenen Posts
- Ergebnis: 501 Posts, **1162 Backlinks**, idempotent

### 💾 Web→Vault-Save
- Nach `web_search` einfach "Speichere das ins Vault" sagen
- Notiz landet sandboxed in `inbox/web/<datum> – <slug>.md` (NICHT im kuratierten Vault)
- YAML mit `source: web`, `sources: [...]`, `status: zu-sichten`, automatischen Wikilinks
- Backlinks in erwähnten Entity-Notes

### 🎨 UI-Polish
- Schriftgröße + Schriftart skalieren überall (Settings, About, Buttons), nicht nur Chat
- About-Screen v2.1.0 mit Prosa-Beschreibung
- Disk-Metric APFS-Fix (`/System/Volumes/Data` statt `/`)

---

## Schnellstart (Dev)

```bash
npm install
npm run dev
```

Hotkey: `Cmd+Shift+Space` | Push-to-Talk: `Cmd+Shift+M`

## Tests

```bash
npm test           # einmalig
npm run test:watch # mit Watch-Modus
```

## App bauen (DMG)

```bash
npm run build
open release/VINCI-2.1.0-arm64.dmg
```

→ DMG aufmachen → VINCI ins Applications-Ordner ziehen → fertig.

---

## Ersteinrichtung

### Gemini API Key (Pflicht)
1. https://aistudio.google.com/apikey
2. VINCI → ⚙ → KI → Key eintragen
3. Empfohlen: Modell `gemini-2.5-flash`, Fallback `gemini-2.5-pro`

### Vault (Pflicht für Knowledge-Graph)
- Settings → Dienste → Obsidian-Vault-Pfad
- **Konkret den Vault-Ordner wählen, nicht den Parent** (UI warnt sonst inline rot)

### Memory-Worker-Modell (Default `gemma3:4b`)
```bash
ollama pull gemma3:4b
```

### Edge TTS (optional, sehr empfohlen)
- Settings → Stimme → Anbieter "Edge TTS"
- Falls Python fehlt: Klick "Python-Download öffnen"
- Falls nur edge-tts fehlt: Klick "edge-tts installieren" (`pip --user`)

### Home Assistant (optional)
1. HA: **Profil → Sicherheit → Lang-laufende Zugangstoken** erstellen
2. VINCI → ⚙ → Dienste → HA URL (LAN), HA URL (Tailscale), Token eintragen
3. "Verbindung testen" — sollte grün werden

### Tavily (optional, für Web-Suche)
- Kostenloser Account auf https://app.tavily.com (1.000 Credits/Monat)
- Settings → Dienste → Tavily API-Key

### Blog-Importer (optional)
- Default-Source `digitalhandwerk` ist hardcoded
- Eigene Source via Settings (in v2.1 read-only, UI-Editing für v2.2 vorgesehen)

### macOS-Berechtigungen
Beim ersten Zugriff fragt macOS:
- Calendar, Reminders, Contacts
- Mail / Outlook (AppleScript)
- Mikrofon (Push-to-Talk)
- Automation für Calendar/Mail/Reminders

---

## Module

| Modul | Backend | Zweck |
|---|---|---|
| `gemini` | Google Generative AI SDK | Chat + Tool-Calling (Default) |
| `ollama` | Ollama lokal | Memory-Worker + Knowledge-Graph + optional Chat |
| `mail` | Apple Mail / Outlook (AppleScript) | Posteingang lesen |
| `calendar` | macOS Calendar (`ical-buddy`) | Termine CRUD |
| `reminders` | macOS Reminders (AppleScript) | Listen + Aufgaben CRUD |
| `contacts` | macOS Contacts (AppleScript) | Namens-/Telefon-/Email-Suche |
| `messages` | macOS Messages (AppleScript) | iMessage lesen + senden mit Two-Step-Confirm |
| `system` | shell (`top`, `df`, `pmset`, `vm_stat`) | CPU, RAM, Disk, Akku |
| `weather` | wttr.in / Open-Meteo | Aktuell + Forecast |
| `news` | RSS | Salzburg, Tech, Welt |
| `web` | Tavily | Web-Suche + Web→Vault-Save |
| `strom` | n8n Webhook | Strom-Verbrauch |
| `n8n` | n8n REST | Workflow-Status + Webhooks |
| `homeassistant` | HA REST API | States, Service-Calls |
| `obsidian` | Lokaler Vault | Search / Read / Create |
| `obsidianGraph` | Ollama (gemma3:4b) | Personen / Firmen / Quellen / Themen mit Wikilinks |
| `memory` | SQLite | Gesprächsverlauf + Fakten + Tainted-Filter |
| `memoryWorker` | Ollama (gemma3:4b) | Hintergrund-Fakten-Extraktion |
| `blog` | WordPress REST | Blog-Sync (`blog_sync`-Tool) |
| `graphCleaner` | JS heuristisch | One-Shot-Cleanup mit Approval-UI |
| `_vaultMigration` | JS | Mac-Waisen → kanonisch |
| `_wikilinkEngine` | JS | Body-Pass + Backlinks + Auto-Firma |
| `_aliasBuilder` | JS | Vor-/Nachname-Auto-Merge |
| `webSave` | JS | "Speicher das ins Vault" |

---

## Sprachsteuerung — Beispiele

**Knowledge-Graph & Web:**
- *"Was hab ich zu Anthropic notiert?"* → obsidian_search
- *"Was gibt's Neues bei OpenAI?"* → web_search
- *"Speichere das ins Vault"* (nach Web-Suche) → web_saveToVault
- *"Sync Blog"* / *"hol meine Artikel"* → blog_sync

**Smart Home:**
- *"Schalte das Licht in der Küche an"*
- *"Wie warm ist es im Wohnzimmer?"*
- *"Aktiviere Szene Gemütlich"*

**Daily:**
- *"Wie läuft mein Mac?"* → system_getStatus
- *"Wie läuft mein n8n?"* → n8n_getStatus
- *"Wie viele ungelesene Mails?"* → mail_getUnread
- *"Morgen-Briefing"*

---

## Settings & Daten

Alle Daten in `~/Library/Application Support/vinci/`:
- `vinci-settings.json` — alle Einstellungen
- `vinci-tokens.json` — OAuth-Tokens
- `vinci-window.json` — Fenstergröße & -position
- `memory.db` — SQLite (Fakten, Aufgaben, Chat-History)
- `cleanup-plan-<datum>.json` — letzter Cleaner-Plan
- `blogImporter-taxonomy-<source>.json` — gecachte WP-Categories/Tags

Backups: `~/.vinci-archive/`
- `<datum>-pre-migration.zip` — vor Vault-Migration
- `cleanup-<datum>.zip` — vor Cleaner-Apply
- `orphan-vaults-<datum>/` — archivierte Mac-Waisen

Reset komplett:
```bash
rm -rf ~/Library/Application\ Support/vinci
```

---

## Bekannte Limitierungen

- macOS-only (AppleScript für Calendar/Mail/Notes/Reminders); Windows hat eigene Codebase mit MS Graph + iCloud
- Apple Silicon Build (für Intel: `electron-builder.config.js` anpassen)
- Edge TTS braucht Internet (Microsoft-WebSocket); System-TTS läuft offline
- Gemini-503 kann bei sehr hoher Last trotz Retry+Fallback durchschlagen
- DMG nicht code-signed → Gatekeeper-Warning beim ersten Start (Rechtsklick → Öffnen)

---

## Roadmap (nächste Sessions)

- 🎙 **Wake-Word "VINCI"** — Always-listening + Auto-Push-to-Talk + VAD-Stop
- 🚀 **Streaming Chat-Antworten** — Token-für-Token, parallel TTS
- 🖼 **Multi-Modal-Input** — Bilder per Drag-Drop / Screenshot-Hotkey
- 📦 **Code-Signing + Auto-Update** — Apple Developer ID + electron-updater

Vollständige Roadmap: siehe Notion-Page oben.

---

© 2026 Alex Januschewsky / [Prompt Rocker](https://promptrocker.at)
Ein [vibecraft.rocks](https://vibecraft.rocks) Projekt
