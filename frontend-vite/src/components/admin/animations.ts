/**
 * Shared GSAP animation hooks and helpers for the admin area.
 *
 * - Honor `prefers-reduced-motion` automatically: useReducedMotion() returns
 *   true when the user prefers reduced motion, and all the gsap.matchMedia
 *   contexts below short-circuit to a no-op when that's the case.
 * - All animations register inside gsap.context() (or useGSAP) so they get
 *   reverted on unmount and don't leak.
 */

import { useEffect, useState } from 'react'
import gsap from 'gsap'

/** Reactive hook that returns true when the user prefers reduced motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/**
 * Page-enter animation for the admin content area.
 * Apply by adding the returned class to .admin-content and the data-attribute
 * selector target. The animation runs once on mount and respects reduced
 * motion via matchMedia.
 */
export function pageEnterAnimation(root: HTMLElement | null) {
  if (!root) return () => {}

  const ctx = gsap.context(() => {
    const mm = gsap.matchMedia()

    mm.add(
      {
        isMotion: '(prefers-reduced-motion: no-preference)',
        isReduced: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        const conditions = context.conditions as { isMotion: boolean; isReduced: boolean }
        if (conditions.isReduced) return

        gsap.from(root, {
          opacity: 0,
          y: 12,
          duration: 0.35,
          ease: 'power2.out',
          clearProps: 'opacity,y',
        })
      },
    )

    return () => mm.revert()
  }, root)

  return () => ctx.revert()
}

/**
 * Sidebar entrance stagger + active-link border slide.
 *
 * - Staggers nav items in on first mount with a subtle fade + slide.
 * - Animates the active link's left border via a pseudo-element transformed
 *   via xPercent so it slides smoothly when the active route changes.
 *
 * The whole thing is wrapped in gsap.context() with the sidebar root as scope
 * so all selectors stay inside the sidebar, and the matchMedia block respects
 * prefers-reduced-motion.
 */
export function sidebarAnimations(sidebar: HTMLElement | null) {
  if (!sidebar) return () => {}

  const ctx = gsap.context(() => {
    const mm = gsap.matchMedia()
    const navLinks = sidebar.querySelectorAll<HTMLElement>('.admin-sidebar nav a')

    mm.add(
      {
        isMotion: '(prefers-reduced-motion: no-preference)',
        isReduced: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        const conditions = context.conditions as { isMotion: boolean; isReduced: boolean }
        if (conditions.isReduced) return

        // Entrance stagger — runs once on mount
        gsap.from(navLinks, {
          opacity: 0,
          x: -8,
          duration: 0.25,
          stagger: 0.04,
          ease: 'power2.out',
          clearProps: 'opacity,x',
        })

        // Active border shimmer — animate the left-border color via border-color.
        // CSS already does the transition; GSAP adds an entrance pop the first
        // time the link becomes active. (We don't animate every active change
        // because React already swaps the .active class and the CSS transition
        // is gentle enough on its own.)
        const firstActive = sidebar.querySelector<HTMLElement>('.admin-sidebar a.active')
        if (firstActive) {
          gsap.from(firstActive, {
            borderLeftColor: 'transparent',
            duration: 0.3,
            ease: 'power2.out',
          })
        }
      },
    )

    return () => mm.revert()
  }, sidebar)

  return () => ctx.revert()
}

/**
 * Subtle hover scale for action buttons (edit/delete/etc). Uses
 * gsap.quickTo so the listener doesn't create a new tween on every
 * pointer event.
 */
export function attachHoverScale(button: HTMLElement | null, scale = 1.04) {
  if (!button) return () => {}
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) return () => {}

  const tween = gsap.quickTo(button, 'scale', { duration: 0.15, ease: 'power2.out' })

  const enter = () => tween(scale)
  const leave = () => tween(1)

  button.addEventListener('pointerenter', enter)
  button.addEventListener('pointerleave', leave)
  button.addEventListener('focus', enter)
  button.addEventListener('blur', leave)

  return () => {
    button.removeEventListener('pointerenter', enter)
    button.removeEventListener('pointerleave', leave)
    button.removeEventListener('focus', enter)
    button.removeEventListener('blur', leave)
    tween(1)
  }
}

/**
 * Staggered fade-in for table rows on mount. The container must hold direct
 * children that should animate; typically `<tbody>` rows.
 *
 * Skips the animation entirely when prefers-reduced-motion is set.
 */
export function listRowStagger(
  container: HTMLElement | null,
  selector: string = 'tbody tr',
) {
  if (!container) return () => {}

  const ctx = gsap.context(() => {
    const mm = gsap.matchMedia()
    mm.add(
      {
        isMotion: '(prefers-reduced-motion: no-preference)',
        isReduced: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        const conditions = context.conditions as { isMotion: boolean; isReduced: boolean }
        if (conditions.isReduced) return

        const rows = container.querySelectorAll<HTMLElement>(selector)
        if (rows.length === 0) return

        gsap.from(rows, {
          opacity: 0,
          y: 6,
          duration: 0.22,
          stagger: 0.025,
          ease: 'power2.out',
          clearProps: 'opacity,y',
        })
      },
    )
    return () => mm.revert()
  }, container)

  return () => ctx.revert()
}

/**
 * Modal entrance animation: backdrop fades in, dialog scales from 0.95 with
 * fade. Returns a cleanup that reverses the context if the modal unmounts
 * mid-animation.
 */
export function modalEnter(backdrop: HTMLElement | null) {
  if (!backdrop) return () => {}

  const ctx = gsap.context(() => {
    const mm = gsap.matchMedia()
    mm.add(
      {
        isMotion: '(prefers-reduced-motion: no-preference)',
        isReduced: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        const conditions = context.conditions as { isMotion: boolean; isReduced: boolean }
        const panel = backdrop.querySelector<HTMLElement>('[data-modal-panel]')
        if (conditions.isReduced) {
          gsap.set([backdrop, panel].filter(Boolean), { clearProps: 'all' })
          return
        }

        const tl = gsap.timeline()
        tl.fromTo(
          backdrop,
          { opacity: 0 },
          { opacity: 1, duration: 0.18, ease: 'power1.out' },
        )
        if (panel) {
          tl.fromTo(
            panel,
            { opacity: 0, scale: 0.95, y: 8 },
            { opacity: 1, scale: 1, y: 0, duration: 0.28, ease: 'power3.out' },
            '<+0.05',
          )
        }
        return () => tl.kill()
      },
    )
    return () => mm.revert()
  }, backdrop)

  return () => ctx.revert()
}

/**
 * Modal exit animation: reverse the entrance, then call onComplete to unmount.
 * Returns a promise so callers can await before removing the element.
 */
export function modalExit(backdrop: HTMLElement | null): Promise<void> {
  return new Promise((resolve) => {
    if (!backdrop) return resolve()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return resolve()

    const panel = backdrop.querySelector<HTMLElement>('[data-modal-panel]')
    const tl = gsap.timeline({ onComplete: () => resolve() })
    if (panel) {
      tl.to(panel, { opacity: 0, scale: 0.96, duration: 0.15, ease: 'power2.in' })
    }
    tl.to(backdrop, { opacity: 0, duration: 0.15, ease: 'power1.in' }, '<')
  })
}