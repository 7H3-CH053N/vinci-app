import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Partikel-Orb — treue Portierung des JARVIS-Orbs.
 * Goldtöne statt Blau, container-skaliert (ResizeObserver), transparenter Hintergrund.
 * Velocity-basierte Brownsche Bewegung, Transition-Tumble, Cloud-Z-Atmung, Kamera-Drift.
 */

const N = 2000
const MAX_LINES = 8000
const MAX_ELECTRONS = 200

// Gold-Töne
const GOLD_IDLE  = new THREE.Color(0xD4AF37)
const GOLD_THINK = new THREE.Color(0xF4D06F)
const GOLD_SPEAK = new THREE.Color(0xE5BE52)

export default function LyraOrbParticle({ isSpeaking = false, isThinking = false, color, analyser = null }) {
  const wrapRef = useRef(null)
  const stateRef = useRef('idle')
  const analyserRef = useRef(null)
  const freqDataRef = useRef(null)
  useEffect(() => { analyserRef.current = analyser }, [analyser])

  // Map booleans -> state string (idle | listening | thinking | speaking)
  useEffect(() => {
    stateRef.current = isSpeaking ? 'speaking' : isThinking ? 'thinking' : 'idle'
  }, [isSpeaking, isThinking])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    // Override base color wenn Settings eine eigene Orb-Farbe vorgeben
    const baseIdle  = color ? new THREE.Color(color) : GOLD_IDLE.clone()
    const baseThink = color
      ? baseIdle.clone().lerp(new THREE.Color(0xffffff), 0.35)
      : GOLD_THINK.clone()
    const baseSpeak = color
      ? baseIdle.clone().lerp(new THREE.Color(0xffffff), 0.18)
      : GOLD_SPEAK.clone()

    let destroyed = false

    // ── Renderer (transparent) ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    wrap.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1000)
    camera.position.z = 80

    // ── Particles ──
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(N * 3)
    const vel = new Float32Array(N * 3)
    const phase = new Float32Array(N)

    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = Math.pow(Math.random(), 0.5) * 25
      pos[i*3]   = r * Math.sin(phi) * Math.cos(theta)
      pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta)
      pos[i*3+2] = r * Math.cos(phi)
      phase[i] = Math.random() * 1000
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))

    const mat = new THREE.PointsMaterial({
      color: baseIdle.clone(),
      size: 0.4,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const points = new THREE.Points(geo, mat)
    scene.add(points)

    // ── Connection lines ──
    const linePos = new Float32Array(MAX_LINES * 6)
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
    lineGeo.setDrawRange(0, 0)
    const lineMat = new THREE.LineBasicMaterial({
      color: baseIdle.clone(),
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const lines = new THREE.LineSegments(lineGeo, lineMat)
    scene.add(lines)

    // ── Electrons (helle Funken auf Linien — nur beim Denken) ──
    const electronGeo = new THREE.BufferGeometry()
    const electronPos = new Float32Array(MAX_ELECTRONS * 3)
    electronGeo.setAttribute('position', new THREE.BufferAttribute(electronPos, 3))
    electronGeo.setDrawRange(0, 0)
    const electronMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.8,
      transparent: true,
      opacity: 1.0,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const electrons = new THREE.Points(electronGeo, electronMat)
    scene.add(electrons)

    const activeElectrons = []
    let lastElectronSpawn = 0
    let activeConnections = []

    // ── Animation State ──
    let targetRadius = 25, currentRadius = 25
    let targetSpeed = 0.3,  currentSpeed = 0.3
    let targetBright = 0.6, currentBright = 0.6
    let targetSize = 0.4,   currentSize = 0.4
    let lineAmount = 0,     targetLineAmount = 0
    let electronSpawnRate = 0, targetElectronRate = 0
    const lineDistance = 8

    // Transition tumble
    let spinX = 0, spinY = 0, spinZ = 0
    let transitionEnergy = 0
    let lastState = 'idle'

    // Cloud Z-breathing
    let cloudZ = 0, cloudZVel = 0

    const clock = new THREE.Clock()

    // ── Resize via Container ──
    // Camera-Distanz wird so gewählt dass die maximale Partikel-Ausdehnung (HARD_MAX_R)
    // immer mit ~10px Rand zum Container passt — egal ob Fenster groß/klein,
    // Chat offen/zu. So kommt der Orb nie über die Fensterränder.
    const HARD_MAX_R = 50      // Hard-Cap für Partikel-Distanz
    const VIEWPORT_MARGIN_PX = 10
    const CAMERA_DRIFT = 8     // Compensate für camera.position.x/y oscillation in animate()

    function resize() {
      const w = wrap.clientWidth || 1
      const h = wrap.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h

      // Kameraabstand so wählen, dass HARD_MAX_R + CAMERA_DRIFT in beide Achsen passt mit 10px Buffer
      const usableV = Math.max(0.1, (h - VIEWPORT_MARGIN_PX * 2) / h)
      const usableH = Math.max(0.1, (w - VIEWPORT_MARGIN_PX * 2) / w)
      const fovV = camera.fov * Math.PI / 180
      const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect)
      const visibleR = HARD_MAX_R + CAMERA_DRIFT
      const distV = visibleR / Math.tan(fovV / 2) / usableV
      const distH = visibleR / Math.tan(fovH / 2) / usableH
      camera.position.z = Math.max(distV, distH, 60)
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    function animate() {
      if (destroyed) return
      requestAnimationFrame(animate)
      const t = clock.getElapsedTime()
      const state = stateRef.current

      // State targets
      switch (state) {
        case 'idle':
          targetRadius = 28; targetSpeed = 0.2; targetBright = 0.5; targetSize = 0.35
          targetLineAmount = 0.15; targetElectronRate = 0; break
        case 'listening':
          targetRadius = 22; targetSpeed = 0.3; targetBright = 0.65; targetSize = 0.4
          targetLineAmount = 0.4; targetElectronRate = 0; break
        case 'thinking':
          targetRadius = 16; targetSpeed = 0.5; targetBright = 0.7; targetSize = 0.3
          targetLineAmount = 1.0; targetElectronRate = 0.015; break
        case 'speaking':
          targetRadius = 18; targetSpeed = 0.2; targetBright = 0.7; targetSize = 0.4
          targetLineAmount = 0.8; targetElectronRate = 0; break
      }

      currentRadius += (targetRadius - currentRadius) * 0.02
      currentSpeed  += (targetSpeed  - currentSpeed)  * 0.02
      currentBright += (targetBright - currentBright) * 0.02
      currentSize   += (targetSize   - currentSize)   * 0.02
      lineAmount    += (targetLineAmount - lineAmount) * 0.02
      electronSpawnRate += (targetElectronRate - electronSpawnRate) * 0.02

      // Audio-Reaktivität: echter AnalyserNode wenn verfügbar (Edge TTS),
      // sonst synthetisierte Pulse beim Sprechen.
      let bass = 0, mid = 0
      const ana = analyserRef.current
      if (state === 'speaking' && ana) {
        const bins = ana.frequencyBinCount
        if (!freqDataRef.current || freqDataRef.current.length !== bins) {
          freqDataRef.current = new Uint8Array(bins)
        }
        ana.getByteFrequencyData(freqDataRef.current)
        const fd = freqDataRef.current
        const bassEnd = Math.min(8, bins)
        const midEnd  = Math.min(24, bins)
        let bSum = 0, mSum = 0
        for (let i = 0; i < bassEnd; i++) bSum += fd[i]
        for (let i = bassEnd; i < midEnd; i++) mSum += fd[i]
        bass = bSum / (bassEnd * 255)
        mid  = mSum / ((midEnd - bassEnd) * 255)
      } else if (state === 'speaking') {
        const w1 = Math.sin(t * 6.0) * 0.5 + 0.5
        const w2 = Math.sin(t * 9.3 + 1.7) * 0.5 + 0.5
        const w3 = Math.sin(t * 13.1 + 3.4) * 0.5 + 0.5
        bass = (w1 * 0.6 + w2 * 0.3 + w3 * 0.1) * 0.7
        mid  = (w2 * 0.5 + w3 * 0.5) * 0.6
      }

      // Transition tumble
      if (state !== lastState) { transitionEnergy = 1.0; lastState = state }
      transitionEnergy *= 0.985
      if (transitionEnergy > 0.05) {
        spinX += transitionEnergy * 0.012 * Math.sin(t * 1.7)
        spinY += transitionEnergy * 0.015
        spinZ += transitionEnergy * 0.008 * Math.cos(t * 1.3)
      }

      // Cloud Z breathing
      let zTarget = Math.sin(t * 0.12) * 8
      if (state === 'thinking') zTarget = Math.sin(t * 0.3) * 15 + Math.sin(t * 0.9) * 6
      else if (state === 'speaking') zTarget = Math.sin(t * 0.15) * 6 - bass * 10
      cloudZVel += (zTarget - cloudZ) * 0.008
      cloudZVel *= 0.94
      cloudZ += cloudZVel

      points.rotation.set(spinX, spinY, spinZ)
      points.position.z = cloudZ
      lines.rotation.set(spinX, spinY, spinZ)
      lines.position.z = cloudZ
      electrons.rotation.set(spinX, spinY, spinZ)
      electrons.position.z = cloudZ

      // ── Update particles (velocity-based brownian + radial pull) ──
      const a = pos
      for (let i = 0; i < N; i++) {
        const i3 = i * 3
        const x = a[i3], y = a[i3+1], z = a[i3+2]
        const px = phase[i]

        vel[i3]   += Math.sin(t * 0.05 + px)        * 0.001 * currentSpeed
        vel[i3+1] += Math.cos(t * 0.06 + px * 1.3)  * 0.001 * currentSpeed
        vel[i3+2] += Math.sin(t * 0.055 + px * 0.7) * 0.001 * currentSpeed
        vel[i3]   += Math.sin(t * 0.02 + px * 2.1 + y * 0.1) * 0.0008 * currentSpeed
        vel[i3+1] += Math.cos(t * 0.025 + px * 1.7 + z * 0.1) * 0.0008 * currentSpeed
        vel[i3+2] += Math.sin(t * 0.022 + px * 0.9 + x * 0.1) * 0.0008 * currentSpeed

        const dist = Math.sqrt(x*x + y*y + z*z) || 0.01
        const pull = Math.max(0, dist - currentRadius) * 0.002 + 0.0003
        vel[i3]   -= (x / dist) * pull
        vel[i3+1] -= (y / dist) * pull
        vel[i3+2] -= (z / dist) * pull

        // Audio-reaktive Pulse beim Sprechen
        if (bass > 0.05) {
          vel[i3]   += (x / dist) * bass * 0.02
          vel[i3+1] += (y / dist) * bass * 0.02
          vel[i3+2] += (z / dist) * bass * 0.02
        }
        if (state === 'speaking' && mid > 0.1) {
          const pulse = Math.sin(t * 8 + px)
          vel[i3]   += (x / dist) * mid * 0.012 * pulse
          vel[i3+1] += (y / dist) * mid * 0.012 * pulse
        }

        vel[i3]   *= 0.992
        vel[i3+1] *= 0.992
        vel[i3+2] *= 0.992
        a[i3]   += vel[i3]
        a[i3+1] += vel[i3+1]
        a[i3+2] += vel[i3+2]

        // Hard-Cap: Partikel niemals über HARD_MAX_R hinaus — sonst Orb über Fensterrand
        const newDistSq = a[i3]*a[i3] + a[i3+1]*a[i3+1] + a[i3+2]*a[i3+2]
        if (newDistSq > HARD_MAX_R * HARD_MAX_R) {
          const newDist = Math.sqrt(newDistSq)
          const k = HARD_MAX_R / newDist
          a[i3]   *= k
          a[i3+1] *= k
          a[i3+2] *= k
          // Velocity dämpfen damit nicht sofort wieder rausschiesst
          vel[i3]   *= 0.3
          vel[i3+1] *= 0.3
          vel[i3+2] *= 0.3
        }
      }
      geo.attributes.position.needsUpdate = true

      // ── Update lines ──
      if (lineAmount > 0.01) {
        let lineCount = 0
        const maxDist = lineDistance
        const maxDistSq = maxDist * maxDist
        const step = Math.max(1, Math.floor(N / 600))

        for (let i = 0; i < N && lineCount < MAX_LINES; i += step) {
          const i3 = i * 3
          const x1 = a[i3], y1 = a[i3+1], z1 = a[i3+2]
          for (let j = i + step; j < N && lineCount < MAX_LINES; j += step) {
            const j3 = j * 3
            const dx = a[j3] - x1, dy = a[j3+1] - y1, dz = a[j3+2] - z1
            if (dx*dx + dy*dy + dz*dz < maxDistSq) {
              const idx = lineCount * 6
              linePos[idx]   = x1; linePos[idx+1] = y1; linePos[idx+2] = z1
              linePos[idx+3] = a[j3]; linePos[idx+4] = a[j3+1]; linePos[idx+5] = a[j3+2]
              lineCount++
            }
          }
        }
        lineGeo.setDrawRange(0, lineCount * 2)
        lineGeo.attributes.position.needsUpdate = true
        lineMat.opacity = lineAmount * 0.12

        // Active connections für Electron-Spawn (max 500)
        activeConnections.length = 0
        const sliceMax = Math.min(lineCount, 500)
        for (let c = 0; c < sliceMax; c++) {
          const ci = c * 6
          activeConnections.push({
            x1: linePos[ci],   y1: linePos[ci+1], z1: linePos[ci+2],
            x2: linePos[ci+3], y2: linePos[ci+4], z2: linePos[ci+5]
          })
        }
      } else {
        lineGeo.setDrawRange(0, 0)
        activeConnections.length = 0
      }

      // ── Electrons (nur beim Denken, max 3 lebende) ──
      if (activeConnections.length > 0 && electronSpawnRate > 0.005) {
        if (activeElectrons.length < 3 && (t - lastElectronSpawn) > 1.0) {
          const conn = activeConnections[Math.floor(Math.random() * activeConnections.length)]
          activeElectrons.push({
            sx: conn.x1, sy: conn.y1, sz: conn.z1,
            ex: conn.x2, ey: conn.y2, ez: conn.z2,
            t: 0,
            speed: 0.003 + Math.random() * 0.003
          })
          lastElectronSpawn = t
        }
      }

      let aliveCount = 0
      for (let e = activeElectrons.length - 1; e >= 0; e--) {
        const el = activeElectrons[e]
        el.t += el.speed
        if (el.t >= 1) { activeElectrons.splice(e, 1); continue }
        const ei = aliveCount * 3
        electronPos[ei]   = el.sx + (el.ex - el.sx) * el.t
        electronPos[ei+1] = el.sy + (el.ey - el.sy) * el.t
        electronPos[ei+2] = el.sz + (el.ez - el.sz) * el.t
        aliveCount++
      }
      electronGeo.setDrawRange(0, aliveCount)
      electronGeo.attributes.position.needsUpdate = true

      // ── Visuals (mit Audio-Reaktivität) ──
      mat.opacity = currentBright + bass * 0.08
      mat.size = currentSize + bass * 0.05

      // Linien-Reichweite wächst mit bass — mehr Verbindungen beim Sprech-Peak
      // (in der Loop selbst wird maxDist nicht dynamisch verwendet, daher hier
      //  nur Visuals-Sichtbarkeit; subtile Effekt reicht aus)

      if (state === 'thinking') {
        mat.color.lerp(baseThink, 0.015)
        lineMat.color.lerp(baseThink, 0.015)
      } else if (state === 'speaking') {
        mat.color.lerp(baseSpeak, 0.015)
        lineMat.color.lerp(baseSpeak, 0.015)
      } else {
        mat.color.lerp(baseIdle, 0.015)
        lineMat.color.lerp(baseIdle, 0.015)
      }

      // Kamera-Drift
      camera.position.x = Math.sin(t * 0.02) * 5
      camera.position.y = Math.cos(t * 0.03) * 3
      camera.lookAt(0, 0, cloudZ * 0.2)

      renderer.render(scene, camera)
    }

    animate()

    return () => {
      destroyed = true
      ro.disconnect()
      try { wrap.removeChild(renderer.domElement) } catch {}
      geo.dispose(); mat.dispose()
      lineGeo.dispose(); lineMat.dispose()
      electronGeo.dispose(); electronMat.dispose()
      renderer.dispose()
    }
  }, [color])

  return <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }} />
}
