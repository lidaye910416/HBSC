import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from './reducedMotion'

export interface SplitHeadingOptions {
  /**
   * Granularity at which to split the heading text.
   * - 'chars' splits into single characters (Latin); CJK characters stay as whole units
   * - 'words' splits by whitespace
   */
  mode?: 'chars' | 'words'
  stagger?: number
  duration?: number
  /**
   * When true, the reveal is tied to the element scrolling into view (top 90%).
   * Otherwise it plays immediately on mount.
   */
  onScroll?: boolean
}

/**
 * Split a heading into spans and reveal them with a stagger tween.
 *
 * The original text content is preserved in `data-split-text` and restored on cleanup,
 * so SSR / no-JS users see the original heading.
 *
 * CJK text is treated as a single unit at any granularity because individual
 * hanzi characters make noise inside `stagger.from(chars, ...)` and also obscure
 * word boundaries.
 */
export function splitHeading(el: HTMLElement, opts: SplitHeadingOptions = {}): () => void {
  if (!motionAllowed()) return () => {}
  if (!el || !el.textContent) return () => {}

  // Idempotency: if already split, revert first.
  if (el.dataset.splitText) {
    el.textContent = el.dataset.splitText
    delete el.dataset.splitText
  }

  const original = el.textContent
  const mode = opts.mode ?? 'words'
  const cjk = /[㐀-鿿]/

  let units: string[]
  if (mode === 'chars' && !cjk.test(original)) {
    units = Array.from(original)
  } else if (mode === 'words') {
    units = original.split(/(\s+)/).filter(Boolean)
  } else {
    // CJK: keep as one unit.
    units = [original]
  }

  if (units.length <= 1) return () => {}

  el.dataset.splitText = original
  el.textContent = ''
  const spans: HTMLElement[] = []
  for (const u of units) {
    const span = document.createElement('span')
    span.style.display = 'inline-block'
    span.style.willChange = 'transform,opacity'
    span.textContent = u === ' ' ? ' ' : u
    el.appendChild(span)
    if (u.trim()) spans.push(span)
  }

  const vars = {
    yPercent: 105,
    autoAlpha: 0,
    stagger: opts.stagger ?? 0.025,
    duration: opts.duration ?? 0.55,
    ease: 'power3.out',
  }

  const tween = gsap.from(spans, vars)
  let scrollTrigger: ScrollTrigger | undefined
  if (opts.onScroll) {
    scrollTrigger = ScrollTrigger.create({
      trigger: el,
      start: 'top 90%',
      once: true,
      animation: tween,
    })
  }

  return () => {
    scrollTrigger?.kill()
    tween.kill()
    if (el.dataset.splitText) {
      el.textContent = el.dataset.splitText
      delete el.dataset.splitText
    }
  }
}

/**
 * Apply splitHeading to every `[data-split-heading]` inside `root`.
 * Intended to be called from a useEffect scoped to a page or section.
 */
export function splitHeadingsIn(root: HTMLElement | Document, defaults?: SplitHeadingOptions): () => void {
  if (!motionAllowed()) return () => {}
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-split-heading]'))
  const cleanups = elements.map(el => splitHeading(el, defaults))
  return () => cleanups.forEach(c => c())
}
