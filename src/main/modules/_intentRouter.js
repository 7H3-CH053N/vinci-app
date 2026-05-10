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
    tools: ['memory_saveFact','memory_searchFacts','obsidian_search']
  },
  // Fallback: alle Tools sichtbar — bei Unsicherheit oder Multi-Domain-Queries
  multi: {
    label: 'Mehrere Domänen',
    tools: null  // null = alle Tools verfügbar
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
