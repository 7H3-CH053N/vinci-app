# VINCI Vault & Knowledge-Graph Redesign

**Status:** Design approved, awaiting implementation plan
**Author:** Alex Januschewsky / VINCI
**Date:** 2026-05-06
**Scope:** Vinci 2.0 (macOS), shared Obsidian vault syncs with Windows version

---

## 1. Background

VINCI maintains a personal knowledge graph as Markdown notes in an Obsidian vault. Two background workers populate it:

- **Memory-Worker** ([src/main/modules/memoryWorker.js](../../../src/main/modules/memoryWorker.js)) extracts stable facts about the user from chat conversations and writes them to a SQLite store + the vault.
- **Knowledge-Graph-Builder** ([src/main/modules/obsidianGraph.js](../../../src/main/modules/obsidianGraph.js)) extracts named entities from each fact and creates/updates entity notes under `<Vault>/VINCI/<Category>/<Name>.md` with bidirectional Wikilinks.

Both workers use a small local Ollama model (`qwen2.5:3b`) for entity extraction.

### 1.1 Observed problems

A live audit of the user's vaults turned up systemic quality issues:

**Wrong vault path.** The macOS app is configured to `/Users/alexjanuschewsky/Vaults` — a directory that contains *two* separate Obsidian vaults (`VINCI/` and `VINCI Wissen/`). Neither is the canonical vault. The canonical vault is at `/Users/alexjanuschewsky/Documents/VINCI Vault/`, contains 497 RSS-imported blog posts, and syncs with the Windows version of VINCI. Mac-side writes since setup have landed in two orphan vaults that never sync to Windows.

**Duplicate person notes.** First-name and full-name notes coexist for the same person: `Alex` + `Alex Januschewsky`, `Birgit` + `Birgit Januschewsky`, `Felix` + `Felix Klotz`, `Jasmin` + `Jasmin Klotz`, `Julian` + `Julian Januschewsky`, `Michael` + `Michael Klotz` + `Michael Januschewsky`, `Sarah` + `Sarah Klotz`, `Tobias` + `Tobias Januschewsky`. The existing alias mechanism in `_aliases.json` is empty, so no consolidation happens automatically.

**Wrong category assignments.** Examples from the live vault:
- `Personen/ChatGPT.md`, `Personen/GPT-5.5.md`, `Personen/Plus.md`, `Personen/Pro.md`, `Personen/Enterprise.md` — product names and subscription tiers extracted as people from a single OpenAI blog note
- `Themen/+436602660062.md`, `Themen/+43 6643580271.md` — phone numbers
- `Themen/b.januschewsky@live.at.md` — email address
- `Themen/1. August 2006.md`, `Themen/15. Jänner.md`, `Themen/9. September 1980.md` — dates
- `Themen/CPU.md`, `Firmen/Mac.md`, `Themen/PC Festplatte.md` — system metrics from VINCI's own status tool
- `Themen/9to5google.com.md`, `Themen/androidauthority.com.md`, `Themen/engadget.com.md`, `Themen/infosecurity-magazine.com.md` — news source domains
- `Themen/digitalhandwerk.md` (should be company), `Orte/digitalhandwerk.rocks.md` (URL, not a place), `Themen/Prompt Rocker.md` (company)
- `Orte/Klotz.md` (family name, not a place), `Orte/kuche.md` + `Orte/kuche_2.md` (TTS transcription typos)
- `Themen/KI.md` + `Themen/generative KI.md` + `Themen/generativen KI.md` (German declension duplicates)

**Memory-Worker leakage.** System-tool outputs ("Mac CPU 24%, RAM 47%") are written as facts despite regex filters in [memoryWorker.js Z. 192–217](../../../src/main/modules/memoryWorker.js#L192). The filter operates on extracted facts but doesn't strip noise from the conversation *before* the LLM sees it.

**No connection to blog content.** The 497 posts in `RSS/digitalhandwerk/` have author Wikilinks in YAML but no in-body Wikilinks to the entities the user has notes for (`OpenAI`, `Anthropic`, `Claude AI`, etc.). Backlink density is essentially flat.

**Blog importer is external.** The 497 posts come from an n8n workflow running on the user's Windows PC, not from VINCI Mac. There is no path to add new posts from the Mac side — neither manual nor scheduled.

**Web search appears broken.** User-reported. Investigation: the Tavily API works (HTTP 200 with the user's stored key, live tested). The code path is correctly wired (ipc → registry.dispatch → webModule.actions.search reads `ctx.settings.tavily.apiKey`). The likely root cause is the Gemini system prompt: the `WEB-SUCHE` block in [gemini.js Z. 60–83](../../../src/main/modules/gemini.js#L60) describes parameters and result handling but lacks any `TRIGGER (MUSS)` rule comparable to the Home-Assistant section. Gemini answers from training data instead of calling the tool.

---

## 2. Goals & non-goals

### Goals
- Mac VINCI writes to the same vault as the Windows version, no orphans.
- Existing 81 entity notes are cleaned up (merge duplicates, recategorize, drop garbage).
- New notes are written with the correct category from day one.
- The 497 blog posts get in-body Wikilinks to known entities, plus backlinks in those entity notes.
- Mac VINCI can pull new blog posts directly from `digitalhandwerk.rocks` via WordPress REST, replacing the Windows n8n workflow.
- "Speichere das ins Vault" after a web search produces a properly referenced, sandboxed inbox note.
- Web search reliably triggers when needed.

### Non-goals (deferred)
- Multiple parallel blog sources (schema is prepared, UI is Phase-2).
- Local caching of blog images (CDN URLs in v1; `cacheImages: false` flag is the seam).
- Replacing Markdown storage with a database/schema layer.
- Auto-generated topic-hub notes — Obsidian Dataview queries handle this in-vault.
- Replacing Ollama with cloud LLMs for the workers (privacy, cost).

---

## 3. Cross-cutting principles

These apply to every component below:

1. **Test before go.** Every component has a dry-run mode that operates on `~/.vinci-test-vault/` (a copy of the canonical vault) and produces a report. The real vault is only touched after the user explicitly confirms.
2. **Backup before mutation.** Any operation that deletes or moves files first creates a zip backup under `~/.vinci-archive/<datum>-<operation>.zip`.
3. **Idempotency.** Importers, link-passes, and cleaners must be safe to run repeatedly. Re-running produces no diff if no change is needed.
4. **Trash, don't delete.** Anything the cleaner removes lands in `<Vault>/VINCI/_quarantine/` by default, not in `rm`. The user empties quarantine manually if desired.
5. **Future-proof shape.** Plain Markdown + Wikilinks remains the storage format. Extensibility comes from clean module boundaries (source registry for importers, rules registry for cleaner, model strategy for extraction), not from a schema layer.

---

## 4. Component design

### 4.1 Vault migration & path correction

**Problem:** Mac points at the wrong vault root; two Mac-only orphan vaults exist.

**Implementation:**

**4.1.1 Path validation in `obsidian.js`.** In `getVault(ctx)`, after the `existsSync` check, walk one level deep looking for `.obsidian/` subdirectories. If more than one is found at first level, return `{ error: 'Pfad enthält mehrere Vaults — wähle den konkreten Vault aus, nicht den Parent-Ordner.' }`. The Settings UI surfaces this error inline next to the vault-path field.

**4.1.2 Settings change (manual).** First action after this redesign ships: user changes the vault path in Settings → Dienste → Obsidian-Vault from `/Users/alexjanuschewsky/Vaults` to `/Users/alexjanuschewsky/Documents/VINCI Vault`.

**4.1.3 Migration script.** New module `src/main/modules/_vaultMigration.js`. Surfaced as a Settings button "Alte Mac-Vaults zusammenführen". Workflow:

1. Source paths (hard-coded for this one-shot migration): `/Users/alexjanuschewsky/Vaults/VINCI/` and `/Users/alexjanuschewsky/Vaults/VINCI Wissen/`.
2. Target: the configured canonical vault (must be set first via 4.1.2).
3. For each entity note in each source vault:
   - Find the corresponding note in the target by exact filename match within the same category folder.
   - If the target note doesn't exist: copy the source note into the target.
   - If the target note exists: read both bullet sections, merge unique bullets (token-overlap dedup, threshold 0.7 — same as `obsidianGraph.js isFactDuplicate`), append the merged result to the target.
4. Generate a report: `{ scanned, copied, merged, skipped_duplicates, errors }`.
5. Show the report in a modal. User clicks "Anwenden" or "Abbrechen".
6. On apply: zip-backup the target vault to `~/.vinci-archive/2026-05-06-pre-migration.zip`, then perform the writes, then move both source vaults to `~/.vinci-archive/orphan-vaults-<datum>/`.

**4.1.4 Test fixture.** Before live run, the script copies `/Users/alexjanuschewsky/Documents/VINCI Vault/` to `~/.vinci-test-vault/` and operates there. The user reviews the test vault in Obsidian, then triggers the real run.

---

### 4.2 Blog importer

**New module:** `src/main/modules/blogImporter.js`

**4.2.1 Source registry.** Source definitions live in settings under `settings.blogSources` as an array. v1 ships with a single hardcoded entry that the user cannot edit yet:

```js
{
  id: 'digitalhandwerk',
  type: 'wordpress',
  baseUrl: 'https://digitalhandwerk.rocks',
  vaultFolder: 'RSS/digitalhandwerk',
  authorWikilink: '[[Alex Januschewsky]]',
  cacheImages: false,
  enabled: true
}
```

The `type: 'wordpress'` discriminator gates which fetcher is used. A future `type: 'rss'` adds RSS support without touching the WordPress code path.

**4.2.2 Fetch.** WordPress REST endpoint:

```
GET {baseUrl}/wp-json/wp/v2/posts
    ?per_page=100
    &orderby=date
    &order=desc
    &_fields=id,date,modified,slug,link,title,content,excerpt,categories,tags,featured_media
    &page=N
```

Pagination via `x-wp-totalpages` response header. Categories and tags are fetched separately on first run and cached in `~/Library/Application Support/vinci/blogImporter-taxonomy-<sourceId>.json` to resolve numeric IDs to slugs/names.

**4.2.3 Cursor.** No state file. At sync start, walk `<Vault>/<source.vaultFolder>/*.md`, parse YAML headers only (not bodies), find the maximum `published` value. Fetch only posts with `date > cursor`. First run (empty folder) fetches all posts.

**4.2.4 Dedup & update.** Filename = `<slug>.md`. If a target file exists, compare its frontmatter `modified` field against the REST `modified`. If REST is newer: re-render and overwrite. Otherwise: skip.

**4.2.5 HTML→Markdown.** New dependency: `turndown`. Configuration:
- Standard HTML elements: headings, lists, links, code blocks, blockquotes, emphasis.
- `<img>` → `![alt](src)`. URLs stay on the CDN (`cacheImages: false`).
- `<figure>` + `<figcaption>` → image + italic caption line.
- WordPress shortcodes (`[caption ...]…[/caption]`) are stripped via regex pre-pass.
- HTML entities (`&amp;`, `&uuml;`) are decoded.

**4.2.6 Output frontmatter.** Compatible with the existing n8n-imported posts plus three new fields (`wp_id`, `modified`, `mentions`). Existing posts don't need a re-format.

```yaml
---
title: "..."
source: "digitalhandwerk.rocks"
url: "..."
slug: "..."
wp_id: 9965
published: "2026-05-06T14:33:51Z"
modified: "2026-05-06T14:33:51Z"
published_formatted: "6. Mai 2026"
fetched: "2026-05-06T19:00:00Z"
tags: [rss, auto-import, digitalhandwerk, ki, chatgpt]
categories: [persoenliches]
author: "[[Alex Januschewsky]]"
mentions: ["[[OpenAI]]", "[[Claude AI]]"]
hero_image: "..."
---
```

**4.2.7 Body wikilink pass.** After writing the body, pipe it through the body-wikilink engine (4.4.2) so `mentions:` is filled and `[[Wikilinks]]` are inserted in the body.

**4.2.8 Triggers.** Four entry points, all calling `blogImporter.runOnce(sourceId, { force, dryRun })`:

1. **Voice / chat-text:** Tool `blog_sync` exposed via the registry. Gemini prompt is updated to call it on phrases like "sync blog", "hol meine artikel", "neue posts ziehen", "blog aktualisieren".
2. **Settings button:** "Jetzt holen" next to the source row.
3. **Cron:** New task type "Blog-Sync" in the Tasks tab. Default schedule: daily 09:00.

**4.2.9 Tool definition.**

```js
{
  name: 'blog_sync',
  description: 'Holt neue Blog-Posts via WordPress-REST in den Vault. Idempotent — bereits vorhandene werden übersprungen, Updates überschrieben. Trigger: "sync blog", "hol meine artikel", "blog aktualisieren".',
  parameters: {
    type: 'object',
    properties: {
      sourceId: { type: 'string', description: 'Optional: Source-ID (Default: erste enabled).' },
      force:    { type: 'boolean', description: 'true = ALLE Posts neu ziehen, nicht nur Delta.' }
    }
  }
}
```

**4.2.10 Sync result.**

```js
{
  source: 'digitalhandwerk',
  total_remote: 501,
  total_local_before: 497,
  fetched: 4,
  newly_created: 4,
  updated: 0,
  skipped_unchanged: 0,
  errors: [],
  newest_post: '500 Artikel. Zwei Jahre. Eine Frage…'
}
```

Gemini synthesizes a German confirmation from this object.

**4.2.11 Tests.**

| Test | Setup | Assertion |
|---|---|---|
| First run, empty folder | Mock 7 posts in REST | 7 created, 0 skipped, 0 errors |
| Incremental run | Mock 7 posts, 5 already in vault | 2 created, 5 skipped, 0 errors |
| Update detection | Mock post with newer `modified` | 1 updated, 0 created |
| Network error | Mock 500 response | error returned, no partial writes |
| Dry-run mode | `dryRun: true` | writes to `~/.vinci-test-vault/`, real vault untouched |
| Live smoke | Real REST against digitalhandwerk.rocks | Diff = 4 (501 remote − 497 local) |

---

### 4.3 Graph + Memworker hardening

**4.3.1 Canonical category set.** Used by both `obsidianGraph.js` and `memoryWorker.js`:

| Category | Definition |
|---|---|
| **Personen** | Real humans with proper names. Full name preferred; solo first names only when the alias map confirms identity. |
| **Firmen** | Companies, products-as-companies, bands, clubs, organizations. |
| **Orte** | Geographic locations, addresses, countries, regions. **Excludes** domains and family surnames. |
| **Themen** | Concepts, genres, technologies (KI, Heavy Metal). |
| **Tiere** | Pets with proper names. |
| **Quellen** | News sites, blogs, magazines — anything ending in `.com`/`.de`/`.at`/`.rocks`/etc. that is a publication. **NEW.** |

**Reclassification implication:** All bands currently in `Personen/` (Iron Maiden, Metallica, Motörhead, The Pretty Reckless, Five Finger Death Punch) move to `Firmen/`. The cleaner (4.4.1) handles the migration.

**4.3.2 Hard-reject filter.** Applied in `obsidianGraph.js postFilter` *before* the post-LLM filter, so bad input never reaches the entity-write stage:

```js
const HARD_REJECT = [
  /^[\d\s\-\+\(\)\.\/]+$/,                                                // pure phone-shaped
  /^\+\d{8,15}$/,                                                          // phone international
  /^[\w.+-]+@[\w-]+\.[\w.-]+$/,                                            // email
  /^\d{1,2}\.\s*(jänner|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)/i,  // German date
  /^\d{1,2}\.\d{1,2}\.\d{2,4}$/,                                           // numeric date
  /^\d{4}$/,                                                                // year
  /^(cpu|ram|gpu|disk|festplatte|akku|prozessor|arbeitsspeicher)$/i,        // system metric
  /^(plus|pro|enterprise|free|basic|premium|standard|advanced)$/i,          // subscription tier
  /^(gpt-?\d|claude-?\d|gemini-?\d)/i,                                      // model version
  /^.{1,2}$/,                                                                // too short
  /^.{81,}$/                                                                 // too long (sentences)
]
```

A name matching any pattern is dropped.

**4.3.3 Domain detection.** A name matching `/[a-z0-9-]+\.(com|de|at|net|org|io|ai|rocks|blog|news|info)$/i` is forced to category `Quellen`, regardless of what the LLM said.

**4.3.4 Auto alias building.** When a new entity is being written:

1. If the name has whitespace (multi-word, treated as full name) and a single-word-name file exists with the same first token → register the single-word as alias of the new full name. Move bullets from the single-word file into the full-name file. Move the now-empty single-word file to `<Vault>/VINCI/_quarantine/` (consistent with the trash-don't-delete principle from §3).
2. If the name is single-word and a multi-word file exists where the first token matches → register this name as alias of the multi-word name. Append any bullets to the multi-word file. Don't create a new file.

The aliasmap in `_aliases.json` is rewritten after each operation.

**4.3.5 Memworker pre-filter.** In `memoryWorker.js extractFacts`, *before* building the conversation string, drop lines matching system-noise patterns:

```js
const SYSTEM_NOISE = /\b(cpu|ram|arbeitsspeicher|festplatte|akku|disk)\b.*\b\d+\s*(%|prozent|gb|mb)/i
```

The LLM never sees these lines, so it can't extract them as facts.

**4.3.6 Tainting tools expanded.** In [ipc.js Z. 39](../../../src/main/ipc.js#L39):

```js
const TAINTING_TOOLS = new Set([
  'web_search',
  'messages_getRecent', 'messages_getUnread', 'messages_search',
  'mail_getUnread', 'mail_getLatest',
  // NEW:
  'system_status',
  'strom_current',
  'homeassistant_state',
  'homeassistant_call'
])
```

Any chat turn that hits one of these is excluded from memory consolidation.

**4.3.7 Model setting.** Settings → Dienste → Knowledge-Graph → "Extraction-Modell" dropdown:

- `gemma3:4b` — **new default**, best German quality for the latency
- `qwen3:4b`
- `qwen3:8b` — opt-in, max quality, +2 s per run
- `qwen2.5:3b` — kept for backwards compat, marked "veraltet"

The dropdown also shows availability per model (queries `ollama list` on open). A "Modell jetzt installieren" button shells out `ollama pull <model>` with progress visible in a small status panel. Reads `settings.memoryWorkerModel` (existing key; no migration needed).

**4.3.8 Tests.** A snapshot suite in `src/main/modules/__tests__/extraction.test.js` (or equivalent location given the project layout) with at least 30 real-world cases sampled from the live vault's bad notes. Examples:

```js
expect(extractEntities("OpenAI hat ChatGPT Plus, Pro und Enterprise als Tarife"))
  .toEqual([
    { name: 'OpenAI',  category: 'Firmen' },
    { name: 'ChatGPT', category: 'Firmen' }
  ])

expect(looksLikeFact("Alex' Mac CPU-Auslastung liegt bei 24%")).toBe(false)
expect(looksLikeFact("Alex hat den Kontaktnamen 'Prompt Rocker' gespeichert")).toBe(false)

expect(categorizeName("9to5google.com")).toBe('Quellen')
expect(categorizeName("Klotz")).not.toBe('Orte')   // family name, not a place
```

Suite must pass before the new model setting is exposed in the UI.

---

### 4.4 Cleaner + body wikilink pass + web→vault save

All three share an entity-extraction-and-linking engine and live in a new module `src/main/modules/graphCleaner.js`. The existing `obsidianGraph.js` remains for live entity-writing during chat.

**4.4.1 One-shot cleaner.**

UI: Settings → Knowledge-Graph → button "Vault aufräumen". Three phases:

**Phase A — Scan (read-only).** Walks `<Vault>/VINCI/Personen/`, `Firmen/`, `Orte/`, `Themen/`, `Tiere/`. For each note, runs the LLM (gemma3:4b) with the canonical-category prompt and produces a proposal. The plan is written to `~/Library/Application Support/vinci/cleanup-plan-<datum>.json`:

```js
{
  scanned: 81,
  proposals: [
    { kind: 'merge',        from: ['Personen/Alex.md', 'Personen/Alex Januschewsky.md'],
      into: 'Personen/Alex Januschewsky.md', reason: '…', bullets_combined: 7, bullets_dedup: 2 },
    { kind: 'recategorize', from: 'Themen/Prompt Rocker.md', to: 'Firmen/Prompt Rocker.md', reason: '…' },
    { kind: 'recategorize', from: 'Themen/9to5google.com.md', to: 'Quellen/9to5google.com.md', reason: 'News-Domain' },
    { kind: 'trash',        file: 'Personen/Plus.md', reason: 'Abo-Tarif', bullets: 1 },
    { kind: 'rename',       from: 'Orte/kuche.md', to: 'Orte/Küche.md', reason: 'TTS-Tippfehler' },
    { kind: 'alias',        canonical: 'Michael Klotz', add_aliases: ['Michi K.', 'Michi'] }
  ]
}
```

Proposal kinds: `merge`, `recategorize`, `trash`, `rename`, `alias`.

**Phase B — Review (UI).** Modal in Settings shows each proposal as a card with: kind, reason, preview of affected content (bullets that disappear on `trash`; merged-bullet diff on `merge`). Three actions per card: ✅ Anwenden / ❌ Überspringen / 📦 Trash → in `_quarantine/`. Bulk actions "Alle akzeptieren" / "Alle ablehnen". Default action for `trash` proposals is `_quarantine/`, not real delete.

**Phase C — Apply.**
1. Zip-backup the entire `<Vault>/VINCI/` to `~/.vinci-archive/cleanup-<datum>.zip`.
2. Run accepted proposals in this order: `alias` → `merge` → `recategorize` → `rename` → `trash`. (Aliases first so subsequent merges can use them.)
3. Each proposal is atomic. On any error: rollback that proposal (restore from backup), log, continue with the next.
4. After all proposals: regenerate `_aliases.json` from the current state.
5. Show final report.

**Phase A and Phase C are tested against `~/.vinci-test-vault/` first.** The user runs the full flow there, opens the test vault in Obsidian, verifies, then runs against the real vault.

**4.4.2 Body wikilink pass.**

Trigger sites:
- Automatically called at the end of `blogImporter.runOnce` for newly written posts.
- Manually from Settings → "Bestehende Posts neu verlinken" — iterates over all `<Vault>/<source.vaultFolder>/*.md` for every enabled source.
- Called inline by the web→vault save (4.4.3).

Algorithm (idempotent):

1. **Inventory:** Read all entity-note filenames under `VINCI/Personen/`, `Firmen/`, `Quellen/`. Read `_aliases.json`. Build a list of `(searchTerm, canonicalName)` pairs covering both canonical names and all aliases. Sort descending by length so multi-word names match before single-word ones (`Iron Maiden` before `Maiden`).
2. **Body scan:** For each post, read body. For each `(searchTerm, canonicalName)`:
   - Regex: `(?<![\[\w])${escape(searchTerm)}(?![\w\]])` (case-insensitive, word boundaries, not inside existing `[[...]]`).
   - First match per term: replace with `[[canonicalName]]`. Subsequent matches in the same post: leave as plain text (Obsidian-convention — link the first occurrence).
   - Track which canonical names matched.
3. **Frontmatter:** Set `mentions: ["[[Name1]]", "[[Name2]]", …]` to the deduplicated list of matches. Sort alphabetically for stable diffs.
4. **Backlinks:** For each matched canonical, append a bullet to the entity's note: `- Erwähnt in [[<post-title>]]`. Skip if the exact bullet already exists.
5. **Hash & write only on diff:** Compute `sha256` of new body+frontmatter; compare with old. Write only if different. This makes re-runs free.

**Auto-firma threshold:** When the body pass discovers a name that matches a clearly-corporate pattern (capitalized, not a person-name shape, no spaces or "Inc"-suffix-like) and that name is not yet in the inventory: count occurrences across *all* posts processed in this pass. Threshold ≥ 2 distinct posts → create a stub `<Vault>/VINCI/Firmen/<Name>.md`:

```yaml
---
source: VINCI
category: Firmen
created: 2026-05-06
auto_created: true
first_seen_in: ["[[<post1>]]", "[[<post2>]]"]
---

# <Name>

```

The user can review auto-created stubs by filtering on `auto_created: true` in Obsidian.

**4.4.3 Web→Vault save.**

New tool `web_saveToVault`, replacing the generic `obsidian_createNote` for web-search-derived saves.

```js
{
  name: 'web_saveToVault',
  description: 'Speichert einen Web-Suche-Treffer als referenzierte Notiz unter inbox/web/. NUR aufrufen, wenn Alex explizit "speicher das ins vault" / "leg eine notiz an" / "merk dir das mit quelle" sagt nach einer Web-Suche.',
  parameters: {
    type: 'object',
    properties: {
      title:     { type: 'string', description: 'Knapper deutscher Titel.' },
      summary:   { type: 'string', description: 'Deutsche Zusammenfassung, 3–8 Sätze.' },
      sources:   { type: 'array', items: { type: 'string' }, description: 'Quellen-URLs (1–3).' },
      keyPoints: { type: 'array', items: { type: 'string' }, description: 'Optional: 3–5 Bullets.' }
    },
    required: ['title', 'summary', 'sources']
  }
}
```

Behavior:
1. Slugify `title` (German-aware: `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, lower-case, `[^a-z0-9-]→-`).
2. Write to `<Vault>/inbox/web/<YYYY-MM-DD> – <slug>.md`. If the file exists: append `-2`, `-3`, etc.
3. Frontmatter:

```yaml
---
title: "..."
source: web
sources:
  - "https://..."
fetched: "2026-05-06T19:45:12Z"
tags: [web-import, inbox]
status: zu-sichten
mentions: []
---
```

4. Body:

```markdown
# Title

> Recherchiert von VINCI am 6. Mai 2026 aus N Quellen.

## Zusammenfassung
{summary}

## Kernaussagen
- {keyPoints[0]}
- ...

## Quellen
1. [host1](url1)
2. [host2](url2)
```

5. Run the body wikilink pass (4.4.2) against this new note. `mentions:` gets filled. Backlinks land in matched entity notes.
6. The note is **not** added to the SQLite memory (web-tainted rule from 4.3.6 protects this).

The `inbox/web/` location is intentional: web content stays sandboxed away from curated knowledge. The `status: zu-sichten` tag lets the user surface inbox notes via Dataview/tag-search, then manually move keepers to permanent locations. Worthless notes are deleted from inbox without orphaning backlinks because backlinks point to entity notes, not the inbox note itself.

**4.4.4 Tests.**

| Test | Assertion |
|---|---|
| Cleaner Phase A on test vault with 30 known-bad notes | Correct proposal kind for ≥ 90% of cases |
| Cleaner Phase C apply | No file disappears without backup; `_aliases.json` reflects new state; bullets across merges are not lost |
| Body pass idempotency | Run twice: second run produces zero file writes, zero diffs |
| Auto-firma threshold | "Mistral" in 1 post → no note. "Mistral" in 3 posts → `Firmen/Mistral.md` with `auto_created: true` |
| Web→vault save | Mock Gemini call with 3 sources → frontmatter correct, wikilinks set, backlinks appended in 2 entity notes, file in `inbox/web/` |
| Web→vault de-confliction | Two saves with the same title same day → second saved as `<slug>-2.md` |

---

### 4.5 Web search trigger fix

**File:** [src/main/modules/gemini.js Z. 60–83](../../../src/main/modules/gemini.js#L60)

Insert a `TRIGGER (MUSS):` block immediately after the `WEB-SUCHE (web_search):` heading:

```
TRIGGER (MUSS):
- Bei Fragen mit "aktuell", "heute", "neueste", "letzte Tage", "diese Woche", "News",
  "was passiert gerade" → IMMER web_search aufrufen, auch wenn du eine Antwort
  aus deinem Trainingswissen kennst.
- Bei Fragen zu öffentlichen Firmen, Software-Versionen, Produkt-Releases, Marktdaten,
  Personen des öffentlichen Lebens → IMMER web_search.
- Bei "was weißt du über X" UND X ist nicht im persönlichen Kontext (Familie/Freunde/
  eigener Kalender) → web_search.
- Eine "Aus meinem Trainingswissen weiß ich..."-Antwort zu aktuellen Themen ist ein
  FEHLER, wenn du nicht zuerst web_search probiert hast.
- Wenn web_search keine relevanten Treffer liefert: SAG das ehrlich, halluziniere nicht.
```

**File:** [src/main/modules/web.js Z. 51](../../../src/main/modules/web.js#L51)

Add `Authorization: Bearer ${apiKey}` to the request headers (in addition to the existing `api_key` body field). Tavily accepts both; this prepares for a future deprecation of body-auth.

**Smoke tests:**

| Query | Expected behavior |
|---|---|
| "Was gibt's Neues bei OpenAI?" | web_search called |
| "Wie spät ist es?" | no web_search |
| "Was hat mir Birgit gestern geschrieben?" | no web_search (personal context) |
| "Aktueller Bitcoin-Kurs" | web_search called |
| "Wer hat 2024 die Champions League gewonnen?" | web_search called |
| "Wer ist mein Bruder?" | no web_search (memory tool) |

---

## 5. Roll-out plan

Each step is independently shippable. The user explicitly approves each before merge to main.

| # | Step | User-visible result | Risk |
|---|---|---|---|
| 1 | Web search trigger fix (4.5) | Web search works again | Minimal (prompt-only) |
| 2 | Vault path validation + manual setting change (4.1.1, 4.1.2) | Mac writes to canonical vault | None (validation only) |
| 3 | Migration script (4.1.3) | Orphan vaults are merged | Low (backup before apply) |
| 4 | Graph + Memworker hardening (4.3) | New notes are correctly classified | Low (test-vault first) |
| 5 | One-shot cleaner (4.4.1) | Existing 81 garbage notes are cleaned | Medium (deletes/moves; backup mandatory) |
| 6 | Blog importer (4.2) | n8n workflow on Windows can be retired | Low (idempotent dedup) |
| 7 | Body wikilink pass (4.4.2) | 497 posts are interlinked | Low (idempotent, mark-up only) |
| 8 | Web→vault save (4.4.3) | "Speichere das ins Vault" works with proper references | Low |

**Parallel-running window for the n8n workflow.** After step 6 ships, both the Windows n8n flow and Mac VINCI write the same posts in parallel for 7 days. The slug-based dedup ensures no overwrites or duplicates. After 7 days without drift, the Windows user disables the n8n workflow. After 30 days, deletes it.

---

## 6. Settings additions

```js
// Existing keys remain. New / changed keys:
settings = {
  obsidian: {
    vaultPath: '/Users/alexjanuschewsky/Documents/VINCI Vault'   // CHANGED default
  },
  memoryWorkerModel: 'gemma3:4b',                                 // CHANGED default
  blogSources: [                                                  // NEW
    {
      id: 'digitalhandwerk',
      type: 'wordpress',
      baseUrl: 'https://digitalhandwerk.rocks',
      vaultFolder: 'RSS/digitalhandwerk',
      authorWikilink: '[[Alex Januschewsky]]',
      cacheImages: false,
      enabled: true
    }
  ]
}
```

---

## 7. File-system layout (target state)

```
/Users/alexjanuschewsky/Documents/VINCI Vault/
├── .obsidian/
├── inbox/
│   └── web/                            # web→vault saves land here
├── RSS/
│   └── digitalhandwerk/                # 501+ blog posts, slug-named
├── VINCI/
│   ├── _aliases.json                   # auto-built, manually editable
│   ├── _quarantine/                    # cleaner trash, user empties manually
│   ├── Personen/                       # full names; first-name aliases live in _aliases.json
│   ├── Firmen/                         # incl. bands, products-as-companies
│   ├── Orte/                           # geographic only
│   ├── Themen/                         # concepts
│   ├── Tiere/
│   ├── Quellen/                        # NEW — news domains, magazines
│   └── Notizen/                        # explicit user-written notes via obsidian_createNote
└── ...

~/.vinci-archive/
├── 2026-05-06-pre-migration.zip
├── orphan-vaults-2026-05-06/
└── cleanup-<datum>.zip

~/Library/Application Support/vinci/
├── vinci-settings.json
├── memory.db
├── blogImporter-taxonomy-digitalhandwerk.json   # NEW (cached WP categories/tags)
└── cleanup-plan-<datum>.json                    # NEW (last cleaner plan, for re-review)
```

---

## 8. Open questions

None. All decisions captured above. The implementation plan derived from this spec will further break each component into ordered, testable tasks.

---

## 9. Implementation note for Windows version

This spec is shared across the macOS and Windows builds of VINCI. Windows-specific divergences:

- The n8n workflow on Windows is the source of truth for blog imports until step 6 ships and the parallel-running window completes.
- The Mac migration script (4.1.3) is a one-shot specific to the user's orphan-vault situation; Windows does not need it.
- The vault path on Windows uses Windows-native conventions; this spec's Mac paths are illustrative.
- Settings keys, IPC contracts, module APIs, frontmatter formats, and Wikilink algorithms are platform-agnostic and apply to both builds.

The Windows version is expected to consume this spec and produce its own implementation tasks for steps 1, 2, 4, 5, 7, 8 (skipping 3 and adapting 6 to disable the n8n workflow at the right time).
