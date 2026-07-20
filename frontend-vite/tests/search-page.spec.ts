import { test, expect } from '@playwright/test'

test.describe('public search page', () => {
  test('renders backend items as clickable article results', async ({ page }) => {
    await page.route('**/api/search?q=*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: 19,
            title: '红安县紧密型数字医共体技术案例',
            slug: '2026-q2-plan-hongan-medical-v1',
            category: '方案与思考',
            type: 'article',
          }],
          total: 1,
        }),
      }),
    )
    await page.goto('/search')
    await page.locator('.search-input').fill('医疗')

    await expect(page.getByText('找到').locator('..')).toContainText('1')
    const result = page.getByRole('link', { name: /红安县紧密型数字医共体技术案例/ })
    await expect(result).toBeVisible()
    await expect(result).toHaveAttribute('href', '/articles/2026-q2-plan-hongan-medical-v1')
    await expect(result).toContainText('方案与思考')
  })

  test('requires at least two characters before searching', async ({ page }) => {
    let searchRequests = 0
    await page.route('**/api/search?q=*', (route) => {
      searchRequests++
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
    })

    await page.goto('/search')
    await page.locator('.search-input').fill('医')
    await page.waitForTimeout(400)

    await expect(page.getByText('请输入至少2个字符')).toBeVisible()
    expect(searchRequests).toBe(0)
  })

  test('renders an empty state when the backend returns no results', async ({ page }) => {
    await page.route('**/api/search?q=*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0 }),
      }),
    )

    await page.goto('/search')
    await page.locator('.search-input').fill('无结果')

    await expect(page.getByText('未找到相关结果')).toBeVisible()
    await expect(page.locator('.search-results__count')).toContainText('0')
  })

  test('shows loading placeholders while search is pending', async ({ page }) => {
    let releaseSearch: (() => void) | undefined
    await page.route('**/api/search?q=*', async (route) => {
      await new Promise<void>((resolve) => { releaseSearch = resolve })
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0 }),
      })
    })

    await page.goto('/search')
    await page.locator('.search-input').fill('加载')
    await expect.poll(() => Boolean(releaseSearch)).toBe(true)

    await expect(page.locator('.skeleton-result')).toHaveCount(3)
    releaseSearch?.()
  })
})
