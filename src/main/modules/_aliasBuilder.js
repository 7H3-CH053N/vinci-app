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
  if (!existsSync(root)) return null
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

  // Quarantine the short file (consistent with trash-don't-delete principle)
  const quarDir = join(vault, 'VINCI', '_quarantine', shortFile.category)
  mkdirSync(quarDir, { recursive: true })
  renameSync(shortFile.full, join(quarDir, basename(shortFile.full)))

  // Update alias map
  const aliases = loadAliases(vault)
  if (!aliases[fullName]) aliases[fullName] = []
  if (!aliases[fullName].includes(firstWord)) aliases[fullName].push(firstWord)
  saveAliases(vault, aliases)
}
