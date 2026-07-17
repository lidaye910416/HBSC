import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from './reducedMotion'

/**
 * Generic ScrollTrigger.batch reveal factory.
 *
 * Collects every descendant of `opts.root` matching `opts.selector`, then
 * fades + lifts them in with a small stagger when their batch crosses the
 * viewport threshold. Reduced-motion users get a no-op (the components stay
 * in their final visible state by default since they aren't pre-hidden).
 */
export interface BatchRevealOptions {
  root: HTMLElement | Document
  selector: string
  start?: string
  stagger?: number
  duration?: number
  y?: number
  once?: boolean
}

export function batchReveal(opts: BatchRevealOptions): () => void {
  if (!motionAllowed()) return () => {}
  const els = Array.from(opts.root.querySelectorAll<HTMLElement>(opts.selector))
  if (!els.length) return () => {}
  const st = ScrollTrigger.batch(els, {
    start: opts.start ?? 'top 88%',
    once: opts.once ?? true,
    onEnter: batch =>
      gsap.fromTo(
        batch as unknown as HTMLElement[],
        { y: opts.y ?? 28, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, stagger: opts.stagger ?? 0.07, duration: opts.duration ?? 0.6, overwrite: 'auto', clearProps: 'transform,opacity' },
      ),
  })
  return () => {
    st.forEach(t => t.kill())
  }
}
