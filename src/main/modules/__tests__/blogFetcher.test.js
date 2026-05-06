import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { fetchPostsSince } from '../blogImporter.js'

let mock
beforeEach(() => { mock = new MockAdapter(axios) })
afterEach(() => mock.restore())

describe('fetchPostsSince', () => {
  it('paginates and stops when totalpages reached', async () => {
    mock.onGet(/\/wp-json\/wp\/v2\/posts/).reply((cfg) => {
      const page = parseInt(cfg.params?.page || '1')
      const headers = { 'x-wp-totalpages': '2' }
      if (page === 1) return [200, [
        { id: 1, slug: 'a', date: '2026-05-01T00:00:00', modified: '2026-05-01T00:00:00', title: { rendered: 'A' }, content: { rendered: '<p>a</p>' }, link: 'https://x/a', categories: [], tags: [] },
        { id: 2, slug: 'b', date: '2026-05-02T00:00:00', modified: '2026-05-02T00:00:00', title: { rendered: 'B' }, content: { rendered: '<p>b</p>' }, link: 'https://x/b', categories: [], tags: [] }
      ], headers]
      return [200, [
        { id: 3, slug: 'c', date: '2026-05-03T00:00:00', modified: '2026-05-03T00:00:00', title: { rendered: 'C' }, content: { rendered: '<p>c</p>' }, link: 'https://x/c', categories: [], tags: [] }
      ], headers]
    })
    const posts = await fetchPostsSince({ baseUrl: 'https://x.com', type: 'wordpress' }, null)
    expect(posts).toHaveLength(3)
  })

  it('filters by sinceIso (returns only posts newer than cursor)', async () => {
    mock.onGet(/posts/).reply(200, [
      { id: 1, slug: 'old', date: '2026-04-01T00:00:00', modified: '2026-04-01T00:00:00', title: { rendered: 'Old' }, content: { rendered: '' }, link: '', categories: [], tags: [] },
      { id: 2, slug: 'new', date: '2026-05-05T00:00:00', modified: '2026-05-05T00:00:00', title: { rendered: 'New' }, content: { rendered: '' }, link: '', categories: [], tags: [] }
    ], { 'x-wp-totalpages': '1' })
    const posts = await fetchPostsSince({ baseUrl: 'https://x.com', type: 'wordpress' }, '2026-05-01T00:00:00Z')
    expect(posts).toHaveLength(1)
    expect(posts[0].slug).toBe('new')
  })

  it('returns empty array if response is empty', async () => {
    mock.onGet(/posts/).reply(200, [], { 'x-wp-totalpages': '1' })
    const posts = await fetchPostsSince({ baseUrl: 'https://x.com', type: 'wordpress' }, null)
    expect(posts).toEqual([])
  })
})

import { readVaultCursor } from '../blogImporter.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join as joinP } from 'path'
import { tmpdir } from 'os'

const D = joinP(tmpdir(), 'vinci-cursor-test')

describe('readVaultCursor', () => {
  beforeEach(() => { rmSync(D, { recursive: true, force: true }); mkdirSync(D, { recursive: true }) })
  afterEach(() => rmSync(D, { recursive: true, force: true }))

  it('returns null for empty folder', () => {
    expect(readVaultCursor(D)).toBeNull()
  })
  it('returns null for non-existent folder', () => {
    expect(readVaultCursor(joinP(D, 'nope'))).toBeNull()
  })
  it('returns max published from frontmatter', () => {
    writeFileSync(joinP(D, 'a.md'), '---\npublished: "2026-04-01T00:00:00Z"\n---\n')
    writeFileSync(joinP(D, 'b.md'), '---\npublished: "2026-05-05T12:00:00Z"\n---\n')
    writeFileSync(joinP(D, 'c.md'), '---\npublished: "2026-04-15T00:00:00Z"\n---\n')
    expect(readVaultCursor(D)).toBe('2026-05-05T12:00:00Z')
  })
  it('handles posts with single-quoted yaml', () => {
    writeFileSync(joinP(D, 'a.md'), "---\npublished: '2026-04-01T00:00:00Z'\n---\n")
    expect(readVaultCursor(D)).toBe('2026-04-01T00:00:00Z')
  })
})
