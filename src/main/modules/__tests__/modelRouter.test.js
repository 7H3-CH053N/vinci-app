import { describe, it, expect } from 'vitest'
import { pickModel } from '../_modelRouter.js'

const settings = { geminiModel: 'gemini-2.5-pro' }

describe('pickModel — Trivial-Queries → Flash', () => {
  const trivials = [
    'wie spät?',
    'wieviel Uhr ist es?',
    'Welche Uhrzeit haben wir?',
    'hallo',
    'hi VINCI',
    'danke',
    'ok',
    'passt',
    'cool',
    'ja',
    'nein',
    'jo',
    'stop',
    'wer bist du?',
    'was kannst du?',
    'kurze frage'  // ≤ 15 Zeichen
  ]
  for (const q of trivials) {
    it(`flash für: "${q}"`, () => {
      const r = pickModel(q, settings)
      expect(r.model).toBe('gemini-2.5-flash')
    })
  }
})

describe('pickModel — Komplexe-Queries → Pro', () => {
  const complex = [
    'Erkläre mir die Quantenmechanik bitte',
    'Warum funktioniert das nicht?',
    'Begründe deine Empfehlung',
    'Vergleiche Anthropic mit OpenAI ausführlich',
    'Recherchiere die neuesten KI-News',
    'Plan mir einen Tag für nächste Woche',
    'Schreib mir eine Email an Birgit über das Meeting',
    'Debugge dieses Code-Snippet bitte',
    'Hat es heute geregnet UND wird es morgen sonnig?',
    'Implementier eine Funktion die...'
  ]
  for (const q of complex) {
    it(`pro für: "${q}"`, () => {
      const r = pickModel(q, settings)
      expect(r.model).toBe('gemini-2.5-pro')
    })
  }
})

describe('pickModel — Data-Lookup-Queries → Flash (Latenz-Optimierung)', () => {
  // Diese Queries sind Tool-Call mit klar definierter Antwort — Flash ist schnell
  // genug, nachdem Tool-Shortlisting (Phase J1) das Tool-Set bereits eingeengt hat.
  const flashLookups = [
    'Wie viele ungelesene Mails habe ich?',
    'Was steht heute im Kalender?',
    'Wie läuft mein Mac?'
  ]
  for (const q of flashLookups) {
    it(`flash für: "${q}"`, () => {
      const r = pickModel(q, settings)
      expect(r.model).toBe('gemini-2.5-flash')
    })
  }
})

describe('pickModel — Standard-Queries → Pro (Tool-Call-Safety)', () => {
  const standard = [
    'Wie wird das Wetter morgen?',
    'Was hab ich zu Anthropic notiert?'
  ]
  for (const q of standard) {
    it(`pro für: "${q}"`, () => {
      const r = pickModel(q, settings)
      expect(r.model).toBe('gemini-2.5-pro')
    })
  }
})

describe('pickModel — Settings-Override', () => {
  it('respektiert smartRouting: false und nutzt Pro für alles', () => {
    const off = { ...settings, smartRouting: false }
    expect(pickModel('hi', off).model).toBe('gemini-2.5-pro')
    expect(pickModel('hi', off).reason).toBe('smart-routing disabled')
  })
  it('nutzt geminiModel als Pro-Default falls custom', () => {
    const custom = { geminiModel: 'gemini-2.5-pro-experimental' }
    expect(pickModel('Erkläre mir', custom).model).toBe('gemini-2.5-pro-experimental')
  })
})
