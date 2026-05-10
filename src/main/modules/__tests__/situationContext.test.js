import { describe, it, expect, beforeEach } from 'vitest'
import { buildSituationContext, recordTurn, resetSession, _internal } from '../_situationContext.js'

const { timeOfDay } = _internal

describe('timeOfDay — Tageszeit-Phase', () => {
  const cases = [
    [new Date('2026-05-08T03:00:00'), 'nacht'],
    [new Date('2026-05-08T07:30:00'), 'morgen'],
    [new Date('2026-05-08T12:30:00'), 'mittag'],
    [new Date('2026-05-08T16:00:00'), 'nachmittag'],
    [new Date('2026-05-08T20:00:00'), 'abend'],
    [new Date('2026-05-08T23:30:00'), 'nacht']
  ]
  for (const [d, expected] of cases) {
    it(`${d.getHours()}:${d.getMinutes()} → ${expected}`, () => {
      expect(timeOfDay(d)).toBe(expected)
    })
  }
})

describe('buildSituationContext — Mindest-Inhalt', () => {
  beforeEach(() => resetSession())

  it('enthält immer Datum + Uhrzeit + Phase', async () => {
    const block = await buildSituationContext({ settings: {} }, { skipLiveData: true })
    expect(block).toContain('Aktuelle Situation')
    expect(block).toMatch(/\d{1,2}:\d{2}/)
    expect(block).toMatch(/\(morgen|mittag|nachmittag|abend|nacht\)/)
  })

  it('enthält Session-Memory wenn turns > 0', async () => {
    recordTurn({ userMessage: 'test', assistantText: 'antwort', intent: 'calendar', toolCalls: ['calendar_getToday'] })
    const block = await buildSituationContext({ settings: {} }, { skipLiveData: true })
    expect(block).toContain('Letzte Aktion: calendar')
    expect(block).toContain('calendar_getToday')
  })

  it('zeigt keine Session-Memory bei resetSession', async () => {
    recordTurn({ userMessage: 'test', intent: 'calendar' })
    resetSession()
    const block = await buildSituationContext({ settings: {} }, { skipLiveData: true })
    expect(block).not.toContain('Letzte Aktion')
  })

  it('intent=multi wird nicht angezeigt (zu generisch)', async () => {
    recordTurn({ userMessage: 'hi', intent: 'multi' })
    const block = await buildSituationContext({ settings: {} }, { skipLiveData: true })
    expect(block).not.toContain('Letzte Aktion: multi')
  })
})

describe('recordTurn — Persistenz innerhalb Session', () => {
  beforeEach(() => resetSession())

  it('inkrementiert turnCount', async () => {
    recordTurn({ userMessage: 'a', intent: 'mail' })
    recordTurn({ userMessage: 'b', intent: 'calendar' })
    const block = await buildSituationContext({ settings: {} }, { skipLiveData: true })
    expect(block).toContain('2 Turns')
  })

  it('letzter intent wird ueberschrieben', async () => {
    recordTurn({ userMessage: 'a', intent: 'mail' })
    recordTurn({ userMessage: 'b', intent: 'calendar' })
    const block = await buildSituationContext({ settings: {} }, { skipLiveData: true })
    expect(block).toContain('Letzte Aktion: calendar')
    expect(block).not.toContain('Letzte Aktion: mail')
  })
})
