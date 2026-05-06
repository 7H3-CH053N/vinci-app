import { describe, it, expect } from 'vitest'
import { htmlToMarkdown, buildPostFile } from '../blogImporter.js'

describe('htmlToMarkdown', () => {
  it('converts headings and emphasis', () => {
    const md = htmlToMarkdown('<h2>Title</h2><p>Hello <b>world</b>.</p>')
    expect(md).toContain('## Title')
    expect(md).toContain('**world**')
  })
  it('strips WP caption shortcodes', () => {
    const md = htmlToMarkdown('[caption id="x"]<img src="a.jpg"/> Bild[/caption]')
    expect(md).not.toContain('[caption')
    expect(md).not.toContain('[/caption]')
    expect(md).toContain('a.jpg')
  })
  it('decodes common HTML entities', () => {
    expect(htmlToMarkdown('<p>Tom &amp; Jerry</p>')).toContain('Tom & Jerry')
    expect(htmlToMarkdown('<p>&uuml;ber</p>')).toContain('über')
  })
  it('returns empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('')
    expect(htmlToMarkdown(null)).toBe('')
  })
})

describe('buildPostFile', () => {
  const sourceCfg = { id: 'digitalhandwerk', baseUrl: 'https://digitalhandwerk.rocks', authorWikilink: '[[Alex Januschewsky]]' }
  const samplePost = {
    id: 9965,
    slug: '500-artikel',
    date: '2026-05-06T14:33:51',
    modified: '2026-05-06T14:33:51',
    title: { rendered: '500 Artikel' },
    content: { rendered: '<p>Body</p>' },
    link: 'https://digitalhandwerk.rocks/500-artikel/',
    categories: [], tags: []
  }
  it('produces filename based on slug', () => {
    const r = buildPostFile(samplePost, sourceCfg, { categories: {}, tags: {} })
    expect(r.filename).toBe('500-artikel.md')
  })
  it('includes required frontmatter fields', () => {
    const r = buildPostFile(samplePost, sourceCfg, { categories: {}, tags: {} })
    expect(r.content).toContain('wp_id: 9965')
    expect(r.content).toContain('author: "[[Alex Januschewsky]]"')
    expect(r.content).toContain('slug: "500-artikel"')
    expect(r.content).toContain('source: "digitalhandwerk.rocks"')
  })
  it('renders title as H1', () => {
    const r = buildPostFile(samplePost, sourceCfg, { categories: {}, tags: {} })
    expect(r.content).toContain('# 500 Artikel')
  })
  it('decodes title entities', () => {
    const post = { ...samplePost, title: { rendered: 'Tom &amp; Jerry' } }
    const r = buildPostFile(post, sourceCfg, { categories: {}, tags: {} })
    expect(r.content).toContain('"Tom & Jerry"')
    expect(r.content).toContain('# Tom & Jerry')
  })
  it('maps category and tag IDs through taxonomy', () => {
    const post = { ...samplePost, categories: [42], tags: [13, 7] }
    const taxonomy = { categories: { 42: 'persoenliches' }, tags: { 13: 'ki', 7: 'chatgpt' } }
    const r = buildPostFile(post, sourceCfg, taxonomy)
    expect(r.content).toContain('"persoenliches"')
    expect(r.content).toContain('"ki"')
    expect(r.content).toContain('"chatgpt"')
  })
})
