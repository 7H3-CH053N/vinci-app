// ── LyraOrbHUD — "HUD / Circuit" ─────────────────────────────────────────────
// Sci-Fi-HUD-Stil: konzentrische Ringe + Partikel mit Linien-Verbindungen +
// hexagonale Knotenpunkte + Datenstrom.
//
// Idle:    Ringe rotieren langsam, wenige Connections, sanfte Strömung
// Thinking: Ringe schneller, viele Connections, leichtes Beben
// Speaking: Schockwellen-Pulse, alle Ringe pulsieren mit synthetischer Audio-Amplitude,
//           helle Strahlen vom Zentrum zu den Hexagonen
//
// Color als prop (Hex). Ableitungen für idle/think/speak.

import { useEffect, useRef } from 'react'

const N_PARTICLES = 900     // 3D-Partikel (verteilt auf Kugel)
const N_FRONT     = 80      // Anzahl der frontnahen Partikel, die für Connections berücksichtigt werden
const MAX_CONN    = 220     // Cap für Performance
const HEX_COUNT   = 6       // Hexagon-Knotenpunkte am Außenring

function hexToRgb(hex) {
  const m = (hex || '#2FE0CC').replace('#', '').match(/.{1,2}/g) || []
  return {
    r: parseInt(m[0] || '2f', 16),
    g: parseInt(m[1] || 'e0', 16),
    b: parseInt(m[2] || 'cc', 16)
  }
}
function shade(rgb, f) {
  if (f >= 1) return {
    r: Math.round(rgb.r + (255 - rgb.r) * (f - 1)),
    g: Math.round(rgb.g + (255 - rgb.g) * (f - 1)),
    b: Math.round(rgb.b + (255 - rgb.b) * (f - 1))
  }
  return { r: Math.round(rgb.r * f), g: Math.round(rgb.g * f), b: Math.round(rgb.b * f) }
}
const rgba = (c, a) => `rgba(${c.r},${c.g},${c.b},${a})`

function buildSphere(n) {
  const pts = []
  const phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const t = phi * i
    pts.push({
      nx: Math.cos(t) * r, ny: y, nz: Math.sin(t) * r,
      size: Math.random() * 1.6 + 0.6,        // verschiedene Größen wie gewünscht
      bright: Math.random() * 0.4 + 0.6,
      phase: Math.random() * Math.PI * 2
    })
  }
  return pts
}

// Ring-Definitionen: jeder Ring rotiert um eine andere Achse
const RINGS = [
  { radiusFactor: 1.05, axis: [0, 1, 0], speed: 0.3,  thickness: 1.2, dashFreq: 24 },
  { radiusFactor: 1.18, axis: [0.3, 0.95, 0],   speed: -0.2, thickness: 0.8, dashFreq: 60 },
  { radiusFactor: 1.32, axis: [-0.2, 1, 0.15],  speed: 0.15, thickness: 1.0, dashFreq: 36 },
  { radiusFactor: 0.78, axis: [0.5, 0.6, 0.6],  speed: 0.5,  thickness: 0.6, dashFreq: 48 }
]

// Achse normalisieren
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2])
  return l ? [v[0]/l, v[1]/l, v[2]/l] : [0,1,0]
}

export default function LyraOrbHUD({ isSpeaking = false, isThinking = false, color = '#2FE0CC' }) {
  const canvasRef = useRef(null)
  const stateRef  = useRef({ speak: 0, think: 0, speakV: 0, thinkV: 0, rotY: 0, rotX: 0, shocks: [], dataPackets: [] })

  useEffect(() => { stateRef.current.speak = isSpeaking ? 1 : 0 }, [isSpeaking])
  useEffect(() => { stateRef.current.think = isThinking  ? 1 : 0 }, [isThinking])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const pts = buildSphere(N_PARTICLES)
    const dpr = window.devicePixelRatio || 1
    let animId, R = 110

    const baseRgb  = hexToRgb(color)
    const speakRgb = shade(baseRgb, 1.30)
    const thinkRgb = shade(baseRgb, 0.70)

    function resize() {
      canvas.width  = canvas.offsetWidth  * dpr
      canvas.height = canvas.offsetHeight * dpr
      R = Math.min(canvas.offsetWidth, canvas.offsetHeight) * 0.30
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let lastShock = 0
    let lastPacket = 0

    function draw(ts) {
      animId = requestAnimationFrame(draw)
      const s = stateRef.current
      s.speakV += (s.speak - s.speakV) * 0.08
      s.thinkV += (s.think - s.thinkV) * 0.05
      s.rotY   += 0.0035 + s.speakV * 0.008 + s.thinkV * 0.005
      s.rotX   += 0.0008

      const t  = ts * 0.001
      const W  = canvas.width / dpr, H = canvas.height / dpr
      const cx = W / 2, cy = H / 2
      const cY = Math.cos(s.rotY), sY = Math.sin(s.rotY)
      const tilt = 0.18 + Math.sin(s.rotX) * 0.06
      const cX = Math.cos(tilt), sX = Math.sin(tilt)

      // Audio-amplitude
      const amp = s.speakV > 0.01
        ? (Math.sin(t * 9) * 0.5 + Math.sin(t * 6.3) * 0.3 + Math.sin(t * 14) * 0.2) * 0.5 + 0.5
        : 0
      const audioBoost = 1 + amp * 0.12 * s.speakV

      // Schockwellen beim Sprechen
      if (s.speakV > 0.3 && ts - lastShock > 480) {
        lastShock = ts
        s.shocks.push({ r: R * 0.7, life: 1, strength: 0.7 + amp * 0.4 })
      }

      // Datenpakete: Zentrum → Hexagon (auch im Idle, langsamer)
      const packetRate = s.speakV > 0.3 ? 120 : s.thinkV > 0.3 ? 200 : 700
      if (ts - lastPacket > packetRate) {
        lastPacket = ts
        const angle = (Math.floor(Math.random() * HEX_COUNT) / HEX_COUNT) * Math.PI * 2
        s.dataPackets.push({ angle, progress: 0, life: 1 })
      }

      ctx.fillStyle = '#0a0c0e'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.scale(dpr, dpr)

      // ── Hexagonale Knotenpunkte am Rand ──────────────────────────────────
      const hexRadius = R * 1.55
      const hexPoints = []
      for (let i = 0; i < HEX_COUNT; i++) {
        const a = (i / HEX_COUNT) * Math.PI * 2 + s.rotY * 0.2
        const hx = cx + Math.cos(a) * hexRadius
        const hy = cy + Math.sin(a) * hexRadius * 0.9   // leicht oval
        hexPoints.push({ x: hx, y: hy, a })
      }
      // Hex-Symbol zeichnen
      const hexCol = s.thinkV > 0.1 ? thinkRgb : s.speakV > 0.1 ? speakRgb : baseRgb
      for (const h of hexPoints) {
        const blink = 0.5 + Math.sin(t * 2 + h.a * 3) * 0.3 + s.speakV * 0.4
        ctx.strokeStyle = rgba(hexCol, 0.5 * blink)
        ctx.lineWidth = 1.2
        ctx.beginPath()
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2 + Math.PI / 6
          const hx = h.x + Math.cos(ang) * 6
          const hy = h.y + Math.sin(ang) * 6
          if (k === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy)
        }
        ctx.closePath(); ctx.stroke()
      }

      // ── Konzentrische Ringe (mit Tick-Marks) ─────────────────────────────
      for (const ring of RINGS) {
        const ringR = R * ring.radiusFactor * audioBoost
        const phase = t * ring.speed * (1 + s.thinkV * 0.6 + s.speakV * 0.3)
        const ax = norm3(ring.axis)

        // Ring als gestrichelter Bogen, schief im Raum (durch axis-Tilt simuliert)
        // Wir zeichnen ihn als Ellipse + tick-marks
        const tilt2 = Math.acos(ax[1])  // Tilt vom Y-Up
        const rotPlane = Math.atan2(ax[2], ax[0])

        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(rotPlane + phase * 0.1)
        // y-scale für Tilt
        const yScale = Math.cos(tilt2) || 0.001
        ctx.scale(1, Math.abs(yScale) + 0.15)

        // Tick-marks auf dem Ring
        const ringAlpha = 0.18 + s.thinkV * 0.25 + s.speakV * 0.35
        ctx.strokeStyle = rgba(s.speakV > 0.1 ? speakRgb : s.thinkV > 0.1 ? thinkRgb : baseRgb, ringAlpha)
        ctx.lineWidth = ring.thickness
        for (let k = 0; k < ring.dashFreq; k++) {
          const a = (k / ring.dashFreq) * Math.PI * 2 + phase
          if (k % 4 === 0) {
            // Kürzere ticks
            const x1 = Math.cos(a) * (ringR - 2)
            const y1 = Math.sin(a) * (ringR - 2)
            const x2 = Math.cos(a) * (ringR + 4)
            const y2 = Math.sin(a) * (ringR + 4)
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
          } else {
            const x1 = Math.cos(a) * (ringR - 1)
            const y1 = Math.sin(a) * (ringR - 1)
            const x2 = Math.cos(a) * (ringR + 1)
            const y2 = Math.sin(a) * (ringR + 1)
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
          }
        }
        // Dünner Hauptring
        ctx.strokeStyle = rgba(s.speakV > 0.1 ? speakRgb : baseRgb, ringAlpha * 0.5)
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.arc(0, 0, ringR, 0, Math.PI * 2)
        ctx.stroke()

        ctx.restore()
      }

      // ── Schockwellen ─────────────────────────────────────────────────────
      for (let i = s.shocks.length - 1; i >= 0; i--) {
        const sh = s.shocks[i]
        sh.r += 5 + sh.strength * 4
        sh.life -= 0.022
        if (sh.life <= 0 || sh.r > Math.max(W, H)) { s.shocks.splice(i, 1); continue }
        ctx.strokeStyle = rgba(speakRgb, sh.life * 0.4 * sh.strength)
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(cx, cy, sh.r, 0, Math.PI * 2); ctx.stroke()
      }

      // ── 3D-Partikel projizieren ──────────────────────────────────────────
      const proj = []
      for (const p of pts) {
        const Reff = R * audioBoost
        const breath = 1 + Math.sin(t * 1.4 + p.phase * 0.2) * 0.025
        const ox = p.nx * Reff * breath
        const oy = p.ny * Reff * breath
        const oz = p.nz * Reff * breath

        const x1 = ox * cY + oz * sY
        const z1 = -ox * sY + oz * cY
        const y2 = oy * cX - z1 * sX
        const z2 = oy * sX + z1 * cX

        const fov = R * 3
        const sc  = fov / (fov + z2 + R * 0.5)
        proj.push({ sx: cx + x1 * sc, sy: cy + y2 * sc, z2, sc, depth: (z2 + R) / (R * 2), p })
      }
      proj.sort((a, b) => a.z2 - b.z2)

      // ── Connections zwischen frontnahen Partikeln ───────────────────────
      // Nimm nur die N_FRONT mit höchstem depth (am nähesten zur Kamera)
      const front = proj.slice(-N_FRONT)
      const connColor = s.speakV > 0.1 ? speakRgb : s.thinkV > 0.1 ? thinkRgb : baseRgb
      const connBaseAlpha = 0.06 + s.thinkV * 0.18 + s.speakV * 0.20
      const connDistMax = R * (0.35 + s.thinkV * 0.15)
      let drawnConn = 0
      for (let i = 0; i < front.length && drawnConn < MAX_CONN; i++) {
        for (let j = i + 1; j < front.length && drawnConn < MAX_CONN; j++) {
          const a = front[i], b = front[j]
          const dx = a.sx - b.sx, dy = a.sy - b.sy
          const d = Math.hypot(dx, dy)
          if (d < connDistMax) {
            const alpha = connBaseAlpha * (1 - d / connDistMax) * (0.4 + a.depth * 0.3 + b.depth * 0.3)
            if (alpha < 0.01) continue
            ctx.strokeStyle = rgba(connColor, alpha)
            ctx.lineWidth = 0.5
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
            drawnConn++
          }
        }
      }

      // ── Partikel zeichnen ───────────────────────────────────────────────
      for (const { sx, sy, depth, sc, p } of proj) {
        if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue
        const flicker = 0.85 + Math.sin(t * 6 + p.phase) * 0.15
        const sz = Math.max(0.3, p.size * sc * (1 + s.speakV * 0.4))
        const alpha = (0.15 + depth * 0.85) * p.bright * flicker *
                      (0.6 + s.speakV * 0.4 + s.thinkV * 0.2)
        const col = s.speakV > 0.1 ? speakRgb : s.thinkV > 0.1 ? thinkRgb : baseRgb

        if (depth > 0.62 && sz > 0.85) {
          const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, sz * 4)
          grd.addColorStop(0, rgba(col, alpha * 0.3))
          grd.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.beginPath(); ctx.arc(sx, sy, sz * 4, 0, Math.PI * 2)
          ctx.fillStyle = grd; ctx.fill()
        }
        ctx.beginPath(); ctx.arc(sx, sy, sz, 0, Math.PI * 2)
        ctx.fillStyle = rgba(col, Math.min(1, alpha))
        ctx.fill()
      }

      // ── Datenpakete: Zentrum → Hexagon ──────────────────────────────────
      for (let i = s.dataPackets.length - 1; i >= 0; i--) {
        const dp = s.dataPackets[i]
        dp.progress += 0.02 + s.speakV * 0.015
        dp.life -= 0.015
        if (dp.progress >= 1 || dp.life <= 0) { s.dataPackets.splice(i, 1); continue }
        const targetHex = hexPoints[Math.floor((dp.angle / (Math.PI * 2)) * HEX_COUNT) % HEX_COUNT]
        const sx = cx + (targetHex.x - cx) * dp.progress
        const sy = cy + (targetHex.y - cy) * dp.progress
        // Trail
        const trailX = cx + (targetHex.x - cx) * Math.max(0, dp.progress - 0.18)
        const trailY = cy + (targetHex.y - cy) * Math.max(0, dp.progress - 0.18)
        const grd = ctx.createLinearGradient(trailX, trailY, sx, sy)
        grd.addColorStop(0, rgba(connColor, 0))
        grd.addColorStop(1, rgba(speakRgb, dp.life * 0.8))
        ctx.strokeStyle = grd
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(trailX, trailY); ctx.lineTo(sx, sy); ctx.stroke()
        // Punkt
        ctx.fillStyle = rgba(speakRgb, dp.life)
        ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, Math.PI * 2); ctx.fill()
      }

      // ── Center glow ─────────────────────────────────────────────────────
      const gc = s.speakV > 0.1 ? speakRgb : s.thinkV > 0.1 ? thinkRgb : baseRgb
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6)
      cg.addColorStop(0, rgba(gc, 0.08 + s.speakV * 0.15 + amp * 0.08))
      cg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2)
      ctx.fillStyle = cg; ctx.fill()

      ctx.restore()
    }

    animId = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animId); ro.disconnect() }
  }, [color])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}
