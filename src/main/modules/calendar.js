import { exec, execFile } from 'child_process'
import { localDateString } from './_localTime.js'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureAppRunning } from './_appLauncher.js'

// icalBuddy kann auf Apple Silicon (/opt/homebrew) oder Intel (/usr/local) liegen.
const ICAL_CANDIDATES = [
  '/opt/homebrew/bin/icalBuddy',
  '/usr/local/bin/icalBuddy',
  '/opt/local/bin/icalBuddy'
]
const ICAL = ICAL_CANDIDATES.find(p => existsSync(p)) || '/opt/homebrew/bin/icalBuddy'
const SKIP = ['Your-Campus-Events','Feiertage','Siri-Vorschläge','Geplante Erinnerungen','Österreichische Feiertage']

export const calendarModule = {
  name: 'calendar',
  description: 'macOS Calendar: Termine lesen und erstellen',

  actions: {
    getToday:     async () => {
      const todayISO = localDateString()
      let icalFailed = false
      // Versuche icalBuddy zuerst (schnell), bei "No calendars" Fallback auf AppleScript
      try {
        let raw = await runIcal('eventsToday')
        if (!parseIcal(raw, { defaultDate: todayISO }).length) {
          raw = await runIcal('eventsFrom:today to:today+1')
        }
        const result = buildResult(raw, { onlyDate: todayISO, defaultDate: todayISO })
        if (result.termine.length > 0) return result
      } catch (err) {
        icalFailed = true
        console.log('[Calendar] icalBuddy fehlgeschlagen, Fallback auf AppleScript:', err.message.slice(0, 80))
      }
      // AppleScript-Fallback — bei TCC-Denial NICHT throwen, sondern Error-Signal
      try {
        const events = await getEventsViaAS(0, 1)
        return buildResultFromASEvents(events, { onlyDate: todayISO })
      } catch (err) {
        console.warn('[Calendar] getToday: beide Pfade fehlgeschlagen:', err.message.slice(0, 120))
        return {
          termine: [],
          error: icalFailed
            ? 'Kalender-Zugriff nicht möglich (icalBuddy + AppleScript fehlgeschlagen — TCC-Permission im Dev-Modus?)'
            : `Kalender-Zugriff fehlgeschlagen: ${err.message.slice(0, 120)}`
        }
      }
    },
    getUpcoming:  async ({ days = 3 } = {}) => {
      const d = Math.round(Number(days) || 3)
      try {
        const raw = await runIcal(`eventsFrom:today to:${dateOffset(d)}`)
        const result = buildResult(raw)
        if (result.termine.length > 0) return result
      } catch (err) {
        console.log('[Calendar] icalBuddy fehlgeschlagen, Fallback auf AppleScript:', err.message.slice(0, 80))
      }
      const events = await getEventsViaAS(0, d)
      return buildResultFromASEvents(events)
    },
    // Direct-Access-Action für proaktive Daemons + Test
    getEventsRaw: async ({ daysFromNow = 0, daysAhead = 1 } = {}) => {
      try {
        const raw = await runIcal(`eventsFrom:today to:${dateOffset(daysAhead)}`)
        const parsed = parseIcal(raw)
        if (parsed.length > 0) return { events: parsed.map(toASEventShape), source: 'icalBuddy' }
      } catch {}
      try {
        const events = await getEventsViaAS(daysFromNow, daysAhead)
        return { events, source: 'applescript' }
      } catch (err) {
        return {
          events: [],
          source: 'none',
          error: `Kalender-Zugriff nicht möglich (${err.message.slice(0, 100)})`
        }
      }
    },
    getCalendars: async () => {
      await ensureAppRunning('Calendar')
      const raw  = await runAS(`tell application "Calendar"\nset out to ""\nrepeat with c in calendars\nset out to out & (title of c) & ";;;"\nend repeat\nreturn out\nend tell`)
      return { calendars: raw.split(';;;').map(s=>s.trim()).filter(Boolean) }
    },
    createEvent: async ({ title, date, startTime, endTime, calendar, location, notes } = {}) => {
      if (!title||!date) return { error: 'Titel und Datum erforderlich' }
      if (!calendar)     return { error: 'Kein Kalender angegeben.' }
      const d = resolveDate(date)
      if (!d) return { error: `Datum nicht erkannt: ${date}` }
      await ensureAppRunning('Calendar')
      const [sh,sm] = (startTime||'09:00').split(':').map(Number)
      const [eh,em] = (endTime||incTime(startTime||'09:00',60)).split(':').map(Number)
      const [y,mo,day] = [d.getFullYear(),d.getMonth()+1,d.getDate()]
      try {
        const uid = await runAS(`tell application "Calendar"\ntell calendar "${esc(calendar)}"\nset sd to current date\nset year of sd to ${y}\nset month of sd to ${mo}\nset day of sd to ${day}\nset hours of sd to ${sh}\nset minutes of sd to ${sm}\nset seconds of sd to 0\nset ed to current date\nset year of ed to ${y}\nset month of ed to ${mo}\nset day of ed to ${day}\nset hours of ed to ${eh}\nset minutes of ed to ${em}\nset seconds of ed to 0\nset e to make new event with properties {summary:"${esc(title)}", start date:sd, end date:ed}\n${location?`set location of e to "${esc(location)}"`:''}${notes?`\nset description of e to "${esc(notes)}"`:''}
return uid of e\nend tell\nend tell`)
        return { ok:true, message:`Termin "${title}" am ${day}.${mo}.${y} um ${startTime||'09:00'} in "${calendar}" eingetragen.`, uid:uid.trim() }
      } catch(err) { return { error:err.message } }
    },
    deleteEvent: async ({ uid, title } = {}) => {
      if (!uid&&!title) return { error:'UID oder Titel erforderlich' }
      await ensureAppRunning('Calendar')
      const r = await runAS(`tell application "Calendar"\nrepeat with c in calendars\ntry\nset m to (every event of c whose ${uid?`uid is "${esc(uid)}"`:`summary is "${esc(title)}"`})\nif length of m > 0 then\ndelete item 1 of m\nreturn "deleted"\nend if\nend try\nend repeat\nreturn "not found"\nend tell`)
      return r.includes('deleted') ? {ok:true,message:'Termin gelöscht.'} : {ok:false,message:'Termin nicht gefunden.'}
    }
  },

  tools: [
    { name:'calendar_getCalendars', description:'Alle Kalender. Vor createEvent aufrufen.', parameters:{type:'object',properties:{}} },
    { name:'calendar_getToday',     description:'Termine heute.',                          parameters:{type:'object',properties:{}} },
    { name:'calendar_getUpcoming',  description:'Bevorstehende Termine (days=Anzahl Tage).', parameters:{type:'object',properties:{days:{type:'number'}}} },
    { name:'calendar_createEvent',  description:'Termin anlegen. IMMER zuerst getCalendars, dann Benutzer fragen.',
      parameters:{type:'object',required:['title','date','calendar'],properties:{title:{type:'string'},date:{type:'string'},startTime:{type:'string'},endTime:{type:'string'},calendar:{type:'string'},location:{type:'string'},notes:{type:'string'}}}},
    { name:'calendar_deleteEvent',  description:'Termin löschen.',
      parameters:{type:'object',properties:{uid:{type:'string'},title:{type:'string'}}} }
  ]
}

// ── icalBuddy mit kontrolliertem, locale-unabhängigem Output ───────────────────
function runIcal(args) {
  return new Promise((resolve, reject) => {
    if (!existsSync(ICAL)) {
      const msg = `icalBuddy nicht gefunden. Geprüft: ${ICAL_CANDIDATES.join(', ')}`
      console.error('[Calendar]', msg)
      return reject(new Error(msg))
    }
    const userArgv = args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(s => s.replace(/^"|"$/g, '')) || []
    // Format-Flags: erzwingen ein deterministisches, locale-unabhängiges Format
    //  -nrd:    keine relativen Daten (today/heute → echtes Datum)
    //  -df/-tf: ISO-Datum + 24h-Zeit
    //  -uid:    UIDs für Deduplikation
    //  -nc:     keine Kalendernamen
    //  -b "* ": deterministisches Bullet
    const fmtArgv = ['-nc', '-nrd', '-df', '%Y-%m-%d', '-tf', '%H:%M', '-b', '* ', '-uid']
    const argv = [...fmtArgv, ...userArgv]
    console.log('[Calendar] exec:', ICAL, argv.join(' '))
    execFile(ICAL, argv, {
      timeout: 15000,
      env: {
        ...process.env,
        HOME: process.env.HOME,
        USER: process.env.USER,
        // Englisch erzwingen, damit Property-Namen wie "location:" stabil bleiben
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
      }
    }, (err, stdout, stderr) => {
      if (err) {
        const hint = stderr?.includes('not authorized') || stderr?.includes('access')
          ? ' (TCC-Berechtigung fehlt)'
          : ''
        // Stilles Logging bei "No calendars" — bekanntes dev-Mode-Issue, AppleScript-Fallback springt ein
        if (!stderr?.includes('No calendars')) {
          console.error('[Calendar] icalBuddy error:', err.message, stderr?.slice(0,200), hint)
        }
        return reject(new Error(err.message + hint))
      }
      console.log('[Calendar] icalBuddy ok, lines:', stdout.split('\n').length)
      console.log('[Calendar] raw output:\n' + stdout.split('\n').slice(0, 30).join('\n'))
      resolve(stdout)
    })
  })
}

// ── Robuster Parser für deterministisches Format ───────────────────────────────
// Format pro Event nach unseren Flags:
//   * Titel
//       location: <Ort>
//       notes: <…>
//       uid: <UUID>
//       2026-04-26 at 12:00 - 14:00          (mit Zeit)
//       2026-04-26                            (ganztägig 1 Tag)
//       2026-04-26 - 2026-04-27               (ganztägig mehrere Tage)
//       2026-04-26 at 23:00 - 2026-04-27 at 01:00  (mit Zeit, mehrtägig)
const RE_BULLET    = /^[*•]\s+(.+)$/
const RE_DATE_LINE = /^(\d{4})-(\d{2})-(\d{2})(?:\s+\S+\s+(\d{1,2}):(\d{2}))?(?:\s*-\s*(?:(\d{4})-(\d{2})-(\d{2})\s+\S+\s+)?(\d{1,2}):(\d{2}))?$/
const RE_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:\s*-\s*(\d{4})-(\d{2})-(\d{2}))?$/
// Reine Uhrzeit ohne Datum: "12:00", "12:00 - 14:00"
// Tritt bei eventsToday auf, weil icalBuddy das Datum weglässt, wenn alle Events
// am selben Tag sind. Wir füllen das Datum dann mit dem defaultDate-Argument auf.
const RE_TIME_ONLY = /^(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?$/
const RE_LOC       = /^(?:location|Ort):\s*(.+)$/i
const RE_NOTES     = /^(?:notes|Notizen):/i
const RE_URL       = /^(?:url|URL):/i
const RE_UID       = /^uid:\s*(.+)$/i

function parseIcal(raw, opts = {}) {
  const defaultDate = opts.defaultDate || null  // 'YYYY-MM-DD'
  if (!raw?.trim()) return []
  const events = []
  const lines = raw.split('\n')
  let cur = null

  const flush = () => {
    if (cur && cur.title && cur.title.trim()) {
      // Falls nur Uhrzeit gefunden wurde, defaultDate als Datum nehmen
      if (!cur.startDate && cur.startTime && defaultDate) {
        cur.startDate = defaultDate
        cur.endDate   = defaultDate
      }
      events.push(cur)
    }
    cur = null
  }

  for (const line of lines) {
    if (!line.trim()) continue
    const t = line.trim()

    // Bullet-Zeile = potenziell neuer Termin, egal wie tief eingerückt.
    // ABER: icalBuddy schreibt Datums-Header manchmal auch als Bullet
    // (z. B. "• today" oder "• 2026-04-26") — die müssen ausgeschlossen werden.
    const bm = t.match(RE_BULLET)
    if (bm) {
      const title = bm[1].trim()
      const isDateHeader = /^(today|tomorrow|yesterday|day after tomorrow|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4}|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?)\b/i.test(title)
      if (isDateHeader) {
        flush()  // schließe vorigen Termin ab, aber kein neuer
        continue
      }
      flush()
      cur = {
        title:     title,
        uid:       null,
        location:  '',
        startDate: null,
        startTime: null,
        endDate:   null,
        endTime:   null,
        allDay:    true
      }
      continue
    }

    if (!cur) continue

    const dm = t.match(RE_DATE_LINE)
    if (dm) {
      cur.startDate = `${dm[1]}-${dm[2]}-${dm[3]}`
      if (dm[4] !== undefined) {
        cur.startTime = `${dm[4].padStart(2,'0')}:${dm[5]}`
        cur.allDay = false
      }
      cur.endDate = dm[7] ? `${dm[7]}-${dm[8]}-${dm[9]}` : cur.startDate
      if (dm[10] !== undefined) cur.endTime = `${dm[10].padStart(2,'0')}:${dm[11]}`
      continue
    }
    const dom = t.match(RE_DATE_ONLY)
    if (dom && !cur.startDate) {
      cur.startDate = `${dom[1]}-${dom[2]}-${dom[3]}`
      cur.endDate   = dom[4] ? `${dom[4]}-${dom[5]}-${dom[6]}` : cur.startDate
      cur.allDay    = true
      continue
    }
    // Reine Uhrzeit-Zeile (z. B. "12:00 - 14:00") — Datum wird in flush() ergänzt
    const tom = t.match(RE_TIME_ONLY)
    if (tom) {
      cur.startTime = `${tom[1].padStart(2,'0')}:${tom[2]}`
      cur.allDay    = false
      if (tom[3] !== undefined) cur.endTime = `${tom[3].padStart(2,'0')}:${tom[4]}`
      continue
    }
    const um = t.match(RE_UID)
    if (um) { cur.uid = um[1].trim(); continue }
    const lm = t.match(RE_LOC)
    if (lm) { cur.location = lm[1].trim(); continue }
    if (RE_NOTES.test(t) || RE_URL.test(t)) continue
  }
  flush()

  // Deduplikation: gleicher UID + gleiche Startzeit
  const seen = new Set()
  return events.filter(e => {
    const key = `${e.uid || e.title}|${e.startDate}|${e.startTime || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildResult(raw, opts = {}) {
  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const WDAY  = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']
  const termine = []

  // defaultDate für reine Uhrzeit-Zeilen (eventsToday liefert oft kein Datum)
  const defaultDate = opts.defaultDate || opts.onlyDate || null
  for (const e of parseIcal(raw, { defaultDate })) {
    if (!e.startDate) continue
    // Wenn nur ein bestimmtes Datum gewünscht ist (z. B. nur heute), filtern.
    if (opts.onlyDate && e.startDate !== opts.onlyDate) continue
    const [y, mo, d] = e.startDate.split('-').map(Number)
    let date
    if (e.allDay) {
      date = new Date(y, mo - 1, d)
    } else {
      const [h, m] = e.startTime.split(':').map(Number)
      date = new Date(y, mo - 1, d, h, m, 0, 0)
    }

    // Vergangene, nicht-ganztägige Termine ausblenden
    if (!e.allDay && date < now) continue
    // Vergangene ganztägige Termine ausblenden, wenn der Tag komplett vorbei ist
    if (e.allDay) {
      const dDay = new Date(y, mo - 1, d)
      if (dDay < today) continue
    }

    const title   = e.title.replace(/\s*\([^)]{1,25}\)\s*$/, '').trim() || e.title
    const loc     = e.location ? e.location.split(',')[0].trim() : null
    const dDay    = new Date(y, mo - 1, d)
    const diff    = Math.round((dDay - today) / 86400000)
    const label   = diff === 0 ? 'heute'
                  : diff === 1 ? 'morgen'
                  : diff === 2 ? 'übermorgen'
                  : WDAY[dDay.getDay()]
    const dateStr = dDay.toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })
    const timeStr = e.allDay
                  ? 'ganztägig'
                  : `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')} Uhr`
    let entry = `${label} ${dateStr}, ${timeStr}: ${title}`
    if (loc) entry += ` (${loc})`
    termine.push(entry)
  }

  return {
    aktuelle_uhrzeit: now.toLocaleString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
    termine
  }
}

// ── AppleScript runner ─────────────────────────────────────────────────────────
function runAS(script, timeoutMs = 15000) {
  return new Promise((resolve,reject) => {
    const f=join(tmpdir(),`vinci-cal-${Date.now()}.applescript`)
    writeFileSync(f,script,'utf8')
    const timer=setTimeout(()=>{cleanup();reject(new Error('Timeout'))},timeoutMs)
    execFile('osascript',[f],{ maxBuffer: 5_000_000 },(err,stdout,stderr)=>{
      clearTimeout(timer);cleanup()
      if(err)return reject(new Error(stderr?.trim()||err.message))
      resolve(stdout.trim())
    })
    function cleanup(){try{unlinkSync(f)}catch{}}
  })
}

function resolveDate(input) {
  const s=(input||'').toLowerCase().trim(),b=new Date();b.setHours(0,0,0,0)
  if(s==='heute')return b
  if(s==='morgen')return new Date(b.getTime()+86400000)
  if(s==='übermorgen')return new Date(b.getTime()+2*86400000)
  const dm=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);if(dm){const y=dm[3].length===2?2000+parseInt(dm[3]):parseInt(dm[3]);return new Date(y,parseInt(dm[2])-1,parseInt(dm[1]))}
  const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(iso)return new Date(parseInt(iso[1]),parseInt(iso[2])-1,parseInt(iso[3]))
  return null
}
function incTime(t,mins){const[h,m]=t.split(':').map(Number),tot=h*60+m+mins;return`${String(Math.floor(tot/60)%24).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`}
function esc(s){return(s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"')}
function dateOffset(days){const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().split('T')[0]}

// ── AppleScript-Fallback für Calendar-Zugriff ─────────────────────────────────
// Wird auf modernen macOS-Versionen (>= 26) gebraucht, weil icalBuddy oft
// "No calendars" returnt obwohl Calendar.app über AppleScript voll zugreifbar ist.
async function getEventsViaAS(daysFromNow = 0, daysAhead = 1) {
  const script = `tell application "Calendar"
  set startD to (current date)
  set hours of startD to 0
  set minutes of startD to 0
  set seconds of startD to 0
  set startD to startD + (${daysFromNow} * days)
  set endD to startD + (${daysAhead} * days)
  set output to ""
  repeat with cal in calendars
    try
      set theEvents to (every event of cal whose start date >= startD and start date < endD)
      repeat with ev in theEvents
        set d to start date of ev
        set yr to (year of d) as string
        set mo to text -2 thru -1 of ("0" & ((month of d as integer) as string))
        set dy to text -2 thru -1 of ("0" & ((day of d) as string))
        set hr to text -2 thru -1 of ("0" & ((hours of d) as string))
        set mn to text -2 thru -1 of ("0" & ((minutes of d) as string))
        set isoStr to yr & "-" & mo & "-" & dy & "T" & hr & ":" & mn
        set output to output & (summary of ev) & "§" & isoStr & "§" & (uid of ev) & "§" & (name of cal) & linefeed
      end repeat
    end try
  end repeat
  return output
end tell`
  const raw = await runAS(script, 12000)
  const events = []
  for (const line of (raw || '').split('\n')) {
    const parts = line.split('§')
    if (parts.length < 4) continue
    const [title, iso, uid, calName] = parts
    if (!title || !iso) continue
    events.push({
      title:    title.trim(),
      start:    iso.trim(),  // ISO ohne Sekunden, ohne TZ — lokale Zeit
      uid:      (uid || '').trim() || null,
      calendar: (calName || '').trim()
    })
  }
  return events
}

// AppleScript-Events → buildResult-kompatibles Format
function buildResultFromASEvents(events, opts = {}) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const WDAY = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']
  const termine = []
  const onlyDate = opts.onlyDate

  for (const e of events || []) {
    const m = e.start.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
    if (!m) continue
    const [_, y, mo, d, h, mn] = m
    const dateOnly = `${y}-${mo}-${d}`
    if (onlyDate && dateOnly !== onlyDate) continue
    const evDate = new Date(+y, +mo - 1, +d, +h, +mn, 0, 0)
    if (evDate < now) continue  // vergangene überspringen
    const dDay = new Date(+y, +mo - 1, +d)
    const diff = Math.round((dDay - today) / 86400000)
    const label = diff === 0 ? 'heute' : diff === 1 ? 'morgen' : diff === 2 ? 'übermorgen' : WDAY[dDay.getDay()]
    const dateStr = dDay.toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })
    const timeStr = `${h}:${mn} Uhr`
    let entry = `${label} ${dateStr}, ${timeStr}: ${e.title}`
    if (e.calendar && !SKIP.includes(e.calendar)) entry += ` [${e.calendar}]`
    termine.push(entry)
  }
  return {
    aktuelle_uhrzeit: now.toLocaleString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
    termine
  }
}

// icalBuddy-Event → AppleScript-Event-Shape (für getEventsRaw)
function toASEventShape(icalEv) {
  const start = icalEv.allDay
    ? `${icalEv.startDate}T00:00`
    : `${icalEv.startDate}T${icalEv.startTime || '00:00'}`
  return {
    title:    icalEv.title,
    start,
    uid:      icalEv.uid,
    calendar: '' // icalBuddy mit -nc liefert keinen Calendar-Namen
  }
}
