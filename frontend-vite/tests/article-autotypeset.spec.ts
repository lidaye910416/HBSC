import { test, expect, type Route } from '@playwright/test'

const adminPw = process.env.ADMIN_PW ?? 'admin123'
const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'

/**
 * 用最小的 buffer .docx 上传：Playwright 会把 buffer 写入到 setInputFiles，
 * content-type 由 accept 推导为 openxmlformats-officedocument.wordprocessingml.document，
 * 服务端只需收到文件即可，不需要真实 pandoc 内容（route mock 直接返回 JSON）。
 */
const MIN_DOCX = Buffer.from('PK\x03\x04', 'utf-8')

const TYPESET_STUB = JSON.stringify({
  content_markdown: '# 清洗后\n\n正文。',
  warnings: [],
  model: 'MiniMax-M3',
  prompt_version: '420',
})

const SETTINGS_CONFIGURED = JSON.stringify({
  items: [
    { key: 'article_typesetter.enabled', value: 'true', masked: null, is_secret: false, description: '', updated_at: new Date().toISOString(), updated_by: '' },
    { key: 'article_typesetter.api_key',  value: null,   masked: 'sk-cp***', is_secret: true,  description: '', updated_at: new Date().toISOString(), updated_by: '' },
  ],
})

const SETTINGS_UNCONFIGURED = JSON.stringify({
  items: [
    { key: 'article_typesetter.enabled', value: 'false', masked: null, is_secret: false, description: '', updated_at: new Date().toISOString(), updated_by: '' },
    { key: 'article_typesetter.api_key',  value: null,   masked: null,     is_secret: true,  description: '', updated_at: new Date().toISOString(), updated_by: '' },
  ],
})

const DOCX_IMPORT_OK = JSON.stringify({
  title: '导入标题',
  content_markdown: '# 原标题\n\n原始 pandoc 输出',
  suggested_slug: 'imported-slug',
  warnings: [],
  images: [],
})

async function mockSettings(route: Route, body: string) {
  await route.fulfill({ status: 200, contentType: 'application/json', body })
}

async function loginAdmin(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${baseURL}/admin/login`)
  await page.fill('#username', 'admin')
  await page.fill('#password', adminPw)
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')
}

test.describe('Docx 导入 + AI 排版一体化', () => {
  test.beforeEach(async ({ page }) => {
    // 默认清掉 localStorage，避免上一个用例的 state 干扰
    // 注意：必须在 navigation 之前一次性清除；不能放在 addInitScript 里
    // （addInitScript 会在每次 page.goto/reload 重新执行，会把 reload 后刚刚写入
    // 的 state 又清掉，导致"刷新后还原"用例无法观察持久化效果）。
    await page.goto(process.env.BASE_URL ?? 'http://localhost:5174')
    await page.evaluate(() => { try { localStorage.removeItem('hbsc-article-auto-typeset') } catch {} })
    await loginAdmin(page)
  })

  test('勾选自动排版 + 上传 .docx → TypesetPreviewDialog 自动打开', async ({ page }) => {
    let typesetCalled = false
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_CONFIGURED))
    await page.route('**/api/admin/articles/import-docx', async (r) => {
      await r.fulfill({ status: 200, contentType: 'application/json', body: DOCX_IMPORT_OK })
    })
    await page.route('**/api/admin/articles/typeset', async (r) => {
      typesetCalled = true
      await r.fulfill({ status: 200, contentType: 'application/json', body: TYPESET_STUB })
    })

    await page.goto(`${baseURL}/admin/articles/new`)
    // 等待 ArticleEditor 渲染出 checkbox（默认勾选 → 可见）
    const checkbox = page.getByRole('checkbox', { name: /导入 \.docx 后自动跑 AI 排版/ })
    await expect(checkbox).toBeVisible({ timeout: 10_000 })
    await expect(checkbox).toBeChecked()

    // 上传 .docx 触发 handleImportDocx
    const fileInput = page.locator('input[type="file"][accept*="openxmlformats"]')
    await fileInput.setInputFiles({ name: 'fixture.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: MIN_DOCX })

    // TypesetPreviewDialog 应当自动打开（dialog 内的 "清洗后（Markdown）" 列标题是唯一标识）
    await expect(page.getByRole('dialog').getByText('清洗后（Markdown）')).toBeVisible({ timeout: 15_000 })
    expect(typesetCalled).toBe(true)
  })

  test('取消勾选 + 上传 .docx → TypesetPreviewDialog 不打开', async ({ page }) => {
    let typesetCalled = false
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_CONFIGURED))
    await page.route('**/api/admin/articles/import-docx', async (r) => {
      await r.fulfill({ status: 200, contentType: 'application/json', body: DOCX_IMPORT_OK })
    })
    await page.route('**/api/admin/articles/typeset', async (r) => {
      typesetCalled = true
      await r.fulfill({ status: 200, contentType: 'application/json', body: TYPESET_STUB })
    })

    await page.goto(`${baseURL}/admin/articles/new`)
    const checkbox = page.getByRole('checkbox', { name: /导入 \.docx 后自动跑 AI 排版/ })
    await expect(checkbox).toBeVisible({ timeout: 10_000 })
    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()

    const fileInput = page.locator('input[type="file"][accept*="openxmlformats"]')
    await fileInput.setInputFiles({ name: 'fixture.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: MIN_DOCX })

    // 给浏览器一拍时间确认没有请求 / 没有弹窗
    await page.waitForTimeout(2000)
    expect(typesetCalled).toBe(false)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('typesetter 未配置 → checkbox 不渲染，导入不触发 LLM', async ({ page }) => {
    let typesetCalled = false
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_UNCONFIGURED))
    await page.route('**/api/admin/articles/import-docx', async (r) => {
      await r.fulfill({ status: 200, contentType: 'application/json', body: DOCX_IMPORT_OK })
    })
    await page.route('**/api/admin/articles/typeset', async (r) => {
      typesetCalled = true
      await r.fulfill({ status: 200, contentType: 'application/json', body: TYPESET_STUB })
    })

    await page.goto(`${baseURL}/admin/articles/new`)
    // 等编辑器出现 .docx file input
    const fileInput = page.locator('input[type="file"][accept*="openxmlformats"]')
    await expect(fileInput).toBeVisible({ timeout: 10_000 })

    await fileInput.setInputFiles({ name: 'fixture.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: MIN_DOCX })

    await page.waitForTimeout(2000)
    expect(typesetCalled).toBe(false)
    // 没有 checkbox
    await expect(page.getByRole('checkbox', { name: /导入 \.docx 后自动跑 AI 排版/ })).toHaveCount(0)
    // 出现未配置时的提示文案
    await expect(page.getByText(/请先在.*设置.*AI 排版.*启用/).first()).toBeVisible()
  })

  test('刷新页面后 checkbox 状态从 localStorage 还原', async ({ page }) => {
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_CONFIGURED))

    await page.goto(`${baseURL}/admin/articles/new`)
    const checkbox = page.getByRole('checkbox', { name: /导入 \.docx 后自动跑 AI 排版/ })
    await expect(checkbox).toBeVisible({ timeout: 10_000 })
    await checkbox.uncheck()

    // 验证 localStorage 已写入 'false'
    const ls = await page.evaluate(() => localStorage.getItem('hbsc-article-auto-typeset'))
    expect(ls).toBe('false')

    await page.reload()
    await expect(page.getByRole('checkbox', { name: /导入 \.docx 后自动跑 AI 排版/ })).not.toBeChecked()
  })
})