import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  slugifyTopic, formatSnippets, buildBriefingFrontmatter, buildBriefingContent,
  uniqueBriefingPath, extractEntityCandidate, entityExistsInInventory,
  createResearcherFirmaStub, checkBriefingRelevance
} from '../_agents/researcher.js'

describe('Researcher — pure helpers', () => {
  describe('slugifyTopic', () => {
    it('lowercases + replaces umlauts', () => {
      expect(slugifyTopic('Künstliche Intelligenz')).toBe('kuenstliche-intelligenz')
    })
    it('strips special characters', () => {
      expect(slugifyTopic('OpenAI vs Anthropic: Wer gewinnt?')).toBe('openai-vs-anthropic-wer-gewinnt')
    })
    it('caps at 60 chars', () => {
      expect(slugifyTopic('x'.repeat(100)).length).toBeLessThanOrEqual(60)
    })
    it('falls back to "briefing" for empty', () => {
      expect(slugifyTopic('')).toBe('briefing')
      expect(slugifyTopic(null)).toBe('briefing')
      expect(slugifyTopic('???')).toBe('briefing')
    })
    it('handles ß correctly', () => {
      expect(slugifyTopic('Straße')).toBe('strasse')
    })
  })

  describe('formatSnippets', () => {
    it('formats results with index, title, url, content', () => {
      const out = formatSnippets([
        { title: 'A', url: 'https://a.com', content: 'snippet A' },
        { title: 'B', url: 'https://b.com', content: 'snippet B' }
      ])
      expect(out).toContain('[1] A')
      expect(out).toContain('URL: https://a.com')
      expect(out).toContain('snippet A')
      expect(out).toContain('[2] B')
    })
    it('handles missing title gracefully', () => {
      const out = formatSnippets([{ url: 'x', content: 'c' }])
      expect(out).toContain('(ohne Titel)')
    })
    it('returns empty string for empty input', () => {
      expect(formatSnippets([])).toBe('')
      expect(formatSnippets(null)).toBe('')
    })
  })

  describe('buildBriefingFrontmatter', () => {
    it('includes topic + sources + tags', () => {
      const fm = buildBriefingFrontmatter('Anthropic', ['https://a.com', 'https://b.com'])
      expect(fm).toContain('title: "Briefing: Anthropic"')
      expect(fm).toContain('topic: "Anthropic"')
      expect(fm).toContain('"https://a.com"')
      expect(fm).toContain('tags: [briefing, vinci-agent]')
      expect(fm).toContain('source: vinci-researcher')
    })
    it('escapes special chars in title via JSON.stringify', () => {
      const fm = buildBriefingFrontmatter('foo "bar" baz', [])
      expect(fm).toContain('Briefing: foo \\"bar\\" baz')
    })
  })

  describe('buildBriefingContent', () => {
    it('combines frontmatter + briefing + sources', () => {
      const out = buildBriefingContent({
        topic: 'Test',
        briefing: '# Test\n\nBody',
        sources: ['https://a.com']
      })
      expect(out).toMatch(/^---\n/)
      expect(out).toContain('# Test')
      expect(out).toContain('Body')
      expect(out).toContain('## Recherche-Quellen')
      expect(out).toContain('1. https://a.com')
    })
    it('skips source-list when empty', () => {
      const out = buildBriefingContent({ topic: 'T', briefing: 'B', sources: [] })
      expect(out).not.toContain('## Recherche-Quellen')
    })
    it('trims briefing', () => {
      const out = buildBriefingContent({ topic: 'T', briefing: '\n\nHello\n\n', sources: [] })
      expect(out).toContain('Hello')
    })
  })

  describe('uniqueBriefingPath', () => {
    const DIR = join(tmpdir(), 'vinci-researcher-test-unique')
    beforeEach(() => { rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true }) })
    afterEach(() => rmSync(DIR, { recursive: true, force: true }))

    it('returns base path when no conflict', () => {
      const p = uniqueBriefingPath(DIR, '2026-05-10', 'topic')
      expect(p.endsWith('2026-05-10-topic.md')).toBe(true)
    })

    it('suffixes -1, -2, … when path exists', () => {
      writeFileSync(join(DIR, '2026-05-10-topic.md'), 'x')
      const p1 = uniqueBriefingPath(DIR, '2026-05-10', 'topic')
      expect(p1.endsWith('2026-05-10-topic-1.md')).toBe(true)
      writeFileSync(p1, 'x')
      const p2 = uniqueBriefingPath(DIR, '2026-05-10', 'topic')
      expect(p2.endsWith('2026-05-10-topic-2.md')).toBe(true)
    })
  })
})

describe('Researcher — extractEntityCandidate', () => {
  it('extracts brand-like name from topic with trailing modifier', () => {
    expect(extractEntityCandidate('Mistral AI Strategie 2026')).toBe('Mistral AI')
    expect(extractEntityCandidate('Apple AI 2026')).toBe('Apple AI')
    expect(extractEntityCandidate('Sam Altman Pläne')).toBe('Sam Altman')
  })
  it('stops at year/number tokens', () => {
    expect(extractEntityCandidate('Anthropic 2026')).toBe('Anthropic')
  })
  it('stops at "vs"/"und"/"oder"/"gegen"', () => {
    expect(extractEntityCandidate('OpenAI vs Anthropic')).toBe('OpenAI')
    expect(extractEntityCandidate('Apple und Microsoft')).toBe('Apple')
  })
  it('stops when next token is lowercase', () => {
    expect(extractEntityCandidate('Apple legt zu')).toBe('Apple')
  })
  it('returns null when first token is stopword', () => {
    expect(extractEntityCandidate('Was tut sich bei Apple')).toBeNull()
    expect(extractEntityCandidate('Aber Mistral')).toBeNull()
  })
  it('returns null for empty / lowercase-only / too-short', () => {
    expect(extractEntityCandidate('')).toBeNull()
    expect(extractEntityCandidate('news today')).toBeNull()
    expect(extractEntityCandidate('AI')).toBeNull()   // < 3 chars
  })
  it('caps at 3 tokens', () => {
    expect(extractEntityCandidate('Sony DADC Salzburg Werk')).toBe('Sony DADC Salzburg')
  })
})

describe('Researcher — entityExistsInInventory', () => {
  const inv = [
    { canonical: 'Apple' },
    { canonical: 'Mistral AI' },
    { canonical: 'OpenAI' }
  ]
  it('matches case-insensitive exact', () => {
    expect(entityExistsInInventory('apple', inv)).toBe(true)
    expect(entityExistsInInventory('OPENAI', inv)).toBe(true)
  })
  it('matches via substring in both directions (Mistral ↔ Mistral AI)', () => {
    expect(entityExistsInInventory('Mistral', inv)).toBe(true)         // existing longer
    expect(entityExistsInInventory('Mistral AI Labs', inv)).toBe(true) // candidate longer
  })
  it('returns false for unknown', () => {
    expect(entityExistsInInventory('Microsoft', inv)).toBe(false)
  })
  it('handles empty inventory gracefully', () => {
    expect(entityExistsInInventory('Apple', [])).toBe(false)
    expect(entityExistsInInventory('Apple', null)).toBe(false)
  })
})

describe('Researcher — createResearcherFirmaStub', () => {
  const VAULT = join(tmpdir(), 'vinci-researcher-stub-test')
  beforeEach(() => {
    rmSync(VAULT, { recursive: true, force: true })
    mkdirSync(VAULT, { recursive: true })
  })
  afterEach(() => rmSync(VAULT, { recursive: true, force: true }))

  it('creates a Firmen-Stub with provenance: researcher (not auto_created)', () => {
    const r = createResearcherFirmaStub(VAULT, 'Mistral AI', '2026-05-19-mistral-ai-strategie')
    expect(r.created).toBe(true)
    expect(r.path).toContain('Firmen/Mistral AI.md')
    const content = readFileSync(r.path, 'utf8')
    expect(content).toContain('provenance: researcher')
    expect(content).not.toContain('auto_created: true')
    expect(content).toContain('# Mistral AI')
    expect(content).toContain('Erwähnt in [[2026-05-19-mistral-ai-strategie]]')
  })

  it('does not overwrite existing file', () => {
    mkdirSync(join(VAULT, 'VINCI/Firmen'), { recursive: true })
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'), 'EXISTING CONTENT')
    const r = createResearcherFirmaStub(VAULT, 'Apple', 'briefing')
    expect(r.created).toBe(false)
    expect(r.reason).toBe('exists')
    expect(readFileSync(r.path, 'utf8')).toBe('EXISTING CONTENT')
  })
})

describe('Researcher — checkBriefingRelevance', () => {
  it('erkennt "keine Informationen zu X"', () => {
    const md = `## Kurzfassung
Es gibt keine Informationen zu Midjourney V8 in den bereitgestellten Quellen.

## Kernpunkte
- V8-Motoren in Hypercars`
    const r = checkBriefingRelevance(md, 'Midjourney V8')
    expect(r.relevant).toBe(false)
    expect(r.reason).toMatch(/keine treffer|midjourney/i)
  })

  it('erkennt "nicht in den vorliegenden Quellen"', () => {
    const md = 'Die Inhalte sind nicht in den vorliegenden Quellen enthalten.'
    expect(checkBriefingRelevance(md, 'foo').relevant).toBe(false)
  })

  it('erkennt off-topic durch fehlende Topic-Erwähnung', () => {
    const md = '# Apple Aktienkurs steigt\n\nGuter Bericht über Aktien.'
    expect(checkBriefingRelevance(md, 'Microsoft Cloud').relevant).toBe(false)
  })

  it('akzeptiert relevantes Briefing das Topic erwähnt', () => {
    const md = `## Kurzfassung
Anthropic hat das neue Modell Claude 4.5 vorgestellt.

## Kernpunkte
- Anthropic verfolgt Constitutional AI weiterhin`
    expect(checkBriefingRelevance(md, 'Anthropic').relevant).toBe(true)
  })

  it('akzeptiert Briefing mit teilweisem Token-Match', () => {
    const md = 'Anthropic hat etwas Neues released.'
    expect(checkBriefingRelevance(md, 'Anthropic AI 2026').relevant).toBe(true)
  })

  it('rejected leeren Text', () => {
    expect(checkBriefingRelevance('', 'X').relevant).toBe(false)
    expect(checkBriefingRelevance(null, 'X').relevant).toBe(false)
  })

  it('akzeptiert kurze Topics ohne Token-Check', () => {
    // Topic <= 4 chars wird nicht token-checked weil zu wenig discriminierend
    const md = 'Andere Inhalte ohne Match'
    expect(checkBriefingRelevance(md, 'IBM').relevant).toBe(true)
  })
})

describe('Researcher — agent registration', () => {
  it('registers the researcher agent on import', async () => {
    await import('../_agents/researcher.js')
    const { listAgents } = await import('../_subAgents.js')
    expect(listAgents().find(a => a.name === 'researcher')).toBeDefined()
  })
})
