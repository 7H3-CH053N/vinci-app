// Broken-Link-Cleaner — räumt kaputte Wikilinks in Blog-Posts auf.
//
// Hintergrund: Wenn Entity-Notes gelöscht oder quarantänisiert werden (z.B. via
// Aggressive-Cleanup), bleiben die `[[X]]`-Wikilinks in den Blog-Posts stehen.
// Obsidian zeigt diese als Ghost-Nodes im Graph an — bei 8358 gelöschten Stubs
// werden das tausende Ghost-Nodes.
//
// Was dieser Cleaner macht:
//   1. Inventory der existierenden Entities einsammeln (canonical + Aliase)
//   2. Alle .md-Files unter den angegebenen Ordnern scannen
//   3. Pro File: Wikilinks zu nicht-existierenden Targets unlinken:
//      `[[X]]`        → `X`         (plain text bleibt erhalten)
//      `[[X|alias]]`  → `alias`     (Anzeige-Text bleibt erhalten)
//   4. `mentions:`-Frontmatter-Liste aufräumen
//   5. File nur schreiben wenn etwas geändert wurde
//
// Returnt detaillierte Stats für UI-Feedback.

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { loadEntityInventory } from './_wikilinkEngine.js'

// Welche Ordner sollen gescannt werden (relativ zum Vault-Root)
const DEFAULT_SCAN_ROOTS = ['RSS', 'inbox', 'VINCI/Briefings']

function listMarkdownFiles(dir) {
  const out = []
  function walk(d) {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && e.name.endsWith('.md')) out.push(full)
    }
  }
  walk(dir)
  return out
}

/**
 * Build Set aller bekannten Entity-Namen (canonical + Aliase), case-insensitive.
 */
export function buildKnownTargetSet(vaultPath) {
  const inv = loadEntityInventory(vaultPath)
  const set = new Set()
  for (const e of inv) {
    if (e.canonical) set.add(String(e.canonical).toLowerCase())
    if (e.term && e.term !== e.canonical) set.add(String(e.term).toLowerCase())
  }
  return set
}

/**
 * Unlinkt kaputte Wikilinks in einem einzelnen File-Inhalt.
 * Pure Funktion — testbar ohne File-IO.
 * @returns { content, removed: number, brokenTargets: Set<string> }
 */
export function unlinkBrokenInContent(content, knownTargets) {
  let removed = 0
  const brokenTargets = new Set()

  // 1. Body-Wikilinks: [[Target]] oder [[Target|Alias]]
  //    Wir bearbeiten body + frontmatter komplett — Frontmatter `mentions:` wird
  //    separat unten gepatcht.
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/)
  const fmEnd = fmMatch ? fmMatch[0].length : 0
  const fm = fmMatch ? fmMatch[1] : ''
  const body = content.slice(fmEnd)

  const newBody = body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (full, target, alias) => {
    const t = String(target).trim()
    if (knownTargets.has(t.toLowerCase())) return full       // Target existiert → unverändert
    removed++
    brokenTargets.add(t)
    return alias ? alias : t                                  // Unlinken, Plain-Text bleibt
  })

  // 2. Frontmatter `mentions:` aufräumen
  //    Die Mentions-Liste sieht so aus: mentions: ["[[Foo]]", "[[Bar]]"]
  //    Oder einzeilig: mentions: []
  let newFm = fm
  const mentionsLineRe = /^mentions:\s*(\[.*\])$/m
  const ml = fm.match(mentionsLineRe)
  if (ml) {
    const arrText = ml[1]
    // Parse Items: "[[X]]" oder "[[X|alias]]"
    const items = [...arrText.matchAll(/"(?:\[\[)([^\]|]+)(?:\|[^\]]+)?(?:\]\])"/g)]
    const kept = items
      .map(m => m[1])
      .filter(name => knownTargets.has(String(name).toLowerCase()))
    const dropped = items.length - kept.length
    if (dropped > 0) {
      const newArr = `[${kept.map(n => `"[[${n}]]"`).join(', ')}]`
      newFm = fm.replace(mentionsLineRe, `mentions: ${newArr}`)
    }
  }

  const newContent = fmMatch ? `---\n${newFm}\n---\n${newBody}` : newBody
  return { content: newContent, removed, brokenTargets }
}

/**
 * Walk Vault + cleanup. Returns Report.
 * @param {object} opts
 *   - dryRun: bool — wenn true, nichts schreiben (default false)
 *   - roots:  string[] — Subfolder relativ zu vaultPath, default ['RSS','inbox','VINCI/Briefings']
 */
export function cleanupBrokenLinks(vaultPath, opts = {}) {
  if (!vaultPath || !existsSync(vaultPath)) {
    return { error: 'Vault-Pfad ungültig oder nicht existent' }
  }
  const roots = opts.roots || DEFAULT_SCAN_ROOTS
  const dryRun = !!opts.dryRun

  const known = buildKnownTargetSet(vaultPath)
  const stats = {
    dryRun,
    knownEntitiesCount: known.size,
    filesScanned: 0,
    filesChanged: 0,
    linksRemoved: 0,
    brokenTargetsSeen: new Set(),
    perRoot: {}
  }

  for (const root of roots) {
    const dir = join(vaultPath, root)
    if (!existsSync(dir)) {
      stats.perRoot[root] = { scanned: 0, changed: 0, removed: 0, skipped: 'folder not found' }
      continue
    }
    let rootScanned = 0, rootChanged = 0, rootRemoved = 0
    for (const file of listMarkdownFiles(dir)) {
      rootScanned++
      stats.filesScanned++
      let content
      try { content = readFileSync(file, 'utf8') } catch { continue }
      const { content: newContent, removed, brokenTargets } = unlinkBrokenInContent(content, known)
      if (removed > 0) {
        for (const t of brokenTargets) stats.brokenTargetsSeen.add(t)
        if (!dryRun) {
          try { writeFileSync(file, newContent, 'utf8') }
          catch (err) { console.warn('[BrokenLinkCleaner] write failed:', file, err.message); continue }
        }
        rootChanged++
        stats.filesChanged++
        rootRemoved += removed
        stats.linksRemoved += removed
      }
    }
    stats.perRoot[root] = { scanned: rootScanned, changed: rootChanged, removed: rootRemoved }
  }

  stats.brokenTargetsCount = stats.brokenTargetsSeen.size
  // Sample der Ghost-Targets für UI/Logging
  stats.brokenTargetsSample = [...stats.brokenTargetsSeen].slice(0, 30)
  delete stats.brokenTargetsSeen
  return stats
}
