import axios from 'axios'
import TurndownService from 'turndown'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

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

// Implemented in Task 6.4
export function htmlToMarkdown(html) {
  throw new Error('not implemented')
}
export function buildPostFile(post, source, taxonomy) {
  throw new Error('not implemented')
}

// Implemented in Task 6.5
export async function runOnce(source, vaultPath, opts = {}) {
  throw new Error('not implemented')
}

// Module + tool — Task 6.6
export const blogImporterModule = null
