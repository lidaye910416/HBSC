import { test, expect } from '@playwright/test'

test.describe('nav issues trigger goes to latest issue on click', () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' })

  test('clicking the trigger navigates to the latest issue', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    // Wait for the issues query to resolve and dropdown items to render.
    await page.waitForSelector('[data-nav-dropdown-item]', { state: 'attached', timeout: 10000 })

    // Snapshot the URL of the FIRST dropdown item — that is the latest issue.
    const latestHref = await page.locator('[data-nav-dropdown-item]').first().getAttribute('href')
    expect(latestHref, 'latest item must have a /issues/<slug> href').toBeTruthy()
    expect(latestHref).toMatch(/^\/issues\/[A-Za-z0-9_\-]+$/)

    // Click the trigger button. We dispatch the click via JS so the preceding
    // mouseenter→mouseover hover doesn't toggle issuesOpen between renders.
    await page.locator('button.nav__dropdown-trigger').first().evaluate((el) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    // Expect navigation to the same href as the latest dropdown item.
    await page.waitForURL((url) => url.pathname === latestHref, { timeout: 5000 })
    expect(new URL(page.url()).pathname).toBe(latestHref)
  })

  test('first dropdown item carries the latest badge and is-latest class', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-nav-dropdown-item]', { state: 'attached', timeout: 10000 })

    const firstItem = page.locator('[data-nav-dropdown-item]').first()
    await expect(firstItem).toHaveClass(/is-latest/)
    const badge = firstItem.locator('.nav__dropdown-item-badge')
    await expect(badge).toBeAttached()
    await expect(badge).toHaveText('最新')
  })
})
