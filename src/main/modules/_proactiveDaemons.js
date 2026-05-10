// Proactive Daemons — Phase J4.
// Hintergrund-Worker die VINCI von reaktiv zu proaktiv machen.
// Jeder Daemon: eigener Cron, eigene Cooldown, eigener Settings-Toggle.
//
// Architektur-Prinzip: Module-Querverbindungen werden via registry.dispatch() angesprochen,
// damit jeder Daemon dieselben Tool-Pfade nutzt wie der Chat-Layer (kein paralleler Code).

import cron from 'node-cron'
import { Notification } from 'electron'
import { registry } from './registry.js'
import { logEvent } from './telemetry.js'

let mainWindow = null
let getSettingsHook = () => ({})

// In-Memory-Cooldowns: pro daemon-id + key letzte Trigger-Zeit
const cooldowns = new Map()

function isOnCooldown(id, key, ms) {
  const k = `${id}::${key}`
  const last = cooldowns.get(k) || 0
  if (Date.now() - last < ms) return true
  return false
}
function markFired(id, key) {
  cooldowns.set(`${id}::${key}`, Date.now())
}

function notify(title, body, opts = {}) {
  // Native macOS Notification
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, silent: opts.silent ?? false })
    n.on('click', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
        if (opts.openTab) mainWindow.webContents.send('lyra:openTab', opts.openTab)
      }
    })
    n.show()
  }
  // In-Chat-Inject + TTS (analog zum Briefing-Pfad).
  // Window MUSS sichtbar sein, sonst sieht der User die Chat-Message nicht
  // und manche TTS-Pipelines pausieren bei hidden window.
  if (mainWindow && !mainWindow.isDestroyed()) {
    const text = opts.spokenText || `${title.replace(/^[^\w]+\s*/, '')}: ${body}`
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.webContents.send('lyra:proactive', {
      text,
      module: opts.module || 'reminders'
    })
  }
}

// ── Daemon-Definitionen ─────────────────────────────────────────────────────────
const DAEMONS = [
  {
    id: 'calendar-warning',
    label: 'Termin-Vorlauf (15 min)',
    description: '15 min vor jedem Termin eine Notification.',
    schedule: '*/2 * * * *',    // alle 2 min — Calendar-Lookup ist günstig
    cooldownMs: 20 * 60 * 1000, // pro Event nur einmal in 20 min benachrichtigen
    settingsKey: 'proactive.calendarWarning',
    defaultEnabled: true,
    run: async (ctx) => {
      const result = await registry.dispatch('calendar_getEventsRaw', { daysFromNow: 0, daysAhead: 1 }, ctx)
      if (!result || !Array.isArray(result.events)) return
      const now = Date.now()
      for (const e of result.events) {
        // start ist 'YYYY-MM-DDTHH:MM' lokal interpretiert
        const start = new Date(e.start).getTime()
        if (!start || isNaN(start)) continue
        const minsUntil = Math.round((start - now) / 60000)
        // Trigger-Fenster: 10-17 min vor Event (toleriert 2-min-Polling großzügig)
        if (minsUntil < 10 || minsUntil > 17) continue
        const key = e.uid || `${e.title}-${start}`
        if (isOnCooldown('calendar-warning', key, 20 * 60_000)) continue
        markFired('calendar-warning', key)
        const timeStr = new Date(start).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
        const title = e.title || 'Termin'
        notify(
          `⏰ Termin in ${minsUntil} min`,
          `${title} um ${timeStr} Uhr`,
          {
            module: 'reminders',
            spokenText: `Alex, in ${minsUntil} Minuten hast du einen Termin: ${title} um ${timeStr} Uhr.`
          }
        )
        logEvent('daemon_fired', { daemon: 'calendar-warning', key, title: title.slice(0, 80) })
      }
    }
  }
]

// ── Public API ─────────────────────────────────────────────────────────────────
const cronJobs = new Map()  // daemonId → handle

export function setupProactiveDaemons(win, getSettings) {
  mainWindow = win
  getSettingsHook = getSettings || (() => ({}))
  rescheduleAll()
  console.log(`[ProactiveDaemons] ready, ${DAEMONS.length} daemon(s) registered`)
}

function getDaemonEnabled(daemon) {
  const s = getSettingsHook() || {}
  // Pfad "proactive.calendarWarning" auflösen
  const parts = daemon.settingsKey.split('.')
  let v = s
  for (const p of parts) v = v?.[p]
  return v === undefined ? daemon.defaultEnabled : !!v
}

export function rescheduleAll() {
  for (const [, j] of cronJobs) j.stop()
  cronJobs.clear()
  for (const d of DAEMONS) {
    if (!getDaemonEnabled(d)) {
      console.log(`[ProactiveDaemons] ${d.id} disabled, skip`)
      continue
    }
    const j = cron.schedule(d.schedule, () => runDaemon(d), { timezone: 'Europe/Vienna' })
    cronJobs.set(d.id, j)
    console.log(`[ProactiveDaemons] ${d.id} scheduled (${d.schedule})`)
  }
}

async function runDaemon(d) {
  const settings = getSettingsHook() || {}
  const ctx = { settings, getSettings: getSettingsHook }
  try {
    await d.run(ctx)
  } catch (err) {
    console.error(`[ProactiveDaemons] ${d.id} failed:`, err.message)
    logEvent('daemon_error', { daemon: d.id, error: err.message })
  }
}

export function listDaemons() {
  return DAEMONS.map(d => ({
    id: d.id,
    label: d.label,
    description: d.description,
    schedule: d.schedule,
    settingsKey: d.settingsKey,
    enabled: getDaemonEnabled(d)
  }))
}

// Manueller Trigger zum Testen — IPC kann das aufrufen
export async function runDaemonNow(id) {
  const d = DAEMONS.find(x => x.id === id)
  if (!d) return { error: 'Daemon nicht gefunden' }
  await runDaemon(d)
  return { ok: true, ranAt: new Date().toISOString() }
}
