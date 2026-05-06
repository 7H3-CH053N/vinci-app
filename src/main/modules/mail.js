import { execFile } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureAppRunning } from './_appLauncher.js'

export const mailModule = {
  name: 'mail',
  description: 'macOS Mail/Outlook: Ungelesene Mails ohne App zu öffnen',

  actions: {
    getUnread: async ({ limit = 10 } = {}, ctx) => {
      const app = ctx?.settings?.mailApp || 'Mail'
      await ensureAppRunning(app)
      return app === 'Outlook' ? getUnreadOutlook(limit) : getUnreadMail(limit)
    },
    getLatest: async ({ limit = 20 } = {}, ctx) => {
      const app = ctx?.settings?.mailApp || 'Mail'
      await ensureAppRunning(app)
      return app === 'Outlook' ? getLatestOutlook(limit) : getLatestMail(limit)
    }
  },

  tools: [
    {
      name: 'mail_getUnread',
      description: 'Holt ungelesene Mails',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max. Anzahl (default: 10)' } }
      }
    },
    {
      name: 'mail_getLatest',
      description: 'Holt neueste Mails',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number' } }
      }
    }
  ]
}

// ── Mail.app ──────────────────────────────────────────────────────────────────
function getUnreadMail(limit = 10) {
  const script = `
tell application "Mail"
  set output to ""
  set msgCount to 0
  set unread to (messages of inbox whose read status is false)
  repeat with m in unread
    if msgCount >= ${limit} then exit repeat
    try
      set output to output & "FROM:" & (sender of m) & "|SUB:" & (subject of m) & "|DATE:" & ((date sent of m) as string) & ";;;"
      set msgCount to msgCount + 1
    end try
  end repeat
  return output
end tell`
  return runAppleScript(script, 'Mail')
}

function getLatestMail(limit = 20) {
  const script = `
tell application "Mail"
  set output to ""
  set msgCount to 0
  repeat with m in (messages of inbox)
    if msgCount >= ${limit} then exit repeat
    try
      set isRead to read status of m
      set output to output & "FROM:" & (sender of m) & "|SUB:" & (subject of m) & "|DATE:" & ((date sent of m) as string) & "|READ:" & (isRead as string) & ";;;"
      set msgCount to msgCount + 1
    end try
  end repeat
  return output
end tell`
  return runAppleScript(script, 'Mail')
}

// ── Outlook ───────────────────────────────────────────────────────────────────
function getUnreadOutlook(limit = 10) {
  const script = `
tell application "Microsoft Outlook"
  set output to ""
  set msgCount to 0
  set unread to (messages of inbox folder whose is read is false)
  repeat with m in unread
    if msgCount >= ${limit} then exit repeat
    try
      set output to output & "FROM:" & (sender address of sender of m) & "|SUB:" & (subject of m) & "|DATE:" & ((time sent of m) as string) & ";;;"
      set msgCount to msgCount + 1
    end try
  end repeat
  return output
end tell`
  return runAppleScript(script, 'Microsoft Outlook')
}

function getLatestOutlook(limit = 20) {
  const script = `
tell application "Microsoft Outlook"
  set output to ""
  set msgCount to 0
  repeat with m in (messages of inbox folder)
    if msgCount >= ${limit} then exit repeat
    try
      set isRead to is read of m
      set output to output & "FROM:" & (sender address of sender of m) & "|SUB:" & (subject of m) & "|DATE:" & ((time sent of m) as string) & "|READ:" & (isRead as string) & ";;;"
      set msgCount to msgCount + 1
    end try
  end repeat
  return output
end tell`
  return runAppleScript(script, 'Microsoft Outlook')
}

// ── Shared ────────────────────────────────────────────────────────────────────
function runAppleScript(script, appName) {
  return new Promise((resolve, reject) => {
    const tmpFile = join(tmpdir(), `lyra-mail-${Date.now()}.applescript`)
    writeFileSync(tmpFile, script.trim(), 'utf8')

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`${appName} Timeout`))
    }, 15000)

    // -W: wait, no activation (-g would open in background but Mail needs to be running)
    execFile('osascript', [tmpFile], (err, stdout, stderr) => {
      clearTimeout(timer)
      cleanup()
      if (err) {
        const msg = stderr || err.message
        if (msg.includes('not allowed') || msg.includes('access')) {
          reject(new Error(`${appName}-Zugriff verweigert. Systemeinstellungen → Datenschutz → Automatisierung → Lyra ✓`))
        } else {
          reject(new Error(msg.trim() || err.message))
        }
        return
      }
      const messages = parseMailOutput(stdout.trim())
      resolve(messages)
    })

    function cleanup() { try { unlinkSync(tmpFile) } catch {} }
  })
}

function parseMailOutput(raw) {
  if (!raw?.trim()) return []
  const messages = []
  for (const block of raw.split(';;;').filter(Boolean)) {
    const from    = block.match(/FROM:([^|]+)/)?.[1]?.trim()
    const subject = block.match(/\|SUB:([^|]+)/)?.[1]?.trim()
    const date    = block.match(/\|DATE:([^|]+)/)?.[1]?.trim()
    const readStr = block.match(/\|READ:(.+)/)?.[1]?.trim()
    if (from || subject) {
      messages.push({
        from: from || '',
        subject: subject || '(kein Betreff)',
        date: date || '',
        unread: readStr === undefined ? true : readStr === 'false'
      })
    }
  }
  return messages
}
