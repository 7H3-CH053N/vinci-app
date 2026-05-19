import { useEffect, useState } from 'react'
import { useLyraStore } from './store/useStore.js'
import { useTTS } from './components/useTTS.js'
import LyraOrb         from './components/LyraOrb.jsx'
import LyraOrbNebula   from './components/LyraOrbNebula.jsx'
import LyraOrbHUD      from './components/LyraOrbHUD.jsx'
import LyraOrbParticle from './components/LyraOrbParticle.jsx'
import ChatPanel      from './components/ChatPanel.jsx'
import Settings       from './components/Settings.jsx'
import About          from './components/About.jsx'
import Tasks          from './components/Tasks.jsx'
import Jobs           from './components/Jobs.jsx'
import Icon           from './components/Icons.jsx'

export default function App() {
  const {
    isSpeaking, isThinking,
    currentView, setView,
    addMessage, setSettings, setTtsSettings,
    settings, audioAnalyser
  } = useLyraStore()

  const { speak } = useTTS()
  const [chatOpen, setChatOpen] = useState(true)
  const [activeJobCount, setActiveJobCount] = useState(0)

  useEffect(() => {
    window.lyra.getSettings().then(s => {
      setSettings(s)
      if (s.tts) setTtsSettings(s.tts)
      if (s.ui) {
        document.documentElement.style.setProperty('--sans', `'${s.ui.fontFamily || 'Inter'}', system-ui, sans-serif`)
        document.documentElement.style.setProperty('--fs', `${Math.round((s.ui.fontScale || 1.0) * 15)}px`)
      }
    })
  }, [])

  useEffect(() => {
    const offBriefing = window.lyra.on('lyra:briefing', ({ text, error }) => {
      addMessage({ role: 'assistant', content: text, isError: !!error })
      // Bei langen Briefings: nur die ersten 2 Sätze sprechen (Zusammenfassung).
      if (text) {
        let toSpeak = text
        if (toSpeak.length > 400) {
          const sentences = toSpeak.match(/[^.!?]+[.!?]+/g) || []
          toSpeak = sentences.slice(0, 2).join(' ').trim() || toSpeak.slice(0, 380)
        }
        if (toSpeak) speak(toSpeak, { module: error ? 'system' : 'briefing' })
      }
      setChatOpen(true)
    })
    const offSettings = window.lyra.on('lyra:openSettings', () => setView('settings'))
    const offAbout    = window.lyra.on('lyra:openAbout',    () => setView('about'))
    const offTasks    = window.lyra.on('lyra:openTasks',    () => setView('tasks'))
    const offTaskRes  = window.lyra.on('lyra:openTaskResult', () => setView('tasks'))
    // Proaktive Daemons (Phase J4): Termin-Reminder etc. erscheinen im Chat + werden gesprochen
    const offProactive = window.lyra.on('lyra:proactive', ({ text, module }) => {
      if (!text) return
      addMessage({ role: 'assistant', content: text })
      speak(text, { module: module || 'reminders' })
      setChatOpen(true)
    })
    // Sub-Agent-Jobs (Phase J6) — Live-Count + Done-Notification + Chat-Inject
    async function refreshActiveCount() {
      try {
        const r = await window.lyra.jobsList({ status: ['pending', 'running'] })
        setActiveJobCount((r.jobs || []).length)
      } catch {}
    }
    refreshActiveCount()
    const offJob = window.lyra.on('lyra:job:event', ({ type, job }) => {
      refreshActiveCount()
      // Bei jedem Job-Event: falls noch keine Chat-Message mit diesem jobId
      // existiert (= Job wurde über UI/Cron getriggert, nicht über Chat),
      // eine Inline-Card-Message anlegen. So gibt's bei jedem Job eine sichtbare
      // Karte im Chat — egal wer ihn ausgelöst hat.
      if (type === 'started' && job?.id) {
        const cur = useLyraStore.getState().messages
        if (!cur.some(m => m.jobId === job.id)) {
          const emoji = job.agent_type === 'researcher' ? '🔎'
            : job.agent_type === 'briefing' ? '📋'
            : job.agent_type === 'weekly' ? '📅'
            : '◈'
          addMessage({
            role: 'assistant',
            content: `${emoji} ${job.title}`,
            jobId: job.id,
            agentType: job.agent_type
          })
          setChatOpen(true)
        }
      }
      // Speak die Kurzfassung bei done
      if (type === 'done' && job?.summary) {
        setChatOpen(true)
        const mod = job.agent_type === 'briefing' || job.agent_type === 'weekly' ? 'briefing' : 'chat'
        speak(job.summary, { module: mod })
      }
    })
    return () => { offBriefing?.(); offSettings?.(); offAbout?.(); offTasks?.(); offTaskRes?.(); offProactive?.(); offJob?.() }
  }, [speak, addMessage, setView])

  function toggleChat() {
    setChatOpen(o => !o)
  }

  async function requestBriefing() {
    addMessage({ role: 'user', content: '☀ Morgen-Briefing' })
    if (!chatOpen) setChatOpen(true)
    await window.lyra.briefing()
  }

  if (currentView === 'settings') {
    return <div className="app"><Settings onClose={() => setView('chat')} /></div>
  }
  if (currentView === 'about') {
    return <div className="app"><About onClose={() => setView('chat')} /></div>
  }
  if (currentView === 'tasks') {
    return <div className="app"><Tasks onClose={() => setView('chat')} /></div>
  }
  if (currentView === 'jobs') {
    return <div className="app"><Jobs onClose={() => setView('chat')} /></div>
  }

  return (
    <div className={`app ${isThinking ? 'is-thinking' : ''}`}>
      {/* Titlebar */}
      <div className="titlebar" style={{ WebkitAppRegion: 'drag' }}>
        <span className="lyra-wordmark">VINCI</span>
        <div className="titlebar-right" style={{ WebkitAppRegion: 'no-drag' }}>
          <button className="tb-btn" onClick={requestBriefing} title="Morgen-Briefing"><Icon.Sun /></button>
          <button className="tb-btn" onClick={() => setView('jobs')} title={`Sub-Agent-Jobs${activeJobCount > 0 ? ` (${activeJobCount} aktiv)` : ''}`} style={{ position: 'relative' }}>
            ⚙
            {activeJobCount > 0 && (
              <span style={{
                position: 'absolute', top: -2, right: -2,
                background: '#D4AF37', color: '#121414',
                fontSize: 9, fontWeight: 700,
                borderRadius: 8, minWidth: 14, height: 14,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 3px'
              }}>{activeJobCount}</span>
            )}
          </button>
          <button className="tb-btn" onClick={() => setView('settings')} title="Einstellungen"><Icon.Settings /></button>
          <button className="tb-btn" onClick={() => window.lyra.hideWindow()} title="Ausblenden"><Icon.X /></button>
        </div>
      </div>

      {/* Orb — Style aus Settings */}
      <div className="orb-wrap">
        {(() => {
          const style = settings?.ui?.orbStyle || 'classic'
          const color = settings?.ui?.orbColor || '#D4AF37'
          const props = { isSpeaking, isThinking, color }
          if (style === 'nebula')   return <LyraOrbNebula {...props} />
          if (style === 'hud')      return <LyraOrbHUD {...props} />
          if (style === 'particle') return <LyraOrbParticle {...props} analyser={audioAnalyser} />
          return <LyraOrb isSpeaking={isSpeaking} isThinking={isThinking} />
        })()}
        <div className={`orb-label ${isSpeaking ? 'lbl-speaking' : isThinking ? 'lbl-thinking' : 'lbl-idle'}`}>
          {isSpeaking ? 'SPRICHT' : isThinking ? 'DENKT' : 'BEREIT'}
        </div>
        <button className={`chat-toggle ${chatOpen ? 'open' : ''}`} onClick={toggleChat} title="Chat ein-/ausblenden">
          {chatOpen ? '▼' : '▲'}
        </button>
      </div>

      {/* Chat */}
      <div className={`chat-drawer ${chatOpen ? 'drawer-open' : 'drawer-closed'}`}>
        <ChatPanel />
      </div>
    </div>
  )
}
