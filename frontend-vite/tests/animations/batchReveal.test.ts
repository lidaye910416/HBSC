import { describe, it, expect, vi, beforeEach } from 'vitest'
import { batchReveal } from '@/animations/batchReveal'

/**
 * batchReveal — defensive contract:
 *   1. When motion is disabled, the call is a no-op (returns a function and
 *      does not throw, even if the selector matches nothing).
 *   2. Calling cleanup repeatedly is safe.
 *
 * We don't simulate the GSAP path here — that's covered by the e2e
 * `articles-flip` spec. This unit test pins the public contract.
 */
describe('batchReveal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a callable noop when prefers-reduced-motion is set', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    })
    ;(navigator as any).connection = undefined

    const cleanup = batchReveal({ root: document, selector: '.missing-selector' })
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
    expect(() => cleanup()).not.toThrow()
  })

  it('returns a callable noop when Save-Data is enabled', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
    ;(navigator as any).connection = { saveData: true }

    const cleanup = batchReveal({ root: document, selector: '.also-missing' })
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })

  it('does not throw when selector matches nothing under normal motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
    ;(navigator as any).connection = undefined

    const cleanup = batchReveal({ root: document, selector: '.still-missing' })
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })
})