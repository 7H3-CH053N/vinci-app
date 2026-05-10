import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const SETTINGS_PATH = () => join(app.getPath('userData'), 'vinci-settings.json')
const TOKENS_PATH   = () => join(app.getPath('userData'), 'vinci-tokens.json')
const WINDOW_PATH   = () => join(app.getPath('userData'), 'vinci-window.json')

const DEFAULT_SETTINGS = {
  hotkey: 'CommandOrControl+Shift+Space',
  alwaysOnTop: false,
  briefingTime: '06:30',
  aiProvider: 'gemini',      // 'gemini' | 'ollama'
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-pro',            // Default-Pro: beste Tool-Calling-Accuracy, weniger Empty-STOP-Quirks
  geminiFallbackModel: 'gemini-2.5-flash',  // Bei 503/Overload: schneller Fallback (akzeptable Qualität)
  smartRouting: true,                        // Phase J2: triviale Queries gehen auf Flash, Standard+Komplex auf Pro
  intentRouting: true,                       // Phase J1: Tool-Shortlist via Intent-Klassifikation (massiv weniger Tokens, höhere Tool-Accuracy)
  situationContext: true,                    // Phase J3: Live-Snapshot (Zeit, nächster Termin, Mail-Backlog) + Session-Memory in jeden Prompt
  proactive: {                               // Phase J4: Hintergrund-Daemons für proaktive Notifications
    calendarWarning: true,                   // 15 min vor Termin
    stromAnomaly: true,                      // aktueller Watt > Schwellwert
    stromThresholdW: 2500,                   // ab wie vielen Watt eine Anomalie ist
    vaultDrift: true,                        // wöchentlich Posts-ohne-Wikilinks-Check
    quarantineReminder: true                 // wöchentlich _quarantine/ älter als 14 Tage
  },
  ollamaModel: 'gemma4',
  ollamaUrl: 'http://localhost:11434',
  memoryWorkerModel: 'gemma3:4b',
  mailApp: 'Mail',
  ui: {
    fontScale:  1.0,
    fontFamily: 'Inter Tight',
    orbStyle:   'classic',   // 'classic' | 'nebula' | 'vortex'
    orbColor:   '#D4AF37'    // Hex-Farbe für die Orb-Animation
  },
  tts: {
    enabled: true,
    provider: 'system',                 // 'system' | 'edge'
    voice: 'auto',                      // System-Voice (macOS)
    edgeVoice: 'de-AT-IngridNeural',    // Edge-Voice (Microsoft)
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    // Pro Modul entscheiden, ob Ingrid spricht. Default: alles an.
    modules: {
      weather:        true,
      calendar:       true,
      mail:           true,
      reminders:      true,
      messages:       true,
      contacts:       true,
      obsidian:       true,
      strom:          true,
      news:           true,
      web:            true,
      n8n:            true,
      homeassistant:  true,
      briefing:       true,
      chat:           true,
      tasks:          true,
      system:         true
    }
  },
  n8n: {
    baseUrl: 'https://bot.promptrocker.at',
    apiKey: ''
  },
  weather: {
    city: 'Salzburg',
    lat: 47.8095,
    lon: 13.0550
  },
  strom: {
    apiUrl: 'https://strom.vibecodes.at/api',
    apiKey: ''
  },
  obsidian: {
    vaultPath: ''   // z. B. '/Users/alex/Documents/MyVault' – wenn leer ist das Modul deaktiviert
  },
  tavily: {
    apiKey: ''      // Tavily API-Key, kostenloser Account auf https://app.tavily.com (1.000 Credits/Monat gratis, ohne Kreditkarte)
  },
  homeassistant: {
    lanUrl:    '',  // z. B. http://192.168.68.71:8123
    remoteUrl: '',  // z. B. http://homeassistant.tailfa2820.ts.net:8123
    token:     ''   // Lang-laufendes Zugangstoken aus dem HA-Profil
  },
  blogSources: [
    {
      id: 'digitalhandwerk',
      type: 'wordpress',
      baseUrl: 'https://digitalhandwerk.rocks',
      vaultFolder: 'RSS/digitalhandwerk',
      authorWikilink: '[[Alex Januschewsky]]',
      cacheImages: false,
      enabled: true
    }
  ]
}

export function getSettings() {
  try {
    if (!existsSync(SETTINGS_PATH())) return { ...DEFAULT_SETTINGS }
    const raw = JSON.parse(readFileSync(SETTINGS_PATH(), 'utf8'))
    return deepMerge(DEFAULT_SETTINGS, raw)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings) {
  writeFileSync(SETTINGS_PATH(), JSON.stringify(settings, null, 2), 'utf8')
}

export function getTokens() {
  try {
    if (!existsSync(TOKENS_PATH())) return {}
    return JSON.parse(readFileSync(TOKENS_PATH(), 'utf8'))
  } catch {
    return {}
  }
}

export function saveTokens(tokens) {
  writeFileSync(TOKENS_PATH(), JSON.stringify(tokens, null, 2), 'utf8')
}

// Fenster-Bounds (Größe + Position) merken über App-Neustarts hinweg
export function getWindowBounds() {
  try {
    if (!existsSync(WINDOW_PATH())) return null
    const b = JSON.parse(readFileSync(WINDOW_PATH(), 'utf8'))
    if (typeof b.width === 'number' && typeof b.height === 'number') return b
    return null
  } catch {
    return null
  }
}

export function saveWindowBounds(bounds) {
  try {
    writeFileSync(WINDOW_PATH(), JSON.stringify(bounds, null, 2), 'utf8')
  } catch {}
}

function deepMerge(defaults, overrides) {
  const result = { ...defaults }
  for (const key of Object.keys(overrides)) {
    if (overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
      result[key] = deepMerge(defaults[key] || {}, overrides[key])
    } else {
      result[key] = overrides[key]
    }
  }
  return result
}
