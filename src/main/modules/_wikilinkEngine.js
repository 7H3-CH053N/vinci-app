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
