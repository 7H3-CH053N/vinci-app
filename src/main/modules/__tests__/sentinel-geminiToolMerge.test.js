// SENTINEL: gemini-shortlist-merge
//
// Schützt vor dem Bug der heute aufgetreten ist:
//   "allowed_function_names should be a subset of the provided function_declarations"
// Wenn Intent-Router-Shortlist + detectForcedTools nicht konsistent sind, gibt
// Gemini einen 400 zurück. Diese Sentinels stellen sicher, dass reconcileForcedTools
// immer einen konsistenten State liefert.
//
// Wenn dieser Test bricht, ist das Briefing-/Daten-Lookup-Pfad kaputt.

import { describe, it, expect } from 'vitest'
import { reconcileForcedTools } from '../gemini.js'

const ALL_TOOLS = [
  { name: 'calendar_getToday' },
  { name: 'calendar_getUpcoming' },
  { name: 'mail_getUnread' },
  { name: 'weather_getCurrent' },
  { name: 'reminders_getAll' },
  { name: 'web_search' }
]

describe('SENTINEL — reconcileForcedTools', () => {
  it('no-op wenn keine forced Tools', () => {
    const r = reconcileForcedTools({
      shortlist: [{ name: 'reminders_getAll' }],
      forcedTools: null,
      allTools: ALL_TOOLS
    })
    expect(r.tools.map(t => t.name)).toEqual(['reminders_getAll'])
    expect(r.forcedTools).toBeNull()
    expect(r.added).toEqual([])
    expect(r.dropped).toEqual([])
  })

  it('no-op wenn forced Tools schon in shortlist', () => {
    const r = reconcileForcedTools({
      shortlist: [{ name: 'mail_getUnread' }, { name: 'weather_getCurrent' }],
      forcedTools: ['mail_getUnread'],
      allTools: ALL_TOOLS
    })
    expect(r.forcedTools).toEqual(['mail_getUnread'])
    expect(r.added).toEqual([])
  })

  it('erweitert shortlist um forced Tools die nur in allTools sind', () => {
    const r = reconcileForcedTools({
      shortlist: [{ name: 'reminders_getAll' }],
      forcedTools: ['calendar_getToday', 'mail_getUnread'],
      allTools: ALL_TOOLS
    })
    const names = r.tools.map(t => t.name).sort()
    expect(names).toEqual(['calendar_getToday', 'mail_getUnread', 'reminders_getAll'])
    expect(r.added.sort()).toEqual(['calendar_getToday', 'mail_getUnread'])
    expect(r.forcedTools.sort()).toEqual(['calendar_getToday', 'mail_getUnread'])
  })

  it('filtert nicht-existierende forced Tools raus statt 400 zu provozieren', () => {
    const r = reconcileForcedTools({
      shortlist: [{ name: 'reminders_getAll' }],
      forcedTools: ['ghost_tool', 'mail_getUnread'],
      allTools: ALL_TOOLS
    })
    expect(r.tools.map(t => t.name).sort()).toEqual(['mail_getUnread', 'reminders_getAll'])
    expect(r.forcedTools).toEqual(['mail_getUnread'])
    expect(r.dropped).toEqual(['ghost_tool'])
  })

  it('setzt forcedTools auf null wenn alle entfallen', () => {
    const r = reconcileForcedTools({
      shortlist: [{ name: 'reminders_getAll' }],
      forcedTools: ['ghost_a', 'ghost_b'],
      allTools: ALL_TOOLS
    })
    expect(r.forcedTools).toBeNull()
    expect(r.dropped).toEqual(['ghost_a', 'ghost_b'])
  })

  it('INVARIANT: forcedTools ist immer Subset von tools', () => {
    // Stichproben über mehrere Konfigurationen — kein 400-Risiko
    const scenarios = [
      { shortlist: [], forcedTools: ['mail_getUnread'] },
      { shortlist: [{ name: 'web_search' }], forcedTools: ['calendar_getToday', 'mail_getUnread', 'weather_getCurrent'] },
      { shortlist: ALL_TOOLS.slice(0, 2), forcedTools: ALL_TOOLS.map(t => t.name) },
      { shortlist: [], forcedTools: ['ghost_x'] }
    ]
    for (const s of scenarios) {
      const r = reconcileForcedTools({ ...s, allTools: ALL_TOOLS })
      if (r.forcedTools) {
        const toolNames = new Set(r.tools.map(t => t.name))
        for (const f of r.forcedTools) {
          expect(toolNames.has(f)).toBe(true)  // BRICHT wenn Subset-Invariante verletzt
        }
      }
    }
  })

  it('REAL-WORLD: Briefing-Szenario das heute den 400 ausgelöst hat', () => {
    // Reproduktion: Intent-Router schickt reminders-Shortlist, detectForcedTools
    // sieht "Wetter", "Termine", "Mails" → fordert all diese Tools
    const r = reconcileForcedTools({
      shortlist: [
        { name: 'reminders_getToday' },
        { name: 'reminders_getAll' },
        { name: 'reminders_getLists' }
      ],
      forcedTools: [
        'mail_getUnread', 'weather_getCurrent', 'calendar_getToday'
      ],
      allTools: [
        { name: 'reminders_getToday' }, { name: 'reminders_getAll' }, { name: 'reminders_getLists' },
        { name: 'mail_getUnread' }, { name: 'weather_getCurrent' }, { name: 'calendar_getToday' }
      ]
    })
    expect(r.added.sort()).toEqual(['calendar_getToday', 'mail_getUnread', 'weather_getCurrent'])
    expect(r.forcedTools.sort()).toEqual(['calendar_getToday', 'mail_getUnread', 'weather_getCurrent'])
    // Subset-Invariante: alles in forcedTools muss auch in tools sein
    const toolNames = new Set(r.tools.map(t => t.name))
    for (const f of r.forcedTools) expect(toolNames.has(f)).toBe(true)
  })
})
