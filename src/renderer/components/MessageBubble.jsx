
// Simple markdown renderer: **bold**, *italic*, `code`, line breaks
function renderMarkdown(text) {
  if (!text) return []

  const parts = []
  let key = 0

  // Split by lines first
  const lines = text.split('\n')

  lines.forEach((line, li) => {
    if (li > 0) parts.push(<br key={`br-${li}`} />)

    // Process inline markdown within each line
    const segments = []
    let rest = line
    let i = 0

    while (rest.length > 0) {
      // Bold: **text**
      const bold = rest.match(/^\*\*(.+?)\*\*/)
      if (bold) {
        segments.push(<strong key={key++}>{bold[1]}</strong>)
        rest = rest.slice(bold[0].length)
        continue
      }
      // Italic: *text*
      const italic = rest.match(/^\*(.+?)\*/)
      if (italic) {
        segments.push(<em key={key++}>{italic[1]}</em>)
        rest = rest.slice(italic[0].length)
        continue
      }
      // Code: `text`
      const code = rest.match(/^`(.+?)`/)
      if (code) {
        segments.push(<code key={key++} style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: 3, fontSize: 12 }}>{code[1]}</code>)
        rest = rest.slice(code[0].length)
        continue
      }
      // Plain text up to next marker
      const nextMarker = rest.search(/\*\*|\*|`/)
      if (nextMarker === -1) {
        segments.push(<span key={key++}>{rest}</span>)
        rest = ''
      } else if (nextMarker === 0) {
        // Marker at start but didn't match — output single char
        segments.push(<span key={key++}>{rest[0]}</span>)
        rest = rest.slice(1)
      } else {
        segments.push(<span key={key++}>{rest.slice(0, nextMarker)}</span>)
        rest = rest.slice(nextMarker)
      }
    }

    parts.push(...segments)
  })

  return parts
}

export default function MessageBubble({ message }) {
  const isUser   = message.role === 'user'
  const isSystem = message.role === 'system'
  const isError  = message.isError

  const timeStr = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div
      className={`message ${isUser ? 'message-user' : 'message-lyra'} ${isSystem ? 'message-system' : ''} ${isError ? 'message-error' : ''}`}
    >
      {!isUser && <span className="message-label">VINCI</span>}

      <div className="message-bubble">
        <p className="message-text">
          {isUser ? message.content : renderMarkdown(message.content)}
        </p>
      </div>

      <div className="message-meta">
        <span className="message-time">{timeStr}</span>
      </div>
    </div>
  )
}
