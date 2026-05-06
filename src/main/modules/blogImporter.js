import axios from 'axios'
import TurndownService from 'turndown'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

// Implemented in Task 6.2
export async function fetchPostsSince(source, sinceIso) {
  throw new Error('not implemented')
}

// Implemented in Task 6.3
export function readVaultCursor(folder) {
  throw new Error('not implemented')
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
