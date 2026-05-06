# VINCI 2.0 – Persönlicher KI-Assistent für macOS

> Alex Januschewsky / Prompt Rocker
> Stack: Electron · React · Three.js · Gemini 2.5 · Edge TTS · Home Assistant

VINCI ist ein Voice-first Mac-Assistent, der lokal läuft und über deine bestehenden macOS-Apps (Calendar, Mail, Notes, Reminders, iMessage) sowie deine Heim-Automation (Home Assistant) verfügt. Sprachausgabe wahlweise über macOS-Stimmen oder Microsoft Edge TTS (`de-AT-IngridNeural` & Co. — kostenlos, sehr natürlich).

---

## Was ist neu in 2.0

### 🏠 Home Assistant Integration
- Sensoren lesen, Geräte schalten, Szenen aktivieren, Skripte/Automationen triggern
- Auto-Failover: probiert LAN-URL zuerst (1.2 s Timeout), fällt auf Tailscale-URL zurück (für unterwegs)
- Entity-Inventar wird bei Smart-Home-Befehlen automatisch in Geminis Kontext geladen → keine erfundenen `entity_id`s mehr
- Forced Tool-Calling: bei klaren Aktions-Befehlen ("Schalte Licht aus") MUSS Gemini einen Service-Call machen — keine halluzinierten "Erledigt"-Antworten
- Schnelles Öffnen: *"Öffne Home Assistant"* → Chrome mit Tailscale-URL

### 🗣️ Edge TTS (Microsoft) als zusätzliche Stimm-Engine
- 10 deutsche Stimmen (AT/DE/CH, männlich/weiblich), Default `de-AT-IngridNeural`
- Läuft lokal via Python-Subprozess (`edge-tts` von rany2) — keine OpenAI-/ElevenLabs-Kosten
- In-App-Installer prüft Python + edge-tts und führt durch die Einrichtung (ohne Terminal)
- Audio über echten `AnalyserNode` → Partikel-Orb pulsiert live zur Stimme

### ✨ Partikel-Orb (LyraOrbParticle)
- 4. Orb-Stil neben Classic/Nebula/HUD: 2000-Partikel-Schwarm mit Verbindungslinien & Funken
- Treue Portierung aus dem JARVIS-Projekt mit Velocity-basierter Brownscher Bewegung, Transition-Tumble, Cloud-Z-Atmung, Kamera-Drift
- Goldfärbung statt Blau, container-skaliert (kein Vollbild-Hijack)
- Synthetische Audio-Reaktivität bei System-TTS, **echte** Audio-Reaktivität bei Edge TTS

### 🔇 Per-Modul TTS-Toggle
- 16 Module (Wetter, Termine, Mail, Erinnerungen, iMessages, Kontakte, Obsidian, Strom, News, Web, n8n, Home Assistant, Briefing, Chat, Aufgaben, Fehler) einzeln stumm-/sprechbar
- Default: alle an. Caller-Tagging stellt sicher, dass der richtige Toggle zieht.

### ✓ Aufgaben in Settings
- Eigener Tab "Aufgaben" — geplante Prompts, die Gemini zur richtigen Zeit ausführt (täglich, wochentags, wöchentlich, alle X Stunden)

### 🪟 Fenster-Persistenz
- Größe + Position bleiben über App-Neustarts erhalten
- Kein Auto-Resize beim Chat-Öffnen/-Schließen mehr — der Orb füllt einfach den freigewordenen Bereich
- Chat ist auf max. 1/3 der Fensterhöhe begrenzt

### 🔁 Gemini Auto-Retry & Fallback
- Bei 503/Überlastung: 1 s warten, Primary nochmal probieren, dann auf Fallback-Modell wechseln
- Beide Modelle (Primary + Fallback) in Settings konfigurierbar

### 🛡️ Bessere Memory-Filter
- System-Metriken (CPU/RAM/Akku/Festplatte) werden nicht mehr fälschlich als "Fakten" gespeichert

---

## Schnellstart (Dev)

```bash
npm install
npm run dev
```

Hotkey: `Cmd+Shift+Space` | Push-to-Talk: `Cmd+Shift+M`

---

## App bauen (DMG)

```bash
./build.sh
```

Oder manuell:

```bash
# Icon ist bereits da (assets/icon.icns) — nur falls neu:
# iconutil -c icns assets/vinci.iconset -o assets/icon.icns

npm run build
open release/VINCI-2.0.0.dmg
```

→ VINCI aus dem DMG nach `Applications` ziehen → fertig.

---

## Ersteinrichtung

### Gemini API Key (Pflicht)
1. https://aistudio.google.com/apikey
2. VINCI → ⚙ → KI → Key eintragen
3. Empfohlen: Modell `gemini-2.5-flash`, Fallback `gemini-2.5-pro`

### Edge TTS (optional, sehr empfohlen)
- Settings → Stimme → Anbieter "Edge TTS"
- Falls Python fehlt: Klick "Python-Download öffnen" → macOS-Installer ausführen
- Falls nur edge-tts fehlt: Klick "edge-tts installieren" (im Hintergrund via `pip --user`)
- Stimme wählen (Default: Ingrid AT)

### Home Assistant (optional)
1. In HA: **Profil → Sicherheit → Lang-laufende Zugangstoken** erstellen
2. VINCI → ⚙ → Dienste → HA URL (LAN), HA URL (Tailscale), Token eintragen
3. "Verbindung testen" — sollte grün werden

### macOS-Berechtigungen
Beim ersten Zugriff fragt macOS automatisch nach:
- Calendar, Reminders, Contacts (Adressbuch)
- Mail / Outlook (über AppleScript)
- Mikrofon (Push-to-Talk)
- Automation für Calendar/Mail/Reminders

### Strom (optional)
- n8n Workflow `lyra-strom-n8n-workflow.json` importieren
- Variable `STROM_SECRET` setzen, Workflow aktivieren
- VINCI → ⚙ → Dienste → Strom-URL eintragen

### Tavily (optional, für Web-Suche)
- Kostenloser Account auf https://app.tavily.com (1.000 Credits/Monat)
- Settings → Dienste → Tavily API-Key

---

## Module

| Modul | Quelle | Voraussetzung |
|-------|--------|---------------|
| Kalender | macOS Calendar | `brew install ical-buddy` |
| Mail | Apple Mail / Outlook | App eingerichtet |
| Reminders | macOS Reminders | – |
| Notes | Apple Notes | – |
| iMessages | macOS Messages | – |
| Kontakte | macOS Contacts | – |
| Wetter | wttr.in / Open-Meteo | Internet |
| Strom | n8n → strom.vibecodes.at | n8n Workflow |
| News | RSS (verschiedene) | – |
| Web-Suche | Tavily | API-Key |
| Obsidian | Lokaler Vault | Vault-Pfad |
| n8n | bot.promptrocker.at | API-Key |
| **Home Assistant** | REST-API | Long-Lived Token |
| Edge TTS | Microsoft (via Python) | `python3` + `edge-tts` |

---

## Sprachsteuerung Beispiele

**Smart Home:**
- *"Schalte das Licht in der Küche an"*
- *"Wie warm ist es im Wohnzimmer?"*
- *"Aktiviere Szene Gemütlich"*
- *"Öffne Home Assistant"*

**Briefing & Tagesplanung:**
- *"Morgen-Briefing"* (oder ☀-Button)
- *"Was steht heute auf dem Plan?"*

**Tools:**
- *"Wie viele ungelesene Mails?"*
- *"Erinnere mich morgen den Klienten anzurufen"*
- *"Suche nach den neuesten KI-News"*

---

## Settings & Daten

Alle Daten in `~/Library/Application Support/vinci/`:
- `vinci-settings.json` — alle Einstellungen
- `vinci-tokens.json` — OAuth-Tokens (verschlüsselt)
- `vinci-window.json` — Fenstergröße & -position
- `memory.db` — SQLite-Memory (Fakten, Aufgaben, Chat-History)

Reset komplett:
```bash
rm -rf ~/Library/Application\ Support/vinci
```

---

## Bekannte Limitierungen

- macOS-only (AppleScript für Calendar/Mail/Notes/Reminders)
- Apple Silicon Build (für Intel: `electron-builder.config.js` anpassen)
- Edge TTS braucht Internet (Microsoft-WebSocket); System-TTS läuft offline
- Gemini-503 kann bei sehr hoher Last trotz Retry+Fallback durchschlagen — dann freundliche Fehlermeldung

---

© 2026 Alex Januschewsky / [Prompt Rocker](https://promptrocker.at)
Ein [vibecodes.at](https://vibecodes.at) Projekt
