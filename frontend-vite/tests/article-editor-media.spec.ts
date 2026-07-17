import { test, expect } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'
const adminPw = process.env.ADMIN_PW ?? 'admin123'

async function login(page: import('@playwright/test').Page) {
  // Mock all admin API endpoints the editor hits so the live backend's
  // 401 redirect doesn't bounce us back to /admin/login.
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
  // Default settings: typesetter UNCONFIGURED so the editor still renders
  // and the AI-排版 button is disabled (no extra floating actions).
  await page.route('**/api/admin/settings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    })
  })
  // The dashboard at /admin and the editor at /admin/articles/* make
  // /api/admin/* calls (articles list, journals list, media list, …).
  // Without a real session the live backend returns 401 and the global
  // 401 handler in services/api.ts bounces the page back to
  // /admin/login. Permissive stub so the editor renders; per-test
  // mocks (media upload/list, settings overrides) take precedence when
  // they want a richer payload.
  await page.route('**/api/admin/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/api/admin/settings')) return
    if (url.includes('/api/admin/media')) return
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

const LIBRARY_ASSET = {
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

test('paste upload replaces only its marker and preserves later typing', async ({ page }) => {
  await login(page)
  let releaseUpload!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseUpload = resolve
  })
  await page.route('**/api/admin/media?kind=image&source=paste', async (route) => {
    await gate
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 9,
        url: '/uploads/2026/07/paste.png',
        storage_path: '2026/07/paste.png',
        original_name: 'paste.png',
        mime_type: 'image/png',
        byte_size: 68,
        width: 1,
        height: 1,
        sha256: 'b'.repeat(64),
        source: 'paste',
        status: 'active',
        health: 'healthy',
        uploaded_by: 'admin',
        created_at: '2026-07-14T08:00:00',
        trashed_at: null,
        filename: 'paste.png',
        mime: 'image/png',
        size: 68,
        uploaded_at: '2026-07-14T08:00:00',
        kind: 'image',
      }),
    })
  })
  await page.goto(`${baseURL}/admin/articles/new`)
  const editor = page.locator('.w-md-editor-text-input').first()
  await editor.fill('before after')
  await editor.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(7, 7))
  await editor.evaluate((node) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'paste.png', { type: 'image/png' }))
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(editor).toHaveValue(/<!--hbsc-upload:/)
  await editor.press('End')
  await editor.type(' later')
  releaseUpload()
  await expect(editor).toHaveValue('before ![paste.png](/uploads/2026/07/paste.png)after later')
})

test('deleting a marker before upload completion leaves other text untouched', async ({ page }) => {
  await login(page)
  let releaseUpload!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseUpload = resolve
  })
  await page.route('**/api/admin/media?kind=image&source=paste', async (route) => {
    await gate
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 10,
        url: '/uploads/2026/07/orphan.png',
        storage_path: '2026/07/orphan.png',
        original_name: 'orphan.png',
        mime_type: 'image/png',
        byte_size: 68,
        width: 1,
        height: 1,
        sha256: 'c'.repeat(64),
        source: 'paste',
        status: 'active',
        health: 'healthy',
        uploaded_by: 'admin',
        created_at: '2026-07-14T08:00:00',
        trashed_at: null,
        filename: 'orphan.png',
        mime: 'image/png',
        size: 68,
        uploaded_at: '2026-07-14T08:00:00',
        kind: 'image',
      }),
    })
  })
  await page.goto(`${baseURL}/admin/articles/new`)
  const editor = page.locator('.w-md-editor-text-input').first()
  await editor.fill('keep')
  await editor.evaluate((node) => {
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'x.png', { type: 'image/png' }))
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  const marked = await editor.inputValue()
  await editor.fill(marked.replace(/<!--hbsc-upload:[^>]+-->/, '') + ' user')
  releaseUpload()
  await expect(editor).toHaveValue('keep user')
})

test('toolbar has upload and media-library controls but no built-in URL image button', async ({ page }) => {
  await login(page)
  await page.goto(`${baseURL}/admin/articles/new`)
  await expect(page.getByRole('button', { name: '上传并插入图片' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '从媒体库插入图片' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Add image/ })).toHaveCount(0)
})

test('media drawer inserts at the selection captured before drawer focus', async ({ page }) => {
  await login(page)
  await page.route('**/api/admin/media?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [LIBRARY_ASSET], total: 1, page: 1, per_page: 24 }),
    })
  })
  await page.goto(`${baseURL}/admin/articles/new`)
  const editor = page.locator('.w-md-editor-text-input').first()
  await editor.fill('left right')
  await editor.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(5, 5))
  await page.getByRole('button', { name: '从媒体库插入图片' }).click()
  await page.getByPlaceholder('搜索文件名或路径').fill('architecture')
  await page.getByText('architecture.png').click()
  await page.getByLabel('图片说明').fill('总体架构')
  await page.getByRole('button', { name: '插入所选图片' }).click()
  await expect(editor).toHaveValue('left ![总体架构](/uploads/2026/07/a.png)right')
})

test('re-opening the media drawer uses the most recently captured range', async ({ page }) => {
  await login(page)
  const SECOND_ASSET = {
    ...LIBRARY_ASSET,
    id: 43,
    url: '/uploads/2026/07/b.png',
    original_name: 'overview.png',
  }
  await page.route('**/api/admin/media?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [LIBRARY_ASSET, SECOND_ASSET],
        total: 2,
        page: 1,
        per_page: 24,
      }),
    })
  })
  await page.goto(`${baseURL}/admin/articles/new`)
  const editor = page.locator('.w-md-editor-text-input').first()
  await editor.fill('left right')
  // First open: insert at offset 5 ("left| right").
  await editor.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(5, 5))
  await page.getByRole('button', { name: '从媒体库插入图片' }).click()
  await page.getByText('architecture.png').click()
  await page.getByLabel('图片说明').fill('总体架构')
  await page.getByRole('button', { name: '插入所选图片' }).click()
  // Second open: place the cursor at the END of the editor. After the
  // first insert the value is "left ![…](…)right"; we want the next
  // insertion to land after "right", not at the original offset 5.
  // Re-focus the textarea so MDEditor's `state.selection` reflects the
  // new cursor when the toolbar button is clicked.
  await editor.evaluate((node: HTMLTextAreaElement) => {
    node.focus()
    const end = node.value.length
    node.setSelectionRange(end, end)
    node.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await page.getByRole('button', { name: '从媒体库插入图片' }).click()
  await page.getByText('overview.png').click()
  await page.getByLabel('图片说明').fill('概览图')
  await page.getByRole('button', { name: '插入所选图片' }).click()
  await expect(editor).toHaveValue(
    'left ![总体架构](/uploads/2026/07/a.png)right![概览图](/uploads/2026/07/b.png)',
  )
})
