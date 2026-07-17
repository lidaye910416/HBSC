import { test, expect } from '@playwright/test'

const PATHS = ['/', '/articles', '/issues', '/articles/2026-q2', '/about']

/**
 * Wait until the document height has stopped changing for two consecutive
 * polls. GSAP ScrollTrigger and lazy mounting can grow the doc after
 * `networkidle` (e.g. Issues pin-spacer attaches after the grid renders).
 */
async function waitForStableHeight(page, { polls = 4, gapMs = 150 } = {}) {
  let last = -1
  for (let i = 0; i < polls; i++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    if (h === last) return h
    last = h
    await page.waitForTimeout(gapMs)
  }
  return last
}

test.describe('page scrolling works on all public routes', () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' })

  for (const path of PATHS) {
    test(`wheel scroll on ${path} reaches near the bottom`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' })
      await waitForStableHeight(page)
      const metrics = await page.evaluate(() => ({
        docH: document.documentElement.scrollHeight,
        winH: window.innerHeight,
      }))
      // The page must have content that overflows, otherwise the test is uninteresting.
      test.skip(metrics.docH <= metrics.winH + 1, 'no overflow on this page')
      const maxScroll = metrics.docH - metrics.winH
      await page.mouse.move(640, 400)
      // 8 wheel events × 400 each = 3200 attempt.
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, 400)
        await page.waitForTimeout(120)
      }
      const y = await page.evaluate(() => window.scrollY)
      // We must reach at least 90% of maxScroll. With normalizeScroll(true) without
      // ScrollSmoother the wheel events get clamped and y stays well under maxScroll.
      expect(y, `${path} maxScroll=${maxScroll} actual=${y}`).toBeGreaterThan(maxScroll * 0.9)
    })
  }

  test('window.scrollTo() can place viewport at requested y on /', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)
    const { docH, winH } = await page.evaluate(() => ({
      docH: document.documentElement.scrollHeight,
      winH: window.innerHeight,
    }))
    const target = Math.max(0, Math.min(1500, docH - winH - 100))
    // Force instant scroll (global.css has `html { scroll-behavior: smooth }`,
    // so the regular window.scrollTo would animate over ~500ms). We still
    // get a meaningful assertion — if scroll is broken (capped by some
    // wrapper), instant and smooth both end up at the wrong number.
    await page.evaluate((t) => { window.scrollTo({ top: t, behavior: 'instant' as ScrollBehavior }) }, target)
    await page.waitForTimeout(100)
    const y = await page.evaluate(() => window.scrollY)
    // Allow ±100 px so we don't depend on the exact render after settle.
    expect(y, `scrollTo(${target}) but got ${y} of max ${docH}`).toBeGreaterThan(target - 100)
  })
})

