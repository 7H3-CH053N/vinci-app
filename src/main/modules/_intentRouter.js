// Intent Router — Phase J1.
//
// Klassifiziert User-Queries in eine semantische Domäne (calendar/mail/web/...) und
// liefert eine passende Tool-Shortlist. Der Haupt-Gemini-Call kriegt dann nur 3-7
// relevante Tools statt aller 23 — drastisch weniger Tokens, höhere Tool-Call-Accuracy,
// fast komplette Reduktion der Empty-STOP-Quirks.
//
// Strategie:
//   - Schneller Klassifizierer mit Mini-Prompt (Gemini Flash)
//   - Cache: gleiche Query in 60s wird nicht neu klassifiziert
//   - Confidence-Threshold 0.7 — bei Unsicherheit voller Tool-Set durchreichen
//   - Heuristik-Pre-Pass: bei sehr klaren Patterns (z. B. "wie spät?") sofort mappen,
//     ohne LLM-Call

import { GoogleGenerativeAI } from '@google/generative-ai'
import { logEvent } from './telemetry.js'

// ── Intent-Definitionen ────────────────────────────────────────────────────────
// Jeder Intent hat eine Tool-Shortlist (Tool-Namen, die der Haupt-LLM sehen darf).
// Reihenfolge nach Häufigkeit/Wichtigkeit. Bei intent='multi' bekommt der LLM alle.
const INTENTS = {
  calendar: {
    label: 'Kalender / Termine',
    tools: ['calendar_getToday','calendar_getUpcoming','calendar_getCalendars','calendar_createEvent','calendar_deleteEvent','contacts_search']
  },
  reminders: {
    label: 'Aufgaben / Erinnerungen',
    tools: ['reminders_getToday','reminders_getAll','reminders_getLists','reminders_createReminder','reminders_deleteReminder']
  },
  mail: {
    label: 'Mail',
    tools: ['mail_getUnread','mail_getLatest','contacts_search']
  },
  messages: {
    label: 'iMessages',
    tools: ['messages_getUnread','messages_getRecent','messages_search','messages_send','contacts_search']
  },
  contacts: {
    label: 'Kontakte',
    tools: ['contacts_search','contacts_call','contacts_message']
  },
  weather: {
    label: 'Wetter',
    tools: ['weather_getCurrent','weather_getForecast']
  },
  news: {
    label: 'News / Nachrichten',
    tools: ['news_getNews','web_search','web_saveToVault']  // web_search als Fallback bei Entity-spezifischen News
  },
  web: {
    label: 'Web-Suche',
    tools: ['web_search','web_saveToVault','obsidian_search','news_getNews']
  },
  obsidian: {
    label: 'Obsidian / Knowledge-Graph',
    tools: ['obsidian_search','obsidian_read','obsidian_listFolders','obsidian_createNote','memory_saveFact']
  },
  homeassistant: {
    label: 'Smart Home',
    tools: ['homeassistant_state','homeassistant_call','homeassistant_list','homeassistant_open']
  },
  system: {
    label: 'Mac-System',
    tools: ['system_getStatus','system_getProcesses']
  },
  strom: {
    label: 'Strom',
    tools: ['strom_getCurrent','strom_getToday']
  },
  n8n: {
    label: 'n8n / Workflows',
    tools: ['n8n_getStatus','n8n_getWorkflows','n8n_triggerWebhook']
  },
  blog: {
    label: 'Blog-Sync',
    tools: ['blog_sync']
  },
  memory: {
    label: 'Persönliches Wissen',
    tools: ['memory_saveFact','memory_search','obsidian_search']
  },
  // Fallback: alle Tools sichtbar — bei Unsicherheit oder Multi-Domain-Queries
  multi: {
    label: 'Mehrere Domänen',
    tools: null  // null = alle Tools verfügbar
  }
}

// ── Sub-Agent-Trigger ──────────────────────────────────────────────────────────
// Diese Patterns spawnen einen Hintergrund-Job statt synchron zu antworten.
// Heuristik ist explizit getrennt von normalen Intents, weil sub_agent-Match
// einen ANDEREN Codepfad triggert (Job-Queue statt Gemini-Tool-Call).
//
// Returnt: { agentType, params, confirmation } oder null
export function detectSubAgent(message) {
  const m = String(message || '').trim()
  if (!m) return null

  // Researcher: "brief mich zu X", "recherchier(e) X", "was tut sich bei X" + Entity-Hinweis
  // Bewusst RESTRICTIVE — wir wollen kein false-positive bei "wie ist X" o.ä.
  const researchRe = /^(brief(?:e|en)?\s+mich\s+(?:zu|über|von|mit)\s+|recherchier(?:e|en)?\s+(?:mir|mich)?\s*(?:zu|über|von|nach|für)?\s*|mach(?:e|en)?\s+(?:mir|dir|nen)?\s*(?:eine?\s+|nen\s+)?(?:recherche|research|briefing)\s+(?:zu|über|von)\s+|was\s+tut\s+sich\s+(?:gerade|aktuell)?\s*(?:bei|mit)\s+)(.+?)[?!.]?$/i
  const rm = m.match(researchRe)
  if (rm) {
    const topic = rm[2]?.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (topic && topic.length >= 3) {
      return {
        agentType: 'researcher',
        params: { topic },
        confirmation: `Recherchiere zu „${topic}" — das dauert 20-60 Sekunden, ich melde mich.`
      }
    }
  }

  // Weekly-Review: "Wochenrückblick", "Wochenbilanz", "Weekly", "mach mir nen Wochenrückblick"
  const weeklyRe = /(?:mach(?:e|en)?\s+(?:mir|dir)?\s+(?:ein|nen)?\s+)?(wochenrückblick|wochenbilanz|wochenreview|weekly[\s-]?review|weekly)\b/i
  if (weeklyRe.test(m)) {
    return {
      agentType: 'weekly',
      params: {},
      confirmation: 'Ich stelle den Wochenrückblick zusammen — ein paar Sekunden.'
    }
  }

  // Briefing: "(mach mir / ich brauch / starte) (ein) (tages-)briefing / morgen-briefing / tagesbriefing"
  // Klares Sub-Agent-Pattern. Einfaches "briefing" allein lassen wir vom alten
  // synchronen Pfad abfangen (keyword-shortcut in ipc.js), damit du wählen kannst.
  const briefingRe = /(?:mach(?:e|en)?\s+(?:mir|dir)?\s+(?:ein|nen)?\s+)?(tages-?briefing|morgen-?briefing|tagesüberblick|tageszusammenfassung)\b/i
  if (briefingRe.test(m)) {
    return {
      agentType: 'briefing',
      params: {},
      confirmation: 'Ich sammle die Tagesdaten — etwa 20 Sekunden, dann hast du das Briefing.'
    }
  }

  return null
}

// ── Sub-Agent LLM-Fallback ─────────────────────────────────────────────────────
// Wenn die Heuristik (detectSubAgent) null returnt, aber im Text Sub-Agent-
// Trigger-Wörter vorkommen, fragen wir Gemini Flash explizit: ist das ein
// Researcher/Briefing/Weekly-Request? Bei unklar bekommt der User eine Rückfrage
// statt eine halluzinierte Antwort.
//
// Async, kein automatischer Fallback wenn kein API-Key. Returnt:
//   - { agentType, params, confirmation }    → Sub-Agent spawnen
//   - { needsClarification: true, question } → User-Rückfrage
//   - null                                   → kein Sub-Agent-Intent erkannt
//
// LOOSE_TRIGGER_WORDS: Heuristik welche Messages den LLM-Call überhaupt
// rechtfertigen. Bei Greetings/Wetter/etc. kein LLM-Call.
// Lockere Trigger — wenn IRGENDWAS hier drin matched, LLM-Router läuft.
// Bewusst breit gefasst, weil der LLM-Router dann mit "none" antworten kann.
const LOOSE_TRIGGER_WORDS = /\b(brief|briefing|recherch|analysier|analyse|check|schau|prüf|fass|zusammenfass|wochen|woche\b|tag(es)?übersicht|überblick|bilanz|review|report|mach\s+mir|stell\s+mir)/i

const SUB_AGENT_FALLBACK_PROMPT = `Du bist VINCIs Intent-Klassifizierer.

VINCI hat drei Sub-Agents die Hintergrund-Jobs ausführen:
- **researcher**: Web-Recherche zu einem Thema. Braucht ein klares Thema (topic).
- **briefing**: Tagesbriefing (Wetter, Kalender, Mails, News) — KEIN Topic nötig.
- **weekly**: Wochenrückblick (letzte 7 Tage Aktivität) — KEIN Topic nötig.

Klassifiziere die User-Anfrage. Antworte AUSSCHLIESSLICH mit JSON:

{"action":"spawn|clarify|none","agent":"researcher|briefing|weekly"?,"params":{"topic":"..."}?,"question":"..."?}

Regeln:
- action: "spawn" — eindeutig einer der 3 Agents, alle nötigen Params im Text
- action: "clarify" — User will offensichtlich was, aber es ist mehrdeutig oder Param fehlt. question:"..." mit konkreter Rückfrage (auch Optionen anbieten wenn sinnvoll).
- action: "none" — KLAR keine Sub-Agent-Anfrage (z.B. einfache Wetter-/Status-Frage, Begrüßung, Bestätigung). Im Zweifel BEVORZUGE clarify statt none.

Triggerverben "schau", "check", "analysier", "prüf" bei Eigennamen sind FAST IMMER ambiguous (Web-Recherche vs Vault-Suche vs Status-Check) → clarify.

WICHTIG — Mehrdeutiges Verb "brief" / "briefen":
"brief mich" ohne weitere Spezifikation ist AMBIGUOUS — kann Tagesbriefing ODER Recherche bedeuten. → clarify mit Optionen.
NUR wenn "Tages-/Morgen-Briefing" oder "Briefing" explizit/standalone → briefing-Agent.
"brief mich zu X" oder "brief mich über X" → researcher.

Beispiele:
- "brief mich" → {"action":"clarify","question":"Soll ich dir ein Tagesbriefing machen (Wetter/Kalender/Mails/News) oder zu einem bestimmten Thema recherchieren?"}
- "brief mich über Anthropic" → {"action":"spawn","agent":"researcher","params":{"topic":"Anthropic"}}
- "Tagesbriefing" / "morgen-briefing" → {"action":"spawn","agent":"briefing"}
- "recherchier mir was" → {"action":"clarify","question":"Wozu denn? Welches Thema soll ich recherchieren?"}
- "Wochenrückblick" / "fass mir die letzte Woche zusammen" → {"action":"spawn","agent":"weekly"}
- "wie ist das Wetter" → {"action":"none"}
- "schau dir mal Anthropic an" → {"action":"clarify","question":"Was meinst du — soll ich zu Anthropic recherchieren (Web), im Vault nach Notizen suchen, oder etwas anderes?"}`

export async function detectSubAgentLLM(message, settings = {}) {
  const m = String(message || '').trim()
  if (!m) return null
  // Nur LLM aufrufen wenn überhaupt ein Trigger-Wort drin ist
  if (!LOOSE_TRIGGER_WORDS.test(m)) {
    console.log('[SubAgentLLM] skip: no trigger word in:', m.slice(0, 60))
    return null
  }
  const apiKey = settings.geminiApiKey
  if (!apiKey) return null

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SUB_AGENT_FALLBACK_PROMPT,
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 250, temperature: 0 }
    })
    const res = await model.generateContent(`User-Anfrage: ${m.slice(0, 400)}`)
    let text = (res?.response?.text?.() || '').trim()
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    let parsed
    try { parsed = JSON.parse(text) } catch {
      const jm = text.match(/\{[\s\S]*\}/)
      if (jm) try { parsed = JSON.parse(jm[0]) } catch {}
    }
    if (!parsed || typeof parsed !== 'object') {
      console.warn('[SubAgentLLM] parse failed:', text.slice(0, 100))
      return null
    }
    console.log(`[SubAgentLLM] decision: action=${parsed.action} agent=${parsed.agent || ''} msg="${m.slice(0,50)}"`)

    if (parsed.action === 'spawn' && parsed.agent) {
      const params = parsed.params || {}
      // Validate: researcher braucht topic
      if (parsed.agent === 'researcher' && (!params.topic || String(params.topic).trim().length < 3)) {
        return { needsClarification: true, question: 'Welches Thema soll ich recherchieren?' }
      }
      const conf = parsed.agent === 'researcher'
        ? `Recherchiere zu „${params.topic}" — ~30 Sekunden, ich melde mich.`
        : parsed.agent === 'briefing'
          ? 'Ich sammle die Tagesdaten — etwa 20 Sekunden.'
          : 'Ich stelle den Wochenrückblick zusammen — ein paar Sekunden.'
      return { agentType: parsed.agent, params, confirmation: conf }
    }
    if (parsed.action === 'clarify' && parsed.question) {
      return { needsClarification: true, question: String(parsed.question).slice(0, 300) }
    }
    return null
  } catch (err) {
    console.warn('[SubAgentLLM] failed:', err.message)
    return null
  }
}

// ── Heuristik-Pre-Pass ─────────────────────────────────────────────────────────
// Bei sehr klaren Patterns wählen wir direkt — kein LLM-Call.
const HEURISTICS = [
  { intent: 'calendar',     re: /\b(termin|kalender|meeting|appointment|kalenderwoche|nächste\s+woche|nächste[rn]?\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))\b/i },
  { intent: 'reminders',    re: /\b(aufgabe|aufgaben|erinner|reminder|to-?do|erledigen)\b/i },
  { intent: 'mail',         re: /\b(mail|mails|e-?mail|posteingang|ungelesene)\b/i },
  { intent: 'messages',     re: /\b(nachricht|imessage|sms|whatsapp|geschrieben|schick.*\bmessage|chat)\b/i },
  { intent: 'contacts',     re: /\b(telefonnummer|nummer\s+von|adresse\s+von|kontakt|geburtstag\s+von)\b/i },
  { intent: 'weather',      re: /\b(wetter|regen|sonne|temperatur|grad\s+celsius|wie\s+wird|prognose)\b/i },
  // News-Intent: nur bei generischen "Nachrichten"/"Schlagzeilen" — Entity-spezifisch ("Anthropic-News") fällt auf web
  { intent: 'web',          re: /\b(such\s+(im\s+)?web|internet\b|google\s+das|recherchier|aktuelle?\s+(kurs|preis)|neueste\w*\s+(\w+-)?news|news\s+(zu|von|über|bei)\s+\w)\b/i },
  { intent: 'news',         re: /\b(nachrichten\s+(heute|allgemein)?|schlagzeilen|tagesschau|aktuelles\s+aus|sport-?nachrichten|salzburg-?news)\b/i },
  { intent: 'obsidian',     re: /\b(notiert|notiz|notizen|vault|knowledge|obsidian|was\s+(weiß|wissen)\s+(wir|ich)\s+über)\b/i },
  { intent: 'homeassistant',re: /\b(licht|lampe|steckdose|heizung|smart\s*home|szene\s+aktivier|temperatur\s+im)\b/i },
  { intent: 'system',       re: /\b(cpu|ram|arbeitsspeicher|festplatte|akku|prozessor|wie\s+läuft\s+(mein\s+)?mac)\b/i },
  { intent: 'strom',        re: /\b(strom|stromverbrauch|watt|kilowatt|kwh|energieverbrauch)\b/i },
  { intent: 'n8n',          re: /\b(n8n|workflow|workflows|automation\s+läuft)\b/i },
  { intent: 'blog',         re: /\b(blog[\s-]*(aktualisier|sync|hol)|digitalhandwerk[\s-]*(hol|sync)|(hol|sync|lad|zieh)\s+(meine\s+)?(blog[\s-]*)?(post|posts|artikel))\b/i },
  { intent: 'memory',       re: /^(merk\s+dir|speicher.*(?:fakt|wissen)|notier\s+(mir|dir)\s+das.*?:)/i }
]

function heuristicMatch(message) {
  const m = String(message || '').trim()
  // Bei sehr kurzen Begrüßungen / Ack-Nachrichten kein Tool-Set nötig
  if (/^(hi|hallo|servus|hey|moin|danke|merci|ok|okay|jo|jep|cool|super|alles\s+klar|passt|stop|halt|ja|nein)\b/i.test(m) && m.length < 30) {
    return { intent: 'multi', confidence: 1, source: 'greeting', tools: [] }
  }
  // Erstes klares Pattern gewinnt
  for (const h of HEURISTICS) {
    if (h.re.test(m)) {
      return { intent: h.intent, confidence: 0.95, source: 'heuristic' }
    }
  }
  return null
}

// ── Cache ──────────────────────────────────────────────────────────────────────
const cache = new Map()
const CACHE_TTL_MS = 60_000

function cacheKey(message) {
  return String(message || '').trim().toLowerCase().slice(0, 200)
}

// ── LLM-Klassifikation ────────────────────────────────────────────────────────
const CLASSIFIER_PROMPT = `Du bist ein Intent-Klassifizierer. Lese die deutsche User-Frage und antworte AUSSCHLIESSLICH mit einem JSON-Objekt: {"intent":"<key>","confidence":<0-1>}.

Erlaubte intent-keys (genau einer):
- calendar (Kalender/Termine)
- reminders (Aufgaben/To-Dos)
- mail (E-Mails)
- messages (iMessage/SMS/Chat-Nachrichten)
- contacts (Telefonnummern, Adressen, Kontakte)
- weather (Wetter)
- news (Nachrichten/Schlagzeilen)
- web (Web-Recherche, aktuelle öffentliche Infos)
- obsidian (eigene Notizen, persönliches Wissen)
- homeassistant (Licht, Heizung, Smart Home)
- system (Mac-Status: CPU, RAM, Akku)
- strom (Stromverbrauch)
- n8n (n8n-Workflow-Status)
- blog (Blog-Sync, Posts ziehen)
- memory (etwas merken/speichern)
- multi (mehrere Domänen oder unklar)

Gib confidence < 0.7 wenn du unsicher bist — dann bekommt der Hauptassistent alle Tools. Sei eher zu vorsichtig (multi) als falsch zu klassifizieren.`

export async function classifyIntent(message, settings = {}) {
  const m = String(message || '').trim()
  if (!m) return { intent: 'multi', confidence: 0, source: 'empty' }

  // 1) Cache-Hit
  const ck = cacheKey(m)
  const cached = cache.get(ck)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.result, source: 'cache' }
  }

  // 2) Heuristik
  const heur = heuristicMatch(m)
  if (heur) {
    cache.set(ck, { ts: Date.now(), result: heur })
    return heur
  }

  // 3) LLM-Klassifizierer (Gemini Flash, billig + schnell)
  const apiKey = settings?.geminiApiKey
  if (!apiKey) {
    return { intent: 'multi', confidence: 0, source: 'no-key' }
  }
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: CLASSIFIER_PROMPT,
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 80, temperature: 0 }
    })
    const t0 = Date.now()
    const res = await model.generateContent(m)
    let text = res.response.text?.() || ''
    // Robust parsen: code fences strippen, ersten {…} Block extrahieren
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const m2 = text.match(/\{[^}]*\}/s)
    const jsonStr = m2 ? m2[0] : text
    const ms = Date.now() - t0
    let parsed
    try { parsed = JSON.parse(jsonStr) }
    catch (e) {
      console.warn('[IntentRouter] JSON parse failed for output:', text.slice(0, 100))
      return { intent: 'multi', confidence: 0, source: 'invalid-json', ms }
    }
    const intent = String(parsed.intent || 'multi').toLowerCase()
    const confidence = Number(parsed.confidence)

    if (!INTENTS[intent]) {
      return { intent: 'multi', confidence: 0, source: 'invalid-llm-output', ms }
    }
    const result = { intent, confidence: isNaN(confidence) ? 0.5 : confidence, source: 'llm', ms }
    cache.set(ck, { ts: Date.now(), result })
    return result
  } catch (err) {
    console.warn('[IntentRouter] classify failed:', err.message)
    return { intent: 'multi', confidence: 0, source: 'error', error: err.message }
  }
}

// ── Tool-Shortlist ─────────────────────────────────────────────────────────────
/**
 * Liefert für einen Classification-Result die Tool-Namen-Liste.
 * Bei confidence < threshold oder intent='multi' → null (= alle Tools).
 * @returns {string[] | null} Liste der erlaubten Tool-Namen, oder null für "alle"
 */
export function shortlistTools(classification, threshold = 0.7) {
  if (!classification) return null
  // Heuristik-Match darf explizit ein Tool-Set setzen (z. B. [] für Greetings),
  // das hat Vorrang vor der Default-Definition.
  if (Array.isArray(classification.tools)) return classification.tools
  if (classification.confidence < threshold) return null
  const def = INTENTS[classification.intent]
  if (!def) return null
  if (def.tools === null) return null  // 'multi'
  return def.tools
}

/**
 * Komfort-Wrapper: klassifiziert + erstellt Shortlist + loggt.
 */
export async function routeIntent(message, settings = {}) {
  const t0 = Date.now()
  const cls = await classifyIntent(message, settings)
  const tools = shortlistTools(cls)
  const totalMs = Date.now() - t0
  logEvent('intent_routed', {
    message: String(message || '').slice(0, 100),
    intent:     cls.intent,
    confidence: cls.confidence,
    source:     cls.source,
    toolCount:  tools ? tools.length : null,
    ms:         totalMs
  })
  return { ...cls, tools, totalMs }
}

// Test-Hook
export const _internal = { INTENTS, HEURISTICS, heuristicMatch, cache }
