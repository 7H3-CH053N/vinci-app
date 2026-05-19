// ── Knowledge-Graph-Builder für Obsidian ───────────────────────────────────────
import { localDateString } from './_localTime.js'
// Wandelt einen Fact-Satz in eine vernetzte Notiz-Struktur:
//
//   <Vault>/VINCI/
//     Personen/    Markus.md, Birgit.md, Bello.md, ...
//     Firmen/      Porsche.md, Sony DADC.md, ...
//     Orte/        Salzburg.md, ...
//     Themen/      Musik.md, ...
//     Tiere/       Bello.md, ...
//
// Pro Fact:
//   1. Ollama (Qwen 2.5 3B) extrahiert Eigennamen + Kategorie
//   2. Post-Filter wirft offensichtlichen Müll raus
//   3. Pro Entität wird die Notiz angelegt/erweitert
//   4. Wikilinks zwischen Entitäten werden im Fact-Text gesetzt
//
// Niemand wartet auf das Ergebnis – Aufruf ist fire-and-forget.

import axios from 'axios'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'fs'
import { join } from 'path'
import { VALID_CATS, isDomain } from './_graphCategories.js'
import { autoMergeAlias } from './_aliasBuilder.js'

const OLLAMA_URL  = 'http://localhost:11434'
const GRAPH_DIR   = 'VINCI'
const ALIAS_FILE  = '_aliases.json'

// Token-Overlap-Schwelle für Dedup (0.7 = wenn 70% der Wörter eines neuen Facts schon
// in der Notiz vorkommen, gilt es als Duplikat)
const DEDUP_THRESHOLD = 0.7

// ── Public ────────────────────────────────────────────────────────────────────
/**
 * Schreibt einen Fact in den Knowledge-Graph. Fire-and-forget.
 * @param {string} fact     — der zu speichernde Fact-Text
 * @param {string} vault    — absoluter Vault-Pfad
 * @param {string} model    — Ollama-Modell für Entity-Extraction
 */
export async function mirrorFactToGraph(fact, vault, model = 'qwen2.5:3b') {
  if (!fact || !vault) return
  if (!existsSync(vault)) return
  try {
    if (!statSync(vault).isDirectory()) return
  } catch { return }

  let entities = []
  try {
    entities = await extractEntities(fact, model)
  } catch (err) {
    console.error('[Graph] entity extraction failed:', err.message)
    return
  }

  entities = postFilter(entities, fact)
  if (entities.length === 0) return

  // Aliase auflösen (Michi K. → Michael Klotz, etc.)
  const aliases = loadAliases(vault)
  entities = entities.map(e => ({
    ...e,
    name: resolveAlias(e.name, aliases),
    originalName: e.name
  }))
  // Nach Auflösung erneut deduplizieren (kanonische Namen können kollidieren)
  const seen = new Set()
  entities = entities.filter(e => {
    const key = e.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log('[Graph] Fact →', entities.map(e => `${e.name} (${e.category})`).join(', '))

  // Fact-Text mit Wikilinks anreichern – auch Aliase im Text werden auf den
  // kanonischen Namen gemappt
  const linkedFact = applyWikilinks(fact, entities, aliases)

  for (const entity of entities) {
    try {
      writeEntityNote(vault, entity, linkedFact)
    } catch (err) {
      console.error(`[Graph] write ${entity.name} failed:`, err.message)
    }
  }
}

/**
 * Verzahnt eine ganze Notiz (z. B. aus obsidian_createNote) mit dem Knowledge-Graph.
 * Setzt Wikilinks im Body und fügt in jeder erwähnten Entitäts-Notiz einen
 * Rückverweis "Erwähnt in [[Notiz-Titel]]" hinzu.
 *
 * @param {string} bodyText        — Markdown-Body der Notiz
 * @param {string} noteTitle       — Titel der Notiz (für den Rückverweis-Wikilink)
 * @param {string} vault
 * @param {string} model
 * @returns {object} { linkedBody, entityCount }
 */
export async function linkNoteToGraph(bodyText, noteTitle, vault, model = 'qwen2.5:3b') {
  if (!bodyText || !vault) return { linkedBody: bodyText, entityCount: 0 }
  if (!existsSync(vault)) return { linkedBody: bodyText, entityCount: 0 }

  let entities = []
  try {
    entities = await extractEntities(bodyText, model)
  } catch (err) {
    console.error('[Graph/Note] entity extraction failed:', err.message)
    return { linkedBody: bodyText, entityCount: 0 }
  }
  entities = postFilter(entities, bodyText)
  if (!entities.length) return { linkedBody: bodyText, entityCount: 0 }

  const aliases = loadAliases(vault)
  entities = entities.map(e => ({
    ...e,
    name: resolveAlias(e.name, aliases),
    originalName: e.name
  }))
  const seen = new Set()
  entities = entities.filter(e => {
    const k = e.name.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k); return true
  })

  // 1) Wikilinks im Body setzen
  const linkedBody = applyWikilinks(bodyText, entities, aliases)

  // 2) In jeder Entitäts-Notiz einen Rückverweis hinzufügen
  const reverseRef = `Erwähnt in [[${noteTitle}]]`
  for (const entity of entities) {
    try {
      writeEntityNote(vault, entity, reverseRef)
    } catch (err) {
      console.error(`[Graph/Note] backlink ${entity.name} failed:`, err.message)
    }
  }

  console.log('[Graph/Note] verlinkt mit:', entities.map(e => e.name).join(', '))
  return { linkedBody, entityCount: entities.length }
}

// ── Aliase ────────────────────────────────────────────────────────────────────
// Format der _aliases.json:
// {
//   "Michael Klotz": ["Michi K.", "Michi", "Michael K"],
//   "Sony DADC":     ["Sony", "DADC"]
// }
function loadAliases(vault) {
  const file = join(vault, GRAPH_DIR, ALIAS_FILE)
  if (!existsSync(file)) return {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    // Reverse-Map: alias → canonical
    const map = {}
    for (const [canonical, aliases] of Object.entries(raw)) {
      map[canonical.toLowerCase()] = canonical  // identity
      if (Array.isArray(aliases)) {
        for (const a of aliases) map[String(a).toLowerCase()] = canonical
      }
    }
    return map
  } catch { return {} }
}

function resolveAlias(name, aliasMap) {
  return aliasMap[name.toLowerCase()] || name
}

// ── Entity-Extraction via Ollama ──────────────────────────────────────────────
async function extractEntities(fact, model) {
  const systemPrompt = `Du extrahierst aus einem deutschsprachigen Satz Eigennamen und kategorisierst sie.

Kategorien:
- Personen: konkrete menschliche Eigennamen UND Bandnamen (Iron Maiden, Metallica)
- Tiere: Haustiere mit Eigennamen
- Firmen: Unternehmen, Marken, Vereine, Restaurants
- Orte: Städte, Länder, Adressen
- Themen: Hobbys, Genres, Konzepte (z. B. 'Hard Rock', 'Fußball')

NICHT extrahieren (komplett ignorieren):
- Datumsangaben, Jahreszahlen ('1.8.2006', '2020')
- Generische Wörter ('Bruder', 'Frau', 'Sohn', 'Hund', 'Eventagentur')
- Hunderassen, Tierarten ('Labrador', 'Schäferhund')
- Berufsbezeichnungen ohne Eigennamen ('Manager', 'Mechaniker')

WICHTIG:
- 'Alex' = der User selbst, MUSS extrahiert werden, falls erwähnt
- Mehrwortige Eigennamen zusammen: 'Sony DADC', 'Iron Maiden', 'die eventer'
- Bandnamen IMMER 'Personen', NIE 'Projekte'

Antworte NUR JSON: {"entities": [{"name": "...", "category": "..."}]}`

  const userPrompt = `Beispiele:

1. "Markus ist Alex' Bruder und arbeitet bei Porsche"
→ {"entities":[{"name":"Markus","category":"Personen"},{"name":"Alex","category":"Personen"},{"name":"Porsche","category":"Firmen"}]}

2. "Bello ist Alex' Hund, ein Labrador geboren 2020"
→ {"entities":[{"name":"Bello","category":"Tiere"},{"name":"Alex","category":"Personen"}]}

3. "Alex hört gerne Iron Maiden und Metallica"
→ {"entities":[{"name":"Alex","category":"Personen"},{"name":"Iron Maiden","category":"Personen"},{"name":"Metallica","category":"Personen"}]}

Jetzt extrahiere aus:
"${fact}"`

  const body = {
    model, stream: false, format: 'json',
    options: { temperature: 0.1, num_ctx: 4096 },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt }
    ]
  }
  const res = await axios.post(`${OLLAMA_URL}/api/chat`, body, { timeout: 30_000 })
  try {
    const parsed = JSON.parse(res.data?.message?.content || '{}')
    if (Array.isArray(parsed.entities)) return parsed.entities
  } catch {}
  return []
}

// ── Hard-Reject + Force-Category ──────────────────────────────────────────────
const HARD_REJECT = [
  /^[\d\s\-\+\(\)\.\/]+$/,
  /^\+\d{8,15}$/,
  /^[\w.+-]+@[\w-]+\.[\w.-]+$/,
  /^\d{1,2}\.\s*(jänner|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)/i,
  /^\d{1,2}\.\d{1,2}\.\d{2,4}$/,
  /^\d{4}$/,
  /^(cpu|ram|gpu|disk|festplatte|akku|prozessor|arbeitsspeicher)$/i,
  /^(plus|pro|enterprise|free|basic|premium|standard|advanced)$/i,
  /^(gpt[-\s]?\d|claude[-\s]?\d|gemini[-\s]?\d)/i,
  /^.{1,2}$/,
  /^.{81,}$/
]

export function isHardRejected(name) {
  const t = String(name || '').trim()
  for (const re of HARD_REJECT) if (re.test(t)) return true
  return false
}

export function forceCategoryFor(name, suggestedCategory) {
  if (isDomain(name)) return 'Quellen'
  return suggestedCategory
}

// ── Post-Filter ───────────────────────────────────────────────────────────────
const GENERIC_WORDS = new Set([
  // Familienverhältnisse
  'bruder','schwester','vater','mutter','sohn','tochter','frau','mann','kind','familie',
  'ehefrau','ehemann','partner','partnerin','freund','freundin','kollege','kollegin','chef',
  'benutzer','user','person','jemand',
  // Tiere
  'hund','katze','pferd','vogel','fisch','tier',
  'labrador','schäferhund','retriever','dackel','beagle','golden',
  // Firmen-Generika
  'eventagentur','agentur','firma','büro','office','unternehmen','konzern',
  'restaurant','lokal','bar','café','cafe','laden','geschäft','shop','store',
  'trafik','tabakladen','bäckerei','metzgerei','supermarkt','bank','sparkasse',
  // Berufe/Titel
  'manager','mechaniker','arzt','ärztin','lehrer','lehrerin','student','studentin','schüler','schülerin',
  'ki-berater','berater','beraterin','consultant','direktor','geschäftsführer','geschäftsführung',
  'managing','director','leiter','leiterin','assistent','assistentin','sekretär','sekretärin',
  'verkäufer','verkäuferin','programmierer','entwickler','designer','blogger',
  // Sonstige
  'auto','wagen','haus','wohnung','garten','garage','blog','website','seite','homepage'
])

function postFilter(raw, fact) {
  const out = []
  const seen = new Set()

  for (const e of raw) {
    if (!e || typeof e.name !== 'string' || typeof e.category !== 'string') continue
    let name = e.name.trim().replace(/^["']|["']$/g, '')
    if (isHardRejected(name)) continue
    if (name.length < 2) continue
    if (GENERIC_WORDS.has(name.toLowerCase())) continue
    if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(name)) continue   // Datum
    if (/^\d{4}$/.test(name)) continue                        // Jahr
    if (/^\d+\s*(jahre?|monate?|tage?)$/i.test(name)) continue

    let category = e.category
    if (!VALID_CATS.includes(category)) category = 'Themen'
    category = forceCategoryFor(name, category)

    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, category })
  }

  // 'Alex' erzwingen, wenn im Fact erwähnt (Modell vergisst ihn manchmal)
  if (/\bAlex\b/.test(fact) && !out.some(e => e.name.toLowerCase() === 'alex')) {
    out.unshift({ name: 'Alex', category: 'Personen' })
  }

  return out
}

// ── Wikilinks im Fact-Text ergänzen ───────────────────────────────────────────
// Ersetzt sowohl den Original-Namen als auch alle bekannten Aliase durch einen
// Wikilink auf den kanonischen Namen.
function applyWikilinks(fact, entities, aliasMap = {}) {
  let result = fact
  // Pro Entität alle Schreibweisen sammeln (kanonisch + alle Aliase, die auf sie zeigen)
  const allReplacements = []
  for (const e of entities) {
    const variants = new Set([e.name])
    if (e.originalName) variants.add(e.originalName)
    // Alle Aliase, die auf diesen kanonischen Namen mappen, einsammeln
    for (const [alias, canonical] of Object.entries(aliasMap)) {
      if (canonical === e.name) variants.add(alias)
    }
    for (const v of variants) {
      allReplacements.push({ from: v, to: e.name })
    }
  }
  // Längere zuerst, damit "Iron Maiden" nicht von "Maiden" zerschossen wird
  allReplacements.sort((a, b) => b.from.length - a.from.length)

  for (const { from, to } of allReplacements) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?<![\\[\\w])(${escaped})(?![\\w\\]])`, 'gi')
    result = result.replace(re, `[[${to}]]`)
  }
  return result
}

// ── Notiz schreiben/erweitern ─────────────────────────────────────────────────
function writeEntityNote(vault, entity, linkedFact) {
  // 1) Datei der Entität finden – auch wenn sie in einer anderen Kategorie liegt
  //    (verhindert Duplikat-Notizen, wenn der LLM die Kategorie wechselt)
  const existingFile = findExistingNote(vault, entity.name)
  let file
  let content
  if (existingFile) {
    file = existingFile
    content = readFileSync(file, 'utf8')
  } else {
    const dir = join(vault, GRAPH_DIR, entity.category)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const safeName = entity.name.replace(/[<>:"/\\|?*\n\r]/g, '_').slice(0, 80)
    file = join(dir, `${safeName}.md`)
    content =
`---
source: VINCI
category: ${entity.category}
created: ${localDateString()}
---

# ${entity.name}

`
  }

  // 2) Dedup gegen alle bisherigen Bullet-Zeilen
  if (isFactDuplicate(content, linkedFact)) {
    console.log(`[Graph] dup skip ${entity.name}`)
    return
  }

  // 3) Anhängen
  const ts = new Date().toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
  const newLine = `- **${ts}** — ${linkedFact}`
  if (!content.endsWith('\n')) content += '\n'
  content += newLine + '\n'

  writeFileSync(file, content, 'utf8')

  // After write: if this is a multi-word person/firma name, try to merge any matching first-name file
  if (entity.name.includes(' ')) {
    try { autoMergeAlias(vault, entity.name) } catch (err) { console.warn('[Graph] autoMergeAlias failed:', err.message) }
  }
}

function findExistingNote(vault, name) {
  const safeName = name.replace(/[<>:"/\\|?*\n\r]/g, '_').slice(0, 80)
  const root = join(vault, GRAPH_DIR)
  if (!existsSync(root)) return null
  for (const cat of VALID_CATS) {
    const path = join(root, cat, `${safeName}.md`)
    if (existsSync(path)) return path
  }
  return null
}

// ── Token-basiertes Dedup ─────────────────────────────────────────────────────
// Vergleicht den neuen Fact mit jeder bestehenden Bullet-Zeile in der Notiz.
// Ähnlich = ≥70% der Tokens des neuen Facts kommen schon in einer Zeile vor.
const STOP_TOKENS = new Set([
  'der','die','das','ein','eine','einen','und','oder','ist','sind','war','waren',
  'in','an','am','auf','bei','mit','von','zu','zur','zum','aus','nach','für',
  'sein','seine','seinen','seines','sich','er','sie','es','wir','ihr','dem','den',
  'des','als','wie','so','nur','auch','noch','schon','dann','dass','das'
])
function tokenize(s) {
  return s.toLowerCase()
    .replace(/\[\[([^\]]+)\]\]/g, '$1')          // Wikilinks zu Plain-Text
    .replace(/[^\wäöüß ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_TOKENS.has(t))
}
function isFactDuplicate(content, newFact) {
  if (content.includes(newFact)) return true
  const newTokens = tokenize(newFact)
  if (newTokens.length === 0) return false
  // Jede bestehende Bullet-Zeile prüfen
  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('- ')) continue
    const lineTokens = new Set(tokenize(line))
    if (lineTokens.size === 0) continue
    let overlap = 0
    for (const t of newTokens) if (lineTokens.has(t)) overlap++
    const ratio = overlap / newTokens.length
    if (ratio >= DEDUP_THRESHOLD) return true
  }
  return false
}
