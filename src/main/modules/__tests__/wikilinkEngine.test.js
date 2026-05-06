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
