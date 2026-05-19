// Proactive Daemons — Phase J4.
import { localISOString, localDateString } from './_localTime.js'
// Hintergrund-Worker die VINCI von reaktiv zu proaktiv machen.
// Jeder Daemon: eigener Cron, eigene Cooldown, eigener Settings-Toggle.
//
// Architektur-Prinzip: Module-Querverbindungen werden via registry.dispatch() angesprochen,
// damit jeder Daemon dieselben Tool-Pfade nutzt wie der Chat-Layer (kein paralleler Code).

import cron from 'node-cron'
import { Notification } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
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
    run: runCalendarWarning
  },
  {
    id: 'strom-anomaly',
    label: 'Strom-Anomalie',
    description: 'Wenn der aktuelle Verbrauch über deinem Schwellwert liegt.',
    schedule: '*/15 8-22 * * *',   // alle 15 min, nur tagsüber
    cooldownMs: 60 * 60 * 1000,    // 1h Cooldown
    settingsKey: 'proactive.stromAnomaly',
    defaultEnabled: true,
    run: runStromAnomaly
  },
  {
    id: 'vault-drift',
    label: 'Vault-Drift wöchentlich',
    description: 'Sonntags 18:00: prüft ob Blog-Posts ohne Wikilinks im Vault liegen.',
    schedule: '0 18 * * 0',        // Sonntag 18:00
    cooldownMs: 6 * 24 * 60 * 60 * 1000, // 6 Tage Cooldown (effektiv 1×/Woche)
    settingsKey: 'proactive.vaultDrift',
    defaultEnabled: true,
    run: runVaultDrift
  },
  {
    id: 'quarantine-reminder',
    label: 'Quarantäne-Reminder',
    description: 'Sonntags 18:30: erinnert dich an Inhalte in _quarantine/ die >14 Tage alt sind.',
    schedule: '30 18 * * 0',
    cooldownMs: 6 * 24 * 60 * 60 * 1000,
    settingsKey: 'proactive.quarantineReminder',
    defaultEnabled: true,
    run: runQuarantineReminder
  },
  {
    id: 'weekly-review',
    label: 'Weekly-Review',
    description: 'Sonntags 19:00: erstellt automatisch den Wochenrückblick als Sub-Agent-Job.',
    schedule: '0 19 * * 0',
    cooldownMs: 6 * 24 * 60 * 60 * 1000,
    settingsKey: 'proactive.weeklyReview',
    defaultEnabled: true,
    run: runWeeklyReview
  }
]

// ── Daemon-Implementierungen ────────────────────────────────────────────────────

async function runCalendarWarning(ctx) {
  const result = await registry.dispatch('calendar_getEventsRaw', { daysFromNow: 0, daysAhead: 1 }, ctx)
  if (!result || !Array.isArray(result.events)) return
  const now = Date.now()
  for (const e of result.events) {
    const start = new Date(e.start).getTime()
    if (!start || isNaN(start)) continue
    const minsUntil = Math.round((start - now) / 60000)
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

async function runStromAnomaly(ctx) {
  const settings = ctx?.settings || {}
  const thresholdW = Math.max(500, settings.proactive?.stromThresholdW || 2500)
  const result = await registry.dispatch('strom_getCurrent', {}, ctx)
  if (!result || result.available === false) return
  const currentW = Number(result.current_w || 0)
  if (!currentW || currentW < thresholdW) return
  const key = `over-${Math.floor(Date.now() / (60 * 60_000))}` // Stunden-Granularität
  if (isOnCooldown('strom-anomaly', key, 60 * 60_000)) return
  markFired('strom-anomaly', key)
  const kw = (currentW / 1000).toFixed(1)
  notify(
    `⚡ Strom-Anomalie`,
    `Aktuell ${kw} kW (Schwelle ${(thresholdW/1000).toFixed(1)} kW). Etwas eingeschaltet?`,
    {
      module: 'strom',
      spokenText: `Achtung Alex, der Stromverbrauch ist gerade auf ${kw} Kilowatt — über deinem Schwellwert von ${(thresholdW/1000).toFixed(1)}.`
    }
  )
  logEvent('daemon_fired', { daemon: 'strom-anomaly', currentW, thresholdW })
}

async function runVaultDrift(ctx) {
  const vault = ctx?.settings?.obsidian?.vaultPath
  if (!vault) return
  const sources = (ctx?.settings?.blogSources || []).filter(s => s.enabled)
  let postsWithoutMentions = 0
  let totalChecked = 0
  for (const source of sources) {
    const dir = join(vault, source.vaultFolder)
    if (!existsSync(dir)) continue
    let files
    try { files = readdirSync(dir).filter(f => f.endsWith('.md')) } catch { continue }
    for (const f of files) {
      totalChecked++
      try {
        const head = readFileSync(join(dir, f), 'utf8').slice(0, 2000)
        // mentions: [] oder kein mentions-Feld → drift-kandidat
        const m = head.match(/^mentions:\s*\[(.*?)\]/m)
        if (!m || m[1].trim() === '') postsWithoutMentions++
      } catch {}
    }
  }
  if (postsWithoutMentions < 3) return
  const key = `drift-${localDateString()}`
  if (isOnCooldown('vault-drift', key, 6 * 24 * 60 * 60_000)) return
  markFired('vault-drift', key)
  notify(
    `📚 Vault-Drift erkannt`,
    `${postsWithoutMentions} von ${totalChecked} Posts ohne Wikilinks. Body-Pass laufen lassen?`,
    {
      module: 'obsidian',
      spokenText: `Alex, ${postsWithoutMentions} Blog-Posts haben noch keine Wikilinks. Magst du den Body-Pass laufen lassen?`
    }
  )
  logEvent('daemon_fired', { daemon: 'vault-drift', postsWithoutMentions, totalChecked })
}

async function runQuarantineReminder(ctx) {
  const vault = ctx?.settings?.obsidian?.vaultPath
  if (!vault) return
  const quarDir = join(vault, 'VINCI', '_quarantine')
  if (!existsSync(quarDir)) return
  let oldestAge = 0
  let totalFiles = 0
  function walk(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) {
        try {
          const st = statSync(full)
          totalFiles++
          const age = Date.now() - st.mtimeMs
          if (age > oldestAge) oldestAge = age
        } catch {}
      }
    }
  }
  walk(quarDir)
  const ageDays = Math.floor(oldestAge / (24 * 60 * 60_000))
  if (totalFiles === 0 || ageDays < 14) return
  const key = `quar-${localDateString()}`
  if (isOnCooldown('quarantine-reminder', key, 6 * 24 * 60 * 60_000)) return
  markFired('quarantine-reminder', key)
  notify(
    `🗑 Quarantäne sichten?`,
    `${totalFiles} Datei${totalFiles === 1 ? '' : 'en'} in _quarantine/, älteste seit ${ageDays} Tagen.`,
    {
      module: 'obsidian',
      spokenText: `Alex, in der Vault-Quarantäne liegen ${totalFiles} Dateien, die älteste seit ${ageDays} Tagen. Magst du sie sichten?`
    }
  )
  logEvent('daemon_fired', { daemon: 'quarantine-reminder', totalFiles, ageDays })
}

// Triggert den Weekly-Review-Sub-Agent als Hintergrund-Job.
// Anders als die anderen Daemons macht der hier nichts selbst — er stößt einen
// Job in der Job-Queue an, und der Sub-Agent kümmert sich (gleiche Code-Pfad
// wie manueller Chat-Trigger). Cooldown 6 Tage = max 1× pro Woche.
async function runWeeklyReview(ctx) {
  const key = `weekly-${localDateString()}`
  if (isOnCooldown('weekly-review', key, 6 * 24 * 60 * 60_000)) return
  markFired('weekly-review', key)
  try {
    // Dynamic-Import um Zyklus zu vermeiden (jobRunner importiert subAgents,
    // subAgents werden u.a. von index.js geladen das auch daemons lädt).
    const { enqueueAndRun } = await import('./_jobRunner.js')
    const job = enqueueAndRun('weekly', {}, {
      user_query: 'Cron: Sonntag 19:00 Weekly-Review',
      ctx: { settings: ctx?.settings || {} }
    })
    console.log(`[Daemon weekly-review] Job ${job.id} eingereiht`)
    logEvent('daemon_fired', { daemon: 'weekly-review', jobId: job.id })
    // Notification an User
    notify(
      `📅 Wochenrückblick wird erstellt`,
      `Sub-Agent läuft, Ergebnis erscheint im Chat in ~30s.`,
      {
        module: 'briefing',
        spokenText: 'Alex, ich erstelle gerade deinen Wochenrückblick — gleich kommt er.'
      }
    )
  } catch (err) {
    console.warn('[Daemon weekly-review] enqueue failed:', err.message)
    throw err
  }
}

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
  // Fresh start — auto-disabled Daemons bekommen wieder eine Chance
  _resetDaemonFailureState()
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

// Auto-Disable bei wiederholten Fehlern. Verhindert dass im Dev-Mode (ohne TCC)
// ein crashender Daemon stündlich Dutzende AppleScript-Permission-Checks triggert
// und tccd überlastet. Reset bei App-Restart (failureCounts ist In-Memory).
const failureCounts = new Map()           // daemonId → consecutive fails
const FAILURE_THRESHOLD = 3                // ab 3 Fehlern wird der Daemon gestoppt
const autoDisabled = new Set()             // disable bis App-Restart

async function runDaemon(d) {
  if (autoDisabled.has(d.id)) return       // bereits auto-disabled
  const settings = getSettingsHook() || {}
  const ctx = { settings, getSettings: getSettingsHook }
  try {
    await d.run(ctx)
    failureCounts.delete(d.id)             // Reset bei Erfolg
  } catch (err) {
    const count = (failureCounts.get(d.id) || 0) + 1
    failureCounts.set(d.id, count)
    console.error(`[ProactiveDaemons] ${d.id} failed (${count}/${FAILURE_THRESHOLD}):`, err.message)
    logEvent('daemon_error', { daemon: d.id, error: err.message, consecutive: count })
    if (count >= FAILURE_THRESHOLD) {
      autoDisabled.add(d.id)
      const job = cronJobs.get(d.id)
      if (job) { job.stop(); cronJobs.delete(d.id) }
      console.warn(`[ProactiveDaemons] ${d.id} auto-disabled nach ${count} Fehlern in Folge (Reaktivierung: App-Neustart oder Settings)`)
      logEvent('daemon_auto_disabled', { daemon: d.id, reason: 'consecutive_failures', count })
    }
  }
}

export function _resetDaemonFailureState() {
  failureCounts.clear()
  autoDisabled.clear()
}

export function isDaemonAutoDisabled(id) {
  return autoDisabled.has(id)
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
  return { ok: true, ranAt: localISOString() }
}
