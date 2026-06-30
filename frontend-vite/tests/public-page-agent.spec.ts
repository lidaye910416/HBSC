import { test, expect } from '@playwright/test'

test.describe('public page-agent FAB', () => {
  test('FAB appears on homepage after admin enables + key is set', async ({ page }) => {
    // Intercept /api/public/agent/config to simulate enabled=true.
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    await page.goto('/')
    const fab = page.getByTestId('page-agent-fab')
    await expect(fab).toBeVisible({ timeout: 5_000 })
  })

  test('clicking FAB shows dual-mode panel with two buttons', async ({ page }) => {
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await expect(page.getByTestId('page-agent-panel')).toBeVisible()
    await expect(page.getByTestId('page-agent-ask-btn')).toBeVisible()
    await expect(page.getByTestId('page-agent-operate-btn')).toBeVisible()
  })

  test('chat-mode submit posts to /api/public/agent/execute', async ({ page }) => {
    let executeCalled = 0
    let llmCalled = 0

    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    await page.route('**/api/public/agent/execute', (route) => {
      executeCalled++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: '你好，这里是湖北数创期刊。' }),
      })
    })
    await page.route('**/api/public/agent/llm', (route) => {
      llmCalled++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [
            { message: { tool_calls: [{ function: { name: 'done', 'arguments': '{}' } }] }, finish_reason: 'tool_calls' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      })
    })

    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await page.getByTestId('page-agent-input').fill('期刊是关于什么的')
    await page.getByTestId('page-agent-ask-btn').click()

    await expect(page.getByText('你好，这里是湖北数创期刊。')).toBeVisible({ timeout: 5_000 })
    expect(executeCalled).toBe(1)
    expect(llmCalled).toBe(0)   // chat path must NOT call /agent/llm
  })

  test('chat-mode failure surfaces inline error toast', async ({ page }) => {
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    await page.route('**/api/public/agent/execute', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'rate_limited', message: '请求过于频繁，请稍后重试' },
        }),
      }),
    )
    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await page.getByTestId('page-agent-input').fill('hi')
    await page.getByTestId('page-agent-ask-btn').click()
    await expect(page.getByText(/请求过于频繁/).first()).toBeVisible({ timeout: 5_000 })
  })

  test('FAB does NOT contain Authorization header in any network call', async ({ page }) => {
    let foundKeyLeak = false
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    page.on('request', (req) => {
      const auth = req.headers()['authorization'] || ''
      if (auth && auth.startsWith('Bearer sk-')) foundKeyLeak = true
    })
    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await page.getByTestId('page-agent-input').fill('hi')
    await page.getByTestId('page-agent-ask-btn').click()
    await page.waitForTimeout(2_000)
    expect(foundKeyLeak).toBe(false)
  })

  test('Admin dashboard does NOT render page-agent FAB', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('page-agent-fab')).toHaveCount(0)
  })
})