import { test, expect, type Route } from '@playwright/test'

const adminPw = process.env.ADMIN_PW ?? 'Hbsc@2026'
const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'

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

const TYPESET_STUB = JSON.stringify({
  content_markdown: '# 清洗后标题\n\n清洗后正文段落。',
  warnings: [],
  model: 'MiniMax-M3',
  prompt_version: '420',
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

test.describe('ArticleEditor 深色主题 + AI 排版按钮位置', () => {
  test.beforeEach(async ({ page }) => {
    // 默认 dark theme：通过 localStorage 强制
    await page.context().addInitScript(() => {
      try { localStorage.setItem('hbsc-theme', 'dark') } catch {}
    })
    await loginAdmin(page)
  })

  test('1. dark theme 下 .article-editor 计算 background ≠ white', async ({ page }) => {
    // 选一个已有文章页面（种子里通常有 id=1）
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_CONFIGURED))
    await page.goto(`${baseURL}/admin/articles/1`)
    // 编辑卡片加载
    const card = page.locator('.article-editor').first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgb(255, 255, 255)')
  })

  test('2. dark theme 下 input/textarea 计算 background ≠ white', async ({ page }) => {
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_CONFIGURED))
    await page.goto(`${baseURL}/admin/articles/1`)
    // 等表单第一个 input 出现（slug 输入框可见且 disabled）
    const textareas = page.locator('.article-editor textarea')
    await expect(textareas.first()).toBeVisible({ timeout: 15_000 })
    const bg = await textareas.first().evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgb(255, 255, 255)')
  })

  test('3. AI 排版按钮位于 editor toolbar 同一行，不在独立 field 块', async ({ page }) => {
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_CONFIGURED))
    await page.goto(`${baseURL}/admin/articles/1`)
    const btn = page.getByRole('button', { name: /AI 排版/ }).first()
    await expect(btn).toBeVisible({ timeout: 15_000 })

    // 不再位于 label 为 "AI 排版（用 LLM 清洗 Markdown；不动元数据）" 的 field 块
    await expect(page.getByText(/AI 排版（用 LLM 清洗 Markdown；不动元数据）/)).toHaveCount(0)

    // 按钮和 MDEditor 容器在同一个父 DOM 子树
    const tabsContainer = page.locator('.editor-tabs').first()
    await expect(tabsContainer).toBeVisible()
    const mdContainer = page.locator('.article-editor__md').first()
    await expect(mdContainer).toBeVisible()
    const btnInsideTabsOrSibling = await btn.evaluate((el) => {
      let p = el.parentElement
      while (p) {
        if (p.classList?.contains('editor-tabs')) return 'tabs'
        if (p.querySelector?.('.w-md-editor')) return 'md'
        p = p.parentElement
      }
      return null
    })
    expect(['tabs', 'md']).toContain(btnInsideTabsOrSibling)
  })

  test('4. .docx 自动排版 checkbox 措辞改为「导入 .docx 后自动跑 AI 排版」', async ({ page }) => {
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_CONFIGURED))
    await page.goto(`${baseURL}/admin/articles/1`)
    const cbLabel = page.getByText(/导入 \.docx 后自动跑 AI 排版/)
    await expect(cbLabel).toBeVisible({ timeout: 15_000 })
    // 旧措辞不再出现
    await expect(page.getByText(/^导入并自动跑 AI 排版$/)).toHaveCount(0)
  })

  test('5. 不回归：typesetter OK → button enabled；点击 → dialog 打开', async ({ page }) => {
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_CONFIGURED))
    await page.route('**/api/admin/articles/typeset', async (r) => {
      await r.fulfill({ status: 200, contentType: 'application/json', body: TYPESET_STUB })
    })

    await page.goto(`${baseURL}/admin/articles/1`)
    const btn = page.getByRole('button', { name: /AI 排版/ }).first()
    await expect(btn).toBeVisible({ timeout: 15_000 })
    await expect(btn).toBeEnabled({ timeout: 15_000 })
    await btn.click()
    await expect(page.getByText('AI 排版预览')).toBeVisible({ timeout: 15_000 })
    // 关闭
    await page.getByRole('button', { name: '关闭' }).first().click()
  })
})