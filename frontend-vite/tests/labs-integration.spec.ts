// frontend-vite/tests/labs-integration.spec.ts
//
// Full integration: nav → /labs → MiniCast card → /labs/minicast →
// iframe loads minicast → embed mode hides minicast Header →
// minicast standalone still has its Header (regression).
//
// REQUIRES: all dev servers running.
//   # hbsc frontend (5174, playwright baseURL)
//   cd frontend-vite && npx vite --port 5174 --host 127.0.0.1
//   # minicast frontend (5577)
//   cd /Users/jasonlee/Projects/MiniCast/web && npm run dev
//   # (optional) hbsc + minicast backends for full data flow:
//   cd backend && uvicorn app.main:app --reload --port 8000
//   cd /Users/jasonlee/Projects/MiniCast && python -m minicast server
//
// Note: minicast's Header renders as a <header> element (verified in
// MiniCast/web/src/components/layout/Header.tsx). embed=1 hides it.

import { test, expect } from '@playwright/test'

test.describe('Labs full integration (manual smoke)', () => {
  test('nav → labs → minicast iframe → embed mode hides inner header', async ({ page }) => {
    // 1. Home → click nav 数创实验室
    await page.goto('/')
    await page.locator('nav.nav a').filter({ hasText: '数创实验室' }).click()
    await expect(page).toHaveURL(/\/labs$/)

    // 2. /labs: hero + 3 cards + minicast CTA visible
    await expect(page.getByRole('heading', { name: '数创实验室' })).toBeVisible()
    const minicastCard = page.getByTestId('lab-card').filter({ hasText: 'MiniCast' })
    await expect(minicastCard).toBeVisible()

    // 3. Click "开始使用"
    await minicastCard.getByRole('link', { name: /开始使用/ }).click()
    await expect(page).toHaveURL(/\/labs\/minicast$/)

    // 4. iframe loads minicast
    const iframe = page.frameLocator('iframe.minicast-lab__frame')
    // Wait for minicast's app body to render content
    await expect(iframe.locator('body')).not.toBeEmpty({ timeout: 15_000 })

    // 5. embed mode: minicast's internal Header must NOT be present
    const innerHeader = iframe.locator('header')
    await expect(innerHeader).toHaveCount(0)
  })

  test('minicast standalone still has header (regression check)', async ({ page }) => {
    // Direct visit to minicast WITHOUT ?embed=1
    await page.goto('http://localhost:5577/')
    // minicast's Header should be present
    await expect(page.locator('header').first()).toBeVisible()
  })
})
