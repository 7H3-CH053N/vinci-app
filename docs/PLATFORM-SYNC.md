# Mac & Windows — Platform Sync

VINCI gibt es als zwei Codebases: **VINCI Mac** (dieses Repo, `vinci-app`) und **VINCI Windows** (separates Repo). Die teilen sich das Konzept und einen gemeinsamen Obsidian-Vault, aber haben jeweils plattform-native Backends. Diese Datei dokumentiert was geteilt wird, was getrennt ist, und wie ein neues Feature zwischen beiden synchronisiert wird.

## Geteilte Schicht

### Vault
- Beide schreiben in den **selben Obsidian-Vault** (typischerweise auf OneDrive oder iCloud Drive synchronisiert).
- Schema: `<Vault>/VINCI/{Personen,Tiere,Firmen,Orte,Themen,Quellen}/`, `<Vault>/RSS/<source>/`, `<Vault>/inbox/web/`, `<Vault>/VINCI/_aliases.json`, `<Vault>/VINCI/_quarantine/`.
- Frontmatter-Format ist **identisch** (Mac- und Windows-Importer produzieren gleichgeformte YAML).
- Dedup-Schlüssel ist immer der Slug → kein Schreiber überschreibt versehentlich was vom anderen.

### Konzepte / Patterns
- Tool-Naming: `<modul>_<aktion>` (`obsidian_search`, `web_search`, etc.)
- IPC-Channel-Prefix: `lyra:` (sowohl auf Mac als auch Windows)
- Tainted-Tracking + Memory-Worker-Filter
- Hard-Reject + Force-Cat + Auto-Alias im Knowledge-Graph
- Body-Wikilink-Pass mit Backlinks
- Empty-STOP-Sicherheitsnetze für Gemini 2.5 Flash

### Spec & Plan
- `docs/superpowers/specs/2026-05-06-vault-graph-redesign-design.md` — gilt für beide Plattformen, mit `§9 Implementation note for Windows version`
- `docs/superpowers/plans/2026-05-06-vault-graph-redesign.md` — Mac-zentriert, aber phasenweise auf Windows portierbar

## Plattform-spezifisch

| Bereich | Mac | Windows |
|---|---|---|
| **Mail** | Apple Mail / Outlook via AppleScript | MS Graph + iCloud IMAP via `imapflow` |
| **Kalender** | macOS Calendar via `ical-buddy` | MS Graph + iCloud CalDAV via `tsdav` |
| **Reminders** | macOS Reminders via AppleScript | MS Graph (Microsoft To-Do) |
| **Contacts** | macOS Contacts via AppleScript | (TODO Windows) |
| **Messages** | macOS Messages (iMessage/SMS) via AppleScript | (Nicht vorhanden) |
| **TTS** | macOS `say` + Edge TTS via Python-Subprocess | Gemini Native + Edge TTS via Self-Hosted-Proxy + SAPI-Fallback |
| **Push-to-Talk** | `Cmd+Shift+M` | `Ctrl+Shift+M` |
| **Hotkey** | `Cmd+Shift+Space` | `Ctrl+Shift+Space` |
| **Settings-Pfad** | `~/Library/Application Support/vinci/` | `%APPDATA%\vinci\` |
| **Backup-Pfad** | `~/.vinci-archive/` | `%USERPROFILE%\.vinci-archive\` |
| **Disk-Metric** | `df /System/Volumes/Data` (APFS-Quirk) | `wmic` oder `systeminformation` |
| **System-Tools** | `top`, `vm_stat`, `pmset`, `df` | `systeminformation`-Lib |
| **Build-Output** | DMG (arm64) | NSIS-Installer + Portable EXE |
| **Code-Signing** | Apple Developer ID (TODO) | Azure Trusted Signing oder DigiCert (TODO) |
| **Storage** | SQLite via `better-sqlite3` | JSONL + JSON (atomic temp+rename) |

## Welche Phasen aus dem v2.1-Redesign auf Windows portieren?

Aus dem [Implementation-Plan](superpowers/plans/2026-05-06-vault-graph-redesign.md):

| Phase | Mac | Windows | Anmerkung |
|---|---|---|---|
| 0. Foundations (git, vitest, turndown) | ✅ | tbd | Wenn Windows-Repo noch keine Tests hat |
| 1. Web-Search-Trigger-Fix | ✅ | **portieren** | Gemini-2.5-Quirks sind plattform-unabhängig |
| 2. Vault-Pfad-Validierung | ✅ | **portieren** | Multi-Vault-Detection ist gleich |
| 3. Migration-Script | ✅ | **skippen** | Mac-spezifisch (orphan-Mac-Vaults) |
| 4. Graph + Memworker-Härtung | ✅ | **portieren** | Hard-Reject-Filter ist universell |
| 5. One-Shot-Cleaner | ✅ | **portieren** | Schema-kompatibel |
| 6. Blog-Importer | ✅ | **gemeinsam betreiben für 7 Tage, dann n8n auf PC abschalten** | Slug-basierter Dedup verhindert Konflikte |
| 7. Body-Wikilink-Pass | ✅ | **portieren** | Idempotent → einmalig sauber laufen, dann läuft auf Mac UND Windows beide ohne Drift |
| 8. Web→Vault-Save | ✅ | **portieren** | inbox/web/-Sandbox |

## Workflow für plattform-übergreifende Features

Wenn ein Feature **beide Plattformen betrifft** (z. B. Wake-Word, neue Tool-Klasse, Schema-Änderung):

1. Auf der Plattform implementieren, die als erste dran ist (typisch Mac).
2. Spec + Plan in `docs/superpowers/` ablegen mit `§Implementation note for the other platform`.
3. Tests grün, Feature live.
4. Repo zum anderen Plattform-Claude geben (oder den Spec rüberkopieren).
5. Andere Plattform implementiert ihre Variante, **gleiches Schema**, **gleiche Tool-Namen**, **gleiches IPC-Format**.
6. Vault-Schreibvorgänge müssen idempotent sein, damit beide Plattformen parallel laufen können.

## Stolpersteine die wir gelernt haben

- **Vault-Pfad-Konfusion:** Mac hatte initial einen Parent-Ordner mit zwei nested Vaults gesetzt. Multi-Vault-Detection mit nested-Vault-Fall ist Pflicht.
- **System-Metriken in Memory:** Wenn man System-Tools nicht als tainted markiert, schreibt der Memworker "Mac CPU 24%" als Fakt. Tainting-Liste muss `system_*`, `homeassistant_*`, `strom_*` enthalten.
- **Plattform-Default-Apps:** Mac hat das Glück, ical-buddy / AppleScript für ALLES zu haben. Windows braucht MS Graph mit OAuth-Tanz. Settings-Schema unterscheidet sich entsprechend.
- **Dedup über Slug:** wenn Mac und Windows beide den selben Blog importieren, muss der Slug die deduplication tragen — sonst schreiben sie aneinander vorbei.

## Cross-Platform-TODOs

- 🔄 **Settings-Sync** zwischen Mac/Windows (über OneDrive oder eigenen Server)
- 🔄 **Memory-Sync** (SQLite ↔ JSONL — Schema unterschiedlich, brauchst einen Mapper)
- 🔄 **Conversation-Sync** (Conversations als Markdown nach Obsidian → automatisch beidseitig sichtbar)

Diese drei sind in der "v2.2"-Roadmap auf der Notion-Page vermerkt.
