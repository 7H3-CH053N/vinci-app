import { app } from 'electron'
import { localISOString } from './_localTime.js'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'fs'
import { mirrorFactToGraph } from './obsidianGraph.js'

// ── Paths ─────────────────────────────────────────────────────────────────────
const getDir    = () => app.getPath('userData')
const convPath  = () => join(getDir(), 'vinci-conversations.jsonl')
const factsPath = () => join(getDir(), 'vinci-facts.json')

let initialized = false

export function initMemory() {
  try {
    const dir = getDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // Touch files if they don't exist
    if (!existsSync(convPath()))  writeFileSync(convPath(),  '', 'utf8')
    if (!existsSync(factsPath())) writeFileSync(factsPath(), '[]', 'utf8')
    initialized = true
    console.log('[Memory] Ready:', dir)
    return true
  } catch (err) {
    console.error('[Memory] Init failed:', err.message)
    return false
  }
}

// ── Save a message (append to JSONL) ─────────────────────────────────────────
// meta: optionale Metadaten, z. B. { webTainted: true } für Antworten,
// die externe Web-Daten enthalten. Der Memory-Worker überspringt diese.
export function saveMessage(role, content, meta = null) {
  if (!initialized || !content?.trim()) return
  try {
    const entry = { role, content: content.trim(), ts: localISOString() }
    if (meta && typeof meta === 'object') entry.meta = meta
    appendFileSync(convPath(), JSON.stringify(entry) + '\n', 'utf8')
  } catch (err) {
    console.error('[Memory] saveMessage:', err.message)
  }
}

// ── Read all conversations (parse JSONL) ──────────────────────────────────────
function readConversations() {
  try {
    const raw   = readFileSync(convPath(), 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    return lines.map(l => JSON.parse(l))
  } catch { return [] }
}

// ── Get recent history (last N messages) ──────────────────────────────────────
export function getRecentHistory(limit = 30) {
  const all = readConversations()
  return all.slice(-limit)
}

// ── Search past conversations ──────────────────────────────────────────────────
export function getRecentMessages(limit = 10) {
  try {
    const all = readConversations()
    return all.slice(-limit)
  } catch { return [] }
}

export function searchMemory(query, limit = 8) {
  if (!query) return []
  const q   = query.toLowerCase()
  const all = readConversations()
  return all
    .filter(m => m.content.toLowerCase().includes(q))
    .slice(-limit)
    .reverse()
}

// ── Facts ─────────────────────────────────────────────────────────────────────
function readFacts() {
  try { return JSON.parse(readFileSync(factsPath(), 'utf8')) }
  catch { return [] }
}

function writeFacts(facts) {
  writeFileSync(factsPath(), JSON.stringify(facts, null, 2), 'utf8')
}

export function saveFact(content, obsidianVaultPath, graphModel) {
  if (!initialized || !content?.trim()) return false
  const clean = content.trim()
  try {
    const facts = readFacts()
    facts.unshift({ content: clean, ts: localISOString() })
    writeFacts(facts.slice(0, 100)) // max 100 facts
    console.log('[Memory] Fact saved:', clean.slice(0, 60))
    if (obsidianVaultPath) {
      // Knowledge-Graph mit Wikilinks (async, fire-and-forget)
      // Sammeldatei VINCI-Facts.md ist abgeschafft – der Graph ist die einzige
      // menschen-lesbare Wissensquelle in Obsidian.
      mirrorFactToGraph(clean, obsidianVaultPath, graphModel || 'qwen2.5:3b')
        .catch(err => console.error('[Memory] graph mirror failed:', err.message))
    }
    return true
  } catch (err) {
    console.error('[Memory] saveFact:', err.message)
    return false
  }
}

// (Sammeldatei VINCI-Facts.md ist abgeschafft – der Knowledge-Graph in
//  <Vault>/VINCI/ ist jetzt die einzige menschen-lesbare Wissensquelle.)

export function getAllFacts(limit = 25) {
  return readFacts().slice(0, limit)
}

// ── Stats ──────────────────────────────────────────────────────────────────────
export function getMemoryStats() {
  try {
    const all   = readConversations()
    const facts = readFacts()
    return {
      available:     true,
      conversations: all.length,
      facts:         facts.length,
      since:         all[0]?.ts || null,
      dbPath:        getDir()
    }
  } catch {
    return { available: false }
  }
}

// ── Inject facts into Gemini system prompt ─────────────────────────────────────
// Alle Facts (max 100, Cap im saveFact) – damit das LLM nichts erst per Tool-Call
// nachladen muss. Ein paar Hundert Tokens mehr im Prompt sind günstig vs. einen
// extra Tool-Roundtrip.
export function buildMemoryContext() {
  try {
    const facts = getAllFacts(100)
    if (!facts.length) return ''
    return '\n\nWas VINCI dauerhaft über Alex weiß (nutze diese Fakten direkt, ohne Tool-Call):\n' +
      facts.map(f => `- ${f.content}`).join('\n')
  } catch { return '' }
}
