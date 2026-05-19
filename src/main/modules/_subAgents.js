// Sub-Agent-Registry — Phase J6.
//
// Sub-Agents sind spezialisierte LLM-Workers, die im Hintergrund über die Job-Queue
// laufen. Jeder Agent hat:
//  - name (eindeutig)
//  - description (User-facing, für UI)
//  - default_title(params) → Job-Title-Generator
//  - run(params, ctx) → { result, summary, vaultNote? } async
//
// run() bekommt einen ctx mit { settings, registry, logProgress, shouldCancel } und
// liefert das Endergebnis. Konkurrenz + Status-Updates regelt der Runner.
//
// Sub-Agents werden in _agents/<name>.js definiert und hier importiert.

const _agents = new Map()

/**
 * Registriert einen Sub-Agent. Idempotent — re-register überschreibt.
 * @param {object} agent
 *   - name        — eindeutiger Schlüssel (z.B. 'researcher')
 *   - description — Kurzbeschreibung für UI
 *   - default_title(params) — gibt Job-Title-String zurück
 *   - run(params, ctx)      — async, returnt { result, summary, vaultNote? }
 */
export function registerAgent(agent) {
  if (!agent?.name) throw new Error('Agent braucht name')
  if (typeof agent.run !== 'function') throw new Error(`Agent ${agent.name} braucht run()`)
  if (typeof agent.default_title !== 'function') {
    agent.default_title = () => agent.description || agent.name
  }
  _agents.set(agent.name, agent)
}

export function getAgent(name) {
  return _agents.get(name) || null
}

export function listAgents() {
  return Array.from(_agents.values()).map(a => ({
    name: a.name,
    description: a.description || ''
  }))
}

export function _resetForTest() {
  _agents.clear()
}

// ── Built-in stub for Stufe-0 testing ─────────────────────────────────────────
// Wird in Stufe 1+ durch echte Agents ersetzt. Bleibt als Smoke-Test-Agent.
registerAgent({
  name: 'echo',
  description: 'Test-Agent: gibt nach kurzer Verzögerung den Eingabe-Text zurück',
  default_title: (params) => `Echo: ${(params.text || '').slice(0, 40)}`,
  async run(params, ctx) {
    const delay = Math.min(Math.max(params.delayMs || 100, 0), 5000)
    const steps = 3
    for (let i = 0; i < steps; i++) {
      if (ctx.shouldCancel?.()) {
        return { result: 'cancelled', summary: 'Abgebrochen' }
      }
      ctx.logProgress?.(`Schritt ${i + 1}/${steps}`)
      await new Promise(r => setTimeout(r, delay / steps))
    }
    if (params.fail) throw new Error(params.fail)
    return {
      result: `Echo: ${params.text || ''}`,
      summary: `Echo abgeschlossen (${params.text || ''})`
    }
  }
})
