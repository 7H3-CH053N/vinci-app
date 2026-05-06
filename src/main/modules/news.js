import axios from 'axios'
import { parseStringPromise } from 'xml2js'

const FEEDS = {
  salzburg_welt: {
    name: 'Salzburger Nachrichten – Weltpolitik',
    urls: ['https://www.sn.at/xml/rss']
  },
  salzburg_lokal: {
    name: 'Salzburger Nachrichten – Lokal',
    urls: ['https://www.sn.at/salzburg/rss/']
  },
  salzburg_rbs: {
    name: 'Red Bull Salzburg',
    urls: ['https://www.sn.at/sport/fussball/red-bull-salzburg/rss/']
  },
  futurezone: {
    name: 'Futurezone',
    urls: ['https://futurezone.at/xml/rss']
  }
}

export const newsModule = {
  name: 'news',
  description: 'Aktuelle Nachrichten: Salzburger Nachrichten und Futurezone via RSS',

  actions: {
    getNews: async ({ sources, limit = 10 } = {}) => {
      const toFetch = sources?.length
        ? sources.filter(s => FEEDS[s])
        : Object.keys(FEEDS)

      const results = {}

      await Promise.all(toFetch.map(async (key) => {
        const feed = FEEDS[key]

        // Try each URL until one works
        let lastError = null
        for (const url of feed.urls) {
          try {
            const res = await axios.get(url, {
              timeout: 8000,
              headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
            })
            const parsed = await parseStringPromise(res.data, { explicitArray: false })
            const items  = parsed?.rss?.channel?.item || parsed?.feed?.entry || []
            const list   = Array.isArray(items) ? items : [items]

            results[key] = {
              source: feed.name,
              url,
              items: list.slice(0, limit).map(item => ({
                title:   (item.title?._  || item.title || '').replace(/<[^>]+>/g, '').trim(),
                summary: (item.description?._ || item.description || item.summary?._ || item.summary || '').replace(/<[^>]+>/g, '').trim().slice(0, 200),
                link:    item.link?.href || item.link || '',
                date:    item.pubDate || item.updated || ''
              }))
            }
            console.log(`[News] ${feed.name}: ${results[key].items.length} items (${url})`)
            return  // success
          } catch (err) {
            lastError = err.message
            console.log(`[News] ${feed.name} failed: ${url} → ${err.message}`)
          }
        }

        results[key] = { source: feed.name, error: lastError, items: [] }
      }))

      return results
    }
  },

  tools: [
    {
      name: 'news_getNews',
      description: 'Holt aktuelle Nachrichten. Bei Fragen nach "News", "Nachrichten", "Neuigkeiten", "was ist passiert". Quellen: salzburg_welt, salzburg_lokal, salzburg_rbs (Fußball/Salzburg), futurezone (Tech).',
      parameters: {
        type: 'object',
        properties: {
          sources: {
            type: 'array',
            items: { type: 'string', enum: ['salzburg_welt', 'salzburg_lokal', 'salzburg_rbs', 'futurezone'] },
            description: 'Leer = alle Quellen'
          },
          limit: { type: 'number', description: 'Meldungen pro Quelle (default: 10)' }
        }
      }
    }
  ]
}
