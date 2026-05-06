import axios from 'axios'
import { buildMemoryContext } from './memory.js'

const SYSTEM_PROMPT = `/no_think
Du bist VINCI, der persönliche KI-Assistent von Alex Januschewsky.

KRITISCH: Wenn du Daten brauchst (Kalender, Mail, Strom, Wetter, Erinnerungen), rufe IMMER sofort das passende Tool auf. Schreibe NIEMALS "Ich schaue nach" oder "Ich werde prüfen" ohne danach ein Tool aufzurufen. Rufe das Tool direkt auf ohne Ankündigung.

Persönlichkeit: Direkt, präzise, klares Hochdeutsch, kein Dialekt, Du-Form.
Antworte auf Deutsch.`

export async function ollamaChat({ message, history = [], apiKey, model, moduleContext, onToolCall }) {
  const baseUrl = 'http://localhost:11434'
  const chatModel = model || 'qwen3:4b'

  // Check Ollama is running
  try {
    await axios.get(`${baseUrl}/api/tags`, { timeout: 3000 })
  } catch {
    throw new Error('Ollama läuft nicht. Bitte starten: ollama serve')
  }

  const memoryContext = buildMemoryContext()
  const systemContent = SYSTEM_PROMPT + (memoryContext || '')

  // Build messages array
  const messages = [
    { role: 'system', content: systemContent },
    ...history
      .filter(m => m.role !== 'system' && m.content?.trim())
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
    { role: 'user', content: message }
  ]

  // Build Ollama tools from module context
  // Limit tools for small models - too many tools confuse them
  const allTools = moduleContext ? buildOllamaTools(moduleContext) : []
  const tools = allTools.slice(0, 10)  // max 10 tools

  console.log('[Ollama] model:', chatModel, '| tools:', tools.length, '| messages:', messages.length)

  let response = await callOllama(baseUrl, chatModel, messages, tools)
  let iterations = 0

  // Tool call loop
  while (response.message?.tool_calls?.length > 0 && iterations < 5) {
    iterations++
    const calls = response.message.tool_calls
    console.log('[Ollama] Tool calls:', calls.map(c => c.function?.name).join(', '))

    // Add assistant message with tool calls
    messages.push({ role: 'assistant', content: '', tool_calls: calls })

    // Execute tools
    for (const call of calls) {
      const fnName = call.function?.name
      const fnArgs = typeof call.function?.arguments === 'string'
        ? JSON.parse(call.function.arguments)
        : (call.function?.arguments || {})

      let result
      try {
        result = onToolCall ? await onToolCall(fnName, fnArgs) : { error: 'No handler' }
        console.log('[Ollama] Tool result:', fnName, JSON.stringify(result).slice(0, 400))
      } catch (err) {
        result = { error: err.message }
      }

      messages.push({
        role: 'tool',
        content: JSON.stringify(result)
      })
    }

    response = await callOllama(baseUrl, chatModel, messages, tools)
  }

  // Strip qwen3 thinking tokens <think>...</think>
  const rawText = response.message?.content || ''
  const text = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (!text.trim()) {
    // Fallback: ask for summary
    messages.push({ role: 'user', content: 'Bitte fasse das Ergebnis kurz zusammen.' })
    const retry = await callOllama(baseUrl, chatModel, messages, [])
    return retry.message?.content || 'Erledigt.'
  }

  return text
}

async function callOllama(baseUrl, model, messages, tools) {
  const body = {
    model,
    messages,
    stream: false,
    options: {
      temperature: 0.7,
      num_ctx: 4096
    }
  }

  if (tools.length > 0) body.tools = tools

  const res = await axios.post(`${baseUrl}/api/chat`, body, { timeout: 120000 })
  return res.data
}

// Convert Gemini-style tool declarations → Ollama format
function buildOllamaTools(moduleContext) {
  // moduleContext is the registry.getTools() output passed in
  if (!Array.isArray(moduleContext)) return []
  return moduleContext.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {} }
    }
  }))
}

// Check if Ollama is available and return installed models
export async function getOllamaStatus() {
  try {
    const res = await axios.get('http://localhost:11434/api/tags', { timeout: 3000 })
    const models = (res.data.models || []).map(m => m.name)
    return { available: true, models }
  } catch {
    return { available: false, models: [] }
  }
}
