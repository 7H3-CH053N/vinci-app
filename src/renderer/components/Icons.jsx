// ── Icon-Set ──────────────────────────────────────────────────────────────────
// Einheitliche SVG-Icons im Lucide-Stil:
//  - 24×24 viewBox
//  - stroke-basiert mit currentColor (übernimmt CSS-Farbe)
//  - stroke-width 2, round caps/joins
//  - Default 16px Größe
//
// Verwendung:  <Icon.Sun />   oder mit eigener Größe:  <Icon.Sun size={20} />

const base = (size = 16) => ({
  width: size, height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false
})

// Sonne mit Strahlen — für Morgen-Briefing
function Sun({ size }) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

// Liste mit Häkchen — für Aufgaben (klar erkennbar als „To-Do-Liste")
function ListChecks({ size }) {
  return (
    <svg {...base(size)}>
      {/* drei Häkchen */}
      <path d="m3 7 1.5 1.5L8 5" />
      <path d="m3 13 1.5 1.5L8 11" />
      <path d="m3 19 1.5 1.5L8 17" />
      {/* drei Linien daneben */}
      <path d="M11 6h10M11 12h10M11 18h10" />
    </svg>
  )
}

// Zahnrad — für Einstellungen
function Settings({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

// X — für Schließen-Buttons
function X({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

export default { Sun, ListChecks, Settings, X }
