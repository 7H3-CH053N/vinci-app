// Researcher Sub-Agent — Phase J6 Stufe 1.
//
// Workflow:
//   1. Web-Suche via Tavily (themen-getunt, frisch)
//   2. Synthese mit Gemini Flash → kompaktes Briefing in Markdown
//   3. Schreibt nach VINCI/Briefings/<datum>-<slug>.md im Vault, mit
//      Wikilink-Pass + Backlinks zu bekannten Entities
//
// Trigger-Beispiele für Stufe 4 (Intent-Router-Integration):
//   "brief mich zu Anthropic"
//   "recherchier was bei Mistral los ist"
//   "was tut sich bei Apple AI"

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { webModule } from '../web.js'
import { loadEntityInventory, processPostFile, appendBacklinkBullet } from '../_wikilinkEngine.js'
import { isGermanStopword } from '../_germanStopwords.js'
import { localISOString, localDateString } from '../_localTime.js'
import { registerAgent } from '../_subAgents.js'

// ── Pure Helpers (testbar ohne Network) ──────────────────────────────────────

export function slugifyTopic(topic) {
  return String(topic || 'briefing')
    .toLowerCase()
    .replace(/[äöüß]/g, m => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[m]))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'briefing'
}

export function formatSnippets(results) {
  return (results || [])
    .map((r, i) => `[${i + 1}] ${r.title || '(ohne Titel)'}\nURL: ${r.url}\n${r.content || ''}`)
    .join('\n\n')
}

export function buildBriefingFrontmatter(topic, sources) {
  return [
    '---',
    `title: ${JSON.stringify('Briefing: ' + topic)}`,
    `source: vinci-researcher`,
    `topic: ${JSON.stringify(topic)}`,
    `created: "${localISOString()}"`,
    `tags: [briefing, vinci-agent]`,
    `mentions: []`,
    'sources:',
    ...sources.map(u => `  - ${JSON.stringify(u)}`),
    '---'
  ].join('\n')
}

export function buildBriefingContent({ topic, briefing, sources }) {
  const fm = buildBriefingFrontmatter(topic, sources)
  const sourceList = sources.length
    ? '\n---\n## Recherche-Quellen\n' + sources.map((u, i) => `${i + 1}. ${u}`).join('\n') + '\n'
    : ''
  return `${fm}\n\n${briefing.trim()}\n${sourceList}`
}

export function uniqueBriefingPath(dir, date, slug) {
  let path = join(dir, `${date}-${slug}.md`)
  let n = 1
  while (existsSync(path)) {
    path = join(dir, `${date}-${slug}-${n}.md`)
    n++
  }
  return path
}

/**
 * Prüft ob ein Briefing-Text faktisch nichts zum Topic enthält. Erkennt Phrases
 * wie "keine Information zu X gefunden", "nicht in den Quellen enthalten",
 * "haben keinen Bezug zu X" etc.
 *
 * Tavily-Suche kann irreführend sein (z.B. "Midjourney V8" → V8-Motoren).
 * Wenn das LLM ehrlich erkennt dass nichts passt, soll der Researcher KEIN
 * Müll-Briefing im Vault anlegen.
 *
 * @returns {{ relevant: boolean, reason?: string }}
 */
export function checkBriefingRelevance(briefingMarkdown, topic) {
  const text = String(briefingMarkdown || '').toLowerCase()
  const topicLc = String(topic || '').toLowerCase()
  if (!text) return { relevant: false, reason: 'leerer briefing-text' }

  // Phrases die signalisieren dass die Quellen nichts zum Topic geliefert haben
  const NO_MATCH_PATTERNS = [
    /keine\s+information(?:en)?\s+(?:zu|über|zum thema)/i,
    /nicht\s+in\s+den\s+(?:vorliegenden|bereitgestellten|aktuellen)\s+(?:quellen|snippets)/i,
    /nicht\s+(?:in\s+den\s+)?(?:vorliegenden\s+)?(?:quellen|snippets)\s+enthalten/i,
    /snippets\s+(?:sind|haben)\s+(?:nicht|keinen)\s+(?:relevant|bezug|zusammen)/i,
    /haben\s+keinen\s+bezug\s+(?:zu|zum thema)/i,
    /aus\s+den\s+(?:vorliegenden|bereitgestellten)\s+quellen\s+(?:nicht|kann nicht)/i,
    /unklar\s+aus\s+den\s+(?:vorliegenden|bereitgestellten)/i,
    /^die\s+(?:vorliegenden|bereitgestellten)\s+snippets\s+(?:behandeln|enthalten|beziehen)/im
  ]
  for (const re of NO_MATCH_PATTERNS) {
    if (re.test(text)) {
      return { relevant: false, reason: `Briefing meldet selbst: keine Treffer zu "${topic}"` }
    }
  }
  // Topic sollte mindestens 1x im Body vorkommen — sonst hat der LLM ein
  // anderes Thema synthetisiert (Tavily-Suche off-topic)
  if (topicLc.length > 4 && !text.includes(topicLc)) {
    // Versuche auch tokenweise: mindestens 1 Token des Topics > 3 chars muss matchen
    const tokens = topicLc.split(/\s+/).filter(t => t.length > 3)
    const anyToken = tokens.some(t => text.includes(t))
    if (!anyToken) {
      return { relevant: false, reason: `Briefing erwähnt das Topic "${topic}" nirgends — Tavily lieferte off-topic Snippets` }
    }
  }
  return { relevant: true }
}

// Wörter, die in Topics typischerweise hinter dem Eigennamen stehen und nicht zur Entity gehören
const TRAILING_NOISE = new Set([
  'strategie', 'strategien', 'vision', 'roadmap', 'pläne', 'plan', 'plaene',
  'release', 'launch', 'update', 'news', 'modell', 'modelle',
  'aktien', 'aktie', 'umsatz', 'gewinn', 'konkurrenz',
  'in', 'im', 'am', 'um', 'für', 'fuer', 'mit', 'ohne', 'bei', 'von', 'vs', 'gegen', 'oder', 'und'
])

/**
 * Extrahiert aus einem Recherche-Topic den Entity-Kandidaten am Anfang.
 * Beispiele:
 *   "Mistral AI Strategie 2026"  → "Mistral AI"
 *   "OpenAI vs Anthropic"        → "OpenAI"
 *   "Apple AI 2026"              → "Apple AI"
 *   "Was tut sich bei Apple"     → "" (erstes Token "Was" ist Stopword)
 *   "Sam Altman Pläne"           → "Sam Altman"
 * Returnt null wenn keine sinnvolle Entity erkannt wird.
 */
export function extractEntityCandidate(topic) {
  const t = String(topic || '').trim()
  if (!t) return null
  const tokens = t.split(/\s+/)
  // Erstes Token muss großgeschrieben + kein Stopword sein
  const first = tokens[0]
  if (!first || !/^[A-ZÄÖÜ]/.test(first)) return null
  if (isGermanStopword(first)) return null

  const out = [first]
  for (let i = 1; i < tokens.length && out.length < 3; i++) {
    const tok = tokens[i]
    if (!tok) break
    if (/^\d/.test(tok)) break                          // 2026 etc.
    if (TRAILING_NOISE.has(tok.toLowerCase())) break    // "Strategie", "vs", "und"
    if (!/^[A-ZÄÖÜ]/.test(tok)) break                   // Lowercase ab hier nicht mehr Teil der Entity
    out.push(tok)
  }
  const candidate = out.join(' ').trim()
  if (candidate.length < 3) return null
  if (candidate.length > 50) return null
  return candidate
}

/**
 * Prüft, ob ein Kandidat schon im Vault existiert (case-insensitive, fuzzy via
 * Substring-Match in beide Richtungen — verhindert Doppelstubs wie
 * "Mistral" + "Mistral AI").
 */
export function entityExistsInInventory(candidate, inventory) {
  if (!candidate || !Array.isArray(inventory)) return false
  const c = candidate.toLowerCase()
  for (const e of inventory) {
    const name = String(e.canonical || '').toLowerCase()
    if (!name) continue
    if (name === c) return true
    // Substring in beide Richtungen — Mistral matched Mistral AI und umgekehrt
    if (name.includes(c) || c.includes(name)) return true
  }
  return false
}

/**
 * Legt einen Firmen-Stub für einen Recherche-Topic an.
 * Markiert mit `provenance: researcher` (NICHT `auto_created: true`), damit der
 * Aggressive-Cleaner sie nicht zusammen mit den Blog-Pass-Müll-Stubs trasht.
 */
export function createResearcherFirmaStub(vaultPath, name, briefingSlug) {
  const dir = join(vaultPath, 'VINCI', 'Firmen')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.md`)
  if (existsSync(file)) return { created: false, path: file, reason: 'exists' }
  const date = localDateString()
  const content = `---
source: VINCI
category: Firmen
created: ${date}
provenance: researcher
first_briefing: "${briefingSlug}"
---

# ${name}

*Stub angelegt durch den VINCI-Researcher beim ersten Briefing zu diesem Thema. Wird mit jeder weiteren Recherche durch Backlinks befüllt.*

## Erwähnungen

- Erwähnt in [[${briefingSlug}]]
`
  writeFileSync(file, content, 'utf8')
  return { created: true, path: file }
}

const SYSTEM_PROMPT = `Du bist VINCIs Researcher-Sub-Agent. Aus Web-Suche-Snippets schreibst du ein präzises, gut strukturiertes Briefing — auf Deutsch.

Format (markdown):
# <Titel>

## Kurzfassung
2-3 Sätze, was Sache ist.

## Kernpunkte
- Punkt 1 [1]
- Punkt 2 [2]
- Punkt 3 [1,3]
(3-6 Bullets, Quellen mit [n] referenzieren wo passend)

## Einordnung
1-3 Sätze, was das bedeutet / einordnet. Optional weglassen wenn nichts Klares dazu zu sagen ist.

Stil: präzise, knapp, deutsch, kein Marketing-Sprech, keine Floskeln. Wenn Quellen widersprüchlich sind, das benennen.

Wichtig: NUR was in den Snippets steht. Nichts hinzudichten. Wenn etwas unklar bleibt — ehrlich sagen ("unklar aus den vorliegenden Quellen").`

// ── Agent-Run (orchestriert Suche → Gemini → Vault) ──────────────────────────

export async function runResearcher(params, ctx) {
  const topic = String(params.topic || '').trim()
  if (!topic) throw new Error('Parameter topic fehlt')
  const depth = params.depth === 'deep' ? 'advanced' : 'basic'
  const count = params.depth === 'deep' ? 8 : 5

  const settings = ctx?.settings || {}
  const apiKey = settings.geminiApiKey
  if (!apiKey) throw new Error('Gemini API-Key fehlt (Settings → Dienste)')
  if (!settings.tavily?.apiKey) throw new Error('Tavily API-Key fehlt (Settings → Dienste)')

  // Schritt 1: Web-Suche
  // Topic-Parameter NICHT hart auf 'news' setzen — Tavily news-modus
  // priorisiert News-Domains die für Tech/AI-Recherchen oft irreführend sind
  // (z.B. "Midjourney V8" matchte V8-Motoren statt AI). web.js entscheidet
  // selbst via looksFresh-Heuristik.
  const looksNewsy = /\b(news|aktuell|neueste|heute|kürzlich|letzte\s+woche)\b/i.test(topic)
  ctx.logProgress?.(`Web-Suche zu "${topic}"…`)
  const searchRes = await webModule.actions.search(
    {
      query: topic,
      count,
      depth: depth === 'advanced' ? 'advanced' : 'basic',
      ...(looksNewsy ? { topic: 'news', time_range: 'week' } : { topic: 'general' }),
      ...(params.time_range ? { time_range: params.time_range } : {})
    },
    { settings }
  )
  if (searchRes?.error) throw new Error(`Suche fehlgeschlagen: ${searchRes.error}`)
  const results = searchRes?.results || []
  if (results.length === 0) throw new Error(`Keine Web-Treffer für "${topic}"`)
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  // Schritt 2: Gemini-Synthese
  ctx.logProgress?.(`${results.length} Treffer → Synthese mit Gemini Flash…`)
  const genAI = new GoogleGenerativeAI(apiKey)
  // maxOutputTokens generös wählen — Briefings bei depth=deep können lang werden.
  // Flash unterstützt bis 65k Output; 8k gibt Headroom auch für ausführliche Briefings.
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: params.depth === 'deep' ? 16000 : 8000
    }
  })
  const userPrompt = `Thema: ${topic}\n\nWeb-Snippets:\n\n${formatSnippets(results)}\n\nBitte das Briefing schreiben.`
  const llmRes = await model.generateContent(userPrompt)
  const finishReason = llmRes?.response?.candidates?.[0]?.finishReason || 'unknown'
  const briefing = (llmRes?.response?.text?.() || '').trim()
  if (!briefing) {
    throw new Error(`Gemini gab eine leere Antwort zurück (finishReason: ${finishReason})`)
  }
  // Warnung wenn Token-Limit erreicht — Briefing ist dann abgeschnitten
  let truncationNote = ''
  if (finishReason === 'MAX_TOKENS') {
    console.warn(`[Researcher] Briefing abgeschnitten (MAX_TOKENS), Topic: ${topic}`)
    truncationNote = '\n\n> ⚠ Hinweis: Antwort wurde am Token-Limit abgeschnitten. Für vollständige Recherche „Tiefer recherchieren" aktivieren oder Thema enger fassen.'
  }
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  // Schritt 2.5: Relevanz-Check — manchmal liefert Tavily off-topic Snippets
  // (z.B. "Midjourney V8" → V8-Motoren). Wenn der LLM ehrlich erkennt dass
  // nichts passt, kein Müll-Briefing in den Vault schreiben.
  const relevance = checkBriefingRelevance(briefing, topic)
  if (!relevance.relevant) {
    console.warn(`[Researcher] Relevanz-Check negativ: ${relevance.reason}`)
    return {
      result: briefing,
      summary: `Keine relevanten Treffer zu „${topic}" — ${relevance.reason}. Briefing NICHT im Vault gespeichert (probier präzisere Suchbegriffe).`,
      vaultNote: null
    }
  }

  // Schritt 3: Vault-Note (+ optional neue Firma-Stub)
  const vaultPath = settings.obsidian?.vaultPath
  let vaultNote = null
  let createdStubName = null
  if (vaultPath && existsSync(vaultPath)) {
    try {
      const date = localDateString()
      const slug = slugifyTopic(topic)
      const dir = join(vaultPath, 'VINCI', 'Briefings')
      mkdirSync(dir, { recursive: true })
      const path = uniqueBriefingPath(dir, date, slug)
      const briefingSlug = path.split('/').pop().replace(/\.md$/, '')
      const sources = results.map(r => r.url).filter(Boolean)

      // Optional: Topic-Entity als Firma-Stub anlegen, damit Wikilink-Pass sie findet
      const candidate = extractEntityCandidate(topic)
      if (candidate) {
        try {
          const invForCheck = loadEntityInventory(vaultPath)
          if (!entityExistsInInventory(candidate, invForCheck)) {
            const stubRes = createResearcherFirmaStub(vaultPath, candidate, briefingSlug)
            if (stubRes.created) {
              createdStubName = candidate
              ctx.logProgress?.(`Neue Firma-Stub angelegt: ${candidate}`)
            }
          }
        } catch (err) {
          console.warn('[Researcher] Stub-Erstellung fehlgeschlagen:', err.message)
        }
      }

      ctx.logProgress?.('Schreibe Briefing in Vault…')
      let content = buildBriefingContent({ topic, briefing: briefing + truncationNote, sources })

      // Wikilink-Pass — Inventory neu laden, damit der gerade erstellte Stub erfasst ist
      try {
        const inv = loadEntityInventory(vaultPath)
        const processed = processPostFile(content, inv)
        content = processed.content
        writeFileSync(path, content, 'utf8')
        for (const m of processed.mentions || []) {
          const canonical = m.replace(/^\[\[|\]\]$/g, '').split('|')[0]
          // Stub haben wir gerade selbst angelegt + den Backlink eingebaut → nicht doppelt
          if (canonical === createdStubName) continue
          const ie = inv.find(i => i.canonical === canonical)
          if (ie?.category && ie.category !== 'alias') {
            try { appendBacklinkBullet(vaultPath, canonical, ie.category, briefingSlug) } catch {}
          }
        }
      } catch {
        writeFileSync(path, content, 'utf8')
      }
      vaultNote = path
    } catch (err) {
      console.warn('[Researcher] Vault-Write failed:', err.message)
    }
  }

  const noteHint = vaultNote
    ? `Briefing in VINCI/Briefings/${vaultNote.split('/').pop()}`
    : 'Briefing erstellt (Vault nicht verfügbar)'
  const stubHint = createdStubName ? ` · neue Firma "${createdStubName}" angelegt` : ''

  return {
    result: briefing + truncationNote,
    summary: `Recherche zu "${topic}" fertig — ${noteHint}${stubHint}${truncationNote ? ' (am Token-Limit abgeschnitten)' : ''}`,
    vaultNote,
    createdStubName
  }
}

registerAgent({
  name: 'researcher',
  description: 'Recherchiert ein Thema im Web und legt ein Briefing im Vault an',
  default_title: (params) => `Recherche: ${params.topic || '???'}`,
  run: runResearcher
})
