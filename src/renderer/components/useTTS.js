import { useEffect, useRef, useCallback } from 'react'
import { useLyraStore } from '../store/useStore.js'

function b64ToUint8Array(b64) {
  const bin = atob(b64)
  const len = bin.length
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * TTS-Hook mit zwei Providern:
 *   - 'system' (Default) — Web Speech API, lokale macOS-Stimmen
 *   - 'edge'             — Microsoft Edge TTS via Python-Subprozess (rany2/edge-tts)
 *
 * Bei Edge wird die MP3 als <audio>-Element abgespielt und an einen
 * AnalyserNode gehängt, damit der Orb live auf Lautstärke/Frequenz reagieren kann.
 */
export function useTTS() {
  const { setSpeaking, ttsSettings, setAvailableVoices, setAudioAnalyser } = useLyraStore()
  const synthRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const audioElRef = useRef(null)

  // ── System-Stimmen laden ──
  useEffect(() => {
    synthRef.current = window.speechSynthesis
    const loadVoices = () => {
      const voices = synthRef.current.getVoices()
      if (voices.length > 0) {
        const filtered = voices.filter(v => v.lang.startsWith('de') || v.lang.startsWith('en'))
        setAvailableVoices(filtered.map(v => ({ name: v.name, lang: v.lang, default: v.default })))
      }
    }
    synthRef.current.addEventListener('voiceschanged', loadVoices)
    loadVoices()
    return () => synthRef.current?.removeEventListener('voiceschanged', loadVoices)
  }, [])

  // ── AudioContext + Analyser einmalig anlegen ──
  function ensureAnalyser() {
    if (audioCtxRef.current) return
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    audioCtxRef.current = new Ctx()
    analyserRef.current = audioCtxRef.current.createAnalyser()
    analyserRef.current.fftSize = 128
    analyserRef.current.smoothingTimeConstant = 0.7
    setAudioAnalyser(analyserRef.current)
  }

  // ── System-TTS ──
  function speakSystem(text) {
    if (!synthRef.current) return
    synthRef.current.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate   = ttsSettings.rate   ?? 1.0
    utterance.pitch  = ttsSettings.pitch  ?? 1.0
    utterance.volume = ttsSettings.volume ?? 1.0
    if (ttsSettings.voice && ttsSettings.voice !== 'auto') {
      const match = synthRef.current.getVoices().find(v => v.name === ttsSettings.voice)
      if (match) utterance.voice = match
    }
    utterance.onstart  = () => setSpeaking(true)
    utterance.onend    = () => setSpeaking(false)
    utterance.onerror  = () => setSpeaking(false)
    synthRef.current.speak(utterance)
  }

  // ── Edge-TTS ──
  async function speakEdge(text) {
    try {
      ensureAnalyser()
      // Vorigen Audio-Stream abbrechen
      if (audioElRef.current) {
        try { audioElRef.current.pause() } catch {}
        audioElRef.current = null
      }

      const voice = ttsSettings.edgeVoice || 'de-AT-IngridNeural'
      console.log('[Edge TTS] requesting:', voice, '·', text.slice(0, 60))
      const res = await window.lyra.edgeTTSSpeak(text, voice)
      if (!res.ok) {
        console.warn('[Edge TTS] Fehler:', res.error)
        return
      }
      if (!res.audioB64) {
        console.warn('[Edge TTS] No audioB64 in response — main process may be stale, restart npm run dev')
        return
      }
      console.log('[Edge TTS] received', res.audioB64.length, 'b64 chars')

      // Data-URL ist robuster als Blob-URL in Electron für audio/mpeg
      const audio = new Audio()
      audio.preload = 'auto'
      audio.volume = ttsSettings.volume ?? 1.0
      audio.src = 'data:audio/mpeg;base64,' + res.audioB64
      audioElRef.current = audio

      // An Analyser hängen (für Orb-Live-Reaktivität)
      if (audioCtxRef.current && analyserRef.current) {
        try {
          if (audioCtxRef.current.state === 'suspended') {
            await audioCtxRef.current.resume()
          }
          const src = audioCtxRef.current.createMediaElementSource(audio)
          src.connect(analyserRef.current)
          analyserRef.current.connect(audioCtxRef.current.destination)
        } catch (e) {
          // Bereits verbunden — ignorieren
        }
      }

      audio.onplay  = () => setSpeaking(true)
      audio.onended = () => setSpeaking(false)
      audio.onerror = () => {
        setSpeaking(false)
        console.warn('[Edge TTS] audio error:', audio.error?.code, audio.error?.message)
      }
      audio.onpause = () => setSpeaking(false)

      // Vor play() bis canplaythrough warten — Chromium/Electron mag sonst „Failed to load"
      await new Promise((resolve, reject) => {
        const onReady = () => { cleanup(); resolve() }
        const onErr   = () => { cleanup(); reject(new Error('audio decode error: ' + (audio.error?.message || 'unknown'))) }
        const cleanup = () => {
          audio.removeEventListener('canplaythrough', onReady)
          audio.removeEventListener('error', onErr)
        }
        audio.addEventListener('canplaythrough', onReady, { once: true })
        audio.addEventListener('error',          onErr,   { once: true })
        // Falls es schon ready ist
        if (audio.readyState >= 4) { cleanup(); resolve() }
      })
      await audio.play()
    } catch (e) {
      console.warn('[Edge TTS] play error:', e)
      setSpeaking(false)
    }
  }

  const speak = useCallback((text, opts = {}) => {
    if (!ttsSettings.enabled) return
    if (!text?.trim()) return

    // Per-Modul-Filter: ohne Tag → 'chat'. Wenn das Modul ausgeschaltet ist, schweigt Ingrid.
    const mod = opts.module || 'chat'
    const modules = ttsSettings.modules || {}
    if (mod in modules && modules[mod] === false) {
      console.log('[TTS] suppressed module:', mod)
      return
    }

    if (ttsSettings.provider === 'edge') {
      speakEdge(text)
    } else {
      speakSystem(text)
    }
  }, [ttsSettings, setSpeaking])

  const stop = useCallback(() => {
    synthRef.current?.cancel()
    if (audioElRef.current) {
      try { audioElRef.current.pause() } catch {}
    }
    setSpeaking(false)
  }, [setSpeaking])

  const pause  = useCallback(() => synthRef.current?.pause(), [])
  const resume = useCallback(() => synthRef.current?.resume(), [])

  return { speak, stop, pause, resume }
}
