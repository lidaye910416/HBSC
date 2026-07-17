import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Flip } from 'gsap/Flip'
import { SplitText } from 'gsap/SplitText'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { InertiaPlugin } from 'gsap/InertiaPlugin'

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
 * Production behaviour: no markers, null-target warnings off, normalized
 * scroll so iOS momentum + nested scroll containers behave predictably.
 */
let installed = false

export function installAnimationRuntime(): void {
  if (installed || typeof window === 'undefined') return
  gsap.registerPlugin(ScrollTrigger, Flip, SplitText, DrawSVGPlugin, InertiaPlugin)
  gsap.config({ nullTargetWarn: false })
  ScrollTrigger.defaults({ markers: false })
  ScrollTrigger.normalizeScroll(true)
  installed = true
}

/** For tests / hot reload — re-arm the install sentinel. Not for production use. */
export function __resetAnimationRuntimeForTests(): void {
  installed = false
}