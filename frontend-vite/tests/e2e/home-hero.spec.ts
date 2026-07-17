// frontend-vite/tests/e2e/home-hero.spec.ts
import { test, expect } from '@playwright/test'

test('home hero reveals and stats animate', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-reveal]').first()).toBeVisible()
  const stat = page.locator('[data-count-up]').first()
  await expect(stat).toBeVisible()
  await page.waitForTimeout(1500)
  const text = await stat.textContent()
  expect(Number(text)).toBeGreaterThan(0)
})
