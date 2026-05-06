import { execFile, exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export const systemModule = {
  name: 'system',
  description: 'macOS Systeminfo: CPU, RAM, Festplatte, Akku, laufende Prozesse, Netzwerk',

  actions: {
    getStatus: async () => {
      const [cpu, mem, disk, battery, topProcs] = await Promise.allSettled([
        getCPU(), getMemory(), getDisk(), getBattery(), getTopProcesses()
      ])
      return {
        cpu:      cpu.status      === 'fulfilled' ? cpu.value      : null,
        memory:   mem.status      === 'fulfilled' ? mem.value      : null,
        disk:     disk.status     === 'fulfilled' ? disk.value     : null,
        battery:  battery.status  === 'fulfilled' ? battery.value  : null,
        processes: topProcs.status === 'fulfilled' ? topProcs.value : []
      }
    },

    getProcesses: async ({ name } = {}) => {
      if (name) {
        const { stdout } = await execAsync(`ps aux | grep -i "${name}" | grep -v grep`)
        const procs = stdout.trim().split('\n').filter(Boolean).map(parsePsLine)
        // Aggregate totals across all processes with this name
        const totalCpu = procs.reduce((s, p) => s + p.cpu, 0)
        const totalMem = procs.reduce((s, p) => s + p.mem, 0)
        const totalRam = (totalMem / 100 * 25.8).toFixed(1)  // approximate GB
        return {
          name,
          prozesse: procs.length,
          gesamt_cpu_pct: Math.round(totalCpu * 10) / 10,
          gesamt_ram_pct: Math.round(totalMem * 10) / 10,
          gesamt_ram_gb:  totalRam,
          details: procs.slice(0, 5)
        }
      }
      return getTopProcesses()
    }
  },

  tools: [
    {
      name: 'system_getStatus',
      description: 'Holt CPU-Auslastung, RAM, Festplatte, Akku und Top-Prozesse. Bei Fragen wie "wie ist mein System", "CPU", "RAM", "Speicher", "Akku", "Festplatte".',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'system_getProcesses',
      description: 'Zeigt laufende Prozesse, optional gefiltert nach Name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Prozessname zum Filtern (z.B. "Chrome", "Electron")' }
        }
      }
    }
  ]
}

// ── CPU ───────────────────────────────────────────────────────────────────────
async function getCPU() {
  const { stdout } = await execAsync(
    `top -l 1 -n 0 | grep "CPU usage"`, { timeout: 5000 }
  )
  const match = stdout.match(/(\d+\.\d+)%\s+user.*?(\d+\.\d+)%\s+sys.*?(\d+\.\d+)%\s+idle/)
  if (!match) return null
  const user = parseFloat(match[1])
  const sys  = parseFloat(match[2])
  const idle = parseFloat(match[3])
  return { user_pct: user, sys_pct: sys, idle_pct: idle, used_pct: Math.round(user + sys) }
}

// ── Memory ────────────────────────────────────────────────────────────────────
async function getMemory() {
  const { stdout } = await execAsync(
    `vm_stat | head -15`, { timeout: 5000 }
  )
  const pageSize = 16384  // macOS M-series typical page size

  const get = (label) => {
    const m = stdout.match(new RegExp(`${label}[^:]*:\\s+(\\d+)`))
    return m ? parseInt(m[1]) * pageSize : 0
  }

  const free      = get('Pages free')
  const active    = get('Pages active')
  const inactive  = get('Pages inactive')
  const wired     = get('Pages wired down')
  const compressed = get('Pages occupied by compressor')

  const total     = parseInt((await execAsync('sysctl -n hw.memsize')).stdout.trim())
  const used      = active + wired + compressed
  const usedGB    = (used / 1e9).toFixed(1)
  const totalGB   = (total / 1e9).toFixed(1)
  const freeGB    = ((total - used) / 1e9).toFixed(1)
  const pct       = Math.round(used / total * 100)

  return { used_gb: usedGB, total_gb: totalGB, free_gb: freeGB, used_pct: pct }
}

// ── Disk ──────────────────────────────────────────────────────────────────────
async function getDisk() {
  const { stdout } = await execAsync(`df -H / | tail -1`, { timeout: 5000 })
  const parts = stdout.trim().split(/\s+/)
  return {
    festplatte_gesamt:  parts[1],
    festplatte_belegt:  parts[2],
    festplatte_frei:    parts[3],
    festplatte_belegt_pct: parts[4]
  }
}

// ── Battery ───────────────────────────────────────────────────────────────────
async function getBattery() {
  const { stdout } = await execAsync(`pmset -g batt`, { timeout: 5000 })
  const pct  = stdout.match(/(\d+)%/)
  const state = stdout.includes('charging') ? 'lädt' : stdout.includes('discharging') ? 'entlädt' : 'voll'
  const time  = stdout.match(/(\d+:\d+)\s+remaining/)
  return {
    percent:   pct ? parseInt(pct[1]) : null,
    state,
    remaining: time ? time[1] : null
  }
}

// ── Top processes ─────────────────────────────────────────────────────────────
async function getTopProcesses() {
  const { stdout } = await execAsync(
    `ps aux --sort=-%cpu 2>/dev/null || ps aux | sort -rk3 | head -8`,
    { timeout: 5000 }
  )
  return stdout.trim().split('\n').slice(1, 9).map(parsePsLine).filter(p => p.cpu > 0.5)
}

function parsePsLine(line) {
  const parts = line.trim().split(/\s+/)
  return {
    user:    parts[0],
    pid:     parts[1],
    cpu:     parseFloat(parts[2]),
    mem:     parseFloat(parts[3]),
    command: parts.slice(10).join(' ').split('/').pop().slice(0, 40)
  }
}
