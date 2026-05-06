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

function planFilePath() {
  const stamp = new Date().toISOString().slice(0, 10)
  const dir = join(homedir(), 'Library', 'Application Support', 'vinci')
  mkdirSync(dir, { recursive: true })
  return join(dir, `cleanup-plan-${stamp}.json`)
}

export function savePlan(plan) {
  const path = planFilePath()
  writeFileSync(path, JSON.stringify(plan, null, 2), 'utf8')
  return path
}

export function loadLatestPlan() {
  const dir = join(homedir(), 'Library', 'Application Support', 'vinci')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter(f => f.startsWith('cleanup-plan-') && f.endsWith('.json')).sort()
  if (!files.length) return null
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'))
}

function quarantineFile(vault, file, category) {
  const quarDir = join(vault, 'VINCI', '_quarantine', category)
  mkdirSync(quarDir, { recursive: true })
  const target = join(quarDir, basename(file))
  renameSync(file, target)
  return target
}

function bulletsOf(content) {
  return content.split('\n').filter(l => l.trim().startsWith('- '))
}

function updateAliasMap(vaultPath, canonicalName, alias) {
  const file = join(vaultPath, 'VINCI', '_aliases.json')
  let map = {}
  if (existsSync(file)) {
    try { map = JSON.parse(readFileSync(file, 'utf8')) } catch { map = {} }
  }
  if (!map[canonicalName]) map[canonicalName] = []
  if (!map[canonicalName].includes(alias)) map[canonicalName].push(alias)
  writeFileSync(file, JSON.stringify(map, null, 2), 'utf8')
}

export async function applyPlanLocal(vaultPath, plan) {
  const report = { applied: 0, skipped: 0, errors: [] }
  // Run kinds in order: alias → merge → recategorize → rename → trash
  // (aliases first so subsequent merges can use them; trash last so files aren't gone before they're inspected)
  const order = ['alias', 'merge', 'recategorize', 'rename', 'trash']
  for (const kind of order) {
    for (const p of plan.proposals.filter(x => x.kind === kind)) {
      if ('accepted' in p && p.accepted === false) { report.skipped++; continue }
      try {
        if (kind === 'trash') {
          if (existsSync(p.file)) quarantineFile(vaultPath, p.file, p.category)
        } else if (kind === 'recategorize' || kind === 'rename') {
          if (!existsSync(p.from)) continue
          mkdirSync(join(p.to, '..'), { recursive: true })
          renameSync(p.from, p.to)
        } else if (kind === 'merge') {
          if (!existsSync(p.into)) continue
          const target = readFileSync(p.into, 'utf8')
          const targetBullets = bulletsOf(target)
          const extra = []
          for (const src of p.from) {
            if (!existsSync(src)) continue
            const srcContent = readFileSync(src, 'utf8')
            const cat = basename(join(src, '..'))
            for (const b of bulletsOf(srcContent)) {
              if (!targetBullets.includes(b) && !extra.includes(b)) extra.push(b)
            }
            quarantineFile(vaultPath, src, cat)
          }
          if (extra.length) {
            const sep = target.endsWith('\n') ? '' : '\n'
            writeFileSync(p.into, target + sep + extra.join('\n') + '\n', 'utf8')
          }
          // Update _aliases.json so the alias is permanent
          if (p.alias && p.name) {
            updateAliasMap(vaultPath, p.name, p.alias)
          }
        } else if (kind === 'alias') {
          // Alias-only proposals are not yet generated by 5.2; reserved for future.
        }
        report.applied++
      } catch (err) {
        report.errors.push({ proposal: p, error: err.message })
      }
    }
  }
  return report
}

export async function applyPlan(vaultPath, plan, { dryRun = true } = {}) {
  if (dryRun) return { dryRun: true, would_apply: plan.proposals.filter(p => p.accepted !== false).length, skipped: plan.proposals.filter(p => p.accepted === false).length }
  // Real run: backup first
  const stamp = new Date().toISOString().slice(0, 10)
  const archiveDir = join(homedir(), '.vinci-archive')
  mkdirSync(archiveDir, { recursive: true })
  const graphDir = join(vaultPath, 'VINCI')
  if (existsSync(graphDir)) {
    await zipDirectory(graphDir, join(archiveDir, `cleanup-${stamp}.zip`))
  }
  return await applyPlanLocal(vaultPath, plan)
}
