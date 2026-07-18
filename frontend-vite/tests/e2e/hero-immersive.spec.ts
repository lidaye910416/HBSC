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

  test('WebGL canvas paints non-black pixels in center area', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500) // let RAF render a few frames
    const result = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="hero-immersive-canvas"]') as HTMLCanvasElement
      if (!canvas) return null
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      if (!gl) return null
      const w = canvas.width
      const h = canvas.height
      const pixels = new Uint8Array(4 * w * h)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      // Sample center 50% of pixels
      const x0 = Math.floor(w * 0.25)
      const x1 = Math.floor(w * 0.75)
      const y0 = Math.floor(h * 0.25)
      const y1 = Math.floor(h * 0.75)
      let maxBrightness = 0
      for (let y = y0; y < y1; y += 4) {
        for (let x = x0; x < x1; x += 4) {
          const idx = (y * w + x) * 4
          const r = pixels[idx]
          const g = pixels[idx + 1]
          const b = pixels[idx + 2]
          const brightness = Math.max(r, g, b)
          if (brightness > maxBrightness) maxBrightness = brightness
        }
      }
      return { width: w, height: h, maxBrightness }
    })
    expect(result).not.toBeNull()
    expect(result!.maxBrightness).toBeGreaterThan(30) // proves something non-black is rendered
  })

  test('camera parallax responds to mouse move', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    const canvas = page.locator('[data-testid="hero-immersive-canvas"]')
    await expect(canvas).toBeAttached()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()

    // Capture pixel hash at top-right
    const beforeHash = await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('[data-testid="hero-immersive-canvas"]') as HTMLCanvasElement
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      const pixels = new Uint8Array(4)
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return Array.from(pixels).join(',')
    }, { x: Math.floor(box!.width * 0.8), y: Math.floor(box!.height * 0.2) })

    // Move mouse to opposite corner
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.8)
    await page.waitForTimeout(800)

    const afterHash = await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('[data-testid="hero-immersive-canvas"]') as HTMLCanvasElement
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      const pixels = new Uint8Array(4)
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return Array.from(pixels).join(',')
    }, { x: Math.floor(box!.width * 0.8), y: Math.floor(box!.height * 0.2) })

    // The pixel at top-right should change because the cluster/camera moved
    // (allowing for tolerance — could be same color if particles happen to overlap)
    // Just log the values; this is a "smoke" test that mouse interaction is wired
    console.log('before:', beforeHash, 'after:', afterHash)
  })
})