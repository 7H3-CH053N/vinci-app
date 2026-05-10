import { describe, it, expect, beforeEach } from 'vitest'
import { shortlistTools, _internal } from '../_intentRouter.js'

const { heuristicMatch, cache, INTENTS } = _internal

beforeEach(() => cache.clear())

describe('heuristicMatch — klare Patterns sofort routen', () => {
  const cases = [
    ['Was steht heute im Kalender?', 'calendar'],
    ['Welche Aufgaben hab ich heute?', 'reminders'],
    ['Wie viele ungelesene Mails?', 'mail'],
    ['Was hat Birgit geschrieben?', 'messages'],
    ['Telefonnummer von Tobias?', 'contacts'],
    ['Wie wird das Wetter?', 'weather'],
    ['Welche News heute?', 'news'],
    ['Such im Web nach OpenAI', 'web'],
    ['Was hab ich zu Anthropic notiert?', 'obsidian'],
    ['Schalte das Licht an', 'homeassistant'],
    ['Wie läuft mein Mac?', 'system'],
    ['Aktueller Stromverbrauch?', 'strom'],
    ['Wie läuft mein n8n?', 'n8n'],
    ['Hol meine Blog-Artikel', 'blog']
  ]
  for (const [msg, expected] of cases) {
    it(`"${msg}" → ${expected}`, () => {
      const r = heuristicMatch(msg)
      expect(r?.intent).toBe(expected)
    })
  }
})

describe('heuristicMatch — Begrüßung/Ack → multi mit leerem Tool-Set', () => {
  for (const m of ['hi', 'hallo', 'danke', 'ok', 'cool', 'passt', 'jo']) {
    it(`"${m}" → multi (greeting)`, () => {
      const r = heuristicMatch(m)
      expect(r?.intent).toBe('multi')
      expect(r?.tools).toEqual([])
    })
  }
})

describe('heuristicMatch — unklare Fragen → kein Heuristik-Match (LLM-Pfad)', () => {
  const fuzzy = [
    'Was meinst du dazu',
    'Erkläre mir bitte',
    'Was ist eigentlich der Unterschied',
    'Hilf mir mal'
  ]
  for (const m of fuzzy) {
    it(`"${m}" → null (kein Heuristik-Match)`, () => {
      expect(heuristicMatch(m)).toBeNull()
    })
  }
})

describe('shortlistTools — Tool-Filter pro Intent', () => {
  it('calendar → enthält calendar_getToday', () => {
    const tools = shortlistTools({ intent: 'calendar', confidence: 0.9 })
    expect(tools).toContain('calendar_getToday')
    expect(tools).toContain('calendar_createEvent')
    // Sollte KEIN System-Tool enthalten
    expect(tools).not.toContain('system_getStatus')
  })
  it('mail → enthält mail-Tools + contacts_search', () => {
    const tools = shortlistTools({ intent: 'mail', confidence: 0.9 })
    expect(tools).toContain('mail_getUnread')
    expect(tools).toContain('contacts_search')
  })
  it('multi → null (alle Tools)', () => {
    expect(shortlistTools({ intent: 'multi', confidence: 1.0 })).toBeNull()
  })
  it('confidence < 0.7 → null (Fallback auf alle Tools)', () => {
    expect(shortlistTools({ intent: 'calendar', confidence: 0.5 })).toBeNull()
  })
  it('unbekannter Intent → null', () => {
    expect(shortlistTools({ intent: 'erfunden', confidence: 0.9 })).toBeNull()
  })
})

describe('Intents-Definitionen — Sanity-Check', () => {
  it('jeder Intent hat einen Label + Tool-Set', () => {
    for (const [key, def] of Object.entries(INTENTS)) {
      expect(def.label).toBeDefined()
      expect(def.tools === null || Array.isArray(def.tools)).toBe(true)
    }
  })
  it('multi hat tools=null (alle)', () => {
    expect(INTENTS.multi.tools).toBeNull()
  })
  it('calendar enthält genug für CRUD', () => {
    const c = INTENTS.calendar.tools
    expect(c).toContain('calendar_getCalendars')
    expect(c).toContain('calendar_createEvent')
    expect(c).toContain('calendar_deleteEvent')
  })
})
