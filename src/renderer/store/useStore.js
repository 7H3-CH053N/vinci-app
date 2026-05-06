import { create } from 'zustand'

export const useLyraStore = create((set, get) => ({
  // ── Chat ─────────────────────────────────────────────────────────────────
  messages: [],
  isThinking: false,
  isSpeaking: false,
  currentView: 'chat', // 'chat' | 'settings'

  addMessage: (msg) => set(state => ({
    messages: [...state.messages, {
      id: Date.now(),
      role: msg.role,        // 'user' | 'assistant' | 'system'
      content: msg.content,
      timestamp: new Date(),
      ...msg
    }]
  })),

  clearMessages: () => set({ messages: [] }),

  setThinking: (v)  => set({ isThinking: v }),
  setSpeaking: (v)  => set({ isSpeaking: v }),
  setView: (v)      => set({ currentView: v }),

  // ── TTS settings (loaded from main, mirrored here for Settings UI) ───────
  ttsSettings: {
    enabled: true,
    voice: 'auto',
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0
  },
  setTtsSettings: (tts) => set({ ttsSettings: tts }),

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: null,
  setSettings: (s) => set({ settings: s }),

  // ── Module status ─────────────────────────────────────────────────────────
  moduleStatuses: {},
  setModuleStatus: (name, status) => set(state => ({
    moduleStatuses: { ...state.moduleStatuses, [name]: status }
  })),

  // ── Voice list (populated from Web Speech API) ───────────────────────────
  availableVoices: [],
  setAvailableVoices: (voices) => set({ availableVoices: voices }),

  // ── Audio Analyser (shared zwischen Edge-TTS und Orb für Live-Reaktivität) ─
  audioAnalyser: null,
  setAudioAnalyser: (a) => set({ audioAnalyser: a })
}))
