import { test, expect } from '@playwright/test'

/**
 * Reading progress bar (P0-04) + hero choreography (P0-03).
 *
 * Asserts:
 *  - The fixed `<div role="progressbar">` is rendered and starts at scaleX(0).
 *  - Scrolling into the article body advances the bar's scaleX (transform
 *    matrix is no longer the identity matrix), proving the ScrollTrigger
 *    has fired at least once.
 *  - At the bottom of the page the bar reports a non-zero `aria-valuenow`,
 *    proving we expose the progress to assistive tech.
 *  - Visiting an Issue detail page also renders the bar.
 *
 * Note: `transform: scaleX(0)` makes the element zero-width, which
 * Playwright's `toBeVisible()` reports as "hidden". We use `toBeAttached`
 * for the initial check (the DOM node exists), and verify the scroll
 * progress through the computed transform + aria-valuenow.
 */

const ARTICLE_SLUG = '15th-five-year-plan-analysis'

test.describe('article detail reading progress (P0-03 / P0-04)', () => {
  test('progress bar grows as the user scrolls through an article', async ({ page }) => {
    await page.goto(`/articles/${ARTICLE_SLUG}`)

    const bar = page.getByRole('progressbar', { name: '阅读进度' })
    // Bar is in the DOM with scaleX(0) — Playwright reports that as
    // hidden, so check attachment + the initial identity transform
    // instead.
    await expect(bar).toBeAttached({ timeout: 5_000 })
    await expect(bar).toHaveAttribute('aria-valuemin', '0')
    await expect(bar).toHaveAttribute('aria-valuemax', '100')

    const initial = await bar.evaluate(el => getComputedStyle(el).transform)
    // start of scroll: scaleX(0) → matrix(0, 0, 0, 1, 0, 0)
    expect(initial).toBe('matrix(0, 0, 0, 1, 0, 0)')

    // Scroll into the middle of the article; trigger fires and rewrites scaleX.
    await page.evaluate(() => {
      const main = document.querySelector('.article-detail')
      if (!main) return
      const rect = main.getBoundingClientRect()
      window.scrollTo({ top: window.scrollY + rect.height / 2, behavior: 'auto' })
    })
    await page.waitForTimeout(600)

    const midTransform = await bar.evaluate(el => getComputedStyle(el).transform)
    expect(midTransform).not.toBe('matrix(0, 0, 0, 1, 0, 0)')

    // Scroll to the bottom; aria-valuenow should be a non-zero percentage.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(600)

    const valueNow = await bar.getAttribute('aria-valuenow')
    expect(valueNow).not.toBeNull()
    const numeric = Number(valueNow)
    expect(Number.isFinite(numeric)).toBe(true)
    expect(numeric).toBeGreaterThan(0)
    expect(numeric).toBeLessThanOrEqual(100)
  })

  test('issue detail page also exposes a reading progress bar', async ({ page }) => {
    // Use a slug known to exist in the seed data (P1-01 reports
    // `2026-q1` / `2026-q2` are populated).
    await page.goto('/issues/2026-q2')
    // Wait for the issue hero to render so we know the data has resolved
    // before asserting on the progress bar.
    await page.locator('.issue-detail__title').waitFor({ state: 'visible', timeout: 15_000 })
    const bar = page.getByRole('progressbar', { name: '阅读进度' })
    await expect(bar).toBeAttached({ timeout: 5_000 })
  })
})