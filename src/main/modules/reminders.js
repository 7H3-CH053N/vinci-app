import { execFile } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureAppRunning } from './_appLauncher.js'

export const remindersModule = {
  name: 'reminders',
  description: 'macOS Reminders: Aufgaben lesen, erstellen, Listen anzeigen',

  actions: {
    getLists: async () => {
      await ensureAppRunning('Reminders')
      const script = `tell application "Reminders"
  set output to ""
  repeat with aList in every list
    set output to output & (name of aList) & ";;;"
  end repeat
  return output
end tell`
      const raw = await runAppleScript(script)
      const lists = raw.split(';;;').map(s => s.trim()).filter(Boolean)
      console.log('[Reminders] Lists:', lists)
      return { lists }
    },

    getToday: async () => {
      await ensureAppRunning('Reminders')
      const script = `tell application "Reminders"
  set output to ""
  set today to current date
  set startOfDay to today - (time of today)
  set endOfDay to startOfDay + 86399
  repeat with aList in every list
    repeat with r in (reminders in aList whose completed is false)
      try
        set d to due date of r
        if d >= startOfDay and d <= endOfDay then
          set output to output & "REM:" & (name of r) & "|L:" & (name of aList) & ";;;"
        end if
      end try
    end repeat
  end repeat
  return output
end tell`
      return parseReminders(await runAppleScript(script))
    },

    getAll: async ({ listName = null } = {}) => {
      await ensureAppRunning('Reminders')
      const script = `tell application "Reminders"
  set output to ""
  repeat with aList in every list
    set lName to name of aList
    repeat with r in (reminders in aList whose completed is false)
      set output to output & "REM:" & (name of r) & "|L:" & lName & ";;;"
    end repeat
  end repeat
  return output
end tell`
      let results = parseReminders(await runAppleScript(script))
      if (listName) results = results.filter(r => r.list.toLowerCase() === listName.toLowerCase())
      return results
    },

    deleteReminder: async ({ title, listName } = {}) => {
      if (!title) return { error: 'Titel erforderlich' }
      await ensureAppRunning('Reminders')

      const calClause = listName
        ? `tell list "${escapeAS(listName)}"`
        : 'repeat with aList in every list'

      const script = listName ? `
tell application "Reminders"
  tell list "${escapeAS(listName)}"
    set matches to (every reminder whose name is "${escapeAS(title)}" and completed is false)
    if length of matches > 0 then
      delete item 1 of matches
      return "deleted"
    end if
  end tell
  return "not found"
end tell` : `
tell application "Reminders"
  repeat with aList in every list
    try
      set matches to (every reminder in aList whose name is "${escapeAS(title)}" and completed is false)
      if length of matches > 0 then
        delete item 1 of matches
        return "deleted"
      end if
    end try
  end repeat
  return "not found"
end tell`

      try {
        const result = await runAppleScript(script)
        console.log('[Reminders] delete result:', result)
        if (result.includes('not found')) {
          return { ok: false, message: `Aufgabe "${title}" nicht gefunden.` }
        }
        return { ok: true, message: `Aufgabe "${title}" wurde gelöscht.` }
      } catch (err) {
        console.error('[Reminders] deleteReminder error:', err.message)
        return { error: err.message }
      }
    },

        createReminder: async ({ title, listName, dueDate, dueTime, notes } = {}) => {
      if (!title)    return { error: 'Titel ist erforderlich' }
      if (!listName) return { error: 'Kein Liste angegeben. Bitte zuerst getLists aufrufen und den Benutzer fragen.' }

      let dueLine = ''
      if (dueDate) {
        const d = resolveDate(dueDate)
        if (d) {
          const [y, mo, day] = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
          const [h, m] = dueTime ? dueTime.split(':').map(Number) : [9, 0]
          dueLine = `set due date of newReminder to (${y * 10000 + mo * 100 + day} as string as date)`
          // Use a simpler approach for due date
          dueLine = `
    set dueDate to current date
    set year of dueDate to ${y}
    set month of dueDate to ${mo}
    set day of dueDate to ${day}
    set hours of dueDate to ${h}
    set minutes of dueDate to ${m}
    set seconds of dueDate to 0
    set due date of newReminder to dueDate`
        }
      }

      const notesLine = notes ? `set body of newReminder to "${escapeAS(notes)}"` : ''

      const script = `tell application "Reminders"
  tell list "${escapeAS(listName)}"
    set newReminder to make new reminder with properties {name:"${escapeAS(title)}"}
    ${dueLine}
    ${notesLine}
    return name of newReminder
  end tell
end tell`

      try {
        const result = await runAppleScript(script)
        console.log('[Reminders] Created:', result.trim())
        return {
          ok: true,
          message: `Aufgabe "${title}" wurde in "${listName}" eingetragen.${dueDate ? ` Fällig: ${dueDate}${dueTime ? ' um ' + dueTime : ''}.` : ''}`
        }
      } catch (err) {
        console.error('[Reminders] createReminder error:', err.message)
        if (err.message.includes("can't get list")) {
          return { error: `Liste "${listName}" nicht gefunden. Bitte getLists aufrufen.` }
        }
        return { error: err.message }
      }
    }
  },

  tools: [
    {
      name: 'reminders_getLists',
      description: 'Gibt alle Reminder-Listen zurück. Vor dem Anlegen einer Aufgabe aufrufen um den Benutzer nach der richtigen Liste zu fragen.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'reminders_getToday',
      description: 'Holt alle Erinnerungen die heute fällig sind',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'reminders_getAll',
      description: 'Holt alle offenen Erinnerungen, optional gefiltert nach Liste',
      parameters: {
        type: 'object',
        properties: {
          listName: { type: 'string', description: 'Listenname (optional)' }
        }
      }
    },
    {
      name: 'reminders_deleteReminder',
      description: 'Löscht eine offene Aufgabe/Erinnerung anhand des Titels.',
      parameters: {
        type: 'object',
        properties: {
          title:    { type: 'string', description: 'Exakter Titel der Aufgabe' },
          listName: { type: 'string', description: 'Listenname zur Eingrenzung (optional)' }
        },
        required: ['title']
      }
    },
        {
      name: 'reminders_createReminder',
      description: 'Erstellt eine neue Aufgabe/Erinnerung. WICHTIG: Zuerst getLists aufrufen, dann Benutzer fragen in welche Liste.',
      parameters: {
        type: 'object',
        properties: {
          title:    { type: 'string', description: 'Titel der Aufgabe' },
          listName: { type: 'string', description: 'Exakter Listenname aus getLists' },
          dueDate:  { type: 'string', description: 'Fälligkeitsdatum: z.B. "morgen", "27.4.2026" (optional)' },
          dueTime:  { type: 'string', description: 'Fälligkeitszeit HH:MM (optional)' },
          notes:    { type: 'string', description: 'Notizen (optional)' }
        },
        required: ['title', 'listName']
      }
    }
  ]
}

function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    const tmpFile = join(tmpdir(), `lyra-rem-${Date.now()}.applescript`)
    writeFileSync(tmpFile, script.trim(), 'utf8')
    const timer = setTimeout(() => { cleanup(); reject(new Error('Reminders Timeout')) }, 15000)
    execFile('osascript', [tmpFile], (err, stdout, stderr) => {
      clearTimeout(timer); cleanup()
      if (err) {
        const msg = stderr?.trim() || err.message
        if (msg.includes('not allowed')) reject(new Error('Reminders-Zugriff verweigert. Systemeinstellungen → Datenschutz → Erinnerungen → Lyra ✓'))
        else reject(new Error(msg))
        return
      }
      resolve(stdout.trim())
    })
    function cleanup() { try { unlinkSync(tmpFile) } catch {} }
  })
}

function resolveDate(input) {
  if (!input) return null
  const s = input.trim().toLowerCase()
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (s === 'heute')      return base
  if (s === 'morgen')     return new Date(base.getTime() + 86400000)
  if (s === 'übermorgen') return new Date(base.getTime() + 2 * 86400000)
  const dm = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (dm) {
    const y = dm[3].length === 2 ? 2000 + parseInt(dm[3]) : parseInt(dm[3])
    return new Date(y, parseInt(dm[2]) - 1, parseInt(dm[1]))
  }
  return null
}

function escapeAS(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function parseReminders(raw) {
  if (!raw?.trim()) return []
  const results = []
  for (const block of raw.split(';;;').filter(Boolean)) {
    const title = block.match(/REM:([^|]+)/)?.[1]?.trim()
    const list  = block.match(/\|L:(.+)/)?.[1]?.trim()
    if (title) results.push({ title, list: list || '' })
  }
  return results
}
