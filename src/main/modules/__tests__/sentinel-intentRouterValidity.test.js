// SENTINEL: intent-router-tool-shortlist-validity
//
// Schützt vor Halluzinations-Tools: Wenn jemand einen Intent in _intentRouter.js
// definiert mit einem Tool-Namen der gar nicht im Registry existiert, würde das
// LLM den Tool-Call mit ungültigem Namen aufrufen → silent failure oder 400.
//
// Dieser Sentinel iteriert alle Intents und prüft: jeder Tool-Name muss im
// Registry tatsächlich existieren.

import { describe, it, expect } from 'vitest'
import { _internal as routerInternal } from '../_intentRouter.js'
import { registry } from '../registry.js'

describe('SENTINEL — Intent-Router Tool-Shortlist Validity', () => {
  const allToolNames = new Set(registry.getTools().map(t => t.name))
  const intentEntries = Object.entries(routerInternal.INTENTS)

  it('Registry hat mindestens 20 Tools (sanity)', () => {
    expect(allToolNames.size).toBeGreaterThan(20)
  })

  for (const [intent, def] of intentEntries) {
    const tools = def.tools || []
    if (tools.length === 0) continue
    it(`Intent "${intent}": alle Tool-Namen sind im Registry`, () => {
      const missing = tools.filter(name => !allToolNames.has(name))
      if (missing.length > 0) {
        throw new Error(`Intent "${intent}" verweist auf nicht-existente Tools: ${missing.join(', ')}`)
      }
    })
  }

  it('Jeder Intent hat Label + tools entweder Array (Shortlist) oder null (alle Tools)', () => {
    for (const [intent, def] of intentEntries) {
      expect(def, `Intent "${intent}" definition`).toBeTruthy()
      expect(typeof def.label, `Intent "${intent}" label`).toBe('string')
      const toolsOk = Array.isArray(def.tools) || def.tools === null
      expect(toolsOk, `Intent "${intent}" tools (muss Array oder null sein)`).toBe(true)
    }
  })
})
