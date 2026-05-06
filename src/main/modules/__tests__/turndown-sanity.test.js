import { describe, it, expect } from 'vitest'
import TurndownService from 'turndown'

describe('turndown', () => {
  it('converts simple HTML to Markdown', () => {
    const td = new TurndownService({ headingStyle: 'atx' })
    const md = td.turndown('<h2>Title</h2><p>Hello <b>world</b>.</p>')
    expect(md).toContain('## Title')
    expect(md).toContain('**world**')
  })
})
