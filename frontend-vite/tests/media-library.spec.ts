import { test, expect } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'
const adminPw = process.env.ADMIN_PW ?? 'admin123'

async function login(page: import('@playwright/test').Page) {
  // Mock login so we don't depend on the live admin password, and set
  // both the cookie (for the live backend proxied through Vite) and the
  // JSON body (for any client-side auth checks).
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
  // Authorize the subsequent admin API calls by mocking /api/auth/me.
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, username: 'admin', role: 'admin' }),
    })
  })
  await page.goto(`${baseURL}/admin/login`)
  await page.fill('#username', 'admin')
  await page.fill('#password', adminPw)
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')
}

const asset = {
  id: 42,
  storage_path: '2026/07/a.png',
  url: '/uploads/2026/07/a.png',
  original_name: 'architecture.png',
  mime_type: 'image/png',
  byte_size: 2048,
  width: 1600,
  height: 900,
  sha256: 'a'.repeat(64),
  source: 'upload',
  status: 'active',
  health: 'healthy',
  uploaded_by: 'admin',
  created_at: '2026-07-14T08:00:00',
  trashed_at: null,
  filename: 'a.png',
  mime: 'image/png',
  size: 2048,
  uploaded_at: '2026-07-14T08:00:00',
  kind: 'image',
}

test('media page accepts pagination without pages and filters by filename', async ({ page }) => {
  await login(page)
  let requestURL = ''
  await page.route('**/api/admin/media?**', async (route) => {
    requestURL = route.request().url()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [asset], total: 25, page: 1, per_page: 24 }),
    })
  })
  await page.goto(`${baseURL}/admin/media`)
  await expect(page.getByText('architecture.png')).toBeVisible()
  await expect(page.getByRole('button', { name: '2' })).toBeVisible()
  await page.getByPlaceholder('搜索文件名或路径').fill('arch')
  await expect.poll(() => requestURL).toContain('q=arch')
})

test('media page exposes source and usage filters and a detail usage panel', async ({ page }) => {
  await login(page)
  await page.route('**/api/admin/media?**', async (route) => {
    if (!route.request().url().includes('/usages')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [asset], total: 1, page: 1, per_page: 24 }),
      })
    }
  })
  await page.route('**/api/admin/media/42/usages', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          owner_type: 'article',
          owner_id: 7,
          field: 'content',
          title: '红安县数字医共体',
          reference_count: 1,
        },
      ]),
    })
  })
  await page.goto(`${baseURL}/admin/media`)
  await expect(page.getByLabel('来源')).toBeVisible()
  await expect(page.getByLabel('使用状态')).toBeVisible()
  await page.getByText('architecture.png').click()
  await expect(page.getByText('文章：红安县数字医共体')).toBeVisible()
})

test('trash returns 409 listing referencing articles when in use', async ({ page }) => {
  await login(page)
  await page.route('**/api/admin/media?**', async (route) => {
    if (!route.request().url().includes('/usages') && !route.request().url().match(/media\/\d+$/)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [asset], total: 1, page: 1, per_page: 24 }),
      })
    }
  })
  await page.route('**/api/admin/media/42', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'asset_in_use',
            message: '该图片仍被引用',
            usages: [
              {
                owner_type: 'article',
                owner_id: 7,
                field: 'content',
                title: '红安县数字医共体',
                reference_count: 2,
              },
            ],
          },
        }),
      })
    }
  })
  await page.goto(`${baseURL}/admin/media`)
  await page.getByRole('button', { name: '放入回收站' }).click()
  await page.getByRole('button', { name: '确认' }).click()
  // The 409 response includes usages; the trash button must NOT have
  // removed the asset (it is still listed as an active card) and a
  // toast must surface the referencing owner name.
  await expect(page.getByText(/图片仍被引用/)).toBeVisible()
  await expect(page.getByText('红安县数字医共体').first()).toBeVisible()
  // The asset must still be listed in the grid (and its trash button
  // still exposed) — a 409 must never silently remove it.
  await expect(page.getByText('architecture.png').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '放入回收站' })).toHaveCount(1)
  // And there must not be more than one toast visible at the same time.
  await expect(page.getByText(/图片仍被引用/)).toHaveCount(1)
})

test('trashed asset shows restore action', async ({ page }) => {
  await login(page)
  const trashedAsset = { ...asset, id: 8, status: 'trashed' as const, trashed_at: '2026-07-14T09:00:00' }
  await page.route('**/api/admin/media?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [trashedAsset], total: 1, page: 1, per_page: 24 }),
    })
  })
  await page.goto(`${baseURL}/admin/media?status=trashed`)
  await expect(page.getByText('architecture.png')).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复' })).toBeVisible()
})
