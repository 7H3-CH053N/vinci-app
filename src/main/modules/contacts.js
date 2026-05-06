// ── macOS Kontakte ─────────────────────────────────────────────────────────────
// Suchen, anrufen, Nachricht verfassen.
//
// Auth: Beim ersten Zugriff fragt macOS nach Kontakte-Berechtigung. Die
// Usage-Description (NSContactsUsageDescription) ist im electron-builder.config.js
// bereits gesetzt.

import { execFile } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { shell } from 'electron'
import { ensureAppRunning } from './_appLauncher.js'

export const contactsModule = {
  name: 'contacts',
  description: 'macOS Kontakte: Telefonnummern, E-Mails und Adressen suchen, anrufen, Nachrichten vorbereiten',

  actions: {
    search: async ({ query, limit = 5 } = {}) => {
      if (!query || !query.trim()) return { error: 'query erforderlich' }
      await ensureAppRunning('Contacts')
      try {
        const raw = await runAppleScript(buildSearchScript(query.trim()))
        let list = parseContacts(raw)
        list = mergeDuplicates(list)                       // gleicher Name → ein Eintrag
        list = list.slice(0, Math.max(1, Math.min(limit, 20)))
        if (!list.length) return { query, count: 0, contacts: [], hint: 'Kein Treffer im macOS-Adressbuch.' }
        return { query, count: list.length, contacts: list }
      } catch (err) {
        const msg = err.message || String(err)
        if (/not authorized|access/i.test(msg)) {
          return { error: 'Keine Berechtigung. Systemeinstellungen → Datenschutz → Kontakte → VINCI aktivieren.' }
        }
        return { error: msg }
      }
    },

    call: async ({ query, type = 'phone' } = {}) => {
      if (!query) return { error: 'query erforderlich' }
      let number = query
      // Falls keine reine Nummer übergeben, erst suchen
      if (!/^[\d+\s()-]+$/.test(query)) {
        await ensureAppRunning('Contacts')
        const raw = await runAppleScript(buildSearchScript(query.trim()))
        const list = parseContacts(raw)
        const c = list[0]
        if (!c?.phones?.length) return { error: `Keine Telefonnummer für "${query}" gefunden.` }
        number = c.phones[0].value
      }
      const clean = number.replace(/[^\d+]/g, '')
      const url = type === 'facetime' ? `facetime://${clean}` : `tel:${clean}`
      shell.openExternal(url)
      return { ok: true, opened: url, message: `Verbindung wird aufgebaut: ${number}` }
    },

    message: async ({ query, body = '' } = {}) => {
      if (!query) return { error: 'query erforderlich' }
      let recipient = query
      let displayName = query
      if (!/^[\d+\s()-]+$/.test(query)) {
        await ensureAppRunning('Contacts')
        const raw = await runAppleScript(buildSearchScript(query.trim()))
        const list = parseContacts(raw)
        const c = list[0]
        if (!c?.phones?.length) return { error: `Keine Nummer für "${query}" gefunden.` }
        recipient = c.phones[0].value
        displayName = c.name || query
      }
      const clean = recipient.replace(/[^\d+]/g, '')
      // sms:NUMBER&body=TEXT öffnet Messages mit vorbereitetem Inhalt.
      // Wir SENDEN absichtlich NICHT automatisch – Alex muss in Messages auf Enter drücken.
      const url = body
        ? `sms:${clean}&body=${encodeURIComponent(body)}`
        : `sms:${clean}`
      shell.openExternal(url)
      return {
        ok: true,
        opened: url,
        message: `Messages für ${displayName} geöffnet${body ? ' (Text vorbereitet, du musst noch auf Senden drücken)' : ''}.`
      }
    }
  },

  tools: [
    {
      name: 'contacts_search',
      description: 'Sucht im macOS-Adressbuch nach Name/Firma. Gibt Telefonnummer(n), E-Mail(s), POSTALISCHE ADRESSEN und Geburtstag zurück. IMMER aufrufen bei Fragen wie "Wie ist X\' Nummer/Adresse/Mail?", "Wo wohnt X?", "Geburtstag von Y?". Funktioniert auch wenn "X" der User selbst ist (z. B. "Alex Januschewsky"). Bei mehreren Treffern alle nennen, niemals raten oder aus dem Modell-Wissen ergänzen.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name, Vorname, Nachname oder Firma (Teil-Suche reicht – "Alex" findet alle Alex-Einträge)' },
          limit: { type: 'number', description: 'Max. Treffer (default 5)' }
        },
        required: ['query']
      }
    },
    {
      name: 'contacts_call',
      description: 'Startet einen Anruf bzw. öffnet die Telefon-/FaceTime-App mit der Nummer eines Kontakts. Bei mehrdeutigem Namen ZUERST contacts_search aufrufen.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name oder direkte Telefonnummer' },
          type:  { type: 'string', description: '"phone" (default) oder "facetime"' }
        },
        required: ['query']
      }
    },
    {
      name: 'contacts_message',
      description: 'Öffnet die Nachrichten-App (iMessage/SMS) mit einem Kontakt. Optional mit vorbereitetem Text – Alex bestätigt das Senden manuell. Aus Sicherheitsgründen wird NICHT automatisch versendet.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name oder direkte Telefonnummer' },
          body:  { type: 'string', description: 'Vorbereiteter Nachrichtentext (optional)' }
        },
        required: ['query']
      }
    }
  ]
}

// ── AppleScript-Aufruf ────────────────────────────────────────────────────────
function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    const f = join(tmpdir(), `vinci-contacts-${Date.now()}.applescript`)
    writeFileSync(f, script, 'utf8')
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timeout')) }, 15000)
    execFile('osascript', [f], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      clearTimeout(timer); cleanup()
      if (err) return reject(new Error(stderr?.trim() || err.message))
      resolve(stdout)
    })
    function cleanup() { try { unlinkSync(f) } catch {} }
  })
}

// ── Search-Script generieren ──────────────────────────────────────────────────
// Sucht in name (case-insensitive). AppleScript's "contains" ist standardmäßig
// case-insensitive bei Strings.
function buildSearchScript(query) {
  const q = escapeAS(query)
  return `tell application "Contacts"
  set output to ""
  try
    set foundPeople to (every person whose name contains "${q}" or organization contains "${q}")
  on error
    set foundPeople to {}
  end try
  repeat with p in foundPeople
    set output to output & "NAME=" & (name of p as string) & linefeed
    try
      set org to organization of p as string
      if org is not "" and org is not "missing value" then set output to output & "ORG=" & org & linefeed
    end try
    try
      set nick to nickname of p as string
      if nick is not "" and nick is not "missing value" then set output to output & "NICK=" & nick & linefeed
    end try
    repeat with ph in phones of p
      try
        set phLabel to (label of ph as string)
        set phValue to (value of ph as string)
        set output to output & "PHONE=" & phLabel & "|" & phValue & linefeed
      end try
    end repeat
    repeat with em in emails of p
      try
        set emLabel to (label of em as string)
        set emValue to (value of em as string)
        set output to output & "EMAIL=" & emLabel & "|" & emValue & linefeed
      end try
    end repeat
    repeat with addr in addresses of p
      try
        set adLabel to (label of addr as string)
        set adStreet to ""
        try
          set adStreet to (street of addr as string)
        end try
        set adZip to ""
        try
          set adZip to (zip of addr as string)
        end try
        set adCity to ""
        try
          set adCity to (city of addr as string)
        end try
        set adCountry to ""
        try
          set adCountry to (country of addr as string)
        end try
        set output to output & "ADDR=" & adLabel & "|" & adStreet & "|" & adZip & "|" & adCity & "|" & adCountry & linefeed
      end try
    end repeat
    try
      set bd to birth date of p
      if bd is not missing value then set output to output & "BIRTHDAY=" & (bd as string) & linefeed
    end try
    try
      set notesVal to note of p as string
      if notesVal is not "" and notesVal is not "missing value" then set output to output & "NOTES=" & notesVal & linefeed
    end try
    set output to output & "---" & linefeed
  end repeat
  return output
end tell`
}

// ── Output-Parsing ────────────────────────────────────────────────────────────
function parseContacts(raw) {
  if (!raw?.trim()) return []
  const blocks = raw.split(/^---$/m).map(s => s.trim()).filter(Boolean)
  const result = []
  for (const block of blocks) {
    const c = {
      name: '', org: '', nickname: '',
      phones: [], emails: [], addresses: [],
      birthday: '', notes: ''
    }
    for (const line of block.split(/\r?\n/)) {
      const t = line.trim()
      if (!t) continue
      const eq = t.indexOf('=')
      if (eq < 0) continue
      const key = t.slice(0, eq)
      const val = t.slice(eq + 1)
      if (key === 'NAME')        c.name = val
      else if (key === 'ORG')    c.org  = val
      else if (key === 'NICK')   c.nickname = val
      else if (key === 'PHONE') {
        const [label, value] = val.split('|', 2)
        if (value) c.phones.push({ label: cleanLabel(label), value: value.trim() })
      }
      else if (key === 'EMAIL') {
        const [label, value] = val.split('|', 2)
        if (value) c.emails.push({ label: cleanLabel(label), value: value.trim() })
      }
      else if (key === 'ADDR') {
        // Format: label|street|zip|city|country
        const parts = val.split('|')
        if (parts.length >= 5) {
          const cleanedParts = parts.slice(1, 5).map(s => (s === 'missing value' ? '' : s.trim())).filter(Boolean)
          if (cleanedParts.length > 0) {
            const formatted = formatAddress(parts[1], parts[2], parts[3], parts[4])
            c.addresses.push({ label: cleanLabel(parts[0]), formatted })
          }
        }
      }
      else if (key === 'BIRTHDAY') {
        c.birthday = val.replace(/ um \d{2}:\d{2}:\d{2}.*$/, '').trim()
      }
      else if (key === 'NOTES') c.notes = val
    }
    if (c.name || c.phones.length || c.emails.length || c.addresses.length) result.push(c)
  }
  return result
}

// ── Merge & Deduplikation ─────────────────────────────────────────────────────
// Mehrere Einträge mit gleichem Namen (z. B. iCloud + Google + LinkedIn) werden
// zu einem zusammengezogen. Innerhalb eines Eintrags werden Phones/Emails/Addresses
// nach normalisiertem Wert deduplizt – also "+43 664 3580271" und "+436643580271"
// gelten als gleich, ebenso "Mobile" + "iPhone" mit identischer Nummer.
function mergeDuplicates(list) {
  const byKey = new Map()
  for (const c of list) {
    const key = (c.name || '').toLowerCase().trim()
    if (!key) continue
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...c,
        phones:    [...c.phones],
        emails:    [...c.emails],
        addresses: [...c.addresses]
      })
    } else {
      const existing = byKey.get(key)
      existing.phones.push(...c.phones)
      existing.emails.push(...c.emails)
      existing.addresses.push(...c.addresses)
      if (!existing.org && c.org)             existing.org      = c.org
      if (!existing.nickname && c.nickname)   existing.nickname = c.nickname
      if (!existing.birthday && c.birthday)   existing.birthday = c.birthday
      if (!existing.notes && c.notes)         existing.notes    = c.notes
    }
  }
  // Innerhalb jedes Eintrags dedupen
  const result = []
  for (const c of byKey.values()) {
    c.phones    = dedupBy(c.phones,    p => normalizePhone(p.value))
    c.emails    = dedupBy(c.emails,    e => (e.value || '').toLowerCase().trim())
    c.addresses = dedupBy(c.addresses, a => (a.formatted || '').toLowerCase().replace(/\s+/g, ' ').trim())
    result.push(c)
  }
  return result
}

function normalizePhone(p) {
  return (p || '').replace(/[^\d+]/g, '')
}

function dedupBy(arr, keyFn) {
  const seen = new Set()
  const out = []
  for (const item of arr) {
    const k = keyFn(item)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

function formatAddress(street, zip, city, country) {
  const isReal = s => s && s !== 'missing value'
  const parts = []
  if (isReal(street)) parts.push(street.trim())
  const zipCity = [isReal(zip) ? zip.trim() : '', isReal(city) ? city.trim() : ''].filter(Boolean).join(' ')
  if (zipCity) parts.push(zipCity)
  if (isReal(country)) parts.push(country.trim())
  return parts.join(', ')
}

function cleanLabel(label) {
  if (!label) return ''
  // AppleScript-Labels haben oft Format wie "_$!<Mobile>!$_" – aufräumen
  return label.replace(/[_$!<>]/g, '').trim() || ''
}

function escapeAS(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
