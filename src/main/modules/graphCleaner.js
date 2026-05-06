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

// Implemented in Task 5.2
export function scanVaultLocal(vaultPath) {
  throw new Error('not implemented')
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
