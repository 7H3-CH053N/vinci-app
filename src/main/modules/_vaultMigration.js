// One-shot migration of two orphan Mac-only vaults into the canonical vault.
// All operations are dry-run-safe. Real writes happen only when dryRun=false.

import archiver from 'archiver'
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, createWriteStream } from 'fs'
import { join, basename, relative } from 'path'
import { homedir } from 'os'

const ORPHAN_VAULTS = [
  '/Users/alexjanuschewsky/Vaults/VINCI/VINCI',
  '/Users/alexjanuschewsky/Vaults/VINCI Wissen/VINCI'
]
const ORPHAN_ROOTS = [
  '/Users/alexjanuschewsky/Vaults/VINCI',
  '/Users/alexjanuschewsky/Vaults/VINCI Wissen'
]

// Implemented in Task 3.2
export function planMigrationFromPaths(srcRoots, dstRoot) {
  throw new Error('not implemented')
}
export async function planMigration(canonicalVaultPath) {
  const dstRoot = join(canonicalVaultPath, 'VINCI')
  return planMigrationFromPaths(ORPHAN_VAULTS, dstRoot)
}

// Implemented in Task 3.3
export async function applyMigrationFromPlan(plan, opts) {
  throw new Error('not implemented')
}
export function zipDirectory(srcDir, outZip) {
  throw new Error('not implemented')
}
export async function applyMigration(canonicalVaultPath, plan, opts) {
  throw new Error('not implemented')
}
