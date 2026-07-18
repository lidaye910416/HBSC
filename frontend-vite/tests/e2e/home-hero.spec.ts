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

test('mouse parallax shifts the hero text', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(800)

  // Per-element parallax translates inner layers (.hero__title, .hero__subtitle,
  // .hero__label, .hero__actions) — the .hero__content container itself stays put.
  const title = page.locator('.hero__title')
  const beforeBox = await title.boundingBox()
  expect(beforeBox).not.toBeNull()

  await page.mouse.move(100, 100)
  await page.waitForTimeout(600)

  const afterBox = await title.boundingBox()
  expect(afterBox).not.toBeNull()

  // Subtle shift expected (1-15px range)
  const dx = Math.abs(afterBox!.x - beforeBox!.x)
  const dy = Math.abs(afterBox!.y - beforeBox!.y)
  expect(dx + dy).toBeGreaterThan(0)
})