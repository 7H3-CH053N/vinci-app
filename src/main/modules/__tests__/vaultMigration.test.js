import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { planMigrationFromPaths } from '../_vaultMigration.js'

const ROOT = join(tmpdir(), 'vinci-mig-test')
const SRC  = join(ROOT, 'src/VINCI')
const DST  = join(ROOT, 'dst/VINCI')

describe('planMigrationFromPaths', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(SRC, { recursive: true })
    mkdirSync(DST, { recursive: true })
  })
  afterEach(() => rmSync(ROOT, { recursive: true, force: true }))

  it('proposes copy when target note does not exist', () => {
    mkdirSync(join(SRC, 'Personen'))
    writeFileSync(join(SRC, 'Personen/Toni.md'), '# Toni\n\n- **27.04.2026** — Toni ist 30.\n')
    const plan = planMigrationFromPaths([SRC], DST)
    expect(plan.proposals).toContainEqual(expect.objectContaining({
      kind: 'copy',
      from: expect.stringContaining('Toni.md'),
      to: expect.stringContaining('Personen/Toni.md')
    }))
  })

  it('proposes merge when target exists and bullets are unique', () => {
    mkdirSync(join(SRC, 'Personen'))
    mkdirSync(join(DST, 'Personen'))
    writeFileSync(join(SRC, 'Personen/Toni.md'),
      '# Toni\n\n- **27.04.2026** — Toni ist Alex Bruder.\n')
    writeFileSync(join(DST, 'Personen/Toni.md'),
      '# Toni\n\n- **20.04.2026** — Toni wohnt in Linz.\n')
    const plan = planMigrationFromPaths([SRC], DST)
    const merge = plan.proposals.find(p => p.kind === 'merge')
    expect(merge).toBeDefined()
    expect(merge.bullets_to_add).toBe(1)
  })

  it('skips bullet that token-overlaps existing one (>=70%)', () => {
    mkdirSync(join(SRC, 'Personen'))
    mkdirSync(join(DST, 'Personen'))
    writeFileSync(join(SRC, 'Personen/Toni.md'),
      '# Toni\n\n- **27.04.2026** — Toni ist Alex Bruder und arbeitet in Linz.\n')
    writeFileSync(join(DST, 'Personen/Toni.md'),
      '# Toni\n\n- **20.04.2026** — Toni ist Alex Bruder arbeitet Linz.\n')
    const plan = planMigrationFromPaths([SRC], DST)
    const merge = plan.proposals.find(p => p.kind === 'merge')
    expect(merge?.bullets_to_add ?? 0).toBe(0)
  })

  it('skips hidden directories and non-md files', () => {
    mkdirSync(join(SRC, '.obsidian'), { recursive: true })
    writeFileSync(join(SRC, '.obsidian/app.json'), '{}')
    writeFileSync(join(SRC, 'README.md'), '# readme')
    writeFileSync(join(SRC, 'logo.png'), 'binary')
    const plan = planMigrationFromPaths([SRC], DST)
    expect(plan.proposals.every(p => !String(p.from).includes('.obsidian'))).toBe(true)
    expect(plan.proposals.every(p => !String(p.from).endsWith('.png'))).toBe(true)
  })

  it('handles non-existent source paths gracefully', () => {
    const plan = planMigrationFromPaths(['/nope/nope'], DST)
    expect(plan.scanned).toBe(0)
    expect(plan.proposals).toEqual([])
  })
})
