import { gsap } from 'gsap'
import { motionAllowed } from './reducedMotion'

/**
 * Count-up tween for a single numeric label.
 *
 * Writes a snap-rounded integer or fixed-decimal string straight into the
 * element's `textContent` so it survives without any additional DOM wrappers.
 *
 * Reduced-motion behaviour: writes the final value once and returns a no-op
 * cleanup so consumers stay symmetric (always call the cleanup on unmount).
 */
export interface CountUpOptions {
  to: number
  from?: number
  duration?: number
  delay?: number
  decimals?: number
  scrollTrigger?: ScrollTrigger.Vars
}

export function mountCountUp(el: HTMLElement, opts: CountUpOptions): () => void {
  const proxy = { v: opts.from ?? 0 }
  const decimals = opts.decimals ?? 0
  const fmt = (v: number) => v.toFixed(decimals)
  if (!motionAllowed()) {
    el.textContent = fmt(opts.to)
    return () => {}
  }
  el.textContent = fmt(proxy.v)
  const tween = gsap.to(proxy, {
    v: opts.to,
    duration: opts.duration ?? 1,
    delay: opts.delay ?? 0,
    ease: 'power2.out',
    snap: { v: decimals === 0 ? 1 : 0.01 },
    scrollTrigger: opts.scrollTrigger,
    onUpdate: () => { el.textContent = fmt(proxy.v) },
  })
  return () => {
    tween.kill()
    if (opts.scrollTrigger) {
      // Best-effort: kill any scroll trigger this tween attached.
      ScrollTrigger.getAll().forEach(t => t.kill())
    }
  }
}
