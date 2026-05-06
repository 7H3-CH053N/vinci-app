const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lyra', {
  chat:            (message, history) => ipcRenderer.invoke('lyra:chat', { message, history }),
  briefing:        ()                 => ipcRenderer.invoke('lyra:briefing'),
  invoke:          (module, action, params = {}) => ipcRenderer.invoke('lyra:invoke', { module, action, params }),
  getSettings:     ()                 => ipcRenderer.invoke('lyra:settings:get'),
  saveSettings:    (s)                => ipcRenderer.invoke('lyra:settings:save', s),
  resizeWindow:    (h)                => ipcRenderer.send('lyra:window:resize', h),
  getAssetPath: (name) => ipcRenderer.invoke('lyra:asset:path', name),
  hideWindow:      ()                 => ipcRenderer.send('lyra:window:hide'),
  transcribeAudio: (base64, mime)     => ipcRenderer.invoke('lyra:transcribe', { base64, mime }),
  pickFolder:      ()                 => ipcRenderer.invoke('lyra:pickFolder'),
  validateVaultPath: (path)           => ipcRenderer.invoke('validateVaultPath', path),
  openExternal:    (url)              => ipcRenderer.send('lyra:open:external', url),

  // Aufgaben (geplante Prompts)
  tasksList:       ()                 => ipcRenderer.invoke('lyra:tasks:list'),
  tasksCreate:     (input)            => ipcRenderer.invoke('lyra:tasks:create', input),
  tasksUpdate:     (id, patch)        => ipcRenderer.invoke('lyra:tasks:update', { id, patch }),
  tasksDelete:     (id)               => ipcRenderer.invoke('lyra:tasks:delete', id),
  tasksRun:        (id)               => ipcRenderer.invoke('lyra:tasks:run', id),
  tasksResults:    (id)               => ipcRenderer.invoke('lyra:tasks:results', id),

  // Edge TTS
  edgeTTSStatus:        ()                 => ipcRenderer.invoke('lyra:tts:edge:status'),
  edgeTTSSpeak:         (text, voice)      => ipcRenderer.invoke('lyra:tts:edge:speak', { text, voice }),
  edgeTTSVoices:        ()                 => ipcRenderer.invoke('lyra:tts:edge:voices'),
  edgeTTSInstallPython: ()                 => ipcRenderer.invoke('lyra:tts:edge:install-python'),
  edgeTTSInstallPkg:    ()                 => ipcRenderer.invoke('lyra:tts:edge:install-pkg'),

  // Home Assistant
  haTest:  ()                               => ipcRenderer.invoke('lyra:ha:test'),
  haState: (entityId)                       => ipcRenderer.invoke('lyra:ha:state', { entityId }),
  haList:  (domain)                         => ipcRenderer.invoke('lyra:ha:list',  { domain }),
  haCall:  (domain, service, data)          => ipcRenderer.invoke('lyra:ha:call',  { domain, service, data }),

  on: (channel, callback) => {
    const allowed = ['lyra:briefing', 'lyra:openSettings', 'lyra:openAbout', 'lyra:openTasks', 'lyra:ptt', 'lyra:taskResult', 'lyra:openTaskResult']
    if (!allowed.includes(channel)) return
    const handler = (_, ...args) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
})
