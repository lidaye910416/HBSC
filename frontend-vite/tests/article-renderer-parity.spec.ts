import { test, expect } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'
const adminPw = process.env.ADMIN_PW ?? 'admin123'
const slug = 'openclaw-agent-framework'
const markdown = [
  '![canonical](/uploads/2026/07/a.png)',
  '![legacy](media/image1.png)',
].join('\n')
const article = {
  id: 19,
  title: 'Renderer parity',
  slug,
  summary: '',
  content: markdown,
  cover_image: null,
  cover_image_alt: '',
  category: '技术与产业',
  author_name: 'Admin',
  reading_time: 5,
  views: 0,
  featured: false,
  status: 'draft',
  tags: [],
  journal_id: 2,
  journal_title: '2026年第二期',
}

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
  // Same catch-all rationale as the other admin specs: the dashboard at
  // /admin and the editor at /admin/articles/* make /api/admin/* calls
  // (articles list, journals list, media list, …) that 401 against the
  // live backend and bounce us back to /admin/login. Permissive stub
  // here so the page renders; per-test mocks for settings/articles/19
  // take precedence when they want a richer payload.
  await page.route('**/api/admin/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/api/admin/settings')) return
    if (url.includes('/api/admin/articles/19')) return
    const method = route.request().method()
    const body =
      method === 'GET'
        ? JSON.stringify({ items: [], total: 0, page: 1, per_page: 1 })
        : JSON.stringify({ ok: true })
    await route.fulfill({ status: 200, contentType: 'application/json', body })
  })
  await page.goto(`${baseURL}/admin/login`)
  await page.fill('#username', 'admin')
  await page.fill('#password', adminPw)
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')
}

async function imageSources(page: import('@playwright/test').Page) {
  return page.locator('.prose-figure-img').evaluateAll((images) =>
    images.map((image) => image.getAttribute('src')),
  )
}

test('admin preview and public page resolve canonical and legacy images identically', async ({
  page,
}) => {
  await login(page)
  await page.route('**/api/admin/settings', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    }),
  )
  await page.route('**/api/admin/articles/19', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(article),
    }),
  )
  await page.goto(`${baseURL}/admin/articles/19`)
  await page.getByRole('tab', { name: /预览/ }).click()
  const adminSources = await imageSources(page)

  await page.route(`**/api/articles/${slug}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...article,
        status: 'published',
        published_at: '2026-07-14T08:00:00',
        related: [],
      }),
    }),
  )
  await page.route(`**/api/articles/${slug}/view`, (route) =>
    route.fulfill({ status: 204 }),
  )
  await page.goto(`${baseURL}/articles/${slug}`)
  const publicSources = await imageSources(page)

  expect(publicSources).toEqual(adminSources)
  expect(publicSources).toEqual([
    '/uploads/2026/07/a.png',
    '/uploads/source-images/03-openclaw/image1.png',
  ])
})
