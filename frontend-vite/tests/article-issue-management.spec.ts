import { test, expect } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'
const adminPw = process.env.ADMIN_PW ?? 'admin123'

/**
 * Article issue management — top tabs, URL state, hydration, reassignment.
 *
 * The list view splits admin articles into per-issue tabs plus an
 * "未归期" tab; the active scope lives in the URL so refresh and back
 * navigation restore the selection. The editor hydrates `journal_id`
 * from the server payload, lets the admin reassign via a select,
 * and refuses to publish without a journal.
 *
 * Each test route-mocks the backend so the live API doesn't have to
 * run. We assert on URL state, request payloads, and DOM presence.
 */

async function login(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'set-cookie':
          'admin_token=test-token; Path=/; Max-Age=28800; HttpOnly; SameSite=Strict',
      },
      body: JSON.stringify({
        access_token: 'test-token',
        token_type: 'bearer',
        expires_at: '2099-12-31T00:00:00',
      }),
    })
  })
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, username: 'admin', role: 'admin' }),
    })
  })
  await page.route('**/api/admin/settings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    })
  })
  await page.goto(`${baseURL}/admin/login`)
  await page.fill('#username', 'admin')
  await page.fill('#password', adminPw)
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')
}

/** Mock the journals list endpoint with the canonical two-issue seed. */
async function mockJournals(page: import('@playwright/test').Page, counts: Record<number, number>) {
  await page.route('**/api/admin/journals?**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.endsWith('/api/admin/journals') || url.searchParams.has('status') === false && url.pathname === '/api/admin/journals') {
      // continue, but we still need to fulfill journals list
    }
    const items = [
      { id: 2, title: '2026年第二期', slug: '2026-q2', status: 'published', article_count: counts[2] ?? 8, published_at: '2026-06-30T00:00:00' },
      { id: 1, title: '2026年第一期', slug: '2026-q1', status: 'published', article_count: counts[1] ?? 11, published_at: '2026-03-31T00:00:00' },
    ]
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: items.length, page: 1, per_page: 100 }),
    })
  })
}

/** Mock the all-count query (page=1 per_page=1 with no journal filter). */
async function mockAllCount(page: import('@playwright/test').Page, total: number) {
  await page.route('**/api/admin/articles?*per_page=1*', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('journal_id') || url.searchParams.get('unassigned') === 'true') {
      // pass through (handled by other mocks)
      return route.fallback()
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total, page: 1, per_page: 1 }),
    })
  })
}

async function mockUnassignedCount(page: import('@playwright/test').Page, total: number) {
  await page.route('**/api/admin/articles?*unassigned=true*', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('per_page') !== '1') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total, page: 1, per_page: 1 }),
    })
  })
}

test.describe('ArticleList — top issue tabs', () => {
  test('全部文章 / 未归期 / 期刊 tabs exist; selecting second issue pushes journal_id', async ({ page }) => {
    await login(page)
    await mockJournals(page, { 1: 11, 2: 8 })
    await mockAllCount(page, 19)
    await mockUnassignedCount(page, 0)

    let articlesURL = ''
    await page.route('**/api/admin/articles?**', async (route) => {
      const url = new URL(route.request().url())
      // Skip the badge-count mocks (per_page=1, both unassigned and all)
      if (url.searchParams.get('per_page') === '1') return route.fallback()
      articlesURL = url.pathname + url.search
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, per_page: 20 }),
      })
    })

    await page.goto(`${baseURL}/admin/articles`)
    await expect(page.getByRole('tab', { name: /全部文章/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /2026年第二期/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /未归期/ })).toBeVisible()

    await page.getByRole('tab', { name: /2026年第二期/ }).click()
    await expect(page).toHaveURL(/journal_id=2/)
    await expect.poll(() => articlesURL).toContain('journal_id=2')

    await page.getByRole('tab', { name: /未归期/ }).click()
    await expect(page).toHaveURL(/unassigned=true/)

    // Status filter combined with unassigned still URL-resets page=1
    await page.getByLabel('状态').selectOption('draft')
    await expect(page).toHaveURL(/status=draft/)
    await expect(page).toHaveURL(/page=1/)
  })

  test('issue column hidden in a concrete journal scope, visible in 全部 / 未归期', async ({ page }) => {
    await login(page)
    await mockJournals(page, { 1: 11, 2: 8 })
    await mockAllCount(page, 19)
    await mockUnassignedCount(page, 1)

    await page.route('**/api/admin/articles?**', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('per_page') === '1') return route.fallback()
      if (url.searchParams.get('unassigned') === 'true') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            items: [{ id: 7, title: 'Loose draft', slug: 'loose', status: 'draft', featured: false, reading_time: 5, views: 0, journal_id: null, journal_title: null }],
            total: 1, page: 1, per_page: 20,
          }),
        })
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { id: 1, title: 'Q2 draft', slug: 'q2-d', status: 'draft', featured: false, reading_time: 5, views: 0, journal_id: 2, journal_title: '2026年第二期', category: '方案与思考' },
            { id: 9, title: 'Q1 article', slug: 'q1-a', status: 'published', featured: false, reading_time: 5, views: 0, journal_id: 1, journal_title: '2026年第一期', category: '战略与政策' },
          ],
          total: 2, page: 1, per_page: 20,
        }),
      })
    })

    await page.goto(`${baseURL}/admin/articles`)
    // All articles view: "所属期数" column should be present
    await expect(page.getByRole('columnheader', { name: '所属期数' })).toBeVisible()

    // Drill into a specific journal — column should disappear
    await page.getByRole('tab', { name: /2026年第二期/ }).click()
    await expect(page).toHaveURL(/journal_id=2/)
    await expect(page.getByRole('columnheader', { name: '所属期数' })).toHaveCount(0)

    // "未归期" view — column should reappear
    await page.getByRole('tab', { name: /未归期/ }).click()
    await expect(page).toHaveURL(/unassigned=true/)
    await expect(page.getByRole('columnheader', { name: '所属期数' })).toBeVisible()
  })
})

test.describe('ArticleEditor — issue assignment', () => {
  test('hydrates journal_id from server payload', async ({ page }) => {
    await login(page)
    await mockJournals(page, { 1: 11, 2: 8 })

    await page.route('**/api/admin/articles/19', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          id: 19, title: 'Existing', slug: 'existing',
          content: 'hi', summary: '', cover_image: null, cover_image_alt: '',
          category: '战略与政策', author_name: '',
          reading_time: 5, views: 0, featured: false, status: 'draft', tags: [],
          journal_id: 2, journal_title: '2026年第二期',
        }),
      })
    })

    await page.goto(`${baseURL}/admin/articles/19`)
    await expect(page.getByLabel('所属期数')).toHaveValue('2')
  })

  test('reassignment sends journal_id on PUT', async ({ page }) => {
    await login(page)
    await mockJournals(page, { 1: 11, 2: 8 })

    await page.route('**/api/admin/articles/19', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          id: 19, title: 'Existing', slug: 'existing',
          content: 'hi', summary: '', cover_image: null, cover_image_alt: '',
          category: '战略与政策', author_name: '',
          reading_time: 5, views: 0, featured: false, status: 'draft', tags: [],
          journal_id: 2, journal_title: '2026年第二期',
        }),
      })
    })

    let putBody: Record<string, unknown> | null = null
    await page.route('**/api/admin/articles/19', async (route) => {
      if (route.request().method() === 'PUT') {
        putBody = JSON.parse(route.request().postData() || '{}')
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            id: 19, title: 'Existing', slug: 'existing',
            content: 'hi', summary: '', cover_image: null, cover_image_alt: '',
            category: '战略与政策', author_name: '',
            reading_time: 5, views: 0, featured: false, status: 'draft', tags: [],
            journal_id: 1, journal_title: '2026年第一期',
          }),
        })
        return
      }
      await route.fallback()
    }, { times: 2 })

    await page.goto(`${baseURL}/admin/articles/19`)
    await expect(page.getByLabel('所属期数')).toHaveValue('2')
    await page.getByLabel('所属期数').selectOption('1')
    await page.getByRole('button', { name: '保存草稿' }).first().click()
    await expect.poll(() => putBody).not.toBeNull()
    expect(putBody).not.toBeNull()
    expect((putBody as Record<string, unknown>)['journal_id']).toBe(1)
  })

  test('new-article preset: ?journal_id=2 preselects and create payload carries it', async ({ page }) => {
    await login(page)
    await mockJournals(page, { 1: 11, 2: 8 })

    let createBody: Record<string, unknown> | null = null
    await page.route('**/api/admin/articles', async (route) => {
      if (route.request().method() === 'POST') {
        createBody = JSON.parse(route.request().postData() || '{}')
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            id: 50, title: 'New', slug: 'new',
            content: '', summary: '', cover_image: null, cover_image_alt: '',
            category: '方案与思考', author_name: '',
            reading_time: 5, views: 0, featured: false, status: 'draft', tags: [],
            journal_id: 2, journal_title: '2026年第二期',
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.goto(`${baseURL}/admin/articles/new?journal_id=2&category=${encodeURIComponent('方案与思考')}`)
    await expect(page.getByLabel('所属期数')).toHaveValue('2')
    // Title (required) must be filled before save
    await page.getByLabel('标题 *').fill('New')
    await page.getByLabel(/^Slug/).fill('new')
    await page.getByRole('button', { name: '保存草稿' }).first().click()
    await expect.poll(() => createBody).not.toBeNull()
    expect((createBody as Record<string, unknown>)['journal_id']).toBe(2)
    expect((createBody as Record<string, unknown>)['category']).toBe('方案与思考')
  })

  test('unassigned draft sends journal_id: null on save', async ({ page }) => {
    await login(page)
    await mockJournals(page, { 1: 11, 2: 8 })

    let createBody: Record<string, unknown> | null = null
    await page.route('**/api/admin/articles', async (route) => {
      if (route.request().method() === 'POST') {
        createBody = JSON.parse(route.request().postData() || '{}')
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            id: 60, title: 'Draft', slug: 'draft',
            content: '', summary: '', cover_image: null, cover_image_alt: '',
            category: '方案与思考', author_name: '',
            reading_time: 5, views: 0, featured: false, status: 'draft', tags: [],
            journal_id: null, journal_title: null,
          }),
        })
        return
      }
      await route.fallback()
    })

    await page.goto(`${baseURL}/admin/articles/new`)
    // The selector defaults to "" (未归期)
    await expect(page.getByLabel('所属期数')).toHaveValue('')
    await page.getByLabel('标题 *').fill('Draft')
    await page.getByLabel(/^Slug/).fill('draft')
    await page.getByRole('button', { name: '保存草稿' }).first().click()
    await expect.poll(() => createBody).not.toBeNull()
    expect((createBody as Record<string, unknown>)['journal_id']).toBeNull()
  })

  test('publish with no journal shows client guidance and skips request', async ({ page }) => {
    await login(page)
    await mockJournals(page, { 1: 11, 2: 8 })

    let publishedAttempt = false
    await page.route('**/api/admin/articles', async (route) => {
      if (route.request().method() === 'POST') {
        publishedAttempt = true
        await route.fallback()
      }
    })

    await page.goto(`${baseURL}/admin/articles/new`)
    await expect(page.getByLabel('所属期数')).toHaveValue('')
    await page.getByLabel('标题 *').fill('NoJournal')
    await page.getByLabel(/^Slug/).fill('nojournal')
    await page.getByRole('button', { name: '保存并发布' }).first().click()
    await expect(page.locator('.article-editor__error')).toContainText('发布文章前请选择所属期数')
    expect(publishedAttempt).toBe(false)
  })
})

test.describe('ArticleList — count refresh after edit', () => {
  test('tab badges update when an article moves between issues', async ({ page }) => {
    await login(page)

    // Initial counts: Q2=8, Q1=11
    await page.route('**/api/admin/journals?**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { id: 2, title: '2026年第二期', slug: '2026-q2', status: 'published', article_count: 8, published_at: '2026-06-30T00:00:00' },
            { id: 1, title: '2026年第一期', slug: '2026-q1', status: 'published', article_count: 11, published_at: '2026-03-31T00:00:00' },
          ],
          total: 2, page: 1, per_page: 100,
        }),
      })
    })
    let journalsRequests = 0
    page.on('request', (req) => {
      if (req.url().includes('/api/admin/journals')) journalsRequests++
    })
    void journalsRequests  // sanity-check the counter when debugging

    await page.route('**/api/admin/articles?*per_page=1*', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('unassigned') === 'true') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, per_page: 1 }) })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 19, page: 1, per_page: 1 }) })
      }
    })

    await page.route('**/api/admin/articles?**', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('per_page') === '1') return route.fallback()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, per_page: 20 }) })
    })

    await page.goto(`${baseURL}/admin/articles`)
    // Q2 tab badge starts at 8
    await expect(page.getByRole('tab', { name: /2026年第二期.*8/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /2026年第一期.*11/ })).toBeVisible()

    // Now remock journals with the post-edit counts (Q2=7, Q1=12) and reload.
    await page.unroute('**/api/admin/journals?**')
    await page.route('**/api/admin/journals?**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { id: 2, title: '2026年第二期', slug: '2026-q2', status: 'published', article_count: 7, published_at: '2026-06-30T00:00:00' },
            { id: 1, title: '2026年第一期', slug: '2026-q1', status: 'published', article_count: 12, published_at: '2026-03-31T00:00:00' },
          ],
          total: 2, page: 1, per_page: 100,
        }),
      })
    })
    await page.reload()
    await expect(page.getByRole('tab', { name: /2026年第二期.*7/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /2026年第一期.*12/ })).toBeVisible()
  })
})