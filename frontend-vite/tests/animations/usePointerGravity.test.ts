// frontend-vite/tests/animations/usePointerGravity.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createRef } from 'react'
import * as THREE from 'three'
import { usePointerGravity } from '../../src/components/hero/usePointerGravity'

// Mock matchMedia for jsdom (not all versions ship it)
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('fine'), // pretend fine pointer
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })

  // Mock requestAnimationFrame to control timing — non-recursive
  // (the hook calls rAF inside its tick, so we must NOT let cb-execution
  // chain into the next rAF synchronously, otherwise infinite loop.)
  let rafId = 0
  const rafCallbacks = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafId++
    rafCallbacks.set(rafId, cb)
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id)
  })
  // Expose helper to flush ONE round of pending RAFs.
  // Each cb may enqueue another, but those land in the next round.
  ;(globalThis as unknown as { __flushRAF: () => void }).__flushRAF = () => {
    const pending = Array.from(rafCallbacks.entries())
    rafCallbacks.clear()
    for (const [, cb] of pending) {
      cb(performance.now())
    }
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePointerGravity', () => {
  it('starts with ndc at (0, 0)', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    Object.defineProperty(div, 'getBoundingClientRect', {
      value: () => ({
        left: 0, top: 0, width: 1000, height: 800,
        right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
      }),
    })
    const target = createRef<HTMLDivElement>()
    target.current = div
    const camera = new THREE.PerspectiveCamera(45, 1000 / 800, 0.1, 100)
    camera.position.set(0, 0, 6)

    const { result } = renderHook(() =>
      usePointerGravity({ target, camera, strength: 1 }),
    )

    expect(result.current.ndcRef.current.x).toBe(0)
    expect(result.current.ndcRef.current.y).toBe(0)
  })

  it('pointerleave causes ndc to converge back to (0, 0)', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    Object.defineProperty(div, 'getBoundingClientRect', {
      value: () => ({
        left: 0, top: 0, width: 1000, height: 800,
        right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
      }),
    })
    const target = createRef<HTMLDivElement>()
    target.current = div
    const camera = new THREE.PerspectiveCamera(45, 1000 / 800, 0.1, 100)
    camera.position.set(0, 0, 6)

    const { result } = renderHook(() =>
      usePointerGravity({ target, camera, strength: 0.5 }),
    )

    // Simulate pointermove to top-right
    act(() => {
      div.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 1000,
          clientY: 0,
          bubbles: true,
        }),
      )
    })
    // Run several RAF ticks to let ndc converge
    act(() => {
      for (let i = 0; i < 5; i++) {
        ;(globalThis as unknown as { __flushRAF: () => void }).__flushRAF()
      }
    })
    expect(result.current.ndcRef.current.x).toBeGreaterThan(0.1)

    // Simulate pointerleave
    act(() => {
      div.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
    })
    // Run many RAF ticks — should converge
    act(() => {
      for (let i = 0; i < 60; i++) {
        ;(globalThis as unknown as { __flushRAF: () => void }).__flushRAF()
      }
    })
    expect(Math.abs(result.current.ndcRef.current.x)).toBeLessThan(0.05)
    expect(Math.abs(result.current.ndcRef.current.y)).toBeLessThan(0.05)
  })
})