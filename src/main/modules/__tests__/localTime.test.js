import { describe, it, expect } from 'vitest'
import { localISOString, localDateString, localTimeString, localDateLong, localISOWeek, startOfISOWeek } from '../_localTime.js'

// Bezug: 2026-05-19T19:00:00Z = 2026-05-19 21:00 in Vienna (Sommerzeit, +02:00)
const SUMMER = new Date('2026-05-19T19:00:00Z')

// Bezug: 2026-01-15T12:00:00Z = 2026-01-15 13:00 in Vienna (Winterzeit, +01:00)
const WINTER = new Date('2026-01-15T12:00:00Z')

describe('localISOString — Europe/Vienna', () => {
  it('Sommer: +02:00 Offset, lokale Zeit', () => {
    const s = localISOString(SUMMER)
    expect(s).toBe('2026-05-19T21:00:00.000+02:00')
  })

  it('Winter: +01:00 Offset', () => {
    const s = localISOString(WINTER)
    expect(s).toBe('2026-01-15T13:00:00.000+01:00')
  })

  it('format matched ISO-8601 mit Millisekunden + Offset', () => {
    expect(localISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  })

  it('endet NIE mit "Z" (das wäre UTC, falsch)', () => {
    expect(localISOString(SUMMER)).not.toMatch(/Z$/)
    expect(localISOString(WINTER)).not.toMatch(/Z$/)
  })
})

describe('localDateString', () => {
  it('Sommer-Datum lokal', () => {
    expect(localDateString(SUMMER)).toBe('2026-05-19')
  })
  it('Winter-Datum lokal', () => {
    expect(localDateString(WINTER)).toBe('2026-01-15')
  })
  it('Tageswechsel: 23:00 UTC = 01:00 Vienna nächster Tag', () => {
    const lateNight = new Date('2026-05-19T23:00:00Z')
    expect(localDateString(lateNight)).toBe('2026-05-20')
  })
})

describe('localTimeString', () => {
  it('Sommer: 19:00 UTC → 21:00 lokal', () => {
    expect(localTimeString(SUMMER)).toBe('21:00')
  })
  it('Winter: 12:00 UTC → 13:00 lokal', () => {
    expect(localTimeString(WINTER)).toBe('13:00')
  })
})

describe('localDateLong', () => {
  it('schreibt Wochentag + Monat aus', () => {
    const s = localDateLong(SUMMER)
    expect(s).toContain('Mai')
    expect(s).toContain('2026')
  })
})

describe('localISOWeek', () => {
  it('liefert ISO-Wochennummer im Format YYYY-Wnn', () => {
    expect(localISOWeek(new Date('2026-05-19T10:00:00Z'))).toMatch(/^\d{4}-W\d{2}$/)
  })
  it('Dienstag 19. Mai 2026 = KW21', () => {
    expect(localISOWeek(new Date('2026-05-19T10:00:00Z'))).toBe('2026-W21')
  })
  it('Sonntag 17. Mai 2026 = KW20 (Vienna)', () => {
    // 2026-05-17 12:00 UTC = 14:00 Vienna (Sommerzeit, Sonntag) → KW20
    expect(localISOWeek(new Date('2026-05-17T12:00:00Z'))).toBe('2026-W20')
  })

  it('Montag 18. Mai 2026 = KW21 (Vienna, Wochenwechsel)', () => {
    expect(localISOWeek(new Date('2026-05-18T08:00:00Z'))).toBe('2026-W21')
  })
})

describe('startOfISOWeek', () => {
  it('Montag 0:00 als Start', () => {
    const start = startOfISOWeek(new Date('2026-05-19T18:00:00Z'))  // Di
    expect(start.getUTCDay()).toBe(1)  // Montag
    expect(start.toISOString().slice(0,10)).toBe('2026-05-18')
  })
})
