// Apply-Helper für Vault-Curator-Actions.
//
// Nimmt eine Liste von Action-Objekten (aus runVaultCurator) + IDs der vom User
// ausgewählten Actions, führt sie atomar aus mit ZIP-Backup davor.
//
// Action-Kinds:
//   - 'trash':       Entity-File ins _quarantine/ verschieben
//   - 'create_stub': Neue Firmen-Stub anlegen (mit provenance: vault-curator)
//   - 'merge':       Source-Note ins Target mergen (Bullets übernehmen), Source quarantänen

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { localDateString, localISOString } from './_localTime.js'
import { zipDirectory } from './_vaultMigration.js'

function quarantineFile(vaultPath, file, category) {
  const quarDir = join(vaultPath, 'VINCI', '_quarantine', category)
  mkdirSync(quarDir, { recursive: true })
  const target = join(quarDir, basename(file))
  if (existsSync(target)) {
    // Bei Konflikt: Suffix
    let n = 1
    let p = target.replace(/\.md$/, `-${n}.md`)
    while (existsSync(p)) { n++; p = target.replace(/\.md$/, `-${n}.md`) }
    renameSync(file, p)
    return p
  }
  renameSync(file, target)
  return target
}

function bulletsOf(content) {
  return content.split('\n').filter(l => l.trim().startsWith('- '))
}

function createStubFile(vaultPath, name, category) {
  const dir = join(vaultPath, 'VINCI', category)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.md`)
  if (existsSync(file)) return { created: false, path: file, reason: 'exists' }
  const content = `---
source: VINCI
category: ${category}
created: ${localDateString()}
provenance: vault-curator
---

# ${name}

*Stub angelegt durch VINCI-Vault-Curator nach Lücken-Analyse. Wird mit weiterer Recherche oder manueller Bearbeitung gefüllt.*
`
  writeFileSync(file, content, 'utf8')
  return { created: true, path: file }
}

function mergeFiles(vaultPath, sourcePath, targetPath, category) {
  if (!existsSync(targetPath)) return { merged: false, error: 'target missing' }
  if (!existsSync(sourcePath)) return { merged: false, error: 'source missing' }
  const target = readFileSync(targetPath, 'utf8')
  const source = readFileSync(sourcePath, 'utf8')
  const targetBullets = bulletsOf(target)
  const extra = bulletsOf(source).filter(b => !targetBullets.includes(b))
  if (extra.length > 0) {
    const sep = target.endsWith('\n') ? '' : '\n'
    writeFileSync(targetPath, target + sep + extra.join('\n') + '\n', 'utf8')
  }
  quarantineFile(vaultPath, sourcePath, category)
  return { merged: true, extraBullets: extra.length }
}

/**
 * Wendet eine Liste von Curator-Actions an.
 * @param {string} vaultPath
 * @param {Array} actions — komplette Action-Liste (aus job.result.actions)
 * @param {string[]} selectedIds — IDs der vom User ausgewählten Actions
 * @param {object} [opts] — { dryRun: bool, skipBackup: bool }
 */
export async function applyCuratorActions(vaultPath, actions, selectedIds, opts = {}) {
  if (!existsSync(vaultPath)) return { error: 'Vault-Pfad ungültig' }
  const sel = new Set(selectedIds || [])
  const toApply = (actions || []).filter(a => sel.has(a.id))
  if (toApply.length === 0) return { ok: true, applied: 0, skipped: 0, results: [] }

  // Backup ZIP zuerst (es sei denn dryRun oder explizit übersprungen)
  let backupPath = null
  if (!opts.dryRun && !opts.skipBackup) {
    try {
      const archDir = join(homedir(), '.vinci-archive')
      mkdirSync(archDir, { recursive: true })
      backupPath = join(archDir, `curator-${localDateString()}-${Date.now()}.zip`)
      await zipDirectory(join(vaultPath, 'VINCI'), backupPath)
    } catch (err) {
      console.warn('[CuratorApply] Backup failed (proceed anyway):', err.message)
    }
  }

  const results = []
  for (const a of toApply) {
    try {
      if (opts.dryRun) {
        results.push({ id: a.id, kind: a.kind, dryRun: true, description: a.description })
        continue
      }
      if (a.kind === 'trash') {
        if (existsSync(a.payload.file)) {
          const moved = quarantineFile(vaultPath, a.payload.file, a.payload.category)
          results.push({ id: a.id, kind: 'trash', ok: true, moved })
        } else {
          results.push({ id: a.id, kind: 'trash', ok: false, error: 'file already gone' })
        }
      } else if (a.kind === 'create_stub') {
        const r = createStubFile(vaultPath, a.payload.name, a.payload.category)
        results.push({ id: a.id, kind: 'create_stub', ok: r.created, ...r })
      } else if (a.kind === 'merge') {
        const r = mergeFiles(vaultPath, a.payload.sourcePath, a.payload.targetPath, a.payload.category)
        results.push({ id: a.id, kind: 'merge', ok: r.merged, ...r })
      } else {
        results.push({ id: a.id, kind: a.kind, ok: false, error: 'unknown kind' })
      }
    } catch (err) {
      results.push({ id: a.id, kind: a.kind, ok: false, error: err.message })
    }
  }

  const applied = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok && !r.dryRun).length
  return {
    ok: true,
    applied,
    failed,
    dryRun: !!opts.dryRun,
    backupPath,
    results,
    ts: localISOString()
  }
}
