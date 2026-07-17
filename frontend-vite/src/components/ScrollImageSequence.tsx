import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from '../animations/reducedMotion'

/**
 * ScrollImageSequence
 *
 * Plays a sequence of bitmap frames (or video frames) in step with scroll
 * progress. Designed for "research process" hero strips where the user
 * drags through a hand-composed film strip.
 *
 * Asset pipeline (asset / perf gated):
 *  - `frames`: array of static URLs (PNG/JPEG/WebP). The component renders
 *    the first frame as a poster, then progressively preloads only frames
 *    that fall inside the next-and-prev viewport.
 *  - If frames is empty (default), the component falls back to a poster
 *    image and renders nothing on the canvas. This is by design: callers
 *    must register the asset directory before the component is useful.
 *
 * Performance:
 *  - Single Canvas, integer-frame proxy target (snap: 'frame')
 *  - RAF redraws only when the proxy frame changes
 *  - prefers-reduced-motion / Save-Data → shows poster only
 *  - Pause RAF on visibilitychange
 *  - Uses ScrollTrigger to drive the proxy, never setState
 */

export interface ScrollImageSequenceProps {
  /** Ordered list of frame URLs. Empty array shows only the poster. */
  frames: string[]
  /** Optional poster image shown until the first frame is ready. */
  poster?: string
  /** Optional alt text for accessibility (poster frame). */
  alt?: string
  /** Optional element to pin during the scroll (defaults to itself). */
  pinTarget?: HTMLElement | null
  /** Scroll length in pixels ("+=1500" style). Default "+=3000". */
  scrollDistance?: string
}

interface State {
  frames: HTMLImageElement[]
  proxy: { frame: number }
  loaded: boolean
}

export function ScrollImageSequence({
  frames,
  poster,
  alt = '',
  scrollDistance = '+=3000',
}: ScrollImageSequenceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastFrameRef = useRef<number>(-1)
  const [posterReady, setPosterReady] = useState(!!poster)
  const stateRef = useRef<State>({ frames: [], proxy: { frame: 0 }, loaded: false })

  // 1. Progressive load: poster first, then frames in viewport order.
  useEffect(() => {
    if (!frames.length) return
    let cancelled = false
    const total = frames.length
    stateRef.current.frames = new Array(total)

    const loadAt = (i: number) =>
      new Promise<void>((resolve) => {
        if (cancelled || stateRef.current.frames[i]) return resolve()
        const img = new Image()
        img.decoding = 'async'
        img.src = frames[i]
        img.decode?.().catch(() => undefined)
        img.onload = img.onerror = () => {
          if (cancelled) return
          stateRef.current.frames[i] = img
          if (!stateRef.current.loaded && stateRef.current.frames.filter(Boolean).length === total) {
            stateRef.current.loaded = true
          }
          resolve()
        }
      })

    ;(async () => {
      // Eagerly load first frame so the user sees something immediately.
      await loadAt(0)
      if (cancelled) return
      if (!motionAllowed()) return
      // Background load of the rest in chunks to avoid hammering the network.
      const chunkSize = 4
      for (let start = 1; start < total; start += chunkSize) {
        const slice = frames.slice(start, start + chunkSize).map((_, idx) => start + idx)
        await Promise.all(slice.map(loadAt))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [frames])

  // 2. Drive the proxy with ScrollTrigger; redraw only on frame change.
  useEffect(() => {
    if (!motionAllowed() || frames.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let running = true

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = () => {
      if (!running) {
        raf = requestAnimationFrame(draw)
        return
      }
      const state = stateRef.current
      const idx = Math.round(state.proxy.frame)
      if (idx !== lastFrameRef.current) {
        lastFrameRef.current = idx
        const img = state.frames[idx]
        if (img) {
          ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
          // cover fit
          const cw = canvas.clientWidth
          const ch = canvas.clientHeight
          const ar = img.width / img.height
          const car = cw / ch
          let dw = cw
          let dh = ch
          if (ar > car) {
            dh = ch
            dw = ch * ar
          } else {
            dw = cw
            dh = cw / ar
          }
          ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh)
        }
      }
      raf = requestAnimationFrame(draw)
    }

    const onVis = () => { running = !document.hidden }
    resize()
    draw()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', resize)

    const tween = gsap.to(stateRef.current.proxy, {
      frame: frames.length - 1,
      snap: 'frame',
      ease: 'none',
      scrollTrigger: {
        trigger: canvas,
        start: 'top top',
        end: scrollDistance,
        scrub: 0.5,
        pin: true,
        anticipatePin: 1,
      },
    })

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', resize)
      tween.scrollTrigger?.kill()
      tween.kill()
      ScrollTrigger.getAll().filter(t => t.trigger === canvas).forEach(t => t.kill())
    }
  }, [frames, scrollDistance])

  // Poster readiness (so we can pick the alt between poster and frame-0)
  useEffect(() => {
    if (!poster) return
    const img = new Image()
    img.onload = () => setPosterReady(true)
    img.src = poster
  }, [poster])

  if (!motionAllowed()) {
    return poster ? <img src={poster} alt={alt} className="scroll-sequence-poster" /> : null
  }
  if (!frames.length) {
    return poster ? <img src={poster} alt={alt} className="scroll-sequence-poster" /> : null
  }

  return (
    <div className="scroll-sequence" data-testid="scroll-image-sequence">
      {!posterReady && frames[0] && (
        <img src={frames[0]} alt={alt} className="scroll-sequence-poster" />
      )}
      <canvas ref={canvasRef} aria-hidden={!!poster || !!alt} role={alt ? 'img' : undefined} />
      {poster && posterReady && <img src={poster} alt={alt} className="sr-only" />}
    </div>
  )
}
