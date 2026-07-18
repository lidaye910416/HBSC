// frontend-vite/src/components/hero/usePointerGravity.ts
//
// usePointerGravity — tracks pointer position over a target element and
// exposes:
//   - ndcRef: current NDC (Vector2, -1..1)
//   - worldRef: current world position (Vector3) on the z=0 plane
//   - velocityRef: smoothed velocity (Vector2, screen units / frame)
//
// Coarse pointers (touch) → no-op (returns null refs).
// StrictMode-safe: cleanup cancels RAF + removes listeners + resets refs.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export interface PointerGravityRefs {
  ndcRef: React.MutableRefObject<THREE.Vector2>
  worldRef: React.MutableRefObject<THREE.Vector3>
  velocityRef: React.MutableRefObject<THREE.Vector2>
}

export interface PointerGravityOpts {
  target: React.RefObject<HTMLElement | null>
  camera: THREE.Camera | null
  strength?: number // 0..1, smoothing speed (default 0.12)
}

export function usePointerGravity(opts: PointerGravityOpts): PointerGravityRefs {
  const { target, camera, strength = 0.12 } = opts
  const ndcRef = useRef(new THREE.Vector2(0, 0))
  const worldRef = useRef(new THREE.Vector3(0, 0, 0))
  const velocityRef = useRef(new THREE.Vector2(0, 0))

  useEffect(() => {
    const el = target.current
    if (!el) return
    if (typeof window === 'undefined') return
    // Coarse pointer → no listeners
    if (!window.matchMedia?.('(pointer: fine)').matches) return

    const mousePx = { x: 0, y: 0, inside: false }
    const lastNdc = new THREE.Vector2(0, 0)

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      mousePx.x = e.clientX - r.left
      mousePx.y = e.clientY - r.top
      mousePx.inside = true
    }
    const onLeave = () => {
      mousePx.inside = false
    }

    let raf = 0
    let running = true
    const tmp = new THREE.Vector3()

    const tick = () => {
      if (!running) return
      const r = el.getBoundingClientRect()
      const targetX = mousePx.inside
        ? (mousePx.x / r.width) * 2 - 1
        : 0
      const targetY = mousePx.inside
        ? -((mousePx.y / r.height) * 2 - 1)
        : 0
      ndcRef.current.x += (targetX - ndcRef.current.x) * strength
      ndcRef.current.y += (targetY - ndcRef.current.y) * strength
      velocityRef.current.x = ndcRef.current.x - lastNdc.x
      velocityRef.current.y = ndcRef.current.y - lastNdc.y
      lastNdc.copy(ndcRef.current)

      if (camera) {
        tmp.set(ndcRef.current.x, ndcRef.current.y, 0.5).unproject(camera)
        const dir = tmp.sub(camera.position).normalize()
        if (Math.abs(dir.z) > 0.001) {
          const distance = -camera.position.z / dir.z
          const world = camera.position
            .clone()
            .add(dir.multiplyScalar(distance))
          worldRef.current.lerp(world, strength)
        }
      }
      raf = requestAnimationFrame(tick)
    }

    const onVisibility = () => {
      running = !document.hidden
      if (running) raf = requestAnimationFrame(tick)
    }

    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    raf = requestAnimationFrame(tick)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      ndcRef.current.set(0, 0)
      worldRef.current.set(0, 0, 0)
      velocityRef.current.set(0, 0)
    }
  }, [target, camera, strength])

  return { ndcRef, worldRef, velocityRef }
}