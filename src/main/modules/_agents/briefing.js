// Briefing Sub-Agent — Phase J6 Stufe 2.
//
// Sammelt Tageskontext (Wetter, Kalender heute+morgen, Reminders, Mails, News) und
// synthetisiert ein strukturiertes Markdown-Briefing mit Sektionen + TTS-tauglicher
// Kurzfassung am Ende.
//
// Output:
//   - Vault-Note unter VINCI/Briefings/Daily/<datum>.md
//   - result: gesamtes Markdown (für Job-Detail-View)
//   - summary: 1-Satz-Resumee (für Chat-Inject + Notification)
//
// Trigger:
//   - Manuell via Job-View → "+ Briefing"
//   - Später cron (Stufe 4 Weekly-Review baut darauf auf)

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { registry } from '../registry.js'
import { localISOString, localDateString, localDateLong } from '../_localTime.js'
import { registerAgent } from '../_subAgents.js'

// ── Pure Helpers ─────────────────────────────────────────────────────────────

export function briefingDateStr(d = new Date()) {
  return localDateLong(d)
}

export function isoDate(d = new Date()) {
  return localDateString(d)
}

function safeArr(v) { return Array.isArray(v) ? v : [] }

/**
 * Formatiert die rohen Datenfeeds zu einem Daten-Block für den LLM-Prompt.
 * Pure Funktion, testbar ohne Network.
 */
export function buildDataBlock(data) {
  const lines = []

  // Wetter
  if (data.weather && !data.weather.error) {
    const w = data.weather
    lines.push(`WETTER SALZBURG:`)
    lines.push(`Aktuell ${w.temperature}°C (gefühlt ${w.feelsLike}°C), ${w.condition}. Heute: ${w.todayMin}–${w.todayMax}°C, ${w.todayCondition}.`)
  } else {
    lines.push('WETTER SALZBURG: nicht verfügbar')
  }
  lines.push('')

  // Kalender heute — Error-Signal ehrlich rendern statt fälschlich "(keine)"
  const todayErr = data.calendarToday?.error || (data.calendarToday == null ? 'Kalender konnte nicht abgerufen werden' : null)
  const today = safeArr(data.calendarToday?.termine)
  lines.push('TERMINE HEUTE:')
  if (todayErr) lines.push(`(Kalender-Zugriff fehlgeschlagen: ${todayErr})`)
  else lines.push(today.length ? today.map(e => `- ${e}`).join('\n') : '(keine Termine)')
  lines.push('')

  // Kalender morgen
  const tomErr = data.calendarTomorrow?.error || (data.calendarTomorrow == null ? 'Kalender konnte nicht abgerufen werden' : null)
  const tomorrow = safeArr(data.calendarTomorrow?.events).map(e => {
    const t = e.start ? new Date(e.start).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) : '?'
    return `- ${t} ${e.title || '?'}`
  })
  lines.push('TERMINE MORGEN:')
  if (tomErr) lines.push(`(Kalender-Zugriff fehlgeschlagen: ${tomErr})`)
  else lines.push(tomorrow.length ? tomorrow.join('\n') : '(keine Termine)')
  lines.push('')

  // Reminders
  const reminders = safeArr(data.reminders).slice(0, 10)
  lines.push('OFFENE AUFGABEN (Top 10):')
  lines.push(reminders.length
    ? reminders.map(r => `- ${r.title}${r.list ? ' [' + r.list + ']' : ''}`).join('\n')
    : '(keine)')
  lines.push('')

  // Mails
  const mails = safeArr(data.mail).slice(0, 5)
  lines.push('UNGELESENE MAILS (Top 5):')
  lines.push(mails.length
    ? mails.map(m => `- ${m.from}: ${m.subject}`).join('\n')
    : '(keine)')
  lines.push('')

  // News
  const news = safeArr(data.news).slice(0, 6)
  lines.push('NEWS (Top 6):')
  lines.push(news.length
    ? news.map(n => `- ${n.title}${n.source ? ' (' + n.source + ')' : ''}`).join('\n')
    : '(keine)')
  lines.push('')

  // Strom
  if (data.strom && !data.strom.error) {
    const w = data.strom.currentW ?? data.strom.watt
    if (w != null) lines.push(`STROMVERBRAUCH JETZT: ${(w/1000).toFixed(2)} kW`)
  }

  return lines.join('\n')
}

export function buildBriefingFrontmatter(date) {
  return [
    '---',
    `title: ${JSON.stringify('Briefing ' + date)}`,
    `source: vinci-briefing`,
    `created: "${localISOString()}"`,
    `tags: [briefing, daily, vinci-agent]`,
    `mentions: []`,
    '---'
  ].join('\n')
}

const SYSTEM_PROMPT = `Du bist VINCIs Briefing-Sub-Agent. Aus den Tagesdaten erstellst du ein strukturiertes Markdown-Briefing — auf Deutsch.

Format:
# Briefing — <Datum>

## Wetter
1-2 Sätze, Salzburg.

## Heute
Termine + die wichtigsten 3-5 offenen Aufgaben kombiniert, im Fließtext oder Bullets. Pragmatisch, was wirklich heute zählt.

## Morgen
Falls Termine morgen anstehen, kurz auflisten. Sonst Sektion weglassen.

## Posteingang
Knapp: wie viele ungelesen, was sticht raus (Absender / Thema). Wenn nichts wichtig: 1 Satz, nicht alles auflisten.

## News
1-3 Stichpunkte was heute in der Tech-Welt / Salzburg los ist. Wenn nichts Relevantes: weglassen.

---

## Kurzfassung
2-3 Sätze. Wird gesprochen (TTS) und im Chat angezeigt. Sprich Alex direkt mit "du" an, knapp, ohne Floskeln.

Wichtig:
- Klares Hochdeutsch
- Keine Marketingsprech, kein "spannend"-Geschwafel
- Wenn Daten fehlen oder leer sind, das ehrlich kurz benennen statt um den heißen Brei zu reden
- **WENN eine Daten-Sektion einen Fehler-Hinweis enthält (z.B. "Kalender-Zugriff fehlgeschlagen") — NIEMALS so tun, als wäre nichts da. Stattdessen ehrlich sagen: "Kalender konnte nicht abgerufen werden". Lieber Lücke benennen als falsches "keine Termine".**
- Passe Tonfall an Tageszeit an: morgens motivierend, mittags neutral, abends ruhig zusammenfassend`

// ── Daten sammeln ────────────────────────────────────────────────────────────

async function fetchAllData(settings) {
  const ctx = { settings, tokens: {}, saveTokens: () => {} }
  const results = await Promise.allSettled([
    registry.invoke('weather',   'getCurrent',    {}, ctx),
    registry.invoke('calendar',  'getToday',      {}, ctx),
    registry.invoke('calendar',  'getEventsRaw',  { daysFromNow: 1, daysAhead: 1 }, ctx),
    registry.invoke('reminders', 'getAll',        {}, ctx),
    registry.invoke('mail',      'getUnread',     { limit: 5 }, ctx),
    registry.invoke('news',      'getNews',       { limit: 6 }, ctx),
    registry.invoke('strom',     'getCurrent',    {}, ctx)
  ])
  return {
    weather:          results[0].status === 'fulfilled' ? results[0].value : null,
    calendarToday:    results[1].status === 'fulfilled' ? results[1].value : null,
    calendarTomorrow: results[2].status === 'fulfilled' ? results[2].value : null,
    reminders:        results[3].status === 'fulfilled' ? results[3].value : null,
    mail:             results[4].status === 'fulfilled' ? results[4].value : null,
    news:             results[5].status === 'fulfilled' ? results[5].value : null,
    strom:            results[6].status === 'fulfilled' ? results[6].value : null
  }
}

// ── Markdown nach Sektionen splitten, Kurzfassung extrahieren ────────────────

export function extractKurzfassung(markdown) {
  const m = markdown.match(/##\s+Kurzfassung\s*\n([\s\S]+?)(?:\n##|$)/i)
  return m ? m[1].trim() : ''
}

// ── Vault-Write ──────────────────────────────────────────────────────────────

export function uniqueBriefingPath(dir, dateIso) {
  let p = join(dir, `${dateIso}.md`)
  let n = 1
  while (existsSync(p)) {
    p = join(dir, `${dateIso}-${n}.md`)
    n++
  }
  return p
}

// ── Agent-Run ────────────────────────────────────────────────────────────────

export async function runBriefing(params, ctx) {
  const settings = ctx?.settings || {}
  const apiKey = settings.geminiApiKey
  if (!apiKey) throw new Error('Gemini API-Key fehlt (Settings → Dienste)')

  // 1. Daten sammeln
  ctx.logProgress?.('Sammle Daten (Wetter, Kalender, Mails, News, Strom)…')
  const data = await fetchAllData(settings)
  const collected = {
    weather:          !!(data.weather  && !data.weather.error),
    today:            safeArr(data.calendarToday?.termine).length,
    tomorrow:         safeArr(data.calendarTomorrow?.events).length,
    reminders:        safeArr(data.reminders).length,
    mail:             safeArr(data.mail).length,
    news:             safeArr(data.news).length,
    strom:            !!(data.strom    && !data.strom.error)
  }
  ctx.logProgress?.(`Daten gesammelt: ${Object.entries(collected).filter(([_, v]) => v).map(([k]) => k).join(', ')}`)
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  // 2. Synthese
  const dateStr = briefingDateStr()
  const dateIso = isoDate()
  const dataBlock = buildDataBlock(data)
  ctx.logProgress?.('Briefing wird formuliert (Gemini Flash)…')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { temperature: 0.4, maxOutputTokens: 8000 }
  })
  const userPrompt = `Heute ist ${dateStr}.\n\nDaten:\n\n${dataBlock}\n\nBitte das Briefing schreiben.`
  const llmRes = await model.generateContent(userPrompt)
  const finishReason = llmRes?.response?.candidates?.[0]?.finishReason || 'unknown'
  let markdown = (llmRes?.response?.text?.() || '').trim()
  if (!markdown) throw new Error(`Gemini gab leere Antwort zurück (finishReason: ${finishReason})`)
  if (finishReason === 'MAX_TOKENS') {
    markdown += '\n\n> ⚠ Briefing am Token-Limit abgeschnitten'
  }
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  const kurzfassung = extractKurzfassung(markdown) || markdown.split('\n').slice(0, 3).join(' ')

  // 3. Vault-Note
  const vaultPath = settings.obsidian?.vaultPath
  let vaultNote = null
  if (vaultPath && existsSync(vaultPath)) {
    try {
      const dir = join(vaultPath, 'VINCI', 'Briefings', 'Daily')
      mkdirSync(dir, { recursive: true })
      const path = uniqueBriefingPath(dir, dateIso)
      const fm = buildBriefingFrontmatter(dateIso)
      writeFileSync(path, `${fm}\n\n${markdown}\n`, 'utf8')
      vaultNote = path
    } catch (err) {
      console.warn('[Briefing] Vault-Write failed:', err.message)
    }
  }

  return {
    result:  markdown,
    summary: kurzfassung,
    vaultNote
  }
}

registerAgent({
  name: 'briefing',
  description: 'Tageszusammenfassung: Wetter + Kalender + Aufgaben + Mails + News',
  default_title: () => `Briefing ${briefingDateStr()}`,
  run: runBriefing
})
