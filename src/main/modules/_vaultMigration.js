// One-shot migration of two orphan Mac-only vaults into the canonical vault.
// All operations are dry-run-safe. Real writes happen only when dryRun=false.

import { spawn } from 'child_process'
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join, basename, relative, dirname } from 'path'
import { homedir } from 'os'

// Beide Mac-Waisen-Vaults haben unterschiedliche Layouts:
// - Vaults/VINCI/        — Kategorien direkt im Root (Personen/, Firmen/, …)
// - Vaults/VINCI Wissen/ — Kategorien unter nested VINCI/-Subdir
const ORPHAN_VAULTS = [
  '/Users/alexjanuschewsky/Vaults/VINCI',
  '/Users/alexjanuschewsky/Vaults/VINCI Wissen/VINCI'
]
const ORPHAN_ROOTS = [
  '/Users/alexjanuschewsky/Vaults/VINCI',
  '/Users/alexjanuschewsky/Vaults/VINCI Wissen'
]

const STOP_TOKENS = new Set([
  'der','die','das','ein','eine','und','oder','ist','sind','war','waren',
  'in','an','am','auf','bei','mit','von','zu','zur','zum','aus','nach','für'
])

function tokenize(s) {
  return s.toLowerCase()
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[^\wäöüß ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_TOKENS.has(t))
}

function bulletsOf(content) {
  return content.split('\n').filter(l => l.trim().startsWith('- '))
}

function isBulletDuplicate(newBullet, existingBullets, threshold = 0.7) {
  const newTok = tokenize(newBullet)
  if (newTok.length === 0) return false
  for (const ex of existingBullets) {
    const exTok = new Set(tokenize(ex))
    if (exTok.size === 0) continue
    let overlap = 0
    for (const t of newTok) if (exTok.has(t)) overlap++
    if (overlap / newTok.length >= threshold) return true
  }
  return false
}

function walkMd(dir, base = dir) {
  const out = []
  if (!existsSync(dir)) return out
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) }
  catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === '_quarantine') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkMd(full, base))
    else if (e.isFile() && e.name.endsWith('.md')) out.push({ full, rel: relative(base, full) })
  }
  return out
}

export function planMigrationFromPaths(srcRoots, dstRoot) {
  const proposals = []
  let scanned = 0
  for (const src of srcRoots) {
    for (const file of walkMd(src)) {
      scanned++
      const dstPath = join(dstRoot, file.rel)
      if (!existsSync(dstPath)) {
        proposals.push({ kind: 'copy', from: file.full, to: dstPath })
        continue
      }
      const srcContent = readFileSync(file.full, 'utf8')
      const dstContent = readFileSync(dstPath, 'utf8')
      const dstBullets = bulletsOf(dstContent)
      const srcBullets = bulletsOf(srcContent)
      const newBullets = srcBullets.filter(b => !isBulletDuplicate(b, dstBullets))
      proposals.push({
        kind: 'merge',
        from: file.full,
        to: dstPath,
        bullets_to_add: newBullets.length,
        bullets_total_in_source: srcBullets.length
      })
    }
  }
  return { scanned, proposals }
}

export async function planMigration(canonicalVaultPath) {
  const dstRoot = join(canonicalVaultPath, 'VINCI')
  return planMigrationFromPaths(ORPHAN_VAULTS, dstRoot)
}

export async function applyMigrationFromPlan(plan, { dryRun = true } = {}) {
  const report = { copied: 0, merged: 0, errors: [] }
  for (const p of plan.proposals) {
    try {
      if (p.kind === 'copy') {
        if (!dryRun) {
          mkdirSync(join(p.to, '..'), { recursive: true })
          writeFileSync(p.to, readFileSync(p.from, 'utf8'))
        }
        report.copied++
      } else if (p.kind === 'merge') {
        if (!dryRun) {
          const src = readFileSync(p.from, 'utf8')
          const dst = readFileSync(p.to, 'utf8')
          const dstBullets = bulletsOf(dst)
          const toAdd = bulletsOf(src).filter(b => !isBulletDuplicate(b, dstBullets))
          if (toAdd.length) {
            const sep = dst.endsWith('\n') ? '' : '\n'
            writeFileSync(p.to, dst + sep + toAdd.join('\n') + '\n')
          }
        }
        report.merged++
      }
    } catch (err) {
      report.errors.push({ proposal: p, error: err.message })
    }
  }
  return report
}

// Nutzt macOS' eingebauten `zip` (BSD zip) — keine externe Dependency, keine Bundler-Sorgen.
export function zipDirectory(srcDir, outZip) {
  return new Promise((resolve, reject) => {
    if (!existsSync(srcDir)) return reject(new Error(`zipDirectory: srcDir nicht gefunden: ${srcDir}`))
    mkdirSync(dirname(outZip), { recursive: true })
    const child = spawn('zip', ['-rq', outZip, '.'], { cwd: srcDir })
    let stderr = ''
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', err => reject(err))
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`zip exited with code ${code}: ${stderr.trim()}`))
    })
  })
}

export async function applyMigration(canonicalVaultPath, plan, { dryRun = true } = {}) {
  if (!dryRun) {
    const archiveDir = join(homedir(), '.vinci-archive')
    mkdirSync(archiveDir, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 10)
    const vaultGraphDir = join(canonicalVaultPath, 'VINCI')
    if (existsSync(vaultGraphDir)) {
      await zipDirectory(vaultGraphDir, join(archiveDir, `${stamp}-pre-migration.zip`))
    }
  }
  const report = await applyMigrationFromPlan(plan, { dryRun })
  if (!dryRun) {
    const stamp = new Date().toISOString().slice(0, 10)
    const archiveTarget = join(homedir(), '.vinci-archive', `orphan-vaults-${stamp}`)
    mkdirSync(archiveTarget, { recursive: true })
    for (const orphan of ORPHAN_ROOTS) {
      if (existsSync(orphan)) {
        renameSync(orphan, join(archiveTarget, basename(orphan)))
      }
    }
  }
  return report
}
