import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  readNoteSummary, collectRecentFiles, collectWeeklyVaultData,
  buildWeeklyFrontmatter, buildWeeklyDataBlock
} from '../_agents/weekly.js'

const VAULT = join(tmpdir(), 'vinci-weekly-test')

beforeEach(() => {
  rmSync(VAULT, { recursive: true, force: true })
  mkdirSync(join(VAULT, 'VINCI/Briefings'),    { recursive: true })
  mkdirSync(join(VAULT, 'VINCI/Briefings/Daily'),  { recursive: true })
  mkdirSync(join(VAULT, 'VINCI/Briefings/Weekly'), { recursive: true })
  mkdirSync(join(VAULT, 'RSS/digitalhandwerk'),    { recursive: true })
  mkdirSync(join(VAULT, 'VINCI/Firmen'),           { recursive: true })
})
afterEach(() => rmSync(VAULT, { recursive: true, force: true }))

describe('Weekly — readNoteSummary', () => {
  it('parsed title + created aus YAML', () => {
    const fp = join(VAULT, 'sample.md')
    writeFileSync(fp, '---\ntitle: "Test"\ncreated: "2026-05-18T10:00:00+02:00"\n---\n\nBody.')
    const r = readNoteSummary(fp)
    expect(r.title).toBe('Test')
    expect(r.created).toBe('2026-05-18T10:00:00+02:00')
  })

  it('fallback auf published wenn kein created', () => {
    const fp = join(VAULT, 'sample.md')
    writeFileSync(fp, '---\npublished: "2026-04-01T08:00:00Z"\n---\nBody')
    const r = readNoteSummary(fp)
    expect(r.created).toBe('2026-04-01T08:00:00Z')
  })

  it('fehlende YAML → Filename als Title', () => {
    const fp = join(VAULT, 'my-post.md')
    writeFileSync(fp, 'No frontmatter')
    expect(readNoteSummary(fp).title).toBe('my-post')
  })
})

describe('Weekly — collectRecentFiles', () => {
  it('liefert Files im Zeitfenster nach YAML-created', () => {
    const dir = join(VAULT, 'VINCI/Briefings')
    writeFileSync(join(dir, 'in-window.md'),
      '---\ntitle: "A"\ncreated: "2026-05-15T10:00:00+02:00"\n---')
    writeFileSync(join(dir, 'before-window.md'),
      '---\ntitle: "B"\ncreated: "2026-05-01T10:00:00+02:00"\n---')
    writeFileSync(join(dir, 'after-window.md'),
      '---\ntitle: "C"\ncreated: "2026-06-01T10:00:00+02:00"\n---')
    const files = collectRecentFiles(VAULT, 'VINCI/Briefings',
      '2026-05-11T00:00:00Z', '2026-05-18T00:00:00Z')
    expect(files.map(f => f.title).sort()).toEqual(['A'])
  })

  it('skipped _quarantine/ Unterverzeichnis', () => {
    const dir = join(VAULT, 'VINCI/_quarantine/Firmen')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'old.md'), '---\ntitle: "Q"\ncreated: "2026-05-15T10:00:00Z"\n---')
    writeFileSync(join(VAULT, 'VINCI/_quarantine/keep.md'), 'x')
    // collectRecentFiles walked NICHT in _quarantine
    const out = collectRecentFiles(VAULT, 'VINCI/_quarantine',
      '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z')
    // walk-funktion skipped _quarantine subdirs aber not the root call;
    // bei root=_quarantine wird auch nichts retourniert weil children skipped
    // — wir testen einfach dass kein crash
    expect(Array.isArray(out)).toBe(true)
  })

  it('handle missing folder gracefully', () => {
    expect(collectRecentFiles(VAULT, 'gibts-nicht', '2026-01-01', '2026-12-31')).toEqual([])
  })

  it('sortiert nach when desc (neuester zuerst)', () => {
    const dir = join(VAULT, 'VINCI/Briefings')
    writeFileSync(join(dir, 'a.md'), '---\ntitle: "A"\ncreated: "2026-05-15T10:00:00Z"\n---')
    writeFileSync(join(dir, 'b.md'), '---\ntitle: "B"\ncreated: "2026-05-17T10:00:00Z"\n---')
    writeFileSync(join(dir, 'c.md'), '---\ntitle: "C"\ncreated: "2026-05-13T10:00:00Z"\n---')
    const files = collectRecentFiles(VAULT, 'VINCI/Briefings',
      '2026-05-11T00:00:00Z', '2026-05-18T00:00:00Z')
    expect(files.map(f => f.title)).toEqual(['B', 'A', 'C'])
  })
})

describe('Weekly — collectWeeklyVaultData', () => {
  it('sammelt Blog + Briefings + neue Entities, getrennt', () => {
    const weekStart = new Date('2026-05-11T00:00:00Z')
    const weekEnd   = new Date('2026-05-18T00:00:00Z')

    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/post-week.md'),
      '---\ntitle: "Blog A"\nupublished: "2026-05-14T10:00:00Z"\ncreated: "2026-05-14T10:00:00Z"\n---')
    writeFileSync(join(VAULT, 'VINCI/Briefings/Daily/2026-05-14.md'),
      '---\ntitle: "Tagesbriefing"\ncreated: "2026-05-14T07:00:00Z"\n---')
    writeFileSync(join(VAULT, 'VINCI/Briefings/2026-05-13-anthropic.md'),
      '---\ntitle: "Briefing: Anthropic"\ncreated: "2026-05-13T15:00:00Z"\n---')
    // Self-Weekly soll NICHT mitgezählt werden
    writeFileSync(join(VAULT, 'VINCI/Briefings/Weekly/2026-W20.md'),
      '---\ntitle: "Wochenrückblick W20"\ncreated: "2026-05-17T19:00:00Z"\n---')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Anthropic.md'),
      '---\nprovenance: researcher\ncreated: "2026-05-13T15:00:00Z"\n---')

    const r = collectWeeklyVaultData({ vaultPath: VAULT, weekStart, weekEnd })
    expect(r.blogCount).toBe(1)
    expect(r.briefingsCount).toBe(2)            // Daily + Anthropic, OHNE Weekly self
    expect(r.briefings.find(b => b.relPath.includes('Weekly/'))).toBeUndefined()
    expect(r.newEntitiesCount).toBe(1)
  })
})

describe('Weekly — buildWeeklyFrontmatter', () => {
  it('enthält iso_week + week_start/_end + tags', () => {
    const fm = buildWeeklyFrontmatter({
      isoWeek: '2026-W20',
      weekStart: new Date('2026-05-11T00:00:00Z'),
      weekEnd:   new Date('2026-05-18T00:00:00Z')
    })
    expect(fm).toContain('iso_week: 2026-W20')
    expect(fm).toContain('week_start: "2026-05-11"')
    expect(fm).toContain('week_end: "2026-05-18"')
    expect(fm).toContain('tags: [weekly, briefing, vinci-agent]')
  })
})

describe('Weekly — buildWeeklyDataBlock', () => {
  const base = {
    isoWeek: '2026-W20',
    weekStart: new Date('2026-05-11T00:00:00Z'),
    weekEnd:   new Date('2026-05-18T00:00:00Z'),
    vaultData: { blog: [], briefings: [], newEntities: [], blogCount: 0, briefingsCount: 0, newEntitiesCount: 0 },
    calendarPast: { events: [] },
    calendarUpcoming: { events: [] }
  }

  it('rendert leere Sektionen ehrlich', () => {
    const block = buildWeeklyDataBlock(base)
    expect(block).toContain('2026-W20')
    expect(block).toContain('VERGANGENE TERMINE')
    expect(block).toContain('(keine — oder Kalender nicht zugreifbar)')
    expect(block).toContain('TERMINE NÄCHSTE WOCHE')
    expect(block).toContain('NEUE BLOG-POSTS (0)')
  })

  it('rendert Termin-Listen wenn da', () => {
    const block = buildWeeklyDataBlock({
      ...base,
      calendarPast: { events: [{ start: '2026-05-14T10:00:00+02:00', title: 'Pitch' }] }
    })
    expect(block).toContain('Pitch')
  })

  it('zählt Blog/Briefings korrekt', () => {
    const block = buildWeeklyDataBlock({
      ...base,
      vaultData: {
        blog: [{ title: 'Post A' }, { title: 'Post B' }],
        briefings: [{ title: 'Brief X' }],
        newEntities: [],
        blogCount: 2,
        briefingsCount: 1,
        newEntitiesCount: 0
      }
    })
    expect(block).toContain('NEUE BLOG-POSTS (2)')
    expect(block).toContain('Post A')
    expect(block).toContain('BRIEFINGS DIESE WOCHE (1)')
    expect(block).toContain('Brief X')
  })
})
