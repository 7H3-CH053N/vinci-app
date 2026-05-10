import { ipcMain, dialog } from 'electron'
import { existsSync, statSync } from 'fs'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { detectMultipleVaults } from './modules/obsidian.js'
import { planMigration, applyMigration } from './modules/_vaultMigration.js'
import { scanVaultLocal, savePlan, applyPlan } from './modules/graphCleaner.js'
import { runOnce as blogRunOnce } from './modules/blogImporter.js'
import { loadEntityInventory, processPostFile, appendBacklinkBullet } from './modules/_wikilinkEngine.js'
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join as joinPath } from 'path'
import {
  listTasks, createTask, updateTask, deleteTask,
  executeTaskNow, getTaskResults, describeSchedule
} from './tasks.js'
import { saveMessage, getRecentHistory } from './modules/memory.js'
import { scheduleMemoryConsolidation } from './modules/memoryWorker.js'
import { ollamaChat } from './modules/ollama.js'
import { registry } from './modules/registry.js'
import { logEvent, readRecent as readRecentTelemetry } from './modules/telemetry.js'
import { listDaemons, runDaemonNow, rescheduleAll as rescheduleProactiveDaemons } from './modules/_proactiveDaemons.js'
import { geminiChat } from './modules/gemini.js'
import { routeAndLog } from './modules/_modelRouter.js'
import { triggerBriefing } from './scheduler.js'
import * as edgeTTS from './modules/edgeTTS.js'
import * as homeassistant from './modules/homeassistant.js'

export function setupIPC(win, { getSettings, saveSettings, getTokens, saveTokens }) {

  // ── Chat ──────────────────────────────────────────────────────────────────
  ipcMain.handle('lyra:chat', async (_, { message, history }) => {
    const chatStart = Date.now()
    console.log('[CHAT]', message.slice(0, 60))

    // Briefing keyword shortcut — trigger directly without Gemini tool call
    if (/briefing|☀/i.test(message.trim())) {
      console.log('[CHAT] Briefing keyword → direct trigger')
      triggerBriefing(win)
      return { text: 'Briefing wird erstellt...' }
    }

    const settings = getSettings()
    if (!settings.geminiApiKey) return { error: 'Kein Gemini API Key. Bitte in Einstellungen (⚙) eintragen.' }

    // Tracking, ob im aktuellen Chat-Loop "tainted" Daten geholt wurden – also
    // Web-Suchergebnisse oder private Daten (Messages, Mails). Diese Antworten
    // werden mit meta.tainted markiert → Memory-Worker filtert sie raus.
    let taintedThisTurn = false

    // Tools, die Daten holen, die NICHT ins Memory dürfen
    const TAINTING_TOOLS = new Set([
      'web_search',
      'messages_getRecent', 'messages_getUnread', 'messages_search',
      'mail_getUnread', 'mail_getLatest',
      // Live volatile data — never goes to memory
      'system_getStatus', 'system_getProcesses',
      'strom_getCurrent', 'strom_getToday',
      'homeassistant_state', 'homeassistant_call', 'homeassistant_list', 'homeassistant_open'
    ])

    // Schicht 4: Hard-Block. Nach einem tainting Tool dürfen keine Speicher-Tools
    // mehr laufen, AUSSER der User hat im aktuellen Prompt explizit darum gebeten.
    // Regex-Strategie: jede Wortform mit Stamm "speicher"/"notier"/"notiz"/"merk".
    const userExplicitlySaves = /(\bnotier|\bnotiz|\bmerk\b|\bmerke\b|\bspeicher|\bin\s+obsidian|\bleg\s+.*\b(an|datei|notiz)|\bschreib.*\b(notiz|in\s+obsidian)|\bkopier)/i
                                  .test(message)
    const PERSIST_TOOLS = new Set(['obsidian_createNote', 'memory_saveFact'])

    const toolDispatcher = async (toolName, params) => {
      console.log('[TOOL]', toolName, JSON.stringify(params).slice(0, 80))
      if (TAINTING_TOOLS.has(toolName)) taintedThisTurn = true

      // Hard-Block bei kontaminierter Conversation
      if (taintedThisTurn && PERSIST_TOOLS.has(toolName) && !userExplicitlySaves) {
        const msg = `Blockiert: Daten aus Web/Messages/Mail dürfen nicht ohne explizite Anweisung gespeichert werden. Sag z. B. "notiere das" wenn du es willst.`
        console.warn(`[GUARD] ${toolName} blockiert nach tainted Tool ohne expliziten Save-Wunsch`)
        return { error: msg, blocked: true }
      }

      try {
        const result = await registry.dispatch(toolName, params, {
          getSettings, getTokens,
          settings: getSettings(), tokens: getTokens(), saveTokens
        })
        console.log('[TOOL OK]', JSON.stringify(result).slice(0, 200))
        return result
      } catch (e) {
        console.error('[TOOL ERR]', toolName, e.message)
        logEvent('tool_error', { tool: toolName, error: e.message, params: JSON.stringify(params).slice(0, 200) })
        return { error: e.message }
      }
    }

    try {
      let response

      if (settings.aiProvider === 'ollama') {
        // Hybrid: Ollama for chat, Gemini for tool-calls (if API key available)
        // Check current message AND recent history for tool context
        // Inject last 20 messages from persistent memory as conversation context
      const persistedHistory = getRecentHistory(6)
      const fullHistory = [
        ...persistedHistory.map(m => ({ role: m.role, content: m.content })),
        ...history
      ]

      const recentContext = [message, ...fullHistory.slice(-4).map(m => m.content || '')].join(' ')
        const needsTools = /kalender|termin|mail|mails|erinnerung|strom|wetter|briefing|n8n|erinner|morgen|heute|gestern|nächste|letzten/i.test(recentContext)

        if (needsTools && settings.geminiApiKey) {
          console.log('[CHAT] Hybrid: Gemini for tool-call, Ollama for chat')
          response = await geminiChat({
            message, history: fullHistory,
            apiKey:        settings.geminiApiKey,
            model:         settings.geminiModel,
            moduleContext: registry.getContext(),
            onToolCall:    toolDispatcher,
            settings
          })
        } else {
          console.log('[CHAT] Using Ollama:', settings.ollamaModel, needsTools ? '(no Gemini key)' : '(no tools needed)')
          response = await ollamaChat({
            message, history,
            model:         settings.ollamaModel,
            moduleContext: needsTools ? registry.getTools() : [],
            onToolCall:    toolDispatcher
          })
        }
      } else {
        if (!settings.geminiApiKey) return { error: 'Kein Gemini API Key. Bitte in Einstellungen (⚙) eintragen.' }
        const routed = routeAndLog(message, settings)
        console.log('[CHAT] Using Gemini:', routed.model, `(${routed.reason})`)
        response = await geminiChat({
          message, history,
          apiKey:        settings.geminiApiKey,
          model:         routed.model,
          moduleContext: registry.getContext(),
          onToolCall:    toolDispatcher,
          settings
        })
      }

      console.log('[CHAT OK]', `${Date.now()-chatStart}ms total`, response?.slice(0, 80))
      saveMessage('user', message)
      if (response) {
        const meta = taintedThisTurn ? { tainted: true } : null
        saveMessage('assistant', response, meta)
        if (taintedThisTurn) console.log('[CHAT] Antwort als tainted markiert (kein Memory-Extract)')
      }
      // Background-Worker: Fakten aus Konversation extrahieren (debounced).
      // Bei webTainted-Antworten überspringt der Worker sie automatisch.
      scheduleMemoryConsolidation()
      return { text: response }
    } catch (err) {
      console.error('[CHAT ERR]', err.message)
      return { error: err.message }
    }
  })

  // ── Briefing ───────────────────────────────────────────────────────────────
  ipcMain.handle('lyra:briefing', async () => {
    console.log('[BRIEFING] triggered manually')
    await triggerBriefing(win)
    return { ok: true }
  })

  // ── Audio transcription via Gemini ────────────────────────────────────────
  ipcMain.handle('lyra:transcribe', async (_, { base64, mime }) => {
    console.log('[TRANSCRIBE] mime:', mime, 'size:', base64?.length)
    const settings = getSettings()
    if (!settings.geminiApiKey) return { error: 'Kein API Key' }

    try {
      const genAI = new GoogleGenerativeAI(settings.geminiApiKey)
      const model = genAI.getGenerativeModel({ model: settings.geminiModel || 'gemini-2.5-flash' })
      const result = await model.generateContent([
        { inlineData: { mimeType: mime || 'audio/webm', data: base64 } },
        { text: 'Transkribiere dieses Audio auf Deutsch. Gib NUR den transkribierten Text zurück, keine Erklärungen, kein Zusatz.' }
      ])
      const text = result.response.text().trim()
      console.log('[TRANSCRIBE OK]', text.slice(0, 80))
      return { text }
    } catch (err) {
      console.error('[TRANSCRIBE ERR]', err.message)
      return { error: err.message }
    }
  })

  // ── Module invoke ──────────────────────────────────────────────────────────
  ipcMain.handle('lyra:invoke', async (_, { module, action, params }) => {
    try {
      const settings = getSettings()
      const tokens   = getTokens()
      const result   = await registry.invoke(module, action, params, { settings: getSettings(), tokens: getTokens(), getSettings, getTokens, saveTokens })
      return { data: result }
    } catch (err) {
      console.error(`[INVOKE ERR] ${module}.${action}`, err.message)
      return { error: err.message }
    }
  })

  // ── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle('lyra:settings:get', () => {
    const s = getSettings()
    console.log('[SETTINGS] get, api key present:', !!s.geminiApiKey)
    return s
  })
  ipcMain.handle('lyra:settings:save', (_, settings) => {
    saveSettings(settings)
    console.log('[SETTINGS] saved')
    // Proactive daemons re-evaluieren falls toggles geändert wurden
    try { rescheduleProactiveDaemons() } catch (e) { console.warn('[Proactive] reschedule failed:', e.message) }
    return { ok: true }
  })

  // ── Window controls ────────────────────────────────────────────────────────
  // Asset path resolver
  ipcMain.handle('lyra:asset:path', (_, name) => {
    const { join } = require('path')
    const { app }  = require('electron')
    if (!app.isPackaged) {
      // Im Dev-Modus serviert Vite den 'assets'-Ordner als publicDir,
      // also reicht die Wurzel-URL — file:// scheitert wegen renderer security.
      return '/' + name
    }
    return 'file://' + join(process.resourcesPath, 'assets', name)
  })

  // Folder picker (z. B. für Obsidian-Vault)
  ipcMain.handle('lyra:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title:      'Obsidian-Vault auswählen',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths?.length) return { canceled: true }
    return { path: r.filePaths[0] }
  })

  ipcMain.handle('lyra:migration:plan', async () => {
    const settings = getSettings()
    const vault = settings.obsidian?.vaultPath
    if (!vault) return { error: 'Vault-Pfad nicht gesetzt.' }
    return await planMigration(vault)
  })

  ipcMain.handle('lyra:migration:apply', async (_e, plan, opts = { dryRun: true }) => {
    const settings = getSettings()
    const vault = settings.obsidian?.vaultPath
    if (!vault) return { error: 'Vault-Pfad nicht gesetzt.' }
    return await applyMigration(vault, plan, opts)
  })

  // Telemetry — letzte N Events lesen für Diagnostik
  ipcMain.handle('lyra:telemetry:recent', (_e, n = 100) => {
    return { events: readRecentTelemetry(n) }
  })

  // Proactive Daemons — Liste + manueller Test-Trigger + Reschedule nach Settings-Save
  ipcMain.handle('lyra:proactive:list',  () => ({ daemons: listDaemons() }))
  ipcMain.handle('lyra:proactive:run',   (_e, id) => runDaemonNow(id))
  ipcMain.handle('lyra:proactive:reschedule', () => { rescheduleProactiveDaemons(); return { ok: true } })

  ipcMain.handle('lyra:cleaner:scan', async () => {
    const settings = getSettings()
    const vault = settings.obsidian?.vaultPath
    if (!vault) return { error: 'Vault-Pfad nicht gesetzt.' }
    const plan = scanVaultLocal(vault)
    plan.proposals = plan.proposals.map((p, i) => ({ ...p, id: `p${i}`, accepted: true }))
    savePlan(plan)
    return plan
  })

  ipcMain.handle('lyra:cleaner:apply', async (_e, plan, opts = { dryRun: true }) => {
    const settings = getSettings()
    const vault = settings.obsidian?.vaultPath
    if (!vault) return { error: 'Vault-Pfad nicht gesetzt.' }
    return await applyPlan(vault, plan, opts)
  })

  ipcMain.handle('lyra:blog:sync', async (_e, opts = { force: false }) => {
    const settings = getSettings()
    const source = (settings.blogSources || []).find(s => s.enabled)
    if (!source) return { error: 'Keine Blog-Source konfiguriert.' }
    if (!settings.obsidian?.vaultPath) return { error: 'Kein Vault gesetzt.' }
    return await blogRunOnce(source, settings.obsidian.vaultPath, opts)
  })

  ipcMain.handle('lyra:blog:relinkAll', async () => {
    const settings = getSettings()
    const vault = settings.obsidian?.vaultPath
    if (!vault) return { error: 'Kein Vault.' }
    const sources = (settings.blogSources || []).filter(s => s.enabled)
    let totalScanned = 0, totalChanged = 0, totalBacklinks = 0
    const inv = loadEntityInventory(vault)
    for (const source of sources) {
      const folder = joinPath(vault, source.vaultFolder)
      if (!existsSync(folder)) continue
      for (const f of readdirSync(folder).filter(x => x.endsWith('.md'))) {
        totalScanned++
        const path = joinPath(folder, f)
        let original
        try { original = readFileSync(path, 'utf8') } catch { continue }
        const { content, changed, mentions } = processPostFile(original, inv)
        if (changed) {
          writeFileSync(path, content, 'utf8')
          totalChanged++
        }
        for (const m of mentions) {
          const canonical = m.replace(/^\[\[|\]\]$/g, '').split('|')[0]
          const ie = inv.find(i => i.canonical === canonical)
          if (ie?.category && ie.category !== 'alias') {
            if (appendBacklinkBullet(vault, canonical, ie.category, f.replace(/\.md$/, ''))) totalBacklinks++
          }
        }
      }
    }
    return { scanned: totalScanned, changed: totalChanged, backlinks_added: totalBacklinks }
  })

  ipcMain.handle('lyra:validateVaultPath', (_e, path) => {
    if (!path) return { ok: true }
    if (!existsSync(path)) return { error: 'Pfad existiert nicht.' }
    try {
      if (!statSync(path).isDirectory()) return { error: 'Pfad ist kein Ordner.' }
    } catch (e) {
      return { error: `Pfad nicht lesbar: ${e.message}` }
    }
    if (detectMultipleVaults(path)) {
      return { error: 'Pfad enthält mehrere Vaults — bitte den konkreten Vault auswählen, nicht den Parent-Ordner.' }
    }
    return { ok: true }
  })

  // ── Aufgaben (geplante Prompts) ───────────────────────────────────────────
  ipcMain.handle('lyra:tasks:list',    () => {
    return listTasks().map(t => ({ ...t, scheduleDescription: describeSchedule(t.schedule) }))
  })
  ipcMain.handle('lyra:tasks:create',  (_, input) => {
    return createTask(input)
  })
  ipcMain.handle('lyra:tasks:update',  (_, { id, patch }) => {
    return updateTask(id, patch)
  })
  ipcMain.handle('lyra:tasks:delete',  (_, id) => {
    return deleteTask(id)
  })
  ipcMain.handle('lyra:tasks:run',     async (_, id) => {
    try {
      const result = await executeTaskNow(id)
      return { ok: true, result }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  ipcMain.handle('lyra:tasks:results', (_, id) => {
    return getTaskResults(id)
  })

  ipcMain.on('lyra:window:hide',   () => win?.hide())
  ipcMain.on('lyra:open:external', (_, url) => {
    const { shell } = require('electron')
    shell.openExternal(url)
  })
  ipcMain.on('lyra:window:pin',    (_, pinned) => {
    win?._setHideOnBlur?.(!pinned)
    if (pinned) win?.setAlwaysOnTop(false)
    console.log('[Window] pin:', pinned)
  })
  // No-op: Fenstergröße wird nicht mehr programmatisch geändert.
  // Der User dimensioniert das Fenster manuell, die Größe wird persistiert.
  ipcMain.on('lyra:window:resize', () => {})

  // ── Edge TTS (via Python edge-tts) ────────────────────────────────────────
  ipcMain.handle('lyra:tts:edge:status', async () => {
    return await edgeTTS.checkStatus()
  })
  ipcMain.handle('lyra:tts:edge:speak', async (_, { text, voice }) => {
    const res = await edgeTTS.synthesize(text, voice)
    if (!res.ok) return { ok: false, error: res.error }
    // Base64 über IPC — vermeidet Buffer/Uint8Array-Serialisierungsprobleme
    return { ok: true, audioB64: res.audio.toString('base64') }
  })
  ipcMain.handle('lyra:tts:edge:voices', async () => edgeTTS.GERMAN_VOICES)
  ipcMain.handle('lyra:tts:edge:install-python', async () => edgeTTS.openPythonInstaller())
  ipcMain.handle('lyra:tts:edge:install-pkg',    async () => await edgeTTS.installEdgeTTS())

  // ── Home Assistant ────────────────────────────────────────────────────────
  ipcMain.handle('lyra:ha:test', async () => {
    const cfg = getSettings().homeassistant || {}
    homeassistant.resetActiveBase()
    return await homeassistant.ping(cfg)
  })
  ipcMain.handle('lyra:ha:state', async (_, { entityId }) => {
    const cfg = getSettings().homeassistant || {}
    try { return { ok: true, state: await homeassistant.getState(cfg, entityId) } }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('lyra:ha:list', async (_, { domain } = {}) => {
    const cfg = getSettings().homeassistant || {}
    try { return { ok: true, entities: await homeassistant.listEntities(cfg, domain) } }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('lyra:ha:call', async (_, { domain, service, data }) => {
    const cfg = getSettings().homeassistant || {}
    try { return { ok: true, result: await homeassistant.callService(cfg, domain, service, data || {}) } }
    catch (e) { return { ok: false, error: e.message } }
  })
}
