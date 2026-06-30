import { test, expect } from '@playwright/test'

const adminPw = process.env.ADMIN_PW ?? 'admin123'
const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'

test.describe('Admin visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${baseURL}/admin/login`)
    await page.fill('#username', 'admin')
    await page.fill('#password', adminPw)
    await page.click('button[type=submit]')
    await page.waitForURL('**/admin')
  })

  for (const view of ['dashboard', 'articles', 'journals', 'media']) {
    test(`snapshot @ 1440x900: ${view}`, async ({ page }) => {
      const path: Record<string, string> = {
        dashboard: '/admin',
        articles: '/admin/articles',
        journals: '/admin/journals',
        media: '/admin/media',
      }
      await page.goto(`${baseURL}${path[view]}`)
      // Wait for the page heading to be present so React has rendered.
      await page.waitForSelector('h1', { timeout: 15000 })
      // Small settle delay for fonts + images to flush.
      await page.waitForTimeout(1000)
      await expect(page).toHaveScreenshot(`admin-${view}-1440.png`, { fullPage: true })
    })
  }

  test('snapshot @ 1280x800: dashboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${baseURL}/admin`)
    await page.waitForSelector('h1', { timeout: 15000 })
    await page.waitForTimeout(1000)
    await expect(page).toHaveScreenshot('admin-dashboard-1280.png', { fullPage: true })
  })
})
