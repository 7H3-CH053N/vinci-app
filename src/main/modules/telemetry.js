// Lightweight structured logging for diagnostic events.
import { localISOString } from './_localTime.js'
// Schreibt JSONL nach ~/Library/Application Support/vinci/telemetry.log
// Rotiert bei 5 MB → telemetry.log.1 (eine Generation).
//
// Verwendung: logEvent('gemini_empty_stop', { finishReason, message }) etc.

import { existsSync, mkdirSync, appendFileSync, statSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DIR  = join(homedir(), 'Library', 'Application Support', 'vinci')
const FILE = join(DIR, 'telemetry.log')
const MAX  = 5 * 1024 * 1024 // 5 MB

let initialized = false
function ensureDir() {
  if (initialized) return
  try { mkdirSync(DIR, { recursive: true }) } catch {}
  initialized = true
}

function rotateIfNeeded() {
  try {
    const s = statSync(FILE)
    if (s.size > MAX) renameSync(FILE, FILE + '.1')
  } catch {}
}

export function logEvent(type, payload = {}) {
  ensureDir()
  rotateIfNeeded()
  const entry = {
    ts:   localISOString(),
    type,
    ...payload
  }
  try {
    appendFileSync(FILE, JSON.stringify(entry) + '\n', 'utf8')
  } catch (err) {
    console.warn('[Telemetry] write failed:', err.message)
  }
  // Mirror to console for live debugging
  console.log(`[TLM ${type}]`, JSON.stringify(payload).slice(0, 200))
}

// Helper: liest die letzten N Einträge zur Diagnose
import { readFileSync } from 'fs'
export function readRecent(n = 50) {
  if (!existsSync(FILE)) return []
  try {
    const lines = readFileSync(FILE, 'utf8').trim().split('\n')
    return lines.slice(-n).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}
