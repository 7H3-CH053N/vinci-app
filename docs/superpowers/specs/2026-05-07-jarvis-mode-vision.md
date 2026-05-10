# VINCI JARVIS-Mode — Architektur-Vision

**Status:** Vision/Roadmap (kein Implementation-Plan)
**Author:** Alex Januschewsky
**Date:** 2026-05-07
**Scope:** Transformation von VINCI Mac (reaktiver Chat-Assistent) zu **proaktivem Agenten-System** mit echter situativer Intelligenz, episodischem Gedächtnis und Spezialist-Sub-Agents.

---

## 1. Problem

VINCI ist heute ein **reaktiver Chat** mit Tool-Calls. Nutzer:in tippt → Gemini wählt Tool → Antwort kommt. Das Ergebnis fühlt sich oft wie ein "guter Bot" an, aber selten wie ein **Assistent**, weil:

1. **Eine Modell-Schicht trägt alles** — Routing, Tool-Wahl, Synthese, Persönlichkeit kollidieren bei komplexen Queries.
2. **Großer System-Prompt (3000+ Tokens)** — konkurrierende Instruktionen, Empty-STOP-Quirks, Tool-Verwechslung.
3. **Kein Kontext-Bewusstsein** — jeder Turn startet kalt, kein "wo waren wir vor 2 min".
4. **Keine Proaktivität** — VINCI wartet immer. JARVIS unterbricht, erinnert, kommentiert.
5. **Keine Selbstreflexion** — wenn eine Antwort daneben war, lernt das System nichts daraus.

Das Ziel ist nicht "noch ein besserer Chat-Bot", sondern: **VINCI als situativ bewusster, proaktiver, selbstkorrigierender Agent**.

---

## 2. Goals & non-goals

### Goals
- **Reaktive Zuverlässigkeit ≥ 95%** bei Tool-Calling (heute geschätzt ~75-80%).
- **Proaktive Aktionen**: Reminder-Push vor Terminen, Alert bei Mail-Bursts oder Strom-Anomalien, automatische Briefings, Drift-Erkennung im Vault.
- **Episodisches Gedächtnis**: VINCI weiß "wir waren gerade in Recherche X", "vor 10 Min hab ich Y gespeichert".
- **Spezialist-Delegation**: Komplexe Anfragen werden an fokussierte Sub-Agents geroutet (Researcher, Calendar-Agent, Coding-Agent, Briefing-Agent).
- **Self-Eval-Loop**: Nach jeder Antwort kurze Selbstprüfung, bei klarer Lücke Auto-Retry mit angepasstem Approach.
- **Konsistente Persönlichkeit** auch unter Stress und über lange Sessions.

### Non-goals
- Komplett autonom ohne User-Bestätigung handeln (besonders bei messages_send / calendar_createEvent / homeassistant_call bleibt explizite oder Two-Step-Bestätigung).
- Always-listening Mikrofon (das ist der Wake-Word-Track, parallel).
- Ersetzen von Gemini durch ein anderes Hauptmodell (Multi-Modell-Routing ja, aber Gemini bleibt Default).
- Komplette Codebase-Neu-Architektur (inkrementell, Modul für Modul).

---

## 3. Cross-cutting principles

1. **Inkrementell**: Jede Phase ist allein nutzbar, kein Big-Bang-Rewrite.
2. **Privacy-first**: Proaktive Trigger feuern lokal, sensitive Daten gehen nicht extra in die Cloud.
3. **User-Controllability**: Jede proaktive Aktion abschaltbar, Settings-Toggle pro Trigger.
4. **Transparency**: Wenn VINCI delegiert / chained / refused, sagt er das (kurz, einsehbar im Chat).
5. **Telemetry-driven**: Jede Phase nutzt das Telemetrie-System (`logEvent`) zur Erfolgsmessung.

---

## 4. Vier-Schichten-Architektur (Zielzustand)

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 4 — Specialist Sub-Agents                                  │
│   Researcher · Calendar · Coding · Briefing · Vault-Curator     │
│   Jeweils eigener System-Prompt, Tool-Subset, Reasoning-Budget  │
└─────────────────────────────────────────────────────────────────┘
                              ▲ delegiert wenn nötig
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3 — Main Orchestrator (heutiger Gemini-Chat, abgespeckt)  │
│   Persönlichkeit · Konversations-Flow · Synthese der Antwort    │
│   Bekommt vorgekauten Kontext + Tool-Shortlist statt allem      │
└─────────────────────────────────────────────────────────────────┘
                              ▲ shortlisted Tools, Context-Block
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2 — Intent Router & Context Builder                       │
│   Klassifizierung: was will der User? · Tool-Auswahl-Vorschlag  │
│   Episodischer Kontext zusammenstellen · Modell-Routing          │
└─────────────────────────────────────────────────────────────────┘
                              ▲ User-Input + Conversation State
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1 — Background Daemons & Triggers                         │
│   Calendar-Watcher · Mail-Burst-Detector · Strom-Anomaly        │
│   Vault-Drift-Checker · Task-Scheduler · Telemetry-Aggregator   │
│   Pushen Events nach oben oder benachrichtigen User direkt      │
└─────────────────────────────────────────────────────────────────┘
```

Aktuell ist nur Layer 3 (Orchestrator) und ein abgespeckter Layer 1 (Tasks-Scheduler, Briefing-Cron) implementiert. Layer 2 fehlt komplett, Layer 4 ist nur als Idee da.

---

## 5. Phasen-Roadmap

Acht Phasen, sortiert nach ROI (Impact / Aufwand). Jede ist allein shippable.

### Phase J1 — Intent Router & Tool-Shortlisting (~3 Tage)

**Was:** Vor jedem Gemini-Call läuft ein **schneller Klassifizierer** (Gemini Flash mit ~200-Token-Mini-Prompt oder Ollama 3B). Output: `{ intent: 'calendar', confidence: 0.92, tools: ['calendar_getUpcoming','calendar_createEvent'] }`. Der Haupt-LLM bekommt **nur die 3-5 relevanten Tool-Definitionen** statt aller 23.

**Effekt:** Tool-Call-Accuracy von ~75% → ~95%. Token-Verbrauch halbiert. Empty-STOP-Quirks reduziert weil weniger Kontext.

**Implementation-Skizze:**
- `src/main/modules/_intentRouter.js`: kleine LLM-Call mit Klassifizierung-Prompt
- Caching: gleiche User-Frage in 60s wird nicht neu klassifiziert
- Fallback: bei Unsicherheit (`confidence < 0.7`) volles Tool-Set durchreichen
- Telemetrie: `intent_classified` mit intent + confidence loggen

### Phase J2 — Modell-Routing nach Schwierigkeit (~1 Tag)

**Was:** Pro Query Modell wählen.
- **Trivial** ("wie spät", "ungelesene Mails") → Gemini Flash (schnell, billig)
- **Standard** (Tool-Call, Synthese) → Gemini 2.5 Pro
- **Komplex** (Multi-Step, Code, längeres Reasoning) → Claude Sonnet 4.5 (das beste Tool-Calling am Markt)

**Effekt:** ~30-50% weniger "das ging daneben"-Momente bei harten Queries. Trivialer Verkehr bleibt billig + schnell.

**Implementation-Skizze:**
- Erweiterung des Intent-Routers: Komplexitäts-Score (0-1)
- `geminiChat()` wird `chat({modelHint})` mit Provider-Abstraktion
- Anthropic SDK als zweite Dependency, prompt-cached für Sonnet
- Settings-Toggle: "Smart-Routing" an/aus, Default an

### Phase J3 — Episodische Kontext-Schicht (~2 Tage)

**Was:** Nach jedem Turn wird ein **Situations-Snapshot** in 1-2 Sätzen aktualisiert und beim nächsten Turn vorne in den System-Prompt eingebaut:

> *"Aktueller Kontext (16:23 Mittwoch): Alex hat in den letzten 5 Minuten zu OpenAI recherchiert (3 Treffer, nichts gespeichert). Nächster Termin in 37 min: Kunde Müller. Letzte Notiz vor 2 Tagen: Klotz Familie."*

Plus Auto-Injection: aktuelle Zeit, Tag, nächster Termin der nächsten 2 h, ungelesene Messages der letzten Stunde, letzte 3 Konversations-Themen.

**Effekt:** "Speicher das" wird zuverlässig. "Wann nochmal" findet die Info ohne neue Suche. Antworten werden situativ angepasst (nachts kurzhalten, vor Meeting fokussiert).

**Implementation-Skizze:**
- `src/main/modules/_situationContext.js`: `getContextBlock()` aggregiert Live-Daten
- Lightweight LLM-Call nach jedem Turn schreibt 1-Satz-Update in SQLite
- Block kommt in Layer 2 zwischen User-Frage und Layer-3-Prompt

### Phase J4 — Proaktive Trigger (Layer 1) (~3 Tage)

**Was:** Hintergrund-Daemons die Events erzeugen ohne User-Anfrage. Konkrete Trigger:

| Trigger | Bedingung | Aktion |
|---|---|---|
| **Termin-Vorlauf** | 15 min vor calendar event | Toast/Sprache: "Kunde Müller in 15 min, willst du den letzten Mail-Verlauf?" |
| **Mail-Burst** | ≥5 Mails von 1 Person in 30 min | Beim nächsten User-Trigger erwähnen |
| **Strom-Anomalie** | aktueller > 3× Tagesschnitt | Nachfrage-Toast "Strom-Anomalie 2.4kW — willst du checken?" |
| **Vault-Drift** | ≥3 neue Blog-Posts ohne Wikilinks | Wöchentlich vorschlagen body-pass laufen zu lassen |
| **Quarantäne-Reminder** | `_quarantine/` > 14 Tage alt mit Inhalt | Wöchentlich: "Quarantäne sichten?" |
| **Ungelesene-Aufgaben** | Aufgabe seit 3 Tagen offen mit Datum heute | Reminder-Toast morgens |
| **Briefing-Auto** | 6:30 (existiert bereits) | bleibt |

**Architektur:** Ein `daemonRegistry` registriert Background-Worker, jeder mit eigenem Cron + Trigger-Logik. Output geht entweder als Native-macOS-Notification (`node-notifier`-Subprocess) oder als Chat-Inject beim nächsten User-Turn.

**User-Control:** Settings-Tab "Proaktiv" mit Toggle pro Daemon + Schwellen-Konfiguration.

**Effekt:** Das ist der Schritt der VINCI vom Chat-Tool zum *Assistenten* macht.

### Phase J5 — Self-Eval-Loop (~2 Tage)

**Was:** Nach jeder Gemini-Antwort ein **kurzer Selbst-Check** (gleiches oder kleineres Modell):
> "Hat die letzte Antwort die ursprüngliche Frage tatsächlich beantwortet? Was fehlt? Score 0-1."

Bei Score < 0.6: Auto-Retry mit angepasstem Prompt ("Du hast X übersehen, versuch's nochmal mit Tool Y"). Erfolgs-Quote wird telemetriert, Pattern-Analyse identifiziert wiederkehrende Schwächen.

**Implementation:**
- Optional pro Antwort, Default an für komplexe Queries (laut Intent-Router)
- Setting "Self-Eval-Aggressivität": off / nur-bei-Komplex / immer
- Telemetrie: `self_eval_failed` mit Original-Frage + verbessert-mit-was

**Effekt:** Selbstkorrigierend. Halluzinationen werden eher gefangen.

### Phase J6 — Specialist Sub-Agents (Layer 4) (~5-7 Tage)

**Was:** Eigene Mini-Assistenten mit fokussiertem Prompt + Tool-Subset für klar abgegrenzte Domänen:

| Sub-Agent | Tool-Subset | System-Prompt-Fokus |
|---|---|---|
| **Researcher** | web_search, obsidian_search, web_saveToVault | "Du bist Recherche-Spezialist. Quellen-pingelig, konzis synthetisierend, immer mit URL." |
| **Calendar** | calendar_*, contacts_*, messages_send | "Du bist Termin-Spezialist. Konflikt-Detection, höfliche Vorschläge, Two-Step für Änderungen." |
| **Coding** | obsidian_search (Code-Notes), web_search | "Du bist Code-Buddy. Code-Blocks, Doku-Links, Test-First-Empfehlungen." |
| **Briefing** | calendar_today, mail_getUnread, news_getNews, weather, strom_getCurrent | "Du machst das Morgen-Briefing. 5 Sätze, prägnant, eine Empfehlung am Ende." |
| **Vault-Curator** | obsidian_*, graphCleaner.scanVault | "Du pflegst den Knowledge-Graph. Schlägst Aufräumungen vor, identifizierst Drift." |

**Delegation:** Main Orchestrator (Layer 3) erkennt Sub-Agent-Bedarf via Intent-Router (Layer 2) und sendet kompakten Delegations-Prompt. Sub-Agent antwortet, Main synthesiert in eigene Persönlichkeit.

**Effekt:** Qualität pro Domäne deutlich hoch, weil jeder Agent einen kleinen klaren Prompt hat. Hauptassistent bleibt die Stimme.

### Phase J7 — Conversation-Memory & Pattern-Learning (~3 Tage)

**Was:** Über das bestehende `memory.db` hinaus eine **Pattern-Schicht**:
- "Alex spricht morgens meist über Kalender" → morgens Calendar-Agent leichter triggern
- "Bei Recherche zu Anthropic immer Quellen speichern" → bei nächster Anthropic-Recherche proaktiv anbieten
- "Donnerstags 21:00 immer Strom-Check" → ohne Frage automatisch melden

**Implementation:** Tägliche Aggregation der Telemetrie + Memory in ein leichtes Pattern-Profil. Kleine Heuristik (kein Machine-Learning), reicht für Single-User.

**Effekt:** VINCI fühlt sich an als würde er dich kennen.

### Phase J8 — Wake-Word-Integration mit Mode-Switching (~2 Tage nach Wake-Word)

**Was:** Nach dem separaten Wake-Word-Track (siehe `2026-05-07-wake-word-spec.md` falls gemacht): unterschiedliche Reaktions-Modi je nach Tageszeit + Kontext:
- **Morgens nach Wake-Word**: direkt Briefing-Agent
- **Während Meeting (Calendar sagt's)**: Stiller Modus, nur Notiz-Mode
- **Tief in der Nacht**: kurze Antworten, kein TTS

---

## 6. Quick-Wins (jetzt erledigt, vor JARVIS-Mode)

Damit die JARVIS-Phasen auf solidem Fundament starten, wurden vorab umgesetzt:

- ✅ **Tool-Disambiguation** im System-Prompt für alle 14 Module mit Mehrfach-Tools (mail_getUnread vs getLatest, weather_getCurrent vs getForecast, reminders_getToday vs getAll vs getLists, system_getStatus vs getProcesses, n8n_*, strom_*, contacts_*, homeassistant_*).
- ✅ **Default-Modell auf Gemini 2.5 Pro** (Flash bleibt Fallback). Sofortige Accuracy-Verbesserung bei Tool-Calling.
- ✅ **Strukturiertes Telemetry-Logging** (`logEvent` in `telemetry.js`) für `gemini_empty_stop`, `gemini_safety_net_fired`, `gemini_unrecoverable_empty`, `tool_error`. JSONL nach `~/Library/Application Support/vinci/telemetry.log`, Auto-Rotation bei 5 MB. IPC-Handler `lyra:telemetry:recent` für UI-Diagnostik.

Diese drei sind die Foundation für alles weitere — Phase J5 (Self-Eval) baut direkt auf Telemetry, Phase J1 (Intent Router) baut auf saubere Tool-Definitionen.

---

## 7. Erfolgs-Metriken

Pro Phase definieren wir messbare Ziele via Telemetrie:

| Metrik | Heute (geschätzt) | Ziel nach J1+J2 | Ziel nach J5 |
|---|---|---|---|
| Tool-Call-Accuracy (richtige Tool-Wahl) | ~75-80% | ≥95% | ≥98% |
| Empty-STOP-Quirks pro 100 Queries | ~5-10 | ≤1 | ≤1 |
| Self-Eval-Pass-Rate | n/a | n/a | ≥90% |
| Median-Latenz Trivial-Query | ~1.5s | ~1.5s | ~1.5s |
| Median-Latenz Komplex-Query | ~6s | ~8s | ~10s (mit Self-Eval) |
| User-explizite Korrekturen ("nochmal", "anders") | ? | ↓50% | ↓80% |

---

## 8. Open questions

- **Claude Sonnet 4.5 als Komplex-Modell**: API-Key separat, Kosten pro Query höher. Lohnt das gegenüber Gemini 2.5 Pro? Test-Phase nötig.
- **Sub-Agents als Sub-Prozesse oder im selben Prozess?** Performance vs. Isolation.
- **Self-Eval-Modell**: gleiches Modell wie die Antwort oder kleineres+billigeres?
- **Telemetrie-Anonymisierung**: schreiben wir User-Frage in Klartext oder gehasht?
- **Pattern-Learning**: rein lokal (Heuristik) oder mit kleinem ML-Modell auf Daten?

---

## 9. Nicht-vergessen-Liste

Beim Bauen dran denken:
- Jede neue Schicht hat einen Settings-Toggle (off-Modus = altes Verhalten)
- Telemetrie für jede neue Schicht von Anfang an
- Multi-Vault-Detection (Phase 2 v2.1) bleibt aktiv — jede neue Background-Daemon-Operation respektiert sie
- Body-Wikilink-Pass-Idempotenz nicht brechen
- DSGVO/Privacy: Sub-Agents sehen nur Tool-Subset, kein Daten-Leak zwischen Domänen

---

## 10. Beziehung zur Wake-Word-Roadmap

Wake-Word und JARVIS-Mode sind **parallele Tracks**, nicht voneinander abhängig:
- Wake-Word: "Wie aktiviere ich VINCI?"
- JARVIS-Mode: "Was tut VINCI, nachdem er aktiviert ist?"

Sie integrieren sauber: Phase J8 koppelt sie. Wake-Word kann mit dem heutigen reaktiven VINCI starten und später vom JARVIS-Mode profitieren.

---

## 11. Empfohlene Reihenfolge

**Wenn JARVIS-Mode > Wake-Word für dich Priorität hat:**
1. Phase J1 (Intent Router) — größter Sprung in Accuracy
2. Phase J2 (Modell-Routing) — billig zu bauen, sofort messbar
3. Phase J4 (Proaktive Trigger) — größter Sprung in *Assistenten-Gefühl*
4. Phase J3 (Episodischer Kontext) — vertieft was J4 startet
5. Phase J5 (Self-Eval) — Robustheit
6. Phase J6 (Sub-Agents) — Skalierung der Intelligenz
7. Phase J7 (Pattern-Learning) — Personalisierung
8. Phase J8 (Wake-Word-Integration) — wenn Wake-Word fertig

**Wenn Wake-Word zuerst:**
Wake-Word komplett → dann JARVIS-Mode J1+J4+J3 als Trio (das gibt das beste "ich bin ein Assistent"-Gefühl in einem Aufwasch).

---

## 12. Wann starten

Wenn die ersten 7-14 Tage Telemetrie aus den Quick-Wins gesammelt sind. Dann sehen wir konkret:
- Wie oft fließt der Empty-STOP-Quirk noch?
- Welche Tools werden falsch gewählt?
- Was sind die häufigsten User-Re-Formulierungen?

Diese Daten formen die J1-Implementierung (Intent Router lernt aus echten Queries).
