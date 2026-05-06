import { describe, it, expect } from 'vitest'
import { _internal } from '../memoryWorker.js'
import { isHardRejected, forceCategoryFor } from '../obsidianGraph.js'

describe('memworker fact filter snapshot', () => {
  const reject = [
    "Alex' Mac CPU-Auslastung liegt bei 24%",
    "Alex' Mac hat den Arbeitsspeicher zu 47% ausgelastet",
    "Alex' Mac hat einen voll geladenen Akku",
    "Alex hat den Kontaktnamen 'Prompt Rocker' gespeichert",
    "Aktueller Stromverbrauch ist 1104 Watt",
    "Wetter morgen 18 Grad sonnig",
    "Alex hat 2 Termine heute"
  ]
  const accept = [
    "Toni ist Alex' Bruder",
    "Toni arbeitet in Linz",
    "Alex trinkt morgens Espresso",
    "Bello ist Alex' Hund",
    "Alex hört gerne Iron Maiden"
  ]
  for (const r of reject) it(`rejects: "${r}"`, () => expect(_internal.looksLikeFact(r)).toBe(false))
  for (const a of accept) it(`accepts: "${a}"`, () => expect(_internal.looksLikeFact(a)).toBe(true))
})

describe('graph hard-reject snapshot', () => {
  const cases = [
    ['+436602660062', true], ['b@x.de', true], ['1. August 2006', true],
    ['CPU', true], ['Plus', true], ['Pro', true], ['Enterprise', true],
    ['GPT-5.5', true], ['2026', true],
    ['OpenAI', false], ['Alex Januschewsky', false], ['Salzburg', false]
  ]
  for (const [name, expected] of cases) {
    it(`${expected ? 'rejects' : 'keeps'}: "${name}"`, () => expect(isHardRejected(name)).toBe(expected))
  }
})

describe('domain forcing', () => {
  it('forces 9to5google.com → Quellen', () => expect(forceCategoryFor('9to5google.com', 'Themen')).toBe('Quellen'))
  it('forces digitalhandwerk.rocks → Quellen', () => expect(forceCategoryFor('digitalhandwerk.rocks', 'Orte')).toBe('Quellen'))
})
