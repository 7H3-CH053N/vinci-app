#!/usr/bin/env node
// Migrations-Skript: räumt den Vault auf und baut den Knowledge-Graph aus
// vinci-facts.json neu auf.
//
// Aufruf:  node migrate-graph.mjs
//
// Voraussetzung: Ollama läuft, qwen2.5:3b installiert, Vault-Pfad in
// VINCI-Settings gesetzt.
//
// Tut:
// 1. Liest Vault-Pfad aus ~/Library/Application Support/VINCI/vinci-settings.json
// 2. Löscht <Vault>/VINCI/ (alter Graph)
// 3. Löscht <Vault>/inbox/VINCI Wissen/ und VINCI-Facts.md (Altmüll)
// 4. Liest alle Facts aus ~/Library/Application Support/VINCI/vinci-facts.json
// 5. Schickt jeden Fact durch den Graph-Builder (Entity-Extraction + Schreiben)

import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import http from 'http'

const APP_SUPPORT = join(homedir(), 'Library/Application Support/VINCI')
const SETTINGS    = join(APP_SUPPORT, 'vinci-settings.json')
const FACTS_FILE  = join(APP_SUPPORT, 'vinci-facts.json')
const GRAPH_DIR   = 'VINCI'

// ── Vault-Pfad lesen ──
if (!existsSync(SETTINGS)) {
  console.error('vinci-settings.json nicht gefunden. Bitte VINCI mindestens einmal starten.')
  process.exit(1)
}
const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'))
const vault    = settings?.obsidian?.vaultPath
if (!vault || !existsSync(vault)) {
  console.error('Kein gültiger Obsidian-Vault konfiguriert:', vault)
  process.exit(1)
}
console.log('Vault:', vault)

// ── Cleanup ──
const oldGraph    = join(vault, GRAPH_DIR)
const oldWissen   = join(vault, 'inbox', 'VINCI Wissen')
const oldSammler  = join(vault, 'inbox', 'VINCI-Facts.md')
const oldSammler2 = readdirSync(join(vault, 'inbox')).filter(f => /^vinci-facts.*\.md$/i.test(f))

console.log('\n=== Cleanup ===')
;[oldGraph, oldWissen, oldSammler, ...oldSammler2.map(f => join(vault, 'inbox', f))].forEach(p => {
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true })
    console.log('gelöscht:', p)
  }
})

// ── Facts lesen ──
if (!existsSync(FACTS_FILE)) {
  console.error('vinci-facts.json nicht gefunden')
  process.exit(1)
}
const facts = JSON.parse(readFileSync(FACTS_FILE, 'utf8'))
console.log(`\n${facts.length} Facts werden migriert (dauert ca. ${Math.round(facts.length * 3)}s)...\n`)

// ── Aliase laden (falls vorhanden) ──
const aliasFile = join(vault, GRAPH_DIR, '_aliases.json')
mkdirSync(join(vault, GRAPH_DIR), { recursive: true })
let aliasMap = {}
if (existsSync(aliasFile)) {
  try {
    const raw = JSON.parse(readFileSync(aliasFile, 'utf8'))
    for (const [canonical, list] of Object.entries(raw)) {
      aliasMap[canonical.toLowerCase()] = canonical
      if (Array.isArray(list)) for (const a of list) aliasMap[String(a).toLowerCase()] = canonical
    }
  } catch {}
}

const VALID_CATS = ['Personen', 'Tiere', 'Firmen', 'Orte', 'Themen', 'Projekte']
const STOP = new Set(['der','die','das','ein','eine','und','ist','sind','in','an','bei','mit','von','zu','sich','er','sie','es'])

function tokenize(s) {
  return s.toLowerCase().replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/[^\wäöüß ]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !STOP.has(t))
}
function isDup(content, fact) {
  if (content.includes(fact)) return true
  const nt = tokenize(fact); if (!nt.length) return false
  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('- ')) continue
    const lt = new Set(tokenize(line))
    let ov = 0
    for (const t of nt) if (lt.has(t)) ov++
    if (ov / nt.length >= 0.7) return true
  }
  return false
}
function resolveAlias(name) { return aliasMap[name.toLowerCase()] || name }

function applyWikilinks(fact, entities) {
  let r = fact
  const reps = []
  for (const e of entities) {
    reps.push({ from: e.name, to: e.name })
    if (e.originalName && e.originalName !== e.name) reps.push({ from: e.originalName, to: e.name })
    for (const [a, c] of Object.entries(aliasMap)) if (c === e.name) reps.push({ from: a, to: e.name })
  }
  reps.sort((a, b) => b.from.length - a.from.length)
  for (const { from, to } of reps) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    r = r.replace(new RegExp(`(?<![\\[\\w])(${esc})(?![\\w\\]])`, 'gi'), `[[${to}]]`)
  }
  return r
}

function findExisting(name) {
  const safe = name.replace(/[<>:"/\\|?*\n\r]/g, '_').slice(0, 80)
  for (const cat of VALID_CATS) {
    const p = join(vault, GRAPH_DIR, cat, `${safe}.md`)
    if (existsSync(p)) return p
  }
  return null
}
function writeNote(entity, linkedFact, ts) {
  const existing = findExisting(entity.name)
  let file, content
  if (existing) {
    file = existing
    content = readFileSync(file, 'utf8')
  } else {
    const dir = join(vault, GRAPH_DIR, entity.category)
    mkdirSync(dir, { recursive: true })
    const safe = entity.name.replace(/[<>:"/\\|?*\n\r]/g, '_').slice(0, 80)
    file = join(dir, `${safe}.md`)
    content = `---\nsource: VINCI\ncategory: ${entity.category}\ncreated: ${new Date().toISOString().split('T')[0]}\n---\n\n# ${entity.name}\n\n`
  }
  if (isDup(content, linkedFact)) return
  if (!content.endsWith('\n')) content += '\n'
  content += `- **${ts}** — ${linkedFact}\n`
  writeFileSync(file, content, 'utf8')
}

// ── Ollama-Call (ohne axios) ──
function ollamaChat(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({
      hostname: 'localhost', port: 11434, path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 30000
    }, res => {
      let chunks = ''
      res.on('data', c => chunks += c)
      res.on('end', () => { try { resolve(JSON.parse(chunks)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.write(data); req.end()
  })
}

async function extractEntities(fact) {
  const sys = `Du extrahierst aus einem deutschsprachigen Satz Eigennamen und kategorisierst sie.

Kategorien:
- Personen: konkrete menschliche Eigennamen UND Bandnamen (Iron Maiden, Metallica)
- Tiere: Haustiere mit Eigennamen
- Firmen: Unternehmen, Marken, Vereine, Restaurants
- Orte: Städte, Länder, Adressen
- Themen: Hobbys, Genres, Konzepte (z. B. 'Hard Rock', 'Fußball')

NICHT extrahieren:
- Datumsangaben, Jahreszahlen
- Generische Wörter ('Bruder', 'Frau', 'Sohn', 'Hund', 'Eventagentur')
- Hunderassen, Tierarten ('Labrador')
- Berufsbezeichnungen ohne Eigennamen

WICHTIG:
- 'Alex' MUSS extrahiert werden, falls erwähnt
- Mehrwortige Eigennamen zusammen
- Bandnamen IMMER 'Personen'

Antworte NUR JSON: {"entities": [{"name": "...", "category": "..."}]}`
  const user = `Beispiele:

1. "Markus ist Alex' Bruder und arbeitet bei Porsche"
→ {"entities":[{"name":"Markus","category":"Personen"},{"name":"Alex","category":"Personen"},{"name":"Porsche","category":"Firmen"}]}

2. "Bello ist Alex' Hund, ein Labrador geboren 2020"
→ {"entities":[{"name":"Bello","category":"Tiere"},{"name":"Alex","category":"Personen"}]}

Jetzt extrahiere aus:
"${fact}"`
  const res = await ollamaChat({
    model: settings?.memoryWorkerModel || 'qwen2.5:3b',
    stream: false, format: 'json',
    options: { temperature: 0.1, num_ctx: 4096 },
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
  })
  try {
    const p = JSON.parse(res?.message?.content || '{}')
    if (Array.isArray(p.entities)) return p.entities
  } catch {}
  return []
}

const GENERIC = new Set([
  'bruder','schwester','vater','mutter','sohn','tochter','frau','mann','kind','familie',
  'ehefrau','ehemann','partner','partnerin','freund','freundin','kollege','kollegin','chef',
  'benutzer','user','person','jemand',
  'hund','katze','pferd','vogel','fisch','tier','labrador','schäferhund','retriever','dackel','beagle',
  'eventagentur','agentur','firma','büro','office','unternehmen','konzern',
  'restaurant','lokal','bar','café','cafe','laden','geschäft','shop','store',
  'trafik','tabakladen','bäckerei','metzgerei','supermarkt','bank',
  'manager','mechaniker','arzt','ärztin','lehrer','lehrerin','student','studentin','schüler','schülerin',
  'ki-berater','berater','beraterin','consultant','direktor','geschäftsführer','geschäftsführung',
  'managing','director','leiter','leiterin','assistent','assistentin',
  'verkäufer','verkäuferin','programmierer','entwickler','designer','blogger',
  'auto','wagen','haus','wohnung','garten','blog','website','seite','homepage'
])
function postFilter(raw, fact) {
  const out = [], seen = new Set()
  for (const e of raw) {
    if (!e?.name || !e?.category) continue
    let n = e.name.trim().replace(/^["']|["']$/g, '')
    if (n.length < 2 || GENERIC.has(n.toLowerCase())) continue
    if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(n) || /^\d{4}$/.test(n)) continue
    let c = VALID_CATS.includes(e.category) ? e.category : 'Themen'
    const k = n.toLowerCase(); if (seen.has(k)) continue; seen.add(k)
    out.push({ name: n, category: c })
  }
  if (/\bAlex\b/.test(fact) && !out.some(e => e.name.toLowerCase() === 'alex')) {
    out.unshift({ name: 'Alex', category: 'Personen' })
  }
  return out
}

// ── Migration ──
;(async () => {
  // Älteste zuerst, damit chronologisch im Graph
  const sorted = [...facts].reverse()
  let i = 0, ok = 0, skip = 0
  for (const f of sorted) {
    i++
    process.stdout.write(`[${i}/${sorted.length}] ${f.content.slice(0, 70)}... `)
    try {
      let entities = await extractEntities(f.content)
      entities = postFilter(entities, f.content)
      entities = entities.map(e => ({ ...e, name: resolveAlias(e.name), originalName: e.name }))
      const seen = new Set()
      entities = entities.filter(e => { const k = e.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
      if (entities.length === 0) { console.log('skip (keine Entitäten)'); skip++; continue }
      const linked = applyWikilinks(f.content, entities)
      const ts = new Date(f.ts).toLocaleString('de-AT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
      for (const e of entities) writeNote(e, linked, ts)
      console.log('→', entities.map(e => e.name).join(', '))
      ok++
    } catch (err) {
      console.log('FEHLER:', err.message)
    }
  }
  console.log(`\n✓ ${ok} migriert, ${skip} übersprungen.`)
  console.log(`\nNächste Schritte:`)
  console.log(`  1. Obsidian öffnen und ${vault}/VINCI/ anschauen`)
  console.log(`  2. Falls Aliase nötig: ${vault}/VINCI/_aliases.json anlegen, dann erneut migrieren`)
})()
