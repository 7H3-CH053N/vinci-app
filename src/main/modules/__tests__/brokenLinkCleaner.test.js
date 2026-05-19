import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  unlinkBrokenInContent, buildKnownTargetSet, cleanupBrokenLinks
} from '../_brokenLinkCleaner.js'

describe('unlinkBrokenInContent — pure function', () => {
  const known = new Set(['apple', 'anthropic', 'alex januschewsky'])

  it('unlinkt unknown targets, behält Plain-Text', () => {
    const r = unlinkBrokenInContent('Aber [[Aber]] ist [[Apple]] besser.', known)
    expect(r.content).toBe('Aber Aber ist [[Apple]] besser.')
    expect(r.removed).toBe(1)
    expect([...r.brokenTargets]).toEqual(['Aber'])
  })

  it('behält [[Target|alias]] als alias-Text', () => {
    const r = unlinkBrokenInContent('Hi [[Unbekannt|Anzeige]] world', known)
    expect(r.content).toBe('Hi Anzeige world')
    expect(r.removed).toBe(1)
  })

  it('behält [[Target|alias]] unverändert wenn Target bekannt', () => {
    const r = unlinkBrokenInContent('[[Anthropic|sie]] sagten', known)
    expect(r.content).toBe('[[Anthropic|sie]] sagten')
    expect(r.removed).toBe(0)
  })

  it('case-insensitive matching', () => {
    const r = unlinkBrokenInContent('[[ANTHROPIC]] und [[apple]]', known)
    expect(r.removed).toBe(0)
  })

  it('mehrere broken in einem Text', () => {
    const r = unlinkBrokenInContent('[[Aber]] und [[Abend]] und [[Apple]]', known)
    expect(r.removed).toBe(2)
    expect(r.content).toBe('Aber und Abend und [[Apple]]')
  })

  it('räumt mentions-Frontmatter auf', () => {
    const input = `---
title: "Test"
mentions: ["[[Aber]]", "[[Apple]]", "[[Anthropic]]"]
---

Body [[Aber]] [[Apple]]`
    const r = unlinkBrokenInContent(input, known)
    expect(r.content).toContain('mentions: ["[[Apple]]", "[[Anthropic]]"]')
    expect(r.content).not.toContain('"[[Aber]]"')
    expect(r.content).toContain('Body Aber [[Apple]]')
  })

  it('lässt Posts ohne Frontmatter funktionieren', () => {
    const r = unlinkBrokenInContent('# Title\n\n[[Unknown]]', known)
    expect(r.content).toBe('# Title\n\nUnknown')
    expect(r.removed).toBe(1)
  })

  it('no-op für Files ohne Wikilinks', () => {
    const r = unlinkBrokenInContent('Plain text.', known)
    expect(r.content).toBe('Plain text.')
    expect(r.removed).toBe(0)
  })

  it('lässt mentions ohne broken links unangetastet', () => {
    const input = `---
mentions: ["[[Apple]]"]
---
[[Apple]]`
    const r = unlinkBrokenInContent(input, known)
    expect(r.content).toBe(input)
    expect(r.removed).toBe(0)
  })
})

describe('buildKnownTargetSet + cleanupBrokenLinks — integration', () => {
  const VAULT = join(tmpdir(), 'vinci-broken-link-test')

  beforeEach(() => {
    rmSync(VAULT, { recursive: true, force: true })
    mkdirSync(join(VAULT, 'VINCI/Personen'), { recursive: true })
    mkdirSync(join(VAULT, 'VINCI/Firmen'), { recursive: true })
    mkdirSync(join(VAULT, 'VINCI/Quellen'), { recursive: true })
    mkdirSync(join(VAULT, 'RSS/digitalhandwerk'), { recursive: true })
    mkdirSync(join(VAULT, 'inbox'), { recursive: true })
    writeFileSync(join(VAULT, 'VINCI/Personen/Alex Januschewsky.md'), '---\n---\n# Alex')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'), '---\n---\n# Apple')
    writeFileSync(join(VAULT, 'VINCI/Quellen/9to5google.com.md'), '---\n---\n# Quelle')
  })
  afterEach(() => rmSync(VAULT, { recursive: true, force: true }))

  it('buildKnownTargetSet sammelt canonical-Namen aus allen Entity-Folders', () => {
    const known = buildKnownTargetSet(VAULT)
    expect(known.has('apple')).toBe(true)
    expect(known.has('alex januschewsky')).toBe(true)
    expect(known.has('9to5google.com')).toBe(true)
    expect(known.has('aber')).toBe(false)
  })

  it('cleanupBrokenLinks räumt Posts in RSS auf + zählt korrekt', () => {
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/post1.md'),
      `---
mentions: ["[[Aber]]", "[[Apple]]"]
---
[[Aber]] und [[Apple]] in einem Post.`)
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/post2.md'),
      `---
mentions: ["[[Abend]]"]
---
[[Abend]] war [[Apple]] zugange.`)
    writeFileSync(join(VAULT, 'inbox/note.md'),
      `[[Aber]] [[Apple]]`)
    const r = cleanupBrokenLinks(VAULT)
    expect(r.error).toBeUndefined()
    expect(r.filesScanned).toBe(3)
    expect(r.filesChanged).toBe(3)
    expect(r.linksRemoved).toBe(3)
    expect(r.brokenTargetsCount).toBe(2)
    expect(new Set(r.brokenTargetsSample)).toEqual(new Set(['Aber', 'Abend']))
    // Datei prüfen
    const post1 = readFileSync(join(VAULT, 'RSS/digitalhandwerk/post1.md'), 'utf8')
    expect(post1).toContain('Aber und [[Apple]]')
    expect(post1).toContain('mentions: ["[[Apple]]"]')
    expect(post1).not.toContain('[[Aber]]')
  })

  it('dryRun ändert keine Files, returnt aber Stats', () => {
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/post1.md'),
      `[[Aber]] und [[Apple]]`)
    const before = readFileSync(join(VAULT, 'RSS/digitalhandwerk/post1.md'), 'utf8')
    const r = cleanupBrokenLinks(VAULT, { dryRun: true })
    const after = readFileSync(join(VAULT, 'RSS/digitalhandwerk/post1.md'), 'utf8')
    expect(after).toBe(before)
    expect(r.filesChanged).toBe(1)
    expect(r.linksRemoved).toBe(1)
    expect(r.dryRun).toBe(true)
  })

  it('handle fehlenden Vault-Pfad sauber', () => {
    const r = cleanupBrokenLinks('/nonexistent')
    expect(r.error).toBeTruthy()
  })

  it('ignoriert leere/nicht-existente Scan-Roots ohne Crash', () => {
    rmSync(join(VAULT, 'RSS'), { recursive: true })
    const r = cleanupBrokenLinks(VAULT)
    expect(r.filesScanned).toBeGreaterThanOrEqual(0)
    expect(r.perRoot.RSS.skipped).toBeTruthy()
  })

  it('akzeptiert custom roots', () => {
    mkdirSync(join(VAULT, 'custom'), { recursive: true })
    writeFileSync(join(VAULT, 'custom/x.md'), '[[Aber]]')
    const r = cleanupBrokenLinks(VAULT, { roots: ['custom'] })
    expect(r.filesChanged).toBe(1)
    expect(r.linksRemoved).toBe(1)
  })
})
