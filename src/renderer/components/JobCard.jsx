// Inline-Job-Card im Chat-Verlauf.
//
// Wird vom MessageBubble gerendert, wenn die Nachricht eine jobId hat.
// Verbindet sich via lyra:job:event mit dem Backend und zeigt:
//   - pending: "wartet" + Spinner
//   - running: Progress-Text + Cancel-Button
//   - done:    Erweiterungs-Button → Resultat ausklappen
//   - failed:  Fehlertext
//   - cancelled: knapp "abgebrochen"

import { useState, useEffect } from 'react'

const STATUS_COLOR = {
  pending:   '#888',
  running:   '#D4AF37',
  done:      '#3da766',
  failed:    '#c74848',
  cancelled: '#666'
}

const STATUS_LABEL = {
  pending:   'wartet',
  running:   'läuft',
  done:      'fertig',
  failed:    'Fehler',
  cancelled: 'abgebrochen'
}

const AGENT_EMOJI = {
  researcher: '🔎',
  briefing:   '📋',
  echo:       '◈'
}

function duration(job) {
  if (!job?.started_at) return null
  const end = new Date(job.finished_at || Date.now()).getTime()
  const start = new Date(job.started_at).getTime()
  const sec = Math.round((end - start) / 1000)
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
}

export default function JobCard({ jobId, agentType, initialText }) {
  const [job, setJob] = useState(null)
  const [progress, setProgress] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now())

  // Initial-Fetch + Live-Updates
  useEffect(() => {
    let mounted = true
    async function refresh() {
      const r = await window.lyra.jobsGet(jobId)
      if (mounted && r?.job) setJob(r.job)
    }
    refresh()

    const off = window.lyra.on('lyra:job:event', ({ type, job: ev, info }) => {
      if (ev?.id !== jobId) return
      setJob(ev)
      if (type === 'progress' && info) setProgress(String(info))
      if (type === 'done') setExpanded(true)
    })
    return () => { mounted = false; off?.() }
  }, [jobId])

  // Live-Timer während running, damit Dauer-Anzeige tickt
  useEffect(() => {
    if (job?.status !== 'running' && job?.status !== 'pending') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [job?.status])

  async function cancel() {
    await window.lyra.jobsCancel(jobId)
  }

  if (!job) {
    // noch nicht geladen — zeig wenigstens den initialText vom Backend
    return (
      <div className="jobcard jobcard-pending">
        <span className="jobcard-icon">⋯</span>
        <span className="jobcard-text">{initialText || 'Job wird vorbereitet…'}</span>
      </div>
    )
  }

  const color = STATUS_COLOR[job.status] || '#888'
  const label = STATUS_LABEL[job.status] || job.status
  const icon = AGENT_EMOJI[agentType || job.agent_type] || '◈'
  const dur = duration(job)
  const live = job.status === 'running' && job.started_at
    ? Math.round((now - new Date(job.started_at).getTime()) / 1000) + 's'
    : null

  return (
    <div className="jobcard" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="jobcard-head">
        <span className="jobcard-icon">{icon}</span>
        <span className="jobcard-title">{job.title}</span>
        <span className="jobcard-status" style={{ color }}>
          {label}{live ? ` · ${live}` : dur ? ` · ${dur}` : ''}
        </span>
      </div>

      {progress && job.status === 'running' && (
        <div className="jobcard-progress">→ {progress}</div>
      )}

      {job.status === 'running' && (
        <div className="jobcard-bar">
          <div className="jobcard-bar-fill" style={{ background: color }} />
        </div>
      )}

      {job.error && (
        <div className="jobcard-error">⚠ {job.error}</div>
      )}

      {job.status === 'done' && job.summary && !expanded && (
        <div className="jobcard-summary">{job.summary}</div>
      )}

      {expanded && job.result && (
        <pre className="jobcard-result">
          {typeof job.result === 'string' ? job.result : JSON.stringify(job.result, null, 2)}
        </pre>
      )}

      <div className="jobcard-actions">
        {(job.status === 'pending' || job.status === 'running') && (
          <button className="jobcard-btn" onClick={cancel}>Abbrechen</button>
        )}
        {job.status === 'done' && job.result && (
          <button className="jobcard-btn" onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Zusammenklappen' : 'Volltext anzeigen'}
          </button>
        )}
      </div>
    </div>
  )
}
