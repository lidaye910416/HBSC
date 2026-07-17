import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Flip } from 'gsap/Flip'
import { SplitText } from 'gsap/SplitText'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { InertiaPlugin } from 'gsap/InertiaPlugin'
import { Draggable } from 'gsap/Draggable'

/**
 * Animation runtime — the single entry point that registers every GSAP
 * plugin the public site depends on.
 *
 * Idempotent: calling more than once is a no-op (React 19 StrictMode will
 * invoke module-level code twice in dev; HMR re-evaluates this module).
 *
 * Server-safe: returns early when `window` is undefined so SSR/import-time
 * evaluation never throws.
 *
 * Production behaviour: no markers, null-target warnings off.
 *
 * NOTE — DO NOT enable `ScrollTrigger.normalizeScroll(true)` here without
 * also using ScrollSmoother. The normalizer captures wheel/touch events with
 * `preventDefault: true` and tries to manage scroll through a wrapper that's
 * only calibrated when ScrollSmoother is the active scroller. Without
 * ScrollSmoother, the wrapper caps wheel-driven and programmatic
 * `window.scrollTo` at the wrong value (smaller than the document's true
 * max), and the page appears "stuck" — wheels do move the page a bit, but
 * they bottom out well above the document end and JS-set scroll positions
 * resolve to a fraction of what was asked. We rely on native scroll.
 */
let installed = false

export function installAnimationRuntime(): void {
  if (installed || typeof window === 'undefined') return
  gsap.registerPlugin(ScrollTrigger, Flip, SplitText, DrawSVGPlugin, InertiaPlugin, Draggable)
  gsap.config({ nullTargetWarn: false })
  ScrollTrigger.defaults({ markers: false })
  installed = true
}

/** For tests / hot reload — re-arm the install sentinel. Not for production use. */
export function __resetAnimationRuntimeForTests(): void {
  installed = false
}