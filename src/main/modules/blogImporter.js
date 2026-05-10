import axios from 'axios'
import TurndownService from 'turndown'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { loadEntityInventory, processPostFile, appendBacklinkBullet, detectAutoFirmaCandidates, createAutoFirmaStub } from './_wikilinkEngine.js'

export async function fetchPostsSince(source, sinceIso) {
  const all = []
  let page = 1
  let totalPages = 1
  while (page <= totalPages) {
    const url = `${source.baseUrl}/wp-json/wp/v2/posts`
    const params = {
      per_page: 100, orderby: 'date', order: 'desc', page,
      _fields: 'id,date,modified,slug,link,title,content,excerpt,categories,tags,featured_media'
    }
    const res = await axios.get(url, { params, timeout: 30_000 })
    totalPages = parseInt(res.headers['x-wp-totalpages'] || '1')
    for (const p of res.data) {
      if (sinceIso && new Date(p.date) <= new Date(sinceIso)) continue
      all.push(p)
    }
    page++
  }
  return all
}

export function readVaultCursor(folder) {
  if (!existsSync(folder)) return null
  let max = null
  let files
  try { files = readdirSync(folder) } catch { return null }
  for (const f of files) {
    if (!f.endsWith('.md')) continue
    let head
    try { head = readFileSync(join(folder, f), 'utf8').slice(0, 2000) } catch { continue }
    const m = head.match(/^published:\s*["']?([^"'\n]+)["']?/m)
    if (m) {
      const val = m[1].trim()
      if (!max || new Date(val) > new Date(max)) max = val
    }
  }
  return max
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '_' })

function decodeEntities(s) {
  if (!s) return ''
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&uuml;/g, 'ü').replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö')
    .replace(/&Uuml;/g, 'Ü').replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö')
    .replace(/&szlig;/g, 'ß').replace(/&nbsp;/g, ' ')
}

export function htmlToMarkdown(html) {
  if (!html) return ''
  const cleaned = String(html)
    .replace(/\[caption[^\]]*\]/g, '')
    .replace(/\[\/caption\]/g, '')
  const md = turndown.turndown(cleaned)
  return decodeEntities(md)
}

function formatGermanDate(iso) {
  const d = new Date(iso)
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
  return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`
}

function ensureZ(iso) {
  if (!iso) return ''
  return /Z$/.test(iso) ? iso : iso + 'Z'
}

export function buildPostFile(post, source, taxonomy = { categories: {}, tags: {} }) {
  const title = decodeEntities(post.title?.rendered || '')
  const slug = post.slug
  const url = post.link || ''
  const published = ensureZ(post.date)
  const modified  = ensureZ(post.modified || post.date)
  const cats = (post.categories || []).map(id => taxonomy.categories[id] || `cat-${id}`)
  const tags = (post.tags || []).map(id => taxonomy.tags[id] || `tag-${id}`)
  const allTags = ['rss', 'auto-import', source.id, ...tags]
  const body = htmlToMarkdown(post.content?.rendered || '')

  let host = ''
  try { host = new URL(url).hostname } catch { host = source.baseUrl.replace(/^https?:\/\//, '') }

  const fm = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `source: "${host}"`,
    `url: "${url}"`,
    `slug: "${slug}"`,
    `wp_id: ${post.id}`,
    `published: "${published}"`,
    `modified: "${modified}"`,
    `published_formatted: "${formatGermanDate(published)}"`,
    `fetched: "${new Date().toISOString()}"`,
    `tags: [${allTags.map(t => JSON.stringify(t)).join(', ')}]`,
    `categories: [${cats.map(c => JSON.stringify(c)).join(', ')}]`,
    `author: "${source.authorWikilink}"`,
    `mentions: []`,
    '---'
  ].join('\n')

  const content = `${fm}\n\n# ${title}\n\n**Quelle:** [${host}](${url})\n**Veröffentlicht:** ${formatGermanDate(published)}\n\n${body}\n`
  return { filename: `${slug}.md`, content }
}

async function fetchTaxonomy(source) {
  const out = { categories: {}, tags: {} }
  for (const kind of ['categories', 'tags']) {
    let page = 1, totalPages = 1
    while (page <= totalPages) {
      try {
        const res = await axios.get(`${source.baseUrl}/wp-json/wp/v2/${kind}`, {
          params: { per_page: 100, page, _fields: 'id,slug,name' }, timeout: 20_000
        })
        totalPages = parseInt(res.headers['x-wp-totalpages'] || '1')
        for (const t of res.data) out[kind][t.id] = t.slug
        page++
      } catch (err) {
        console.warn(`[Blog] taxonomy ${kind} fetch failed:`, err.message)
        break
      }
    }
  }
  return out
}

export async function runOnce(source, vaultPath, { force = false, dryRun = false } = {}) {
  if (!source) return { error: 'No source given' }
  if (!vaultPath) return { error: 'No vaultPath' }
  const folder = join(vaultPath, source.vaultFolder)
  mkdirSync(folder, { recursive: true })
  const cursor = force ? null : readVaultCursor(folder)
  const taxonomy = await fetchTaxonomy(source)
  const posts = await fetchPostsSince(source, cursor)

  const result = {
    source: source.id,
    cursor,
    fetched: posts.length,
    newly_created: 0,
    updated: 0,
    skipped_unchanged: 0,
    errors: [],
    newest_post: null,
    dryRun
  }

  let newest = null
  for (const p of posts) {
    try {
      const { filename, content } = buildPostFile(p, source, taxonomy)
      const target = join(folder, filename)
      if (existsSync(target)) {
        const head = readFileSync(target, 'utf8').slice(0, 2000)
        const m = head.match(/^modified:\s*["']?([^"'\n]+)["']?/m)
        const localModified = m ? m[1].trim() : null
        if (localModified && new Date(p.modified) <= new Date(localModified) && !force) {
          result.skipped_unchanged++
          continue
        }
        if (!dryRun) writeFileSync(target, content, 'utf8')
        result.updated++
      } else {
        if (!dryRun) writeFileSync(target, content, 'utf8')
        result.newly_created++
      }
      if (!newest || new Date(p.date) > new Date(newest.date)) newest = p
    } catch (err) {
      result.errors.push({ slug: p.slug, error: err.message })
    }
  }
  // Body wikilink pass over the folder + auto-firma detection
  if (!dryRun) {
    try {
      const inventory = loadEntityInventory(vaultPath)
      const known = new Set(inventory.map(e => e.term.toLowerCase()))
      const processed = []
      for (const f of readdirSync(folder).filter(x => x.endsWith('.md'))) {
        const path = join(folder, f)
        let original
        try { original = readFileSync(path, 'utf8') } catch { continue }
        const { content, changed, mentions } = processPostFile(original, inventory)
        if (changed) writeFileSync(path, content, 'utf8')
        processed.push({ slug: f.replace(/\.md$/, ''), body: content })
        for (const m of mentions) {
          const canonical = m.replace(/^\[\[|\]\]$/g, '').split('|')[0]
          const ie = inventory.find(i => i.canonical === canonical)
          if (ie?.category && ie.category !== 'alias') {
            appendBacklinkBullet(vaultPath, canonical, ie.category, f.replace(/\.md$/, ''))
          }
        }
      }
      // Threshold 4: weniger Fehlalarme aus deutschem Allgemeinwortschatz.
      // Echte Firmen (Anthropic, Mistral, …) tauchen meist in deutlich mehr Posts auf.
      const candidates = detectAutoFirmaCandidates(processed, known, 4)
      let stubCount = 0
      for (const [name, slugs] of candidates) {
        if (createAutoFirmaStub(vaultPath, name, slugs)) stubCount++
      }
      result.auto_firma_created = stubCount
    } catch (err) {
      result.errors.push({ phase: 'body-pass', error: err.message })
    }
  }

  if (newest) result.newest_post = decodeEntities(newest.title?.rendered || '')
  return result
}

export const blogImporterModule = {
  name: 'blog',
  description: 'Blog-Posts via WordPress-REST in den Vault holen.',
  actions: {
    sync: async ({ sourceId, force = false } = {}, ctx) => {
      const sources = ctx?.settings?.blogSources || []
      const source = sourceId
        ? sources.find(s => s.id === sourceId)
        : sources.find(s => s.enabled)
      if (!source) return { error: 'Keine Blog-Source konfiguriert.' }
      const vault = ctx?.settings?.obsidian?.vaultPath
      if (!vault) return { error: 'Kein Vault.' }
      return await runOnce(source, vault, { force })
    }
  },
  tools: [{
    name: 'blog_sync',
    description: 'Holt neue Blog-Posts von der konfigurierten WordPress-Quelle (Default: digitalhandwerk) per REST in den Vault. Idempotent — vorhandene Posts werden übersprungen, Updates überschrieben. Trigger: "sync blog", "hol meine artikel", "blog aktualisieren", "neue posts ziehen", "lad meine blogposts".',
    parameters: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Optional: Source-ID (Default: erste enabled).' },
        force:    { type: 'boolean', description: 'true = ALLE Posts neu ziehen, nicht nur Delta.' }
      }
    }
  }]
}
