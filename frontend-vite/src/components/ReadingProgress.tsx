import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from '@/animations/reducedMotion'

/**
 * Top-of-viewport reading progress bar (P0-04).
 *
 * Tracks scroll progress through `targetSelector` (default `main`) and
 * writes it into `transform: scaleX(...)` with `transform-origin: 0 50%`
 * so the bar grows left → right. `scrub: 0.3` keeps the tween smooth
 * without lagging too far behind the scroll position.
 *
 * - Respects `motionAllowed()` (reduced-motion + Save-Data). When motion
 *   is not allowed the component renders the bar but skips the tween:
 *   we still expose the element so e2e tests and screen-reader users can
 *   find a stable progressbar landmark, but the bar stays at scaleX(0)
 *   and never animates.
 * - `pointer-events: none` so the bar never blocks clicks on the page
 *   underneath.
 * - `aria-valuenow` is updated each frame so assistive tech can read the
 *   current reading position on demand.
 */
export function ReadingProgress({ targetSelector = 'main' }: { targetSelector?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!motionAllowed()) return
    const bar = ref.current
    if (!bar) return
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return

    const trigger = ScrollTrigger.create({
      trigger: target,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.3,
      onUpdate: self => {
        const p = Math.max(0, Math.min(1, self.progress))
        gsap.set(bar, { scaleX: p, transformOrigin: '0 50%' })
        bar.setAttribute('aria-valuenow', String(Math.round(p * 100)))
      },
    })

    return () => {
      trigger.kill()
      gsap.set(bar, { scaleX: 0 })
      bar.setAttribute('aria-valuenow', '0')
    }
  }, [targetSelector])

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-label="阅读进度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      data-testid="reading-progress"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: 'var(--accent, #C9A84C)',
        transform: 'scaleX(0)',
        transformOrigin: '0 50%',
        zIndex: 100,
        pointerEvents: 'none',
      }}
    />
  )
}