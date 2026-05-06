import { describe, it, expect } from 'vitest'
import { isHardRejected, forceCategoryFor } from '../obsidianGraph.js'

describe('isHardRejected', () => {
  const cases = [
    ['+436602660062', true,  'phone'],
    ['+43 6643580271', true, 'phone with space'],
    ['b.januschewsky@live.at', true, 'email'],
    ['1. August 2006', true,  'german date'],
    ['15. Jänner', true,      'partial date'],
    ['1.8.2006', true,         'numeric date'],
    ['2026', true,              'year'],
    ['CPU', true,               'system'],
    ['Plus', true,              'tier'],
    ['Pro', true,               'tier'],
    ['Enterprise', true,        'tier'],
    ['GPT-5.5', true,           'model version'],
    ['Claude 4', true,          'model version'],
    ['A', true,                 'too short'],
    ['Alex Januschewsky', false,'real person'],
    ['OpenAI', false,           'real company'],
    ['Salzburg', false,         'real place']
  ]
  for (const [input, expected, label] of cases) {
    it(`${expected ? 'rejects' : 'keeps'} ${label}: "${input}"`, () => {
      expect(isHardRejected(input)).toBe(expected)
    })
  }
})

describe('forceCategoryFor', () => {
  it('forces Quellen for domains', () => {
    expect(forceCategoryFor('9to5google.com', 'Themen')).toBe('Quellen')
    expect(forceCategoryFor('digitalhandwerk.rocks', 'Orte')).toBe('Quellen')
    expect(forceCategoryFor('androidauthority.com', 'Personen')).toBe('Quellen')
  })
  it('keeps original category for non-domains', () => {
    expect(forceCategoryFor('OpenAI', 'Firmen')).toBe('Firmen')
    expect(forceCategoryFor('Alex', 'Personen')).toBe('Personen')
    expect(forceCategoryFor('Salzburg', 'Orte')).toBe('Orte')
  })
})
