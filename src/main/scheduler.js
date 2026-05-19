import cron from 'node-cron'
import { getSettings } from './store.js'
import { registry } from './modules/registry.js'
import { geminiChat } from './modules/gemini.js'

let briefingTask = null

export function setupScheduler(win) {
  scheduleBriefing(win)
}

function scheduleBriefing(win) {
  const settings = getSettings()
  const [hour, minute] = (settings.briefingTime || '06:30').split(':').map(Number)
  if (briefingTask) briefingTask.stop()
  briefingTask = cron.schedule(`${minute} ${hour} * * *`, () => {
    triggerBriefing(win)
  }, { timezone: 'Europe/Vienna' })
  console.log(`[Scheduler] Briefing scheduled at ${hour}:${String(minute).padStart(2,'0')} (Vienna)`)
}

export async function triggerBriefing(win) {
  console.log('[Briefing] Starting...')
  const settings = getSettings()
  if (!settings.geminiApiKey) {
    console.error('[Briefing] No API key')
    return
  }

  // Fetch all data in parallel - no Gemini tool calling needed here
  const ctx = { settings, tokens: {}, saveTokens: () => {} }

  const [weather, calendar, reminders, mail] = await Promise.allSettled([
    registry.invoke('weather',   'getCurrent', {}, ctx),
    registry.invoke('calendar',  'getToday',   {}, ctx),
    registry.invoke('reminders', 'getAll',     {}, ctx),
    registry.invoke('mail',      'getUnread',  { limit: 5 }, ctx)
  ])

  const data = {
    weather:   weather.status   === 'fulfilled' ? weather.value   : null,
    calendar:  calendar.status  === 'fulfilled' ? calendar.value  : null,
    reminders: reminders.status === 'fulfilled' ? reminders.value : null,
    mail:      mail.status      === 'fulfilled' ? mail.value      : null,
  }

  console.log('[Briefing] Data collected:', {
    weather:   !!data.weather,
    calendar:  data.calendar?.termine?.length,
    reminders: data.reminders?.length,
    mail:      data.mail?.length
  })

  const nowDate = new Date()
  const now = nowDate.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })
  const nowTime = nowDate.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })

  const weatherStr = data.weather && !data.weather.error
    ? `Aktuell ${data.weather.temperature}°C (gefühlt ${data.weather.feelsLike}°C), ${data.weather.condition}. Heute: ${data.weather.todayMin}–${data.weather.todayMax}°C, ${data.weather.todayCondition}.`
    : 'Wetterdaten nicht verfügbar.'

  const calErr = data.calendar?.error || (data.calendar == null ? 'Kalender konnte nicht abgerufen werden' : null)
  const calEntries = data.calendar?.termine || []
  const calStr = calErr
    ? `(Kalender-Zugriff fehlgeschlagen: ${calErr})`
    : calEntries.length
      ? calEntries.map(e => `• ${e}`).join('\n')
      : 'Keine Termine heute.'

  const remStr = data.reminders?.length
    ? data.reminders.slice(0, 8).map(r => `• ${r.title}${r.list ? ' [' + r.list + ']' : ''}`).join('\n')
    : 'Keine offenen Aufgaben.'

  const mailStr = data.mail?.length
    ? data.mail.slice(0, 5).map(m => `• ${m.from}: ${m.subject}`).join('\n')
    : 'Keine ungelesenen Mails.'

  const prompt = `Erstelle ein kurzes, prägnantes Briefing für Alex.
Jetzt ist ${now} um ${nowTime} Uhr.
Passe den Ton an die Uhrzeit an: morgens motivierend, abends entspannt zusammenfassend.

WETTER SALZBURG:
${weatherStr}

TERMINE HEUTE:
${calStr}

OFFENE AUFGABEN:
${remStr}

UNGELESENE MAILS (Top 5):
${mailStr}

Fasse alles in 5-7 flüssigen Sätzen zusammen. Sprich Alex direkt mit "du" an.
Beginne mit dem Datum und Wetter. Erwähne dann Termine, wichtige Aufgaben und ob viele Mails warten.
Kein Dialekt. Klares Hochdeutsch. Keine Aufzählungen – fließender Text.

WICHTIG: Wenn oben "Kalender-Zugriff fehlgeschlagen" steht, NIEMALS so tun als wären keine Termine. Stattdessen ehrlich sagen: "den Kalender konnte ich gerade nicht abrufen".`

  try {
    const response = await geminiChat({
      message: prompt,
      history: [],
      apiKey: settings.geminiApiKey,
      model: settings.geminiModel,
      onToolCall: null
    })

    console.log('[Briefing] Generated:', response?.slice(0, 100))

    win?.webContents.send('lyra:briefing', {
      text: response,
      timestamp: Date.now(),
      data
    })
  } catch (err) {
    console.error('[Briefing] Gemini error:', err.message)
    const friendly = friendlyGeminiError(err)
    win?.webContents.send('lyra:briefing', {
      text: friendly,
      timestamp: Date.now(),
      data,
      error: true
    })
  }
}

/**
 * Übersetzt Gemini-API-Fehler in eine freundliche Sprach-/Chat-Meldung.
 * Bleibt im VINCI-Tonfall: kurz, ruhig, in der Ich-Form.
 */
function friendlyGeminiError(err) {
  const msg = (err?.message || '').toLowerCase()
  if (msg.includes('503') || msg.includes('high demand') || msg.includes('overloaded')) {
    return 'Das Modell ist gerade überlastet, Alex. Probier in ein paar Minuten nochmal — sonst kommt das Briefing nachher.'
  }
  if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit')) {
    return 'Mein Tageskontingent bei Google ist gerade voll. Morgen läuft es wieder, oder du wechselst kurz auf ein anderes Modell.'
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('api key')) {
    return 'Mit meinem Gemini-Key stimmt was nicht — schau bitte in die Einstellungen.'
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return 'Ich komme gerade nicht zu Google durch. Internet-Verbindung kurz checken?'
  }
  if (msg.includes('500') || msg.includes('502') || msg.includes('504')) {
    return 'Bei Google ist gerade was kaputt — kein Briefing möglich, sorry.'
  }
  return 'Das Briefing klappt gerade nicht — keine Antwort vom Modell. Probier es gleich nochmal.'
}

export function reschedule(win) {
  scheduleBriefing(win)
}

function formatTime(dateStr) {
  try {
    return new Date(dateStr).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return dateStr
  }
}
