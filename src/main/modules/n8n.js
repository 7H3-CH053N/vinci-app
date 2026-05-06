import axios from 'axios'

export const n8nModule = {
  name: 'n8n',
  description: 'n8n Automatisierung: Workflow-Status und Health-Check',

  actions: {
    getStatus: async (params, { settings }) => {
      const { baseUrl, apiKey } = settings.n8n
      if (!baseUrl) return { error: 'n8n URL nicht konfiguriert' }

      const headers = apiKey ? { 'X-N8N-API-KEY': apiKey } : {}

      try {
        // n8n REST API health endpoint
        const [health, workflows] = await Promise.allSettled([
          axios.get(`${baseUrl}/healthz`, { headers, timeout: 5000 }),
          axios.get(`${baseUrl}/api/v1/workflows`, {
            headers,
            timeout: 5000,
            params: { limit: 50, active: true }
          })
        ])

        return {
          online: health.status === 'fulfilled' && health.value.status === 200,
          activeWorkflows: workflows.status === 'fulfilled'
            ? workflows.value.data?.data?.length || 0
            : null,
          url: baseUrl
        }
      } catch (err) {
        return { online: false, error: err.message }
      }
    },

    getWorkflows: async (params, { settings }) => {
      const { baseUrl, apiKey } = settings.n8n
      if (!baseUrl) return []

      const headers = apiKey ? { 'X-N8N-API-KEY': apiKey } : {}

      const res = await axios.get(`${baseUrl}/api/v1/workflows`, {
        headers,
        timeout: 8000,
        params: { limit: 100 }
      })

      return (res.data?.data || []).map(w => ({
        id: w.id,
        name: w.name,
        active: w.active,
        updatedAt: w.updatedAt
      }))
    },

    // Trigger a specific webhook workflow
    triggerWebhook: async ({ webhookPath, payload = {} }, { settings }) => {
      const { baseUrl } = settings.n8n
      if (!baseUrl || !webhookPath) throw new Error('Webhook-Pfad fehlt')

      const res = await axios.post(
        `${baseUrl}/webhook/${webhookPath}`,
        payload,
        { timeout: 10000 }
      )
      return { ok: true, response: res.data }
    }
  },

  tools: [
    {
      name: 'n8n_getStatus',
      description: 'Prüft ob n8n online ist und zeigt aktive Workflows',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'n8n_getWorkflows',
      description: 'Listet alle n8n Workflows auf',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'n8n_triggerWebhook',
      description: 'Triggert einen n8n Webhook',
      parameters: {
        type: 'object',
        properties: {
          webhookPath: { type: 'string', description: 'Webhook-Pfad (z.B. "morning-briefing")' },
          payload: { type: 'object', description: 'Optionale Daten' }
        },
        required: ['webhookPath']
      }
    }
  ]
}
