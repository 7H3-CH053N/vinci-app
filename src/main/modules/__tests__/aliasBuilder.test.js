import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { autoMergeAlias } from '../_aliasBuilder.js'

const ROOT = join(tmpdir(), 'vinci-alias-test')
const VAULT = ROOT
const PERS = join(VAULT, 'VINCI/Personen')
const QUAR = join(VAULT, 'VINCI/_quarantine')

describe('autoMergeAlias', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(PERS, { recursive: true })
  })
  afterEach(() => rmSync(ROOT, { recursive: true, force: true }))

  it('merges single-word file into multi-word file when both exist', () => {
    writeFileSync(join(PERS, 'Alex.md'), '---\n---\n# Alex\n\n- **27.04.2026** — Alex liebt Musik.\n')
    writeFileSync(join(PERS, 'Alex Januschewsky.md'), '---\n---\n# Alex Januschewsky\n\n- **20.04.2026** — Wohnt in Salzburg.\n')
    autoMergeAlias(VAULT, 'Alex Januschewsky')
    const merged = readFileSync(join(PERS, 'Alex Januschewsky.md'), 'utf8')
    expect(merged).toContain('Alex liebt Musik')
    expect(merged).toContain('Wohnt in Salzburg')
    expect(existsSync(join(PERS, 'Alex.md'))).toBe(false)
    expect(existsSync(join(QUAR, 'Personen/Alex.md'))).toBe(true)
    const aliases = JSON.parse(readFileSync(join(VAULT, 'VINCI/_aliases.json'), 'utf8'))
    expect(aliases['Alex Januschewsky']).toContain('Alex')
  })

  it('does nothing if single-word file does not exist', () => {
    writeFileSync(join(PERS, 'Alex Januschewsky.md'), '---\n---\n# Alex Januschewsky\n')
    autoMergeAlias(VAULT, 'Alex Januschewsky')
    expect(existsSync(join(PERS, 'Alex.md'))).toBe(false)
    expect(existsSync(join(QUAR, 'Personen/Alex.md'))).toBe(false)
  })

  it('does nothing for single-word names', () => {
    writeFileSync(join(PERS, 'Alex.md'), '---\n---\n# Alex\n')
    autoMergeAlias(VAULT, 'Alex')
    expect(existsSync(join(PERS, 'Alex.md'))).toBe(true)
  })
})
