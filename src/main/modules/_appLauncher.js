// Gemeinsamer Helper, um macOS-Apps lazy beim ersten Tool-Call zu starten.
// Cached den Status, sodass nur einmal pro Session gepingt wird.

import { execFile } from 'child_process'

const launched = new Set()

/**
 * Stellt sicher, dass die genannte App im Hintergrund läuft.
 * @param {string} appName z. B. 'Mail', 'Reminders', 'Calendar'
 */
export function ensureAppRunning(appName) {
  if (launched.has(appName)) return Promise.resolve()
  launched.add(appName)
  return new Promise(resolve => {
    execFile('pgrep', ['-x', appName], (err) => {
      if (!err) {
        // App läuft schon
        resolve()
        return
      }
      // -g: nicht in Vordergrund holen, -j: nicht im Dock zeigen
      execFile('open', ['-gj', '-a', appName], () => {
        console.log(`[AppLauncher] ${appName} im Hintergrund gestartet`)
        // 800ms Aufwärmphase, damit AppleScript-Calls direkt danach klappen
        setTimeout(resolve, 800)
      })
    })
  })
}
