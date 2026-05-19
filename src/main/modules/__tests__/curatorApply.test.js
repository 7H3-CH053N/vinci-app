import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { applyCuratorActions } from '../_curatorApply.js'

const VAULT = join(tmpdir(), 'vinci-curator-apply-test')

beforeEach(() => {
  rmSync(VAULT, { recursive: true, force: true })
  mkdirSync(join(VAULT, 'VINCI/Firmen'), { recursive: true })
  mkdirSync(join(VAULT, 'VINCI/Personen'), { recursive: true })
})
afterEach(() => rmSync(VAULT, { recursive: true, force: true }))

describe('curatorApply — trash', () => {
  it('verschiebt File ins _quarantine/<category>/', async () => {
    const src = join(VAULT, 'VINCI/Firmen/Aber.md')
    writeFileSync(src, '---\n---\n# Aber')
    const r = await applyCuratorActions(VAULT, [
      { id: 'a1', kind: 'trash', payload: { file: src, name: 'Aber', category: 'Firmen' } }
    ], ['a1'], { skipBackup: true })
    expect(r.applied).toBe(1)
    expect(existsSync(src)).toBe(false)
    expect(existsSync(join(VAULT, 'VINCI/_quarantine/Firmen/Aber.md'))).toBe(true)
  })

  it('skipt wenn file schon weg ist (ok:false aber kein crash)', async () => {
    const r = await applyCuratorActions(VAULT, [
      { id: 'a1', kind: 'trash', payload: { file: '/nope/notexisting.md', name: 'X', category: 'Firmen' } }
    ], ['a1'], { skipBackup: true })
    expect(r.results[0].ok).toBe(false)
  })
})

describe('curatorApply — create_stub', () => {
  it('legt neue Firmen-Stub mit provenance: vault-curator', async () => {
    const r = await applyCuratorActions(VAULT, [
      { id: 'a1', kind: 'create_stub', payload: { name: 'Mistral AI', category: 'Firmen' } }
    ], ['a1'], { skipBackup: true })
    expect(r.applied).toBe(1)
    const file = join(VAULT, 'VINCI/Firmen/Mistral AI.md')
    expect(existsSync(file)).toBe(true)
    const c = readFileSync(file, 'utf8')
    expect(c).toContain('provenance: vault-curator')
    expect(c).not.toContain('auto_created: true')
    expect(c).toContain('# Mistral AI')
  })

  it('überschreibt nicht wenn schon da', async () => {
    writeFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'), 'EXISTING')
    const r = await applyCuratorActions(VAULT, [
      { id: 'a1', kind: 'create_stub', payload: { name: 'Apple', category: 'Firmen' } }
    ], ['a1'], { skipBackup: true })
    expect(r.results[0].ok).toBe(false)
    expect(readFileSync(join(VAULT, 'VINCI/Firmen/Apple.md'), 'utf8')).toBe('EXISTING')
  })
})

describe('curatorApply — merge', () => {
  it('mergt Bullets von source ins target, quarantäneert source', async () => {
    const src = join(VAULT, 'VINCI/Personen/Alex.md')
    const tgt = join(VAULT, 'VINCI/Personen/Alex Januschewsky.md')
    writeFileSync(src, '---\n---\n# Alex\n\n- Bullet aus Source\n')
    writeFileSync(tgt, '---\n---\n# Alex Januschewsky\n\n- Bullet aus Target\n')
    const r = await applyCuratorActions(VAULT, [
      { id: 'm1', kind: 'merge', payload: { sourcePath: src, targetPath: tgt, sourceName: 'Alex', targetName: 'Alex Januschewsky', category: 'Personen' } }
    ], ['m1'], { skipBackup: true })
    expect(r.applied).toBe(1)
    expect(existsSync(src)).toBe(false)
    expect(existsSync(join(VAULT, 'VINCI/_quarantine/Personen/Alex.md'))).toBe(true)
    const merged = readFileSync(tgt, 'utf8')
    expect(merged).toContain('Bullet aus Source')
    expect(merged).toContain('Bullet aus Target')
  })

  it('dupliziert keine Bullets', async () => {
    const src = join(VAULT, 'VINCI/Personen/A.md')
    const tgt = join(VAULT, 'VINCI/Personen/AA.md')
    writeFileSync(src, '- Selber Bullet')
    writeFileSync(tgt, '- Selber Bullet')
    await applyCuratorActions(VAULT, [
      { id: 'm', kind: 'merge', payload: { sourcePath: src, targetPath: tgt, sourceName: 'A', targetName: 'AA', category: 'Personen' } }
    ], ['m'], { skipBackup: true })
    const c = readFileSync(tgt, 'utf8')
    expect((c.match(/Selber Bullet/g) || []).length).toBe(1)
  })
})

describe('curatorApply — control flow', () => {
  it('führt nur ausgewählte Actions aus', async () => {
    const src1 = join(VAULT, 'VINCI/Firmen/F1.md')
    const src2 = join(VAULT, 'VINCI/Firmen/F2.md')
    writeFileSync(src1, 'x'); writeFileSync(src2, 'x')
    const r = await applyCuratorActions(VAULT, [
      { id: 'a1', kind: 'trash', payload: { file: src1, name: 'F1', category: 'Firmen' } },
      { id: 'a2', kind: 'trash', payload: { file: src2, name: 'F2', category: 'Firmen' } }
    ], ['a1'], { skipBackup: true })
    expect(r.applied).toBe(1)
    expect(existsSync(src1)).toBe(false)
    expect(existsSync(src2)).toBe(true)   // nicht ausgewählt → unangetastet
  })

  it('dryRun ändert nichts', async () => {
    const src = join(VAULT, 'VINCI/Firmen/F.md')
    writeFileSync(src, 'x')
    const r = await applyCuratorActions(VAULT, [
      { id: 'a', kind: 'trash', payload: { file: src, name: 'F', category: 'Firmen' } }
    ], ['a'], { dryRun: true, skipBackup: true })
    expect(r.dryRun).toBe(true)
    expect(existsSync(src)).toBe(true)
  })

  it('leere selectedIds → no-op', async () => {
    const r = await applyCuratorActions(VAULT, [
      { id: 'a', kind: 'trash', payload: { file: '/x' } }
    ], [], { skipBackup: true })
    expect(r.applied).toBe(0)
  })

  it('error bei ungültigem Vault-Pfad', async () => {
    const r = await applyCuratorActions('/nonexistent', [], [], { skipBackup: true })
    expect(r.error).toBeTruthy()
  })
})
