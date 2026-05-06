import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { detectMultipleVaults } from '../obsidian.js'

const TMP = join(tmpdir(), 'vinci-test-vault-detect')

describe('detectMultipleVaults', () => {
  beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }) })
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

  it('returns false when no .obsidian subfolder exists', () => {
    expect(detectMultipleVaults(TMP)).toBe(false)
  })

  it('returns false when the path itself is one vault', () => {
    mkdirSync(join(TMP, '.obsidian'))
    expect(detectMultipleVaults(TMP)).toBe(false)
  })

  it('returns true when multiple subdirectories contain .obsidian/', () => {
    mkdirSync(join(TMP, 'A/.obsidian'), { recursive: true })
    mkdirSync(join(TMP, 'B/.obsidian'), { recursive: true })
    expect(detectMultipleVaults(TMP)).toBe(true)
  })

  it('returns false when only one subdirectory contains .obsidian/', () => {
    mkdirSync(join(TMP, 'A/.obsidian'), { recursive: true })
    expect(detectMultipleVaults(TMP)).toBe(false)
  })

  it('returns false for non-existent path', () => {
    expect(detectMultipleVaults('/nope/does/not/exist')).toBe(false)
  })
})
