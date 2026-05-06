// Body Wikilink engine — scans Markdown bodies, sets [[Wikilinks]] on first occurrence
// of each known entity (canonical name or alias), maintains mentions: in frontmatter,
// and appends backlink bullets to entity notes.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

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
