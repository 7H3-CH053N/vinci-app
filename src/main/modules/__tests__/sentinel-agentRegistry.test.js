// SENTINEL: agent-registry-complete
//
// Schützt vor verschwundenen Sub-Agents: Stellt sicher, dass alle erwarteten
// Agents nach Import registriert sind und ein gültiges Run-Interface haben.
// Wenn jemand einen Agent löscht oder die registerAgent-Konvention bricht,
// schlägt dieser Test an.

import { describe, it, expect } from 'vitest'
import { listAgents, getAgent } from '../_subAgents.js'
import '../_agents/researcher.js'
import '../_agents/briefing.js'
import '../_agents/weekly.js'
import '../_agents/vaultCurator.js'

const EXPECTED_AGENTS = ['echo', 'researcher', 'briefing', 'weekly', 'vault_curator']

describe('SENTINEL — Sub-Agent-Registry vollständig', () => {
  it('hat alle erwarteten Agents registriert', () => {
    const names = listAgents().map(a => a.name).sort()
    for (const ex of EXPECTED_AGENTS) {
      expect(names, `Agent "${ex}" fehlt im Registry`).toContain(ex)
    }
  })

  for (const name of EXPECTED_AGENTS) {
    describe(`Agent: ${name}`, () => {
      it('hat run() Funktion', () => {
        const a = getAgent(name)
        expect(a, `Agent ${name}`).toBeTruthy()
        expect(typeof a.run, `Agent ${name}.run`).toBe('function')
      })
      it('hat default_title() Funktion', () => {
        const a = getAgent(name)
        expect(typeof a.default_title).toBe('function')
        const title = a.default_title({})
        expect(typeof title).toBe('string')
        expect(title.length).toBeGreaterThan(0)
      })
      it('hat description', () => {
        const a = getAgent(name)
        expect(typeof a.description).toBe('string')
      })
    })
  }
})
