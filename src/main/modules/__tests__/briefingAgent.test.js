import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  briefingDateStr, isoDate, buildDataBlock, extractKurzfassung,
  buildBriefingFrontmatter, uniqueBriefingPath
} from '../_agents/briefing.js'

describe('BriefingAgent — Date helpers', () => {
  it('briefingDateStr returns German weekday + day + month + year', () => {
    const s = briefingDateStr(new Date('2026-05-19T10:00:00'))
    expect(s).toMatch(/\d/) // contains digits
    expect(s).toMatch(/2026/)
  })
  it('isoDate returns YYYY-MM-DD', () => {
    expect(isoDate(new Date('2026-05-19T10:00:00Z'))).toBe('2026-05-19')
  })
})

describe('BriefingAgent — buildDataBlock', () => {
  it('formats all sections when data is present', () => {
    const block = buildDataBlock({
      weather: { temperature: 18, feelsLike: 17, condition: 'sonnig', todayMin: 12, todayMax: 22, todayCondition: 'sonnig' },
      calendarToday: { termine: ['09:00 Termin A', '14:00 Termin B'] },
      calendarTomorrow: { events: [{ start: '2026-05-20T10:00:00Z', title: 'Morgen-Termin' }] },
      reminders: [{ title: 'Aufgabe X', list: 'Inbox' }],
      mail: [{ from: 'foo@bar.com', subject: 'Hallo' }],
      news: [{ title: 'Schlagzeile', source: 'futurezone' }],
      strom: { currentW: 1500 }
    })
    expect(block).toContain('WETTER SALZBURG:')
    expect(block).toContain('18°C')
    expect(block).toContain('TERMINE HEUTE:')
    expect(block).toContain('09:00 Termin A')
    expect(block).toContain('TERMINE MORGEN:')
    expect(block).toContain('Morgen-Termin')
    expect(block).toContain('OFFENE AUFGABEN')
    expect(block).toContain('Aufgabe X')
    expect(block).toContain('UNGELESENE MAILS')
    expect(block).toContain('foo@bar.com')
    expect(block).toContain('NEWS')
    expect(block).toContain('Schlagzeile')
    expect(block).toContain('STROMVERBRAUCH JETZT: 1.50 kW')
  })

  it('uses fallback strings when sections are empty (null calendar = error)', () => {
    const block = buildDataBlock({})
    expect(block).toContain('WETTER SALZBURG: nicht verfügbar')
    // calendar = undefined → ehrliches Error-Signal statt fälschlich "keine Termine"
    expect(block).toContain('TERMINE HEUTE:\n(Kalender-Zugriff fehlgeschlagen')
    expect(block).toContain('TERMINE MORGEN:\n(Kalender-Zugriff fehlgeschlagen')
    expect(block).toContain('OFFENE AUFGABEN (Top 10):\n(keine)')
    expect(block).toContain('UNGELESENE MAILS (Top 5):\n(keine)')
    expect(block).toContain('NEWS (Top 6):\n(keine)')
    expect(block).not.toContain('STROMVERBRAUCH')
  })

  it('"keine Termine" nur bei explizit leeren termine-Arrays (kein Error)', () => {
    const block = buildDataBlock({
      calendarToday: { termine: [] },
      calendarTomorrow: { events: [] }
    })
    expect(block).toContain('TERMINE HEUTE:\n(keine Termine)')
    expect(block).toContain('TERMINE MORGEN:\n(keine Termine)')
    expect(block).not.toContain('fehlgeschlagen')
  })

  it('rendert Calendar-error-Feld ehrlich', () => {
    const block = buildDataBlock({
      calendarToday: { termine: [], error: 'TCC-Permission fehlt' },
      calendarTomorrow: { events: [], error: 'TCC-Permission fehlt' }
    })
    expect(block).toContain('TERMINE HEUTE:\n(Kalender-Zugriff fehlgeschlagen: TCC-Permission fehlt)')
    expect(block).toContain('TERMINE MORGEN:\n(Kalender-Zugriff fehlgeschlagen: TCC-Permission fehlt)')
  })

  it('handles weather.error gracefully', () => {
    const block = buildDataBlock({ weather: { error: 'API down' } })
    expect(block).toContain('WETTER SALZBURG: nicht verfügbar')
  })

  it('limits reminders/mails/news to configured caps', () => {
    const block = buildDataBlock({
      reminders: Array.from({ length: 20 }, (_, i) => ({ title: `r${i}` })),
      mail:      Array.from({ length: 20 }, (_, i) => ({ from: 'a', subject: `m${i}` })),
      news:      Array.from({ length: 20 }, (_, i) => ({ title: `n${i}` }))
    })
    expect((block.match(/- r\d+/g) || []).length).toBe(10)
    expect((block.match(/^- a: m\d+$/gm) || []).length).toBe(5)
    expect((block.match(/^- n\d+$/gm) || []).length).toBe(6)
  })
})

describe('BriefingAgent — extractKurzfassung', () => {
  it('finds the Kurzfassung section', () => {
    const md = `# Briefing
## Wetter
sonne
## Kurzfassung
Heute scheint die Sonne.
Du hast einen Termin.`
    expect(extractKurzfassung(md)).toMatch(/Heute scheint/)
  })

  it('returns empty when no Kurzfassung section', () => {
    expect(extractKurzfassung('# Briefing\nNur Text.')).toBe('')
  })

  it('handles Kurzfassung at end (no following section)', () => {
    const md = `## Wetter\nsonne\n## Kurzfassung\nKnapp und gut.`
    expect(extractKurzfassung(md)).toBe('Knapp und gut.')
  })
})

describe('BriefingAgent — Frontmatter + Path', () => {
  it('frontmatter contains required keys', () => {
    const fm = buildBriefingFrontmatter('2026-05-19')
    expect(fm).toContain('title: "Briefing 2026-05-19"')
    expect(fm).toContain('source: vinci-briefing')
    expect(fm).toContain('tags: [briefing, daily, vinci-agent]')
    expect(fm).toContain('mentions: []')
  })

  const DIR = join(tmpdir(), 'vinci-briefing-path-test')
  beforeEach(() => { rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true }) })
  afterEach(() => rmSync(DIR, { recursive: true, force: true }))

  it('uniqueBriefingPath returns base + suffixes on conflict', () => {
    expect(uniqueBriefingPath(DIR, '2026-05-19').endsWith('2026-05-19.md')).toBe(true)
    writeFileSync(join(DIR, '2026-05-19.md'), 'x')
    expect(uniqueBriefingPath(DIR, '2026-05-19').endsWith('2026-05-19-1.md')).toBe(true)
    writeFileSync(join(DIR, '2026-05-19-1.md'), 'x')
    expect(uniqueBriefingPath(DIR, '2026-05-19').endsWith('2026-05-19-2.md')).toBe(true)
  })
})

describe('BriefingAgent — registration', () => {
  it('registers the briefing agent on import', async () => {
    await import('../_agents/briefing.js')
    const { listAgents } = await import('../_subAgents.js')
    expect(listAgents().find(a => a.name === 'briefing')).toBeDefined()
  })
})
