// ── Task-Executor ──────────────────────────────────────────────────────────────
// Führt einen Task-Prompt gegen Gemini (oder Ollama-Fallback) aus.
// Hat Zugriff auf alle Tools des Moduls-Registry — also kann Wetter holen,
// Termine lesen, Mails prüfen usw.

import { getSettings, getTokens, saveTokens } from './store.js'
import { registry } from './modules/registry.js'
import { geminiChat } from './modules/gemini.js'
import { ollamaChat } from './modules/ollama.js'

const TASK_SYSTEM_HINT = `
WICHTIG: Du wirst gerade von einer geplanten Aufgabe aufgerufen, nicht von einem Live-Chat.
Antworte kurz, faktisch, in 2–4 Sätzen. Keine Begrüßung, kein "ich schaue nach", keine Rückfragen.
Wenn du Daten brauchst, ruf direkt das passende Tool auf.
`.trim()

export async function runTask(task) {
  if (!task?.prompt) throw new Error('Task hat keinen Prompt')

  const settings = getSettings()
  const useOllama = settings.aiProvider === 'ollama'

  const toolDispatcher = async (toolName, params) => {
    try {
      return await registry.dispatch(toolName, params, {
        getSettings, getTokens,
        settings: getSettings(),
        tokens:   getTokens(),
        saveTokens
      })
    } catch (err) {
      return { error: err.message }
    }
  }

  // Prompt mit Hinweis verstärken, dass Antworten kurz/faktisch sein sollen
  const prompt = `${TASK_SYSTEM_HINT}\n\nAufgabe:\n${task.prompt}`

  if (useOllama) {
    const text = await ollamaChat({
      message:       prompt,
      history:       [],
      model:         settings.ollamaModel,
      moduleContext: registry.getTools(),
      onToolCall:    toolDispatcher
    })
    return text || ''
  } else {
    if (!settings.geminiApiKey) throw new Error('Kein Gemini API Key konfiguriert')
    const text = await geminiChat({
      message:       prompt,
      history:       [],
      apiKey:        settings.geminiApiKey,
      model:         settings.geminiModel,
      moduleContext: registry.getContext(),
      onToolCall:    toolDispatcher
    })
    return text || ''
  }
}
