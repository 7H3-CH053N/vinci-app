import axios from 'axios'

export const stromModule = {
  name: 'strom',
  description: 'Stromverbrauch: Heute, gestern, aktuell, Monat – via n8n Webhook',

  actions: {
    getCurrent: async (params, ctx) => fetchWebhook(ctx),
    getToday:   async (params, ctx) => fetchWebhook(ctx)
  },

  tools: [
    {
      name: 'strom_getCurrent',
      description: 'Holt aktuellen und heutigen Stromverbrauch (kWh heute, Watt aktuell, gestern, Monat)',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'strom_getToday',
      description: 'Holt den Stromverbrauch: heute, gestern, diesen Monat, letzten Monat, 7-Tage-Schnitt',
      parameters: { type: 'object', properties: {} }
    }
  ]
}

async function fetchWebhook(ctx) {
  const settings = ctx?.settings || ctx?.getSettings?.()
  const base     = (settings?.n8n?.baseUrl || 'https://bot.promptrocker.at').replace(/\/$/, '')
  const url      = `${base}/webhook/lyra-strom`

  console.log('[Strom] fetching:', url)
  try {
    const res = await axios.get(url, { timeout: 10000 })
    const d   = res.data
    console.log('[Strom] OK – gestern:', d.today_kwh, 'kWh, aktuell:', d.current_w, 'W')
    return {
      available: true,
      ...d,
      // today_kwh wird um Mitternacht aktualisiert — entspricht dem Verbrauch von GESTERN
      yesterday_kwh: d.today_kwh,
      today_kwh: undefined,
      _hinweis: 'today_kwh = Verbrauch von gestern (Update um Mitternacht). current_w = aktueller Echtzeit-Verbrauch.'
    }
  } catch (err) {
    console.error('[Strom] error:', err.message)
    const status = err.response?.status
    if (status === 404) {
      return { available: false, error: 'n8n Webhook "lyra-strom" nicht aktiv. Bitte Workflow importieren und aktivieren.' }
    }
    return { available: false, error: err.message }
  }
}
