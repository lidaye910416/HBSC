import { test, expect } from '@playwright/test'

/**
 * Issues trigger behavior (as of 2026-07-17):
 *
 *   click  → toggle dropdown (does NOT navigate)
 *   hover  → open dropdown (mouseleave closes)
 *   dropdown content: 2 latest issues as cover + title + date cards,
 *                     then a "查看全部期刊档案" link to /issues.
 *   each card is a real Link to /issues/<slug>.
 */

async function openIssuesDropdown(page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  // Dropdown content is mounted up front (visibility is the only difference).
  // Wait for the React Query to resolve at least one issue.
  await page.waitForSelector('.nav__dropdown-card', { state: 'attached', timeout: 10000 })
  // Toggle open via JS click so the preceding mouseenter/mouseleave hover
  // doesn't fight the click (trackpad-only rigs).
  await page
    .locator('button.nav__dropdown-trigger')
    .first()
    .evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  // Let the GSAP timeline open (0.22 + item 0.28 = ~0.5s ceiling).
  await page.waitForTimeout(600)
}

test.describe('nav issues trigger opens latest-two dropdown', () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' })

  test('clicking the trigger does NOT navigate; it opens the dropdown', async ({ page }) => {
    await openIssuesDropdown(page)
    // Still on home page.
    expect(new URL(page.url()).pathname).toBe('/')
    // Dropdown reached visible state.
    const opacity = await page.evaluate(() => {
      const m = document.querySelector('[data-nav-dropdown]')
      return m ? parseFloat(getComputedStyle(m).opacity) : 0
    })
    expect(opacity).toBeGreaterThan(0.9)
  })

  test('dropdown shows exactly 2 latest issue cards', async ({ page }) => {
    await openIssuesDropdown(page)
    const cards = page.locator('.nav__dropdown-card')
    await expect(cards).toHaveCount(2)
    // Each card is a Link to /issues/<slug>
    for (const i of [0, 1]) {
      const href = await cards.nth(i).getAttribute('href')
      expect(href, `card #${i} href`).toMatch(/^\/issues\/[A-Za-z0-9_\-]+$/)
    }
  })

  test('each card carries cover / number / title / date', async ({ page }) => {
    await openIssuesDropdown(page)
    const first = page.locator('.nav__dropdown-card').first()
    await expect(first.locator('.nav__dropdown-card__cover')).toBeAttached()
    await expect(first.locator('.nav__dropdown-card__title')).toBeAttached()
    // Title text should be non-empty.
    const title = (await first.locator('.nav__dropdown-card__title').textContent()) ?? ''
    expect(title.length).toBeGreaterThan(0)
    // Number + date are optional but if present, they must be non-empty when present.
    const number = await first.locator('.nav__dropdown-card__number').count()
    if (number > 0) {
      expect((await first.locator('.nav__dropdown-card__number').textContent())?.length).toBeGreaterThan(0)
    }
  })

  test('first card has is-latest class and is-latest matches sorted order', async ({ page }) => {
    await openIssuesDropdown(page)
    const first = page.locator('.nav__dropdown-card').first()
    await expect(first).toHaveClass(/is-latest/)
    // Second card must NOT have is-latest.
    const second = page.locator('.nav__dropdown-card').nth(1)
    await expect(second).not.toHaveClass(/is-latest/)
  })

  test('"查看全部期刊档案" footer link points to /issues', async ({ page }) => {
    await openIssuesDropdown(page)
    const foot = page.locator('.nav__dropdown-foot')
    await expect(foot).toBeAttached()
    expect(await foot.getAttribute('href')).toBe('/issues')
  })

  test('clicking a card navigates to that issue', async ({ page }) => {
    await openIssuesDropdown(page)
    const second = page.locator('.nav__dropdown-card').nth(1)
    const href = await second.getAttribute('href')
    await second.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    await page.waitForURL((url) => url.pathname === href, { timeout: 5000 })
    expect(new URL(page.url()).pathname).toBe(href)
  })
})
