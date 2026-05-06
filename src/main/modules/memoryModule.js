import { searchMemory, saveFact, getAllFacts, getMemoryStats, getRecentMessages } from './memory.js'

export const memoryModule = {
  name: 'memory',
  description: 'Gedächtnis: Vergangene Gespräche durchsuchen, Fakten dauerhaft speichern',

  actions: {
    getRecent: async ({ limit = 10 } = {}) => {
      return { messages: getRecentMessages(limit) }
    },
    search:   async ({ query }) => {
      const results = searchMemory(query || '', 8)
      return { query, results: results.map(r => ({ role: r.role, content: r.content.slice(0, 300), ts: r.ts })) }
    },
    saveFact: async ({ content }, ctx) => {
      const vault = ctx?.settings?.obsidian?.vaultPath || ''
      const model = ctx?.settings?.memoryWorkerModel || 'qwen2.5:3b'
      return { ok: saveFact(content, vault, model), saved: content }
    },
    getFacts: async () => ({ facts: getAllFacts(25) }),
    getStats: async () => getMemoryStats()
  },

  tools: [
    {
      name: 'memory_getRecent',
      description: 'Gibt die letzten N Nachrichten aus dem Gesprächsverlauf zurück. Nutzen bei Fragen wie "zeig mir das letzte", "was haben wir zuletzt besprochen".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Anzahl Nachrichten (default: 10)' }
        }
      }
    },
    {
      name: 'memory_search',
      description: 'Durchsucht vergangene Gespräche. Nutzen wenn Alex fragt was "letzte Woche", "früher" oder "damals" besprochen wurde.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Suchbegriff' } },
        required: ['query']
      }
    },
    {
      name: 'memory_saveFact',
      description: 'Speichert EINEN kurzen, stabilen Fakt über Alex (Person, Vorliebe, Beziehung, Besitz). Nutzen wenn Alex sagt "merk dir", "vergiss nicht", "wichtig". Ein Aufruf = EIN Fakt. Bei mehreren Fakten in einer Aussage: das Tool mehrmals aufrufen, jeder Fact in 3. Person ("Markus ist Alex Bruder"). NICHT für längere Notizen oder Texte – dafür obsidian_createNote.',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string', description: 'Ein einziger kurzer Fakt-Satz in 3. Person' } },
        required: ['content']
      }
    },
    {
      name: 'memory_getFacts',
      description: 'Gibt alle dauerhaft gespeicherten Fakten zurück',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'memory_getStats',
      description: 'Zeigt Statistik: wie viele Gespräche und Fakten gespeichert sind',
      parameters: { type: 'object', properties: {} }
    }
  ]
}
