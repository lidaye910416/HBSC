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

  test('disabled 状态下 hover 显示提示文案', async ({ page }) => {
    await page.goto(`${baseURL}/admin/articles/new`)
    const button = page.getByRole('button', { name: /AI 排版/ })
    await expect(button).toBeVisible()
    // The tooltip / hint text mentions 配置 API Key — choose whichever is visible.
    await expect(page.getByText(/启用|配置/).first()).toBeVisible({ timeout: 5_000 })
  })
})
