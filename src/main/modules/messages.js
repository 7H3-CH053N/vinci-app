// ── Messages (iMessage / SMS) ──────────────────────────────────────────────────
// Lesezugriff direkt auf die SQLite-DB, Senden via AppleScript.
//
// PERMISSIONS:
//   • Lesen: VINCI braucht "Full Disk Access" (Systemeinstellungen → Datenschutz
//     → Festplatte → VINCI aktivieren). Sonst gibt sqlite3 ein "unable to open"
//     zurück und das Tool liefert eine klare Fehlermeldung.
//   • Senden: AppleScript-Permission für Messages-App (haben wir bereits via
//     NSAppleEventsUsageDescription).
//
// PRIVATSPHÄRE:
//   • Messages-Inhalte werden mit dem `tainted`-Flag in der Konversation
//     gespeichert → Memory-Worker filtert sie raus, Hard-Block verhindert
//     unbeabsichtigtes Speichern.
//
// SENDEN:
//   • Two-Step: 1. Aufruf ohne confirmed → Vorschau zurück.
//                2. Aufruf mit confirmed:true → tatsächlich senden.

import { execFile } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { ensureAppRunning } from './_appLauncher.js'

const CHAT_DB = join(homedir(), 'Library/Messages/chat.db')

export const messagesModule = {
  name: 'messages',
  description: 'iMessage/SMS auf macOS: letzte Nachrichten lesen, ungelesene zählen, antworten/senden',

  actions: {
    getRecent: async ({ limit = 20 } = {}) => {
      const n = clamp(limit, 1, 100)
      const sql = `
        SELECT
          m.ROWID                                                        AS id,
          COALESCE(m.text, '')                                           AS text,
          datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') AS ts,
          m.is_from_me                                                   AS from_me,
          m.is_read                                                      AS is_read,
          COALESCE(h.id, '')                                             AS handle,
          COALESCE(c.display_name, '')                                   AS chat_name,
          COALESCE(c.service_name, '')                                   AS service
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.text IS NOT NULL AND length(m.text) > 0
        ORDER BY m.date DESC
        LIMIT ${n};
      `
      try {
        const rows = await querySqlite(sql)
        return { count: rows.length, messages: rows.map(formatMessage) }
      } catch (err) {
        return { error: err.message }
      }
    },

    getUnread: async () => {
      const sql = `
        SELECT COUNT(*) AS n
        FROM message m
        WHERE m.is_from_me = 0 AND m.is_read = 0 AND length(m.text) > 0;
      `
      try {
        const rows = await querySqlite(sql)
        return { unread: rows[0]?.n || 0 }
      } catch (err) {
        return { error: err.message }
      }
    },

    search: async ({ query, limit = 20 } = {}) => {
      if (!query?.trim()) return { error: 'query erforderlich' }
      const q = query.replace(/'/g, "''")  // escape für SQL-Literal
      const n = clamp(limit, 1, 100)
      const sql = `
        SELECT
          m.ROWID                                                        AS id,
          COALESCE(m.text, '')                                           AS text,
          datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') AS ts,
          m.is_from_me                                                   AS from_me,
          m.is_read                                                      AS is_read,
          COALESCE(h.id, '')                                             AS handle,
          COALESCE(c.display_name, '')                                   AS chat_name
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE length(m.text) > 0
          AND (h.id LIKE '%${q}%' OR c.display_name LIKE '%${q}%' OR m.text LIKE '%${q}%')
        ORDER BY m.date DESC
        LIMIT ${n};
      `
      try {
        const rows = await querySqlite(sql)
        return { query, count: rows.length, messages: rows.map(formatMessage) }
      } catch (err) {
        return { error: err.message }
      }
    },

    send: async ({ recipient, text, confirmed = false } = {}) => {
      if (!recipient || !text) return { error: 'recipient + text erforderlich' }
      // Two-Step: erst Vorschau, dann (mit confirmed: true) senden.
      if (!confirmed) {
        return {
          preview:   { recipient, text },
          confirmed: false,
          message:   `Bestätigung nötig. Soll ich an ${recipient} schicken: "${text}"?`,
          hint:      'Erst nach expliziter Zustimmung von Alex erneut aufrufen mit confirmed:true.'
        }
      }
      try {
        await ensureAppRunning('Messages')
        const cleanRecipient = recipient.includes('@') ? recipient : recipient.replace(/[^\d+]/g, '')
        const script = `
tell application "Messages"
  set targetService to 1st service whose service type = iMessage
  try
    set targetBuddy to buddy "${escapeAS(cleanRecipient)}" of targetService
    send "${escapeAS(text)}" to targetBuddy
    return "ok"
  on error errMsg
    return "ERROR:" & errMsg
  end try
end tell`
        const result = await runAppleScript(script)
        if (result.startsWith('ERROR:')) {
          return { error: 'AppleScript: ' + result.slice(6).trim() }
        }
        return {
          ok:        true,
          confirmed: true,
          recipient: cleanRecipient,
          message:   `Nachricht an ${cleanRecipient} gesendet: "${text}"`
        }
      } catch (err) {
        return { error: err.message }
      }
    }
  },

  tools: [
    {
      name: 'messages_getRecent',
      description: 'Holt die letzten N iMessage/SMS-Nachrichten (gelesen + ungelesen). Nutzen bei "Wer hat mir geschrieben?", "Was war die letzte Nachricht?".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Anzahl (default 20, max 100)' }
        }
      }
    },
    {
      name: 'messages_getUnread',
      description: 'Zählt ungelesene Nachrichten. Schnelle Abfrage – kein Inhalt, nur Zahl.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'messages_search',
      description: 'Sucht in Nachrichten nach Kontaktnamen, Telefonnummer, Mailadresse oder Inhalt. Nutzen bei "Was hat Birgit zuletzt geschrieben?", "Suche Nachrichten zu Projekt X".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name, Nummer, E-Mail oder Inhalts-Stichwort' },
          limit: { type: 'number', description: 'Anzahl (default 20)' }
        },
        required: ['query']
      }
    },
    {
      name: 'messages_send',
      description: 'Verschickt eine iMessage. WICHTIGER ABLAUF: 1) Wenn Alex sagt "Schick X dass Y", rufe das Tool ZUERST OHNE confirmed auf – du bekommst eine Vorschau zurück. 2) Zeige Alex Empfänger + Text klar und frage "Schicke das ab?". 3) ERST wenn Alex bestätigt (ja/ok/los/schick es), rufe das Tool erneut mit denselben Parametern UND confirmed:true auf. Telefonnummer-Lookup vorher via contacts_search wenn nur Vorname gegeben ist.',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string', description: 'Telefonnummer (mit Ländervorwahl) oder Apple-ID-Email' },
          text:      { type: 'string', description: 'Nachrichtentext' },
          confirmed: { type: 'boolean', description: 'Default false. Erst auf TRUE setzen, NACHDEM Alex die Vorschau bestätigt hat.' }
        },
        required: ['recipient', 'text']
      }
    }
  ]
}

// ── SQLite-Aufruf ─────────────────────────────────────────────────────────────
function querySqlite(sql) {
  return new Promise((resolve, reject) => {
    if (!existsSync(CHAT_DB)) {
      return reject(new Error('chat.db nicht gefunden – Messages-App auf diesem Mac nicht eingerichtet?'))
    }
    execFile('/usr/bin/sqlite3', [CHAT_DB, '-json', sql], {
      maxBuffer: 16 * 1024 * 1024,
      timeout:   10_000
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr || err.message
        if (/unable to open|authorization|operation not permitted/i.test(msg)) {
          return reject(new Error('VINCI braucht Full Disk Access. Systemeinstellungen → Datenschutz → Festplattenzugriff → VINCI aktivieren, dann VINCI neustarten.'))
        }
        return reject(new Error(msg))
      }
      try { resolve(JSON.parse(stdout || '[]')) }
      catch { resolve([]) }
    })
  })
}

// ── AppleScript-Aufruf ────────────────────────────────────────────────────────
function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    const f = join(tmpdir(), `vinci-messages-${Date.now()}.applescript`)
    writeFileSync(f, script, 'utf8')
    const timer = setTimeout(() => { cleanup(); reject(new Error('AppleScript Timeout')) }, 15_000)
    execFile('osascript', [f], (err, stdout, stderr) => {
      clearTimeout(timer); cleanup()
      if (err) return reject(new Error(stderr?.trim() || err.message))
      resolve(stdout.trim())
    })
    function cleanup() { try { unlinkSync(f) } catch {} }
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatMessage(r) {
  return {
    id:       r.id,
    von:      r.from_me ? 'ich' : (r.handle || 'unbekannt'),
    an:       r.from_me ? (r.handle || r.chat_name || 'unbekannt') : 'ich',
    text:     (r.text || '').slice(0, 600),
    zeit:     r.ts,
    gelesen:  !!r.is_read,
    chat:     r.chat_name || ''
  }
}

function escapeAS(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function clamp(n, min, max) {
  const v = parseInt(n)
  if (isNaN(v)) return min
  return Math.max(min, Math.min(max, v))
}
