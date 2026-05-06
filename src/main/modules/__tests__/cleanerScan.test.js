import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanVaultLocal } from '../graphCleaner.js'

const VAULT = join(tmpdir(), 'vinci-cleaner-scan')
const G = join(VAULT, 'VINCI')

function setup() {
  rmSync(VAULT, { recursive: true, force: true })
  for (const c of ['Personen','Themen','Orte','Firmen','Quellen','Tiere']) {
    mkdirSync(join(G, c), { recursive: true })
  }
}

describe('scanVaultLocal', () => {
  beforeEach(setup)
  afterEach(() => rmSync(VAULT, { recursive: true, force: true }))

  it('proposes trash for hard-rejected names', () => {
    writeFileSync(join(G, 'Personen/Plus.md'), '---\n---\n# Plus\n\n- bullet\n')
    writeFileSync(join(G, 'Themen/+436602660062.md'), '---\n---\n# +436602660062\n')
    writeFileSync(join(G, 'Themen/CPU.md'), '---\n---\n# CPU\n')
    const plan = scanVaultLocal(VAULT)
    expect(plan.proposals.filter(p => p.kind === 'trash').length).toBeGreaterThanOrEqual(3)
  })

  it('proposes recategorize for domain in non-Quellen folder', () => {
    writeFileSync(join(G, 'Themen/9to5google.com.md'), '---\n---\n# 9to5google.com\n')
    writeFileSync(join(G, 'Orte/digitalhandwerk.rocks.md'), '---\n---\n# digitalhandwerk.rocks\n')
    const plan = scanVaultLocal(VAULT)
    const recats = plan.proposals.filter(p => p.kind === 'recategorize')
    expect(recats.length).toBe(2)
    expect(recats.every(p => p.to.includes('/Quellen/'))).toBe(true)
  })

  it('proposes merge for first-name + full-name pair', () => {
    writeFileSync(join(G, 'Personen/Alex.md'), '---\n---\n# Alex\n\n- bullet1\n')
    writeFileSync(join(G, 'Personen/Alex Januschewsky.md'), '---\n---\n# Alex Januschewsky\n\n- bullet2\n')
    const plan = scanVaultLocal(VAULT)
    expect(plan.proposals).toContainEqual(expect.objectContaining({
      kind: 'merge',
      into: expect.stringContaining('Alex Januschewsky.md'),
      from: expect.arrayContaining([expect.stringContaining('Alex.md')])
    }))
  })

  it('skips clean notes (no proposal)', () => {
    writeFileSync(join(G, 'Personen/Tobias Januschewsky.md'), '---\n---\n# Tobias Januschewsky\n')
    writeFileSync(join(G, 'Firmen/OpenAI.md'), '---\n---\n# OpenAI\n')
    const plan = scanVaultLocal(VAULT)
    expect(plan.proposals).toEqual([])
    expect(plan.scanned).toBe(2)
  })

  it('does not propose recategorize when domain is already in Quellen', () => {
    writeFileSync(join(G, 'Quellen/9to5google.com.md'), '---\n---\n# 9to5google.com\n')
    const plan = scanVaultLocal(VAULT)
    expect(plan.proposals.filter(p => p.kind === 'recategorize')).toEqual([])
  })

  it('handles missing VINCI/ folder gracefully', () => {
    rmSync(G, { recursive: true, force: true })
    const plan = scanVaultLocal(VAULT)
    expect(plan).toEqual({ scanned: 0, proposals: [] })
  })
})
