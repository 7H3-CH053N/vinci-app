import { useState, useRef, useEffect, useCallback } from 'react'
import { useLyraStore } from '../store/useStore.js'
import { useTTS } from './useTTS.js'
import MessageBubble from './MessageBubble.jsx'

export default function ChatPanel() {
  const [input, setInput]      = useState('')
  const [isRecording, setRec]  = useState(false)
  const [recStatus, setStatus] = useState('')
  const { messages, addMessage, isThinking, setThinking } = useLyraStore()
  const { speak, stop } = useTTS()
  const messagesEndRef = useRef(null)
  const textareaRef    = useRef(null)
  const mediaRecRef    = useRef(null)
  const chunksRef      = useRef([])
  const recordingRef   = useRef(false) // sync ref for PTT handler

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 90) + 'px'
  }, [input])

  async function sendMessage(text) {
    const msg = text.trim()
    if (!msg || isThinking) return
    setInput('')
    addMessage({ role: 'user', content: msg })
    setThinking(true)
    stop()
    setTimeout(() => textareaRef.current?.focus(), 50)
    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const result  = await window.lyra.chat(msg, history)
      if (result.error) {
        addMessage({ role: 'assistant', content: `⚠ ${result.error}`, isError: true })
      } else {
        // Sub-Agent-Trigger: Backend hat einen Job gespawned. Message bekommt
        // jobId → MessageBubble rendert JobCard mit Live-Updates.
        // Race-Schutz: App.jsx fügt bei "started"-Event ggf. schon eine Card hinzu.
        // Prüfen ob die Card mit jobId schon existiert → dann nicht doppelt.
        const already = result.jobId && useLyraStore.getState().messages.some(m => m.jobId === result.jobId)
        if (!already) {
          addMessage({
            role: 'assistant',
            content: result.text,
            jobId: result.jobId || null,
            agentType: result.agentType || null
          })
        }
        // Bei Sub-Agent-Start NICHT die Bestätigung sprechen — App.jsx spricht
        // dann die Done-Summary wenn der Job fertig ist (sonst doppelt TTS).
        if (!result.jobId) {
          const textToSpeak = result.text || ''
          const shouldSpeak = textToSpeak.trim().length > 0
          const mod = result.module || 'chat'
          if (shouldSpeak) speak(textToSpeak, { module: mod })
        }
      }
    } catch (err) {
      addMessage({ role: 'assistant', content: `⚠ ${err.message}`, isError: true })
    } finally {
      setThinking(false)
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  // ── Recording logic (shared by button + PTT shortcut) ─────────────────────
  const startRecording = useCallback(async () => {
    if (recordingRef.current) return
    setStatus('recording')
    chunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4']
        .find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm'

      const rec = new MediaRecorder(stream, { mimeType })
      mediaRecRef.current = rec

      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        recordingRef.current = false
        setRec(false)
        setStatus('processing')

        const blob   = new Blob(chunksRef.current, { type: mimeType })
        const buffer = await blob.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
        const result = await window.lyra.transcribeAudio(base64, mimeType.split(';')[0])

        setStatus('')
        if (result.error) {
          setStatus(`Fehler: ${result.error}`)
          setTimeout(() => setStatus(''), 3000)
        } else if (result.text) {
          sendMessage(result.text)
        }
      }

      rec.start()
      recordingRef.current = true
      setRec(true)

    } catch (err) {
      recordingRef.current = false
      setRec(false)
      setStatus(err.name === 'NotAllowedError'
        ? 'Mikrofon verweigert – Systemeinstellungen → Datenschutz → Mikrofon → Lyra ✓'
        : `Fehler: ${err.message}`)
      setTimeout(() => setStatus(''), 4000)
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return
    mediaRecRef.current?.stop()
  }, [])

  const toggleRecording = useCallback(() => {
    recordingRef.current ? stopRecording() : startRecording()
  }, [startRecording, stopRecording])

  // ── Global PTT shortcut (Cmd+Shift+M) ─────────────────────────────────────
  useEffect(() => {
    const off = window.lyra.on('lyra:ptt', toggleRecording)
    return () => off?.()
  }, [toggleRecording])

  const isError = recStatus && recStatus !== 'recording' && recStatus !== 'processing'

  return (
    <div className="chat-panel">
      <div className="messages-list">
        {messages.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">◈</span>
            <p>Wie kann ich helfen?</p>
            <p style={{ fontSize: 9, opacity: 0.25, marginTop: 4 }}>Cmd+Shift+M = Spracheingabe</p>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isThinking && (
          <div className="thinking-indicator">
            <span className="dot dot-thinking"/><span className="dot dot-thinking"/><span className="dot dot-thinking"/>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {recStatus && recStatus !== 'recording' && (
        <div className={`rec-status ${isError ? 'rec-error' : 'rec-info'}`}>{recStatus}</div>
      )}

      <div className="input-bar">
        <button
          className={`voice-btn ${isRecording ? 'recording' : ''} ${recStatus === 'processing' ? 'processing' : ''}`}
          onClick={toggleRecording}
          disabled={recStatus === 'processing' || isThinking}
          title={isRecording ? 'Aufnahme stoppen (Cmd+Shift+M)' : 'Spracheingabe (Cmd+Shift+M)'}
        >
          {recStatus === 'processing' ? '…' : isRecording ? '⬛' : '🎙'}
        </button>

        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Nachricht… (Enter senden, Shift+Enter Umbruch)"
          rows={1}
          disabled={isThinking}
        />

        <button
          className="send-btn"
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isThinking}
          title="Senden"
        >↑</button>
      </div>
    </div>
  )
}
