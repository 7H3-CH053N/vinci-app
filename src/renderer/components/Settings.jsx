import { useState, useEffect } from 'react'
import { useLyraStore } from '../store/useStore.js'
import Icon from './Icons.jsx'
import Tasks from './Tasks.jsx'

const TABS = [
  { id: 'ai',     label: 'KI' },
  { id: 'voice',  label: 'Stimme' },
  { id: 'tasks',  label: 'Aufgaben' },
  { id: 'mail',   label: 'Mail & Apps' },
  { id: 'integrations', label: 'Dienste' },
  { id: 'ui',     label: 'Design' }
]

export default function Settings({ onClose }) {
  const { setSettings, setTtsSettings, availableVoices } = useLyraStore()
  const [tab, setTab]     = useState('ai')
  const [local, setLocal] = useState(null)
  const [saved, setSaved] = useState(false)
  const [edgeStatus, setEdgeStatus] = useState(null)
  const [edgeBusy,   setEdgeBusy]   = useState(false)
  const [vaultError, setVaultError] = useState('')
  const [migPlan, setMigPlan]     = useState(null)
  const [migReport, setMigReport] = useState(null)
  const [migBusy, setMigBusy]     = useState(false)
  const [cleanPlan, setCleanPlan]     = useState(null)
  const [cleanReport, setCleanReport] = useState(null)
  const [cleanBusy, setCleanBusy]     = useState(false)
  const [blogResult, setBlogResult]   = useState(null)
  const [blogBusy, setBlogBusy]       = useState(false)
  const [relinkResult, setRelinkResult] = useState(null)
  const [relinkBusy, setRelinkBusy]     = useState(false)

  async function runMigPlan() {
    setMigBusy(true)
    try {
      const r = await window.lyra.migrationPlan()
      setMigPlan(r)
      setMigReport(null)
    } finally { setMigBusy(false) }
  }
  async function runMigDry() {
    setMigBusy(true)
    try {
      const r = await window.lyra.migrationApply(migPlan, { dryRun: true })
      setMigReport({ ...r, _dry: true })
    } finally { setMigBusy(false) }
  }
  async function runMigApply() {
    if (!confirm('Echter Lauf — Backup wird unter ~/.vinci-archive/ erstellt, alte Vaults werden archiviert. Sicher?')) return
    setMigBusy(true)
    try {
      const r = await window.lyra.migrationApply(migPlan, { dryRun: false })
      setMigReport({ ...r, _dry: false })
    } finally { setMigBusy(false) }
  }

  async function runCleanScan() {
    setCleanBusy(true)
    try {
      const r = await window.lyra.cleanerScan()
      setCleanPlan(r)
      setCleanReport(null)
    } finally { setCleanBusy(false) }
  }
  function toggleProposal(id) {
    if (!cleanPlan) return
    setCleanPlan({
      ...cleanPlan,
      proposals: cleanPlan.proposals.map(p => p.id === id ? { ...p, accepted: !p.accepted } : p)
    })
  }
  function setAllAccepted(value) {
    if (!cleanPlan) return
    setCleanPlan({
      ...cleanPlan,
      proposals: cleanPlan.proposals.map(p => ({ ...p, accepted: value }))
    })
  }
  async function runCleanDry() {
    setCleanBusy(true)
    try {
      const r = await window.lyra.cleanerApply(cleanPlan, { dryRun: true })
      setCleanReport({ ...r, _dry: true })
    } finally { setCleanBusy(false) }
  }
  async function runCleanApply() {
    if (!confirm('Echter Lauf — Backup wird unter ~/.vinci-archive/ erstellt, akzeptierte Vorschläge werden umgesetzt. Sicher?')) return
    setCleanBusy(true)
    try {
      const r = await window.lyra.cleanerApply(cleanPlan, { dryRun: false })
      setCleanReport({ ...r, _dry: false })
    } finally { setCleanBusy(false) }
  }

  async function runBlogSync(force = false) {
    setBlogBusy(true)
    try {
      setBlogResult(await window.lyra.blogSync({ force }))
    } finally { setBlogBusy(false) }
  }

  async function runRelinkAll() {
    if (!confirm('Alle Posts neu verlinken — kann je nach Vault-Größe 10-30 Sekunden dauern. OK?')) return
    setRelinkBusy(true)
    try {
      setRelinkResult(await window.lyra.blogRelinkAll())
    } finally { setRelinkBusy(false) }
  }

  useEffect(() => {
    window.lyra.getSettings().then(s => {
      setLocal(s)
      setTtsSettings(s.tts)
    })
    window.lyra.edgeTTSStatus?.().then(setEdgeStatus).catch(() => {})
  }, [])

  useEffect(() => {
    const path = local?.obsidian?.vaultPath
    if (!path) { setVaultError(''); return }
    let active = true
    window.lyra?.validateVaultPath?.(path).then(r => {
      if (active) setVaultError(r?.error || '')
    })
    return () => { active = false }
  }, [local?.obsidian?.vaultPath])

  async function refreshEdgeStatus() {
    const s = await window.lyra.edgeTTSStatus()
    setEdgeStatus(s)
  }

  if (!local) return (
    <div className="settings-loading"><span className="spinner">◌</span></div>
  )

  function update(path, value) {
    const parts = path.split('.')
    setLocal(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      let cursor = next
      for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] = cursor[parts[i]] || {}
        cursor = cursor[parts[i]]
      }
      cursor[parts[parts.length - 1]] = value
      // Live font preview — base 15px must match App.jsx initial load
      if (path.startsWith('ui.')) {
        const ui = next.ui || {}
        document.documentElement.style.setProperty('--sans', `'${ui.fontFamily || 'Inter Tight'}', system-ui, sans-serif`)
        document.documentElement.style.setProperty('--fs', `${Math.round((ui.fontScale || 1.0) * 15)}px`)
      }
      return next
    })
  }

  async function save() {
    await window.lyra.saveSettings(local)
    setSettings(local)
    setTtsSettings(local.tts)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function previewVoice() {
    const text = 'Hallo Alex, ich bin Lyra. So klinge ich.'
    const provider = local.tts?.provider || 'system'

    if (provider === 'edge') {
      // Edge TTS: gleiche Pipeline wie im Chat (MP3 via Python-Subprozess → <audio>)
      const voice = local.tts?.edgeVoice || 'de-AT-IngridNeural'
      try {
        const res = await window.lyra.edgeTTSSpeak(text, voice)
        if (!res?.ok) {
          alert('Edge TTS Fehler: ' + (res?.error || 'unbekannt'))
          return
        }
        if (!res.audioB64) {
          alert('Edge TTS: keine Audio-Daten zurückbekommen — bitte npm run dev neu starten.')
          return
        }
        console.log('[Preview] got', res.audioB64.length, 'b64 chars')

        const audio = new Audio()
        audio.preload = 'auto'
        audio.volume = local.tts?.volume ?? 1.0
        audio.src = 'data:audio/mpeg;base64,' + res.audioB64

        await new Promise((resolve, reject) => {
          const onReady = () => { cleanup(); resolve() }
          const onErr   = () => { cleanup(); reject(new Error('decode error: ' + (audio.error?.code) + ' ' + (audio.error?.message || ''))) }
          const cleanup = () => {
            audio.removeEventListener('canplaythrough', onReady)
            audio.removeEventListener('error', onErr)
          }
          audio.addEventListener('canplaythrough', onReady, { once: true })
          audio.addEventListener('error',          onErr,   { once: true })
          if (audio.readyState >= 4) { cleanup(); resolve() }
        })
        await audio.play()
      } catch (e) {
        console.warn('[Preview] error:', e)
        alert('Vorschau fehlgeschlagen: ' + e.message)
      }
      return
    }

    // System-TTS (Web Speech API)
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = local.tts?.rate ?? 1.0
    u.pitch = local.tts?.pitch ?? 1.0
    u.volume = local.tts?.volume ?? 1.0
    if (local.tts?.voice && local.tts.voice !== 'auto') {
      const v = window.speechSynthesis.getVoices().find(v => v.name === local.tts.voice)
      if (v) u.voice = v
    }
    window.speechSynthesis.speak(u)
  }

  return (
    <div className="settings-panel">
      {/* Header */}
      <div className="settings-header">
        <span className="settings-title">EINSTELLUNGEN</span>
        <button className="close-btn" onClick={onClose}><Icon.X /></button>
      </div>

      {/* Tabs */}
      <div className="settings-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`settings-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="settings-body">

        {/* ── KI ─────────────────────────────────────────────────────────── */}
        {tab === 'ai' && <>
          <div className="field">
            <label>Provider</label>
            <div className="radio-group">
              {['gemini', 'ollama'].map(p => (
                <label key={p} className="radio-label">
                  <input type="radio" name="provider" value={p}
                    checked={(local.aiProvider || 'gemini') === p}
                    onChange={() => update('aiProvider', p)} />
                  <span>{p === 'gemini' ? '☁ Gemini (Cloud)' : '🖥 Ollama (Lokal)'}</span>
                </label>
              ))}
            </div>
          </div>

          {(local.aiProvider || 'gemini') === 'gemini' && <>
            <div className="field">
              <label>Gemini API Key</label>
              <input type="password" className="inp"
                value={local.geminiApiKey || ''}
                onChange={e => update('geminiApiKey', e.target.value)}
                placeholder="AIza..." />
            </div>
            <div className="field">
              <label>Modell</label>
              <select className="inp" value={local.geminiModel || 'gemini-2.5-flash'}
                onChange={e => update('geminiModel', e.target.value)}>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (empfohlen)</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (langsamer, präziser)</option>
                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (günstiger, schwächer bei Tool-Use)</option>
              </select>
              <p className="hint">Flash-Lite kann bei Memory-/Tool-Logik scheitern (z. B. „Wie alt wird X?"). Wenn du Probleme bemerkst → Flash.</p>
            </div>
            <div className="field">
              <label>Fallback-Modell (bei Überlastung)</label>
              <select className="inp" value={local.geminiFallbackModel || 'gemini-2.5-flash'}
                onChange={e => update('geminiFallbackModel', e.target.value)}>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
              </select>
              <p className="hint">Wenn das Hauptmodell mit 503/Überlastung antwortet, wird nach 1 Retry automatisch auf dieses Modell gewechselt.</p>
            </div>
          </>}

          {local.aiProvider === 'ollama' && <>
            <div className="field">
              <label>Ollama Modell</label>
              <input className="inp" value={local.ollamaModel || 'qwen3:4b'}
                onChange={e => update('ollamaModel', e.target.value)}
                placeholder="qwen3:4b" />
            </div>
            <div className="field">
              <label>Ollama URL</label>
              <input className="inp" value={local.ollamaUrl || 'http://localhost:11434'}
                onChange={e => update('ollamaUrl', e.target.value)} />
            </div>
            <p className="hint">Gemini API Key setzen für schnelle Tool-Calls (Hybrid-Modus)</p>
          </>}

          <div className="field">
            <label>Briefing-Uhrzeit</label>
            <input type="time" className="inp time-inp"
              value={local.briefingTime || '06:30'}
              onChange={e => update('briefingTime', e.target.value)} />
          </div>
        </>}

        {/* ── Stimme ──────────────────────────────────────────────────────── */}
        {tab === 'voice' && <>
          <div className="field row">
            <label>Sprachausgabe aktiv</label>
            <input type="checkbox" checked={local.tts?.enabled ?? true}
              onChange={e => update('tts.enabled', e.target.checked)} />
          </div>

          <div className="field">
            <label>Stimm-Anbieter</label>
            <div className="radio-group">
              {[
                ['system', '🍎 macOS-Stimmen (lokal, sofort)'],
                ['edge',   '🌍 Microsoft Edge TTS (online, sehr natürlich)']
              ].map(([val, label]) => (
                <label key={val} className="radio-label">
                  <input type="radio" name="ttsProvider" value={val}
                    checked={(local.tts?.provider || 'system') === val}
                    onChange={() => update('tts.provider', val)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="hint">Edge TTS bietet die natürlichsten deutschen Stimmen. Benötigt Python + edge-tts.</p>
          </div>

          {(local.tts?.provider || 'system') === 'edge' && (
            <div className="field">
              <label>Edge-Stimme</label>
              <select className="inp" value={local.tts?.edgeVoice || 'de-AT-IngridNeural'}
                onChange={e => update('tts.edgeVoice', e.target.value)}>
                {[
                  ['de-AT-IngridNeural',                'Ingrid (AT, weiblich)'],
                  ['de-AT-JonasNeural',                 'Jonas (AT, männlich)'],
                  ['de-DE-KatjaNeural',                 'Katja (DE, weiblich)'],
                  ['de-DE-AmalaNeural',                 'Amala (DE, weiblich)'],
                  ['de-DE-ConradNeural',                'Conrad (DE, männlich)'],
                  ['de-DE-KillianNeural',               'Killian (DE, männlich)'],
                  ['de-DE-FlorianMultilingualNeural',   'Florian (DE, mehrsprachig)'],
                  ['de-DE-SeraphinaMultilingualNeural', 'Seraphina (DE, mehrsprachig)'],
                  ['de-CH-LeniNeural',                  'Leni (CH, weiblich)'],
                  ['de-CH-JanNeural',                   'Jan (CH, männlich)']
                ].map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>

              {/* Status / Install-Helfer */}
              <div style={{ marginTop: 8, padding: 10, background: 'rgba(212,175,55,0.04)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: 6, fontSize: 12 }}>
                {!edgeStatus && <span>Status wird geprüft...</span>}
                {edgeStatus && edgeStatus.python && edgeStatus.edgeTts && (
                  <span style={{ color: '#8ec78e' }}>✓ Bereit · Python {edgeStatus.python.includes('homebrew') ? '(Homebrew)' : ''} · edge-tts {edgeStatus.edgeTtsVersion}</span>
                )}
                {edgeStatus && !edgeStatus.python && (
                  <div>
                    <div style={{ marginBottom: 6 }}>⚠ Python ist nicht installiert.</div>
                    <button className="btn-secondary"
                      disabled={edgeBusy}
                      onClick={async () => {
                        setEdgeBusy(true)
                        await window.lyra.edgeTTSInstallPython()
                        setEdgeBusy(false)
                      }}>
                      Python-Download öffnen
                    </button>
                    <button className="btn-ghost" style={{ marginLeft: 8 }} onClick={refreshEdgeStatus}>
                      Erneut prüfen
                    </button>
                    <p className="hint" style={{ marginTop: 6 }}>
                      Im Browser den macOS-Universal-Installer (.pkg) herunterladen und ausführen — dann hier "Erneut prüfen" klicken.
                    </p>
                  </div>
                )}
                {edgeStatus && edgeStatus.python && !edgeStatus.edgeTts && (
                  <div>
                    <div style={{ marginBottom: 6 }}>⚠ Python ist da, aber edge-tts fehlt.</div>
                    <button className="btn-secondary"
                      disabled={edgeBusy}
                      onClick={async () => {
                        setEdgeBusy(true)
                        const r = await window.lyra.edgeTTSInstallPkg()
                        setEdgeBusy(false)
                        if (r.ok) {
                          await refreshEdgeStatus()
                        } else {
                          alert('Installation fehlgeschlagen:\n' + (r.error || r.log || 'Unbekannt'))
                        }
                      }}>
                      {edgeBusy ? 'Installiere...' : 'edge-tts installieren'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {(local.tts?.provider || 'system') === 'system' && (
            <div className="field">
              <label>Stimme</label>
              <select className="inp" value={local.tts?.voice || 'auto'}
                onChange={e => update('tts.voice', e.target.value)}>
                <option value="auto">Automatisch</option>
                {availableVoices.map(v => (
                  <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                ))}
              </select>
              <p className="hint">Siri-Stimmen: Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte</p>
            </div>
          )}
          <div className="field">
            <label>Geschwindigkeit: {(local.tts?.rate || 1).toFixed(1)}×</label>
            <input type="range" min="0.5" max="2" step="0.1" className="range"
              value={local.tts?.rate || 1}
              onChange={e => update('tts.rate', parseFloat(e.target.value))} />
          </div>
          <div className="field">
            <label>Tonhöhe: {(local.tts?.pitch || 1).toFixed(1)}</label>
            <input type="range" min="0.5" max="2" step="0.1" className="range"
              value={local.tts?.pitch || 1}
              onChange={e => update('tts.pitch', parseFloat(e.target.value))} />
          </div>
          <div className="field">
            <label>Lautstärke: {Math.round((local.tts?.volume || 1) * 100)}%</label>
            <input type="range" min="0" max="1" step="0.05" className="range"
              value={local.tts?.volume || 1}
              onChange={e => update('tts.volume', parseFloat(e.target.value))} />
          </div>
          <button className="btn-secondary" onClick={previewVoice}>▶ Vorschau</button>

          {/* ── Was darf gesprochen werden — pro Modul ─────────────────────── */}
          <div className="field" style={{ marginTop: 24 }}>
            <label>Was darf gesprochen werden</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginTop: 8 }}>
              {[
                ['weather',   '🌤 Wetter'],
                ['calendar',  '📅 Termine'],
                ['mail',      '📧 Mail'],
                ['reminders', '⏰ Erinnerungen'],
                ['messages',  '💬 iMessages'],
                ['contacts',  '👥 Kontakte'],
                ['obsidian',  '📝 Obsidian'],
                ['strom',     '⚡ Strom'],
                ['news',      '📰 News'],
                ['web',       '🌍 Web-Suche'],
                ['n8n',       '🔁 n8n'],
                ['homeassistant', '🏠 Home Assistant'],
                ['briefing',  '☀ Morgen-Briefing'],
                ['chat',      '💭 Chat-Antworten'],
                ['tasks',     '✓ Aufgaben'],
                ['system',    '⚠ Fehler/System']
              ].map(([key, label]) => {
                const checked = local.tts?.modules?.[key] !== false
                return (
                  <label key={key} className="radio-label" style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => update(`tts.modules.${key}`, e.target.checked)}
                    />
                    <span>{label}</span>
                  </label>
                )
              })}
            </div>
            <p className="hint">Ingrid spricht nur die aktivierten Bereiche. „Chat-Antworten" ist die Standard-Kategorie für allgemeine Antworten ohne Modul-Tag.</p>
          </div>
        </>}

        {/* ── Aufgaben ────────────────────────────────────────────────────── */}
        {tab === 'tasks' && <>
          <Tasks inline />
        </>}

        {/* ── Mail & Apps ──────────────────────────────────────────────────── */}
        {tab === 'mail' && <>
          <div className="field">
            <label>Mail-App</label>
            <div className="radio-group">
              {[['Mail', '📬 Apple Mail'], ['Outlook', '📧 Microsoft Outlook']].map(([val, label]) => (
                <label key={val} className="radio-label">
                  <input type="radio" name="mailApp" value={val}
                    checked={(local.mailApp || 'Mail') === val}
                    onChange={() => update('mailApp', val)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="hint">Lyra liest direkt aus der installierten App — kein Login nötig.</p>
          </div>
          <div className="field">
            <label>Hotkey</label>
            <input className="inp" value={local.hotkey || 'CommandOrControl+Shift+Space'}
              onChange={e => update('hotkey', e.target.value)} />
            <p className="hint">Neustart erforderlich nach Änderung</p>
          </div>
        </>}

        {/* ── Dienste ─────────────────────────────────────────────────────── */}
        {tab === 'integrations' && <>

          {/* Home Assistant */}
          <div className="field">
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold)' }}>🏠 Home Assistant</label>
          </div>
          <div className="field">
            <label>HA URL (LAN)</label>
            <input className="inp" value={local.homeassistant?.lanUrl || ''}
              onChange={e => update('homeassistant.lanUrl', e.target.value)}
              placeholder="http://192.168.68.71:8123" />
          </div>
          <div className="field">
            <label>HA URL (Tailscale / Remote)</label>
            <input className="inp" value={local.homeassistant?.remoteUrl || ''}
              onChange={e => update('homeassistant.remoteUrl', e.target.value)}
              placeholder="http://homeassistant.tailfa2820.ts.net:8123" />
          </div>
          <div className="field">
            <label>HA Long-Lived Token</label>
            <input type="password" className="inp" value={local.homeassistant?.token || ''}
              onChange={e => update('homeassistant.token', e.target.value)}
              placeholder="ey..." />
            <p className="hint">In Home Assistant: Profil (unten links) → „Sicherheit" → „Lang-laufende Zugangstoken" → Token erstellen.</p>
          </div>
          <div className="field">
            <button className="btn-secondary" onClick={async () => {
              // Vor dem Test ggf. die Config sichern, damit der Test sie sieht
              setSettings(local)
              await window.lyra.saveSettings(local)
              const r = await window.lyra.haTest()
              if (r.ok) {
                alert(`✓ Verbunden mit "${r.locationName}" (HA ${r.version}) via ${r.via === 'lan' ? 'LAN' : 'Tailscale'}`)
              } else {
                alert('Verbindung fehlgeschlagen: ' + (r.error || 'unbekannt'))
              }
            }}>Verbindung testen</button>
          </div>

          <div className="field" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>n8n</label>
          </div>
          <div className="field">
            <label>n8n URL</label>
            <input className="inp" value={local.n8n?.baseUrl || ''}
              onChange={e => update('n8n.baseUrl', e.target.value)}
              placeholder="https://bot.promptrocker.at" />
          </div>
          <div className="field">
            <label>n8n API Key</label>
            <input type="password" className="inp" value={local.n8n?.apiKey || ''}
              onChange={e => update('n8n.apiKey', e.target.value)}
              placeholder="n8n_api_..." />
          </div>
          <div className="field">
            <label>Strom API URL</label>
            <input className="inp" value={local.strom?.apiUrl || ''}
              onChange={e => update('strom.apiUrl', e.target.value)}
              placeholder="https://strom.vibecodes.at/api" />
          </div>
          <div className="field">
            <label>Tavily API-Key (Web-Suche)</label>
            <input type="password" className="inp"
              value={local.tavily?.apiKey || ''}
              onChange={e => update('tavily.apiKey', e.target.value)}
              placeholder="tvly-..." />
            <p className="hint">Kostenloser Account auf <a className="about-link" href="#" onClick={(e) => { e.preventDefault(); window.lyra.openExternal && window.lyra.openExternal('https://app.tavily.com/home') }}>app.tavily.com</a> (1.000 Credits/Monat gratis, ohne Kreditkarte). Internet-Treffer landen NIE im Memory oder Obsidian.</p>
          </div>

          <div className="field">
            <label>Obsidian-Vault (Ordner)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="inp" style={{ flex: 1 }}
                value={local.obsidian?.vaultPath || ''}
                onChange={e => update('obsidian.vaultPath', e.target.value)}
                placeholder="/Users/alex/Documents/MyVault" />
              <button className="btn-secondary" onClick={async () => {
                const r = await window.lyra.pickFolder()
                if (r && !r.canceled && r.path) update('obsidian.vaultPath', r.path)
              }}>📁 Wählen</button>
            </div>
            {vaultError && (
              <p className="hint" style={{ color: '#ff6b6b', marginTop: '4px' }}>
                ⚠️ {vaultError}
              </p>
            )}
            <p className="hint">Leerlassen, um Obsidian zu deaktivieren. VINCI durchsucht alle .md-Dateien im Ordner und kann neue Notizen in <code>inbox/</code> anlegen (überschreibt nie bestehende).</p>
          </div>

          <div className="field">
            <label>Knowledge-Graph Modell</label>
            <select className="inp"
              value={local.memoryWorkerModel || 'gemma3:4b'}
              onChange={e => update('memoryWorkerModel', e.target.value)}>
              <option value="gemma3:4b">gemma3:4b — Default (beste deutsche Qualität, schnell)</option>
              <option value="qwen3:4b">qwen3:4b</option>
              <option value="qwen3:8b">qwen3:8b — Maximale Qualität (+2s pro Run)</option>
              <option value="qwen2.5:3b">qwen2.5:3b — veraltet</option>
            </select>
            <p className="hint">
              Modell für Entity-Extraction (im Hintergrund). Muss in Ollama installiert sein:
              {' '}<code>ollama pull gemma3:4b</code>
            </p>
          </div>

          {/* Proaktive Daemons ─────────────────────────────────────── */}
          <div className="field" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Proaktive Erinnerungen</label>
            <p className="hint">VINCI benachrichtigt dich von selbst — wenn du es willst. Jede Erinnerung kommt als Notification, Chat-Message und Sprachausgabe (über das jeweilige TTS-Modul).</p>

            <label className="radio-label" style={{ marginTop: 8 }}>
              <input type="checkbox"
                checked={local.proactive?.calendarWarning !== false}
                onChange={e => update('proactive.calendarWarning', e.target.checked)} />
              <span>📅 Termin-Vorlauf — 15 min vor jedem Kalender-Termin</span>
            </label>
            <button className="btn-secondary" style={{ marginTop: 4, marginBottom: 8 }}
              onClick={async () => {
                const r = await window.lyra.proactiveRun('calendar-warning')
                alert(r?.ok ? 'Geprüft — wenn ein Termin in 10-17 min kommt, läuft die Notification.' : (r?.error || 'Fehler'))
              }}>jetzt testen</button>

            <label className="radio-label" style={{ marginTop: 8 }}>
              <input type="checkbox"
                checked={local.proactive?.stromAnomaly !== false}
                onChange={e => update('proactive.stromAnomaly', e.target.checked)} />
              <span>⚡ Strom-Anomalie — wenn Verbrauch über Schwellwert</span>
            </label>
            <div style={{ marginLeft: 24, marginTop: 4, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Schwelle (Watt):</span>
              <input type="number" className="inp" style={{ width: 80 }}
                value={local.proactive?.stromThresholdW || 2500}
                min={500} step={100}
                onChange={e => update('proactive.stromThresholdW', parseInt(e.target.value) || 2500)} />
              <button className="btn-secondary"
                onClick={async () => {
                  const r = await window.lyra.proactiveRun('strom-anomaly')
                  alert(r?.ok ? 'Geprüft — feuert nur wenn aktueller Watt > Schwellwert.' : (r?.error || 'Fehler'))
                }}>jetzt testen</button>
            </div>

            <label className="radio-label" style={{ marginTop: 8 }}>
              <input type="checkbox"
                checked={local.proactive?.vaultDrift !== false}
                onChange={e => update('proactive.vaultDrift', e.target.checked)} />
              <span>📚 Vault-Drift — wöchentlich (So 18:00) Posts ohne Wikilinks</span>
            </label>
            <button className="btn-secondary" style={{ marginTop: 4, marginBottom: 8 }}
              onClick={async () => {
                const r = await window.lyra.proactiveRun('vault-drift')
                alert(r?.ok ? 'Geprüft — feuert wenn ≥ 3 Posts ohne mentions stehen.' : (r?.error || 'Fehler'))
              }}>jetzt testen</button>

            <label className="radio-label" style={{ marginTop: 8 }}>
              <input type="checkbox"
                checked={local.proactive?.quarantineReminder !== false}
                onChange={e => update('proactive.quarantineReminder', e.target.checked)} />
              <span>🗑 Quarantäne-Reminder — wöchentlich (So 18:30) wenn _quarantine/ älter als 14 Tage</span>
            </label>
            <button className="btn-secondary" style={{ marginTop: 4 }}
              onClick={async () => {
                const r = await window.lyra.proactiveRun('quarantine-reminder')
                alert(r?.ok ? 'Geprüft — feuert wenn älteste Datei > 14 Tage alt ist.' : (r?.error || 'Fehler'))
              }}>jetzt testen</button>
          </div>

          {/* Mac-Vault-Migration ─────────────────────────────────────── */}
          <div className="field" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Mac-Vault-Migration</label>
            <p className="hint">
              Einmalig: Daten aus den alten Mac-Vaults <code>/Users/.../Vaults/VINCI</code> und
              {' '}<code>/Users/.../Vaults/VINCI Wissen</code> in den kanonischen Vault zusammenführen.
              Schritte: 1) Plan erstellen, 2) Dry-Run, 3) Anwenden.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn-secondary" disabled={migBusy} onClick={runMigPlan}>1. Migration planen</button>
              <button className="btn-secondary" disabled={migBusy || !migPlan} onClick={runMigDry}>2. Dry-Run</button>
              <button className="btn-secondary" disabled={migBusy || !migPlan} onClick={runMigApply}>3. Echt anwenden (mit Backup)</button>
            </div>
            {migPlan && (
              <details style={{ marginTop: 12 }}>
                <summary>Plan: {migPlan.scanned ?? 0} Notes gescannt, {migPlan.proposals?.length ?? 0} Vorschläge</summary>
                <pre style={{ fontSize: '0.8em', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(migPlan, null, 2)}</pre>
              </details>
            )}
            {migReport && (
              <div style={{ marginTop: 12, padding: 8, background: 'rgba(0,200,100,0.1)', borderRadius: 4 }}>
                <strong>{migReport._dry ? 'Dry-Run Report' : 'Echt-Lauf Report'}:</strong>
                <pre style={{ fontSize: '0.8em' }}>{JSON.stringify(migReport, null, 2)}</pre>
              </div>
            )}
          </div>

          {/* Knowledge-Graph Cleaner ─────────────────────────────────────── */}
          <div className="field" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Knowledge-Graph aufräumen</label>
            <p className="hint">
              Findet Müll-Notes (Hardware-Metriken, Telefonnummern, Tarif-Namen wie Plus/Pro,
              Domain-Notes in falscher Kategorie, doppelte Personen-Einträge mit Vor- und vollem Namen)
              und schlägt Aufräum-Aktionen vor. Du wählst pro Vorschlag, was angewendet werden soll.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn-secondary" disabled={cleanBusy} onClick={runCleanScan}>1. Vault scannen</button>
              <button className="btn-secondary" disabled={cleanBusy || !cleanPlan} onClick={runCleanDry}>2. Dry-Run</button>
              <button className="btn-secondary" disabled={cleanBusy || !cleanPlan} onClick={runCleanApply}>3. Echt anwenden (mit Backup)</button>
            </div>
            {cleanPlan && (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: '0.9em' }}>
                  {cleanPlan.scanned} Notes gescannt, {cleanPlan.proposals?.length ?? 0} Vorschläge.
                  {' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); setAllAccepted(true) }}>Alle akzeptieren</a>
                  {' / '}
                  <a href="#" onClick={(e) => { e.preventDefault(); setAllAccepted(false) }}>Alle ablehnen</a>
                </p>
                <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', padding: 8 }}>
                  {cleanPlan.proposals?.map(p => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', fontSize: '0.85em' }}>
                      <input type="checkbox" checked={p.accepted} onChange={() => toggleProposal(p.id)} />
                      <span>
                        <strong>[{p.kind}]</strong>{' '}
                        {p.kind === 'trash' && <code>{p.category}/{p.name}</code>}
                        {p.kind === 'recategorize' && <><code>{p.from_category}/{p.name}</code> → <code>{p.to_category}/</code></>}
                        {p.kind === 'merge' && <><code>{p.alias}</code> → <code>{p.name}</code></>}
                        {' — '}
                        <span style={{ opacity: 0.7 }}>{p.reason}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {cleanReport && (
              <div style={{ marginTop: 12, padding: 8, background: cleanReport.errors?.length ? 'rgba(255,80,80,0.1)' : 'rgba(0,200,100,0.1)', borderRadius: 4 }}>
                <strong>{cleanReport._dry ? 'Dry-Run Report' : 'Echt-Lauf Report'}:</strong>
                <pre style={{ fontSize: '0.8em' }}>{JSON.stringify(cleanReport, null, 2)}</pre>
              </div>
            )}
          </div>

          {/* Blog-Sync (digitalhandwerk) ─────────────────────────────────── */}
          <div className="field" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border, #333)' }}>
            <h3>Blog-Sync (digitalhandwerk)</h3>
            <p className="hint">
              Holt neue Posts von <code>digitalhandwerk.rocks</code> via WordPress-REST in den
              Vault unter <code>RSS/digitalhandwerk/</code>. Idempotent (überspringt vorhandene Posts).
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button disabled={blogBusy} onClick={() => runBlogSync(false)}>Jetzt holen (nur neue)</button>
              <button disabled={blogBusy} onClick={() => runBlogSync(true)}>Alle neu holen (force)</button>
            </div>
            {blogResult && (
              <div style={{ marginTop: '12px', padding: '8px', background: blogResult.error ? 'rgba(255,80,80,0.1)' : 'rgba(0,200,100,0.1)', borderRadius: '4px' }}>
                <pre style={{ fontSize: '0.8em' }}>{JSON.stringify(blogResult, null, 2)}</pre>
              </div>
            )}
            <div style={{ marginTop: '12px' }}>
              <button disabled={relinkBusy} onClick={runRelinkAll}>Bestehende Posts neu verlinken</button>
              <p className="hint" style={{ fontSize: '0.85em' }}>
                Scannt alle bereits importierten Posts, setzt Wikilinks zu bekannten Personen/Firmen/Quellen,
                fügt Backlinks in die Entity-Notes ein. Idempotent (mehrfaches Ausführen schadet nicht).
              </p>
              {relinkResult && (
                <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,200,100,0.1)', borderRadius: '4px' }}>
                  <pre style={{ fontSize: '0.8em' }}>{JSON.stringify(relinkResult, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </>}

        {/* ── Design ──────────────────────────────────────────────────────── */}
        {tab === 'ui' && <>
          <div className="field">
            <label>Schriftart</label>
            <select className="inp" value={local.ui?.fontFamily || 'Inter Tight'}
              onChange={e => update('ui.fontFamily', e.target.value)}>
              <option value="Inter Tight">Inter Tight (Standard)</option>
              <option value="Inter">Inter</option>
              <option value="IBM Plex Sans">IBM Plex Sans</option>
              <option value="system-ui">System (SF Pro)</option>
            </select>
            <div className="font-preview" style={{ fontFamily: local.ui?.fontFamily || 'Inter Tight' }}>
              Lyra – Dein persönlicher KI-Assistent
            </div>
          </div>
          <div className="field">
            <label>Schriftgröße: {Math.round((local.ui?.fontScale || 1) * 15)}px</label>
            <input type="range" min="0.85" max="1.4" step="0.05" className="range"
              value={local.ui?.fontScale || 1}
              onChange={e => update('ui.fontScale', parseFloat(e.target.value))} />
          </div>

          <div className="field">
            <label>Orb-Stil</label>
            <div className="radio-group">
              {[
                ['classic',  '◉ Klassisch (ruhig)'],
                ['nebula',   '✺ Nebula (lebendig, organisch)'],
                ['hud',      '⌬ HUD (verbundene Partikel, Sci-Fi)'],
                ['particle', '✦ Partikel-Schwarm (3D, Funken)']
              ].map(([val, label]) => (
                <label key={val} className="radio-label">
                  <input type="radio" name="orbStyle" value={val}
                    checked={(local.ui?.orbStyle || 'classic') === val}
                    onChange={() => update('ui.orbStyle', val)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="hint">Änderung wird sofort beim Speichern wirksam.</p>
          </div>

          <div className="field">
            <label>Orb-Farbe</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {[
                ['#D4AF37', 'Gold'],
                ['#2FE0CC', 'Türkis'],
                ['#7FCFFF', 'Eis'],
                ['#A47CFF', 'Violett'],
                ['#FF3D9F', 'Magenta'],
                ['#5EE070', 'Grün'],
                ['#FF8533', 'Orange'],
                ['#FF4D4D', 'Rot']
              ].map(([hex, name]) => (
                <button key={hex} type="button"
                  onClick={() => update('ui.orbColor', hex)}
                  title={name}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    border: (local.ui?.orbColor || '#D4AF37').toLowerCase() === hex.toLowerCase()
                            ? '2px solid white' : '1px solid #444',
                    background: hex, cursor: 'pointer'
                  }} />
              ))}
              <input type="color"
                value={local.ui?.orbColor || '#D4AF37'}
                onChange={e => update('ui.orbColor', e.target.value)}
                style={{ width: 36, height: 28, padding: 0, border: '1px solid #444', borderRadius: 4, background: 'transparent', cursor: 'pointer' }} />
              <input type="text" className="inp"
                style={{ flex: '0 1 100px', fontFamily: 'monospace', fontSize: 12 }}
                value={local.ui?.orbColor || '#D4AF37'}
                onChange={e => update('ui.orbColor', e.target.value)}
                placeholder="#D4AF37" />
            </div>
            <p className="hint">Klicke auf eine Farbe oder gib einen Hex-Wert ein.</p>
          </div>
        </>}

      </div>

      {/* Footer */}
      <div className="settings-footer">
        <button className="btn-primary" onClick={save}>
          {saved ? '✓ Gespeichert' : 'Speichern'}
        </button>
        <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  )
}
