import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initJobQueue, createJob, getJob, listJobs, updateJob, cancelJob,
  cleanupJobs, _resetForTest, _internal
} from '../_jobQueue.js'

const DIR = join(tmpdir(), 'vinci-jobqueue-test')

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  initJobQueue(DIR)
  _resetForTest()
})
afterEach(() => rmSync(DIR, { recursive: true, force: true }))

describe('JobQueue — basic CRUD', () => {
  it('createJob assigns id + pending status + created_at', () => {
    const j = createJob({ agent_type: 'researcher', title: 'Test', params: { topic: 'X' } })
    expect(j.id).toMatch(/^job_/)
    expect(j.status).toBe('pending')
    expect(j.created_at).toBeTruthy()
    expect(j.agent_type).toBe('researcher')
    expect(j.params).toEqual({ topic: 'X' })
  })

  it('getJob returns the job by id, null for unknown', () => {
    const j = createJob({ agent_type: 'x', title: 'A' })
    expect(getJob(j.id)).toEqual(j)
    expect(getJob('nope')).toBeNull()
  })

  it('throws when title or agent_type missing', () => {
    expect(() => createJob({ agent_type: 'x' })).toThrow()
    expect(() => createJob({ title: 'x' })).toThrow()
  })
})

describe('JobQueue — status transitions + auto-timestamps', () => {
  it('sets started_at when status → running', () => {
    const j = createJob({ agent_type: 'x', title: 'A' })
    expect(j.started_at).toBeNull()
    const r = updateJob(j.id, { status: 'running' })
    expect(r.started_at).toBeTruthy()
  })

  it('sets finished_at when status → done/failed/cancelled', () => {
    for (const status of ['done', 'failed', 'cancelled']) {
      const j = createJob({ agent_type: 'x', title: 'A' })
      const r = updateJob(j.id, { status })
      expect(r.finished_at).toBeTruthy()
    }
  })

  it('cancelJob sets cancelled status', () => {
    const j = createJob({ agent_type: 'x', title: 'A' })
    const c = cancelJob(j.id)
    expect(c.status).toBe('cancelled')
  })

  it('cancelJob is no-op for done/failed jobs', () => {
    const j = createJob({ agent_type: 'x', title: 'A' })
    updateJob(j.id, { status: 'done' })
    const c = cancelJob(j.id)
    expect(c.status).toBe('done')
  })
})

describe('JobQueue — listJobs filtering', () => {
  it('filters by single status', () => {
    const a = createJob({ agent_type: 'r', title: 'A' })
    const b = createJob({ agent_type: 'r', title: 'B' })
    updateJob(b.id, { status: 'done' })
    expect(listJobs({ status: 'pending' }).map(j => j.id)).toEqual([a.id])
    expect(listJobs({ status: 'done' }).map(j => j.id)).toEqual([b.id])
  })

  it('filters by array of statuses', () => {
    const a = createJob({ agent_type: 'r', title: 'A' })
    const b = createJob({ agent_type: 'r', title: 'B' })
    const c = createJob({ agent_type: 'r', title: 'C' })
    updateJob(b.id, { status: 'done' })
    updateJob(c.id, { status: 'failed' })
    expect(listJobs({ status: ['done', 'failed'] }).map(j => j.id).sort()).toEqual([b.id, c.id].sort())
  })

  it('filters by agent_type', () => {
    createJob({ agent_type: 'r', title: 'A' })
    const b = createJob({ agent_type: 'briefing', title: 'B' })
    expect(listJobs({ agent_type: 'briefing' }).map(j => j.id)).toEqual([b.id])
  })

  it('sorts by created_at desc (newest first)', async () => {
    const a = createJob({ agent_type: 'r', title: 'A' })
    await new Promise(r => setTimeout(r, 5))
    const b = createJob({ agent_type: 'r', title: 'B' })
    expect(listJobs().map(j => j.id)).toEqual([b.id, a.id])
  })

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) createJob({ agent_type: 'r', title: 'J' + i })
    expect(listJobs({ limit: 2 }).length).toBe(2)
  })
})

describe('JobQueue — persistence', () => {
  it('writes to disk + reads back after re-init', () => {
    const j = createJob({ agent_type: 'r', title: 'persist-test' })
    updateJob(j.id, { status: 'done', result: 'OK' })
    // Re-init simuliert App-Restart
    initJobQueue(DIR)
    const reread = getJob(j.id)
    expect(reread.title).toBe('persist-test')
    expect(reread.status).toBe('done')
    expect(reread.result).toBe('OK')
  })

  it('recovers stuck-running jobs on init → failed', () => {
    const j = createJob({ agent_type: 'r', title: 'crash-test' })
    updateJob(j.id, { status: 'running' })
    // Simuliere Crash: re-init ohne sauberen Shutdown
    const r = initJobQueue(DIR)
    expect(r.recovered).toBe(1)
    expect(getJob(j.id).status).toBe('failed')
    expect(getJob(j.id).error).toMatch(/recovered/)
  })

  it('handles corrupt jobs.json gracefully', () => {
    writeFileSync(_internal.jobsPath(), '{ not valid json', 'utf8')
    const r = initJobQueue(DIR)
    expect(r.ok).toBe(true)
    expect(listJobs().length).toBe(0)
  })
})

describe('JobQueue — cleanup', () => {
  it('removes done/failed/cancelled jobs older than maxAge', () => {
    const a = createJob({ agent_type: 'r', title: 'old-done' })
    const b = createJob({ agent_type: 'r', title: 'new-done' })
    const c = createJob({ agent_type: 'r', title: 'still-pending' })
    // a: alt + done; b: neu + done; c: pending bleibt immer
    updateJob(a.id, { status: 'done' })
    updateJob(a.id, { finished_at: new Date(Date.now() - 25 * 3600_000).toISOString() })
    updateJob(b.id, { status: 'done' })
    const r = cleanupJobs(24 * 3600_000)
    expect(r.removed).toBe(1)
    expect(getJob(a.id)).toBeNull()
    expect(getJob(b.id)).not.toBeNull()
    expect(getJob(c.id)).not.toBeNull()
  })

  it('never removes pending or running jobs even if old', () => {
    const j = createJob({ agent_type: 'r', title: 'ancient-pending' })
    // Backdate via direct file-edit
    j.created_at = new Date(0).toISOString()
    cleanupJobs(1000)
    expect(getJob(j.id)).not.toBeNull()
  })
})
