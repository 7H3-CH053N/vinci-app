// One-shot cleaner for the existing knowledge graph.
// Three phases: scan (read-only) → review (UI) → apply (with backup).
//
// Proposal kinds:
// - 'merge'        — first-name file gets merged into full-name file
// - 'recategorize' — file moves between category folders (e.g. domain → Quellen)
// - 'trash'        — file moves to _quarantine/ (Hard-Rejected names)
// - 'rename'       — typo fix (e.g. lowercase ASCII typo from TTS)
// - 'alias'        — registers an alias entry without file moves

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { VALID_CATS, isDomain } from './_graphCategories.js'
import { isHardRejected, forceCategoryFor } from './obsidianGraph.js'
import { zipDirectory } from './_vaultMigration.js'

function listEntries(vault) {
  const root = join(vault, 'VINCI')
  const out = []
  if (!existsSync(root)) return out
  for (const cat of VALID_CATS) {
    const dir = join(root, cat)
    if (!existsSync(dir)) continue
    let files
    try { files = readdirSync(dir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      out.push({ category: cat, name: f.replace(/\.md$/, ''), full: join(dir, f) })
    }
  }
  return out
}

export function scanVaultLocal(vaultPath) {
  const entries = listEntries(vaultPath)
  if (entries.length === 0) return { scanned: 0, proposals: [] }
  const proposals = []
  const byNameLc = new Map(entries.map(e => [e.name.toLowerCase(), e]))

  for (const e of entries) {
    // Trash: hard-reject
    if (isHardRejected(e.name)) {
      proposals.push({
        kind: 'trash',
        file: e.full,
        category: e.category,
        name: e.name,
        reason: 'Name matched hard-reject filter (phone/email/date/tier/system/model-version)'
      })
      continue
    }
    // Recategorize: domain in wrong category
    const forced = forceCategoryFor(e.name, e.category)
    if (forced !== e.category) {
      proposals.push({
        kind: 'recategorize',
        from: e.full,
        to: e.full.replace(`/${e.category}/`, `/${forced}/`),
        name: e.name,
        from_category: e.category,
        to_category: forced,
        reason: forced === 'Quellen' ? 'News-Domain gehört in Quellen/' : `Force-cat → ${forced}`
      })
      continue
    }
    // Merge: first-name + full-name pair (only when current entry is the multi-word name)
    if (e.name.includes(' ')) {
      const firstWord = e.name.split(' ')[0]
      const partner = byNameLc.get(firstWord.toLowerCase())
      if (partner && partner.full !== e.full && partner.category === e.category) {
        proposals.push({
          kind: 'merge',
          from: [partner.full],
          into: e.full,
          name: e.name,
          alias: firstWord,
          reason: 'Vorname ist Alias des vollen Namens'
        })
      }
    }
  }
  return { scanned: entries.length, proposals }
}

// Implemented in Task 5.3
export function savePlan(plan) { throw new Error('not implemented') }
export function loadLatestPlan() { throw new Error('not implemented') }

// Implemented in Task 5.4
export async function applyPlanLocal(vaultPath, plan) {
  throw new Error('not implemented')
}
export async function applyPlan(vaultPath, plan, opts) {
  throw new Error('not implemented')
}
