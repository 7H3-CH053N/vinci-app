// Lokale-Zeit-Helfer.
//
// Alle für Menschen sichtbaren Timestamps (Briefing-Frontmatter, Job-Stempel,
// Vault-Notes) sollen in der lokalen Zeitzone formatiert werden — sonst zeigt
// Obsidian "2026-05-19T19:34Z" obwohl es bei Alex eigentlich 21:34 ist.
//
// Wir benutzen Europe/Vienna fest, weil VINCI ein Werkzeug für Alex ist.
// Falls jemand mal reist, kann das hier zentral angepasst werden.

export const VINCI_TZ = 'Europe/Vienna'

/**
 * ISO-8601 mit lokalem Offset, z.B. "2026-05-19T21:34:00+02:00".
 * Anders als `new Date().toISOString()` (UTC, mit Z-Suffix).
 *
 * @param {Date} [d] — default jetzt
 * @returns {string}
 */
export function localISOString(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: VINCI_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map(p => [p.type, p.value])
  )
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  const dateStr = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${ms}`

  // Offset berechnen: lokale Zeit als wäre sie UTC, minus echte UTC = offset in ms
  const localAsUTCms = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  )
  const realUTCms = d.getTime() - (d.getTime() % 1000)  // sec-truncated für Konsistenz
  const offsetMin = Math.round((localAsUTCms - realUTCms) / 60000)
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const oh = String(Math.floor(abs / 60)).padStart(2, '0')
  const om = String(abs % 60).padStart(2, '0')

  return `${dateStr}${sign}${oh}:${om}`
}

/** Lokales Datum als "YYYY-MM-DD". */
export function localDateString(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: VINCI_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit'
  })
  return fmt.format(d)
}

/** Lokale Uhrzeit als "HH:mm". */
export function localTimeString(d = new Date()) {
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: VINCI_TZ,
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d)
}

/** Format wie "Dienstag, 19. Mai 2026" — voll ausgeschrieben, deutsch. */
export function localDateLong(d = new Date()) {
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: VINCI_TZ,
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(d)
}

/**
 * ISO-Wochennummer (Mo-So, EU-Standard) im Format "2026-W21".
 * Lokal in Vienna berechnet.
 */
export function localISOWeek(d = new Date()) {
  // Verwende lokales Datum in Vienna
  const localDateStr = localDateString(d)
  const [year, month, day] = localDateStr.split('-').map(Number)
  // ISO-8601: Donnerstag der gleichen Woche bestimmt das Jahr
  const target = new Date(Date.UTC(year, month - 1, day))
  const dayOfWeek = target.getUTCDay() || 7   // So=7, Mo=1
  target.setUTCDate(target.getUTCDate() + 4 - dayOfWeek)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((target - yearStart) / 86400000 + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/** Start (Mo 00:00) der ISO-Woche eines Datums, als Date. */
export function startOfISOWeek(d = new Date()) {
  const localDateStr = localDateString(d)
  const [year, month, day] = localDateStr.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1, day))
  const dayOfWeek = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() - (dayOfWeek - 1))
  target.setUTCHours(0, 0, 0, 0)
  return target
}
