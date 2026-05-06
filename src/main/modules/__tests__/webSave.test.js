import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { slugify, germanDate, saveToVaultImpl } from '../webSave.js'

describe('slugify', () => {
  it('lowercases and replaces non-ascii', () => {
    expect(slugify('Anthropic Veröffentlicht Claude 4.7')).toBe('anthropic-veroeffentlicht-claude-4-7')
  })
  it('handles umlauts and ß', () => {
    expect(slugify('Über Straße — Test')).toBe('ueber-strasse-test')
  })
  it('trims dashes and caps at 80 chars', () => {
    expect(slugify('---hello---')).toBe('hello')
    expect(slugify('a'.repeat(120)).length).toBe(80)
  })
  it('returns "untitled" for empty/garbage', () => {
    expect(slugify('')).toBe('untitled')
    expect(slugify('!!!')).toBe('untitled')
  })
})

describe('germanDate', () => {
  it('formats ISO date as German', () => {
    expect(germanDate('2026-05-06T19:45:12Z')).toMatch(/Mai 2026/)
  })
})

const V = join(tmpdir(), 'vinci-websave-test')
const ctx = (vault) => ({ settings: { obsidian: { vaultPath: vault } } })

describe('saveToVaultImpl', () => {
  beforeEach(() => {
    rmSync(V, { recursive: true, force: true })
    mkdirSync(join(V, 'VINCI/Firmen'), { recursive: true })
    writeFileSync(join(V, 'VINCI/Firmen/Anthropic.md'), '---\n---\n# Anthropic\n')
    writeFileSync(join(V, 'VINCI/Firmen/OpenAI.md'), '---\n---\n# OpenAI\n')
  })
  afterEach(() => rmSync(V, { recursive: true, force: true }))

  it('creates a note with proper frontmatter', async () => {
    const r = await saveToVaultImpl({
      title: 'Anthropic veröffentlicht Claude 4.7',
      summary: 'Anthropic hat heute Claude 4.7 vorgestellt mit verbesserter Tool-Use.',
      sources: ['https://anthropic.com/news/claude-4-7']
    }, ctx(V))
    expect(r.ok).toBe(true)
    const files = readdirSync(join(V, 'inbox/web'))
    expect(files.length).toBe(1)
    const c = readFileSync(join(V, 'inbox/web', files[0]), 'utf8')
    expect(c).toContain('source: web')
    expect(c).toContain('status: zu-sichten')
    expect(c).toContain('"https://anthropic.com/news/claude-4-7"')
    expect(c).toMatch(/# (\[\[)?Anthropic(\]\])? veröffentlicht Claude 4\.7/)
  })

  it('sets wikilinks to known entities', async () => {
    const r = await saveToVaultImpl({
      title: 'OpenAI vs Anthropic',
      summary: 'OpenAI und Anthropic kämpfen um die Marktposition.',
      sources: ['https://example.com/x']
    }, ctx(V))
    const filePath = r.path.startsWith('/') ? r.path : join(V, r.path)
    const c = readFileSync(filePath, 'utf8')
    expect(c).toContain('[[OpenAI]]')
    expect(c).toContain('[[Anthropic]]')
    expect(r.mentions).toBeGreaterThanOrEqual(2)
  })

  it('appends backlink to entity notes', async () => {
    await saveToVaultImpl({
      title: 'Anthropic Update',
      summary: 'Anthropic launched something.',
      sources: ['https://x.com/a']
    }, ctx(V))
    const ant = readFileSync(join(V, 'VINCI/Firmen/Anthropic.md'), 'utf8')
    expect(ant).toMatch(/Erwähnt in \[\[/)
  })

  it('rejects when title or sources missing', async () => {
    expect(await saveToVaultImpl({ title: 'X', summary: 'Y' }, ctx(V))).toHaveProperty('error')
    expect(await saveToVaultImpl({ title: '', summary: 'Y', sources: ['x'] }, ctx(V))).toHaveProperty('error')
  })

  it('handles same-day duplicate by appending suffix', async () => {
    const params = { title: 'Same Title', summary: 'a', sources: ['https://x.com/a'] }
    await saveToVaultImpl(params, ctx(V))
    await saveToVaultImpl(params, ctx(V))
    const files = readdirSync(join(V, 'inbox/web'))
    expect(files.length).toBe(2)
  })
})

import { webModule } from '../web.js'
describe('webModule', () => {
  it('registers both web_search and web_saveToVault tools', () => {
    const names = webModule.tools.map(t => t.name)
    expect(names).toContain('web_search')
    expect(names).toContain('web_saveToVault')
  })
})


