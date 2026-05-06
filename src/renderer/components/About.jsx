import { useState, useEffect } from 'react'
import Icon from './Icons.jsx'

export default function About({ onClose }) {
  const [imgSrc, setImgSrc] = useState('/vinci-avatar.png')

  useEffect(() => {
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

        {/* Feature highlights */}
        <div className="about-features">
          <p className="about-features-headline">Vault &amp; Knowledge-Graph</p>
          <ul className="about-features-list">
            <li>WordPress-Blog-Importer (digitalhandwerk.rocks)</li>
            <li>Auto-Wikilinks im Body, Backlinks in Entity-Notes</li>
            <li>One-Shot-Cleaner mit Quarantäne &amp; Backup</li>
            <li>Auto-Alias für Vor-/Nachname-Duplikate</li>
            <li>&bdquo;Speicher das ins Vault&ldquo; nach Web-Recherche</li>
            <li>Hardened Memory-Worker (gemma3:4b)</li>
          </ul>
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
        <p className="about-version">v2.1.0</p>
      </div>
    </div>
  )
}
