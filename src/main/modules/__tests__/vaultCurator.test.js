import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  collectVaultInventory, collectPostFiles, countMentions, topMentioned,
  findOrphanEntities, findEntityGaps, findAliasCandidates,
  computeHealthStats, computeHealthScore,
  buildCuratorFrontmatter, buildCuratorDataBlock,
  buildCuratorActions, looksLikeProperNoun
} from '../_agents/vaultCurator.js'

describe('looksLikeProperNoun', () => {
  it('accept Mehrwort-Phrasen', () => {
    expect(looksLikeProperNoun('Sam Altman')).toBe(true)
    expect(looksLikeProperNoun('FC Bayern')).toBe(true)
  })
  it('accept CamelCase', () => {
    expect(looksLikeProperNoun('OpenAI')).toBe(true)
    expect(looksLikeProperNoun('ChatGPT')).toBe(true)
    expect(looksLikeProperNoun('McShark')).toBe(true)
  })
  it('accept Firma-Suffix', () => {
    expect(looksLikeProperNoun('Apple Inc')).toBe(true)
    expect(looksLikeProperNoun('SomethingGmbH')).toBe(true)
  })
  it('accept Domain', () => {
    expect(looksLikeProperNoun('digitalhandwerk.rocks')).toBe(true)
    expect(looksLikeProperNoun('futurezone.de')).toBe(true)
  })
  it('REJECT single-word deutsche Substantive', () => {
    expect(looksLikeProperNoun('Werkzeug')).toBe(false)
    expect(looksLikeProperNoun('Veröffentlicht')).toBe(false)
    expect(looksLikeProperNoun('Realität')).toBe(false)
    expect(looksLikeProperNoun('Marketing')).toBe(false)
    expect(looksLikeProperNoun('Kontext')).toBe(false)
    expect(looksLikeProperNoun('Hier')).toBe(false)
    expect(looksLikeProperNoun('Alles')).toBe(false)
  })
  it('REJECT zu kurz', () => {
    expect(looksLikeProperNoun('AI')).toBe(false)
    expect(looksLikeProperNoun('ab')).toBe(false)
  })
})

const VAULT = join(tmpdir(), 'vinci-curator-test')

beforeEach(() => {
  rmSync(VAULT, { recursive: true, force: true })
  for (const cat of ['Personen', 'Firmen', 'Themen', 'Orte', 'Tiere', 'Quellen']) {
    mkdirSync(join(VAULT, 'VINCI', cat), { recursive: true })
  }
  mkdirSync(join(VAULT, 'RSS/digitalhandwerk'), { recursive: true })
})
afterEach(() => rmSync(VAULT, { recursive: true, force: true }))

describe('VaultCurator — collectVaultInventory', () => {
  it('sammelt Entities aus allen 6 Kategorien mit Metadata', () => {
    writeFileSync(join(VAULT, 'VINCI/Personen/Alex.md'), '---\n---\n# Alex')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'), '---\n---\n# Apple')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Mistral AI.md'), '---\nprovenance: researcher\n---\n# Mistral')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Aber.md'), '---\nauto_created: true\n---\n# Aber')
    const inv = collectVaultInventory(VAULT)
    expect(inv.length).toBe(4)
    expect(inv.find(e => e.name === 'Mistral AI')?.provenance).toBe('researcher')
    expect(inv.find(e => e.name === 'Aber')?.autoCreated).toBe(true)
    expect(inv.find(e => e.name === 'Alex')?.category).toBe('Personen')
  })

  it('handle leeren Vault', () => {
    expect(collectVaultInventory(VAULT)).toEqual([])
  })
})

describe('VaultCurator — countMentions', () => {
  it('zählt Wikilinks zu bekannten Entities pro Post (jeden 1×/Post)', () => {
    writeFileSync(join(VAULT, 'VINCI/Personen/Alex.md'), 'x')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'), 'x')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p1.md'),
      '[[Alex]] schreibt über [[Apple]]. [[Alex]] sagt mehr.')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p2.md'), '[[Apple]] und [[Apple]]')
    const inv = collectVaultInventory(VAULT)
    const posts = collectPostFiles(VAULT)
    const counts = countMentions(inv, posts)
    expect(counts.get('alex')).toBe(1)    // einmal in p1 (auch wenn 2× drin)
    expect(counts.get('apple')).toBe(2)   // einmal in p1, einmal in p2
  })

  it('ignoriert Wikilinks zu unbekannten Entities', () => {
    writeFileSync(join(VAULT, 'VINCI/Personen/Alex.md'), 'x')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p.md'), '[[Alex]] und [[Unbekannt]]')
    const counts = countMentions(collectVaultInventory(VAULT), collectPostFiles(VAULT))
    expect(counts.get('alex')).toBe(1)
    expect(counts.has('unbekannt')).toBe(false)
  })

  it('case-insensitive matching', () => {
    writeFileSync(join(VAULT, 'VINCI/Firmen/OpenAI.md'), 'x')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p.md'), '[[openai]] und [[OPENAI]]')
    const counts = countMentions(collectVaultInventory(VAULT), collectPostFiles(VAULT))
    expect(counts.get('openai')).toBe(1)
  })

  it('REGRESSION: Cross-Mentions zwischen Entity-Notes werden gezählt', () => {
    // Bug der gefangen wurde: Birgit Januschewsky war nur in Alex.md erwähnt,
    // wurde aber als Orphan klassifiziert weil Entity-Notes nicht gescannt wurden.
    writeFileSync(join(VAULT, 'VINCI/Personen/Alex Januschewsky.md'),
      '# Alex Januschewsky\n\n- Ehefrau: [[Birgit Januschewsky]]\n- Sohn: [[Julian Januschewsky]]')
    writeFileSync(join(VAULT, 'VINCI/Personen/Birgit Januschewsky.md'), '# Birgit Januschewsky')
    writeFileSync(join(VAULT, 'VINCI/Personen/Julian Januschewsky.md'), '# Julian Januschewsky')
    const inv = collectVaultInventory(VAULT)
    const counts = countMentions(inv, collectPostFiles(VAULT))
    expect(counts.get('birgit januschewsky')).toBe(1)
    expect(counts.get('julian januschewsky')).toBe(1)
    // Alex selbst NICHT als Self-Mention zählen (nicht in seinem eigenen File)
    expect(counts.has('alex januschewsky')).toBe(false)
  })

  it('Self-Mention (Entity erwähnt sich in eigener Note) wird nicht gezählt', () => {
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'),
      '# Apple\n\nWeitere Infos zu [[Apple]] und [[Apple]].')
    const counts = countMentions(collectVaultInventory(VAULT), collectPostFiles(VAULT))
    expect(counts.has('apple')).toBe(false)
  })

  it('REGRESSION: Plain-Text-Mention in Posts wird gezählt (digitalhandwerk-Bug)', () => {
    // "digitalhandwerk" wird in Posts als plain-text erwähnt, nicht als Wikilink.
    // Vorher fälschlich als orphan klassifiziert.
    writeFileSync(join(VAULT, 'VINCI/Themen/digitalhandwerk.md'), '# digitalhandwerk')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p1.md'),
      'Auf digitalhandwerk schreibe ich über KI.')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p2.md'),
      'Mein Blog digitalhandwerk hat einen neuen Artikel.')
    const counts = countMentions(collectVaultInventory(VAULT), collectPostFiles(VAULT))
    expect(counts.get('digitalhandwerk')).toBe(2)
  })

  it('Plain-Text-Match ignoriert Word-Mitte ("Salzburger" ≠ "Salzburg")', () => {
    writeFileSync(join(VAULT, 'VINCI/Orte/Hallein.md'), '# Hallein')
    // "Halleiner" sollte NICHT als Hallein-Mention matchen
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p.md'), 'Halleiner sind toll.')
    const counts = countMentions(collectVaultInventory(VAULT), collectPostFiles(VAULT))
    expect(counts.get('hallein') || 0).toBe(0)
  })

  it('Plain-Text-Match nur in Posts, NICHT in Entity-Notes', () => {
    // Diese Trennung verhindert dass Personen.md "Anthropic" plain erwähnt
    // und dann Anthropic-Counter pumpt.
    writeFileSync(join(VAULT, 'VINCI/Firmen/Anthropic.md'), 'x')
    writeFileSync(join(VAULT, 'VINCI/Personen/Alex.md'), 'Alex interessiert sich für Anthropic.')
    // Keine Posts mit Anthropic plain → Counter sollte 0 sein
    const counts = countMentions(collectVaultInventory(VAULT), collectPostFiles(VAULT))
    expect(counts.get('anthropic') || 0).toBe(0)
  })

  it('Plain-Text-Match skipped sehr kurze Namen (false-positive-Schutz)', () => {
    writeFileSync(join(VAULT, 'VINCI/Themen/AI.md'), 'x')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p.md'), 'AI ist überall, AI hier, AI da.')
    const counts = countMentions(collectVaultInventory(VAULT), collectPostFiles(VAULT))
    expect(counts.get('ai') || 0).toBe(0)   // < 5 chars → kein plaintext-match
  })
})

describe('VaultCurator — topMentioned + findOrphanEntities', () => {
  it('Top sortiert by mention-count desc, Orphans = 0-mentions', () => {
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'), 'x')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Google.md'), 'x')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Orphan.md'), 'x')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p1.md'), '[[Apple]] [[Google]]')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p2.md'), '[[Apple]]')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p3.md'), '[[Apple]]')
    const inv = collectVaultInventory(VAULT)
    const counts = countMentions(inv, collectPostFiles(VAULT))
    const top = topMentioned(inv, counts, 10)
    expect(top[0].name).toBe('Apple')
    expect(top[0].mentionCount).toBe(3)
    expect(top[1].name).toBe('Google')
    expect(top[1].mentionCount).toBe(1)
    const orphans = findOrphanEntities(inv, counts)
    expect(orphans.map(o => o.name)).toEqual(['Orphan'])
  })
})

describe('VaultCurator — findEntityGaps', () => {
  it('findet eigenname-artige Phrasen die häufig sind aber nicht im inventory', () => {
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'), 'x')
    // Anthropic ist CamelCase (Großbuchstabe in der Mitte) → looksLikeProperNoun = true? Nein, "Anthropic" hat nur am Anfang ein A.
    // Use multi-word zur Sicherheit
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(VAULT, `RSS/digitalhandwerk/p${i}.md`),
        `Apple und Sam Altman sind beide spannend. Plus Sam Altman nochmal.`)
    }
    const inv = collectVaultInventory(VAULT)
    const posts = collectPostFiles(VAULT)
    const gaps = findEntityGaps(inv, posts, { minOccurrences: 3 })
    expect(gaps.find(g => g.phrase === 'Sam Altman')).toBeDefined()
    expect(gaps.find(g => g.phrase === 'Apple')).toBeUndefined()  // im Inventory
  })

  it('filtert deutsche Stopwords raus (Aber, Abend, ...)', () => {
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(VAULT, `RSS/digitalhandwerk/p${i}.md`),
        'Aber das ist anders. Abend kommt früh.')
    }
    const gaps = findEntityGaps([], collectPostFiles(VAULT), { minOccurrences: 3 })
    expect(gaps.find(g => g.phrase === 'Aber')).toBeUndefined()
    expect(gaps.find(g => g.phrase === 'Abend')).toBeUndefined()
  })

  it('filtert Tech-Generika raus (Tool, Modell, Prompt, ...)', () => {
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(VAULT, `RSS/digitalhandwerk/p${i}.md`),
        'Tools sind wichtig. Modell der Wahl. Prompt-Engineering. Plattform XY.')
    }
    const gaps = findEntityGaps([], collectPostFiles(VAULT), { minOccurrences: 3 })
    expect(gaps.find(g => g.phrase === 'Tools')).toBeUndefined()
    expect(gaps.find(g => g.phrase === 'Modell')).toBeUndefined()
    expect(gaps.find(g => g.phrase === 'Prompt')).toBeUndefined()
    expect(gaps.find(g => g.phrase === 'Plattform')).toBeUndefined()
  })

  it('respektiert minOccurrences', () => {
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p1.md'), 'Mistral AI war heute spannend.')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p2.md'), 'Mistral AI schon wieder.')
    const gaps = findEntityGaps([], collectPostFiles(VAULT), { minOccurrences: 3 })
    expect(gaps.find(g => g.phrase === 'Mistral AI')).toBeUndefined()  // nur 2 Vorkommen
    const gaps2 = findEntityGaps([], collectPostFiles(VAULT), { minOccurrences: 2 })
    expect(gaps2.find(g => g.phrase === 'Mistral AI')).toBeDefined()
  })

  it('REGRESSION: filtert single-word deutsche Wörter wie "Werkzeug", "Hier", "Veröffentlicht" (looksLikeProperNoun)', () => {
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(VAULT, `RSS/digitalhandwerk/p${i}.md`),
        'Werkzeug ist wichtig. Hier ein Beispiel. Veröffentlicht am Dienstag. Kontext zählt.')
    }
    const gaps = findEntityGaps([], collectPostFiles(VAULT), { minOccurrences: 3 })
    expect(gaps.find(g => g.phrase === 'Werkzeug')).toBeUndefined()
    expect(gaps.find(g => g.phrase === 'Hier')).toBeUndefined()
    expect(gaps.find(g => g.phrase === 'Veröffentlicht')).toBeUndefined()
    expect(gaps.find(g => g.phrase === 'Kontext')).toBeUndefined()
  })

  it('akzeptiert CamelCase Eigennamen (OpenAI, ChatGPT)', () => {
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(VAULT, `RSS/digitalhandwerk/p${i}.md`),
        'OpenAI launches stuff. ChatGPT auch.')
    }
    const gaps = findEntityGaps([], collectPostFiles(VAULT), { minOccurrences: 3 })
    expect(gaps.find(g => g.phrase === 'OpenAI')).toBeDefined()
    expect(gaps.find(g => g.phrase === 'ChatGPT')).toBeDefined()
  })
})

describe('VaultCurator — findAliasCandidates', () => {
  it('findet Vorname-Vollname Pairs in derselben Kategorie', () => {
    writeFileSync(join(VAULT, 'VINCI/Personen/Alex.md'), 'x')
    writeFileSync(join(VAULT, 'VINCI/Personen/Alex Januschewsky.md'), 'x')
    const inv = collectVaultInventory(VAULT)
    const cands = findAliasCandidates(inv)
    expect(cands.find(c => c.a === 'Alex' || c.b === 'Alex')).toBeDefined()
  })

  it('findet Prefix-Überlapp (z.B. Mistral + Mistral AI)', () => {
    writeFileSync(join(VAULT, 'VINCI/Firmen/Mistral.md'), 'x')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Mistral AI.md'), 'x')
    const cands = findAliasCandidates(collectVaultInventory(VAULT))
    expect(cands.length).toBe(1)
    expect(cands[0].reason).toMatch(/Vorname|Prefix/i)
  })

  it('SCHLIESST Substring-Mitte/End-Match AUS (z.B. Salzburg + FC Red Bull Salzburg)', () => {
    writeFileSync(join(VAULT, 'VINCI/Orte/Salzburg.md'), 'x')
    mkdirSync(join(VAULT, 'VINCI/Firmen'), { recursive: true })
    writeFileSync(join(VAULT, 'VINCI/Firmen/FC Red Bull Salzburg.md'), 'x')
    // Verschiedene Kategorien sowieso, aber zur Sicherheit: gleiche Kategorie
    writeFileSync(join(VAULT, 'VINCI/Firmen/Salzburg.md'), 'x')
    const cands = findAliasCandidates(collectVaultInventory(VAULT))
    const found = cands.find(c => (c.a === 'Salzburg' && c.b.includes('FC')) || (c.b === 'Salzburg' && c.a.includes('FC')))
    expect(found).toBeUndefined()
  })

  it('keine Pairs über Kategorien hinweg', () => {
    writeFileSync(join(VAULT, 'VINCI/Personen/Apple.md'), 'x')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple Inc.md'), 'x')
    expect(findAliasCandidates(collectVaultInventory(VAULT))).toEqual([])
  })
})

describe('VaultCurator — Health-Stats + Score', () => {
  it('Stats: totalEntities, byCategory, mentionedCount, orphanRatio', () => {
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'), 'x')
    writeFileSync(join(VAULT, 'VINCI/Firmen/Orphan.md'), 'x')
    writeFileSync(join(VAULT, 'VINCI/Personen/Alex.md'), 'x')
    writeFileSync(join(VAULT, 'RSS/digitalhandwerk/p.md'), '[[Apple]] [[Alex]]')
    const inv = collectVaultInventory(VAULT)
    const posts = collectPostFiles(VAULT)
    const counts = countMentions(inv, posts)
    const s = computeHealthStats(inv, counts, posts)
    expect(s.totalEntities).toBe(3)
    expect(s.byCategory.Firmen).toBe(2)
    expect(s.byCategory.Personen).toBe(1)
    expect(s.mentionedCount).toBe(2)
    expect(s.orphanCount).toBe(1)
    expect(s.orphanRatio).toBe(33)
  })

  it('Health-Score: 100 für gesunden Vault, niedriger bei vielen Orphans', () => {
    expect(computeHealthScore({ totalEntities: 50, orphanRatio: 5, avgBacklinksPerMentioned: 5 })).toBeGreaterThanOrEqual(95)
    expect(computeHealthScore({ totalEntities: 50, orphanRatio: 50, avgBacklinksPerMentioned: 2 })).toBeLessThan(90)
    expect(computeHealthScore({ totalEntities: 50, orphanRatio: 70, avgBacklinksPerMentioned: 1 })).toBeLessThanOrEqual(70)
    expect(computeHealthScore({ totalEntities: 5, orphanRatio: 90, avgBacklinksPerMentioned: 0.5 })).toBeLessThan(50)
  })
})

describe('VaultCurator — buildCuratorActions', () => {
  const VP = '/tmp/x'
  it('macht trash-action pro orphan, preselected nur bei auto_created', () => {
    const acts = buildCuratorActions({
      vaultPath: VP,
      orphans: [
        { name: 'Aber', category: 'Firmen', autoCreated: true, provenance: null },
        { name: 'EchteFirma', category: 'Firmen', autoCreated: false, provenance: null }
      ],
      gaps: [],
      aliases: []
    })
    expect(acts.length).toBe(2)
    expect(acts.every(a => a.kind === 'trash')).toBe(true)
    expect(acts[0].preselected).toBe(true)
    expect(acts[1].preselected).toBe(false)
  })

  it('macht create_stub aus gaps, NIE preselected', () => {
    const acts = buildCuratorActions({
      vaultPath: VP,
      orphans: [],
      gaps: [{ phrase: 'Anthropic', occurrences: 8, example: 'context' }],
      aliases: []
    })
    expect(acts[0].kind).toBe('create_stub')
    expect(acts[0].payload.name).toBe('Anthropic')
    expect(acts[0].payload.category).toBe('Firmen')
    expect(acts[0].preselected).toBe(false)
  })

  it('macht merge aus aliases, preselected bei Vorname-Reason', () => {
    const acts = buildCuratorActions({
      vaultPath: VP,
      orphans: [],
      gaps: [],
      aliases: [
        { a: 'Alex', b: 'Alex Januschewsky', category: 'Personen', reason: 'gleicher Vorname "Alex"' },
        { a: 'Mistral', b: 'Mistral AI', category: 'Firmen', reason: 'Substring-Überlapp' }
      ]
    })
    expect(acts.length).toBe(2)
    expect(acts[0].kind).toBe('merge')
    expect(acts[0].preselected).toBe(true)   // Vorname
    expect(acts[1].preselected).toBe(false)  // Substring
  })

  it('merge: kürzerer Name ist source, längerer ist target', () => {
    const [act] = buildCuratorActions({
      vaultPath: VP,
      orphans: [],
      gaps: [],
      aliases: [{ a: 'Alex Januschewsky', b: 'Alex', category: 'Personen', reason: 'gleicher Vorname' }]
    })
    expect(act.payload.sourceName).toBe('Alex')
    expect(act.payload.targetName).toBe('Alex Januschewsky')
  })

  it('jede action hat eindeutige id', () => {
    const acts = buildCuratorActions({
      vaultPath: VP,
      orphans: [{ name: 'A', category: 'Firmen' }, { name: 'B', category: 'Firmen' }],
      gaps: [{ phrase: 'Mistral', occurrences: 5, example: '' }],
      aliases: []
    })
    const ids = new Set(acts.map(a => a.id))
    expect(ids.size).toBe(3)
  })

  it('filtert zu kurze + stopword-Lücken im action-builder selbst', () => {
    const acts = buildCuratorActions({
      vaultPath: VP,
      orphans: [],
      gaps: [
        { phrase: 'AI', occurrences: 5, example: '' },        // zu kurz
        { phrase: 'Aber', occurrences: 6, example: '' },      // Stopword
        { phrase: 'Anthropic', occurrences: 6, example: '' }  // OK
      ],
      aliases: []
    })
    expect(acts.length).toBe(1)
    expect(acts[0].payload.name).toBe('Anthropic')
  })
})

describe('VaultCurator — Frontmatter + DataBlock', () => {
  it('Frontmatter mit Tags und Datum', () => {
    const fm = buildCuratorFrontmatter()
    expect(fm).toContain('source: vinci-vault-curator')
    expect(fm).toContain('tags: [vault-curator, report, vinci-agent]')
  })

  it('DataBlock enthält alle Sektionen', () => {
    const block = buildCuratorDataBlock({
      stats: { totalEntities: 30, byCategory: { Firmen: 20, Personen: 10 }, totalPosts: 500, mentionedCount: 25, orphanCount: 5, orphanRatio: 17, avgBacklinksPerMentioned: 4.2 },
      topMentions: [{ name: 'Apple', category: 'Firmen', mentionCount: 50 }],
      orphans: [{ name: 'Lost', category: 'Themen', autoCreated: false, provenance: null }],
      gaps: [{ phrase: 'Anthropic', occurrences: 8, example: '...Anthropic launches...' }],
      aliases: [{ a: 'Alex', b: 'Alex Januschewsky', category: 'Personen', reason: 'gleicher Vorname' }]
    })
    expect(block).toContain('## Vault-Stats')
    expect(block).toContain('Entities total: 30')
    expect(block).toContain('## Top-Mentioned')
    expect(block).toContain('Apple: 50 Posts')
    expect(block).toContain('## Verwaiste Entities')
    expect(block).toContain('Lost')
    expect(block).toContain('## Lücken-Kandidaten')
    expect(block).toContain('"Anthropic" — 8 Posts')
    expect(block).toContain('## Alias-Kandidaten')
    expect(block).toContain('"Alex" ↔ "Alex Januschewsky"')
  })
})
