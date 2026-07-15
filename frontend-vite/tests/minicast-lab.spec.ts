// frontend-vite/tests/minicast-lab.spec.ts
//
// TDD red: confirms /labs/minicast renders an iframe whose src contains
// embed=1, and that hbsc's nav remains visible with 数创实验室 marked
// active. Does NOT verify minicast actually loads — that's Task 14.
import { test, expect } from '@playwright/test'

test.describe('MiniCast iframe page /labs/minicast', () => {
  test('renders iframe with embed=1 query param', async ({ page }) => {
    await page.goto('/labs/minicast')

    const iframe = page.locator('iframe.minicast-lab__frame')
    await expect(iframe).toBeVisible()

    const src = await iframe.getAttribute('src')
    expect(src).toContain('embed=1')

    // In dev, src should point to localhost:5577
    // In prod, src should be a relative path starting with /labs/minicast
    const isDev = src?.startsWith('http://localhost:5577')
    const isProd = src?.startsWith('/labs/minicast')
    expect(isDev || isProd).toBe(true)
  })

  test('hbsc nav remains visible (no double header)', async ({ page }) => {
    await page.goto('/labs/minicast')
    // hbsc nav is always rendered (sticky)
    await expect(page.locator('nav.nav').first()).toBeVisible()
    // 数创实验室 nav item should be active
    const labsNav = page.locator('nav.nav a').filter({ hasText: '数创实验室' })
    await expect(labsNav).toHaveClass(/nav__link--active/)
  })
})
