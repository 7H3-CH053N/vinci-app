import { describe, it, expect } from 'vitest'
import { shouldEvaluate, _internal } from '../_selfEval.js'

describe('shouldEvaluate — Heuristik', () => {
  it('skip wenn Antwort leer oder sehr kurz', () => {
    expect(shouldEvaluate('Lange Frage hier?', '')).toBe(false)
    expect(shouldEvaluate('Lange Frage hier?', 'OK')).toBe(false)
    expect(shouldEvaluate('Lange Frage hier?', 'Kurz')).toBe(false)
  })

  it('skip bei trivialen Acks/Greetings', () => {
    expect(shouldEvaluate('Hallo', 'Hallo!')).toBe(false)
    expect(shouldEvaluate('Hallo', 'Hi')).toBe(false)
    expect(shouldEvaluate('Speicher das', 'Notiz angelegt!')).toBe(false)
    expect(shouldEvaluate('Was?', 'Erledigt.')).toBe(false)
  })

  it('skip bei Fehlermeldungen', () => {
    expect(shouldEvaluate('Was ist das?', 'Ich habe keine Antwort generiert. Formulier die Frage anders.')).toBe(false)
    expect(shouldEvaluate('Frage', 'Bitte formulier die Frage anders.')).toBe(false)
  })

  it('eval bei normalen substantiellen Antworten', () => {
    expect(shouldEvaluate(
      'Was hab ich heute zu tun?',
      'Du hast 3 Aufgaben: Mail beantworten, Code reviewen, Sport machen.'
    )).toBe(true)
  })

  it('complex-only mode skip bei trivialen Fragen', () => {
    expect(shouldEvaluate(
      'Wie spät?',
      'Es ist 17:30 Uhr.',
      { mode: 'complex-only' }
    )).toBe(false)
  })

  it('complex-only mode eval bei langen/komplexen Fragen', () => {
    expect(shouldEvaluate(
      'Erkläre mir bitte den Unterschied zwischen Wikilinks und Tags in Obsidian',
      'Wikilinks verbinden Notizen direkt, Tags sind Kategorisierungen...',
      { mode: 'complex-only' }
    )).toBe(true)
  })

  it('complex-only mode eval bei langen Antworten', () => {
    expect(shouldEvaluate(
      'Was?',
      'a'.repeat(300),
      { mode: 'complex-only' }
    )).toBe(true)
  })
})

describe('SKIP_ANSWER_PATTERNS — coverage', () => {
  const skipExamples = ['hallo', 'Hi', 'OK', 'cool!', 'Notiz angelegt', 'Erledigt.',
    'Ich habe keine Antwort generiert.', 'Bitte formulier die Frage anders.']
  for (const ex of skipExamples) {
    it(`erkennt "${ex}" als skip-würdig`, () => {
      const matches = _internal.SKIP_ANSWER_PATTERNS.some(re => re.test(ex.trim()))
      expect(matches).toBe(true)
    })
  }
})
