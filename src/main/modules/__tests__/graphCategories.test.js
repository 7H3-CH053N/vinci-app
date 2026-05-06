import { describe, it, expect } from 'vitest'
import { VALID_CATS, isDomain } from '../_graphCategories.js'

describe('graphCategories', () => {
  it('contains six canonical categories incl. Quellen', () => {
    expect(VALID_CATS).toEqual(['Personen','Tiere','Firmen','Orte','Themen','Quellen'])
  })
  it('isDomain detects common TLDs', () => {
    expect(isDomain('9to5google.com')).toBe(true)
    expect(isDomain('digitalhandwerk.rocks')).toBe(true)
    expect(isDomain('androidauthority.com')).toBe(true)
    expect(isDomain('OpenAI')).toBe(false)
    expect(isDomain('Salzburg')).toBe(false)
  })
})
