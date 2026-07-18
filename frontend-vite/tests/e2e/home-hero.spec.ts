// frontend-vite/tests/e2e/home-hero.spec.ts
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

test('home hero reveals and stats animate', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-reveal]').first()).toBeVisible()
  const stat = page.locator('[data-count-up]').first()
  await expect(stat).toBeVisible()
  await page.waitForTimeout(1500)
  const text = await stat.textContent()
  expect(Number(text)).toBeGreaterThan(0)
})

test('hero-immersive canvas is attached (WebGL path)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await waitForStableHeight(page)
  // Default reducedMotion: 'no-preference' → WebGL path
  const canvas = page.locator('[data-testid="hero-immersive-canvas"]')
  await expect(canvas).toBeAttached()
})

test('hero section has aria-labelledby pointing to h1 id', async ({ page }) => {
  await page.goto('/')
  const section = page.locator('section#hero')
  await expect(section).toHaveAttribute('aria-labelledby', 'hero-title')
  await expect(page.locator('h1#hero-title')).toBeAttached()
})