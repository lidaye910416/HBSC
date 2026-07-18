// frontend-vite/tests/e2e/hero-immersive.spec.ts
//
// Integration tests for the WebGL hero layer.

import { test, expect } from '@playwright/test'

async function waitForStableHeight(page: import('@playwright/test').Page) {
  let last = -1
  for (let i = 0; i < 4; i++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    if (h === last) return h
    last = h
    await page.waitForTimeout(150)
  }
  return last
}

test.describe('hero-immersive', () => {
  test('WebGL path: canvas is rendered with non-zero dimensions', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)
    const canvas = page.locator('[data-testid="hero-immersive-canvas"]')
    await expect(canvas).toBeAttached()
    const box = await canvas.boundingBox()
    expect(box, 'canvas bounding box').not.toBeNull()
    expect(box!.width).toBeGreaterThan(100)
    expect(box!.height).toBeGreaterThan(100)
  })

  test('reduced-motion path: no WebGL canvas, content still readable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)
    // HeroImmersive returns <HeroFallback /> but HeroFallback renders HeroShader +
    // HeroParticles which both early-return null under reduced-motion. Net result:
    // no canvas at all — but the static hero (text + gradient) is fully readable.
    await expect(page.locator('[data-testid="hero-immersive-canvas"]')).toHaveCount(0)
    await expect(page.locator('h1#hero-title')).toBeVisible()
    await expect(page.locator('section#hero')).toBeVisible()
  })

  test('mouse movement does not crash the WebGL context', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)

    const canvas = page.locator('[data-testid="hero-immersive-canvas"]')
    await expect(canvas).toBeAttached()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()

    // Move mouse across the hero
    await page.mouse.move(box!.x + 50, box!.y + 50)
    await page.waitForTimeout(100)
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.waitForTimeout(100)
    await page.mouse.move(box!.x + box!.width - 50, box!.y + box!.height - 50)
    await page.waitForTimeout(200)

    // Filter out unrelated errors
    const relevant = errors.filter((e) => /webgl|shader|three/i.test(e))
    expect(relevant, 'no WebGL/shader errors during mouse move').toEqual([])
  })

  test('StrictMode-safe navigation: leaving and returning does not leak canvases', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)
    const initialCount = await page.locator('canvas').count()

    // Navigate away and back
    await page.goto('/about', { waitUntil: 'networkidle' })
    await page.waitForTimeout(200)
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)

    const finalCount = await page.locator('canvas').count()
    // After one navigation cycle, canvas count should equal initial ± 1
    expect(Math.abs(finalCount - initialCount)).toBeLessThanOrEqual(1)
  })
})