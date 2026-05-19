import { describe, it, expect } from 'vitest'
import { detectSubAgent } from '../_intentRouter.js'

describe('detectSubAgent — Researcher-Trigger', () => {
  it('matched "brief mich zu X"', () => {
    const r = detectSubAgent('brief mich zu Anthropic')
    expect(r).toBeTruthy()
    expect(r.agentType).toBe('researcher')
    expect(r.params.topic).toBe('Anthropic')
  })

  it('matched "recherchiere X"', () => {
    const r = detectSubAgent('recherchiere Mistral AI Strategie')
    expect(r?.agentType).toBe('researcher')
    expect(r.params.topic).toBe('Mistral AI Strategie')
  })

  it('matched "was tut sich bei X"', () => {
    const r = detectSubAgent('was tut sich bei Apple AI?')
    expect(r?.agentType).toBe('researcher')
    expect(r.params.topic).toBe('Apple AI')
  })

  it('matched "mach mir nen Briefing zu X"', () => {
    const r = detectSubAgent('mach mir ein Briefing zu OpenAI Roadmap')
    expect(r?.agentType).toBe('researcher')
    expect(r.params.topic).toBe('OpenAI Roadmap')
  })

  it('kein Match bei zu kurzem Topic', () => {
    expect(detectSubAgent('brief mich zu X')).toBeNull()
    expect(detectSubAgent('recherchier ab')).toBeNull()
  })

  it('kein Match bei unverwandter Frage', () => {
    expect(detectSubAgent('wie ist das Wetter')).toBeNull()
    expect(detectSubAgent('was hab ich heute zu tun')).toBeNull()
    expect(detectSubAgent('hi')).toBeNull()
  })

  it('confirmation enthält das Topic', () => {
    const r = detectSubAgent('brief mich zu Anthropic')
    expect(r.confirmation).toContain('Anthropic')
  })
})

describe('detectSubAgent — Vault-Curator-Trigger', () => {
  it('matched "Vault-Check"', () => {
    expect(detectSubAgent('Vault-Check')?.agentType).toBe('vault_curator')
  })
  it('matched "Vault Audit"', () => {
    expect(detectSubAgent('Vault Audit')?.agentType).toBe('vault_curator')
  })
  it('matched "wie ist mein Vault"', () => {
    expect(detectSubAgent('wie ist mein Vault')?.agentType).toBe('vault_curator')
  })
  it('matched "schau dir den Vault an"', () => {
    expect(detectSubAgent('schau dir den Vault an')?.agentType).toBe('vault_curator')
  })
})

describe('detectSubAgent — Weekly-Review-Trigger', () => {
  it('matched "Wochenrückblick"', () => {
    expect(detectSubAgent('Wochenrückblick')?.agentType).toBe('weekly')
  })
  it('matched "mach mir nen Wochenrückblick"', () => {
    expect(detectSubAgent('mach mir nen Wochenrückblick')?.agentType).toBe('weekly')
  })
  it('matched "weekly review"', () => {
    expect(detectSubAgent('weekly review')?.agentType).toBe('weekly')
  })
  it('matched "Wochenbilanz"', () => {
    expect(detectSubAgent('Wochenbilanz')?.agentType).toBe('weekly')
  })
})

describe('detectSubAgent — Briefing-Trigger', () => {
  it('matched "tagesbriefing"', () => {
    const r = detectSubAgent('mach mir ein Tagesbriefing')
    expect(r?.agentType).toBe('briefing')
    expect(r.params).toEqual({})
  })

  it('matched "Morgen-Briefing"', () => {
    expect(detectSubAgent('Morgen-Briefing bitte')?.agentType).toBe('briefing')
  })

  it('matched "Tagesüberblick"', () => {
    expect(detectSubAgent('ich brauche einen Tagesüberblick')?.agentType).toBe('briefing')
  })

  it('plain "briefing" → null (wird vom alten Pfad abgefangen)', () => {
    expect(detectSubAgent('briefing')).toBeNull()
  })
})
