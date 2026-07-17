import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from '../animations/reducedMotion'

interface Params {
  density: number       // 0..1 — particle count multiplier
  accent: number        // 0..1 — driven by scroll for depth gradient
  reduceMotion: boolean // always false when this component is mounted (gated outside)
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  alpha: number
}

/**
 * Hero Canvas particle field.
 *
 * - DPR capped to 2 to keep memory reasonable on retina.
 * - Single RAF renderer; pauses when the tab is hidden.
 * - GSAP only drives a *proxy* object that the render loop reads each frame
 *   — no setState on animation frames.
 * - Lifecycle: motionAllowed() gate, resize listener removed, RAF cancelled,
 *   and any tween/triggers cleaned up on unmount.
 */
export function HeroParticles() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!motionAllowed()) return
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let running = true
    const params: Params = { density: 0.35, accent: 0, reduceMotion: false }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = () => canvas.clientWidth
    const h = () => canvas.clientHeight

    const resize = () => {
      canvas.width = w() * dpr
      canvas.height = h() * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      rebuild()
    }

    const particles: Particle[] = []
    const rebuild = () => {
      particles.length = 0
      const target = Math.round(60 * params.density)
      const ww = w()
      const hh = h()
      for (let i = 0; i < target; i++) {
        particles.push({
          x: Math.random() * ww,
          y: Math.random() * hh,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15,
          r: Math.random() * 1.2 + 0.4,
          alpha: Math.random() * 0.5 + 0.3,
        })
      }
    }

    const draw = () => {
      if (!running) {
        raf = requestAnimationFrame(draw)
        return
      }
      const ww = w()
      const hh = h()
      ctx.clearRect(0, 0, ww, hh)

      // Base layer (cool ink)
      ctx.fillStyle = `rgba(201, 168, 76, ${0.05 + params.accent * 0.18})`
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > ww) p.vx *= -1
        if (p.y < 0 || p.y > hh) p.vy *= -1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Subtle accent dots that fade with accent
      if (params.accent > 0) {
        ctx.fillStyle = `rgba(201, 168, 76, ${params.accent * 0.4})`
        for (let i = 0; i < 6; i++) {
          const x = (Math.sin(i + Date.now() / 4000) + 1) * ww / 2
          const y = (Math.cos(i + Date.now() / 5000) + 1) * hh / 2
          ctx.beginPath()
          ctx.arc(x, y, 1.6, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      raf = requestAnimationFrame(draw)
    }

    const onVisibility = () => { running = !document.hidden }
    const onResize = () => resize()

    resize()
    draw()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('resize', onResize)

    const accent = gsap.to(params, {
      accent: 1,
      scrollTrigger: { trigger: canvas, start: 'top top', end: 'bottom top', scrub: 0.8 },
    })

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
      accent.scrollTrigger?.kill()
      accent.kill()
      ScrollTrigger.getAll().filter(t => t.trigger === canvas).forEach(t => t.kill())
      particles.length = 0
    }
  }, [])

  if (!motionAllowed()) return null

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="hero-particles"
      data-testid="hero-particles"
    />
  )
}
