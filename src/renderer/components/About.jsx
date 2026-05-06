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

        {/* Description — 9-10 Zeilen, was VINCI ist + macht */}
        <div className="about-description">
          <p className="about-copy">
            VINCI ist dein persönlicher KI-Assistent. Voice-first, am Mac zuhause, mit echtem Gedächtnis. Er kennt deinen Kalender, deine Mails, deine Erinnerungen, deine Kontakte und dein Smart-Home — und steuert sie über natürliche Sprache.
          </p>
          <p className="about-copy" style={{ marginTop: 10 }}>
            Im Hintergrund baut er einen Knowledge-Graph in Obsidian: jede Person, jede Firma, jedes Thema wird erkannt und automatisch verlinkt. Web-Recherchen kommen mit Quellen, Briefings starten den Tag, geplante Aufgaben laufen still im Hintergrund.
          </p>
          <p className="about-copy" style={{ marginTop: 10 }}>
            Eine eigene KI für dein Leben, deine Daten, deine Gewohnheiten. Kein Cloud-Lock-in, kein generischer Chatbot.
          </p>
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
              href="https://vibecraft.rocks"
              className="about-link"
              onClick={e => { e.preventDefault(); window.lyra.openExternal('https://vibecraft.rocks') }}
            >vibecraft.rocks</a>
            {' '}Projekt
          </p>
        </div>

        {/* Version */}
        <p className="about-version">v2.1.0</p>
      </div>
    </div>
  )
}
