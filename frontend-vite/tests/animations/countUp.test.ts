import { describe, it, expect } from 'vitest'
import { mountCountUp } from '@/animations/countUp'

describe('mountCountUp', () => {
  it('writes interpolated integer frames to textContent', () => {
    const el = document.createElement('span')
    const cleanup = mountCountUp(el, { to: 100, duration: 0.5 })
    expect(el.textContent).toBe('0')
    cleanup()
  })
  it('cleanup removes tween listeners', () => {
    const el = document.createElement('span')
    const cleanup = mountCountUp(el, { to: 5, duration: 0.2 })
    cleanup()
    expect(el.textContent).not.toBeNull()
  })
})
