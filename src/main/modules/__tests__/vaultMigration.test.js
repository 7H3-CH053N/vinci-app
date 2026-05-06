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

import { applyMigrationFromPlan, zipDirectory } from '../_vaultMigration.js'
import { existsSync as fsExists, readFileSync as fsReadFile } from 'fs'

describe('applyMigrationFromPlan', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(join(SRC, 'Personen'), { recursive: true })
    mkdirSync(join(DST, 'Personen'), { recursive: true })
  })
  afterEach(() => rmSync(ROOT, { recursive: true, force: true }))

  it('copy proposal creates target file with source content', async () => {
    writeFileSync(join(SRC, 'Personen/Neu.md'), '# Neu\n\n- New bullet\n')
    const plan = { proposals: [{ kind: 'copy', from: join(SRC, 'Personen/Neu.md'), to: join(DST, 'Personen/Neu.md') }] }
    const report = await applyMigrationFromPlan(plan, { dryRun: false })
    expect(fsExists(join(DST, 'Personen/Neu.md'))).toBe(true)
    expect(fsReadFile(join(DST, 'Personen/Neu.md'), 'utf8')).toContain('New bullet')
    expect(report.copied).toBe(1)
  })

  it('merge proposal appends only non-duplicate bullets', async () => {
    writeFileSync(join(SRC, 'Personen/Toni.md'), '# Toni\n\n- **27.04.2026** — Neue Info.\n')
    writeFileSync(join(DST, 'Personen/Toni.md'), '# Toni\n\n- **20.04.2026** — Alte Info.\n')
    const plan = { proposals: [{ kind: 'merge', from: join(SRC, 'Personen/Toni.md'), to: join(DST, 'Personen/Toni.md'), bullets_to_add: 1 }] }
    await applyMigrationFromPlan(plan, { dryRun: false })
    const merged = fsReadFile(join(DST, 'Personen/Toni.md'), 'utf8')
    expect(merged).toContain('Alte Info')
    expect(merged).toContain('Neue Info')
  })

  it('dry-run does not write files', async () => {
    writeFileSync(join(SRC, 'Personen/X.md'), '# X\n')
    const plan = { proposals: [{ kind: 'copy', from: join(SRC, 'Personen/X.md'), to: join(DST, 'Personen/X.md') }] }
    await applyMigrationFromPlan(plan, { dryRun: true })
    expect(fsExists(join(DST, 'Personen/X.md'))).toBe(false)
  })

  it('skips merge if all bullets are duplicates', async () => {
    writeFileSync(join(SRC, 'Personen/Same.md'), '# Same\n\n- Identische Bullet hier.\n')
    writeFileSync(join(DST, 'Personen/Same.md'), '# Same\n\n- Identische Bullet hier.\n')
    const plan = { proposals: [{ kind: 'merge', from: join(SRC, 'Personen/Same.md'), to: join(DST, 'Personen/Same.md'), bullets_to_add: 0 }] }
    const r = await applyMigrationFromPlan(plan, { dryRun: false })
    expect(r.merged).toBe(1)
    const after = fsReadFile(join(DST, 'Personen/Same.md'), 'utf8')
    expect((after.match(/Identische Bullet/g) || []).length).toBe(1)
  })
})
