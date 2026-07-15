// frontend-vite/tests/labs-integration.spec.ts
//
// Full integration: nav → /labs → MiniCast card → /labs/minicast →
// iframe loads minicast → minicast Header + ProgressBar visible
// (user needs in-app controls: settings, API key, progress) →
// minicast standalone still has its Header (regression).
//
// Header visibility in embed mode was intentionally reversed (2026-07-15):
// hiding the Header also hid the Settings button and API Key indicator,
// which the user needs while the lab is hosted inside hbsc. The hbsc Nav
// and minicast Header serve different layers and don't visually conflict.
//
// REQUIRES: all dev servers running.
//   # hbsc frontend
//   cd frontend-vite && npx vite --port 5174 --host 127.0.0.1
//   # minicast frontend (5577)
//   cd /Users/jasonlee/Projects/MiniCast/web && npm run dev
//   # (optional) hbsc + minicast backends for full data flow:
//   cd backend && uvicorn app.main:app --reload --port 8000
//   cd /Users/jasonlee/Projects/MiniCast && python -m minicast server

import { test, expect } from '@playwright/test'

test.describe('Labs full integration (manual smoke)', () => {
  test('nav → labs → minicast iframe → Header + Settings visible', async ({ page }) => {
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
    await expect(iframe.locator('body')).not.toBeEmpty({ timeout: 15_000 })

    // 5. embed mode now keeps the Header visible — verify it AND the
    //    critical controls (Settings button + API Key status).
    const innerHeader = iframe.locator('header')
    await expect(innerHeader).toHaveCount(1) // visible (not hidden)

    // The Settings button is the reason we keep the Header in embed mode.
    // The button is icon-only with aria-label="设置" (no visible text).
    await expect(iframe.locator('button[aria-label="设置"]')).toBeVisible()

    // API Key status is also exposed via the Header (e.g. "API Key: 已设置").
    // Asserting visibility of the indicator text is the cleanest signal.
    await expect(iframe.getByText(/API Key/)).toBeVisible()
  })

  test('minicast standalone still has header (regression check)', async ({ page }) => {
    // Direct visit to minicast WITHOUT ?embed=1
    await page.goto('http://localhost:5577/')
    // minicast's Header should be present
    await expect(page.locator('header').first()).toBeVisible()
  })
})
