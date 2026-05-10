// Heuristisches Modell-Routing — Phase J2.
// Wählt zwischen Gemini Flash (schnell+billig) und Gemini Pro (akkurater, Tool-stabil).
//
// Strategie:
//   - Triviale Queries (kurz, simple Pattern, keine Tool-Heuristik) → Flash
//   - Alles andere → Pro
//
// Sonnet-Door bleibt offen für späteren Multi-Provider-Support, aber heute nur Gemini.

import { logEvent } from './telemetry.js'

// Patterns die klar trivial sind und Flash kriegen sollen
const TRIVIAL_PATTERNS = [
  /^(wie\s+sp[äa]t|wieviel\s+uhr|welche\s+(uhrzeit|zeit))/i,
  /^(wie\s+geht('s|\s+es)\s+dir|hi\b|hallo\b|servus\b|hey\b|moin\b)/i,
  /^(danke|merci|thx|thanks)\b/i,
  /^(ok\b|okay\b|alles\s+klar|passt\b|gut\b|super\b|cool\b)/i,
  /^(ja\b|nein\b|jo\b|jep\b|nope\b|klar\b|sicher\b)/i,
  /^(stop|halt|abbrechen|cancel|vergiss)/i,
  /^(wer\s+bist\s+du|was\s+kannst\s+du)/i,
  // Daten-Lookup-Queries: ein Tool-Call, klare Antwort, perfekt für Flash mit J1-Shortlist
  /\b(wie\s+viele|wieviele|anzahl)\s+(ungelesene|offene|neue)\s+(mails?|nachrichten|aufgaben|termine|posts?)\b/i,
  /^(was\s+steht\s+(heute|morgen)|aufgaben\s+(heute|morgen)|termine\s+(heute|morgen))/i,
  /^(wie\s+läuft\s+mein\s+(mac|n8n)|wie\s+ist\s+das\s+wetter|aktueller?\s+stromverbrauch)/i,
  /^(ungelesene\s+mails|neue\s+nachrichten|telefonnummer\s+von)/i
]

// Komplexitäts-Marker — diese Queries brauchen Pro
const COMPLEX_PATTERNS = [
  /\b(erkläre?|begründe?|warum|wieso|weshalb|analysier|bewerten?|vergleich|recherche|fasse?\s+zusammen)\b/i,
  /\b(plan|planen?|strategie|konzept|entwurf|skizziere?)\b/i,
  /\b(code|coden?|implementier|debug|fehler\s+such|bug)\b/i,
  /\b(schreib(e)?|formulier|verfasse?|texte?|brief|email)\b/i,
  /\?(.*\?){2,}/,                 // mehrere Fragezeichen → komplex
  /\b(und\b.*\bund\b|sowie|außerdem|zusätzlich)\b/i,  // mehrteilige Queries
]

/**
 * Wählt das passende Modell für eine User-Query.
 * @param {string} message — User-Eingabe
 * @param {object} settings — geminiModel + geminiFallbackModel
 * @returns {{ model: string, reason: string }}
 */
export function pickModel(message, settings = {}) {
  const m = String(message || '').trim()
  const flash = 'gemini-2.5-flash'
  const pro   = settings.geminiModel || 'gemini-2.5-pro'

  // Wenn Smart-Routing explizit deaktiviert ist → einfach Default-Modell
  if (settings.smartRouting === false) {
    return { model: pro, reason: 'smart-routing disabled' }
  }

  // Komplexe Pattern haben Vorrang (auch bei kurzen Queries wie "Erkläre mir X")
  for (const re of COMPLEX_PATTERNS) {
    if (re.test(m)) {
      return { model: pro, reason: 'complex-pattern' }
    }
  }

  // Triviale Pattern → Flash
  for (const re of TRIVIAL_PATTERNS) {
    if (re.test(m)) {
      return { model: flash, reason: 'trivial-pattern' }
    }
  }

  // Sehr kurze Queries (<= 15 Zeichen) ohne Komplex-Marker = trivial
  if (m.length <= 15) {
    return { model: flash, reason: 'short-query' }
  }

  // Default: Pro für alles andere (Tool-Calling-Sicherheit)
  return { model: pro, reason: 'default-pro' }
}

/**
 * Pickt + loggt. Wrapper für den Standard-Use-Case.
 */
export function routeAndLog(message, settings = {}) {
  const decision = pickModel(message, settings)
  logEvent('model_routed', {
    message: String(message || '').slice(0, 100),
    model:   decision.model,
    reason:  decision.reason
  })
  return decision
}
