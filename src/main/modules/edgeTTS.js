/**
 * Edge TTS via Python-Subprozess (rany2/edge-tts).
 *
 * Wir nutzen das Python-Paket statt eines Node-Pakets, weil die JS-Wrapper
 * mit Microsofts Token-Rotation nicht Schritt halten. Das Python-Paket wird
 * aktiv gepflegt und ist die De-facto-Implementation.
 */
import { execFile, spawn } from 'child_process'
import { accessSync, mkdtempSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { app, shell } from 'electron'
import { promisify } from 'util'

const execFileP = promisify(execFile)

// Stabile Suchpfade für Python auf macOS
const PYTHON_CANDIDATES = [
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  '/usr/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3'
]

// macOS Universal Installer (Apple Silicon + Intel) — wird hin und wieder rotiert,
// aber python.org sollte stabil bleiben. Stand 2026-05.
const PYTHON_INSTALLER_URL = 'https://www.python.org/downloads/macos/'

let cachedPython = null

function findPython() {
  if (cachedPython && existsSync(cachedPython)) return cachedPython
  for (const p of PYTHON_CANDIDATES) {
    try { accessSync(p); cachedPython = p; return p } catch {}
  }
  return null
}

/**
 * Status-Check: ist Python verfügbar, ist edge-tts installiert?
 * Returns: { python: string|null, edgeTts: boolean, edgeTtsVersion: string|null, error?: string }
 */
export async function checkStatus() {
  const py = findPython()
  if (!py) {
    return { python: null, edgeTts: false, edgeTtsVersion: null, error: 'Python nicht gefunden' }
  }
  try {
    const { stdout } = await execFileP(py, ['-c', 'import edge_tts, importlib.metadata as m; print(m.version("edge-tts"))'], { timeout: 5000 })
    return { python: py, edgeTts: true, edgeTtsVersion: stdout.trim() }
  } catch (e) {
    return { python: py, edgeTts: false, edgeTtsVersion: null, error: 'edge-tts nicht installiert' }
  }
}

/**
 * Erzeugt MP3-Audio aus Text via edge-tts.
 * Returns: { ok: true, audio: Buffer } oder { ok: false, error: string }
 */
export async function synthesize(text, voice = 'de-AT-IngridNeural') {
  if (!text || !text.trim()) return { ok: false, error: 'Leerer Text' }
  const py = findPython()
  if (!py) return { ok: false, error: 'Python nicht gefunden' }

  const dir = mkdtempSync(join(tmpdir(), 'vinci-tts-'))
  const out = join(dir, 'out.mp3')
  try {
    await execFileP(py, ['-m', 'edge_tts', '-v', voice, '-t', text, '--write-media', out], { timeout: 30000 })
    const audio = readFileSync(out)
    return { ok: true, audio }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  } finally {
    try { unlinkSync(out) } catch {}
  }
}

/**
 * Öffnet die Python-Download-Seite im Browser, damit der User den
 * offiziellen .pkg-Installer per macOS-Installer-GUI ausführen kann.
 * Kein Terminal nötig.
 */
export async function openPythonInstaller() {
  await shell.openExternal(PYTHON_INSTALLER_URL)
  return { ok: true }
}

/**
 * Installiert edge-tts via pip im Hintergrund (kein Terminal sichtbar).
 * Returns Promise mit { ok, log }.
 */
export async function installEdgeTTS() {
  const py = findPython()
  if (!py) return { ok: false, error: 'Python nicht gefunden — bitte zuerst Python installieren.' }
  return new Promise((resolve) => {
    const child = spawn(py, ['-m', 'pip', 'install', '--user', '--upgrade', 'edge-tts'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let log = ''
    child.stdout.on('data', d => log += d.toString())
    child.stderr.on('data', d => log += d.toString())
    child.on('close', (code) => {
      cachedPython = null  // re-check next time
      resolve({ ok: code === 0, code, log: log.slice(-2000) })
    })
    child.on('error', (e) => {
      resolve({ ok: false, error: e.message, log })
    })
  })
}

/**
 * Liste deutscher Edge-Stimmen — hardcoded, weil eine vollständige Liste
 * vom Endpoint zu groß ist und sich selten ändert.
 */
export const GERMAN_VOICES = [
  { id: 'de-AT-IngridNeural',                label: 'Ingrid (AT, weiblich)' },
  { id: 'de-AT-JonasNeural',                 label: 'Jonas (AT, männlich)' },
  { id: 'de-DE-KatjaNeural',                 label: 'Katja (DE, weiblich)' },
  { id: 'de-DE-AmalaNeural',                 label: 'Amala (DE, weiblich)' },
  { id: 'de-DE-ConradNeural',                label: 'Conrad (DE, männlich)' },
  { id: 'de-DE-KillianNeural',               label: 'Killian (DE, männlich)' },
  { id: 'de-DE-FlorianMultilingualNeural',   label: 'Florian (DE, mehrsprachig)' },
  { id: 'de-DE-SeraphinaMultilingualNeural', label: 'Seraphina (DE, mehrsprachig)' },
  { id: 'de-CH-LeniNeural',                  label: 'Leni (CH, weiblich)' },
  { id: 'de-CH-JanNeural',                   label: 'Jan (CH, männlich)' }
]
