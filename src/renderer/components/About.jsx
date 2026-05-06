import { useState, useEffect } from 'react'
import Icon from './Icons.jsx'

export default function About({ onClose }) {
  const [imgSrc, setImgSrc] = useState('/vinci-avatar.png')

  useEffect(() => {
    // In packaged app, resolve via IPC; in dev, use /vinci-avatar.png
    if (window.lyra?.getAssetPath) {
      window.lyra.getAssetPath('vinci-avatar.png').then(src => setImgSrc(src)).catch(() => {})
    }
  }, [])
  return (
    <div className="about-panel">
      <div className="about-header">
        <span className="settings-title">ÜBER VINCI</span>
        <button className="close-btn" onClick={onClose}><Icon.X /></button>
      </div>

      <div className="about-body">
        {/* Vitruvian Man */}
        <div className="about-logo">
          <img src={imgSrc} alt="VINCI" className="about-img" />
        </div>

        {/* Title */}
        <div className="about-title-block">
          <h1 className="about-name">VINCI</h1>
          <p className="about-subtitle">Personal AI Assistant</p>
        </div>

        {/* Divider */}
        <div className="about-divider" />

        {/* Copyright */}
        <div className="about-credits">
          <p className="about-copy">© 2026 Alex Januschewsky</p>
          <p className="about-copy">
            der &ldquo;<a
              href="https://promptrocker.at"
              className="about-link"
              onClick={e => { e.preventDefault(); window.lyra.openExternal('https://promptrocker.at') }}
            >Prompt Rocker</a>&rdquo;
          </p>
          <p className="about-copy" style={{ marginTop: 12 }}>
            Ein{' '}
            <a
              href="https://vibecodes.at"
              className="about-link"
              onClick={e => { e.preventDefault(); window.lyra.openExternal('https://vibecodes.at') }}
            >vibecodes.at</a>
            {' '}Projekt
          </p>
        </div>

        {/* Version */}
        <p className="about-version">v2.0.0</p>
      </div>
    </div>
  )
}
