import { useEffect, useState } from 'react'
import Icon from './Icons.jsx'

const WD_LABEL = ['So','Mo','Di','Mi','Do','Fr','Sa']

function emptyTask() {
  return {
    name: '',
    prompt: '',
    enabled: true,
    schedule: { mode: 'daily', time: '09:00', weekdays: [1,2,3,4,5], hours: 2 }
  }
}

function describeSchedule(s) {
  if (!s) return ''
  switch (s.mode) {
    case 'daily':    return `Täglich ${s.time}`
    case 'weekdays': return `Mo–Fr ${s.time}`
    case 'weekly':   return `${(s.weekdays || []).map(d => WD_LABEL[d]).join(', ')} ${s.time}`
    case 'hourly':   return `Alle ${s.hours} Stunden`
    default:         return s.mode
  }
}

function formatTime(iso) {
  if (!iso) return '–'
  const d = new Date(iso)
  return d.toLocaleString('de-AT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
}

export default function Tasks({ onClose, inline = false }) {
  const [tasks, setTasks] = useState([])
  const [editing, setEditing] = useState(null)   // null | task object | 'new'
  const [results, setResults] = useState({})     // taskId → results[]
  const [resultsFor, setResultsFor] = useState(null)
  const [running, setRunning] = useState({})

  async function reload() {
    const list = await window.lyra.tasksList()
    setTasks(list || [])
  }

  useEffect(() => { reload() }, [])

  // Live-Update bei neuen Task-Resultaten
  useEffect(() => {
    const off = window.lyra.on('lyra:taskResult', () => reload())
    const off2 = window.lyra.on('lyra:openTaskResult', (taskId) => {
      openResults(taskId)
    })
    return () => { off?.(); off2?.() }
  }, [])

  async function openResults(id) {
    const r = await window.lyra.tasksResults(id)
    setResults(prev => ({ ...prev, [id]: r || [] }))
    setResultsFor(id)
  }

  async function runNow(id) {
    setRunning(p => ({ ...p, [id]: true }))
    try {
      await window.lyra.tasksRun(id)
      await reload()
    } finally {
      setRunning(p => ({ ...p, [id]: false }))
    }
  }

  async function toggleEnabled(t) {
    await window.lyra.tasksUpdate(t.id, { enabled: !t.enabled })
    reload()
  }

  async function remove(id) {
    if (!confirm('Diese Aufgabe wirklich löschen?')) return
    await window.lyra.tasksDelete(id)
    reload()
  }

  async function save(payload) {
    if (editing === 'new') {
      await window.lyra.tasksCreate(payload)
    } else {
      await window.lyra.tasksUpdate(editing.id, payload)
    }
    setEditing(null)
    reload()
  }

  // ── Edit-Form ──
  if (editing) {
    return <TaskEditor
      initial={editing === 'new' ? emptyTask() : editing}
      onSave={save}
      onCancel={() => setEditing(null)}
      inline={inline}
    />
  }

  // ── Results-View ──
  if (resultsFor) {
    const task = tasks.find(t => t.id === resultsFor)
    const list = results[resultsFor] || []
    const resultsBody = (
      <>
        {!inline && (
          <button className="btn-ghost" style={{ marginBottom: 12 }} onClick={() => setResultsFor(null)}>← Zurück</button>
        )}
        {inline && (
          <button className="btn-ghost" style={{ marginBottom: 12 }} onClick={() => setResultsFor(null)}>← Zurück zur Liste</button>
        )}
        {list.length === 0 && <p className="hint">Noch keine Ergebnisse.</p>}
        {list.map((r, i) => (
          <div key={i} className="task-result-card">
            <div className="task-result-meta">{formatTime(r.finishedAt)} {r.manual ? '(manuell)' : '(geplant)'}</div>
            {r.error
              ? <div className="task-result-error">Fehler: {r.error}</div>
              : <div className="task-result-text">{r.text}</div>}
          </div>
        ))}
      </>
    )
    if (inline) return resultsBody
    return (
      <div className="settings-panel">
        <div className="settings-header">
          <span className="settings-title">{task?.name || 'Ergebnisse'}</span>
          <button className="close-btn" onClick={() => setResultsFor(null)}><Icon.X /></button>
        </div>
        <div className="settings-body">{resultsBody}</div>
      </div>
    )
  }

  // ── List ──
  const listBody = (
    <>
      <button className="btn-primary" style={{ marginBottom: 12 }} onClick={() => setEditing('new')}>
        + Neue Aufgabe
      </button>

      {tasks.length === 0 && (
        <p className="hint">Noch keine Aufgaben. Klick „+ Neue Aufgabe" und sag VINCI z. B. „Sag mir das morgige Wetter" – täglich um 06:30.</p>
      )}

      {tasks.map(t => (
        <div key={t.id} className="task-card" style={{ opacity: t.enabled ? 1 : 0.5 }}>
          <div className="task-card-header">
            <div className="task-card-title">{t.name}</div>
            <div className="task-card-schedule">{describeSchedule(t.schedule)}</div>
          </div>
          <div className="task-card-prompt">{t.prompt}</div>
          <div className="task-card-meta">
            {t.lastRunAt
              ? <>Zuletzt: {formatTime(t.lastRunAt)}{t.lastError ? ' ⚠' : ''}</>
              : 'Noch nie ausgeführt'}
          </div>
          <div className="task-card-actions">
            <button className="btn-secondary" onClick={() => runNow(t.id)} disabled={!!running[t.id]}>
              {running[t.id] ? '...' : '▶ Jetzt'}
            </button>
            <button className="btn-secondary" onClick={() => openResults(t.id)}>Verlauf</button>
            <button className="btn-secondary" onClick={() => setEditing(t)}>Bearbeiten</button>
            <button className="btn-secondary" onClick={() => toggleEnabled(t)}>
              {t.enabled ? '⏸ Pause' : '▶ Aktiv'}
            </button>
            <button className="btn-ghost" onClick={() => remove(t.id)}>Löschen</button>
          </div>
        </div>
      ))}
    </>
  )

  if (inline) return listBody

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span className="settings-title">AUFGABEN</span>
        <button className="close-btn" onClick={onClose}><Icon.X /></button>
      </div>
      <div className="settings-body">{listBody}</div>
    </div>
  )
}

// ── Editor-Komponente ──
function TaskEditor({ initial, onSave, onCancel, inline = false }) {
  const [t, setT] = useState(JSON.parse(JSON.stringify(initial)))

  function up(path, val) {
    setT(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      const parts = path.split('.')
      let c = next
      for (let i = 0; i < parts.length - 1; i++) {
        c[parts[i]] = c[parts[i]] || {}
        c = c[parts[i]]
      }
      c[parts[parts.length - 1]] = val
      return next
    })
  }

  function toggleWeekday(d) {
    const cur = t.schedule.weekdays || []
    const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d].sort()
    up('schedule.weekdays', next)
  }

  function canSave() {
    return t.name.trim().length > 0 && t.prompt.trim().length > 0
  }

  const editorBody = (
    <>
      {inline && (
        <button className="btn-ghost" style={{ marginBottom: 12 }} onClick={onCancel}>← Zurück zur Aufgaben-Liste</button>
      )}
        <div className="field">
          <label>Name</label>
          <input className="inp" value={t.name}
            onChange={e => up('name', e.target.value)}
            placeholder="z. B. Wettercheck morgens" />
        </div>

        <div className="field">
          <label>Prompt für VINCI</label>
          <textarea className="inp" rows={3}
            value={t.prompt}
            onChange={e => up('prompt', e.target.value)}
            placeholder="z. B. Sag mir das morgige Wetter und meine Termine für morgen." />
          <p className="hint">VINCI hat alle Tools (Wetter, Termine, Mails, Erinnerungen, Strom, Obsidian …). Halte den Prompt kurz und klar.</p>
        </div>

        <div className="field">
          <label>Zeitplan</label>
          <div className="radio-group">
            {[
              ['daily',    'Täglich'],
              ['weekdays', 'Mo–Fr (Werktags)'],
              ['weekly',   'Bestimmte Wochentage'],
              ['hourly',   'Alle N Stunden']
            ].map(([val, label]) => (
              <label key={val} className="radio-label">
                <input type="radio" name="mode" value={val}
                  checked={t.schedule.mode === val}
                  onChange={() => up('schedule.mode', val)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        {t.schedule.mode === 'weekly' && (
          <div className="field">
            <label>Wochentage</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {WD_LABEL.map((label, d) => {
                const active = (t.schedule.weekdays || []).includes(d)
                return (
                  <button key={d} type="button"
                    onClick={() => toggleWeekday(d)}
                    className={active ? 'btn-primary' : 'btn-secondary'}
                    style={{ minWidth: 44 }}>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {t.schedule.mode !== 'hourly' && (
          <div className="field">
            <label>Uhrzeit</label>
            <input type="time" className="inp time-inp"
              value={t.schedule.time}
              onChange={e => up('schedule.time', e.target.value)} />
          </div>
        )}

        {t.schedule.mode === 'hourly' && (
          <div className="field">
            <label>Alle wieviel Stunden? ({t.schedule.hours} Std.)</label>
            <input type="range" min="1" max="24" step="1" className="range"
              value={t.schedule.hours}
              onChange={e => up('schedule.hours', parseInt(e.target.value))} />
            <p className="hint">Läuft jeweils zur vollen Stunde.</p>
          </div>
        )}

        <div className="field row">
          <label>Aktiv</label>
          <input type="checkbox" checked={t.enabled}
            onChange={e => up('enabled', e.target.checked)} />
        </div>

        <div className="settings-actions" style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn-primary" onClick={() => onSave(t)} disabled={!canSave()}>Speichern</button>
          <button className="btn-ghost" onClick={onCancel}>Abbrechen</button>
        </div>
    </>
  )

  if (inline) return editorBody

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span className="settings-title">{initial.id ? 'AUFGABE BEARBEITEN' : 'NEUE AUFGABE'}</span>
        <button className="close-btn" onClick={onCancel}><Icon.X /></button>
      </div>
      <div className="settings-body">{editorBody}</div>
    </div>
  )
}
