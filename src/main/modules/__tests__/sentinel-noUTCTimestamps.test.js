// SENTINEL: keine UTC-ISO-Stempel in Vault-Files-schreibenden Modulen.
//
// Schützt davor, dass jemand wieder `new Date().toISOString()` einbaut. Das gibt
// UTC zurück → Obsidian zeigt für Alex 2h falsche Zeit.
//
// Whitelist: telemetry.js darf weiter UTC verwenden (Logs sind maschinelles
// Format, ISO-UTC ist konsistenter für log-Aggregation). Aber für alles
// User-sichtbare (Vault, Job-Stempel) zwingen wir lokale Zeit via _localTime.js.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '../..')

// Files die KEINE UTC-Timestamps haben dürfen (sondern localISOString/localDateString)
const FORBIDDEN_FILES = [
  'modules/_jobQueue.js',
  'modules/_agents/researcher.js',
  'modules/_agents/briefing.js',
  'modules/webSave.js',
  'modules/_wikilinkEngine.js',
  'modules/blogImporter.js',
  'modules/obsidian.js',
  'modules/obsidianGraph.js',
  'modules/calendar.js',
  'modules/_vaultMigration.js',
  'modules/graphCleaner.js',
  'modules/_proactiveDaemons.js',
  'tasks.js'
]

const FORBIDDEN_PATTERN = /new\s+Date\s*\(\s*\)\s*\.\s*toISOString\s*\(/

describe('SENTINEL — keine UTC-ISO-Stempel in User-sichtbaren Modulen', () => {
  for (const rel of FORBIDDEN_FILES) {
    it(`${rel} verwendet localISOString/localDateString statt new Date().toISOString()`, () => {
      const content = readFileSync(join(ROOT, rel), 'utf8')
      const matches = content.match(FORBIDDEN_PATTERN)
      if (matches) {
        throw new Error(
          `${rel} enthält "new Date().toISOString()" — UTC! Stattdessen localISOString() oder localDateString() aus _localTime.js verwenden.`
        )
      }
    })
  }
})
