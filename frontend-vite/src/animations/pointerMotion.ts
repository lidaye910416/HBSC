import { gsap } from 'gsap'

export interface PointerMotionOpts {
  /** The element that gets transformed (rotateX/rotateY). */
  target: HTMLElement
  /** Maximum tilt angle in degrees. Default 5. */
  maxTilt?: number
  /** Optional duration override; default 0.35. */
  duration?: number
}

/**
 * Attach a pointer-driven 3D tilt to a target element.
 * Only attaches when (pointer: fine) — touch devices and coarse pointers
 * never receive a listener.
 */
export function attachPointerMotion(opts: PointerMotionOpts): () => void {
  if (typeof window === 'undefined') return () => {}
  if (!window.matchMedia?.('(pointer: fine)').matches) return () => {}

  const { target, maxTilt = 5, duration = 0.35 } = opts
  const tilt = Math.max(0, Math.min(15, maxTilt))

  const rx = gsap.quickTo(target, 'rotateX', { duration, ease: 'power3.out' })
  const ry = gsap.quickTo(target, 'rotateY', { duration, ease: 'power3.out' })

  const onMove = (e: PointerEvent) => {
    const rect = target.getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
    rx(-ny * tilt)
    ry(nx * tilt)
  }
  const onLeave = () => {
    rx(0)
    ry(0)
  }

  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerleave', onLeave)

  return () => {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerleave', onLeave)
    rx(0)
    ry(0)
  }
}
