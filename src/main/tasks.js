// ── Aufgaben-Modul ─────────────────────────────────────────────────────────────
// Plant und führt geplante Prompts aus, schickt Ergebnisse als
// macOS-Notification + speichert sie in einer In-App-History.
//
// Storage: ~/Library/Application Support/VINCI/vinci-tasks.json
//
// Schedule-Modi:
//   - daily      → "M H * * *"
//   - weekdays   → "M H * * 1-5"
//   - weekly     → "M H * * 1,3,5" (mit ausgewählten Wochentagen)
//   - hourly     → "0 */N * * *"   (alle N Stunden)

import { app, Notification } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import cron from 'node-cron'
import { runTask } from './taskExecutor.js'

const TASKS_PATH = () => join(app.getPath('userData'), 'vinci-tasks.json')
const RESULTS_PATH = () => join(app.getPath('userData'), 'vinci-task-results.json')
const MAX_RESULTS_PER_TASK = 20

const cronJobs = new Map()           // taskId → cron handle
let mainWindow = null

// ── Public API ────────────────────────────────────────────────────────────────
export function setupTasks(win) {
  mainWindow = win
  rescheduleAll()
  console.log('[Tasks] ready, ', listTasks().length, 'task(s) loaded')
}

export function listTasks() {
  try {
    if (!existsSync(TASKS_PATH())) return []
    const data = JSON.parse(readFileSync(TASKS_PATH(), 'utf8'))
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export function getTask(id) {
  return listTasks().find(t => t.id === id)
}

export function saveTasks(tasks) {
  writeFileSync(TASKS_PATH(), JSON.stringify(tasks, null, 2), 'utf8')
}

export function createTask(input) {
  const tasks = listTasks()
  const task = {
    id:          'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name:        String(input.name || 'Unbenannte Aufgabe').slice(0, 80),
    prompt:      String(input.prompt || '').slice(0, 2000),
    schedule:    sanitizeSchedule(input.schedule),
    enabled:     input.enabled !== false,
    createdAt:   new Date().toISOString(),
    lastRunAt:   null,
    lastError:   null
  }
  tasks.push(task)
  saveTasks(tasks)
  rescheduleOne(task)
  return task
}

export function updateTask(id, patch) {
  const tasks = listTasks()
  const i = tasks.findIndex(t => t.id === id)
  if (i < 0) return null
  const next = {
    ...tasks[i],
    ...patch,
    schedule: patch.schedule ? sanitizeSchedule(patch.schedule) : tasks[i].schedule,
    id: tasks[i].id   // never change ID
  }
  tasks[i] = next
  saveTasks(tasks)
  rescheduleOne(next)
  return next
}

export function deleteTask(id) {
  const tasks = listTasks().filter(t => t.id !== id)
  saveTasks(tasks)
  if (cronJobs.has(id)) {
    cronJobs.get(id).stop()
    cronJobs.delete(id)
  }
  return true
}

export async function executeTaskNow(id) {
  const task = getTask(id)
  if (!task) throw new Error('Task nicht gefunden')
  return await runAndNotify(task, true)
}

// ── Results (History pro Task) ────────────────────────────────────────────────
function readAllResults() {
  try {
    if (!existsSync(RESULTS_PATH())) return {}
    return JSON.parse(readFileSync(RESULTS_PATH(), 'utf8')) || {}
  } catch { return {} }
}
function writeAllResults(obj) {
  writeFileSync(RESULTS_PATH(), JSON.stringify(obj, null, 2), 'utf8')
}
export function getTaskResults(id) {
  const all = readAllResults()
  return all[id] || []
}
export function appendTaskResult(id, result) {
  const all = readAllResults()
  const list = all[id] || []
  list.unshift(result)
  all[id] = list.slice(0, MAX_RESULTS_PER_TASK)
  writeAllResults(all)
}

// ── Schedule Helpers ──────────────────────────────────────────────────────────
function sanitizeSchedule(s) {
  s = s || {}
  const mode = s.mode || 'daily'
  const time = /^\d{1,2}:\d{2}$/.test(s.time) ? s.time : '09:00'
  let weekdays = Array.isArray(s.weekdays) ? s.weekdays.filter(d => d >= 0 && d <= 6) : []
  if (weekdays.length === 0) weekdays = [1,2,3,4,5]
  let hours = Number(s.hours) || 1
  if (hours < 1)  hours = 1
  if (hours > 24) hours = 24
  return { mode, time, weekdays, hours }
}

function scheduleToCron(schedule) {
  const [h, m] = (schedule.time || '09:00').split(':').map(Number)
  switch (schedule.mode) {
    case 'daily':
      return `${m} ${h} * * *`
    case 'weekdays':
      return `${m} ${h} * * 1-5`
    case 'weekly':
      // weekdays als CSV, sonst täglich
      const days = (schedule.weekdays || []).join(',')
      return days ? `${m} ${h} * * ${days}` : `${m} ${h} * * *`
    case 'hourly':
      return `0 */${schedule.hours || 1} * * *`
    default:
      return `${m} ${h} * * *`
  }
}

export function describeSchedule(schedule) {
  const WD = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag']
  switch (schedule.mode) {
    case 'daily':    return `Täglich um ${schedule.time}`
    case 'weekdays': return `Mo–Fr um ${schedule.time}`
    case 'weekly':
      const list = (schedule.weekdays || []).map(d => WD[d].slice(0,2)).join(', ')
      return `${list} um ${schedule.time}`
    case 'hourly':   return `Alle ${schedule.hours} Std.`
    default:         return 'Unbekannt'
  }
}

function rescheduleAll() {
  for (const job of cronJobs.values()) job.stop()
  cronJobs.clear()
  for (const t of listTasks()) rescheduleOne(t)
}

function rescheduleOne(task) {
  if (cronJobs.has(task.id)) {
    cronJobs.get(task.id).stop()
    cronJobs.delete(task.id)
  }
  if (!task.enabled) return
  const expr = scheduleToCron(task.schedule)
  if (!cron.validate(expr)) {
    console.error('[Tasks] invalid cron', task.id, expr)
    return
  }
  const job = cron.schedule(expr, () => {
    runAndNotify(task, false).catch(err => {
      console.error('[Tasks] run failed', task.id, err.message)
    })
  }, { timezone: 'Europe/Vienna' })
  cronJobs.set(task.id, job)
  console.log(`[Tasks] scheduled "${task.name}" → ${expr}`)
}

// ── Run + Notify ──────────────────────────────────────────────────────────────
async function runAndNotify(task, manual) {
  console.log(`[Tasks] running "${task.name}" (${manual ? 'manual' : 'scheduled'})`)
  const startedAt = new Date().toISOString()
  let resultText = ''
  let errorText  = null
  try {
    resultText = await runTask(task)
  } catch (err) {
    errorText = err.message || String(err)
  }
  const finishedAt = new Date().toISOString()

  // Persist result
  const result = {
    taskId:    task.id,
    startedAt,
    finishedAt,
    text:      resultText || '',
    error:     errorText,
    manual
  }
  appendTaskResult(task.id, result)

  // Update lastRun on task
  updateTaskField(task.id, {
    lastRunAt: finishedAt,
    lastError: errorText
  })

  // macOS-Notification
  showNotification(task, result)

  // In-App: Renderer informieren, damit Banner/Liste aktualisiert
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('lyra:taskResult', { taskId: task.id, result })
  }

  return result
}

function updateTaskField(id, patch) {
  const tasks = listTasks()
  const i = tasks.findIndex(t => t.id === id)
  if (i < 0) return
  tasks[i] = { ...tasks[i], ...patch }
  saveTasks(tasks)
}

function showNotification(task, result) {
  if (!Notification.isSupported()) return
  const title = '⚙ ' + task.name
  let body
  if (result.error) {
    body = '⚠ Fehler: ' + result.error.slice(0, 200)
  } else {
    body = (result.text || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    if (body.length === 0) body = 'Aufgabe ausgeführt.'
  }
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('lyra:openTaskResult', task.id)
    }
  })
  n.show()
}
