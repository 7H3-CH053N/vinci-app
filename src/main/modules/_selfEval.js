// Self-Eval — Phase J5.
//
// Nach jeder VINCI-Antwort läuft ein kurzer Selbst-Check:
//   "Hat die Antwort die ursprüngliche User-Frage tatsächlich beantwortet?"
// Bei Score < threshold → einmal Retry mit Korrektur-Hint.
//
// Heuristik-Pre-Pass spart LLM-Calls bei trivialen Antworten:
// - Greetings, Acks, Fehlermeldungen → kein Eval
// - Sehr kurze Antworten + lange Frage → wahrscheinlich unvollständig
//
// Telemetry: jede Eval wird geloggt (score + retried).

import { GoogleGenerativeAI } from '@google/generative-ai'
import { logEvent } from './telemetry.js'

// Antworten die nicht eval-würdig sind
const SKIP_ANSWER_PATTERNS = [
  /^(hallo|hi|servus|hey|moin|ja|nein|ok|okay|cool|super|alles\s+klar|gerne|bitte\s+schön)\s*[!.]?$/i,
  /^(ich\s+habe\s+keine\s+antwort|formulier\s+die\s+frage)/i,
  /^(notiz\s+angelegt|gespeichert|erledigt|fertig|done)\s*[!.]?\s*$/i,
  /^Bitte\s+(formulier|wiederhol)/i
]

const EVAL_PROMPT = `Du bist ein QA-Reviewer. Analysiere ob VINCIs Antwort die User-Frage beantwortet.

Antworte AUSSCHLIESSLICH mit JSON: {"score":0.0-1.0,"reason":"<kurz>","fix":"<einsatz-hint oder leer>"}

Score-Skala:
- 1.0 = perfekt beantwortet, alles relevante drin
- 0.7-0.9 = solide, kleinere Lücken ok
- 0.4-0.6 = teilweise, etwas wesentliches fehlt
- 0.0-0.3 = daneben, falsche Domäne, keine echte Antwort

"fix": konkreter Tipp für Retry, falls score < 0.7 (z.B. "Tool X hätte Daten gebraucht", "User wollte Y, du hast Z geliefert"). Bei score >= 0.7 leer lassen.`

/**
 * Heuristik: muss das überhaupt evaluiert werden?
 */
export function shouldEvaluate(question, answer, opts = {}) {
  const q = String(question || '').trim()
  const a = String(answer || '').trim()
  if (!q || !a) return false
  // Skip bei trivialen Acks/Fehlermeldungen — egal wie lang
  if (SKIP_ANSWER_PATTERNS.some(re => re.test(a))) return false
  // Pure Bestätigungen ohne Inhalt
  if (a.length < 12) return false
  // Wenn explizit als 'complex-only' konfiguriert: nur bei langen Fragen / komplexen Themen
  if (opts.mode === 'complex-only') {
    const looksComplex = q.length > 40
                      || /\b(erkläre?|warum|wieso|begründe|vergleich|fasse?\s+zusammen|recherchier|plan|schreib)\b/i.test(q)
                      || a.length > 250
    if (!looksComplex) return false
  }
  return true
}

/**
 * Evaluiert eine Antwort. Returnt { score, reason, fix }.
 * Bei Fehler oder skip: { score: 1.0, reason: 'skipped', fix: '' } — d.h. nicht retryen.
 */
export async function evaluateAnswer(question, answer, settings = {}) {
  const apiKey = settings?.geminiApiKey
  if (!apiKey) return { score: 1.0, reason: 'no-api-key', fix: '' }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: EVAL_PROMPT,
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 150, temperature: 0 }
    })
    const t0 = Date.now()
    const userPrompt = `User-Frage: ${String(question).slice(0, 500)}\n\nVINCI-Antwort: ${String(answer).slice(0, 1500)}`
    const res = await model.generateContent(userPrompt)
    let text = res.response.text?.() || ''
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const ms = Date.now() - t0

    // Robust parsen: greedy-match auf {...}, dann fallback auf score-extraction via regex
    let parsed = null
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      try { parsed = JSON.parse(m[0]) } catch {}
    }
    if (!parsed) {
      // Letzter Fallback: einzelne Felder per Regex extrahieren
      const sm = text.match(/"score"\s*:\s*([0-9.]+)/)
      const rm = text.match(/"reason"\s*:\s*"([^"]+)"/)
      const fm = text.match(/"fix"\s*:\s*"([^"]+)"/)
      if (sm) parsed = { score: parseFloat(sm[1]), reason: rm?.[1] || '', fix: fm?.[1] || '' }
    }
    if (!parsed) {
      console.warn('[SelfEval] cannot parse:', text.slice(0, 200))
      return { score: 1.0, reason: 'invalid-json', fix: '', ms }
    }
    const score = Math.max(0, Math.min(1, Number(parsed.score) || 0))
    return {
      score,
      reason: String(parsed.reason || '').slice(0, 200),
      fix:    String(parsed.fix    || '').slice(0, 300),
      ms
    }
  } catch (err) {
    console.warn('[SelfEval] failed:', err.message)
    return { score: 1.0, reason: 'error', fix: '', error: err.message }
  }
}

/**
 * Convenience: evaluiert + loggt + returnt ob Retry nötig
 */
export async function evalAndDecide({ question, answer, settings, threshold = 0.6 }) {
  if (!shouldEvaluate(question, answer, { mode: settings?.selfEvalMode })) {
    return { skipped: true, score: 1.0, retry: false }
  }
  const result = await evaluateAnswer(question, answer, settings)
  const retry = result.score < threshold && result.fix && result.fix.length > 5
  logEvent('self_eval', {
    score:    result.score,
    reason:   result.reason,
    retry,
    fix:      result.fix.slice(0, 100),
    questionLen: String(question || '').length,
    answerLen:   String(answer || '').length,
    ms:       result.ms || 0
  })
  return { ...result, retry, skipped: false }
}

export const _internal = { SKIP_ANSWER_PATTERNS }
