// Situation Context — Phase J3.
//
// Liefert pro Chat-Turn einen kompakten "was läuft gerade"-Block, der vor den
// User-Input in den System-Prompt eingehängt wird. Macht VINCI situativ-bewusst:
// er weiß die Zeit, was nächstes ansteht, was der User gerade tut, ohne dass er
// danach fragt.
//
// Zwei Datentypen:
//   1. Live-Snapshot — bei jedem Turn frisch berechnet (Zeit, nächster Termin etc.)
//   2. Session-Memory — wird nach jedem Turn aktualisiert (was gerade besprochen)

import { registry } from './registry.js'

// ── Session-Memory ─────────────────────────────────────────────────────────────
// Hält volatile Per-Session-Daten. Nicht persistiert.
let lastUserTurn = null       // letzte User-Frage
let lastAssistantTurn = null  // letzte VINCI-Antwort (text)
let lastIntent = null         // letzter klassifizierter Intent
let lastToolCalls = []        // [tool-name, ...] des letzten Turns
let turnCount = 0
let sessionStartTs = Date.now()

export function recordTurn({ userMessage, assistantText, intent, toolCalls }) {
  if (userMessage) lastUserTurn = String(userMessage).slice(0, 300)
  if (assistantText) lastAssistantTurn = String(assistantText).slice(0, 400)
  if (intent) lastIntent = intent
  if (Array.isArray(toolCalls)) lastToolCalls = toolCalls.slice(0, 5)
  turnCount++
}

export function resetSession() {
  lastUserTurn = null
  lastAssistantTurn = null
  lastIntent = null
  lastToolCalls = []
  turnCount = 0
  sessionStartTs = Date.now()
}

// ── Tageszeit-Phase ────────────────────────────────────────────────────────────
function timeOfDay(d = new Date()) {
  const h = d.getHours()
  if (h < 5) return 'nacht'
  if (h < 11) return 'morgen'
  if (h < 14) return 'mittag'
  if (h < 18) return 'nachmittag'
  if (h < 22) return 'abend'
  return 'nacht'
}

// ── Live-Snapshot mit Cache + Race-Timeout ────────────────────────────────────
// Live-Daten kosten Zeit (AppleScript-Calls für Calendar/Mail). Wir cachen sie 60s
// und brechen nach 3s ab — VINCI darf im Worst-Case ohne Live-Block antworten.
const liveDataCache = { ts: 0, nextEvent: null, mailUnread: null }
const LIVE_CACHE_MS = 60_000
const LIVE_RACE_MS  = 3_000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(null), ms))
  ])
}

async function getNextEvent(ctx, lookaheadHours = 4) {
  try {
    const result = await registry.dispatch('calendar_getEventsRaw', { daysFromNow: 0, daysAhead: 1 }, ctx)
    if (!result || !Array.isArray(result.events)) return null
    const now = Date.now()
    const horizon = now + lookaheadHours * 60 * 60_000
    let best = null
    for (const e of result.events) {
      const start = new Date(e.start).getTime()
      if (!start || isNaN(start)) continue
      if (start < now || start > horizon) continue
      if (!best || start < new Date(best.start).getTime()) best = e
    }
    return best
  } catch { return null }
}

async function getRecentMailCount(ctx) {
  try {
    const result = await registry.dispatch('mail_getUnread', {}, ctx)
    if (!Array.isArray(result)) return null
    return result.length
  } catch { return null }
}

async function getLiveData(ctx) {
  // Cache-Hit innerhalb 60s
  if (Date.now() - liveDataCache.ts < LIVE_CACHE_MS) {
    return { nextEvent: liveDataCache.nextEvent, mailUnread: liveDataCache.mailUnread }
  }
  // Parallel + 3s Race-Timeout pro Quelle, damit ein hängender AppleScript-Call
  // den ganzen Chat-Turn nicht blockiert
  const [nextEvent, mailUnread] = await Promise.all([
    withTimeout(getNextEvent(ctx), LIVE_RACE_MS),
    withTimeout(getRecentMailCount(ctx), LIVE_RACE_MS)
  ])
  liveDataCache.ts = Date.now()
  liveDataCache.nextEvent = nextEvent
  liveDataCache.mailUnread = mailUnread
  return { nextEvent, mailUnread }
}

export function clearLiveDataCache() {
  liveDataCache.ts = 0
  liveDataCache.nextEvent = null
  liveDataCache.mailUnread = null
}

// ── Kontext-Block bauen ────────────────────────────────────────────────────────
/**
 * Baut den kompakten Situations-Block der vor den System-Prompt gehängt wird.
 * @param {object} ctx — Settings/Tokens-Context, wie er auch beim dispatch verwendet wird
 * @param {object} opts — { skipLiveData: bool, intent: string }
 * @returns {string} Mehrzeiliger Markdown-Block, ~100-200 Tokens
 */
export async function buildSituationContext(ctx, opts = {}) {
  const now = new Date()
  const lines = []
  lines.push('## Aktuelle Situation')

  // 1) Zeit + Tageszeit-Phase
  const dateStr = now.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })
  const timeStr = now.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
  const phase = timeOfDay(now)
  lines.push(`- ${dateStr}, ${timeStr} (${phase})`)

  // 2) Live-Daten (cached 60s + 3s race-timeout pro Quelle)
  if (!opts.skipLiveData) {
    const { nextEvent, mailUnread } = await getLiveData(ctx)
    if (nextEvent) {
      const minsUntil = Math.round((new Date(nextEvent.start).getTime() - now.getTime()) / 60000)
      const t = new Date(nextEvent.start).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
      if (minsUntil < 60) {
        lines.push(`- Nächster Termin in ${minsUntil} min: "${nextEvent.title}" um ${t}`)
      } else {
        const hours = Math.round(minsUntil / 60)
        lines.push(`- Nächster Termin in ~${hours}h: "${nextEvent.title}" um ${t}`)
      }
    }
    if (typeof mailUnread === 'number' && mailUnread > 0) {
      lines.push(`- ${mailUnread} ungelesene Mail${mailUnread === 1 ? '' : 's'}`)
    }
  }

  // 3) Session-Memory: was war zuletzt los
  if (turnCount > 0) {
    const sessionMins = Math.floor((Date.now() - sessionStartTs) / 60000)
    if (lastIntent && lastIntent !== 'multi') {
      lines.push(`- Letzte Aktion: ${lastIntent} (Session läuft seit ${sessionMins} min, ${turnCount} Turns)`)
    }
    if (lastToolCalls.length > 0) {
      lines.push(`- Zuletzt aufgerufene Tools: ${lastToolCalls.slice(0, 3).join(', ')}`)
    }
  }

  return lines.join('\n')
}

// Test-Hook
export const _internal = { timeOfDay, getNextEvent, getRecentMailCount }
