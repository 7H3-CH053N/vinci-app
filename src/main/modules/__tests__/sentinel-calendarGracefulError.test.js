// SENTINEL: calendar-graceful-error
//
// Schützt vor dem Bug von heute: Calendar.getToday hat geworfen wenn AppleScript
// failt (TCC-Permission im Dev-Mode), Briefing sah `undefined` und behauptete
// fälschlich "keine Termine".
//
// Erwartung: getToday + getEventsRaw werfen NIE, sondern geben bei Fehler ein
// Objekt mit `error`-Feld zurück. So kann das UI / Briefing das ehrlich rendern.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// child_process mocken — alles failt, simuliert TCC-Denial + icalBuddy-Fehler
vi.mock('child_process', () => ({
  exec: (cmd, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb
    callback?.(new Error('TCC permission denied (simulated)'), '', 'No calendars')
  },
  execSync: () => { throw new Error('TCC denied') }
}))

beforeEach(() => vi.clearAllMocks())

describe('SENTINEL — calendar.getToday graceful error', () => {
  it('returnt {termine:[], error} statt zu throwen wenn icalBuddy + AppleScript versagen', async () => {
    const { calendarModule } = await import('../calendar.js')
    const result = await calendarModule.actions.getToday()
    expect(result).toBeDefined()
    expect(Array.isArray(result.termine)).toBe(true)
    expect(result.termine.length).toBe(0)
    expect(result.error).toBeTruthy()
    expect(String(result.error).toLowerCase()).toMatch(/kalender|tcc|permission|fehl/)
  })

  it('getEventsRaw returnt {events:[], error} statt zu throwen', async () => {
    const { calendarModule } = await import('../calendar.js')
    const result = await calendarModule.actions.getEventsRaw({ daysFromNow: 0, daysAhead: 1 })
    expect(result).toBeDefined()
    expect(Array.isArray(result.events)).toBe(true)
    expect(result.events.length).toBe(0)
    expect(result.source).toBe('none')
    expect(result.error).toBeTruthy()
  })
})
