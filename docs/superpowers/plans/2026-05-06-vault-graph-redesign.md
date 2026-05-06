# VINCI Vault & Knowledge-Graph Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate VINCI Mac to the canonical shared vault, harden the entity-extraction pipeline, add a native WordPress blog importer, build a one-shot cleanup tool for existing garbage notes, wire body-Wikilink generation into the blog and web-save flows, and fix the broken web-search trigger.

**Architecture:** Plain Markdown + Wikilinks remains the storage layer. Extensibility comes from clean module boundaries: a source-registry for importers, a rule-set for the cleaner, a model-strategy for entity extraction. Test-before-go is enforced everywhere via dry-run flows against `~/.vinci-test-vault/`. Backups precede every destructive operation.

**Tech Stack:** Node.js ESM (electron-vite), Electron 31, React 18, axios. New runtime deps: `turndown` (HTML→Markdown). New dev dep: `vitest` (test runner). Local LLM via Ollama (default `gemma3:4b`).

**Spec reference:** [docs/superpowers/specs/2026-05-06-vault-graph-redesign-design.md](../specs/2026-05-06-vault-graph-redesign-design.md)

**Eight rollout phases.** Each phase is independently shippable — implement, test, ship, repeat. Phases map 1:1 to the spec's roll-out plan §5.

| Phase | Spec § | What it ships |
|---|---|---|
| 0 | — | Foundations: git init, vitest setup, deps |
| 1 | 4.5 | Web search trigger fix |
| 2 | 4.1.1, 4.1.2 | Vault path validation |
| 3 | 4.1.3 | Migration script for orphan vaults |
| 4 | 4.3 | Graph + Memworker hardening |
| 5 | 4.4.1 | One-shot cleaner |
| 6 | 4.2 | Blog importer |
| 7 | 4.4.2 | Body Wikilink pass |
| 8 | 4.4.3 | Web→Vault save |

---

## Phase 0 — Foundations

### Task 0.1: Initialize git repository

**Files:**
- Create: `.gitignore`
- (Repo init — no file)

- [ ] **Step 1: Init git**

```bash
cd "/Users/alexjanuschewsky/Claude Projekte/vinci2"
git init
```

- [ ] **Step 2: Create .gitignore**

Create `.gitignore`:
```
node_modules/
out/
release/
.DS_Store
*.log
.vinci-archive/
.vinci-test-vault/
```

- [ ] **Step 3: First commit**

```bash
git add .gitignore docs/
git commit -m "chore: init repo with spec and plan"
```

Expected: commit succeeds, `git log --oneline` shows one commit.

---

### Task 0.2: Set up vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Create: `src/main/modules/__tests__/sanity.test.js`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Add test script and create vitest config**

Edit `package.json` scripts:
```json
"scripts": {
  "dev": "./node_modules/.bin/electron-vite dev",
  "build": "./node_modules/.bin/electron-vite build && ./node_modules/.bin/electron-builder --config electron-builder.config.js",
  "preview": "electron-vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Create `vitest.config.js`:
```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.js'],
    environment: 'node',
    testTimeout: 10000
  }
})
```

- [ ] **Step 3: Write sanity test**

Create `src/main/modules/__tests__/sanity.test.js`:
```js
import { describe, it, expect } from 'vitest'

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: 1 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js src/main/modules/__tests__/sanity.test.js
git commit -m "chore: add vitest test runner"
```

---

### Task 0.3: Install turndown dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install turndown
```

- [ ] **Step 2: Sanity-test the lib**

Create `src/main/modules/__tests__/turndown-sanity.test.js`:
```js
import { describe, it, expect } from 'vitest'
import TurndownService from 'turndown'

describe('turndown', () => {
  it('converts simple HTML to Markdown', () => {
    const td = new TurndownService()
    const md = td.turndown('<h2>Title</h2><p>Hello <b>world</b>.</p>')
    expect(md).toContain('## Title')
    expect(md).toContain('**world**')
  })
})
```

- [ ] **Step 3: Run + commit**

```bash
npm test
git add package.json package-lock.json src/main/modules/__tests__/turndown-sanity.test.js
git commit -m "chore: add turndown dependency"
```

---

## Phase 1 — Web search trigger fix (Spec §4.5)

### Task 1.1: Add TRIGGER block to Gemini prompt

**Files:**
- Modify: `src/main/modules/gemini.js` (around line 60–83)

- [ ] **Step 1: Locate the WEB-SUCHE block**

Open `src/main/modules/gemini.js`. Find the line `WEB-SUCHE (web_search):` followed by `Externe Internet-Inhalte sind ungeprüft.` and `PARAMETER:`.

- [ ] **Step 2: Insert TRIGGER block**

Replace:
```
WEB-SUCHE (web_search):
Externe Internet-Inhalte sind ungeprüft.

PARAMETER:
```

With:
```
WEB-SUCHE (web_search):
Externe Internet-Inhalte sind ungeprüft.

TRIGGER (MUSS):
- Bei Fragen mit "aktuell", "heute", "neueste", "letzte Tage", "diese Woche", "News", "was passiert gerade" → IMMER web_search aufrufen, auch wenn du eine Antwort aus deinem Trainingswissen kennst.
- Bei Fragen zu öffentlichen Firmen, Software-Versionen, Produkt-Releases, Marktdaten, Personen des öffentlichen Lebens → IMMER web_search.
- Bei "was weißt du über X" UND X ist nicht im persönlichen Kontext (Familie/Freunde/eigener Kalender) → web_search.
- Eine "Aus meinem Trainingswissen weiß ich..."-Antwort zu aktuellen Themen ist ein FEHLER, wenn du nicht zuerst web_search probiert hast.
- Wenn web_search keine relevanten Treffer liefert: SAG das ehrlich, halluziniere nicht.

PARAMETER:
```

- [ ] **Step 3: Manual smoke test (after rebuild)**

Build and start the app:
```bash
npm run dev
```

In VINCI chat, verify:
- "Was gibt's Neues bei OpenAI?" → console log `[TOOL] web_search` appears
- "Aktueller Bitcoin-Kurs" → console log `[TOOL] web_search` appears
- "Wer ist mein Bruder?" → no `web_search` call

- [ ] **Step 4: Commit**

```bash
git add src/main/modules/gemini.js
git commit -m "fix: add web_search trigger rules to gemini prompt"
```

---

### Task 1.2: Add Bearer auth fallback to Tavily call

**Files:**
- Modify: `src/main/modules/web.js:51`

- [ ] **Step 1: Update headers**

In `src/main/modules/web.js`, replace:
```js
const res = await axios.post(TAVILY_URL, body, {
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000
})
```

With:
```js
const res = await axios.post(TAVILY_URL, body, {
  headers: {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  timeout: 15_000
})
```

- [ ] **Step 2: Commit**

```bash
git add src/main/modules/web.js
git commit -m "feat: add Bearer auth header to Tavily call"
```

---

## Phase 2 — Vault path validation (Spec §4.1.1, 4.1.2)

### Task 2.1: Detect multi-vault parent directories

**Files:**
- Create: `src/main/modules/__tests__/obsidian-vault-detection.test.js`
- Modify: `src/main/modules/obsidian.js` (function `getVault`)

- [ ] **Step 1: Write failing test**

Create `src/main/modules/__tests__/obsidian-vault-detection.test.js`:
```js
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
})
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- obsidian-vault-detection
```

Expected: FAIL — `detectMultipleVaults is not a function` or import error.

- [ ] **Step 3: Implement**

In `src/main/modules/obsidian.js`, add **before** the `getVault` function:
```js
export function detectMultipleVaults(parentPath) {
  if (!existsSync(parentPath) || !statSync(parentPath).isDirectory()) return false
  let count = 0
  let entries
  try { entries = readdirSync(parentPath, { withFileTypes: true }) }
  catch { return false }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (existsSync(join(parentPath, e.name, '.obsidian'))) count++
    if (count >= 2) return true
  }
  return false
}
```

Then in `getVault`, after the existing `isDirectory` check, add:
```js
  if (detectMultipleVaults(vault)) {
    return { error: `Pfad enthält mehrere Vaults — bitte den konkreten Vault auswählen, nicht den Parent-Ordner: ${vault}` }
  }
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- obsidian-vault-detection
```

Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/main/modules/obsidian.js src/main/modules/__tests__/obsidian-vault-detection.test.js
git commit -m "feat(obsidian): detect multi-vault parent dirs and reject them"
```

---

### Task 2.2: Surface vault error inline in Settings UI

**Files:**
- Modify: `src/renderer/components/Settings.jsx` (vault path field)

- [ ] **Step 1: Find the vault input**

In `Settings.jsx`, locate the input bound to `local.obsidian.vaultPath`.

- [ ] **Step 2: Add validation hint**

Add a small validator below the input that calls `window.lyra.validateVaultPath(path)` (new IPC). When the response includes `error`, render it in a red hint:

```jsx
const [vaultError, setVaultError] = useState('')

useEffect(() => {
  const path = local.obsidian?.vaultPath
  if (!path) { setVaultError(''); return }
  window.lyra.validateVaultPath?.(path).then(r => {
    setVaultError(r?.error || '')
  })
}, [local.obsidian?.vaultPath])

// In the JSX, below the input:
{vaultError && <p className="hint" style={{ color: '#ff6b6b' }}>{vaultError}</p>}
```

- [ ] **Step 3: Add IPC handler**

In `src/main/ipc.js`, register handler:
```js
ipcMain.handle('validateVaultPath', (_e, path) => {
  if (!path) return { ok: true }
  if (!existsSync(path)) return { error: 'Pfad existiert nicht.' }
  if (!statSync(path).isDirectory()) return { error: 'Pfad ist kein Ordner.' }
  if (detectMultipleVaults(path)) return { error: 'Pfad enthält mehrere Vaults — bitte den konkreten Vault auswählen.' }
  return { ok: true }
})
```

Don't forget the `import { detectMultipleVaults } from './modules/obsidian.js'` at the top.

- [ ] **Step 4: Expose via preload**

In `src/main/preload.js`, add to the exposed API:
```js
validateVaultPath: (path) => ipcRenderer.invoke('validateVaultPath', path),
```

- [ ] **Step 5: Manual smoke test**

Run dev build. Set vault path to `/Users/alexjanuschewsky/Vaults` → expect red warning. Set to `/Users/alexjanuschewsky/Documents/VINCI Vault` → no warning.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/Settings.jsx src/main/ipc.js src/main/preload.js
git commit -m "feat(settings): warn when vault path contains multiple vaults"
```

---

## Phase 3 — Migration script (Spec §4.1.3)

### Task 3.1: Create migration module skeleton

**Files:**
- Create: `src/main/modules/_vaultMigration.js`

- [ ] **Step 1: Define module shape**

Create `src/main/modules/_vaultMigration.js`:
```js
// One-shot migration of two orphan Mac-only vaults into the canonical vault.
// All operations are dry-run-safe. Real writes happen only when apply=true.

import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join, basename, relative } from 'path'
import { homedir } from 'os'
import archiver from 'archiver'
import { createWriteStream } from 'fs'

const ORPHAN_VAULTS = [
  '/Users/alexjanuschewsky/Vaults/VINCI/VINCI',
  '/Users/alexjanuschewsky/Vaults/VINCI Wissen/VINCI'
]
const ORPHAN_ROOTS = [
  '/Users/alexjanuschewsky/Vaults/VINCI',
  '/Users/alexjanuschewsky/Vaults/VINCI Wissen'
]

export async function planMigration(canonicalVaultPath) {
  // ... implemented in Task 3.2
}

export async function applyMigration(canonicalVaultPath, plan) {
  // ... implemented in Task 3.3
}
```

- [ ] **Step 2: Install archiver**

```bash
npm install archiver
```

- [ ] **Step 3: Commit**

```bash
git add src/main/modules/_vaultMigration.js package.json package-lock.json
git commit -m "feat(migration): add module skeleton + archiver dep"
```

---

### Task 3.2: Implement scan/plan logic with token-overlap dedup

**Files:**
- Create: `src/main/modules/__tests__/vaultMigration.test.js`
- Modify: `src/main/modules/_vaultMigration.js`

- [ ] **Step 1: Write failing test**

Create `src/main/modules/__tests__/vaultMigration.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { planMigrationFromPaths } from '../_vaultMigration.js'

const ROOT = join(tmpdir(), 'vinci-mig-test')
const SRC  = join(ROOT, 'src/VINCI')
const DST  = join(ROOT, 'dst/VINCI')

describe('planMigrationFromPaths', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(SRC, { recursive: true })
    mkdirSync(DST, { recursive: true })
  })
  afterEach(() => rmSync(ROOT, { recursive: true, force: true }))

  it('proposes copy when target note does not exist', () => {
    mkdirSync(join(SRC, 'Personen'))
    writeFileSync(join(SRC, 'Personen/Toni.md'), '# Toni\n\n- **27.04.2026** — Toni ist 30.\n')
    const plan = planMigrationFromPaths([SRC], DST)
    expect(plan.proposals).toContainEqual(expect.objectContaining({
      kind: 'copy',
      from: expect.stringContaining('Toni.md'),
      to: expect.stringContaining('Personen/Toni.md')
    }))
  })

  it('proposes merge when target exists and bullets are unique', () => {
    mkdirSync(join(SRC, 'Personen'))
    mkdirSync(join(DST, 'Personen'))
    writeFileSync(join(SRC, 'Personen/Toni.md'),
      '# Toni\n\n- **27.04.2026** — Toni ist Alex Bruder.\n')
    writeFileSync(join(DST, 'Personen/Toni.md'),
      '# Toni\n\n- **20.04.2026** — Toni wohnt in Linz.\n')
    const plan = planMigrationFromPaths([SRC], DST)
    const merge = plan.proposals.find(p => p.kind === 'merge')
    expect(merge).toBeDefined()
    expect(merge.bullets_to_add).toBe(1)
  })

  it('skips bullet that token-overlaps existing one (>=70%)', () => {
    mkdirSync(join(SRC, 'Personen'))
    mkdirSync(join(DST, 'Personen'))
    writeFileSync(join(SRC, 'Personen/Toni.md'),
      '# Toni\n\n- **27.04.2026** — Toni ist Alex Bruder und arbeitet in Linz.\n')
    writeFileSync(join(DST, 'Personen/Toni.md'),
      '# Toni\n\n- **20.04.2026** — Toni ist Alex Bruder arbeitet Linz.\n')
    const plan = planMigrationFromPaths([SRC], DST)
    const merge = plan.proposals.find(p => p.kind === 'merge')
    expect(merge?.bullets_to_add ?? 0).toBe(0)
  })
})
```

- [ ] **Step 2: Run test, verify fail**

```bash
npm test -- vaultMigration
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `_vaultMigration.js`:
```js
const STOP_TOKENS = new Set([
  'der','die','das','ein','eine','und','oder','ist','sind','war','waren',
  'in','an','am','auf','bei','mit','von','zu','zur','zum','aus','nach','für'
])

function tokenize(s) {
  return s.toLowerCase()
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[^\wäöüß ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_TOKENS.has(t))
}

function bulletsOf(content) {
  return content.split('\n').filter(l => l.trim().startsWith('- '))
}

function isBulletDuplicate(newBullet, existingBullets, threshold = 0.7) {
  const newTok = tokenize(newBullet)
  if (newTok.length === 0) return false
  for (const ex of existingBullets) {
    const exTok = new Set(tokenize(ex))
    if (exTok.size === 0) continue
    let overlap = 0
    for (const t of newTok) if (exTok.has(t)) overlap++
    if (overlap / newTok.length >= threshold) return true
  }
  return false
}

function walkMd(dir, base = dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '_quarantine') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkMd(full, base))
    else if (e.isFile() && e.name.endsWith('.md')) out.push({ full, rel: relative(base, full) })
  }
  return out
}

export function planMigrationFromPaths(srcRoots, dstRoot) {
  const proposals = []
  let scanned = 0
  for (const src of srcRoots) {
    for (const file of walkMd(src)) {
      scanned++
      const dstPath = join(dstRoot, file.rel)
      if (!existsSync(dstPath)) {
        proposals.push({ kind: 'copy', from: file.full, to: dstPath })
        continue
      }
      const srcContent = readFileSync(file.full, 'utf8')
      const dstContent = readFileSync(dstPath, 'utf8')
      const dstBullets = bulletsOf(dstContent)
      const newBullets = bulletsOf(srcContent).filter(b => !isBulletDuplicate(b, dstBullets))
      proposals.push({
        kind: 'merge',
        from: file.full,
        to: dstPath,
        bullets_to_add: newBullets.length,
        bullets_total_in_source: bulletsOf(srcContent).length
      })
    }
  }
  return { scanned, proposals }
}

export async function planMigration(canonicalVaultPath) {
  const dstRoot = join(canonicalVaultPath, 'VINCI')
  return planMigrationFromPaths(ORPHAN_VAULTS, dstRoot)
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- vaultMigration
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/modules/_vaultMigration.js src/main/modules/__tests__/vaultMigration.test.js
git commit -m "feat(migration): implement scan + plan with token-overlap dedup"
```

---

### Task 3.3: Implement apply with backup + orphan archival

**Files:**
- Modify: `src/main/modules/_vaultMigration.js`

- [ ] **Step 1: Write failing test**

Add to `vaultMigration.test.js`:
```js
import { applyMigrationFromPlan, zipDirectory } from '../_vaultMigration.js'
import { existsSync, readFileSync } from 'fs'

describe('applyMigrationFromPlan', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(join(SRC, 'Personen'), { recursive: true })
    mkdirSync(join(DST, 'Personen'), { recursive: true })
  })
  afterEach(() => rmSync(ROOT, { recursive: true, force: true }))

  it('copy proposal creates target file with source content', async () => {
    writeFileSync(join(SRC, 'Personen/Neu.md'), '# Neu\n\n- New bullet\n')
    const plan = { proposals: [{ kind: 'copy', from: join(SRC, 'Personen/Neu.md'), to: join(DST, 'Personen/Neu.md') }] }
    const report = await applyMigrationFromPlan(plan, { dryRun: false })
    expect(existsSync(join(DST, 'Personen/Neu.md'))).toBe(true)
    expect(readFileSync(join(DST, 'Personen/Neu.md'), 'utf8')).toContain('New bullet')
    expect(report.copied).toBe(1)
  })

  it('merge proposal appends only non-duplicate bullets', async () => {
    writeFileSync(join(SRC, 'Personen/Toni.md'), '# Toni\n\n- **27.04.2026** — Neue Info.\n')
    writeFileSync(join(DST, 'Personen/Toni.md'), '# Toni\n\n- **20.04.2026** — Alte Info.\n')
    const plan = { proposals: [{ kind: 'merge', from: join(SRC, 'Personen/Toni.md'), to: join(DST, 'Personen/Toni.md'), bullets_to_add: 1 }] }
    await applyMigrationFromPlan(plan, { dryRun: false })
    const merged = readFileSync(join(DST, 'Personen/Toni.md'), 'utf8')
    expect(merged).toContain('Alte Info')
    expect(merged).toContain('Neue Info')
  })

  it('dry-run does not write files', async () => {
    writeFileSync(join(SRC, 'Personen/X.md'), '# X\n')
    const plan = { proposals: [{ kind: 'copy', from: join(SRC, 'Personen/X.md'), to: join(DST, 'Personen/X.md') }] }
    await applyMigrationFromPlan(plan, { dryRun: true })
    expect(existsSync(join(DST, 'Personen/X.md'))).toBe(false)
  })
})
```

- [ ] **Step 2: Implement apply**

Add to `_vaultMigration.js`:
```js
export async function applyMigrationFromPlan(plan, { dryRun = true } = {}) {
  const report = { copied: 0, merged: 0, errors: [] }
  for (const p of plan.proposals) {
    try {
      if (p.kind === 'copy') {
        if (!dryRun) {
          mkdirSync(join(p.to, '..'), { recursive: true })
          writeFileSync(p.to, readFileSync(p.from, 'utf8'))
        }
        report.copied++
      } else if (p.kind === 'merge') {
        if (!dryRun) {
          const src = readFileSync(p.from, 'utf8')
          const dst = readFileSync(p.to, 'utf8')
          const dstBullets = bulletsOf(dst)
          const toAdd = bulletsOf(src).filter(b => !isBulletDuplicate(b, dstBullets))
          if (toAdd.length) {
            const sep = dst.endsWith('\n') ? '' : '\n'
            writeFileSync(p.to, dst + sep + toAdd.join('\n') + '\n')
          }
        }
        report.merged++
      }
    } catch (err) {
      report.errors.push({ proposal: p, error: err.message })
    }
  }
  return report
}

export function zipDirectory(srcDir, outZip) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(outZip)
    const archive = archiver('zip', { zlib: { level: 6 } })
    out.on('close', () => resolve(archive.pointer()))
    archive.on('error', reject)
    archive.pipe(out)
    archive.directory(srcDir, false)
    archive.finalize()
  })
}

export async function applyMigration(canonicalVaultPath, plan, { dryRun = true } = {}) {
  if (!dryRun) {
    const archiveDir = join(homedir(), '.vinci-archive')
    mkdirSync(archiveDir, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 10)
    await zipDirectory(join(canonicalVaultPath, 'VINCI'), join(archiveDir, `${stamp}-pre-migration.zip`))
  }
  const report = await applyMigrationFromPlan(plan, { dryRun })
  if (!dryRun) {
    const stamp = new Date().toISOString().slice(0, 10)
    const archiveTarget = join(homedir(), '.vinci-archive', `orphan-vaults-${stamp}`)
    mkdirSync(archiveTarget, { recursive: true })
    for (const orphan of ORPHAN_ROOTS) {
      if (existsSync(orphan)) {
        renameSync(orphan, join(archiveTarget, basename(orphan)))
      }
    }
  }
  return report
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- vaultMigration
```

Expected: 6/6 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/modules/_vaultMigration.js src/main/modules/__tests__/vaultMigration.test.js
git commit -m "feat(migration): implement apply with backup and orphan archival"
```

---

### Task 3.4: Wire migration to Settings UI

**Files:**
- Modify: `src/main/ipc.js`, `src/main/preload.js`, `src/renderer/components/Settings.jsx`

- [ ] **Step 1: Add IPC handlers**

In `src/main/ipc.js`:
```js
import { planMigration, applyMigration } from './modules/_vaultMigration.js'

ipcMain.handle('migrationPlan', async () => {
  const settings = getSettings()
  const vault = settings.obsidian?.vaultPath
  if (!vault) return { error: 'Vault-Pfad nicht gesetzt.' }
  return await planMigration(vault)
})

ipcMain.handle('migrationApply', async (_e, plan, opts = { dryRun: true }) => {
  const settings = getSettings()
  const vault = settings.obsidian?.vaultPath
  if (!vault) return { error: 'Vault-Pfad nicht gesetzt.' }
  return await applyMigration(vault, plan, opts)
})
```

- [ ] **Step 2: Expose via preload**

In `preload.js`:
```js
migrationPlan: () => ipcRenderer.invoke('migrationPlan'),
migrationApply: (plan, opts) => ipcRenderer.invoke('migrationApply', plan, opts)
```

- [ ] **Step 3: Add Settings button + modal**

In `Settings.jsx`, in the "Dienste" or new "Migration" section:
```jsx
const [migPlan, setMigPlan] = useState(null)
const [migReport, setMigReport] = useState(null)

async function runPlan() {
  const r = await window.lyra.migrationPlan()
  setMigPlan(r)
}
async function runDryRun() {
  const r = await window.lyra.migrationApply(migPlan, { dryRun: true })
  setMigReport(r)
}
async function runApply() {
  if (!confirm('Echter Lauf — Backup wird erstellt, alte Vaults werden archiviert. Sicher?')) return
  const r = await window.lyra.migrationApply(migPlan, { dryRun: false })
  setMigReport(r)
}

// JSX:
<button onClick={runPlan}>1. Migration planen</button>
{migPlan && <pre>{JSON.stringify(migPlan, null, 2)}</pre>}
{migPlan && <button onClick={runDryRun}>2. Dry-Run</button>}
{migPlan && <button onClick={runApply}>3. Echt anwenden (mit Backup)</button>}
{migReport && <pre>{JSON.stringify(migReport, null, 2)}</pre>}
```

- [ ] **Step 4: Manual smoke test**

Build, set vault to canonical path, click "Migration planen" → expect a `proposals` array. Click Dry-Run → expect report without files written. Verify manually in Finder that nothing changed in the canonical vault. Then click Echt anwenden, verify orphan vaults moved to `~/.vinci-archive/orphan-vaults-<datum>/` and backup zip exists.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.js src/main/preload.js src/renderer/components/Settings.jsx
git commit -m "feat(settings): wire migration plan/apply to Settings UI"
```

---

## Phase 4 — Graph + Memworker hardening (Spec §4.3)

### Task 4.1: Add canonical category set + Quellen folder support

**Files:**
- Create: `src/main/modules/_graphCategories.js`
- Modify: `src/main/modules/obsidianGraph.js` (replace `VALID_CATS`)

- [ ] **Step 1: Create central category module**

Create `src/main/modules/_graphCategories.js`:
```js
// Single source of truth for graph categories. Used by graph builder, cleaner, and tests.
export const VALID_CATS = ['Personen', 'Tiere', 'Firmen', 'Orte', 'Themen', 'Quellen']

export const DOMAIN_RE = /[a-z0-9-]+\.(com|de|at|net|org|io|ai|rocks|blog|news|info)$/i

export function isDomain(name) { return DOMAIN_RE.test(String(name).trim()) }
```

- [ ] **Step 2: Wire into obsidianGraph.js**

In `obsidianGraph.js`, replace the local `VALID_CATS = [...]` with:
```js
import { VALID_CATS, isDomain } from './_graphCategories.js'
```

- [ ] **Step 3: Test categories module**

Create `src/main/modules/__tests__/graphCategories.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { VALID_CATS, isDomain } from '../_graphCategories.js'

describe('graphCategories', () => {
  it('contains six canonical categories incl. Quellen', () => {
    expect(VALID_CATS).toEqual(['Personen','Tiere','Firmen','Orte','Themen','Quellen'])
  })
  it('isDomain detects common TLDs', () => {
    expect(isDomain('9to5google.com')).toBe(true)
    expect(isDomain('digitalhandwerk.rocks')).toBe(true)
    expect(isDomain('OpenAI')).toBe(false)
    expect(isDomain('Salzburg')).toBe(false)
  })
})
```

Run: `npm test -- graphCategories` → 2/2 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/modules/_graphCategories.js src/main/modules/obsidianGraph.js src/main/modules/__tests__/graphCategories.test.js
git commit -m "feat(graph): add Quellen category + domain detection"
```

---

### Task 4.2: Implement HARD_REJECT pre-filter

**Files:**
- Modify: `src/main/modules/obsidianGraph.js` (in `postFilter`)
- Create: `src/main/modules/__tests__/hardReject.test.js`

- [ ] **Step 1: Write failing test**

Create `src/main/modules/__tests__/hardReject.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { isHardRejected } from '../obsidianGraph.js'

describe('isHardRejected', () => {
  const cases = [
    ['+436602660062', true,  'phone'],
    ['+43 6643580271', true, 'phone with space'],
    ['b.januschewsky@live.at', true, 'email'],
    ['1. August 2006', true,  'german date'],
    ['15. Jänner', true,      'partial date'],
    ['1.8.2006', true,         'numeric date'],
    ['2026', true,              'year'],
    ['CPU', true,               'system'],
    ['Plus', true,              'tier'],
    ['Pro', true,               'tier'],
    ['Enterprise', true,        'tier'],
    ['GPT-5.5', true,           'model version'],
    ['Claude 4', true,          'model version'],
    ['A', true,                 'too short'],
    ['Alex Januschewsky', false,'real person'],
    ['OpenAI', false,           'real company'],
    ['Salzburg', false,         'real place']
  ]
  for (const [input, expected, label] of cases) {
    it(`${expected ? 'rejects' : 'keeps'} ${label}: "${input}"`, () => {
      expect(isHardRejected(input)).toBe(expected)
    })
  }
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- hardReject
```

Expected: FAIL — `isHardRejected is not exported`.

- [ ] **Step 3: Implement**

In `obsidianGraph.js`, add and export:
```js
const HARD_REJECT = [
  /^[\d\s\-\+\(\)\.\/]+$/,
  /^\+\d{8,15}$/,
  /^[\w.+-]+@[\w-]+\.[\w.-]+$/,
  /^\d{1,2}\.\s*(jänner|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)/i,
  /^\d{1,2}\.\d{1,2}\.\d{2,4}$/,
  /^\d{4}$/,
  /^(cpu|ram|gpu|disk|festplatte|akku|prozessor|arbeitsspeicher)$/i,
  /^(plus|pro|enterprise|free|basic|premium|standard|advanced)$/i,
  /^(gpt-?\d|claude-?\d|gemini-?\d)/i,
  /^.{1,2}$/,
  /^.{81,}$/
]

export function isHardRejected(name) {
  const t = String(name || '').trim()
  for (const re of HARD_REJECT) if (re.test(t)) return true
  return false
}
```

Then in `postFilter`, just before the existing length/digit checks:
```js
if (isHardRejected(name)) continue
```

- [ ] **Step 4: Run tests**

```bash
npm test -- hardReject
```

Expected: 17/17 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/modules/obsidianGraph.js src/main/modules/__tests__/hardReject.test.js
git commit -m "feat(graph): hard-reject phones, emails, dates, tiers, system terms"
```

---

### Task 4.3: Force-categorize domains as Quellen

**Files:**
- Modify: `src/main/modules/obsidianGraph.js` (in `postFilter`)

- [ ] **Step 1: Add test**

In `hardReject.test.js`, add:
```js
import { forceCategoryFor } from '../obsidianGraph.js'

describe('forceCategoryFor', () => {
  it('forces Quellen for domains', () => {
    expect(forceCategoryFor('9to5google.com', 'Themen')).toBe('Quellen')
    expect(forceCategoryFor('digitalhandwerk.rocks', 'Orte')).toBe('Quellen')
  })
  it('keeps original category for non-domains', () => {
    expect(forceCategoryFor('OpenAI', 'Firmen')).toBe('Firmen')
    expect(forceCategoryFor('Alex', 'Personen')).toBe('Personen')
  })
})
```

- [ ] **Step 2: Implement**

In `obsidianGraph.js`:
```js
import { isDomain } from './_graphCategories.js'

export function forceCategoryFor(name, suggestedCategory) {
  if (isDomain(name)) return 'Quellen'
  return suggestedCategory
}
```

In `postFilter` before pushing:
```js
category = forceCategoryFor(name, category)
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- hardReject
git add src/main/modules/obsidianGraph.js src/main/modules/__tests__/hardReject.test.js
git commit -m "feat(graph): force Quellen category for domain names"
```

---

### Task 4.4: Auto-build aliases when first-name and full-name notes coexist

**Files:**
- Create: `src/main/modules/_aliasBuilder.js`
- Modify: `src/main/modules/obsidianGraph.js` (`writeEntityNote`)
- Create: `src/main/modules/__tests__/aliasBuilder.test.js`

- [ ] **Step 1: Write failing test**

Create `src/main/modules/__tests__/aliasBuilder.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { autoMergeAlias } from '../_aliasBuilder.js'

const ROOT = join(tmpdir(), 'vinci-alias-test')
const VAULT = ROOT
const PERS = join(VAULT, 'VINCI/Personen')
const QUAR = join(VAULT, 'VINCI/_quarantine')

describe('autoMergeAlias', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(PERS, { recursive: true })
  })
  afterEach(() => rmSync(ROOT, { recursive: true, force: true }))

  it('merges single-word file into multi-word file when both exist', () => {
    writeFileSync(join(PERS, 'Alex.md'), '---\n---\n# Alex\n\n- **27.04.2026** — Alex liebt Musik.\n')
    writeFileSync(join(PERS, 'Alex Januschewsky.md'), '---\n---\n# Alex Januschewsky\n\n- **20.04.2026** — Wohnt in Salzburg.\n')
    autoMergeAlias(VAULT, 'Alex Januschewsky')
    const merged = readFileSync(join(PERS, 'Alex Januschewsky.md'), 'utf8')
    expect(merged).toContain('Alex liebt Musik')
    expect(merged).toContain('Wohnt in Salzburg')
    expect(existsSync(join(PERS, 'Alex.md'))).toBe(false)
    expect(existsSync(join(QUAR, 'Personen/Alex.md'))).toBe(true)
    const aliases = JSON.parse(readFileSync(join(VAULT, 'VINCI/_aliases.json'), 'utf8'))
    expect(aliases['Alex Januschewsky']).toContain('Alex')
  })

  it('does nothing if single-word file does not exist', () => {
    writeFileSync(join(PERS, 'Alex Januschewsky.md'), '---\n---\n# Alex Januschewsky\n')
    autoMergeAlias(VAULT, 'Alex Januschewsky')
    expect(existsSync(join(PERS, 'Alex.md'))).toBe(false)
    expect(existsSync(join(QUAR, 'Personen/Alex.md'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement**

Create `src/main/modules/_aliasBuilder.js`:
```js
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'fs'
import { join, basename } from 'path'

const ALIAS_FILE = '_aliases.json'

function loadAliases(vault) {
  const f = join(vault, 'VINCI', ALIAS_FILE)
  if (!existsSync(f)) return {}
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} }
}

function saveAliases(vault, aliases) {
  const f = join(vault, 'VINCI', ALIAS_FILE)
  writeFileSync(f, JSON.stringify(aliases, null, 2), 'utf8')
}

function bullets(content) {
  return content.split('\n').filter(l => l.trim().startsWith('- '))
}

function findFile(vault, name) {
  const root = join(vault, 'VINCI')
  for (const cat of readdirSync(root, { withFileTypes: true })) {
    if (!cat.isDirectory() || cat.name.startsWith('_')) continue
    const candidate = join(root, cat.name, `${name}.md`)
    if (existsSync(candidate)) return { full: candidate, category: cat.name }
  }
  return null
}

export function autoMergeAlias(vault, fullName) {
  if (!fullName.includes(' ')) return
  const firstWord = fullName.split(' ')[0]
  const fullFile = findFile(vault, fullName)
  const shortFile = findFile(vault, firstWord)
  if (!fullFile || !shortFile) return
  if (fullFile.full === shortFile.full) return

  // Merge bullets from short into full
  const fullContent = readFileSync(fullFile.full, 'utf8')
  const shortContent = readFileSync(shortFile.full, 'utf8')
  const fullBullets = bullets(fullContent)
  const newBullets = bullets(shortContent).filter(b => !fullBullets.includes(b))
  if (newBullets.length) {
    const sep = fullContent.endsWith('\n') ? '' : '\n'
    writeFileSync(fullFile.full, fullContent + sep + newBullets.join('\n') + '\n', 'utf8')
  }

  // Quarantine the short file
  const quarDir = join(vault, 'VINCI', '_quarantine', shortFile.category)
  mkdirSync(quarDir, { recursive: true })
  renameSync(shortFile.full, join(quarDir, basename(shortFile.full)))

  // Update aliases
  const aliases = loadAliases(vault)
  if (!aliases[fullName]) aliases[fullName] = []
  if (!aliases[fullName].includes(firstWord)) aliases[fullName].push(firstWord)
  saveAliases(vault, aliases)
}
```

Then in `obsidianGraph.js writeEntityNote`, after the file is written:
```js
import { autoMergeAlias } from './_aliasBuilder.js'
// ...
// At the end of writeEntityNote, after writeFileSync:
if (entity.name.includes(' ')) {
  try { autoMergeAlias(vault, entity.name) } catch (err) { console.warn('[Graph] autoMergeAlias failed:', err.message) }
}
```

- [ ] **Step 4: Test + commit**

```bash
npm test -- aliasBuilder
git add src/main/modules/_aliasBuilder.js src/main/modules/obsidianGraph.js src/main/modules/__tests__/aliasBuilder.test.js
git commit -m "feat(graph): auto-merge first-name notes into full-name notes via aliases"
```

---

### Task 4.5: Memworker pre-filter for system noise

**Files:**
- Modify: `src/main/modules/memoryWorker.js`
- Create: `src/main/modules/__tests__/memoryNoise.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect } from 'vitest'
import { stripSystemNoise } from '../memoryWorker.js'

describe('stripSystemNoise', () => {
  it('removes lines about CPU/RAM percentages', () => {
    const conv = `Alex: Wie läuft mein Mac?
VINCI: Mac läuft mit CPU 24%, RAM 47%, Festplatte 5%.
Alex: Mein Bruder Tobias arbeitet bei Sony.`
    const out = stripSystemNoise(conv)
    expect(out).not.toMatch(/CPU 24%/)
    expect(out).toMatch(/Tobias/)
  })

  it('keeps normal conversation', () => {
    const conv = 'Alex: Iron Maiden ist meine Lieblingsband.'
    expect(stripSystemNoise(conv)).toBe(conv)
  })
})
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement**

In `memoryWorker.js`:
```js
const SYSTEM_NOISE = /\b(cpu|ram|arbeitsspeicher|festplatte|akku|disk)\b.*\b\d+\s*(%|prozent|gb|mb)/i

export function stripSystemNoise(text) {
  return text.split('\n').filter(l => !SYSTEM_NOISE.test(l)).join('\n')
}
```

In `runConsolidation`, before building `conv`:
```js
const conv = stripSystemNoise(history.filter(...).map(...).join('\n'))
```

(Replace the existing `.join('\n')` line with `stripSystemNoise(...)` wrapping.)

- [ ] **Step 4: Test + commit**

```bash
npm test -- memoryNoise
git add src/main/modules/memoryWorker.js src/main/modules/__tests__/memoryNoise.test.js
git commit -m "feat(memworker): strip system-metric lines before LLM extraction"
```

---

### Task 4.6: Expand TAINTING_TOOLS in ipc.js

**Files:**
- Modify: `src/main/ipc.js:39-44`

- [ ] **Step 1: Edit**

Replace the existing `TAINTING_TOOLS` set with:
```js
const TAINTING_TOOLS = new Set([
  'web_search',
  'messages_getRecent', 'messages_getUnread', 'messages_search',
  'mail_getUnread', 'mail_getLatest',
  // Live volatile data — never goes to memory
  'system_status',
  'strom_current',
  'homeassistant_state', 'homeassistant_call'
])
```

(Names must match actual tool names registered in the registry. Verify by running `node -e "console.log(require('./src/main/modules/registry.js'))"` or equivalent — adjust if a name differs.)

- [ ] **Step 2: Commit**

```bash
git add src/main/ipc.js
git commit -m "feat(memworker): add system, strom, HA tools to tainting set"
```

---

### Task 4.7: Add gemma3:4b model dropdown to Settings

**Files:**
- Modify: `src/main/store.js` (default value for `memoryWorkerModel`)
- Modify: `src/renderer/components/Settings.jsx` (new dropdown)
- Modify: `src/main/modules/obsidianGraph.js` and `memoryWorker.js` (use the setting)

- [ ] **Step 1: Update default in store**

In `src/main/store.js`, find the existing `memoryWorkerModel` default (or add it if absent):
```js
memoryWorkerModel: 'gemma3:4b',
```

- [ ] **Step 2: Add dropdown in Settings.jsx**

Find the "Dienste" section. Add:
```jsx
<label>Knowledge-Graph Modell</label>
<select
  value={local.memoryWorkerModel || 'gemma3:4b'}
  onChange={e => update('memoryWorkerModel', e.target.value)}
>
  <option value="gemma3:4b">gemma3:4b (Default — beste deutsche Qualität, schnell)</option>
  <option value="qwen3:4b">qwen3:4b</option>
  <option value="qwen3:8b">qwen3:8b (max Qualität, +2 s pro Run)</option>
  <option value="qwen2.5:3b">qwen2.5:3b (veraltet)</option>
</select>
```

- [ ] **Step 3: Verify use sites**

In `obsidianGraph.js`, `mirrorFactToGraph` already takes `model`. In `memoryWorker.js`, `runConsolidation` reads `settings.memoryWorkerModel`. Both already correct — just confirm.

- [ ] **Step 4: Manual smoke test**

Build, set model to `gemma3:4b`. Check: `ollama list` shows it (if not: `ollama pull gemma3:4b`). Trigger a chat, watch console for `[MemWorker] extrahiere mit gemma3:4b`.

- [ ] **Step 5: Commit**

```bash
git add src/main/store.js src/renderer/components/Settings.jsx
git commit -m "feat(settings): default to gemma3:4b for graph extraction"
```

---

### Task 4.8: Snapshot test suite for entity extraction quality

**Files:**
- Create: `src/main/modules/__tests__/extractionQuality.test.js`

- [ ] **Step 1: Write tests against `looksLikeFact` and `postFilter`**

```js
import { describe, it, expect } from 'vitest'
import { _internal } from '../memoryWorker.js'
import { isHardRejected, forceCategoryFor } from '../obsidianGraph.js'

describe('memworker fact filter snapshot', () => {
  const reject = [
    "Alex' Mac CPU-Auslastung liegt bei 24%",
    "Alex' Mac hat den Arbeitsspeicher zu 47% ausgelastet",
    "Alex' Mac hat einen voll geladenen Akku",
    "Alex hat den Kontaktnamen 'Prompt Rocker' gespeichert",
    "Aktueller Stromverbrauch ist 1104 Watt",
    "Wetter morgen 18 Grad sonnig",
    "Alex hat 2 Termine heute",
    "Alex' Mac läuft gut mit einer CPU-Auslastung von 24%"
  ]
  const accept = [
    "Toni ist Alex' Bruder",
    "Toni arbeitet in Linz",
    "Alex trinkt morgens Espresso",
    "Bello ist Alex' Hund",
    "Alex hört gerne Iron Maiden"
  ]
  for (const r of reject) it(`rejects: "${r}"`, () => expect(_internal.looksLikeFact(r)).toBe(false))
  for (const a of accept) it(`accepts: "${a}"`, () => expect(_internal.looksLikeFact(a)).toBe(true))
})

describe('graph hard-reject snapshot', () => {
  const cases = [
    ['+436602660062', true], ['b@x.de', true], ['1. August 2006', true],
    ['CPU', true], ['Plus', true], ['Pro', true], ['Enterprise', true],
    ['GPT-5.5', true], ['2026', true],
    ['OpenAI', false], ['Alex Januschewsky', false], ['Salzburg', false]
  ]
  for (const [name, expected] of cases) {
    it(`${expected ? 'rejects' : 'keeps'}: "${name}"`, () => expect(isHardRejected(name)).toBe(expected))
  }
})

describe('domain forcing', () => {
  it('forces 9to5google.com → Quellen', () => expect(forceCategoryFor('9to5google.com', 'Themen')).toBe('Quellen'))
  it('forces digitalhandwerk.rocks → Quellen', () => expect(forceCategoryFor('digitalhandwerk.rocks', 'Orte')).toBe('Quellen'))
})
```

- [ ] **Step 2: Run + commit**

```bash
npm test -- extractionQuality
git add src/main/modules/__tests__/extractionQuality.test.js
git commit -m "test(graph): snapshot suite for entity extraction quality"
```

---

## Phase 5 — One-shot cleaner (Spec §4.4.1)

### Task 5.1: Cleaner module skeleton with proposal types

**Files:**
- Create: `src/main/modules/graphCleaner.js`
- Create: `src/main/modules/__tests__/cleanerScan.test.js`

- [ ] **Step 1: Define structure**

Create `src/main/modules/graphCleaner.js`:
```js
// One-shot cleaner for the existing knowledge graph.
// Three phases: scan (read-only), review (UI), apply (with backup).

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import axios from 'axios'
import { VALID_CATS, isDomain } from './_graphCategories.js'
import { isHardRejected, forceCategoryFor } from './obsidianGraph.js'
import { zipDirectory } from './_vaultMigration.js'

const OLLAMA_URL = 'http://localhost:11434'

// Proposal kinds: 'merge' | 'recategorize' | 'trash' | 'rename' | 'alias'

export async function scanVault(vaultPath, model = 'gemma3:4b') {
  // implemented in 5.2
}

export async function applyPlan(vaultPath, plan, options = {}) {
  // implemented in 5.4
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/modules/graphCleaner.js
git commit -m "feat(cleaner): module skeleton with proposal kinds"
```

---

### Task 5.2: Implement scan phase

**Files:**
- Modify: `src/main/modules/graphCleaner.js`
- Modify: `src/main/modules/__tests__/cleanerScan.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanVaultLocal } from '../graphCleaner.js'

const VAULT = join(tmpdir(), 'vinci-cleaner-scan')
const G = join(VAULT, 'VINCI')

function setup() {
  rmSync(VAULT, { recursive: true, force: true })
  for (const c of ['Personen','Themen','Orte','Firmen']) mkdirSync(join(G, c), { recursive: true })
}

describe('scanVaultLocal (no LLM)', () => {
  beforeEach(setup)
  afterEach(() => rmSync(VAULT, { recursive: true, force: true }))

  it('proposes trash for hard-rejected names', () => {
    writeFileSync(join(G, 'Personen/Plus.md'), '---\n---\n# Plus\n\n- bullet\n')
    writeFileSync(join(G, 'Themen/+436602660062.md'), '---\n---\n# +436602660062\n')
    const plan = scanVaultLocal(VAULT)
    expect(plan.proposals.filter(p => p.kind === 'trash')).toHaveLength(2)
  })

  it('proposes recategorize for domain in non-Quellen folder', () => {
    writeFileSync(join(G, 'Themen/9to5google.com.md'), '---\n---\n# 9to5google.com\n')
    const plan = scanVaultLocal(VAULT)
    expect(plan.proposals).toContainEqual(expect.objectContaining({
      kind: 'recategorize', to: expect.stringContaining('Quellen/9to5google.com.md')
    }))
  })

  it('proposes merge for first-name + full-name pair', () => {
    writeFileSync(join(G, 'Personen/Alex.md'), '---\n---\n# Alex\n\n- bullet1\n')
    writeFileSync(join(G, 'Personen/Alex Januschewsky.md'), '---\n---\n# Alex Januschewsky\n\n- bullet2\n')
    const plan = scanVaultLocal(VAULT)
    expect(plan.proposals).toContainEqual(expect.objectContaining({
      kind: 'merge',
      into: expect.stringContaining('Alex Januschewsky.md')
    }))
  })
})
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement**

Add to `graphCleaner.js`:
```js
function listEntries(vault) {
  const root = join(vault, 'VINCI')
  const out = []
  for (const cat of VALID_CATS) {
    const dir = join(root, cat)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      out.push({ category: cat, name: f.replace(/\.md$/, ''), full: join(dir, f) })
    }
  }
  return out
}

export function scanVaultLocal(vaultPath) {
  const entries = listEntries(vaultPath)
  const proposals = []
  const byName = new Map(entries.map(e => [e.name.toLowerCase(), e]))

  for (const e of entries) {
    // Trash: hard-reject
    if (isHardRejected(e.name)) {
      proposals.push({
        kind: 'trash', file: e.full,
        reason: `Name matched hard-reject filter (phone/email/date/tier/system/etc.)`
      })
      continue
    }
    // Recategorize: domain in wrong category
    const forced = forceCategoryFor(e.name, e.category)
    if (forced !== e.category) {
      proposals.push({
        kind: 'recategorize',
        from: e.full,
        to: e.full.replace(`/${e.category}/`, `/${forced}/`),
        reason: forced === 'Quellen' ? 'News-Domain' : `Force-cat ${forced}`
      })
      continue
    }
    // Merge: first-name + full-name pair
    if (e.name.includes(' ')) {
      const first = e.name.split(' ')[0].toLowerCase()
      const partner = byName.get(first)
      if (partner && partner.full !== e.full) {
        proposals.push({
          kind: 'merge',
          from: [partner.full],
          into: e.full,
          reason: 'Vorname ist Alias des vollen Namens'
        })
      }
    }
  }
  return { scanned: entries.length, proposals }
}

export async function scanVault(vaultPath, model = 'gemma3:4b') {
  // Local heuristic pass (deterministic). LLM-based proposals are an optional second pass — skipped in v1.
  return scanVaultLocal(vaultPath)
}
```

- [ ] **Step 4: Test + commit**

```bash
npm test -- cleanerScan
git add src/main/modules/graphCleaner.js src/main/modules/__tests__/cleanerScan.test.js
git commit -m "feat(cleaner): implement scan phase with deterministic heuristics"
```

---

### Task 5.3: Persist cleanup plan

**Files:**
- Modify: `src/main/modules/graphCleaner.js`

- [ ] **Step 1: Add persistence helpers**

Add to `graphCleaner.js`:
```js
function planFilePath() {
  const stamp = new Date().toISOString().slice(0, 10)
  const dir = join(homedir(), 'Library', 'Application Support', 'vinci')
  mkdirSync(dir, { recursive: true })
  return join(dir, `cleanup-plan-${stamp}.json`)
}

export function savePlan(plan) {
  const path = planFilePath()
  writeFileSync(path, JSON.stringify(plan, null, 2), 'utf8')
  return path
}

export function loadLatestPlan() {
  const dir = join(homedir(), 'Library', 'Application Support', 'vinci')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter(f => f.startsWith('cleanup-plan-') && f.endsWith('.json')).sort()
  if (!files.length) return null
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'))
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/modules/graphCleaner.js
git commit -m "feat(cleaner): persist plan to Application Support/vinci"
```

---

### Task 5.4: Implement apply phase with backup + atomic per-proposal

**Files:**
- Modify: `src/main/modules/graphCleaner.js`
- Create: `src/main/modules/__tests__/cleanerApply.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { applyPlanLocal } from '../graphCleaner.js'

const VAULT = join(tmpdir(), 'vinci-cleaner-apply')
const G = join(VAULT, 'VINCI')

beforeEach(() => {
  rmSync(VAULT, { recursive: true, force: true })
  for (const c of ['Personen','Themen','Quellen','_quarantine']) mkdirSync(join(G, c), { recursive: true })
})
afterEach(() => rmSync(VAULT, { recursive: true, force: true }))

describe('applyPlanLocal', () => {
  it('trash moves file to _quarantine', async () => {
    writeFileSync(join(G, 'Personen/Plus.md'), '# Plus')
    const plan = { proposals: [{ kind: 'trash', file: join(G, 'Personen/Plus.md'), reason: 'tier' }] }
    const r = await applyPlanLocal(VAULT, plan)
    expect(existsSync(join(G, 'Personen/Plus.md'))).toBe(false)
    expect(existsSync(join(G, '_quarantine/Personen/Plus.md'))).toBe(true)
    expect(r.applied).toBe(1)
  })

  it('recategorize moves file to new folder', async () => {
    writeFileSync(join(G, 'Themen/9to5.com.md'), '# 9to5.com')
    const plan = { proposals: [{
      kind: 'recategorize',
      from: join(G, 'Themen/9to5.com.md'),
      to: join(G, 'Quellen/9to5.com.md'),
      reason: 'domain'
    }] }
    await applyPlanLocal(VAULT, plan)
    expect(existsSync(join(G, 'Themen/9to5.com.md'))).toBe(false)
    expect(existsSync(join(G, 'Quellen/9to5.com.md'))).toBe(true)
  })

  it('merge appends bullets and quarantines source', async () => {
    writeFileSync(join(G, 'Personen/Alex.md'), '---\n---\n# Alex\n\n- **27.04** — Alex liebt Musik.\n')
    writeFileSync(join(G, 'Personen/Alex Januschewsky.md'), '---\n---\n# Alex Januschewsky\n\n- **20.04** — Wohnt in Salzburg.\n')
    const plan = { proposals: [{
      kind: 'merge',
      from: [join(G, 'Personen/Alex.md')],
      into: join(G, 'Personen/Alex Januschewsky.md'),
      reason: 'alias'
    }] }
    await applyPlanLocal(VAULT, plan)
    const merged = readFileSync(join(G, 'Personen/Alex Januschewsky.md'), 'utf8')
    expect(merged).toContain('liebt Musik')
    expect(merged).toContain('Salzburg')
    expect(existsSync(join(G, 'Personen/Alex.md'))).toBe(false)
    expect(existsSync(join(G, '_quarantine/Personen/Alex.md'))).toBe(true)
  })

  it('skips proposals not marked as accepted (when accept-list given)', async () => {
    writeFileSync(join(G, 'Personen/Plus.md'), '# Plus')
    const plan = { proposals: [
      { id: 'p1', kind: 'trash', file: join(G, 'Personen/Plus.md'), accepted: false }
    ]}
    await applyPlanLocal(VAULT, plan)
    expect(existsSync(join(G, 'Personen/Plus.md'))).toBe(true)
  })
})
```

- [ ] **Step 2: Implement**

```js
function quarantine(vault, file) {
  const cat = basename(join(file, '..'))
  const quarDir = join(vault, 'VINCI', '_quarantine', cat)
  mkdirSync(quarDir, { recursive: true })
  renameSync(file, join(quarDir, basename(file)))
}

function bulletsOf(content) { return content.split('\n').filter(l => l.trim().startsWith('- ')) }

export async function applyPlanLocal(vaultPath, plan) {
  const report = { applied: 0, skipped: 0, errors: [] }
  // Run in order: alias → merge → recategorize → rename → trash
  const order = ['alias', 'merge', 'recategorize', 'rename', 'trash']
  for (const kind of order) {
    for (const p of plan.proposals.filter(x => x.kind === kind)) {
      if ('accepted' in p && p.accepted === false) { report.skipped++; continue }
      try {
        if (kind === 'trash') {
          quarantine(vaultPath, p.file)
        } else if (kind === 'recategorize' || kind === 'rename') {
          mkdirSync(join(p.to, '..'), { recursive: true })
          renameSync(p.from, p.to)
        } else if (kind === 'merge') {
          const target = readFileSync(p.into, 'utf8')
          const targetBullets = bulletsOf(target)
          let extra = []
          for (const src of p.from) {
            const srcContent = readFileSync(src, 'utf8')
            extra.push(...bulletsOf(srcContent).filter(b => !targetBullets.includes(b)))
            quarantine(vaultPath, src)
          }
          if (extra.length) {
            const sep = target.endsWith('\n') ? '' : '\n'
            writeFileSync(p.into, target + sep + extra.join('\n') + '\n', 'utf8')
          }
        } else if (kind === 'alias') {
          // alias proposals are handled by aliasBuilder during merge; here we just register them
          // (skip — _aliases.json is rewritten in Task 5.5)
        }
        report.applied++
      } catch (err) {
        report.errors.push({ proposal: p, error: err.message })
      }
    }
  }
  return report
}

export async function applyPlan(vaultPath, plan, { dryRun = true } = {}) {
  if (!dryRun) {
    const stamp = new Date().toISOString().slice(0, 10)
    const archive = join(homedir(), '.vinci-archive', `cleanup-${stamp}.zip`)
    mkdirSync(join(homedir(), '.vinci-archive'), { recursive: true })
    await zipDirectory(join(vaultPath, 'VINCI'), archive)
  }
  if (dryRun) return { dryRun: true, would_apply: plan.proposals.length }
  return await applyPlanLocal(vaultPath, plan)
}
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- cleanerApply
git add src/main/modules/graphCleaner.js src/main/modules/__tests__/cleanerApply.test.js
git commit -m "feat(cleaner): apply phase with backup, _quarantine trash, atomic per-proposal"
```

---

### Task 5.5: Build review modal UI

**Files:**
- Modify: `src/main/ipc.js`, `src/main/preload.js`
- Modify: `src/renderer/components/Settings.jsx`

- [ ] **Step 1: IPC**

```js
import { scanVault, applyPlan, savePlan } from './modules/graphCleaner.js'

ipcMain.handle('cleanerScan', async () => {
  const settings = getSettings()
  const vault = settings.obsidian?.vaultPath
  if (!vault) return { error: 'Kein Vault.' }
  const plan = await scanVault(vault, settings.memoryWorkerModel)
  // attach IDs and default-accepted flag for UI
  plan.proposals = plan.proposals.map((p, i) => ({ ...p, id: `p${i}`, accepted: true }))
  savePlan(plan)
  return plan
})

ipcMain.handle('cleanerApply', async (_e, plan, opts = { dryRun: true }) => {
  const settings = getSettings()
  const vault = settings.obsidian?.vaultPath
  if (!vault) return { error: 'Kein Vault.' }
  return await applyPlan(vault, plan, opts)
})
```

- [ ] **Step 2: Preload**

```js
cleanerScan: () => ipcRenderer.invoke('cleanerScan'),
cleanerApply: (plan, opts) => ipcRenderer.invoke('cleanerApply', plan, opts)
```

- [ ] **Step 3: Settings UI**

Add a section "Knowledge-Graph aufräumen":
```jsx
const [plan, setPlan] = useState(null)
const [report, setReport] = useState(null)

async function scan() { setPlan(await window.lyra.cleanerScan()) }
function toggle(id) { setPlan({ ...plan, proposals: plan.proposals.map(p => p.id === id ? { ...p, accepted: !p.accepted } : p) }) }
async function dry() { setReport(await window.lyra.cleanerApply(plan, { dryRun: true })) }
async function apply() {
  if (!confirm('Echter Lauf — Backup wird erstellt. Sicher?')) return
  setReport(await window.lyra.cleanerApply(plan, { dryRun: false }))
}

// JSX:
<button onClick={scan}>1. Vault scannen</button>
{plan?.proposals?.map(p => (
  <div key={p.id} className="proposal-card">
    <label>
      <input type="checkbox" checked={p.accepted} onChange={() => toggle(p.id)} />
      <strong>{p.kind}</strong>: {p.reason}
    </label>
    <pre>{JSON.stringify(p, null, 2)}</pre>
  </div>
))}
{plan && <button onClick={dry}>2. Dry-Run</button>}
{plan && <button onClick={apply}>3. Echt anwenden (mit Backup)</button>}
{report && <pre>{JSON.stringify(report, null, 2)}</pre>}
```

- [ ] **Step 4: Manual smoke test**

Run dev build. Click scan → see proposals. Toggle some off. Run dry → no file changes. Run apply → verify `_quarantine/` populated, backup zip exists.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.js src/main/preload.js src/renderer/components/Settings.jsx
git commit -m "feat(cleaner): wire scan/apply UI with per-proposal toggle"
```

---

## Phase 6 — Blog importer (Spec §4.2)

### Task 6.1: Source schema and module skeleton

**Files:**
- Create: `src/main/modules/blogImporter.js`
- Modify: `src/main/store.js` (add `blogSources` default)

- [ ] **Step 1: Add default source**

In `store.js` defaults:
```js
blogSources: [
  {
    id: 'digitalhandwerk',
    type: 'wordpress',
    baseUrl: 'https://digitalhandwerk.rocks',
    vaultFolder: 'RSS/digitalhandwerk',
    authorWikilink: '[[Alex Januschewsky]]',
    cacheImages: false,
    enabled: true
  }
]
```

- [ ] **Step 2: Module skeleton**

Create `src/main/modules/blogImporter.js`:
```js
import axios from 'axios'
import TurndownService from 'turndown'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

export async function runOnce(source, vaultPath, opts = {}) { /* implemented in Task 6.5 */ }
export function readVaultCursor(folder) { /* implemented in Task 6.3 */ }
export async function fetchPostsSince(source, sinceIso) { /* implemented in Task 6.2 */ }
export function htmlToMarkdown(html) { /* implemented in Task 6.4 */ }
export function buildPostFile(post, source, taxonomy) { /* implemented in Task 6.4 */ }
```

- [ ] **Step 3: Commit**

```bash
git add src/main/modules/blogImporter.js src/main/store.js
git commit -m "feat(blog): module skeleton + default source for digitalhandwerk"
```

---

### Task 6.2: Implement REST fetcher with pagination

**Files:**
- Modify: `src/main/modules/blogImporter.js`
- Create: `src/main/modules/__tests__/blogFetcher.test.js`

- [ ] **Step 1: Write test using axios mock adapter**

```bash
npm install --save-dev axios-mock-adapter
```

```js
import { describe, it, expect } from 'vitest'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { fetchPostsSince } from '../blogImporter.js'

describe('fetchPostsSince', () => {
  it('paginates and stops when no more pages', async () => {
    const mock = new MockAdapter(axios)
    mock.onGet(/\/wp-json\/wp\/v2\/posts/).reply((cfg) => {
      const url = new URL(cfg.url, 'https://x.com')
      const page = parseInt(url.searchParams.get('page') || '1')
      const headers = { 'x-wp-totalpages': '2', 'x-wp-total': '3' }
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
    mock.restore()
  })

  it('filters by sinceIso', async () => {
    const mock = new MockAdapter(axios)
    mock.onGet(/posts/).reply(200, [
      { id: 1, slug: 'old', date: '2026-04-01T00:00:00', modified: '2026-04-01T00:00:00', title: { rendered: 'Old' }, content: { rendered: '' }, link: '', categories: [], tags: [] },
      { id: 2, slug: 'new', date: '2026-05-05T00:00:00', modified: '2026-05-05T00:00:00', title: { rendered: 'New' }, content: { rendered: '' }, link: '', categories: [], tags: [] }
    ], { 'x-wp-totalpages': '1' })
    const posts = await fetchPostsSince({ baseUrl: 'https://x.com', type: 'wordpress' }, '2026-05-01T00:00:00Z')
    expect(posts).toHaveLength(1)
    expect(posts[0].slug).toBe('new')
    mock.restore()
  })
})
```

- [ ] **Step 2: Implement**

```js
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
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- blogFetcher
git add src/main/modules/blogImporter.js src/main/modules/__tests__/blogFetcher.test.js package.json package-lock.json
git commit -m "feat(blog): REST fetcher with pagination + sinceIso filter"
```

---

### Task 6.3: Vault cursor — read max published from existing files

**Files:**
- Modify: `src/main/modules/blogImporter.js`
- Modify: `src/main/modules/__tests__/blogFetcher.test.js`

- [ ] **Step 1: Test**

```js
import { readVaultCursor } from '../blogImporter.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'

const D = join(tmpdir(), 'vinci-cursor-test')
beforeEach(() => { rmSync(D, { recursive: true, force: true }); mkdirSync(D, { recursive: true }) })
afterEach(() => rmSync(D, { recursive: true, force: true }))

describe('readVaultCursor', () => {
  it('returns null for empty folder', () => {
    expect(readVaultCursor(D)).toBeNull()
  })
  it('returns max published from frontmatter', () => {
    writeFileSync(join(D, 'a.md'), '---\npublished: "2026-04-01T00:00:00Z"\n---\n')
    writeFileSync(join(D, 'b.md'), '---\npublished: "2026-05-05T12:00:00Z"\n---\n')
    writeFileSync(join(D, 'c.md'), '---\npublished: "2026-04-15T00:00:00Z"\n---\n')
    expect(readVaultCursor(D)).toBe('2026-05-05T12:00:00Z')
  })
})
```

- [ ] **Step 2: Implement**

```js
export function readVaultCursor(folder) {
  if (!existsSync(folder)) return null
  let max = null
  for (const f of readdirSync(folder)) {
    if (!f.endsWith('.md')) continue
    const head = readFileSync(join(folder, f), 'utf8').slice(0, 1500)
    const m = head.match(/^published:\s*["']?([^"'\n]+)["']?/m)
    if (m) {
      if (!max || new Date(m[1]) > new Date(max)) max = m[1]
    }
  }
  return max
}
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- blogFetcher
git add src/main/modules/blogImporter.js src/main/modules/__tests__/blogFetcher.test.js
git commit -m "feat(blog): vault-derived cursor (max published)"
```

---

### Task 6.4: HTML→Markdown + post file builder

**Files:**
- Modify: `src/main/modules/blogImporter.js`
- Create: `src/main/modules/__tests__/blogBuilder.test.js`

- [ ] **Step 1: Write test**

```js
import { describe, it, expect } from 'vitest'
import { htmlToMarkdown, buildPostFile } from '../blogImporter.js'

describe('htmlToMarkdown', () => {
  it('converts headings and emphasis', () => {
    const md = htmlToMarkdown('<h2>Title</h2><p>Hello <b>world</b>.</p>')
    expect(md).toContain('## Title')
    expect(md).toContain('**world**')
  })
  it('strips WP shortcodes', () => {
    const md = htmlToMarkdown('[caption id="x"]<img src="a.jpg"/> Bild[/caption]')
    expect(md).not.toContain('[caption')
    expect(md).toContain('![](a.jpg)')
  })
  it('decodes entities', () => {
    expect(htmlToMarkdown('<p>Tom &amp; Jerry</p>')).toContain('Tom & Jerry')
  })
})

describe('buildPostFile', () => {
  it('produces file with required frontmatter', () => {
    const post = {
      id: 9965,
      slug: '500-artikel',
      date: '2026-05-06T14:33:51',
      modified: '2026-05-06T14:33:51',
      title: { rendered: '500 Artikel' },
      content: { rendered: '<p>Body</p>' },
      link: 'https://digitalhandwerk.rocks/500-artikel/',
      categories: [], tags: []
    }
    const source = { id: 'digitalhandwerk', baseUrl: 'https://digitalhandwerk.rocks', authorWikilink: '[[Alex Januschewsky]]' }
    const { filename, content } = buildPostFile(post, source, { categories: {}, tags: {} })
    expect(filename).toBe('500-artikel.md')
    expect(content).toContain('wp_id: 9965')
    expect(content).toContain('author: "[[Alex Januschewsky]]"')
    expect(content).toContain('# 500 Artikel')
  })
})
```

- [ ] **Step 2: Implement**

```js
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '_' })
turndown.addRule('stripCaptions', {
  filter: (node) => node.nodeName === 'P' && /^\[caption/.test(node.textContent),
  replacement: (content) => content.replace(/^\[caption[^\]]*\]/, '').replace(/\[\/caption\]$/, '')
})

export function htmlToMarkdown(html) {
  if (!html) return ''
  // Strip WP shortcodes around content (caption attaches before tags)
  const cleaned = String(html)
    .replace(/\[caption[^\]]*\]/g, '')
    .replace(/\[\/caption\]/g, '')
  return turndown.turndown(cleaned)
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&uuml;/g,'ü').replace(/&auml;/g,'ä').replace(/&ouml;/g,'ö').replace(/&szlig;/g,'ß')
}

function formatGermanDate(iso) {
  const d = new Date(iso)
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
  return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`
}

export function buildPostFile(post, source, taxonomy = { categories: {}, tags: {} }) {
  const title = decodeEntities(post.title.rendered)
  const slug = post.slug
  const url = post.link
  const published = post.date.endsWith('Z') ? post.date : post.date + 'Z'
  const modified = (post.modified || post.date).endsWith('Z') ? (post.modified || post.date) : (post.modified || post.date) + 'Z'
  const cats = (post.categories || []).map(id => taxonomy.categories[id] || `cat-${id}`)
  const tags = (post.tags || []).map(id => taxonomy.tags[id] || `tag-${id}`)
  const allTags = ['rss','auto-import', source.id, ...tags]
  const body = htmlToMarkdown(post.content?.rendered || '')

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `source: "${new URL(url).hostname}"`,
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

  const content = `${frontmatter}\n\n# ${title}\n\n**Quelle:** [${new URL(url).hostname}](${url})\n**Veröffentlicht:** ${formatGermanDate(published)}\n\n${body}\n`
  return { filename: `${slug}.md`, content }
}
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- blogBuilder
git add src/main/modules/blogImporter.js src/main/modules/__tests__/blogBuilder.test.js
git commit -m "feat(blog): HTML→Markdown + post-file builder"
```

---

### Task 6.5: runOnce orchestration + dedup/update

**Files:**
- Modify: `src/main/modules/blogImporter.js`

- [ ] **Step 1: Add taxonomy fetcher**

```js
async function fetchTaxonomy(source) {
  const out = { categories: {}, tags: {} }
  for (const kind of ['categories', 'tags']) {
    let page = 1, totalPages = 1
    while (page <= totalPages) {
      const res = await axios.get(`${source.baseUrl}/wp-json/wp/v2/${kind}`, {
        params: { per_page: 100, page, _fields: 'id,slug,name' }, timeout: 20_000
      })
      totalPages = parseInt(res.headers['x-wp-totalpages'] || '1')
      for (const t of res.data) out[kind][t.id] = t.slug
      page++
    }
  }
  return out
}
```

- [ ] **Step 2: Add runOnce**

```js
export async function runOnce(source, vaultPath, { force = false, dryRun = false } = {}) {
  const folder = join(vaultPath, source.vaultFolder)
  mkdirSync(folder, { recursive: true })
  const cursor = force ? null : readVaultCursor(folder)
  const taxonomy = await fetchTaxonomy(source)
  const posts = await fetchPostsSince(source, cursor)

  const result = {
    source: source.id,
    total_remote: null,
    total_local_before: readdirSync(folder).filter(f => f.endsWith('.md')).length,
    fetched: posts.length,
    newly_created: 0,
    updated: 0,
    skipped_unchanged: 0,
    errors: [],
    newest_post: null
  }

  let newest = null
  for (const p of posts) {
    try {
      const { filename, content } = buildPostFile(p, source, taxonomy)
      const target = join(folder, filename)
      if (existsSync(target)) {
        const head = readFileSync(target, 'utf8').slice(0, 2000)
        const m = head.match(/^modified:\s*["']?([^"'\n]+)/m)
        const localModified = m ? m[1] : null
        if (localModified && new Date(p.modified) <= new Date(localModified) && !force) {
          result.skipped_unchanged++; continue
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
  if (newest) result.newest_post = decodeEntities(newest.title.rendered)
  return result
}
```

- [ ] **Step 3: Manual smoke test**

Build, ensure vault path is canonical, run from devtools console:
```js
window.lyra.blogSyncManual?.()  // wired in next task
```

Or test directly via REPL/Node:
```bash
node --experimental-vm-modules -e "
  import('./src/main/modules/blogImporter.js').then(async m => {
    const r = await m.runOnce(
      { id: 'digitalhandwerk', baseUrl: 'https://digitalhandwerk.rocks', vaultFolder: 'RSS/digitalhandwerk', authorWikilink: '[[Alex Januschewsky]]' },
      '/Users/alexjanuschewsky/Documents/VINCI Vault',
      { dryRun: true }
    )
    console.log(JSON.stringify(r, null, 2))
  })
"
```

Expected: `fetched: 4`, `newly_created` for the 4 missing posts, `skipped_unchanged: 0` (because cursor filters them out before fetch).

- [ ] **Step 4: Commit**

```bash
git add src/main/modules/blogImporter.js
git commit -m "feat(blog): runOnce orchestration with dedup, update, dry-run"
```

---

### Task 6.6: Wire blog_sync tool + Settings button + Cron task type

**Files:**
- Modify: `src/main/modules/blogImporter.js` (export module shape)
- Modify: `src/main/modules/registry.js` (register module)
- Modify: `src/main/modules/gemini.js` (add trigger phrase)
- Modify: `src/main/ipc.js`, `src/main/preload.js`, `src/renderer/components/Settings.jsx`
- Modify: `src/main/scheduler.js` (add task type)

- [ ] **Step 1: Export module + tool**

In `blogImporter.js`:
```js
export const blogImporterModule = {
  name: 'blog',
  description: 'Blog-Posts via WordPress-REST in den Vault holen.',
  actions: {
    sync: async ({ sourceId, force = false } = {}, ctx) => {
      const sources = ctx?.settings?.blogSources || []
      const source = sourceId ? sources.find(s => s.id === sourceId) : sources.find(s => s.enabled)
      if (!source) return { error: 'Keine Blog-Source konfiguriert.' }
      const vault = ctx?.settings?.obsidian?.vaultPath
      if (!vault) return { error: 'Kein Vault.' }
      return await runOnce(source, vault, { force })
    }
  },
  tools: [{
    name: 'blog_sync',
    description: 'Holt neue Blog-Posts von der konfigurierten WordPress-Quelle (Default: digitalhandwerk). Idempotent, nur Delta. Trigger: "sync blog", "hol meine artikel", "blog aktualisieren", "neue posts ziehen".',
    parameters: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Optional Source-ID' },
        force:    { type: 'boolean', description: 'true = alle Posts neu' }
      }
    }
  }]
}
```

- [ ] **Step 2: Register**

In `registry.js`, import and add to module list:
```js
import { blogImporterModule } from './blogImporter.js'
// ...
this.register(blogImporterModule)
```

- [ ] **Step 3: Update Gemini prompt**

In `gemini.js` system prompt, add a section near the other tool sections:
```
BLOG-SYNC (blog_sync):
- Bei "sync blog", "hol meine artikel", "blog aktualisieren", "neue posts ziehen", "lad meine blogposts" → IMMER blog_sync aufrufen.
- Nach erfolgreichem Sync: kurz auf Deutsch bestätigen mit der Zahl der neuen Posts und dem neuesten Titel.
```

- [ ] **Step 4: Settings button + cron task type**

In Settings.jsx:
```jsx
const [blogResult, setBlogResult] = useState(null)
async function syncBlog() {
  setBlogResult(await window.lyra.blogSync?.())
}
// JSX:
<button onClick={syncBlog}>Jetzt holen (digitalhandwerk)</button>
{blogResult && <pre>{JSON.stringify(blogResult, null, 2)}</pre>}
```

In ipc.js:
```js
import { runOnce as blogRunOnce } from './modules/blogImporter.js'
ipcMain.handle('blogSync', async () => {
  const settings = getSettings()
  const source = (settings.blogSources || []).find(s => s.enabled)
  if (!source) return { error: 'Keine Source.' }
  return await blogRunOnce(source, settings.obsidian?.vaultPath)
})
```

In preload.js: `blogSync: () => ipcRenderer.invoke('blogSync')`.

- [ ] **Step 5: Cron task type**

Open `src/main/scheduler.js` and `src/main/tasks.js` — these run the user's scheduled prompts via cron. Inspect the existing task-execution path (likely in `taskExecutor.js`). Add a new task kind / type discriminator (e.g. `taskType: 'blog-sync'`) that, instead of running a Gemini prompt, directly calls `blogRunOnce(source, vaultPath)` with the first enabled source. The Tasks-tab UI in `src/renderer/components/Tasks.jsx` gets a new option in the task-type dropdown labeled "Blog-Sync (digitalhandwerk)". Default cron: `0 9 * * *` (daily 09:00).

- [ ] **Step 6: Manual smoke test**

Click "Jetzt holen" → expect 4 new posts in `RSS/digitalhandwerk/` + report. Voice: "VINCI, hol meine blog-posts" → same. Type "sync blog" in chat → same.

- [ ] **Step 7: Commit**

```bash
git add src/main/modules/blogImporter.js src/main/modules/registry.js src/main/modules/gemini.js src/main/ipc.js src/main/preload.js src/renderer/components/Settings.jsx src/main/scheduler.js
git commit -m "feat(blog): wire blog_sync tool + Settings + cron + Gemini trigger"
```

---

## Phase 7 — Body Wikilink pass (Spec §4.4.2)

### Task 7.1: Entity inventory loader

**Files:**
- Modify: `src/main/modules/graphCleaner.js` (or new `_wikilinkEngine.js`)

**Decision:** Create `_wikilinkEngine.js` for clean separation.

- [ ] **Step 1: Test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadEntityInventory } from '../_wikilinkEngine.js'

const V = join(tmpdir(), 'vinci-inv-test')
beforeEach(() => {
  rmSync(V, { recursive: true, force: true })
  mkdirSync(join(V, 'VINCI/Personen'), { recursive: true })
  mkdirSync(join(V, 'VINCI/Firmen'), { recursive: true })
  writeFileSync(join(V, 'VINCI/Personen/Alex Januschewsky.md'), '---\n---\n# Alex Januschewsky')
  writeFileSync(join(V, 'VINCI/Firmen/OpenAI.md'), '---\n---\n# OpenAI')
  writeFileSync(join(V, 'VINCI/_aliases.json'), JSON.stringify({ 'Alex Januschewsky': ['Alex'] }))
})
afterEach(() => rmSync(V, { recursive: true, force: true }))

describe('loadEntityInventory', () => {
  it('returns canonical names and aliases sorted by length desc', () => {
    const inv = loadEntityInventory(V)
    expect(inv.find(e => e.term === 'Alex Januschewsky')).toBeDefined()
    expect(inv.find(e => e.term === 'OpenAI')).toBeDefined()
    expect(inv.find(e => e.term === 'Alex' && e.canonical === 'Alex Januschewsky')).toBeDefined()
    // Length sort
    expect(inv[0].term.length).toBeGreaterThanOrEqual(inv[inv.length - 1].term.length)
  })
})
```

- [ ] **Step 2: Implement**

Create `src/main/modules/_wikilinkEngine.js`:
```js
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ENTITY_CATS = ['Personen', 'Firmen', 'Quellen']

export function loadEntityInventory(vaultPath) {
  const root = join(vaultPath, 'VINCI')
  const items = []
  for (const cat of ENTITY_CATS) {
    const dir = join(root, cat)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const name = f.replace(/\.md$/, '')
      items.push({ term: name, canonical: name, category: cat })
    }
  }
  // Aliases
  const aliasFile = join(root, '_aliases.json')
  if (existsSync(aliasFile)) {
    try {
      const data = JSON.parse(readFileSync(aliasFile, 'utf8'))
      for (const [canonical, aliases] of Object.entries(data)) {
        for (const a of (aliases || [])) {
          items.push({ term: a, canonical, category: 'alias' })
        }
      }
    } catch {}
  }
  return items.sort((a, b) => b.term.length - a.term.length)
}
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- _wikilinkEngine
git add src/main/modules/_wikilinkEngine.js src/main/modules/__tests__/wikilinkEngine.test.js
git commit -m "feat(wikilink): entity inventory loader"
```

---

### Task 7.2: Wikilink replacer (idempotent, first-occurrence-only)

**Files:**
- Modify: `src/main/modules/_wikilinkEngine.js`

- [ ] **Step 1: Test**

Add to `wikilinkEngine.test.js`:
```js
import { applyWikilinks } from '../_wikilinkEngine.js'

describe('applyWikilinks', () => {
  const inventory = [
    { term: 'Alex Januschewsky', canonical: 'Alex Januschewsky' },
    { term: 'Alex',              canonical: 'Alex Januschewsky' },
    { term: 'OpenAI',            canonical: 'OpenAI' }
  ].sort((a,b) => b.term.length - a.term.length)

  it('links first occurrence only', () => {
    const out = applyWikilinks('OpenAI rocks. OpenAI ftw.', inventory)
    expect(out.body).toBe('[[OpenAI]] rocks. OpenAI ftw.')
    expect(out.matched).toContain('OpenAI')
  })
  it('prefers longest match (Alex Januschewsky over Alex)', () => {
    const out = applyWikilinks('Alex Januschewsky ist Autor. Alex auch.', inventory)
    expect(out.body).toBe('[[Alex Januschewsky]] ist Autor. [[Alex Januschewsky|Alex]] auch.')
  })
  it('skips text already inside [[...]]', () => {
    const out = applyWikilinks('[[OpenAI]] und OpenAI', inventory)
    expect(out.body).toBe('[[OpenAI]] und OpenAI')   // existing link untouched, second occurrence not relinked
  })
  it('produces empty matched when no entity present', () => {
    const out = applyWikilinks('Plain text only.', inventory)
    expect(out.matched).toEqual([])
    expect(out.body).toBe('Plain text only.')
  })
})
```

Note: aliased term (`Alex` for `Alex Januschewsky`) renders as `[[Alex Januschewsky|Alex]]` — Obsidian-style display alias.

- [ ] **Step 2: Implement**

```js
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function applyWikilinks(body, inventory) {
  let text = body
  const matched = new Set()
  const linkedAlready = new Set()

  for (const entry of inventory) {
    if (linkedAlready.has(entry.canonical)) continue
    const re = new RegExp(`(?<![\\[\\w])${escapeRegex(entry.term)}(?![\\w\\]])`, 'g')
    let replaced = false
    text = text.replace(re, (match, offset) => {
      // Skip if already inside [[...]]
      const before = text.slice(Math.max(0, offset - 50), offset)
      if (/\[\[[^\]]*$/.test(before)) return match
      if (replaced) return match  // first occurrence only
      replaced = true
      matched.add(entry.canonical)
      linkedAlready.add(entry.canonical)
      if (entry.term === entry.canonical) return `[[${entry.canonical}]]`
      return `[[${entry.canonical}|${entry.term}]]`
    })
  }
  return { body: text, matched: [...matched] }
}
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- _wikilinkEngine
git add src/main/modules/_wikilinkEngine.js src/main/modules/__tests__/wikilinkEngine.test.js
git commit -m "feat(wikilink): idempotent first-occurrence wikilink replacer"
```

---

### Task 7.3: Frontmatter mentions writer + post pass

**Files:**
- Modify: `src/main/modules/_wikilinkEngine.js`

- [ ] **Step 1: Test**

```js
import { processPostFile } from '../_wikilinkEngine.js'

describe('processPostFile', () => {
  it('updates body wikilinks and mentions in frontmatter', () => {
    const input = `---
title: "x"
mentions: []
---

OpenAI is great.`
    const inv = [{ term: 'OpenAI', canonical: 'OpenAI' }]
    const { content, changed, mentions } = processPostFile(input, inv)
    expect(changed).toBe(true)
    expect(mentions).toEqual(['[[OpenAI]]'])
    expect(content).toContain('mentions: ["[[OpenAI]]"]')
    expect(content).toContain('[[OpenAI]] is great')
  })
  it('returns changed=false on second run (idempotent)', () => {
    const input = `---
mentions: ["[[OpenAI]]"]
---

[[OpenAI]] is great.`
    const inv = [{ term: 'OpenAI', canonical: 'OpenAI' }]
    const r = processPostFile(input, inv)
    expect(r.changed).toBe(false)
  })
})
```

- [ ] **Step 2: Implement**

```js
function splitFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return { fm: '', body: content }
  return { fm: m[1], body: m[2] }
}

function setFmKey(fm, key, value) {
  const re = new RegExp(`^${key}:\\s*.*$`, 'm')
  if (re.test(fm)) return fm.replace(re, `${key}: ${value}`)
  return fm + `\n${key}: ${value}`
}

export function processPostFile(content, inventory) {
  const { fm, body } = splitFrontmatter(content)
  const { body: newBody, matched } = applyWikilinks(body, inventory)
  const wikilinkArr = matched.sort().map(m => `"[[${m}]]"`).join(', ')
  const mentionsLine = `[${wikilinkArr}]`
  const newFm = setFmKey(fm, 'mentions', mentionsLine)
  const newContent = `---\n${newFm}\n---\n${newBody}`
  return {
    content: newContent,
    changed: newContent !== content,
    mentions: matched.map(m => `[[${m}]]`)
  }
}
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- _wikilinkEngine
git add src/main/modules/_wikilinkEngine.js src/main/modules/__tests__/wikilinkEngine.test.js
git commit -m "feat(wikilink): processPostFile updates body + mentions FM"
```

---

### Task 7.4: Backlink writer for entity notes

**Files:**
- Modify: `src/main/modules/_wikilinkEngine.js`

- [ ] **Step 1: Test**

```js
import { appendBacklinkBullet } from '../_wikilinkEngine.js'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'

const V2 = join(tmpdir(), 'vinci-bl-test')
beforeEach(() => {
  rmSync(V2, { recursive: true, force: true })
  mkdirSync(join(V2, 'VINCI/Firmen'), { recursive: true })
  writeFileSync(join(V2, 'VINCI/Firmen/OpenAI.md'), '---\n---\n# OpenAI\n\n')
})
afterEach(() => rmSync(V2, { recursive: true, force: true }))

describe('appendBacklinkBullet', () => {
  it('appends backlink if not present', () => {
    appendBacklinkBullet(V2, 'OpenAI', 'Firmen', '500-artikel')
    const c = readFileSync(join(V2, 'VINCI/Firmen/OpenAI.md'), 'utf8')
    expect(c).toContain('Erwähnt in [[500-artikel]]')
  })
  it('skips on duplicate', () => {
    appendBacklinkBullet(V2, 'OpenAI', 'Firmen', '500-artikel')
    appendBacklinkBullet(V2, 'OpenAI', 'Firmen', '500-artikel')
    const c = readFileSync(join(V2, 'VINCI/Firmen/OpenAI.md'), 'utf8')
    const matches = c.match(/Erwähnt in \[\[500-artikel\]\]/g) || []
    expect(matches).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Implement**

```js
import { writeFileSync } from 'fs'

export function appendBacklinkBullet(vaultPath, entityName, category, postSlug) {
  const file = join(vaultPath, 'VINCI', category, `${entityName}.md`)
  if (!existsSync(file)) return false
  const content = readFileSync(file, 'utf8')
  const bullet = `- Erwähnt in [[${postSlug}]]`
  if (content.includes(bullet)) return false
  const sep = content.endsWith('\n') ? '' : '\n'
  writeFileSync(file, content + sep + bullet + '\n', 'utf8')
  return true
}
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- _wikilinkEngine
git add src/main/modules/_wikilinkEngine.js src/main/modules/__tests__/wikilinkEngine.test.js
git commit -m "feat(wikilink): backlink bullet writer with dedup"
```

---

### Task 7.5: Auto-firma threshold detector

**Files:**
- Modify: `src/main/modules/_wikilinkEngine.js`

- [ ] **Step 1: Implement (write-only — runs over a directory of posts)**

```js
export function detectAutoFirmaCandidates(processedPosts, knownEntities, threshold = 2) {
  // processedPosts: Array<{ slug, body }>
  // knownEntities: Set<string lower-case>
  // returns: Map<canonicalCandidateName, postSlugs[]>
  const candidates = new Map()
  // Heuristic: capitalized words / multi-cap-tokens not in knownEntities
  // and not in HARD_REJECT pool
  const RE = /\b([A-ZÄÖÜ][a-zäöüß]+(?:\s[A-ZÄÖÜ][a-zäöüß]+)?)\b/g
  for (const post of processedPosts) {
    const seen = new Set()
    for (const m of post.body.matchAll(RE)) {
      const name = m[1]
      if (knownEntities.has(name.toLowerCase())) continue
      if (seen.has(name)) continue
      seen.add(name)
      if (!candidates.has(name)) candidates.set(name, [])
      candidates.get(name).push(post.slug)
    }
  }
  // Filter to threshold
  const out = new Map()
  for (const [name, slugs] of candidates) {
    if (slugs.length >= threshold) out.set(name, slugs)
  }
  return out
}

export function createAutoFirmaStub(vaultPath, name, firstSeenIn) {
  const dir = join(vaultPath, 'VINCI', 'Firmen')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.md`)
  if (existsSync(file)) return false
  const content = `---
source: VINCI
category: Firmen
created: ${new Date().toISOString().slice(0, 10)}
auto_created: true
first_seen_in: [${firstSeenIn.map(s => `"[[${s}]]"`).join(', ')}]
---

# ${name}

`
  writeFileSync(file, content, 'utf8')
  return true
}
```

- [ ] **Step 2: Add a quick test**

```js
import { detectAutoFirmaCandidates } from '../_wikilinkEngine.js'

describe('detectAutoFirmaCandidates', () => {
  it('flags names appearing in 2+ posts', () => {
    const posts = [
      { slug: 'a', body: 'Mistral is interesting. Anthropic too.' },
      { slug: 'b', body: 'Mistral grows. Microsoft watches.' },
      { slug: 'c', body: 'Anthropic launches.' }
    ]
    const known = new Set(['openai'])
    const out = detectAutoFirmaCandidates(posts, known, 2)
    expect(out.has('Mistral')).toBe(true)
    expect(out.has('Anthropic')).toBe(true)
    expect(out.has('Microsoft')).toBe(false)
  })
})
```

- [ ] **Step 3: Test + commit**

```bash
npm test -- _wikilinkEngine
git add src/main/modules/_wikilinkEngine.js src/main/modules/__tests__/wikilinkEngine.test.js
git commit -m "feat(wikilink): auto-firma threshold detector + stub creator"
```

---

### Task 7.6: Wire body pass into blog importer + bulk relink button

**Files:**
- Modify: `src/main/modules/blogImporter.js`
- Modify: `src/main/ipc.js`, `src/main/preload.js`, `src/renderer/components/Settings.jsx`

- [ ] **Step 1: Hook into runOnce**

In `blogImporter.js runOnce`, after writing each post:
```js
import { loadEntityInventory, processPostFile, appendBacklinkBullet, detectAutoFirmaCandidates, createAutoFirmaStub } from './_wikilinkEngine.js'

// After the for-loop processing posts, before return:
const inventory = loadEntityInventory(vaultPath)
const known = new Set(inventory.map(e => e.term.toLowerCase()))
const processed = []

for (const f of readdirSync(folder).filter(x => x.endsWith('.md'))) {
  const path = join(folder, f)
  const original = readFileSync(path, 'utf8')
  const { content, changed, mentions } = processPostFile(original, inventory)
  if (changed && !dryRun) writeFileSync(path, content, 'utf8')
  processed.push({ slug: f.replace(/\.md$/, ''), body: content })
  // backlinks
  for (const m of mentions) {
    const canonical = m.replace(/^\[\[|\]\]$/g, '').split('|')[0]
    const inv = inventory.find(i => i.canonical === canonical)
    if (inv && inv.category && inv.category !== 'alias' && !dryRun) {
      appendBacklinkBullet(vaultPath, canonical, inv.category, f.replace(/\.md$/, ''))
    }
  }
}
const candidates = detectAutoFirmaCandidates(processed, known, 2)
for (const [name, slugs] of candidates) {
  if (!dryRun) createAutoFirmaStub(vaultPath, name, slugs.slice(0, 3))
}
result.auto_firma_created = candidates.size
```

- [ ] **Step 2: Add bulk relink button**

In ipc.js:
```js
ipcMain.handle('relinkAllPosts', async () => {
  const settings = getSettings()
  const vault = settings.obsidian?.vaultPath
  const sources = (settings.blogSources || []).filter(s => s.enabled)
  let total = 0, changed = 0
  for (const source of sources) {
    const folder = join(vault, source.vaultFolder)
    if (!existsSync(folder)) continue
    const inv = loadEntityInventory(vault)
    for (const f of readdirSync(folder).filter(x => x.endsWith('.md'))) {
      total++
      const path = join(folder, f)
      const orig = readFileSync(path, 'utf8')
      const { content, changed: ch } = processPostFile(orig, inv)
      if (ch) { writeFileSync(path, content, 'utf8'); changed++ }
    }
  }
  return { total, changed }
})
```

In preload.js: `relinkAllPosts: () => ipcRenderer.invoke('relinkAllPosts')`.

In Settings.jsx:
```jsx
<button onClick={async () => alert(JSON.stringify(await window.lyra.relinkAllPosts(), null, 2))}>
  Bestehende Posts neu verlinken
</button>
```

- [ ] **Step 3: Manual smoke test**

After this ships and Phase 6 is live, click "Bestehende Posts neu verlinken" → expect ~497 total, some number changed (depends on inventory). Open a post in Obsidian, verify `[[OpenAI]]` etc. is set + `mentions:` filled.

- [ ] **Step 4: Commit**

```bash
git add src/main/modules/blogImporter.js src/main/ipc.js src/main/preload.js src/renderer/components/Settings.jsx
git commit -m "feat(wikilink): wire body pass into blog importer + bulk relink button"
```

---

## Phase 8 — Web→Vault save (Spec §4.4.3)

### Task 8.1: web_saveToVault tool

**Files:**
- Create: `src/main/modules/webSave.js`
- Modify: `src/main/modules/registry.js`
- Modify: `src/main/modules/gemini.js`

- [ ] **Step 1: Implement module**

Create `src/main/modules/webSave.js`:
```js
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadEntityInventory, processPostFile, appendBacklinkBullet } from './_wikilinkEngine.js'

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || 'untitled'
}

function germanDate(iso) {
  const d = new Date(iso)
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
  return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`
}

export const webSaveModule = {
  name: 'web',  // extends existing web module — the tool name is `web_saveToVault`
  // Note: this module ADDS a tool to the existing web module's registry entry.
  // If registry doesn't support multi-module-per-name, expose under a fresh module 'websave'.
  description: 'Speichert Web-Treffer als referenzierte Notizen in inbox/web/.',
  actions: {
    saveToVault: async ({ title, summary, sources = [], keyPoints = [] } = {}, ctx) => {
      const vault = ctx?.settings?.obsidian?.vaultPath
      if (!vault) return { error: 'Kein Vault.' }
      if (!title || !summary || sources.length === 0) {
        return { error: 'title, summary und mindestens eine source sind nötig.' }
      }
      const date = new Date().toISOString().slice(0, 10)
      const slug = slugify(title)
      const dir = join(vault, 'inbox', 'web')
      mkdirSync(dir, { recursive: true })

      let path = join(dir, `${date} – ${slug}.md`)
      let n = 2
      while (existsSync(path)) {
        path = join(dir, `${date} – ${slug}-${n}.md`)
        n++
      }

      const fm = [
        '---',
        `title: ${JSON.stringify(title)}`,
        `source: web`,
        'sources:',
        ...sources.map(u => `  - ${JSON.stringify(u)}`),
        `fetched: "${new Date().toISOString()}"`,
        `tags: [web-import, inbox]`,
        `status: zu-sichten`,
        `mentions: []`,
        '---'
      ].join('\n')

      const body = `# ${title}\n\n> Recherchiert von VINCI am ${germanDate(date)} aus ${sources.length} Quelle${sources.length === 1 ? '' : 'n'}.\n\n## Zusammenfassung\n${summary}\n\n${keyPoints.length ? '## Kernaussagen\n' + keyPoints.map(k => `- ${k}`).join('\n') + '\n\n' : ''}## Quellen\n${sources.map((u, i) => `${i+1}. [${new URL(u).hostname}](${u})`).join('\n')}\n`
      let content = `${fm}\n\n${body}`

      // Apply wikilink pass
      const inv = loadEntityInventory(vault)
      const { content: linked, mentions } = processPostFile(content, inv)
      writeFileSync(path, linked, 'utf8')

      // Backlinks
      const slugFromPath = path.replace(/^.*\//, '').replace(/\.md$/, '')
      for (const m of mentions) {
        const canonical = m.replace(/^\[\[|\]\]$/g, '').split('|')[0]
        const ie = inv.find(i => i.canonical === canonical)
        if (ie?.category && ie.category !== 'alias') {
          appendBacklinkBullet(vault, canonical, ie.category, slugFromPath)
        }
      }
      return { ok: true, path: path.replace(vault + '/', ''), mentions: mentions.length }
    }
  },
  tools: [{
    name: 'web_saveToVault',
    description: 'Speichert einen Web-Suche-Treffer als referenzierte Notiz in inbox/web/. NUR wenn Alex explizit "speicher das ins vault" / "leg eine notiz an" / "merk dir das mit quelle" sagt nach einer Web-Suche. Setzt Wikilinks zu bekannten Personen/Firmen automatisch.',
    parameters: {
      type: 'object',
      properties: {
        title:     { type: 'string', description: 'Knapper deutscher Titel.' },
        summary:   { type: 'string', description: 'Deutsche Zusammenfassung, 3–8 Sätze.' },
        sources:   { type: 'array', items: { type: 'string' }, description: 'Quellen-URLs (1–3).' },
        keyPoints: { type: 'array', items: { type: 'string' }, description: 'Optional: 3–5 Bullets.' }
      },
      required: ['title', 'summary', 'sources']
    }
  }]
}
```

- [ ] **Step 2: Integrate into the existing `webModule`**

The existing `webModule` in `src/main/modules/web.js` already owns the `'web'` namespace. Don't create a competing module. Instead:

(a) In `webSave.js`, export only the helper functions (`slugify`, `germanDate`, and a `saveToVaultImpl(params, ctx)` function that contains the actual logic). Drop the `webSaveModule` export.

(b) In `web.js`, import the helpers and add a new action and tool:

```js
import { saveToVaultImpl } from './webSave.js'

// In webModule.actions, alongside `search`:
saveToVault: async (params, ctx) => saveToVaultImpl(params, ctx),

// In webModule.tools array, append the web_saveToVault tool definition from Task 8.1 step 1.
```

This keeps a single registry entry for `'web'` and exposes `web_saveToVault` cleanly through the existing dispatch (`web` module + `saveToVault` action → tool name `web_saveToVault`).

- [ ] **Step 3: Update Gemini prompt**

In `gemini.js`, append to the WEB-SUCHE section:
```
SPEICHERN-NACH-VAULT (web_saveToVault):
- Wenn Alex nach einer web_search-Antwort sagt: "speicher das ins vault", "leg eine notiz an dazu", "merk dir das mit quelle", "kopier das in obsidian" → IMMER web_saveToVault aufrufen mit: knappem deutschen Titel, deiner Zusammenfassung, allen verwendeten Quell-URLs, und 3–5 Kernaussagen aus den Treffern.
- Bestätige danach kurz: "Notiz angelegt unter inbox/web/<datum> – <slug>.md, X Wikilinks gesetzt."
```

- [ ] **Step 4: Manual smoke test**

In VINCI: "Was hat OpenAI heute angekündigt?" → web_search runs → results displayed → "Speicher das ins Vault." → expect new file in `<Vault>/inbox/web/2026-MM-DD – ...md` with mentions and backlinks.

- [ ] **Step 5: Commit**

```bash
git add src/main/modules/webSave.js src/main/modules/web.js src/main/modules/gemini.js
git commit -m "feat(web): web_saveToVault tool with wikilink + backlink pass"
```

---

## Final tasks

### Task F.1: Run full test suite

- [ ] **Step 1**

```bash
npm test
```

Expected: All test files pass. If any fail, fix before declaring complete.

### Task F.2: User acceptance

- [ ] **Step 1: User-driven smoke walkthrough**

Walk through each of the 8 phases' user-visible features (in order from Phase 1). Confirm:
- Web search triggers on "neueste KI-news"
- Vault path validation warns on `/Vaults`
- Migration archives orphans correctly
- New facts get correct categories; no `+436...md` files appear
- Cleaner produces sensible proposals
- `blog_sync` pulls 4 missing posts and the result message is correct
- Body pass creates `mentions:` and backlinks on the new posts
- "Speicher das ins Vault" creates a proper inbox/web/ note with wikilinks

### Task F.3: Tag the release

- [ ] **Step 1**

```bash
git tag -a v2.1.0 -m "vault graph redesign complete"
```

---

## Spec-coverage self-check (done by author)

| Spec § | Plan task | Status |
|---|---|---|
| 4.1.1 multi-vault detection | 2.1 | ✅ |
| 4.1.2 manual path change | (operational, no code) | ✅ |
| 4.1.3 migration script | 3.1–3.4 | ✅ |
| 4.2 blog importer | 6.1–6.6 | ✅ |
| 4.3.1 canonical categories | 4.1 | ✅ |
| 4.3.2 hard-reject filter | 4.2 | ✅ |
| 4.3.3 domain detection | 4.3 | ✅ |
| 4.3.4 auto alias building | 4.4 | ✅ |
| 4.3.5 memworker pre-filter | 4.5 | ✅ |
| 4.3.6 tainting tools expanded | 4.6 | ✅ |
| 4.3.7 model setting | 4.7 | ✅ |
| 4.3.8 extraction tests | 4.8 | ✅ |
| 4.4.1 cleaner | 5.1–5.5 | ✅ |
| 4.4.2 body wikilink pass | 7.1–7.6 | ✅ |
| 4.4.3 web→vault save | 8.1 | ✅ |
| 4.5 web search trigger | 1.1–1.2 | ✅ |
| §3 cross-cutting (test-before-go, backup, idempotency, trash-not-delete) | woven into every task | ✅ |
| §5 roll-out order | Phase numbers match | ✅ |
