import { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, session } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFile, spawn } from 'child_process'
import { accessSync } from 'fs'
import { getSettings, saveSettings, getTokens, saveTokens, getWindowBounds, saveWindowBounds } from './store.js'
import { initMemory } from './modules/memory.js'
import { setupMemoryWorker } from './modules/memoryWorker.js'
import { setupTasks } from './tasks.js'
import { setupIPC } from './ipc.js'
import { setupScheduler } from './scheduler.js'
import { setupProactiveDaemons } from './modules/_proactiveDaemons.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production'

// Single instance lock — prevent second window
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}
app.on('second-instance', () => {
  // If someone tries to open a second instance, focus existing window
  if (win) { win.show(); win.focus() }
})

let win  = null
let tray = null

function createWindow() {
  // Letzte Bounds aus Datei restoren (oder Default)
  const saved = getWindowBounds()
  const opts = {
    width:  saved?.width  ?? 520,
    height: saved?.height ?? 780,
    minWidth:  440,
    minHeight: 380,
    frame: false,
    backgroundColor: '#080A0F',
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable:  true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  }
  if (typeof saved?.x === 'number' && typeof saved?.y === 'number') {
    opts.x = saved.x
    opts.y = saved.y
  }
  win = new BrowserWindow(opts)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // NO hide-on-blur — VINCI bleibt immer sichtbar
  // Red button / Cmd+W → hide (keep tray)
  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  // Bounds persistieren (debounced) bei Resize/Move
  let saveTimer = null
  const persist = () => {
    if (!win || win.isDestroyed()) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try { saveWindowBounds(win.getBounds()) } catch {}
    }, 400)
  }
  win.on('resize', persist)
  win.on('move',   persist)
  // Final-Save bei App-Quit
  app.on('before-quit', () => {
    if (win && !win.isDestroyed()) {
      try { saveWindowBounds(win.getBounds()) } catch {}
    }
  })
}

function showWindow() {
  if (!win) return
  win.show()
  win.focus()
}

function resolveAssetPath(...rel) {
  // In Production sind die Assets per `extraResources` unter
  // <App>.app/Contents/Resources/assets/ abgelegt – nicht im asar.
  if (app.isPackaged) {
    return join(process.resourcesPath, ...rel)
  }
  return join(__dirname, '../..', ...rel)
}

function createTray() {
  const iconPath = resolveAssetPath('assets', 'tray-icon.png')
  console.log('[Tray] iconPath:', iconPath)

  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    console.error('[Tray] Icon nicht gefunden, Fallback tray-vinci.png')
    icon = nativeImage.createFromPath(resolveAssetPath('assets', 'tray-vinci.png'))
  }

  if (process.platform === 'darwin' && !icon.isEmpty()) {
    icon = icon.resize({ width: 22, height: 22 })
    icon.setTemplateImage(true)
  }

  tray = new Tray(icon)
  tray.setToolTip('VINCI – KI-Assistent')

  // Left click → show/focus Lyra
  tray.on('click', showWindow)

  // Right click → context menu
  tray.on('right-click', buildContextMenu)
}

function buildContextMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'VINCI anzeigen',
      click: showWindow
    },
    { type: 'separator' },
    {
      label: 'Aufgaben',
      click: () => {
        showWindow()
        win?.webContents.send('lyra:openTasks')
      }
    },
    {
      label: 'Einstellungen',
      click: () => {
        showWindow()
        win?.webContents.send('lyra:openSettings')
      }
    },
    {
      label: 'Über VINCI',
      click: () => {
        showWindow()
        win?.webContents.send('lyra:openAbout')
      }
    },
    { type: 'separator' },
    {
      label: 'VINCI beenden',
      click: () => {
        app.exit(0)
      }
    }
  ])
  tray.popUpContextMenu(menu)
}

app.whenReady().then(() => {
  if (app.dock) app.dock.hide()

  createWindow()
  createTray()
  initMemory()

  // Microphone permission for Web Speech API
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media' || permission === 'microphone')
  })
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return permission === 'media' || permission === 'microphone'
  })

  // Global shortcuts
  const settings = getSettings()
  const hotkey   = settings.hotkey || 'CommandOrControl+Shift+Space'
  globalShortcut.register(hotkey, showWindow)
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    showWindow()
    win?.webContents.send('lyra:ptt')
  })

  setupIPC(win, { getSettings, saveSettings, getTokens, saveTokens })
  setupMemoryWorker(getSettings)
  setupTasks(win)
  setupScheduler(win)
  setupProactiveDaemons(win, getSettings)

  // Ollama-Daemon starten (für Memory-Worker + Obsidian-RAG)
  ensureOllamaRunning()
  // Mail/Reminders werden lazy beim ersten Tool-Call gestartet (siehe ensureAppRunning
  // in mail.js / reminders.js). Calendar braucht keinen Pre-Launch – icalBuddy
  // greift direkt auf die EventKit-DB zu.
})

function ensureOllamaRunning() {
  const OLLAMA_BINS = [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/Applications/Ollama.app/Contents/Resources/ollama'
  ]
  const ollamaBin = OLLAMA_BINS.find(p => {
    try { accessSync(p); return true } catch { return false }
  })
  if (!ollamaBin) {
    console.log('[Boot] Ollama-Binary nicht gefunden – Memory-Worker bleibt inaktiv')
    return
  }
  execFile('pgrep', ['-x', 'ollama'], (err) => {
    if (!err) { console.log('[Boot] Ollama läuft bereits'); return }
    const child = spawn(ollamaBin, ['serve'], { detached: true, stdio: 'ignore' })
    child.unref()
    console.log('[Boot] Ollama gestartet:', ollamaBin)
  })
}

app.on('window-all-closed', (e) => e.preventDefault())
app.on('will-quit', () => globalShortcut.unregisterAll())

export { win }
