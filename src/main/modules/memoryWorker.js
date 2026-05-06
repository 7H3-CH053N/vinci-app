// ── Memory-Worker ──────────────────────────────────────────────────────────────
// Läuft im Hintergrund nach jedem Chat-Abschluss. Nutzt Ollama (Qwen 2.5 3B
// per Default) um stabile Fakten über den User aus der jüngsten Konversation
// zu extrahieren und persistent in den Facts-Store zu schreiben.
//
// Latenz: ist hier egal – wir warten nicht. Trigger ist debounced (default 30s
// nach letzter Message), zusätzlich gilt eine Mindest-Cooldown.
//
// Kein Hard-Dependency auf Ollama: wenn Ollama nicht läuft, ist der Worker
// ein No-op und VINCI funktioniert weiter.

import axios from 'axios'
import { getRecentHistory, getAllFacts, saveFact } from './memory.js'

const OLLAMA_URL    = 'http://localhost:11434'
const DEFAULT_MODEL = 'qwen2.5:3b'

// Debounce: erst 30s nach letztem Trigger ausführen
const DEBOUNCE_MS = 30_000
// Cooldown: zwischen zwei Runs mindestens 2 Minuten
const COOLDOWN_MS = 2 * 60_000
// Konversations-Fenster: letzte N Messages aus Memory analysieren
const HISTORY_LIMIT = 12

let timer           = null
let lastRun         = 0
let running         = false
let getSettingsHook = () => ({})

// ── Public API ────────────────────────────────────────────────────────────────
export function setupMemoryWorker(getSettings) {
  getSettingsHook = getSettings
  console.log('[MemWorker] ready, model:', getSettingsHook()?.memoryWorkerModel || DEFAULT_MODEL)
}

/** Wird nach jeder Chat-Antwort von ipc.js aufgerufen. Debounced. */
export function scheduleMemoryConsolidation() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runConsolidation, DEBOUNCE_MS)
}

// ── Core ──────────────────────────────────────────────────────────────────────
async function runConsolidation() {
  if (running) return
  if (Date.now() - lastRun < COOLDOWN_MS) {
    console.log('[MemWorker] cooldown active, skip')
    return
  }
  running = true
  try {
    // 1) Ollama erreichbar?
    try {
      await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 2000 })
    } catch {
      console.log('[MemWorker] Ollama nicht erreichbar – skip')
      return
    }

    // 2) Konversation lesen – tainted Messages (Web/Messages/Mail) werden
    //    komplett ausgeblendet, damit externe oder private Daten nicht ins
    //    Memory sickern. (`webTainted` für Rückwärtskompatibilität mit alten
    //    JSONL-Einträgen.)
    const rawHistory = getRecentHistory(HISTORY_LIMIT)
    const history = rawHistory.filter(m => !m.meta?.tainted && !m.meta?.webTainted)
    const skipped = rawHistory.length - history.length
    if (skipped > 0) {
      console.log(`[MemWorker] ${skipped} tainted Message(s) übersprungen`)
    }
    if (history.length < 4) {
      console.log('[MemWorker] zu wenig History (', history.length, ') – skip')
      return
    }

    const conv = history
      .filter(m => m.content?.trim())
      .map(m => `${m.role === 'user' ? 'Alex' : 'VINCI'}: ${m.content.trim()}`)
      .join('\n')

    // 3) Existierende Facts mitschicken (für Deduplikation)
    const existing = getAllFacts(50).map(f => f.content)

    // 4) Ollama-Call
    const settings   = getSettingsHook() || {}
    const model      = settings.memoryWorkerModel || DEFAULT_MODEL
    const vaultPath  = settings.obsidian?.vaultPath || ''
    console.log('[MemWorker] extrahiere mit', model, '...')
    const t0 = Date.now()
    const facts = await extractFacts(model, conv, existing)
    console.log(`[MemWorker] ${facts.length} Kandidat(en) in ${Date.now()-t0}ms`)

    // 5) Filtern + speichern (mit Obsidian-Mirror)
    let saved = 0
    for (const f of facts) {
      if (!looksLikeFact(f)) {
        console.log('[MemWorker] verworfen (filter):', f)
        continue
      }
      if (isDuplicate(f, existing)) {
        console.log('[MemWorker] verworfen (dup):', f)
        continue
      }
      if (saveFact(f, vaultPath, model)) {
        saved++
        existing.unshift(f)
      }
    }
    console.log(`[MemWorker] ${saved} neue Fakten gespeichert`)
  } catch (err) {
    console.error('[MemWorker] error:', err.message)
  } finally {
    lastRun = Date.now()
    running = false
  }
}

// ── Ollama-Call ───────────────────────────────────────────────────────────────
async function extractFacts(model, conv, existing) {
  const existingSnippet = existing.length
    ? `Bereits bekannte Fakten (NICHT erneut extrahieren):\n${existing.slice(0,15).map(f => '- '+f).join('\n')}\n\n`
    : ''

  const systemPrompt = `Du extrahierst aus Konversationen NUR stabile, langfristig relevante Fakten über den User Alex.

GUTE Fakten (extrahieren):
- Personen (Familie, Freunde, Kollegen) mit Beziehung/Beruf
- Vorlieben, Gewohnheiten
- Besitz (Auto, Hund, Hobbys)
- Wohnort, Arbeitgeber

SCHLECHTE Fakten (NIEMALS extrahieren):
- Heutiges/morgiges Wetter, Termine, Mails – das ist Tagesgeschehen
- Alles was die Wörter "heute", "morgen", "gerade", "jetzt" enthält
- Tool-Antworten von VINCI
- Was VINCI gesagt hat

Gib NUR ein JSON-Objekt aus: {"facts": ["Fakt 1"]}
Wenn nichts Langfristiges drin ist: {"facts": []}

Fakten beginnen mit "Alex..." oder einem Eigennamen, sind kurz, in 3. Person.`

  const userPrompt = `BEISPIEL 1 (mit Facts):
Alex: Mein Bruder Toni hat gerade in Linz angefangen, ich trinke morgens immer Espresso
→ {"facts": ["Toni ist Alex' Bruder", "Toni arbeitet in Linz", "Alex trinkt morgens Espresso"]}

BEISPIEL 2 (keine Facts, nur Tagesgeschehen):
Alex: Welches Wetter morgen?
VINCI: 18 Grad sonnig.
Alex: Was hab ich heute?
VINCI: 2 Termine.
→ {"facts": []}

BEISPIEL 3 (keine Facts, nur Live-Daten/Messwerte):
Alex: Wie hoch ist mein Stromverbrauch?
VINCI: Aktuell 1104 Watt, diesen Monat 294 kWh.
Alex: Was hab ich auf der Liste?
VINCI: Du hast zwei Aufgaben offen.
→ {"facts": []}

WICHTIG: Strom-Messwerte, aktuelle Verbrauchswerte, Anzahl von Mails/Aufgaben/Terminen
sind NIE stabile Fakten – sie ändern sich permanent.

${existingSnippet}JETZT extrahiere aus DIESER Konversation:

${conv}`

  const body = {
    model,
    stream: false,
    format: 'json',
    options: { temperature: 0.3, num_ctx: 4096 },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt }
    ]
  }

  const res = await axios.post(`${OLLAMA_URL}/api/chat`, body, { timeout: 30_000 })
  const text = res.data?.message?.content || ''
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed.facts)) return parsed.facts.filter(f => typeof f === 'string')
  } catch {
    console.log('[MemWorker] JSON parse failed:', text.slice(0, 200))
  }
  return []
}

// ── Heuristik-Filter (gegen kleines-Modell-Fehlentscheidungen) ────────────────
// Wir blocken lieber zu viel als zu wenig – verlorene Facts kann der User
// manuell anlegen ("merk dir..."); Tagesgeschehen im Memory verwässert dagegen
// alles dauerhaft.
const BAD_WORDS = [
  // ── Zeitliche Begrenzung ─────────────────────────────────────────────────
  /\b(heute|morgen|gestern|übermorgen|vorgestern)\b/i,
  /\b(gerade jetzt|gerade eben|im moment|im augenblick|momentan|aktuell|derzeit|zurzeit|jetzt eben)\b/i,
  /\b(diese[nr]?|letzte[nr]?|nächste[nr]?|kommende[nr]?|vergangene[nr]?)\s+(woche|monat|jahr|tag|stunde|minute|quartal)\b/i,
  /\b(soeben|kürzlich|neulich|gleich|sofort|inzwischen|bislang|bisher)\b/i,

  // ── Tool-Domain (Live-Daten, nie stabile Fakten) ─────────────────────────
  /\btermine?\b/i,
  /\bwetter\b/i,
  /\b\d+\s*°|grad\s+(c|celsius|sonnig|bewölkt|regen)/i,
  // Strom-/Energie-Verbrauchsdaten
  /\b(stromverbrauch|stromkosten|strompreis|stromtarif)\b/i,
  /\b\d+([\.,]\d+)?\s*(watt|kw|kwh|kilowatt|mw|wh|amp|ampere|volt)\b/i,
  /\b(verbrauch|durchschnittsverbrauch).*\b(kwh|watt|euro|€)\b/i,
  // System-/Hardware-Metriken (CPU, RAM, Disk, Akku) — flüchtig, nie ein Fakt
  /\bmac.*\b(läuft|cpu|ram|memory|akku|festplatte|speicher|prozessor|arbeitsspeicher|ausgelastet|geladen|belegt|prozent)\b/i,
  /\b(cpu|prozessor|arbeitsspeicher|ram|memory|festplatte|disk|akku|battery)\b.*\b\d+\s*%/i,
  /\b\d+\s*%\b.*(cpu|ram|memory|akku|disk|prozessor|arbeitsspeicher|festplatte|geladen|ausgelastet|belegt)/i,
  /\b(restlaufzeit|ladestand|battery\s+life)\b/i,
  // Mengen-Hinweise auf Listen aus Tool-Outputs (sowohl Ziffern als auch Wortzahlen)
  /\b(\d+|eine?|ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\s+(?:\w+\s+){0,3}(termine?|mails?|e-?mails?|nachrichten|aufgaben|erinnerungen|tasks|to-?dos?)\b/i,

  // ── Einmalige Ereignisse ─────────────────────────────────────────────────
  /\b(arzt|tierarzt|zahnarzt|doktor|friseur|krankenhaus)\b/i,
  /\b(meeting|event|spiel|essen|treffen|termin)\b.*\b(am|um|gegen)\s+\d/i,
]

function looksLikeFact(s) {
  const t = (s || '').trim()
  if (t.length < 8 || t.length > 120) return false
  for (const re of BAD_WORDS) if (re.test(t)) return false
  if (/\b(notiert|erledigt|danke|bitte)\b/i.test(t)) return false
  return true
}

function isDuplicate(fact, existing) {
  const norm = s => s.toLowerCase().replace(/[^\wäöüß ]/g, ' ').replace(/\s+/g, ' ').trim()
  const a = norm(fact)
  for (const e of existing) {
    const b = norm(e)
    if (a === b) return true
    // Substring-Match für nahezu identische Aussagen
    if (a.length > 15 && b.length > 15 && (a.includes(b) || b.includes(a))) return true
  }
  return false
}

// ── Test-Hook (nur für Unit-Tests) ────────────────────────────────────────────
export const _internal = { looksLikeFact, isDuplicate, extractFacts }
