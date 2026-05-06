// ── LyraOrbNebula — "Living Nebula" ──────────────────────────────────────────
// Idle:    Kugel atmet ±5%, Brownsche Mikrobewegung, gelegentliche Eruptionen
// Thinking: Morph zu Toroid (Donut), Partikel zirkulieren durchs Loch
// Speaking: Wellenpulse synchron zu synthetischer Amplitude + Außen-Glow
//
// Farbe: kommt als Hex-String per prop. Daraus werden 3 Tönungen abgeleitet
// (idle: base, speak: heller, think: dunkler).

import { useEffect, useRef } from 'react'

const N = 2200

// ── Color helpers ─────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const m = (hex || '#D4AF37').replace('#', '').match(/.{1,2}/g) || []
  return {
    r: parseInt(m[0] || 'd4', 16),
    g: parseInt(m[1] || 'af', 16),
    b: parseInt(m[2] || '37', 16)
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
function lerp(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t)
  }
}

// ── Punktverteilung: Kugel und Toroid für Morph ───────────────────────────────
function buildParticles(n) {
  const pts = []
  const phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    // Sphere coords
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const t = phi * i
    const sphereX = Math.cos(t) * r
    const sphereY = y
    const sphereZ = Math.sin(t) * r

    // Toroid coords (gleicher i → konsistente Zuordnung beim Morph)
    const u = (i / n) * Math.PI * 2          // großer Ring
    const v = (i * 0.3) % (Math.PI * 2)      // kleiner Ring
    const R_t = 0.85, r_t = 0.32
    const torusX = (R_t + r_t * Math.cos(v)) * Math.cos(u)
    const torusY = r_t * Math.sin(v)
    const torusZ = (R_t + r_t * Math.cos(v)) * Math.sin(u)

    pts.push({
      sx: sphereX, sy: sphereY, sz: sphereZ,
      tx: torusX,  ty: torusY,  tz: torusZ,
      // Brownsche Mikrobewegung
      jx: 0, jy: 0, jz: 0,
      vx: 0, vy: 0, vz: 0,
      size:   Math.random() * 1.6 + 0.5,
      bright: Math.random() * 0.45 + 0.55,
      phase:  Math.random() * Math.PI * 2,
      // Eruption-State
      erupt:  0,         // 0 = ruhig, >0 = aktiv mit lifetime
      ev:     [0, 0, 0]  // Eruptionsrichtung
    })
  }
  return pts
}

export default function LyraOrbNebula({ isSpeaking = false, isThinking = false, color = '#D4AF37' }) {
  const canvasRef = useRef(null)
  const stateRef  = useRef({ speak: 0, think: 0, speakV: 0, thinkV: 0, rotY: 0, rotX: 0 })

  useEffect(() => { stateRef.current.speak = isSpeaking ? 1 : 0 }, [isSpeaking])
  useEffect(() => { stateRef.current.think = isThinking  ? 1 : 0 }, [isThinking])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const pts = buildParticles(N)
    const dpr = window.devicePixelRatio || 1
    let animId, R = 110

    const baseRgb  = hexToRgb(color)
    const speakRgb = shade(baseRgb, 1.25)
    const thinkRgb = shade(baseRgb, 0.65)

    function resize() {
      canvas.width  = canvas.offsetWidth  * dpr
      canvas.height = canvas.offsetHeight * dpr
      R = Math.min(canvas.offsetWidth, canvas.offsetHeight) * 0.34
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let lastEruption = 0

    function draw(ts) {
      animId = requestAnimationFrame(draw)
      const s = stateRef.current
      s.speakV += (s.speak - s.speakV) * 0.07
      s.thinkV += (s.think - s.thinkV) * 0.04
      s.rotY   += 0.0035 + s.speakV * 0.012
      s.rotX   += 0.0009

      const t   = ts * 0.001
      const W   = canvas.width / dpr, H = canvas.height / dpr
      const cx  = W / 2, cy = H / 2
      const cY  = Math.cos(s.rotY), sY = Math.sin(s.rotY)
      const cX  = Math.cos(0.18 + s.rotX * 0.3), sX = Math.sin(0.18 + s.rotX * 0.3)

      // Atmen + Audio-Pulse
      const breath = 1 + Math.sin(t * 1.5) * 0.05               // Idle-Atmung
      const audioPulse = s.speakV > 0.01
        ? (Math.sin(t * 9) * 0.5 + Math.sin(t * 6.3) * 0.3 + Math.sin(t * 14) * 0.2) * 0.5 + 0.5
        : 0
      const Reff = R * breath * (1 + audioPulse * 0.18 * s.speakV)

      // Eruption auslösen (alle 2.5–4.5s zufällig)
      if (ts - lastEruption > (2500 + Math.random() * 2000) && s.thinkV < 0.3) {
        lastEruption = ts
        const eruptCount = 30 + Math.floor(Math.random() * 30)
        const startIdx = Math.floor(Math.random() * (pts.length - eruptCount))
        // Richtung der Eruption: tangential
        const dir = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]
        const len = Math.hypot(dir[0], dir[1], dir[2])
        dir[0] /= len; dir[1] /= len; dir[2] /= len
        for (let i = startIdx; i < startIdx + eruptCount; i++) {
          pts[i].erupt = 1
          pts[i].ev = [dir[0] * (1.5 + Math.random()), dir[1] * (1.5 + Math.random()), dir[2] * (1.5 + Math.random())]
        }
      }

      ctx.fillStyle = '#0c0e10'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.scale(dpr, dpr)

      // Outer halo bei Sprache
      if (s.speakV > 0.05) {
        const haloR = Reff * (1.5 + audioPulse * 0.4) * s.speakV
        const halo = ctx.createRadialGradient(cx, cy, Reff * 0.7, cx, cy, haloR)
        halo.addColorStop(0, `rgba(${speakRgb.r},${speakRgb.g},${speakRgb.b},${0.18 * s.speakV})`)
        halo.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2)
        ctx.fillStyle = halo; ctx.fill()
      }

      // Project particles
      const proj = []
      for (const p of pts) {
        // Morph Kugel ↔ Toroid (über thinkV)
        const m = s.thinkV
        let nx = p.sx + (p.tx - p.sx) * m
        let ny = p.sy + (p.ty - p.sy) * m
        let nz = p.sz + (p.tz - p.sz) * m

        // Brownsche Bewegung (kleiner Jitter)
        p.jx += (Math.random() - 0.5) * 0.012 - p.jx * 0.05
        p.jy += (Math.random() - 0.5) * 0.012 - p.jy * 0.05
        p.jz += (Math.random() - 0.5) * 0.012 - p.jz * 0.05

        let ox = nx * Reff + p.jx * Reff * 0.3
        let oy = ny * Reff + p.jy * Reff * 0.3
        let oz = nz * Reff + p.jz * Reff * 0.3

        // Eruption
        if (p.erupt > 0) {
          const dist = (1 - p.erupt) * 60
          ox += p.ev[0] * dist
          oy += p.ev[1] * dist
          oz += p.ev[2] * dist
          p.erupt -= 0.012
          if (p.erupt < 0) p.erupt = 0
        }

        // Rotation (Y dann X)
        const x1 = ox * cY + oz * sY
        const z1 = -ox * sY + oz * cY
        const y2 = oy * cX - z1 * sX
        const z2 = oy * sX + z1 * cX

        const fov = R * 3
        const sc  = fov / (fov + z2 + R * 0.5)
        proj.push({ sx: cx + x1 * sc, sy: cy + y2 * sc, z2, sc, depth: (z2 + R) / (R * 2), p })
      }
      proj.sort((a, b) => a.z2 - b.z2)

      for (const { sx, sy, depth, sc, p } of proj) {
        if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue
        const erupting = p.erupt > 0
        const sz = Math.max(0.3, p.size * sc * (1 + s.speakV * 0.4 + (erupting ? 0.6 : 0)))
        const flicker = 0.85 + Math.sin(t * 8 + p.phase) * 0.15
        const alpha = (0.12 + depth * 0.88) * p.bright * flicker *
                      (0.6 + s.speakV * 0.4 + (erupting ? 0.4 : 0))

        const col = erupting ? speakRgb
                  : s.speakV > 0.05 ? lerp(baseRgb, speakRgb, s.speakV)
                  : s.thinkV > 0.05 ? lerp(baseRgb, thinkRgb, s.thinkV * 0.8)
                  : baseRgb

        // Soft glow für nah liegende, größere Partikel
        if (depth > 0.62 && sz > 0.85) {
          const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, sz * 4)
          grd.addColorStop(0, `rgba(${col.r},${col.g},${col.b},${alpha * 0.22})`)
          grd.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.beginPath(); ctx.arc(sx, sy, sz * 4, 0, Math.PI * 2)
          ctx.fillStyle = grd; ctx.fill()
        }
        ctx.beginPath(); ctx.arc(sx, sy, sz, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${Math.min(1, alpha)})`
        ctx.fill()
      }

      // Center glow
      const gc = s.speakV > 0.1 ? speakRgb : s.thinkV > 0.1 ? thinkRgb : baseRgb
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Reff * 0.5)
      cg.addColorStop(0, `rgba(${gc.r},${gc.g},${gc.b},${0.06 + s.speakV * 0.1 + audioPulse * 0.05})`)
      cg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.beginPath(); ctx.arc(cx, cy, Reff * 0.5, 0, Math.PI * 2)
      ctx.fillStyle = cg; ctx.fill()

      ctx.restore()
    }

    animId = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animId); ro.disconnect() }
  }, [color])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}
