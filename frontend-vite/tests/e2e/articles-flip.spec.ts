// frontend-vite/tests/e2e/articles-flip.spec.ts
//
// Pins the public contract of the Articles list page (P1-01 batch reveal
// + P1-03 FLIP continuity — the latter is exercised via the Vitest
// `batchReveal` contract test, not via this DOM-level spec).
//
// We deliberately verify only the observable page-level behaviour here:
//   - The filter bar is rendered.
//   - Clicking a non-default category updates the URL with ?category= and
//     leaves the page in a non-skeleton state (cards OR empty-state).
//   - Going back to 全部 restores the full list.
//
// The /api/articles response is mocked so this test is hermetic — it
// doesn't depend on a backend running. Animations are no-ops under
// prefers-reduced-motion by design (see `motionAllowed()`).

import { test, expect } from '@playwright/test'

const sampleArticles = {
  items: [
    {
      id: 1,
      title: '样例文章 A',
      slug: 'sample-a',
      summary: '摘要 A',
      cover_image: '/uploads/covers/a.jpg',
      category: '战略与政策',
      author_name: '作者 A',
      reading_time: 5,
      views: 10,
      tags: ['tag-a'],
      published_at: '2026-07-01T00:00:00',
    },
    {
      id: 2,
      title: '样例文章 B',
      slug: 'sample-b',
      summary: '摘要 B',
      cover_image: '/uploads/covers/b.jpg',
      category: '技术与产业',
      author_name: '作者 B',
      reading_time: 6,
      views: 20,
      tags: ['tag-b'],
      published_at: '2026-07-02T00:00:00',
    },
    {
      id: 3,
      title: '样例文章 C',
      slug: 'sample-c',
      summary: '摘要 C',
      cover_image: '/uploads/covers/c.jpg',
      category: '方案与思考',
      author_name: '作者 C',
      reading_time: 7,
      views: 30,
      tags: ['tag-c'],
      published_at: '2026-07-03T00:00:00',
    },
  ],
  total: 3,
  page: 1,
  per_page: 9,
  pages: 1,
}

test.describe('Articles list', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/articles**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sampleArticles),
      })
    })
  })

  test('renders the article cards from the API response', async ({ page }) => {
    await page.goto('/articles', { waitUntil: 'networkidle' })
    const cards = page.locator('a.article-card')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeGreaterThan(0)
  })

  test('filter switch updates URL and keeps cards visible', async ({ page }) => {
    await page.goto('/articles', { waitUntil: 'networkidle' })
    const cards = page.locator('a.article-card')
    await expect(cards.first()).toBeVisible()

    const filterButton = page
      .getByRole('tab', { name: /战略与政策|技术与产业|方案与思考|动态与文化/ })
      .first()
    await filterButton.click()

    await expect(page).toHaveURL(/[?&]category=/)

    await page.waitForFunction(() => {
      const cardEls = document.querySelectorAll('a.article-card')
      const empty = document.querySelector('.empty-state')
      return cardEls.length > 0 || empty !== null
    })

    await page.getByRole('tab', { name: '全部' }).click()
    await expect(page).not.toHaveURL(/[?&]category=/)
    await expect(cards.first()).toBeVisible()
  })
})