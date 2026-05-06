import { calendarModule }  from './calendar.js'
import { mailModule }      from './mail.js'
import { remindersModule } from './reminders.js'
import { n8nModule }       from './n8n.js'
import { stromModule }     from './strom.js'
import { weatherModule }   from './weather.js'
import { memoryModule }    from './memoryModule.js'
import { newsModule }      from './news.js'
import { systemModule }    from './system.js'
import { obsidianModule }  from './obsidian.js'
import { contactsModule }  from './contacts.js'
import { webModule }       from './web.js'
import { messagesModule }  from './messages.js'
import { homeassistantModule } from './homeassistant.js'
import { getOllamaStatus } from './ollama.js'

// Inline ollama status module (not in MODULES array - registered separately)
const ollamaStatusModule = {
  name: 'ollama',
  description: 'Ollama: Status und Modell-Info',
  actions: {
    status: async () => getOllamaStatus()
  },
  tools: []
}

const MODULES = [
  newsModule,
  systemModule,
  calendarModule,
  mailModule,
  remindersModule,
  n8nModule,
  stromModule,
  weatherModule,
  memoryModule,
  obsidianModule,
  contactsModule,
  webModule,
  messagesModule,
  homeassistantModule
]

class ModuleRegistry {
  constructor() {
    this.modules = new Map()
    this.modules.set('ollama', ollamaStatusModule)
    for (const mod of MODULES) {
      this.modules.set(mod.name, mod)
      console.log(`[Registry] Module loaded: ${mod.name}`)
    }
  }

  async invoke(moduleName, action, params, ctx) {
    const mod = this.modules.get(moduleName)
    if (!mod) throw new Error(`Module '${moduleName}' not found`)
    const handler = mod.actions?.[action]
    if (!handler) throw new Error(`Action '${action}' not found in module '${moduleName}'`)
    return await handler(params, ctx)
  }

  async dispatch(toolName, params, ctx) {
    const [moduleName, ...rest] = toolName.split('_')
    const action = rest.join('_')
    return await this.invoke(moduleName, action, params, ctx)
  }

  getTools() {
    const tools = []
    for (const mod of this.modules.values()) {
      if (mod.tools) tools.push(...mod.tools)
    }
    return tools
  }

  getContext() {
    return Array.from(this.modules.values())
      .map(m => `- ${m.name}: ${m.description}`)
      .join('\n')
  }
}

export const registry = new ModuleRegistry()
