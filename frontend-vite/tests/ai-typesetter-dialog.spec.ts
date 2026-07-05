import { test, expect } from '@playwright/test'

const adminPw = process.env.ADMIN_PW ?? 'admin123'
const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'

test.describe('AI 排版按钮 + 弹窗', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${baseURL}/admin/login`)
    await page.fill('#username', 'admin')
    await page.fill('#password', adminPw)
    await page.click('button[type=submit]')
    await page.waitForURL('**/admin')
  })

  test('未启用 AI 排版时按钮 disabled', async ({ page }) => {
    await page.goto(`${baseURL}/admin/articles/new`)
    // Wait for editor to render the AI 排版 button.
    const button = page.getByRole('button', { name: /AI 排版/ })
    await expect(button).toBeVisible({ timeout: 15_000 })
    // Default: article_typesetter.enabled=false → disabled.
    await expect(button).toBeDisabled()
  })

  test('disabled 状态下显示提示文案', async ({ page }) => {
    await page.goto(`${baseURL}/admin/articles/new`)
    const button = page.getByRole('button', { name: /AI 排版/ })
    await expect(button).toBeVisible()
    // The hint span next to the button mentions "启用" or "配置".
    await expect(page.getByText(/启用|配置/).first()).toBeVisible({ timeout: 5_000 })
  })

  test('happy-path: 启用后点按钮 → 弹窗 → 取消不改内容', async ({ page }) => {
    // 1. Override /api/admin/settings so the editor believes the typesetter is
    //    fully configured. We return one article_typesetter.* row for each
    //    key the editor queries.
    await page.route('**/api/admin/settings', async (route) => {
      const request = route.request()
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              { key: 'article_typesetter.enabled', value: 'true', masked: null, is_secret: false, description: '', updated_at: new Date().toISOString(), updated_by: '' },
              { key: 'article_typesetter.api_key',  value: null,   masked: 'sk-cp***', is_secret: true, description: '', updated_at: new Date().toISOString(), updated_by: '' },
            ],
          }),
        })
      } else {
        await route.continue()
      }
    })

    // 2. Stub the typeset endpoint so we don't hit a real LLM.
    await page.route('**/api/admin/articles/typeset', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content_markdown: '# 清洗后标题\n\n清洗后正文。',
          warnings: [],
          model: 'MiniMax-M3',
          prompt_version: '420',
        }),
      })
    })

    // 3. Open the editor and wait for the AI 排版 button to become enabled.
    await page.goto(`${baseURL}/admin/articles/new`)
    const button = page.getByRole('button', { name: /AI 排版/ })
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(button).toBeEnabled({ timeout: 15_000 })

    // 4. Type some content first so the editor isn't empty.
    const editor = page.locator('.w-md-editor-text-input, textarea').first()
    if (await editor.count()) {
      await editor.fill('# 原标题\n\n  原正文段落.  ')
    }

    // 5. Click AI 排版 — dialog should appear with both columns + apply / cancel.
    await button.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    // 用 "清洗后（Markdown）" 列标题定位 —— 它在 TypesetPreviewDialog 内
    // 是唯一元素，区别于 stub markdown 渲染出的 h1/p 节点。
    await expect(dialog.getByText('清洗后（Markdown）')).toBeVisible()
    await expect(dialog.getByText('原文', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /应用到编辑器/ })).toBeEnabled()
    // 关闭按钮（commit 3b67240 之前的版本叫"取消"，现叫"关闭"）。
    // 用 .ui-modal__footer 限定对话框底部，避开右上角 X 按钮（aria-label="关闭"）。
    const closeBtn = dialog.locator('.ui-modal__footer').getByRole('button', { name: '关闭' })
    await expect(closeBtn).toBeVisible()

    // 6. Click 关闭 — dialog closes, content should NOT change.
    await closeBtn.click()
    await expect(dialog).toBeHidden({ timeout: 5_000 })
    // Original content block should still show "# 原标题".
    await expect(page.locator('body')).toContainText('原标题')
  })
})

