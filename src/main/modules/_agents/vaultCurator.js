// Vault-Curator Sub-Agent — Phase J6 Stufe 5.
//
// Analysiert den Vault und schreibt einen lesbaren Report mit Empfehlungen.
// Macht KEINE automatischen Änderungen — User entscheidet via graphCleaner-UI
// oder manuell, was umgesetzt wird.
//
// Output: VINCI/Briefings/VaultCurator/<datum>.md
//
// Trigger:
//   - Chat: "Vault-Check", "Vault-Audit", "schau dir den Vault an"
//   - UI: 🔍 Vault-Curator Button

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { localISOString, localDateString, localDateLong } from '../_localTime.js'
import { isGermanStopword } from '../_germanStopwords.js'
import { registerAgent } from '../_subAgents.js'

const ENTITY_CATEGORIES = ['Personen', 'Tiere', 'Firmen', 'Orte', 'Themen', 'Quellen']

// Folders die als „Posts" gelten für Plain-Text-Mention-Match (also wirkliche
// Inhalts-Files). Entity-Notes sind absichtlich NICHT dabei, weil sonst die
// `mentions: []`-Frontmatter aller Posts jede Entity über sich selbst pumpen würde.
const PLAIN_TEXT_POST_FOLDERS = ['RSS/digitalhandwerk', 'inbox',
  'VINCI/Briefings', 'VINCI/Briefings/Daily',
  'VINCI/Briefings/Weekly', 'VINCI/Briefings/VaultCurator']

// Folders die für Wikilink-Counting gescannt werden (auch Entity-Notes, damit
// Cross-Mentions zwischen Entities zählen — z.B. Alex.md verlinkt Familie).
const POST_FOLDERS = [...PLAIN_TEXT_POST_FOLDERS,
  'VINCI/Personen', 'VINCI/Firmen', 'VINCI/Themen',
  'VINCI/Orte', 'VINCI/Quellen', 'VINCI/Tiere']

// Generische deutsche/englische Worte die NICHT für Plain-Text-Match in Frage
// kommen (zu viele false-positives).
const PLAINTEXT_BLOCK = new Set([
  'mac','apple','ende','anfang','italien','team','design','code','idee','art',
  'eu','ai act','api','sdk','llm','agi','prompt','model','tool','test',
  'salzburg', // sehr häufig in Posts erwähnt, aber meist ohne Bezug zur Stadt-Note
])

// ── Pure Helpers ─────────────────────────────────────────────────────────────

/** Listet alle Entity-Files mit Kategorie + Metadata (Stand: jetzt im Vault). */
export function collectVaultInventory(vaultPath) {
  const root = join(vaultPath, 'VINCI')
  const out = []
  for (const cat of ENTITY_CATEGORIES) {
    const dir = join(root, cat)
    if (!existsSync(dir)) continue
    let files
    try { files = readdirSync(dir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const name = f.replace(/\.md$/, '')
      let provenance = null, autoCreated = false
      try {
        const head = readFileSync(join(dir, f), 'utf8').slice(0, 1000)
        const pm = head.match(/^provenance:\s*(.+)$/m)
        if (pm) provenance = pm[1].trim()
        if (/^auto_created:\s*true\b/m.test(head)) autoCreated = true
      } catch {}
      out.push({ category: cat, name, autoCreated, provenance })
    }
  }
  return out
}

/**
 * Listet alle Post-Files (Blog + Briefings + Inbox) mit Body.
 * Limit für Performance bei großen Vaults.
 */
export function collectPostFiles(vaultPath, opts = {}) {
  const limit = opts.limit || 1000
  const out = []
  for (const rel of POST_FOLDERS) {
    const dir = join(vaultPath, rel)
    if (!existsSync(dir)) continue
    let files
    try { files = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of files) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue
      out.push({ folder: rel, name: e.name, path: join(dir, e.name) })
      if (out.length >= limit) return out
    }
  }
  return out
}

/**
 * Zählt Mentions pro Entity-Name über alle Posts.
 * Nutzt Wikilinks `[[Name]]` und `[[Name|alias]]`.
 * Returnt Map<canonicalLowercase, count>.
 */
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/**
 * Welche Entity-Namen sind sicher für Plain-Text-Match?
 * Nur lange, spezifische Namen — keine generischen Tech-/Allerwelts-Begriffe.
 */
function eligibleForPlainTextMatch(name) {
  const lc = name.toLowerCase()
  if (lc.length < 5) return false
  if (PLAINTEXT_BLOCK.has(lc)) return false
  // Hat das Wort einen Buchstaben mit Sonderzeichen (Punkt, Bindestrich)?
  // → meist Domain oder Marken-Name, gut für Plain-Text-Match
  return true
}

export function countMentions(inventory, postFiles) {
  const knownLower = new Set(inventory.map(e => e.name.toLowerCase()))
  const counts = new Map()

  // Plain-Text-Match-Pattern vorbereiten (nur für lange, spezifische Namen)
  const plainTextEntities = inventory
    .filter(e => eligibleForPlainTextMatch(e.name))
    .map(e => ({ name: e.name, lc: e.name.toLowerCase(), re: new RegExp(`\\b${escapeRegex(e.name)}\\b`, 'i') }))

  for (const p of postFiles) {
    let content
    try { content = readFileSync(p.path, 'utf8') } catch { continue }
    const selfName = p.name.replace(/\.md$/, '').toLowerCase()
    const seen = new Set()  // pro File jede Entity nur 1× zählen

    // 1. Wikilinks (in allen scanned Folders)
    for (const m of content.matchAll(/\[\[([^\]|]+)/g)) {
      const target = m[1].trim().toLowerCase()
      if (!knownLower.has(target)) continue
      if (target === selfName) continue
      if (seen.has(target)) continue
      seen.add(target)
      counts.set(target, (counts.get(target) || 0) + 1)
    }

    // 2. Plain-Text-Match — NUR in PLAIN_TEXT_POST_FOLDERS, nicht in Entity-Notes
    //    (sonst würden Mentions-Bullets, frontmatter sources etc. zählen, was
    //    jede Entity über ihre eigene Note + Verwandt-Notes pumpen würde)
    const isPlainTextSource = PLAIN_TEXT_POST_FOLDERS.some(rel => p.folder === rel)
    if (isPlainTextSource) {
      // Body ohne YAML, sonst Frontmatter-Werte (source/author etc.) verfälschen
      const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
      for (const ent of plainTextEntities) {
        if (seen.has(ent.lc)) continue
        if (ent.lc === selfName) continue
        if (ent.re.test(body)) {
          seen.add(ent.lc)
          counts.set(ent.lc, (counts.get(ent.lc) || 0) + 1)
        }
      }
    }
  }
  return counts
}

/** Top-N Entities by Mention-Count. */
export function topMentioned(inventory, mentionCounts, n = 20) {
  return inventory
    .map(e => ({ ...e, mentionCount: mentionCounts.get(e.name.toLowerCase()) || 0 }))
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, n)
}

/** Entities mit 0 Mentions. */
export function findOrphanEntities(inventory, mentionCounts) {
  return inventory
    .filter(e => !mentionCounts.has(e.name.toLowerCase()))
    .map(e => ({ name: e.name, category: e.category, autoCreated: e.autoCreated, provenance: e.provenance }))
}

/**
 * Heuristik: sieht diese Phrase nach einem ECHTEN Eigennamen aus
 * (Person/Firma/Produkt/Ort) statt einem deutschen Allerweltswort am Satzanfang?
 *
 * Eigennamen-Indikatoren:
 *  1. Mehrwort (≥2 Token, jedes großgeschrieben): "Sam Altman", "Apple Inc"
 *  2. CamelCase / Großbuchstabe in der Mitte: "OpenAI", "ChatGPT", "McShark"
 *  3. Endung mit Firma-Suffix: GmbH, AG, KG, Inc, Ltd, Corp, Group, Studios
 *  4. Domain (enthält .com/.de/etc.)
 *
 * Single-Word ohne diese Marker: vermutlich generisches deutsches Substantiv → raus.
 */
export function looksLikeProperNoun(phrase) {
  if (!phrase || phrase.length < 4) return false
  // (1) Mehrwort
  if (phrase.includes(' ')) return true
  // (2) CamelCase: Großbuchstabe AUSSER am Anfang
  if (/[a-zäöüß][A-ZÄÖÜ]/.test(phrase)) return true
  // (3) Firma-Suffix
  if (/(GmbH|AG|KG|Inc|Ltd|Corp|Group|Studios|Labs|Tech|Software|Bros|Co)$/.test(phrase)) return true
  // (4) Domain
  if (/\.(com|de|at|net|org|io|ai|rocks|blog|news|info)$/i.test(phrase)) return true
  return false
}

/**
 * Findet großgeschriebene Phrasen die häufig in Posts vorkommen aber nicht im
 * Inventory sind — Kandidaten für neue Entities. Wendet Eigennamen-Heuristik +
 * Stopword-Filter an.
 *
 * minOccurrences: ab wie vielen Posts wird's ein Kandidat
 * sampleSize: wie viele Posts wir scannen (Performance)
 */
export function findEntityGaps(inventory, postFiles, opts = {}) {
  const minOcc = opts.minOccurrences || 4
  const sampleSize = Math.min(opts.sampleSize || 200, postFiles.length)
  const knownLower = new Set(inventory.map(e => e.name.toLowerCase()))
  const counts = new Map()    // candidate → Set<postFilename>
  const examples = new Map()  // candidate → first context snippets

  // Match: 1-3 großgeschriebene Tokens (jeder Token kann CamelCase enthalten wie
  // "OpenAI", "ChatGPT" oder all-caps Suffixe wie "AI", "GmbH").
  // looksLikeProperNoun filtert post-hoc auf echte Eigennamen.
  const RE = /\b([A-ZÄÖÜ][A-Za-zäöüßÄÖÜ]+(?:\s[A-ZÄÖÜ][A-Za-zäöüßÄÖÜ]+){0,2})\b/g

  // Tech-Generika und allgemeine Substantive die im deutschen großgeschrieben werden
  // aber KEINE Eigennamen sind — sollten nie als Lücken-Kandidaten auftauchen.
  const TECH_GENERIKA = new Set([
    'tool','tools','modell','modelle','prompt','prompts','anbieter','produkt','produkte',
    'system','systeme','anwendung','anwendungen','lösung','lösungen','feature','features',
    'version','versionen','release','update','updates','plattform','plattformen','service',
    'services','technologie','technologien','algorithmus','algorithmen','daten','datenbank',
    'datenbanken','schnittstelle','schnittstellen','interface','interfaces','code','codes',
    'agent','agents','agenten','assistent','assistenten','assistenz','chatbot','chatbots',
    'workflow','workflows','automation','automatisierung','pipeline','prozess','prozesse',
    'pattern','patterns','framework','frameworks','library','libraries','bibliothek',
    'integration','integrationen','api','apis','sdk','sdks','module','modul','komponente',
    'komponenten','provider','providers','endpoint','endpoints','client','clients','server',
    'cloud','dienst','dienste','funktion','funktionen','methode','methoden','konzept','konzepte',
    'ansatz','ansätze','strategie','strategien','vision','visionen','idee','ideen',
    'aufgabe','aufgaben','beispiel','beispiele','frage','fragen','antwort','antworten',
    'mensch','menschen','nutzer','nutzerin','user','team','teams','firma','firmen','unternehmen',
    'organisation','organisationen','community','communities','branche','branchen',
    'projekt','projekte','geschäft','geschäfte','arbeit','arbeiten','job','jobs',
    'ki','ai','llm','llms','gpt','agi'
  ])

  const sample = postFiles.slice(0, sampleSize)
  for (const p of sample) {
    let content
    try { content = readFileSync(p.path, 'utf8') } catch { continue }
    const seen = new Set()
    for (const m of content.matchAll(RE)) {
      const phrase = m[1]
      if (seen.has(phrase)) continue
      seen.add(phrase)
      const lc = phrase.toLowerCase()
      if (knownLower.has(lc)) continue
      if (isGermanStopword(phrase)) continue
      if (TECH_GENERIKA.has(lc)) continue
      const firstTok = lc.split(/\s+/)[0]
      if (TECH_GENERIKA.has(firstTok)) continue
      if (phrase.length < 4) continue
      // KERNFILTER: muss aussehen wie ein Eigenname (nicht deutsches Allerweltswort)
      if (!looksLikeProperNoun(phrase)) continue
      if (!counts.has(phrase)) counts.set(phrase, new Set())
      counts.get(phrase).add(p.name)
      if (!examples.has(phrase)) {
        // 80 Zeichen Kontext um das Match
        const idx = m.index || 0
        const ctx = content.slice(Math.max(0, idx - 30), idx + 80).replace(/\s+/g, ' ').trim()
        examples.set(phrase, ctx.slice(0, 110))
      }
    }
  }

  const out = []
  for (const [phrase, postSet] of counts) {
    if (postSet.size < minOcc) continue
    out.push({
      phrase,
      occurrences: postSet.size,
      example: examples.get(phrase) || ''
    })
  }
  out.sort((a, b) => b.occurrences - a.occurrences)
  return out.slice(0, 30)
}

/**
 * Findet Alias-Kandidaten: ähnliche Entity-Namen die evtl. zusammen gehören.
 *
 * Heuristik (konservativ — false-positives wie "Salzburg" ↔ "FC Red Bull Salzburg"
 * vermeiden):
 *   1. Eine Variante ist genau das erste Wort der anderen
 *      (z.B. "Mistral" + "Mistral AI" → echter Alias-Kandidat)
 *   2. Vorname-Pattern: kürzere Variante hat ein einzelnes Token, längere
 *      beginnt mit demselben Token + Leerzeichen (z.B. "Alex" + "Alex Januschewsky")
 *
 * Substring-Match in Mitte oder Ende wird NICHT mehr als Alias behandelt
 * (Stadt-Verein-Falle: "Salzburg" matcht nicht "FC Red Bull Salzburg").
 */
export function findAliasCandidates(inventory) {
  const byCategory = new Map()
  for (const e of inventory) {
    if (!byCategory.has(e.category)) byCategory.set(e.category, [])
    byCategory.get(e.category).push(e)
  }
  const out = []
  for (const [cat, ents] of byCategory) {
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        const a = ents[i].name
        const b = ents[j].name
        if (a.toLowerCase() === b.toLowerCase()) continue
        // Sortieren: shorter zuerst
        const [short, long] = a.length <= b.length ? [a, b] : [b, a]
        const shortLc = short.toLowerCase()
        const longLc = long.toLowerCase()
        if (shortLc.length < 3) continue
        // PREFIX-Pattern: longer beginnt mit shorter + Leerzeichen
        // → "Mistral" + "Mistral AI" ✓, aber "Salzburg" + "FC ... Salzburg" ✗
        if (longLc.startsWith(shortLc + ' ')) {
          // Wenn shorter ein einzelnes Token ist und longer mit shorter beginnt,
          // ist es ein echter Vorname-/Marken-Alias-Kandidat
          const isVornameAlias = !short.includes(' ')
          out.push({
            a: short, b: long, category: cat,
            reason: isVornameAlias ? `gleicher Vorname "${short}"` : 'Prefix-Überlapp'
          })
        }
      }
    }
  }
  return out.slice(0, 20)
}

/** Vault-Health-Stats. */
export function computeHealthStats(inventory, mentionCounts, postFiles) {
  const byCategory = {}
  for (const e of inventory) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1
  }
  const totalMentions = [...mentionCounts.values()].reduce((s, n) => s + n, 0)
  const mentionedCount = mentionCounts.size
  const orphanCount = inventory.length - mentionedCount
  const avgBacklinks = mentionedCount > 0 ? Math.round((totalMentions / mentionedCount) * 10) / 10 : 0

  return {
    totalEntities: inventory.length,
    byCategory,
    totalPosts: postFiles.length,
    totalMentions,
    mentionedCount,
    orphanCount,
    orphanRatio: inventory.length > 0 ? Math.round((orphanCount / inventory.length) * 100) : 0,
    avgBacklinksPerMentioned: avgBacklinks
  }
}

/**
 * Generiert konkrete Action-Vorschläge aus den Analyse-Ergebnissen.
 * Returns Array von { id, kind, description, payload, preselected }.
 * kind: 'trash' | 'create_stub' | 'merge'
 *
 * Aktionen sind preselected wenn sie ziemlich sicher sind (z.B. Vorname+Vollname Merge).
 * User kann jede einzelne in der UI deselect-en.
 */
export function buildCuratorActions({ vaultPath, orphans, gaps, aliases }) {
  const actions = []
  let n = 0
  const nid = () => `act_${Date.now().toString(36)}_${(++n).toString(36)}`

  // 1. Orphans → trash. NICHT preselected (User soll bewusst entscheiden).
  //    Aber: auto_created Orphans sind klare Trash-Kandidaten → preselected.
  for (const o of orphans) {
    const file = join(vaultPath, 'VINCI', o.category, o.name + '.md')
    actions.push({
      id: nid(),
      kind: 'trash',
      description: `[${o.category}] "${o.name}" — 0 Mentions${o.autoCreated ? ', auto_created' : ''}${o.provenance ? `, ${o.provenance}` : ''}`,
      payload: { file, name: o.name, category: o.category },
      preselected: !!o.autoCreated   // nur auto_created sind safe-default
    })
  }

  // 2. Lücken-Kandidaten → create_stub. Kategorie kommt aus dem LLM-Klassifizier
  //    (Personen/Firmen/Orte/Quellen). NICHT preselected — User entscheidet bewusst.
  for (const g of gaps) {
    const phrase = g.phrase.trim()
    if (!phrase || phrase.length < 4) continue
    if (isGermanStopword(phrase)) continue
    const cat = g.category || 'Firmen'
    actions.push({
      id: nid(),
      kind: 'create_stub',
      description: `Neue ${cat.replace(/n$/, '')}-Note "${phrase}" anlegen — ${g.occurrences} Posts erwähnen sie`,
      payload: { name: phrase, category: cat, firstSeen: g.example },
      preselected: false
    })
  }

  // 3. Alias-Pairs → merge. Vorname+Vollname-Match preselected (klare Aliase).
  //    Substring-Pairs nicht (z.B. "Mistral" vs "Mistral AI" — könnte beides legitim sein).
  for (const a of aliases) {
    const aFile = join(vaultPath, 'VINCI', a.category, a.a + '.md')
    const bFile = join(vaultPath, 'VINCI', a.category, a.b + '.md')
    // sourcePath = das kürzere (wird in target gemerged)
    const sourceShorter = a.a.length <= a.b.length
    const sourcePath = sourceShorter ? aFile : bFile
    const targetPath = sourceShorter ? bFile : aFile
    const sourceName = sourceShorter ? a.a : a.b
    const targetName = sourceShorter ? a.b : a.a
    actions.push({
      id: nid(),
      kind: 'merge',
      description: `Merge "${sourceName}" → "${targetName}" (${a.category}, ${a.reason})`,
      payload: { sourcePath, targetPath, sourceName, targetName, category: a.category },
      preselected: a.reason.includes('Vorname')
    })
  }

  return actions
}

/** Berechnet einen Health-Score 0-100. */
export function computeHealthScore(stats) {
  let score = 100
  // Zu viele Orphans → minus
  if (stats.orphanRatio > 60) score -= 30
  else if (stats.orphanRatio > 40) score -= 15
  else if (stats.orphanRatio > 20) score -= 5
  // Niedrige Mention-Frequenz pro Entity → minus
  if (stats.avgBacklinksPerMentioned < 1) score -= 10
  // Keine Entities → minus
  if (stats.totalEntities < 10) score -= 20
  return Math.max(0, score)
}

export function buildCuratorFrontmatter() {
  return [
    '---',
    `title: ${JSON.stringify('Vault-Curator-Report ' + localDateString())}`,
    `source: vinci-vault-curator`,
    `created: "${localISOString()}"`,
    `tags: [vault-curator, report, vinci-agent]`,
    `mentions: []`,
    '---'
  ].join('\n')
}

/** Baut den Daten-Block für den LLM-Prompt aus den Analyse-Ergebnissen. */
export function buildCuratorDataBlock({ stats, topMentions, orphans, gaps, aliases }) {
  const lines = []
  lines.push('## Vault-Stats')
  lines.push(`Entities total: ${stats.totalEntities}`)
  for (const [cat, n] of Object.entries(stats.byCategory)) lines.push(`- ${cat}: ${n}`)
  lines.push(`Posts gescannt: ${stats.totalPosts}`)
  lines.push(`Mentioned: ${stats.mentionedCount} (${100 - stats.orphanRatio}%)`)
  lines.push(`Orphans: ${stats.orphanCount} (${stats.orphanRatio}%)`)
  lines.push(`Ø Backlinks pro genutzter Entity: ${stats.avgBacklinksPerMentioned}`)
  lines.push('')

  lines.push(`## Top-Mentioned (${Math.min(topMentions.length, 20)})`)
  for (const t of topMentions.slice(0, 20)) {
    lines.push(`- [${t.category}] ${t.name}: ${t.mentionCount} Posts`)
  }
  lines.push('')

  lines.push(`## Verwaiste Entities (${orphans.length})`)
  for (const o of orphans.slice(0, 30)) {
    const flags = []
    if (o.autoCreated) flags.push('auto')
    if (o.provenance) flags.push(o.provenance)
    lines.push(`- [${o.category}] ${o.name}${flags.length ? ' ('+flags.join(',')+')' : ''}`)
  }
  if (orphans.length > 30) lines.push(`… +${orphans.length - 30} weitere`)
  lines.push('')

  lines.push(`## Lücken-Kandidaten (Phrasen häufig in Posts, aber keine Entity)`)
  if (gaps.length === 0) lines.push('(keine bei min. 4 Vorkommen)')
  for (const g of gaps.slice(0, 15)) {
    lines.push(`- "${g.phrase}" — ${g.occurrences} Posts. Beispiel: ${g.example}`)
  }
  lines.push('')

  lines.push(`## Alias-Kandidaten (${aliases.length})`)
  if (aliases.length === 0) lines.push('(keine offensichtlichen)')
  for (const a of aliases.slice(0, 15)) {
    lines.push(`- [${a.category}] "${a.a}" ↔ "${a.b}" — ${a.reason}`)
  }
  return lines.join('\n')
}

const SYSTEM_PROMPT = `Du bist VINCIs Vault-Curator-Sub-Agent. Aus den Vault-Analyse-Daten schreibst du einen kompakten Curator-Report mit konkreten Empfehlungen — auf Deutsch.

**WICHTIG — verfügbare Aktionen:**
VINCI kann genau drei Arten von Vault-Änderungen automatisch ausführen:
1. **Trash**: Entity-Note ins _quarantine/ verschieben (z.B. verwaiste auto_created-Stubs)
2. **Create-Stub**: Neue Firmen-Note für eine Lücke anlegen (provenance: vault-curator)
3. **Merge**: Zwei Notes in derselben Kategorie zusammenführen (kürzere → längere)

Andere Aktionen wie "verbinde X mit Y" oder "verknüpfe A mit B als Eltern-Firma" sind NICHT verfügbar — schlage sie nicht vor. Wenn du etwas Strukturelles erwähnst, mach klar dass das **manuelle** Arbeit wäre.

Format (Markdown, in dieser Reihenfolge):

# Vault-Curator-Report <Datum>

## Health-Score
🟢/🟡/🔴 X/100 — 1-2 Sätze warum.

## Was läuft gut
2-3 Sätze: welche Entities sind gut vernetzt, Cluster-Themen, etc.

## Was du angehen solltest
3-5 konkrete Empfehlungen, sortiert nach Hebel. Jede Empfehlung muss zu **trash/create_stub/merge** passen (sonst als "manuell" markieren).
Beispiele guter Empfehlungen:
- "Trashe 6 auto_created-Stubs (Apache, Demand, ...) — kein Mention in Posts, sind Reste vom alten Blog-Pass."
- "Lege Sam Altman als Person an — 23 Posts erwähnen ihn."

## Lücken-Vorschläge
3-5 Lücken-Kandidaten die wirklich Eigennamen sind. Begründe kurz (Häufigkeit + Kontext).
**STRENGE Regel:** Keine generischen Begriffe wie "Tool", "Modell", "Prompt", "Plattform", "KI-Tools", "KI-Modelle". Nur konkrete Eigennamen (Personen, Firmen, Produkte, Orte, Quellen).

## Alias-Hinweise
NUR aus der vorgegebenen Alias-Kandidaten-Liste vorschlagen. Niemals eigene Kombinationen erfinden (z.B. NICHT "Salzburg" + "FC Red Bull Salzburg" — das wären verschiedene Entitäten, nicht Aliase).

---

## Kurzfassung
2-3 Sätze. Wird gesprochen + im Chat angezeigt. Knapp, in Du-Form.

Stil: ehrlich, präzise, kein Marketing-Sprech. Wenn der Vault gesund aussieht, das ehrlich sagen statt Probleme zu erfinden.`

function extractKurzfassung(markdown) {
  const m = markdown.match(/##\s+Kurzfassung\s*\n([\s\S]+?)(?:\n##|$)/i)
  return m ? m[1].trim() : ''
}

/**
 * Schickt die heuristisch gefundenen Gap-Kandidaten an Gemini Flash und lässt
 * den klassifizieren: ist das ein echter Eigenname? Welche Kategorie?
 *
 * Returnt eine gefilterte Liste mit ergänzter `category`: Personen/Firmen/Orte/Produkte/Quellen.
 * Phrasen die der LLM als generisch erkennt werden komplett rausgekickt.
 */
export async function classifyGapsViaLLM(gaps, settings = {}) {
  if (!Array.isArray(gaps) || gaps.length === 0) return []
  const apiKey = settings.geminiApiKey
  if (!apiKey) return gaps.map(g => ({ ...g, category: 'Firmen' })) // fallback

  const phraseList = gaps.slice(0, 30).map((g, i) => `${i + 1}. "${g.phrase}" (${g.occurrences}× in Posts)`).join('\n')
  const prompt = `Du bist ein Entity-Klassifizierer für VINCI's Vault.
Aus einer Liste von Phrasen die häufig in deutschen Blog-Posts (über KI/Tech) vorkommen, sollst du entscheiden:
- ist das ein ECHTER Eigenname (Person/Firma/Produkt/Ort/Quelle) den man als Vault-Entity anlegen sollte?
- oder ein GENERISCHES deutsches Wort/Adverb/Adjektiv das im Satzanfang großgeschrieben war?

Antworte AUSSCHLIESSLICH mit JSON:
{"items":[{"i":1,"isProperNoun":true|false,"category":"Personen|Firmen|Produkte|Orte|Quellen","reason":"<5 worte>"}]}

KATEGORIEN:
- "Personen": echte Menschen (z.B. "Sam Altman")
- "Firmen": Unternehmen, Marken, Vereine (z.B. "Anthropic", "FC Bayern")
- "Produkte": Software/Hardware/Modelle (z.B. "Claude Sonnet", "iPhone")
- "Orte": Städte, Länder, Adressen (z.B. "Salzburg")
- "Quellen": News-Sites, Blogs, Domains (z.B. "futurezone")

isProperNoun: false bei:
- deutschen Substantiven/Verben/Adverbien (Werkzeug, Veröffentlicht, Hier, Kontext, Kontrolle, Marketing)
- generischen Tech-Begriffen (Tool, Modell, Prompt, Plattform)
- vagen Konzepten (Realität, Verantwortung, Verständnis, Intelligenz, Kreativität)

isProperNoun: true NUR bei konkreten Eigennamen.

Zu klassifizierende Phrasen:
${phraseList}`

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 3000, temperature: 0 }
    })
    const res = await model.generateContent(prompt)
    let text = (res?.response?.text?.() || '').trim()
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    let parsed
    try { parsed = JSON.parse(text) } catch {
      const m = text.match(/\{[\s\S]*\}/)
      if (m) try { parsed = JSON.parse(m[0]) } catch {}
    }
    if (!parsed?.items) return []

    const VALID_CATS = new Set(['Personen', 'Firmen', 'Produkte', 'Orte', 'Quellen'])
    const out = []
    for (const item of parsed.items) {
      if (!item.isProperNoun) continue
      const idx = (item.i || 0) - 1
      const gap = gaps[idx]
      if (!gap) continue
      let category = VALID_CATS.has(item.category) ? item.category : 'Firmen'
      // Produkte mappen wir auf Firmen (gibt im Vault keine Produkte-Kategorie)
      if (category === 'Produkte') category = 'Firmen'
      out.push({ ...gap, category, classifyReason: item.reason })
    }
    return out
  } catch (err) {
    console.warn('[VaultCurator] classifyGapsViaLLM failed:', err.message)
    return []   // bei Fehler lieber keine create_stub-Vorschläge als Müll
  }
}

// ── Agent-Run ────────────────────────────────────────────────────────────────

export async function runVaultCurator(params, ctx) {
  const settings = ctx?.settings || {}
  const apiKey = settings.geminiApiKey
  const vaultPath = settings.obsidian?.vaultPath
  if (!apiKey) throw new Error('Gemini API-Key fehlt (Settings → Dienste)')
  if (!vaultPath || !existsSync(vaultPath)) throw new Error('Vault-Pfad nicht gesetzt')

  ctx.logProgress?.('Lade Vault-Inventory…')
  const inventory = collectVaultInventory(vaultPath)
  const postFiles = collectPostFiles(vaultPath)
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  ctx.logProgress?.(`Zähle Mentions in ${postFiles.length} Posts…`)
  const mentions = countMentions(inventory, postFiles)
  const stats = computeHealthStats(inventory, mentions, postFiles)
  const score = computeHealthScore(stats)
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  ctx.logProgress?.('Analysiere Top-Mentions, Orphans, Lücken, Aliase…')
  const top = topMentioned(inventory, mentions, 20)
  const orphans = findOrphanEntities(inventory, mentions)
  const rawGaps = findEntityGaps(inventory, postFiles, { minOccurrences: 4, sampleSize: 300 })
  const aliases = findAliasCandidates(inventory)
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  // Zweite Filterstufe: LLM klassifiziert Eigennamen + Kategorie. Eliminiert
  // generische deutsche Substantive die durch die Regex-Heuristik kommen.
  ctx.logProgress?.(`Klassifiziere ${rawGaps.length} Lücken-Kandidaten via LLM…`)
  const gaps = rawGaps.length > 0
    ? await classifyGapsViaLLM(rawGaps, settings)
    : []
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  ctx.logProgress?.('Gemini formuliert Report…')
  const dataBlock = buildCuratorDataBlock({ stats, topMentions: top, orphans, gaps, aliases })
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { temperature: 0.3, maxOutputTokens: 8000 }
  })
  const userPrompt = `Datum: ${localDateLong()}
Health-Score (heuristisch): ${score}/100

Analyse-Daten:

${dataBlock}

Bitte den Report schreiben.`
  const llmRes = await model.generateContent(userPrompt)
  let markdown = (llmRes?.response?.text?.() || '').trim()
  if (!markdown) throw new Error('Gemini gab leere Antwort zurück')
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  const kurzfassung = extractKurzfassung(markdown) || markdown.split('\n').slice(0, 3).join(' ')

  // Vault-Note
  let vaultNote = null
  try {
    const dir = join(vaultPath, 'VINCI', 'Briefings', 'VaultCurator')
    mkdirSync(dir, { recursive: true })
    const date = localDateString()
    let path = join(dir, `${date}.md`)
    let n = 1
    while (existsSync(path)) { path = join(dir, `${date}-${n}.md`); n++ }
    const fm = buildCuratorFrontmatter()
    writeFileSync(path, `${fm}\n\n${markdown}\n`, 'utf8')
    vaultNote = path
  } catch (err) {
    console.warn('[VaultCurator] Vault-Write failed:', err.message)
  }

  // Action-Liste für interaktive Anwendung in der UI
  const actions = buildCuratorActions({ vaultPath, orphans, gaps, aliases })
  const preselectedCount = actions.filter(a => a.preselected).length

  const fullResult = {
    markdown,
    actions,
    stats,
    score
  }

  const enrichedSummary = `${kurzfassung}${actions.length > 0
    ? `\n\n📋 ${actions.length} konkrete Aktionen vorgeschlagen (${preselectedCount} vorausgewählt).`
    : ''}`

  return {
    result: fullResult,
    summary: enrichedSummary,
    vaultNote,
    _stats: stats,
    _score: score
  }
}

registerAgent({
  name: 'vault_curator',
  description: 'Vault-Analyse: Top-Mentions, Orphans, Lücken, Alias-Kandidaten, Health-Score',
  default_title: () => `Vault-Curator ${localDateString()}`,
  run: runVaultCurator
})
