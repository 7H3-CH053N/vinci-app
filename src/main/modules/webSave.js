// Helpers for the web_saveToVault tool. Implementation lives here; the tool itself
import { localISOString, localDateString } from './_localTime.js'
// is registered as part of the existing webModule in web.js.

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import {
  loadEntityInventory,
  processPostFile,
  appendBacklinkBullet
} from './_wikilinkEngine.js'

export function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'untitled'
}

export function germanDate(iso) {
  const d = new Date(iso)
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
  return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`
}

function uniquePath(dir, baseName) {
  let p = join(dir, `${baseName}.md`)
  let n = 2
  while (existsSync(p)) {
    p = join(dir, `${baseName}-${n}.md`)
    n++
    if (n > 99) throw new Error('Too many notes with the same title today.')
  }
  return p
}

export async function saveToVaultImpl(params, ctx) {
  const { title, summary, sources = [], keyPoints = [] } = params || {}
  const vault = ctx?.settings?.obsidian?.vaultPath
  if (!vault) return { error: 'Kein Vault.' }
  if (!title || !summary || !Array.isArray(sources) || sources.length === 0) {
    return { error: 'title, summary und mindestens eine source sind nötig.' }
  }

  const date = localDateString()
  const slug = slugify(title)
  const dir = join(vault, 'inbox', 'web')
  mkdirSync(dir, { recursive: true })
  const baseName = `${date} – ${slug}`
  const path = uniquePath(dir, baseName)
  const finalSlug = basename(path).replace(/\.md$/, '')

  const fmLines = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `source: web`,
    'sources:',
    ...sources.map(u => `  - ${JSON.stringify(u)}`),
    `fetched: "${localISOString()}"`,
    `tags: [web-import, inbox]`,
    `status: zu-sichten`,
    `mentions: []`,
    '---'
  ]

  const sourceLinks = sources.map((u, i) => {
    let host = ''
    try { host = new URL(u).hostname.replace(/^www\./, '') } catch { host = u }
    return `${i + 1}. [${host}](${u})`
  })

  const keyPointsBlock = keyPoints.length
    ? `## Kernaussagen\n${keyPoints.map(k => `- ${k}`).join('\n')}\n\n`
    : ''

  const body = [
    `# ${title}`,
    '',
    `> Recherchiert von VINCI am ${germanDate(date)} aus ${sources.length} Quelle${sources.length === 1 ? '' : 'n'}.`,
    '',
    '## Zusammenfassung',
    summary,
    '',
    keyPointsBlock + '## Quellen',
    sourceLinks.join('\n'),
    ''
  ].join('\n')

  let content = `${fmLines.join('\n')}\n\n${body}`

  // Apply wikilink pass + frontmatter mentions update
  const inv = loadEntityInventory(vault)
  const processed = processPostFile(content, inv)
  writeFileSync(path, processed.content, 'utf8')

  // Backlinks in entity notes (best-effort)
  let backlinkCount = 0
  for (const m of processed.mentions || []) {
    const canonical = m.replace(/^\[\[|\]\]$/g, '').split('|')[0]
    const ie = inv.find(i => i.canonical === canonical)
    if (ie?.category && ie.category !== 'alias') {
      if (appendBacklinkBullet(vault, canonical, ie.category, finalSlug)) backlinkCount++
    }
  }

  const relPath = path.startsWith(vault + '/') ? path.slice(vault.length + 1) : path
  return {
    ok: true,
    path: relPath,
    mentions: (processed.mentions || []).length,
    backlinks_added: backlinkCount
  }
}
