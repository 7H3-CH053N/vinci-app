// SENTINEL: briefing-data-honesty
//
// Schützt vor dem Bug von heute: wenn eine Quelle (z.B. Calendar) fehlschlägt,
// muss das Briefing das EHRLICH benennen statt fälschlich "keine Termine" zu sagen.
//
// Dies prüft den Daten-Block (das was an Gemini geschickt wird) — die Wahl des
// Wordings macht dann der LLM.

import { describe, it, expect } from 'vitest'
import { buildDataBlock } from '../_agents/briefing.js'

describe('SENTINEL — Briefing-Daten-Ehrlichkeit', () => {
  it('null calendar → "fehlgeschlagen" statt "keine"', () => {
    const block = buildDataBlock({})
    expect(block).toContain('TERMINE HEUTE:\n(Kalender-Zugriff fehlgeschlagen')
    expect(block).toContain('TERMINE MORGEN:\n(Kalender-Zugriff fehlgeschlagen')
    expect(block).not.toMatch(/TERMINE HEUTE:\n\(keine[)\s]/)
  })

  it('explicit error → ehrlich rendern', () => {
    const block = buildDataBlock({
      calendarToday: { termine: [], error: 'TCC permission denied' },
      calendarTomorrow: { events: [], error: 'TCC permission denied' }
    })
    expect(block).toContain('TCC permission denied')
  })

  it('LEERES termine-Array (kein Error) → "keine Termine"', () => {
    const block = buildDataBlock({
      calendarToday: { termine: [] },
      calendarTomorrow: { events: [] }
    })
    expect(block).toContain('TERMINE HEUTE:\n(keine Termine)')
    expect(block).toContain('TERMINE MORGEN:\n(keine Termine)')
    expect(block).not.toContain('fehlgeschlagen')
  })

  it('weather error → "nicht verfügbar"', () => {
    const block = buildDataBlock({ weather: { error: 'API down' } })
    expect(block).toContain('WETTER SALZBURG: nicht verfügbar')
  })
})
