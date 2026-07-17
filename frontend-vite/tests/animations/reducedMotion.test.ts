import { describe, it, expect, vi, beforeEach } from 'vitest'
import { motionAllowed } from '@/animations/reducedMotion'

describe('motionAllowed', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined })
    ;(navigator as any).connection = undefined
  })

  it('returns true by default', () => {
    expect(motionAllowed()).toBe(true)
  })

  it('returns false when prefers-reduced-motion: reduce', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any
    expect(motionAllowed()).toBe(false)
  })

  it('returns false when Save-Data is on', () => {
    ;(navigator as any).connection = { saveData: true }
    expect(motionAllowed()).toBe(false)
  })
})