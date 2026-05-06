import { useEffect, useRef } from 'react'

const GOLD_IDLE  = { r: 212, g: 175, b: 55  }
const GOLD_SPEAK = { r: 242, g: 202, b: 80  }
const GOLD_THINK = { r: 138, g: 112, b: 32  }
const N = 1800

function sphere(n) {
  const pts = [], phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n-1)) * 2, r = Math.sqrt(1 - y*y), t = phi * i
    pts.push({ nx: Math.cos(t)*r, ny: y, nz: Math.sin(t)*r,
      size: Math.random()*1.8+0.4, bright: Math.random()*0.45+0.6, phase: Math.random()*Math.PI*2 })
  }
  return pts
}

function lerp(a, b, t) {
  return { r: Math.round(a.r+(b.r-a.r)*t), g: Math.round(a.g+(b.g-a.g)*t), b: Math.round(a.b+(b.b-a.b)*t) }
}

export default function LyraOrb({ isSpeaking=false, isThinking=false }) {
  const canvasRef = useRef(null)
  const stateRef  = useRef({ speak: 0, think: 0, rotY: 0, speakV: 0, thinkV: 0 })

  useEffect(() => { stateRef.current.speak = isSpeaking ? 1 : 0 }, [isSpeaking])
  useEffect(() => { stateRef.current.think = isThinking  ? 1 : 0 }, [isThinking])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const pts = sphere(N)
    const dpr = window.devicePixelRatio || 1
    let animId, R = 110

    function resize() {
      canvas.width  = canvas.offsetWidth  * dpr
      canvas.height = canvas.offsetHeight * dpr
      R = Math.min(canvas.offsetWidth, canvas.offsetHeight) * 0.38
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function draw(ts) {
      animId = requestAnimationFrame(draw)
      const s = stateRef.current
      s.speakV += (s.speak - s.speakV) * 0.06
      s.thinkV += (s.think - s.thinkV) * 0.05
      s.rotY   += 0.003 + s.speakV * 0.015 + s.thinkV * 0.006

      const t   = ts * 0.001
      const W   = canvas.width / dpr, H = canvas.height / dpr
      const cx  = W/2, cy = H/2
      const cY  = Math.cos(s.rotY), sY = Math.sin(s.rotY)
      const cX  = Math.cos(0.25),   sX = Math.sin(0.25)

      // Solid background
      ctx.fillStyle = '#121414'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.scale(dpr, dpr)

      // Project particles
      const proj = pts.map(p => {
        let ox = p.nx*R, oy = p.ny*R, oz = p.nz*R
        if (s.speakV > 0.01) {
          const b = (Math.sin(t*7+p.phase)*14 + Math.sin(t*4.5+p.phase*1.6)*7) * s.speakV
          ox += p.nx*b; oy += p.ny*b; oz += p.nz*b
        }
        if (s.thinkV > 0.01) {
          const sw = Math.sin(t*2.5+p.phase)*8*s.thinkV
          ox += sw*p.ny; oy -= sw*p.nx
        }
        const br = Math.sin(t*0.55+p.phase*0.4)*(R*0.03)
        ox += p.nx*br; oy += p.ny*br; oz += p.nz*br

        const x1 =  ox*cY + oz*sY, z1 = -ox*sY + oz*cY
        const y2  =  oy*cX - z1*sX, z2 =  oy*sX + z1*cX
        const fov = R*3, sc = fov/(fov+z2+R*0.5)
        return { sx: cx+x1*sc, sy: cy+y2*sc, z2, sc, depth:(z2+R)/(R*2), p }
      })
      proj.sort((a,b) => a.z2 - b.z2)

      for (const { sx, sy, depth, sc, p } of proj) {
        if (sx<-20||sx>W+20||sy<-20||sy>H+20) continue
        const sz    = Math.max(0.3, p.size*sc*(1+s.speakV*0.7))
        const alpha = (0.1+depth*0.9)*p.bright*(0.5+s.speakV*0.5+s.thinkV*0.1)
        const col   = s.speakV>0.01&&s.speakV>=s.thinkV ? lerp(GOLD_IDLE,GOLD_SPEAK,s.speakV)
                    : s.thinkV>0.01 ? lerp(GOLD_IDLE,GOLD_THINK,s.thinkV)
                    : GOLD_IDLE

        if (depth>0.65&&sz>0.9) {
          const grd = ctx.createRadialGradient(sx,sy,0,sx,sy,sz*4)
          grd.addColorStop(0,`rgba(${col.r},${col.g},${col.b},${alpha*0.2})`)
          grd.addColorStop(1,'rgba(0,0,0,0)')
          ctx.beginPath(); ctx.arc(sx,sy,sz*4,0,Math.PI*2)
          ctx.fillStyle = grd; ctx.fill()
        }
        ctx.beginPath(); ctx.arc(sx,sy,sz,0,Math.PI*2)
        ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${Math.min(1,alpha)})`
        ctx.fill()
      }

      // Center glow
      const gc = s.speakV>0.1?GOLD_SPEAK:s.thinkV>0.1?GOLD_THINK:GOLD_IDLE
      const cg = ctx.createRadialGradient(cx,cy,0,cx,cy,R*0.55)
      cg.addColorStop(0,`rgba(${gc.r},${gc.g},${gc.b},${0.05+s.speakV*0.08})`)
      cg.addColorStop(1,'rgba(0,0,0,0)')
      ctx.beginPath(); ctx.arc(cx,cy,R*0.55,0,Math.PI*2)
      ctx.fillStyle = cg; ctx.fill()

      ctx.restore()
    }

    animId = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animId); ro.disconnect() }
  }, [])

  return <canvas ref={canvasRef} style={{ width:'100%', height:'100%', display:'block' }} />
}
