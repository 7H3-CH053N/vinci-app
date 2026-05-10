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

import { applyWikilinks } from '../_wikilinkEngine.js'

describe('applyWikilinks', () => {
  const inventory = [
    { term: 'Alex Januschewsky', canonical: 'Alex Januschewsky' },
    { term: 'Alex',              canonical: 'Alex Januschewsky' },
    { term: 'OpenAI',            canonical: 'OpenAI' }
  ].sort((a, b) => b.term.length - a.term.length)

  it('links first occurrence only of each canonical', () => {
    const out = applyWikilinks('OpenAI rocks. OpenAI ftw.', inventory)
    expect(out.body).toBe('[[OpenAI]] rocks. OpenAI ftw.')
    expect(out.matched).toContain('OpenAI')
  })
  it('prefers longest match (Alex Januschewsky beats Alex)', () => {
    const out = applyWikilinks('Alex Januschewsky ist Autor.', inventory)
    expect(out.body).toContain('[[Alex Januschewsky]]')
  })
  it('uses display alias when matching a non-canonical term', () => {
    const out = applyWikilinks('Alex schreibt viel.', inventory)
    expect(out.body).toBe('[[Alex Januschewsky|Alex]] schreibt viel.')
  })
  it('does not double-link existing [[Wikilink]]', () => {
    const out = applyWikilinks('[[OpenAI]] und OpenAI', inventory)
    expect(out.body).toBe('[[OpenAI]] und OpenAI')
  })
  it('returns empty matched array when no entity present', () => {
    const out = applyWikilinks('Plain text only.', inventory)
    expect(out.matched).toEqual([])
    expect(out.body).toBe('Plain text only.')
  })
  it('respects word boundaries — does not link inside other words', () => {
    const out = applyWikilinks('OpenAItopia is not a thing.', inventory)
    expect(out.body).toBe('OpenAItopia is not a thing.')
  })
  it('counts each canonical only once even if multiple aliases match', () => {
    const out = applyWikilinks('Alex und Alex Januschewsky sind ein Mensch.', inventory)
    expect(out.matched).toEqual(['Alex Januschewsky'])
  })
})

import { processPostFile } from '../_wikilinkEngine.js'

describe('processPostFile', () => {
  it('updates body wikilinks and mentions in frontmatter', () => {
    const input = `---
title: "x"
mentions: []
---

OpenAI is great.`
    const inv = [{ term: 'OpenAI', canonical: 'OpenAI' }]
    const r = processPostFile(input, inv)
    expect(r.changed).toBe(true)
    expect(r.mentions).toEqual(['[[OpenAI]]'])
    expect(r.content).toContain('mentions: ["[[OpenAI]]"]')
    expect(r.content).toContain('[[OpenAI]] is great')
  })
  it('returns changed=false on second run (idempotent)', () => {
    const input = `---
title: "x"
mentions: ["[[OpenAI]]"]
---

[[OpenAI]] is great.`
    const inv = [{ term: 'OpenAI', canonical: 'OpenAI' }]
    const r = processPostFile(input, inv)
    expect(r.changed).toBe(false)
  })
  it('preserves other frontmatter keys', () => {
    const input = `---
title: "Title"
author: "[[Alex Januschewsky]]"
mentions: []
tags: [a, b]
---

OpenAI body.`
    const inv = [{ term: 'OpenAI', canonical: 'OpenAI' }]
    const r = processPostFile(input, inv)
    expect(r.content).toContain('title: "Title"')
    expect(r.content).toContain('author: "[[Alex Januschewsky]]"')
    expect(r.content).toContain('tags: [a, b]')
  })
  it('handles posts with no frontmatter', () => {
    const input = '# Plain\n\nOpenAI body.'
    const inv = [{ term: 'OpenAI', canonical: 'OpenAI' }]
    const r = processPostFile(input, inv)
    expect(r.changed).toBe(true)
    expect(r.content).toContain('[[OpenAI]]')
  })
})

import { appendBacklinkBullet } from '../_wikilinkEngine.js'

const V2 = join(tmpdir(), 'vinci-bl-test')

describe('appendBacklinkBullet', () => {
  beforeEach(() => {
    rmSync(V2, { recursive: true, force: true })
    mkdirSync(join(V2, 'VINCI/Firmen'), { recursive: true })
    writeFileSync(join(V2, 'VINCI/Firmen/OpenAI.md'), '---\n---\n# OpenAI\n\n')
  })
  afterEach(() => rmSync(V2, { recursive: true, force: true }))

  it('appends backlink if not present', () => {
    appendBacklinkBullet(V2, 'OpenAI', 'Firmen', '500-artikel')
    const c = readFileSync(join(V2, 'VINCI/Firmen/OpenAI.md'), 'utf8')
    expect(c).toContain('Erwähnt in [[500-artikel]]')
  })
  it('skips on duplicate (same slug)', () => {
    appendBacklinkBullet(V2, 'OpenAI', 'Firmen', '500-artikel')
    appendBacklinkBullet(V2, 'OpenAI', 'Firmen', '500-artikel')
    const c = readFileSync(join(V2, 'VINCI/Firmen/OpenAI.md'), 'utf8')
    expect((c.match(/Erwähnt in \[\[500-artikel\]\]/g) || []).length).toBe(1)
  })
  it('returns false if entity file does not exist', () => {
    expect(appendBacklinkBullet(V2, 'Nonexistent', 'Firmen', 'slug')).toBe(false)
  })
})

import { detectAutoFirmaCandidates, createAutoFirmaStub } from '../_wikilinkEngine.js'
import { existsSync as fsExistsSync, readFileSync as fsRead } from 'fs'

describe('detectAutoFirmaCandidates', () => {
  it('flags names appearing in N+ posts (custom threshold)', () => {
    const posts = [
      { slug: 'a', body: 'Mistral is interesting. Anthropic too.' },
      { slug: 'b', body: 'Mistral grows. Microsoft watches.' },
      { slug: 'c', body: 'Anthropic launches.' }
    ]
    const known = new Set(['openai'])
    const out = detectAutoFirmaCandidates(posts, known, 2)
    expect(out.has('Mistral')).toBe(true)
    expect(out.has('Anthropic')).toBe(true)
    expect(out.has('Microsoft')).toBe(false)
  })
  it('skips names already in known set', () => {
    const posts = [
      { slug: 'a', body: 'OpenAI is everywhere.' },
      { slug: 'b', body: 'OpenAI again.' }
    ]
    const known = new Set(['openai'])
    const out = detectAutoFirmaCandidates(posts, known, 2)
    expect(out.has('OpenAI')).toBe(false)
  })
  it('honors custom threshold', () => {
    const posts = [
      { slug: 'a', body: 'Mistral.' },
      { slug: 'b', body: 'Mistral.' },
      { slug: 'c', body: 'Mistral.' }
    ]
    const known = new Set()
    expect(detectAutoFirmaCandidates(posts, known, 2).has('Mistral')).toBe(true)
    expect(detectAutoFirmaCandidates(posts, known, 4).has('Mistral')).toBe(false)
  })
  it('rejects German stopwords (Aber, Abend, …) even when frequent', () => {
    const posts = Array.from({ length: 6 }, (_, i) => ({
      slug: `p${i}`,
      body: 'Aber das ist anders. Abend war schön. Achtung war wichtig.'
    }))
    const out = detectAutoFirmaCandidates(posts, new Set(), 2)
    expect(out.has('Aber')).toBe(false)
    expect(out.has('Abend')).toBe(false)
    expect(out.has('Achtung')).toBe(false)
  })
  it('rejects multi-word starting with stopword (e.g. "Aber Apple")', () => {
    const posts = Array.from({ length: 6 }, (_, i) => ({
      slug: `p${i}`,
      body: 'Aber Apple ist anders. Aber Microsoft auch.'
    }))
    const out = detectAutoFirmaCandidates(posts, new Set(), 2)
    expect(out.has('Aber Apple')).toBe(false)
    expect(out.has('Aber Microsoft')).toBe(false)
  })
  it('rejects very short single-token names (< 4 chars)', () => {
    const posts = Array.from({ length: 6 }, (_, i) => ({
      slug: `p${i}`,
      body: 'Am Mai war es heiß.'
    }))
    const out = detectAutoFirmaCandidates(posts, new Set(), 2)
    expect(out.has('Am')).toBe(false)
    expect(out.has('Mai')).toBe(false)
  })
})

const V3 = join(tmpdir(), 'vinci-stub-test')
describe('createAutoFirmaStub', () => {
  beforeEach(() => { rmSync(V3, { recursive: true, force: true }); mkdirSync(V3, { recursive: true }) })
  afterEach(() => rmSync(V3, { recursive: true, force: true }))

  it('creates a Firmen note with auto_created flag', () => {
    expect(createAutoFirmaStub(V3, 'Mistral', ['post-a', 'post-b'])).toBe(true)
    const c = fsRead(join(V3, 'VINCI/Firmen/Mistral.md'), 'utf8')
    expect(c).toContain('auto_created: true')
    expect(c).toContain('first_seen_in:')
    expect(c).toContain('[[post-a]]')
  })
  it('does not overwrite if file exists', () => {
    mkdirSync(join(V3, 'VINCI/Firmen'), { recursive: true })
    writeFileSync(join(V3, 'VINCI/Firmen/Mistral.md'), 'EXISTING')
    expect(createAutoFirmaStub(V3, 'Mistral', ['x'])).toBe(false)
    expect(fsRead(join(V3, 'VINCI/Firmen/Mistral.md'), 'utf8')).toBe('EXISTING')
  })
})
