import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadEntityInventory } from '../_wikilinkEngine.js'

const V = join(tmpdir(), 'vinci-inv-test')

beforeEach(() => {
  rmSync(V, { recursive: true, force: true })
  mkdirSync(join(V, 'VINCI/Personen'), { recursive: true })
  mkdirSync(join(V, 'VINCI/Firmen'), { recursive: true })
  mkdirSync(join(V, 'VINCI/Quellen'), { recursive: true })
  writeFileSync(join(V, 'VINCI/Personen/Alex Januschewsky.md'), '---\n---\n# Alex Januschewsky')
  writeFileSync(join(V, 'VINCI/Firmen/OpenAI.md'), '---\n---\n# OpenAI')
  writeFileSync(join(V, 'VINCI/Quellen/9to5google.com.md'), '---\n---\n# 9to5google.com')
  writeFileSync(join(V, 'VINCI/_aliases.json'), JSON.stringify({ 'Alex Januschewsky': ['Alex'] }))
})
afterEach(() => rmSync(V, { recursive: true, force: true }))

describe('loadEntityInventory', () => {
  it('returns canonical names from Personen/Firmen/Quellen', () => {
    const inv = loadEntityInventory(V)
    expect(inv.find(e => e.term === 'Alex Januschewsky' && e.canonical === 'Alex Januschewsky')).toBeDefined()
    expect(inv.find(e => e.term === 'OpenAI')).toBeDefined()
    expect(inv.find(e => e.term === '9to5google.com')).toBeDefined()
  })
  it('includes aliases mapping to canonical', () => {
    const inv = loadEntityInventory(V)
    expect(inv.find(e => e.term === 'Alex' && e.canonical === 'Alex Januschewsky')).toBeDefined()
  })
  it('sorts entries by term length descending (so longest matches first)', () => {
    const inv = loadEntityInventory(V)
    const lens = inv.map(e => e.term.length)
    const sortedDesc = [...lens].sort((a, b) => b - a)
    expect(lens).toEqual(sortedDesc)
  })
  it('skips notes in _quarantine and other non-entity folders', () => {
    mkdirSync(join(V, 'VINCI/_quarantine/Personen'), { recursive: true })
    writeFileSync(join(V, 'VINCI/_quarantine/Personen/Plus.md'), '---\n---\n# Plus')
    const inv = loadEntityInventory(V)
    expect(inv.find(e => e.term === 'Plus')).toBeUndefined()
  })
})
