// ── Obsidian-Modul ─────────────────────────────────────────────────────────────
// Liest und durchsucht den Obsidian-Vault des Users (lokal, plain Markdown).
// Vault-Pfad kommt aus settings.obsidian.vaultPath.
//
// Tools für Gemini/Ollama:
//   obsidian_search(query)      — Volltext-Suche, gibt Treffer mit Snippet zurück
//   obsidian_read(path)         — eine Notiz vollständig lesen
//   obsidian_listFolders()      — Ordnerstruktur anzeigen
//   obsidian_createNote(...)    — neue Notiz in inbox/ anlegen (kein Edit)
//
// Sicherheitsprinzip:
//   - Pfade werden gegen Vault-Root validiert (kein Path-Traversal aus dem Vault)
//   - Schreiben ausschließlich im Unterordner "inbox/"
//   - Versteckte Ordner (.obsidian, .trash) und große Binärdateien werden geskippt

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs'
import { join, relative, resolve, dirname, basename, sep } from 'path'
import { linkNoteToGraph } from './obsidianGraph.js'

// Skip-Listen
const SKIP_DIRS  = new Set(['.obsidian', '.trash', '.git', 'node_modules', '_attachments', 'attachments'])
const MD_EXTS    = ['.md', '.markdown']
const MAX_FILES  = 5000           // Schutz vor Riesen-Vaults
const MAX_SIZE   = 1024 * 1024    // 1 MB pro Datei – größere überspringen
const MAX_SNIPPET_LINES = 6

export const obsidianModule = {
  name: 'obsidian',
  description: 'Persönliches Wissen aus dem Obsidian-Vault: Notizen durchsuchen, lesen, neue Notizen anlegen',

  actions: {
    search: async ({ query, maxResults = 8 } = {}, ctx) => {
      const vault = getVault(ctx)
      if (!vault.ok) return vault
      if (!query || !query.trim()) return { error: 'query darf nicht leer sein' }
      const results = searchVault(vault.root, query.trim(), maxResults)
      return { vault: vault.root, query, count: results.length, results }
    },

    read: async ({ path } = {}, ctx) => {
      const vault = getVault(ctx)
      if (!vault.ok) return vault
      if (!path) return { error: 'path erforderlich (relativ zum Vault)' }
      const safe = safePath(vault.root, path)
      if (!safe) return { error: 'Pfad liegt außerhalb des Vaults' }
      if (!existsSync(safe)) return { error: 'Datei nicht gefunden: ' + path }
      try {
        const content = readFileSync(safe, 'utf8')
        return { path, length: content.length, content }
      } catch (err) {
        return { error: err.message }
      }
    },

    listFolders: async ({} = {}, ctx) => {
      const vault = getVault(ctx)
      if (!vault.ok) return vault
      const folders = listFolders(vault.root)
      return { vault: vault.root, folders }
    },

    createNote: async ({ title, content } = {}, ctx) => {
      const vault = getVault(ctx)
      if (!vault.ok) return vault
      if (!title || !content) return { error: 'title und content erforderlich' }

      // Notizen landen unter <Vault>/VINCI/Notizen/ – im selben Namespace wie der
      // Knowledge-Graph, damit sie sich über Wikilinks miteinander vernetzen.
      const notesDir = join(vault.root, 'VINCI', 'Notizen')
      if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true })

      const safeTitle = title.replace(/[^\wäöüß \-_]/gi, '_').slice(0, 80) || 'Notiz'
      const ts = new Date().toISOString().split('T')[0]
      const baseName = `${ts} – ${safeTitle}`
      let finalPath = join(notesDir, `${baseName}.md`)
      let suffix = 2
      while (existsSync(finalPath)) {
        finalPath = join(notesDir, `${baseName} (${suffix}).md`)
        suffix++
        if (suffix > 99) return { error: 'Zu viele Notizen mit dem gleichen Titel.' }
      }

      // Entitäten extrahieren, Wikilinks im Body setzen, Rückverweise in
      // Entity-Notizen anlegen. Modell aus settings.memoryWorkerModel oder Default.
      const model = ctx?.settings?.memoryWorkerModel || 'qwen2.5:3b'
      let linkedContent = content
      let entityCount = 0
      try {
        const result = await linkNoteToGraph(content, baseName, vault.root, model)
        linkedContent = result.linkedBody
        entityCount = result.entityCount
      } catch (err) {
        console.warn('[Obsidian] linkNoteToGraph failed (Notiz wird trotzdem gespeichert):', err.message)
      }

      const body = `---\ncreated: ${new Date().toISOString()}\nsource: VINCI\n---\n\n# ${title}\n\n${linkedContent}\n`
      writeFileSync(finalPath, body, 'utf8')
      const rel = relative(vault.root, finalPath)
      console.log('[Obsidian] Note created:', rel, '|', entityCount, 'Entities verlinkt')
      return {
        ok: true,
        path: rel,
        entitiesLinked: entityCount,
        message: `Notiz angelegt: ${rel}${entityCount ? ` (${entityCount} Entitäten verlinkt)` : ''}`
      }
    }
  },

  tools: [
    {
      name: 'obsidian_search',
      description: 'Sucht im Obsidian-Vault nach Notizen. Nutzen wenn Alex nach Wissen, Ideen, Personen, Projekten oder eigenen Notizen fragt – z. B. "was hab ich zu X notiert", "was weißt du über Y aus meinen Notizen".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Suchbegriff(e)' },
          maxResults: { type: 'number', description: 'Maximale Trefferanzahl (default 8)' }
        },
        required: ['query']
      }
    },
    {
      name: 'obsidian_read',
      description: 'Liest eine bestimmte Notiz vollständig. Pfad ist relativ zum Vault-Root (so wie ihn obsidian_search liefert).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Vault-relativer Pfad, z. B. "Projekte/Vinci.md"' }
        },
        required: ['path']
      }
    },
    {
      name: 'obsidian_listFolders',
      description: 'Zeigt die Ordnerstruktur des Vaults. Nutzen wenn Alex einen Überblick möchte.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'obsidian_createNote',
      description: 'Legt eine ECHTE neue Notiz mit eigenem Inhalt in Obsidian an (im Ordner inbox/). NUR nutzen, wenn Alex explizit sagt "schreib eine Notiz", "notier in Obsidian", "leg eine Notiz an". NICHT bei "merk dir" oder "wichtig" – dafür ist memory_saveFact zuständig (kürzer, automatisch im Wissens-Graph).',
      parameters: {
        type: 'object',
        properties: {
          title:   { type: 'string', description: 'Titel der Notiz' },
          content: { type: 'string', description: 'Inhalt (Markdown möglich, kann mehrere Absätze haben)' }
        },
        required: ['title', 'content']
      }
    }
  ]
}

// ── Helpers ────────────────────────────────────────────────────────────────────
export function detectMultipleVaults(parentPath) {
  if (!existsSync(parentPath)) return false
  try {
    if (!statSync(parentPath).isDirectory()) return false
  } catch { return false }
  let count = 0
  let entries
  try { entries = readdirSync(parentPath, { withFileTypes: true }) }
  catch { return false }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (existsSync(join(parentPath, e.name, '.obsidian'))) {
      count++
      if (count >= 2) return true
    }
  }
  return false
}

function getVault(ctx) {
  const vault = ctx?.settings?.obsidian?.vaultPath
  if (!vault) {
    return { error: 'Obsidian-Vault nicht konfiguriert. Pfad in Einstellungen → Dienste eintragen.' }
  }
  if (!existsSync(vault)) {
    return { error: `Vault-Pfad existiert nicht: ${vault}` }
  }
  if (!statSync(vault).isDirectory()) {
    return { error: `Vault-Pfad ist kein Ordner: ${vault}` }
  }
  if (detectMultipleVaults(vault)) {
    return { error: `Pfad enthält mehrere Vaults — bitte den konkreten Vault auswählen, nicht den Parent-Ordner: ${vault}` }
  }
  return { ok: true, root: resolve(vault) }
}

function safePath(root, rel) {
  // Verhindert Path-Traversal aus dem Vault
  const abs = resolve(root, rel)
  if (!abs.startsWith(root + sep) && abs !== root) return null
  return abs
}

function* walk(root, dir = root, depth = 0) {
  if (depth > 10) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) }
  catch { return }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(root, full, depth + 1)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

function isMarkdown(path) {
  const lower = path.toLowerCase()
  return MD_EXTS.some(ext => lower.endsWith(ext))
}

function searchVault(root, query, maxResults) {
  // Mindestlänge 3 – sonst matchen Stoppwörter wie "be", "of", "ist" überall
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3)
  if (tokens.length === 0) return []

  const hits = []
  let scanned = 0
  for (const file of walk(root)) {
    if (scanned >= MAX_FILES) break
    if (!isMarkdown(file)) continue
    scanned++
    let stat
    try { stat = statSync(file) } catch { continue }
    if (stat.size > MAX_SIZE) continue

    let content
    try { content = readFileSync(file, 'utf8') } catch { continue }
    const lower = content.toLowerCase()
    const fileBase = basename(file).toLowerCase()

    // Scoring
    let score = 0
    for (const tok of tokens) {
      if (fileBase.includes(tok)) score += 5     // Title-match wertvoll
      const occurrences = countOccurrences(lower, tok)
      score += occurrences
    }
    if (score === 0) continue

    // Snippet rund um den ersten Treffer extrahieren
    const lines = content.split('\n')
    let firstHitLine = lines.findIndex(l => tokens.some(t => l.toLowerCase().includes(t)))
    if (firstHitLine < 0) firstHitLine = 0
    const start = Math.max(0, firstHitLine - 1)
    const end   = Math.min(lines.length, start + MAX_SNIPPET_LINES)
    const snippet = lines.slice(start, end).join('\n').trim()

    hits.push({
      path: relative(root, file),
      score,
      snippet: snippet.slice(0, 600)
    })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, maxResults).map(h => ({ path: h.path, snippet: h.snippet }))
}

function countOccurrences(text, needle) {
  if (!needle) return 0
  let n = 0, i = 0
  while ((i = text.indexOf(needle, i)) !== -1) { n++; i += needle.length }
  return n
}

function listFolders(root) {
  const folders = []
  for (const file of walk(root)) {
    const rel = relative(root, file)
    const folder = dirname(rel)
    if (folder !== '.' && !folders.includes(folder)) folders.push(folder)
  }
  return folders.sort().slice(0, 200)
}
