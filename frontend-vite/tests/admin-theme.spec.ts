import { test, expect } from '@playwright/test'

const adminPw = process.env.ADMIN_PW ?? 'admin123'
const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${baseURL}/admin/login`)
  await page.fill('#username', 'admin')
  await page.fill('#password', adminPw)
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')
}

test.describe('Admin theme system', () => {
  test.beforeEach(async ({ context }) => {
    // Start each test from a clean localStorage so we know the default is dark.
    await context.clearCookies()
  })

  test('default theme is dark (no data-theme attribute)', async ({ page, context }) => {
    await context.addInitScript(() => { try { localStorage.clear() } catch {} })
    await login(page)
    const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(themeAttr ?? '').toBe('')
  })

  test('light theme persists across reloads', async ({ page, context }) => {
    await context.addInitScript(() => { try { localStorage.clear() } catch {} })
    await login(page)
    // Navigate to Settings and pick light.
    await page.goto(`${baseURL}/admin/settings`)
    await page.waitForSelector('input[name="theme"][value="light"]', { timeout: 10000 })
    await page.click('input[name="theme"][value="light"]')
    // Verify attribute flipped.
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.dataset.theme)
    ).toBe('light')
    // Reload — must still be light.
    await page.reload()
    await page.waitForSelector('h1', { timeout: 10000 })
    const after = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(after).toBe('light')
  })

  test('switching back to dark removes the data-theme attribute', async ({ page, context }) => {
    await context.addInitScript(() => {
      try { localStorage.setItem('hbsc-theme', 'light') } catch {}
    })
    await login(page)
    await page.goto(`${baseURL}/admin/settings`)
    await page.waitForSelector('input[name="theme"][value="dark"]', { timeout: 10000 })
    await page.click('input[name="theme"][value="dark"]')
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.dataset.theme)
    ).toBe('')
  })
})