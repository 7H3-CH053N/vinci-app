// Body Wikilink engine — scans Markdown bodies, sets [[Wikilinks]] on first occurrence
import { localDateString } from './_localTime.js'
// of each known entity (canonical name or alias), maintains mentions: in frontmatter,
// and appends backlink bullets to entity notes.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { isGermanStopword } from './_germanStopwords.js'

const ENTITY_CATS = ['Personen', 'Firmen', 'Quellen']

export function loadEntityInventory(vaultPath) {
  const root = join(vaultPath, 'VINCI')
  const items = []
  for (const cat of ENTITY_CATS) {
    const dir = join(root, cat)
    if (!existsSync(dir)) continue
    let files
    try { files = readdirSync(dir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const name = f.replace(/\.md$/, '')
      items.push({ term: name, canonical: name, category: cat })
    }
  }
  // Aliases
  const aliasFile = join(root, '_aliases.json')
  if (existsSync(aliasFile)) {
    try {
      const data = JSON.parse(readFileSync(aliasFile, 'utf8'))
      for (const [canonical, aliases] of Object.entries(data)) {
        for (const a of (aliases || [])) {
          items.push({ term: a, canonical, category: 'alias' })
        }
      }
    } catch {}
  }
  return items.sort((a, b) => b.term.length - a.term.length)
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function applyWikilinks(body, inventory) {
  let text = body
  const matched = new Set()
  const linkedCanonicals = new Set()

  for (const entry of inventory) {
    if (linkedCanonicals.has(entry.canonical)) continue
    // If canonical already linked anywhere in text, mark and skip
    const existingRe = new RegExp(`\\[\\[${escapeRegex(entry.canonical)}(\\||\\]\\])`, 'g')
    if (existingRe.test(text)) {
      linkedCanonicals.add(entry.canonical)
      continue
    }
    const re = new RegExp(`(?<![\\[\\w])${escapeRegex(entry.term)}(?![\\w\\]])`, 'g')
    let replaced = false
    text = text.replace(re, (match, offset) => {
      // Skip if this position is inside an existing [[ ... ]]
      const before = text.slice(Math.max(0, offset - 100), offset)
      const lastOpen  = before.lastIndexOf('[[')
      const lastClose = before.lastIndexOf(']]')
      if (lastOpen > lastClose) return match
      if (replaced) return match
      replaced = true
      matched.add(entry.canonical)
      linkedCanonicals.add(entry.canonical)
      if (entry.term === entry.canonical) return `[[${entry.canonical}]]`
      return `[[${entry.canonical}|${entry.term}]]`
    })
  }
  return { body: text, matched: [...matched] }
}

function splitFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { fm: '', body: content, hasFm: false }
  return { fm: m[1], body: m[2], hasFm: true }
}

function setFmKey(fm, key, value) {
  const re = new RegExp(`^${key}:\\s*.*$`, 'm')
  if (re.test(fm)) return fm.replace(re, `${key}: ${value}`)
  return (fm.endsWith('\n') ? fm : fm + '\n') + `${key}: ${value}`
}

export function processPostFile(content, inventory) {
  const { fm, body, hasFm } = splitFrontmatter(content)
  const { body: newBody, matched } = applyWikilinks(body, inventory)
  // Also collect existing wikilinks already in body that match inventory canonicals
  const allCanon = new Set(matched)
  const canonSet = new Set(inventory.map(e => e.canonical))
  for (const m of newBody.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const target = m[1].trim()
    if (canonSet.has(target)) allCanon.add(target)
  }
  const sortedCanon = [...allCanon].sort()
  const wikilinkArr = sortedCanon.map(m => `"[[${m}]]"`).join(', ')
  const mentionsLine = `[${wikilinkArr}]`

  let newContent
  if (hasFm) {
    const newFm = setFmKey(fm, 'mentions', mentionsLine)
    newContent = `---\n${newFm}\n---\n${newBody}`
  } else {
    // Synthesize a minimal frontmatter for posts that lack one
    newContent = `---\nmentions: ${mentionsLine}\n---\n\n${newBody}`
  }

  return {
    content: newContent,
    changed: newContent !== content,
    mentions: sortedCanon.map(m => `[[${m}]]`)
  }
}

// Default threshold von 2 → 4 deutlich angehoben. 2 fängt zu viel deutschen
// Allgemeinwortschatz ein, der durch Großschreibung am Satzanfang aussieht wie ein
// Eigenname. Plus: deutsche Stopwords werden komplett ausgeschlossen.
export function detectAutoFirmaCandidates(processedPosts, knownEntities, threshold = 4) {
  // Heuristic: capitalized words / two-cap-tokens
  const RE = /\b([A-ZÄÖÜ][a-zäöüß]+(?:\s[A-ZÄÖÜ][a-zäöüß]+)?)\b/g
  const candidates = new Map()
  for (const post of processedPosts) {
    const seen = new Set()
    const body = post.body || ''
    for (const m of body.matchAll(RE)) {
      const name = m[1]
      if (knownEntities.has(name.toLowerCase())) continue
      // Deutsche Allerweltswörter raus — vor Allem erstes Token bei Mehrwort-Namen.
      // "Aber Apple", "Aber Vorsicht", "Abend Routine" etc. werden so eliminiert.
      if (isGermanStopword(name)) continue
      // Sehr kurze Single-Token-Namen sind unsicher (z.B. "Ab", "Am") — überspringen
      if (!name.includes(' ') && name.length < 4) continue
      if (seen.has(name)) continue
      seen.add(name)
      if (!candidates.has(name)) candidates.set(name, [])
      candidates.get(name).push(post.slug)
    }
  }
  const out = new Map()
  for (const [name, slugs] of candidates) {
    if (slugs.length >= threshold) out.set(name, slugs)
  }
  return out
}

export function createAutoFirmaStub(vaultPath, name, firstSeenIn) {
  const dir = join(vaultPath, 'VINCI', 'Firmen')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.md`)
  if (existsSync(file)) return false
  const content = `---
source: VINCI
category: Firmen
created: ${localDateString()}
auto_created: true
first_seen_in: [${firstSeenIn.slice(0, 3).map(s => `"[[${s}]]"`).join(', ')}]
---

# ${name}

`
  writeFileSync(file, content, 'utf8')
  return true
}

export function appendBacklinkBullet(vaultPath, entityName, category, postSlug) {
  const file = join(vaultPath, 'VINCI', category, `${entityName}.md`)
  if (!existsSync(file)) return false
  const content = readFileSync(file, 'utf8')
  const bullet = `- Erwähnt in [[${postSlug}]]`
  if (content.includes(bullet)) return false
  const sep = content.endsWith('\n') ? '' : '\n'
  writeFileSync(file, content + sep + bullet + '\n', 'utf8')
  return true
}
