import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initJobQueue, getJob, _resetForTest as resetQ } from '../_jobQueue.js'
import { registerAgent, _resetForTest as resetAgents } from '../_subAgents.js'
import {
  enqueueAndRun, onJobEvent, cancelJobAndReschedule,
  _runningCount, _resetForTest as resetRunner
} from '../_jobRunner.js'

const DIR = join(tmpdir(), 'vinci-jobrunner-test')

function waitFor(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - t0 > timeoutMs) return reject(new Error('timeout'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  initJobQueue(DIR)
  resetQ()
  resetRunner()
  resetAgents()
})
afterEach(() => rmSync(DIR, { recursive: true, force: true }))

describe('JobRunner — basic flow', () => {
  it('runs an agent and updates status to done with result', async () => {
    registerAgent({
      name: 'sum',
      run: async (params) => ({ result: params.a + params.b, summary: 'summed' })
    })
    const j = enqueueAndRun('sum', { a: 2, b: 3 })
    expect(j.id).toMatch(/^job_/)
    await waitFor(() => getJob(j.id)?.status === 'done')
    const final = getJob(j.id)
    expect(final.result).toBe(5)
    expect(final.summary).toBe('summed')
    expect(final.started_at).toBeTruthy()
    expect(final.finished_at).toBeTruthy()
  })

  it('captures errors as failed status', async () => {
    registerAgent({
      name: 'boom',
      run: async () => { throw new Error('kaputt') }
    })
    const j = enqueueAndRun('boom', {})
    await waitFor(() => getJob(j.id)?.status === 'failed')
    expect(getJob(j.id).error).toMatch(/kaputt/)
  })

  it('throws on unknown agent', () => {
    expect(() => enqueueAndRun('nope', {})).toThrow(/Unbekannter/)
  })
})

describe('JobRunner — concurrency', () => {
  it('runs at most MAX_CONCURRENT (3) in parallel', async () => {
    let maxObserved = 0
    registerAgent({
      name: 'slow',
      run: async () => {
        maxObserved = Math.max(maxObserved, _runningCount())
        await new Promise(r => setTimeout(r, 30))
        return { result: 'ok' }
      }
    })
    const jobs = Array.from({ length: 6 }, () => enqueueAndRun('slow', {}))
    await waitFor(() => jobs.every(j => getJob(j.id)?.status === 'done'), 3000)
    expect(maxObserved).toBeLessThanOrEqual(3)
    expect(maxObserved).toBeGreaterThan(0)
  })
})

describe('JobRunner — events', () => {
  it('emits started + done events', async () => {
    registerAgent({
      name: 'evt',
      run: async () => ({ result: 'ok' })
    })
    const events = []
    onJobEvent(e => events.push(e.type))
    const j = enqueueAndRun('evt', {})
    await waitFor(() => getJob(j.id)?.status === 'done')
    expect(events).toContain('started')
    expect(events).toContain('done')
  })

  it('emits progress events from agent', async () => {
    registerAgent({
      name: 'prog',
      run: async (params, ctx) => {
        ctx.logProgress('halbzeit')
        return { result: 'ok' }
      }
    })
    const events = []
    onJobEvent(e => { if (e.type === 'progress') events.push(e.info) })
    const j = enqueueAndRun('prog', {})
    await waitFor(() => getJob(j.id)?.status === 'done')
    expect(events).toContain('halbzeit')
  })
})

describe('JobRunner — cancellation', () => {
  it('agent stops when ctx.shouldCancel() returns true', async () => {
    registerAgent({
      name: 'cancelable',
      run: async (params, ctx) => {
        for (let i = 0; i < 10; i++) {
          if (ctx.shouldCancel()) return { result: 'aborted', summary: 'cancelled-mid' }
          await new Promise(r => setTimeout(r, 20))
        }
        return { result: 'finished', summary: 'all-done' }
      }
    })
    const j = enqueueAndRun('cancelable', {})
    await new Promise(r => setTimeout(r, 30))  // give it time to start
    cancelJobAndReschedule(j.id)
    await waitFor(() => ['cancelled', 'done'].includes(getJob(j.id)?.status), 1500)
    // Status is 'cancelled' (set by cancelJobAndReschedule) — agent's late return is discarded
    expect(getJob(j.id).status).toBe('cancelled')
  })

  it('pending job that gets cancelled never starts running', async () => {
    let started = false
    registerAgent({
      name: 'blocker',
      run: async () => { await new Promise(r => setTimeout(r, 200)); return { result: 'x' } }
    })
    registerAgent({
      name: 'should-not-run',
      run: async () => { started = true; return { result: 'x' } }
    })
    // Saturate with 3 long-running jobs first
    for (let i = 0; i < 3; i++) enqueueAndRun('blocker', {})
    const skipme = enqueueAndRun('should-not-run', {})
    cancelJobAndReschedule(skipme.id)
    await new Promise(r => setTimeout(r, 350))
    expect(started).toBe(false)
    expect(getJob(skipme.id).status).toBe('cancelled')
  })
})
