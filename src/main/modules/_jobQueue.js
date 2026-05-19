// Job-Queue für Sub-Agents (Phase J6).
//
// Persistiert Jobs als JSON unter ~/Library/Application Support/vinci/vinci-jobs.json.
// Bewusst kein SQLite — kleine Job-Counts (zig-hundert max), atomic write+rename ist genug.
//
// Lifecycle eines Jobs:
//   pending → running → done | failed | cancelled
//
// Cleanup: done/failed/cancelled-Jobs älter als 24h werden weggeräumt.

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { localISOString } from './_localTime.js'

const JOBS_FILE_NAME = 'vinci-jobs.json'
const MAX_AGE_MS = 24 * 60 * 60 * 1000   // 24h
const MAX_JOBS_KEPT = 200                 // Hard-cap, falls Cleanup mal ausfällt

// In-Memory-State für schnellen Read; File ist Source-of-Truth für Persistenz.
let jobs = []
let initialized = false
let userDataDir = null

function jobsPath() {
  return join(userDataDir, JOBS_FILE_NAME)
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, filePath)
}

function persist() {
  try {
    atomicWrite(jobsPath(), JSON.stringify(jobs, null, 2))
  } catch (err) {
    console.error('[JobQueue] persist failed:', err.message)
  }
}

/**
 * Init muss vor allen anderen Calls erfolgen.
 * In Tests kann `dir` direkt übergeben werden, sonst app.getPath('userData').
 */
export function initJobQueue(dirOverride = null) {
  try {
    userDataDir = dirOverride || (app ? app.getPath('userData') : null)
    if (!userDataDir) throw new Error('userData path nicht verfügbar')
    if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true })
    const p = jobsPath()
    if (existsSync(p)) {
      try {
        jobs = JSON.parse(readFileSync(p, 'utf8'))
        if (!Array.isArray(jobs)) jobs = []
      } catch {
        jobs = []
      }
    } else {
      jobs = []
      persist()
    }
    // Stuck-Recovery: jobs die als 'running' markiert sind (App-Crash) → failed
    let recovered = 0
    for (const j of jobs) {
      if (j.status === 'running') {
        j.status = 'failed'
        j.error = 'recovered after restart (was stuck in running)'
        j.finished_at = localISOString()
        recovered++
      }
    }
    if (recovered > 0) persist()
    initialized = true
    return { ok: true, recovered, total: jobs.length }
  } catch (err) {
    console.error('[JobQueue] init failed:', err.message)
    return { ok: false, error: err.message }
  }
}

function ensureInit() {
  if (!initialized) throw new Error('JobQueue nicht initialisiert — initJobQueue() zuerst aufrufen')
}

function newId() {
  return 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

/**
 * Neuen Job anlegen. Status startet als 'pending'.
 * @param {object} opts
 * @param {string} opts.agent_type — Agent-Name (z.B. 'researcher')
 * @param {object} opts.params     — Agent-spezifische Parameter
 * @param {string} opts.title      — User-facing Anzeige in der Job-Liste
 * @param {string} [opts.user_query] — Original User-Query die den Job ausgelöst hat
 * @returns {object} der angelegte Job
 */
export function createJob({ agent_type, params = {}, title, user_query = null }) {
  ensureInit()
  if (!agent_type) throw new Error('agent_type fehlt')
  if (!title) throw new Error('title fehlt')
  const job = {
    id: newId(),
    agent_type,
    title: String(title).slice(0, 120),
    params,
    user_query: user_query ? String(user_query).slice(0, 500) : null,
    status: 'pending',
    created_at: localISOString(),
    started_at: null,
    finished_at: null,
    result: null,      // String oder Object — je nach Agent
    summary: null,     // kurze Einzeiler-Zusammenfassung für Notification/Chat-Inject
    error: null
  }
  jobs.push(job)
  persist()
  return job
}

export function getJob(id) {
  ensureInit()
  return jobs.find(j => j.id === id) || null
}

/**
 * Listet Jobs. Standardmäßig alle, sortiert nach created_at desc.
 * @param {object} [opts]
 * @param {string|string[]} [opts.status] — filter
 * @param {string} [opts.agent_type]
 * @param {number} [opts.limit]
 */
export function listJobs(opts = {}) {
  ensureInit()
  let out = [...jobs]
  if (opts.status) {
    const allowed = Array.isArray(opts.status) ? opts.status : [opts.status]
    out = out.filter(j => allowed.includes(j.status))
  }
  if (opts.agent_type) {
    out = out.filter(j => j.agent_type === opts.agent_type)
  }
  out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  if (opts.limit) out = out.slice(0, opts.limit)
  return out
}

/**
 * Patcht ein Job. Erlaubte Felder: status, started_at, finished_at, result, summary, error.
 * Status-Transitionen werden minimal validiert.
 */
export function updateJob(id, patch) {
  ensureInit()
  const job = getJob(id)
  if (!job) return null
  const ALLOWED = ['status', 'started_at', 'finished_at', 'result', 'summary', 'error']
  for (const k of ALLOWED) {
    if (k in patch) job[k] = patch[k]
  }
  // Auto-Stempel
  if (patch.status === 'running' && !job.started_at) {
    job.started_at = localISOString()
  }
  if (['done', 'failed', 'cancelled'].includes(patch.status) && !job.finished_at) {
    job.finished_at = localISOString()
  }
  persist()
  return job
}

/**
 * Cancelt einen Job. Pending → cancelled, running → cancelled (Runner muss selbst noch
 * stoppen, das ist eine Soft-Cancellation). Done/failed/cancelled → no-op.
 */
export function cancelJob(id) {
  const job = getJob(id)
  if (!job) return null
  if (['done', 'failed', 'cancelled'].includes(job.status)) return job
  return updateJob(id, { status: 'cancelled' })
}

/**
 * Räumt Jobs auf:
 *  - alle done/failed/cancelled älter als maxAgeMs (default 24h)
 *  - hard-cap: behält max. MAX_JOBS_KEPT jüngste
 */
export function cleanupJobs(maxAgeMs = MAX_AGE_MS) {
  ensureInit()
  const cutoff = Date.now() - maxAgeMs
  const before = jobs.length
  jobs = jobs.filter(j => {
    if (j.status === 'pending' || j.status === 'running') return true
    const finished = new Date(j.finished_at || j.created_at).getTime()
    return finished > cutoff
  })
  // Hard-cap
  if (jobs.length > MAX_JOBS_KEPT) {
    jobs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    jobs = jobs.slice(0, MAX_JOBS_KEPT)
  }
  const removed = before - jobs.length
  if (removed > 0) persist()
  return { removed, remaining: jobs.length }
}

/** Reine Test-/Tool-Funktion: alle Jobs löschen */
export function _resetForTest() {
  jobs = []
  if (initialized) persist()
}

export const _internal = { jobsPath: () => jobsPath() }
