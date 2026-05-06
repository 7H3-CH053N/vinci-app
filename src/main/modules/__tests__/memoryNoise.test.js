import { describe, it, expect } from 'vitest'
import { stripSystemNoise } from '../memoryWorker.js'

describe('stripSystemNoise', () => {
  it('removes lines about CPU/RAM percentages', () => {
    const conv = `Alex: Wie läuft mein Mac?
VINCI: Mac läuft mit CPU 24%, RAM 47%, Festplatte 5%.
Alex: Mein Bruder Tobias arbeitet bei Sony.`
    const out = stripSystemNoise(conv)
    expect(out).not.toMatch(/CPU 24%/)
    expect(out).toMatch(/Tobias/)
  })

  it('keeps normal conversation', () => {
    const conv = 'Alex: Iron Maiden ist meine Lieblingsband.'
    expect(stripSystemNoise(conv)).toBe(conv)
  })

  it('removes Akku-Auslastung lines', () => {
    const conv = 'VINCI: Mein Akku ist zu 80% geladen.'
    expect(stripSystemNoise(conv)).toBe('')
  })
})
