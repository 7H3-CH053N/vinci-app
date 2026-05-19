// Job-Runner — Phase J6.
//
// Verbindet Job-Queue mit Sub-Agent-Registry:
//   1. enqueueAndRun(agentName, params) → erstellt Job, startet ihn async, returnt Job
//   2. Runner managed Concurrency (max 3 parallel)
//   3. Bei done/failed feuert er einen Event, damit UI/Chat reagieren können
//
// Concurrency: pending-Jobs werden in FIFO-Reihenfolge gestartet, sobald Slots frei sind.
//
// Cancellation: setzt Status auf 'cancelled' — Agent prüft selbst via ctx.shouldCancel(),
// echtes Killen von laufenden Gemini-Calls geht nicht (kein AbortController-Support
// im @google/generative-ai SDK).

import { createJob, getJob, updateJob, listJobs } from './_jobQueue.js'
import { getAgent } from './_subAgents.js'

const MAX_CONCURRENT = 3

const listeners = new Set()
const running = new Set()  // Set<jobId>

/**
 * Event-Listener registrieren. Wird bei jedem Status-Wechsel gerufen.
 * @param {(event: { type: 'started'|'progress'|'done'|'failed'|'cancelled', job, info? }) => void} fn
 * @returns Unsubscribe-Funktion
 */
export function onJobEvent(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(type, job, info = null) {
  for (const fn of listeners) {
    try { fn({ type, job, info }) }
    catch (err) { console.error('[JobRunner] listener failed:', err.message) }
  }
}

/**
 * Erzeugt einen Job + startet ihn (sofort oder sobald Slot frei).
 * @param {string} agentName
 * @param {object} params — Agent-spezifisch
 * @param {object} [opts] — { title, user_query, ctx }
 * @returns {object} der angelegte Job (kann initial 'pending' sein, läuft im Hintergrund weiter)
 */
export function enqueueAndRun(agentName, params = {}, opts = {}) {
  const agent = getAgent(agentName)
  if (!agent) throw new Error(`Unbekannter Sub-Agent: ${agentName}`)
  const title = opts.title || agent.default_title(params)
  const job = createJob({
    agent_type: agentName,
    title,
    params,
    user_query: opts.user_query || null
  })
  // Fire-and-forget; Promise nicht awaiten
  scheduleNext(opts.ctx || {})
  return job
}

function scheduleNext(ctx) {
  if (running.size >= MAX_CONCURRENT) return
  const pending = listJobs({ status: 'pending' }).reverse()  // FIFO: oldest first
  for (const j of pending) {
    if (running.size >= MAX_CONCURRENT) break
    if (running.has(j.id)) continue
    running.add(j.id)
    runJob(j.id, ctx).finally(() => {
      running.delete(j.id)
      scheduleNext(ctx)
    })
  }
}

async function runJob(jobId, ctx) {
  let job = getJob(jobId)
  if (!job) return
  if (job.status === 'cancelled') {
    emit('cancelled', job)
    return
  }
  const agent = getAgent(job.agent_type)
  if (!agent) {
    job = updateJob(jobId, { status: 'failed', error: `Unbekannter Agent: ${job.agent_type}` })
    emit('failed', job)
    return
  }
  job = updateJob(jobId, { status: 'running' })
  emit('started', job)

  const agentCtx = {
    settings: ctx.settings || {},
    registry: ctx.registry || null,
    shouldCancel: () => getJob(jobId)?.status === 'cancelled',
    logProgress: (info) => {
      const cur = getJob(jobId)
      if (cur) emit('progress', cur, info)
    }
  }

  try {
    const out = await agent.run(job.params || {}, agentCtx)
    // Check für späte Cancellation (Agent merkt's nicht immer)
    if (getJob(jobId)?.status === 'cancelled') {
      emit('cancelled', getJob(jobId))
      return
    }
    job = updateJob(jobId, {
      status: 'done',
      result: out?.result ?? null,
      summary: out?.summary ?? null
    })
    emit('done', job, { vaultNote: out?.vaultNote || null })
  } catch (err) {
    job = updateJob(jobId, {
      status: 'failed',
      error: String(err?.message || err).slice(0, 500)
    })
    emit('failed', job)
  }
}

/** Sanftes Cancel + Trigger Reschedule (anderer Job kann nachrücken). */
export function cancelJobAndReschedule(jobId, ctx = {}) {
  const job = getJob(jobId)
  if (!job) return null
  if (['done', 'failed', 'cancelled'].includes(job.status)) return job
  const updated = updateJob(jobId, { status: 'cancelled' })
  emit('cancelled', updated)
  // Falls noch nicht gestartet, gibt's keinen Runner zu unterbrechen.
  // Falls running, läuft der Agent noch weiter, prüft aber shouldCancel().
  scheduleNext(ctx)
  return updated
}

/** Manuell schedule anstoßen — z.B. nach App-Start für recoverte pending-Jobs. */
export function kickScheduler(ctx = {}) {
  scheduleNext(ctx)
}

export function _runningCount() { return running.size }
export function _resetForTest() { running.clear(); listeners.clear() }
