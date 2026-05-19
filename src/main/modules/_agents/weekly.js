// Weekly-Review Sub-Agent — Phase J6 Stufe 4.
//
// Wochenbilanz: was war (Termine, Vault-Aktivität, Blog-Posts) + Ausblick auf
// kommende Woche. Schreibt nach VINCI/Briefings/Weekly/<ISO-Woche>.md.
//
// Cron-Trigger: Sonntag 19:00 (über _proactiveDaemons.js). Manueller Trigger:
// Chat ("Wochenrückblick", "Weekly", "Wochenbilanz") oder UI-Button.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { registry } from '../registry.js'
import { localISOString, localDateString, localISOWeek, startOfISOWeek } from '../_localTime.js'
import { registerAgent } from '../_subAgents.js'

// ── Pure Helpers ─────────────────────────────────────────────────────────────

/** Liest aus einer Note Datum + Title aus dem YAML-Header. */
export function readNoteSummary(filePath) {
  try {
    const head = readFileSync(filePath, 'utf8').slice(0, 1500)
    const get = (key) => {
      const m = head.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, 'm'))
      return m ? m[1].trim() : null
    }
    return {
      title: get('title') || filePath.split('/').pop().replace(/\.md$/, ''),
      created: get('created') || get('published') || null,
      tags: get('tags') || ''
    }
  } catch { return null }
}

/**
 * Listet Vault-Files (rekursiv) die in einem Zeitfenster created wurden.
 * Window-Start ist inclusive, -End exclusive.
 * Created wird aus dem YAML `created` Feld gelesen, Fallback auf mtime.
 */
export function collectRecentFiles(vaultPath, folder, sinceISO, untilISO) {
  const dir = join(vaultPath, folder)
  if (!existsSync(dir)) return []
  const since = new Date(sinceISO).getTime()
  const until = untilISO ? new Date(untilISO).getTime() : Date.now() + 86400_000
  const out = []
  function walk(d, rel) {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const fp = join(d, e.name)
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name.startsWith('_quarantine')) continue   // skip
        walk(fp, relPath)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        let when = null
        const summary = readNoteSummary(fp)
        if (summary?.created) when = new Date(summary.created).getTime()
        if (!when || isNaN(when)) {
          try { when = statSync(fp).mtimeMs } catch { when = 0 }
        }
        if (when >= since && when < until) {
          out.push({ path: fp, relPath, when, ...(summary || {}) })
        }
      }
    }
  }
  walk(dir, '')
  out.sort((a, b) => b.when - a.when)
  return out
}

/**
 * Sammelt alle relevanten Wochendaten in einem Objekt.
 * Pure-ish: liest nur Dateien aus dem Vault, kein Network. Calendar-Lookup ist
 * separat (braucht registry-dispatch).
 */
export function collectWeeklyVaultData({ vaultPath, weekStart, weekEnd }) {
  const sinceISO = weekStart.toISOString()
  const untilISO = weekEnd.toISOString()
  const blog = collectRecentFiles(vaultPath, 'RSS/digitalhandwerk', sinceISO, untilISO)
  const briefings = collectRecentFiles(vaultPath, 'VINCI/Briefings', sinceISO, untilISO)
    .filter(f => !f.relPath.includes('Weekly/'))    // self-Review nicht zählen
  const notes = []
  for (const cat of ['Personen', 'Firmen', 'Themen', 'Orte', 'Tiere', 'Quellen']) {
    notes.push(...collectRecentFiles(vaultPath, `VINCI/${cat}`, sinceISO, untilISO))
  }
  return {
    blog,
    briefings,
    newEntities: notes,
    blogCount: blog.length,
    briefingsCount: briefings.length,
    newEntitiesCount: notes.length
  }
}

export function buildWeeklyFrontmatter({ isoWeek, weekStart, weekEnd }) {
  return [
    '---',
    `title: ${JSON.stringify('Wochenrückblick ' + isoWeek)}`,
    `source: vinci-weekly`,
    `iso_week: ${isoWeek}`,
    `week_start: "${weekStart.toISOString().slice(0,10)}"`,
    `week_end: "${weekEnd.toISOString().slice(0,10)}"`,
    `created: "${localISOString()}"`,
    `tags: [weekly, briefing, vinci-agent]`,
    `mentions: []`,
    '---'
  ].join('\n')
}

/** Baut den Daten-Block für den LLM-Prompt. Pure Funktion. */
export function buildWeeklyDataBlock({ isoWeek, weekStart, weekEnd, vaultData, calendarPast, calendarUpcoming }) {
  const lines = []
  const fmtDate = d => d.toISOString().slice(0,10)
  lines.push(`ZEITRAUM: ${isoWeek} (${fmtDate(weekStart)} - ${fmtDate(weekEnd)})`)
  lines.push('')

  // Vergangene Termine
  const past = Array.isArray(calendarPast?.events) ? calendarPast.events : []
  lines.push('VERGANGENE TERMINE:')
  lines.push(past.length ? past.slice(0, 15).map(e => {
    const t = e.start ? new Date(e.start).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
    return `- ${t} ${e.title || '?'}`
  }).join('\n') : '(keine — oder Kalender nicht zugreifbar)')
  lines.push('')

  // Kommende Termine
  const up = Array.isArray(calendarUpcoming?.events) ? calendarUpcoming.events : []
  lines.push('TERMINE NÄCHSTE WOCHE:')
  lines.push(up.length ? up.slice(0, 15).map(e => {
    const t = e.start ? new Date(e.start).toLocaleString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
    return `- ${t} ${e.title || '?'}`
  }).join('\n') : '(keine)')
  lines.push('')

  // Blog
  lines.push(`NEUE BLOG-POSTS (${vaultData.blogCount}):`)
  lines.push(vaultData.blog.length
    ? vaultData.blog.slice(0, 10).map(p => `- ${p.title || p.relPath}`).join('\n')
    : '(keine)')
  lines.push('')

  // Briefings
  lines.push(`BRIEFINGS DIESE WOCHE (${vaultData.briefingsCount}):`)
  lines.push(vaultData.briefings.length
    ? vaultData.briefings.slice(0, 10).map(b => `- ${b.title || b.relPath}`).join('\n')
    : '(keine)')
  lines.push('')

  // Neue Entities
  if (vaultData.newEntitiesCount > 0) {
    lines.push(`NEUE ENTITIES (${vaultData.newEntitiesCount}):`)
    lines.push(vaultData.newEntities.slice(0, 10).map(n => `- ${n.title || n.relPath}`).join('\n'))
    lines.push('')
  }

  return lines.join('\n')
}

const SYSTEM_PROMPT = `Du bist VINCIs Weekly-Review-Sub-Agent. Aus den Wochendaten schreibst du einen kompakten Wochenrückblick — auf Deutsch.

Format (Markdown, in dieser Reihenfolge):

# Wochenrückblick <KW> (<Datumsbereich>)

## Highlights
2-3 Sätze: was war wirklich relevant diese Woche? Was sticht raus?

## Termine
Was war (knapp) + was kommt nächste Woche (knapp). Bei vielen Terminen Cluster bilden.

## Vault-Aktivität
Zahlen + 2-3 Sätze Einordnung. Welche Themen wurden bearbeitet? Briefings die kamen?

## Blog
Falls neue Posts erschienen sind, die Titel auflisten + ein Satz worum es ging.

## Ausblick
1-2 Sätze: worauf liegt der Fokus nächste Woche?

---

## Kurzfassung
2-3 Sätze. Wird gesprochen + im Chat angezeigt. Knapp, in Du-Form.

Stil: klares Hochdeutsch, präzise, kein Marketing-Sprech. Wenn eine Sektion leer ist, ehrlich kurz benennen statt strecken.
**WICHTIG:** Wenn eine Quelle "Kalender nicht zugreifbar" sagt — das ehrlich erwähnen, NICHT so tun als wären keine Termine.`

// ── Daten sammeln ────────────────────────────────────────────────────────────

async function fetchWeeklyData(settings, weekStart) {
  const ctx = { settings, tokens: {}, saveTokens: () => {} }
  const vaultPath = settings.obsidian?.vaultPath
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400_000)

  // Vergangene Termine: 7 Tage zurück bis weekEnd (= jetzt-ish)
  const calendarPast = await registry.invoke('calendar', 'getEventsRaw',
    { daysFromNow: -7, daysAhead: 0 }, ctx).catch(() => ({ events: [], error: 'failed' }))

  // Kommende Termine: heute bis +7 Tage
  const calendarUpcoming = await registry.invoke('calendar', 'getEventsRaw',
    { daysFromNow: 0, daysAhead: 7 }, ctx).catch(() => ({ events: [], error: 'failed' }))

  // Vault-Daten
  const vaultData = vaultPath
    ? collectWeeklyVaultData({ vaultPath, weekStart, weekEnd })
    : { blog: [], briefings: [], newEntities: [], blogCount: 0, briefingsCount: 0, newEntitiesCount: 0 }

  return { vaultData, calendarPast, calendarUpcoming, weekStart, weekEnd }
}

function extractKurzfassung(markdown) {
  const m = markdown.match(/##\s+Kurzfassung\s*\n([\s\S]+?)(?:\n##|$)/i)
  return m ? m[1].trim() : ''
}

// ── Agent-Run ────────────────────────────────────────────────────────────────

export async function runWeekly(params, ctx) {
  const settings = ctx?.settings || {}
  const apiKey = settings.geminiApiKey
  if (!apiKey) throw new Error('Gemini API-Key fehlt (Settings → Dienste)')

  const now = params.refDate ? new Date(params.refDate) : new Date()
  const weekStart = startOfISOWeek(now)
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400_000)
  const isoWeek = localISOWeek(weekStart)

  ctx.logProgress?.(`Sammle Daten für ${isoWeek}…`)
  const data = await fetchWeeklyData(settings, weekStart)
  ctx.logProgress?.(`Daten gesammelt: ${data.vaultData.blogCount} Blog + ${data.vaultData.briefingsCount} Briefings + ${data.vaultData.newEntitiesCount} Entities`)
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  // Synthese
  ctx.logProgress?.('Wochenrückblick formulieren (Gemini Flash)…')
  const dataBlock = buildWeeklyDataBlock({ isoWeek, weekStart, weekEnd, ...data })
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { temperature: 0.4, maxOutputTokens: 8000 }
  })
  const userPrompt = `Daten:\n\n${dataBlock}\n\nBitte den Wochenrückblick gemäß System-Prompt-Format schreiben.`
  const llmRes = await model.generateContent(userPrompt)
  const finishReason = llmRes?.response?.candidates?.[0]?.finishReason || 'unknown'
  let markdown = (llmRes?.response?.text?.() || '').trim()
  if (!markdown) throw new Error(`Gemini gab leere Antwort zurück (finishReason: ${finishReason})`)
  if (finishReason === 'MAX_TOKENS') markdown += '\n\n> ⚠ Am Token-Limit abgeschnitten'
  if (ctx.shouldCancel?.()) return { result: null, summary: 'abgebrochen' }

  const kurzfassung = extractKurzfassung(markdown) || markdown.split('\n').slice(0, 3).join(' ')

  // Vault-Note
  const vaultPath = settings.obsidian?.vaultPath
  let vaultNote = null
  if (vaultPath && existsSync(vaultPath)) {
    try {
      const dir = join(vaultPath, 'VINCI', 'Briefings', 'Weekly')
      mkdirSync(dir, { recursive: true })
      let path = join(dir, `${isoWeek}.md`)
      let n = 1
      while (existsSync(path)) { path = join(dir, `${isoWeek}-${n}.md`); n++ }
      const fm = buildWeeklyFrontmatter({ isoWeek, weekStart, weekEnd })
      writeFileSync(path, `${fm}\n\n${markdown}\n`, 'utf8')
      vaultNote = path
    } catch (err) {
      console.warn('[Weekly] Vault-Write failed:', err.message)
    }
  }

  return {
    result: markdown,
    summary: kurzfassung,
    vaultNote
  }
}

registerAgent({
  name: 'weekly',
  description: 'Wochenrückblick: Termine + Vault-Aktivität + Blog + Ausblick',
  default_title: (params) => {
    const ref = params.refDate ? new Date(params.refDate) : new Date()
    return `Wochenrückblick ${localISOWeek(ref)}`
  },
  run: runWeekly
})
