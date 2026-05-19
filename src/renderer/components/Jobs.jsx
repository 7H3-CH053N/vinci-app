// Sub-Agent-Jobs Panel (Phase J6).

import { useEffect, useState } from 'react'
import Icon from './Icons.jsx'

const STATUS_LABEL = {
  pending: 'wartet', running: 'läuft', done: 'fertig',
  failed: 'Fehler', cancelled: 'abgebrochen'
}
const STATUS_COLOR = {
  pending: '#888', running: '#D4AF37', done: '#3da766',
  failed: '#c74848', cancelled: '#666'
}

function formatTime(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function duration(job) {
  if (!job.started_at) return '–'
  const end = new Date(job.finished_at || Date.now()).getTime()
  const start = new Date(job.started_at).getTime()
  const sec = Math.round((end - start) / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

export default function Jobs({ onClose }) {
  const [jobs, setJobs] = useState([])
  const [agents, setAgents] = useState([])
  const [selected, setSelected] = useState(null)
  const [enqueueing, setEnqueueing] = useState(false)
  const [progressMap, setProgressMap] = useState({})
  const [echoInput, setEchoInput] = useState('')
  const [showEchoForm, setShowEchoForm] = useState(false)
  const [researchInput, setResearchInput] = useState('')
  const [researchDeep, setResearchDeep] = useState(false)
  const [showResearchForm, setShowResearchForm] = useState(false)

  async function reload() {
    const r = await window.lyra.jobsList({ limit: 50 })
    setJobs(r.jobs || [])
  }

  useEffect(() => {
    reload()
    window.lyra.jobsAgents().then(r => setAgents(r.agents || []))
    const off = window.lyra.on('lyra:job:event', ({ type, job, info }) => {
      reload()
      if (type === 'progress' && info) {
        setProgressMap(p => ({ ...p, [job.id]: String(info) }))
      }
    })
    const interval = setInterval(reload, 5000)
    return () => { off?.(); clearInterval(interval) }
  }, [])

  async function cancel(id) {
    await window.lyra.jobsCancel(id)
    reload()
  }
  async function cleanup() {
    await window.lyra.jobsCleanup()
    reload()
  }
  async function submitEcho(e) {
    e?.preventDefault?.()
    const text = echoInput.trim()
    if (!text) return
    setEnqueueing(true)
    try {
      await window.lyra.jobsEnqueue({
        agent_type: 'echo',
        params: { text, delayMs: 1500 },
        title: `Echo: ${text}`
      })
      setEchoInput('')
      setShowEchoForm(false)
      reload()
    } finally { setEnqueueing(false) }
  }

  async function startBriefing() {
    if (enqueueing) return
    setEnqueueing(true)
    try {
      const r = await window.lyra.jobsEnqueue({
        agent_type: 'briefing',
        params: {},
        title: 'Tagesbriefing'
      })
      if (r?.error) { alert('Fehler: ' + r.error); return }
      reload()
    } finally { setEnqueueing(false) }
  }

  async function startWeekly() {
    if (enqueueing) return
    setEnqueueing(true)
    try {
      const r = await window.lyra.jobsEnqueue({
        agent_type: 'weekly',
        params: {},
        title: 'Wochenrückblick'
      })
      if (r?.error) { alert('Fehler: ' + r.error); return }
      reload()
    } finally { setEnqueueing(false) }
  }

  async function startCurator() {
    if (enqueueing) return
    setEnqueueing(true)
    try {
      const r = await window.lyra.jobsEnqueue({
        agent_type: 'vault_curator',
        params: {},
        title: 'Vault-Curator-Analyse'
      })
      if (r?.error) { alert('Fehler: ' + r.error); return }
      reload()
    } finally { setEnqueueing(false) }
  }

  async function submitResearch(e) {
    e?.preventDefault?.()
    const topic = researchInput.trim()
    if (!topic) return
    setEnqueueing(true)
    try {
      const r = await window.lyra.jobsEnqueue({
        agent_type: 'researcher',
        params: { topic, depth: researchDeep ? 'deep' : 'short' },
        title: `Recherche: ${topic}`,
        user_query: `brief mich zu ${topic}`
      })
      if (r?.error) { alert('Fehler: ' + r.error); return }
      setResearchInput('')
      setShowResearchForm(false)
      reload()
    } finally { setEnqueueing(false) }
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span className="settings-title">SUB-AGENT JOBS</span>
        <button className="close-btn" onClick={onClose}><Icon.X /></button>
      </div>
      <div className="settings-body">

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={() => { setShowResearchForm(s => !s); setShowEchoForm(false) }}>🔎 Recherche starten</button>
          <button className="btn-primary" onClick={startBriefing} disabled={enqueueing}>📋 Briefing jetzt</button>
          <button className="btn-primary" onClick={startWeekly} disabled={enqueueing}>📅 Wochenrückblick</button>
          <button className="btn-primary" onClick={startCurator} disabled={enqueueing}>🧹 Vault-Curator</button>
          <button className="btn-secondary" onClick={() => { setShowEchoForm(s => !s); setShowResearchForm(false) }}>+ Echo-Test</button>
          <button className="btn-secondary" onClick={cleanup}>Cleanup (&gt;24h)</button>
          <button className="btn-secondary" onClick={reload}>Refresh</button>
        </div>

        {agents.length > 0 && (
          <p className="hint" style={{ marginTop: 0 }}>
            Verfügbare Agents: <strong>{agents.map(a => a.name).join(', ')}</strong>
          </p>
        )}

        {showResearchForm && (
          <form onSubmit={submitResearch} style={{
            display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, padding: 12,
            background: 'rgba(212,175,55,0.08)', borderRadius: 6,
            border: '1px solid rgba(212,175,55,0.3)'
          }}>
            <input
              autoFocus
              type="text"
              value={researchInput}
              onChange={e => setResearchInput(e.target.value)}
              placeholder='Thema (z.B. „Anthropic", „Mistral AI Strategie 2026")'
              style={{
                background: 'rgba(0,0,0,0.3)', border: '1px solid #444',
                color: 'inherit', padding: '8px 10px', borderRadius: 4, fontSize: 'inherit'
              }}
            />
            <label style={{ fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: 6, opacity: 0.8 }}>
              <input type="checkbox" checked={researchDeep} onChange={e => setResearchDeep(e.target.checked)} />
              Tiefer recherchieren (advanced, 8 Treffer, 2 Credits statt 1)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn-primary" disabled={enqueueing || !researchInput.trim()}>Starten</button>
              <button type="button" className="btn-secondary" onClick={() => { setShowResearchForm(false); setResearchInput('') }}>Abbruch</button>
            </div>
            <p className="hint" style={{ margin: 0, fontSize: '0.8em' }}>
              Läuft 20-60s im Hintergrund. Briefing landet in <code>VINCI/Briefings/</code>.
            </p>
          </form>
        )}


        {showEchoForm && (
          <form onSubmit={submitEcho} style={{
            display: 'flex', gap: 8, marginBottom: 16, padding: 12,
            background: 'rgba(212,175,55,0.08)', borderRadius: 6,
            border: '1px solid rgba(212,175,55,0.3)'
          }}>
            <input
              autoFocus
              type="text"
              value={echoInput}
              onChange={e => setEchoInput(e.target.value)}
              placeholder="Echo-Text…"
              style={{
                flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid #444',
                color: 'inherit', padding: '6px 10px', borderRadius: 4, fontSize: 'inherit'
              }}
            />
            <button type="submit" className="btn-primary" disabled={enqueueing || !echoInput.trim()}>Senden</button>
            <button type="button" className="btn-secondary" onClick={() => { setShowEchoForm(false); setEchoInput('') }}>Abbruch</button>
          </form>
        )}

        {jobs.length === 0 && (
          <p className="hint">
            Noch keine Jobs gelaufen. Drück „+ Echo-Test" für einen Smoke-Test.
          </p>
        )}

        {jobs.map(j => (
          <div key={j.id} className="task-card" style={{ borderLeft: `3px solid ${STATUS_COLOR[j.status]}`, marginBottom: 8 }}>
            <div className="task-card-header">
              <div className="task-card-title">{j.title}</div>
              <div className="task-card-schedule" style={{ color: STATUS_COLOR[j.status] }}>
                {STATUS_LABEL[j.status]}
              </div>
            </div>
            <div className="task-card-meta">
              {j.agent_type} · {formatTime(j.created_at)} · Dauer {duration(j)}
            </div>
            {progressMap[j.id] && j.status === 'running' && (
              <div style={{ fontSize: '0.85em', opacity: 0.7, fontStyle: 'italic', marginTop: 4 }}>
                → {progressMap[j.id]}
              </div>
            )}
            {j.summary && j.status === 'done' && (
              <div className="task-card-prompt" style={{ marginTop: 4 }}>{j.summary}</div>
            )}
            {j.error && (
              <div style={{ fontSize: '0.85em', color: '#c74848', marginTop: 4 }}>⚠ {j.error}</div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {['pending', 'running'].includes(j.status) && (
                <button className="btn-secondary" onClick={() => cancel(j.id)}>Cancel</button>
              )}
              {(j.result || j.summary) && (
                <button className="btn-secondary" onClick={() => setSelected(j)}>Detail</button>
              )}
            </div>
          </div>
        ))}

        {selected && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20
          }} onClick={() => setSelected(null)}>
            <div onClick={e => e.stopPropagation()} style={{
              maxWidth: 700, width: '100%', maxHeight: '80vh', overflow: 'auto',
              background: '#1a1c1e', border: '1px solid #444', borderRadius: 8, padding: 20
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{selected.title}</h3>
                <button className="close-btn" onClick={() => setSelected(null)}><Icon.X /></button>
              </div>
              <p className="hint">{selected.agent_type} · {STATUS_LABEL[selected.status]} · Dauer {duration(selected)}</p>
              {selected.summary && (<><h4>Zusammenfassung</h4><p>{selected.summary}</p></>)}
              {selected.result != null && (
                <>
                  <h4>Ergebnis</h4>
                  <pre style={{
                    whiteSpace: 'pre-wrap', fontSize: '0.85em',
                    background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 6,
                    maxHeight: 400, overflow: 'auto'
                  }}>{typeof selected.result === 'string' ? selected.result : JSON.stringify(selected.result, null, 2)}</pre>
                </>
              )}
              {selected.user_query && (
                <>
                  <h4>Auslöser</h4>
                  <p style={{ fontStyle: 'italic', opacity: 0.7 }}>"{selected.user_query}"</p>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
