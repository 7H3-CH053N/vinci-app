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
  researcher:    '🔎',
  briefing:      '📋',
  weekly:        '📅',
  vault_curator: '🧹',
  echo:          '◈'
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
  const [selectedActions, setSelectedActions] = useState(null)  // null = initial, dann Set<id>
  const [applyResult, setApplyResult] = useState(null)
  const [applying, setApplying] = useState(false)

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
        <CuratorOrPlainResult
          job={job}
          jobId={jobId}
          selectedActions={selectedActions}
          setSelectedActions={setSelectedActions}
          applying={applying}
          setApplying={setApplying}
          applyResult={applyResult}
          setApplyResult={setApplyResult}
        />
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

// ── Result-Renderer ─────────────────────────────────────────────────────────
// Bei Curator-Jobs zeigt eine Checkbox-Liste der Action-Vorschläge + Apply-Button.
// Bei allen anderen Job-Typen: Plain-Result-Anzeige.

const ACTION_KIND_LABEL = {
  trash: '🗑 Trash',
  create_stub: '+ Anlegen',
  merge: '⇄ Merge'
}
const ACTION_KIND_COLOR = {
  trash: '#c74848',
  create_stub: '#3da766',
  merge: '#D4AF37'
}

function CuratorOrPlainResult({ job, jobId, selectedActions, setSelectedActions, applying, setApplying, applyResult, setApplyResult }) {
  const result = job.result
  const isCurator = result && typeof result === 'object' && Array.isArray(result.actions)

  // Init selectedActions aus preselected, falls noch nicht gesetzt
  useEffect(() => {
    if (isCurator && selectedActions === null) {
      const pre = new Set(result.actions.filter(a => a.preselected).map(a => a.id))
      setSelectedActions(pre)
    }
  }, [isCurator, result, selectedActions, setSelectedActions])

  if (!isCurator) {
    return (
      <pre className="jobcard-result">
        {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
      </pre>
    )
  }

  function toggle(id) {
    const next = new Set(selectedActions || [])
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedActions(next)
  }
  function selectAll() {
    setSelectedActions(new Set(result.actions.map(a => a.id)))
  }
  function selectNone() { setSelectedActions(new Set()) }

  async function applyActions() {
    if (!selectedActions || selectedActions.size === 0) return
    if (!confirm(`${selectedActions.size} Aktionen anwenden? (mit Backup-ZIP unter ~/.vinci-archive/)`)) return
    setApplying(true)
    try {
      const r = await window.lyra.curatorApply({
        jobId,
        selectedIds: [...selectedActions]
      })
      setApplyResult(r)
    } finally { setApplying(false) }
  }

  const actions = result.actions
  const byKind = {
    trash: actions.filter(a => a.kind === 'trash'),
    create_stub: actions.filter(a => a.kind === 'create_stub'),
    merge: actions.filter(a => a.kind === 'merge')
  }
  const sel = selectedActions || new Set()

  return (
    <div className="jobcard-curator">
      {result.markdown && (
        <pre className="jobcard-result" style={{ maxHeight: 200 }}>{result.markdown}</pre>
      )}

      <div className="jobcard-curator-actions">
        <div className="jobcard-curator-head">
          <strong>{actions.length} Aktionen vorgeschlagen</strong>
          <span style={{ marginLeft: 8, opacity: 0.7 }}>
            ({sel.size} ausgewählt)
            {' · '}
            <a href="#" onClick={e => { e.preventDefault(); selectAll() }}>alle</a>
            {' / '}
            <a href="#" onClick={e => { e.preventDefault(); selectNone() }}>keine</a>
          </span>
        </div>

        {['trash', 'create_stub', 'merge'].map(kind => {
          const arr = byKind[kind]
          if (arr.length === 0) return null
          return (
            <div key={kind} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: ACTION_KIND_COLOR[kind], marginBottom: 4 }}>
                {ACTION_KIND_LABEL[kind]} · {arr.length}
              </div>
              {arr.map(a => (
                <label key={a.id} style={{
                  display: 'flex', gap: 6, alignItems: 'flex-start',
                  padding: '3px 6px', cursor: 'pointer', fontSize: 11
                }}>
                  <input
                    type="checkbox"
                    checked={sel.has(a.id)}
                    onChange={() => toggle(a.id)}
                    disabled={applying || !!applyResult}
                  />
                  <span style={{ flex: 1 }}>{a.description}</span>
                </label>
              ))}
            </div>
          )
        })}

        {!applyResult && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button
              className="jobcard-btn"
              onClick={applyActions}
              disabled={applying || sel.size === 0}
              style={{
                background: sel.size > 0 ? 'rgba(212,175,55,0.15)' : 'transparent',
                borderColor: sel.size > 0 ? '#D4AF37' : 'var(--border)',
                color: sel.size > 0 ? '#D4AF37' : 'var(--text-muted)'
              }}
            >
              {applying ? 'wird angewendet…' : `▶ ${sel.size} Aktion${sel.size === 1 ? '' : 'en'} anwenden`}
            </button>
          </div>
        )}

        {applyResult && (
          <div style={{ marginTop: 10, padding: 8, background: 'rgba(61,167,102,0.1)', borderRadius: 4, fontSize: 11 }}>
            {applyResult.error
              ? <span style={{ color: '#c74848' }}>⚠ {applyResult.error}</span>
              : <>
                  ✓ <strong>{applyResult.applied}</strong> Aktionen angewendet
                  {applyResult.failed > 0 && `, ${applyResult.failed} fehlgeschlagen`}
                  {applyResult.backupPath && <div style={{ opacity: 0.6, marginTop: 4 }}>Backup: {applyResult.backupPath.split('/').pop()}</div>}
                </>}
          </div>
        )}
      </div>
    </div>
  )
}
