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

  test('operate-mode forwards a URL matching the configured base_url', async ({ page }) => {
    // Regression: PublicPageAgentMount used to pass a placeholder baseURL
    // ('http://placeholder.invalid/v1') which made page-agent construct
    // `http://placeholder.invalid/v1/chat/completions`. The backend's
    // is_allowed_url() rejected it as url_not_allowed. The fix: forward
    // the real `cfg.base_url` from /api/public/agent/config.
    let capturedUrl: string | null = null

    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
          system_prompt: '',
        }),
      }),
    )
    await page.route('**/api/public/agent/llm', (route) => {
      const body = JSON.parse(route.request().postData() || '{}')
      capturedUrl = body.url ?? null
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        // 'done' tool call so the agent finishes after one round-trip
        body: JSON.stringify({
          choices: [{
            message: { tool_calls: [{ function: { name: 'done', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          }],
        }),
      })
    })

    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await page.getByTestId('page-agent-input').fill('随便看看')
    await page.getByTestId('page-agent-operate-btn').click()

    await expect.poll(() => capturedUrl, { timeout: 5_000 }).not.toBeNull()
    expect(capturedUrl).toBe('https://api.deepseek.com/v1/chat/completions')
  })

  test('chat after restoring prior sessionStorage history does NOT trigger duplicate-key warning', async ({ page }) => {
    // Regression: PageAgentPanel used to hardcode `useRef(1)` for nextIdRef,
    // so on a fresh mount the id counter started at 1 even when sessionStorage
    // already contained messages with ids 1..N. The next sendAsk() would
    // re-use id=1 and React logged:
    //   "Encountered two children with the same key, `1`."
    // The fix: seed nextIdRef from `max(existing.id) + 1` on first render.
    const warnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('two children with the same key')) {
        warnings.push(msg.text())
      }
    })

    // Pre-populate sessionStorage so the panel sees history with ids 1..4.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'hbsc.page-agent.chat.history',
        JSON.stringify([
          { id: 1, role: 'user',      content: '旧问 1' },
          { id: 2, role: 'assistant', content: '旧答 1' },
          { id: 3, role: 'user',      content: '旧问 2' },
          { id: 4, role: 'assistant', content: '旧答 2' },
        ]),
      )
    })

    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
          system_prompt: '',
        }),
      }),
    )
    await page.route('**/api/public/agent/execute', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: '新回复。' }),
      }),
    )

    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })
    // Verify the restored history shows up first.
    await expect(page.getByText('旧问 1')).toBeVisible()
    await expect(page.getByText('旧答 2')).toBeVisible()
    // Now send a brand-new message — it must get id=5, not 1.
    await page.getByTestId('page-agent-input').fill('新一轮问题')
    await page.getByTestId('page-agent-ask-btn').click()
    await expect(page.getByText('新回复。')).toBeVisible({ timeout: 5_000 })

    // Drain the event loop so any React warnings surface before we assert.
    await page.waitForTimeout(300)
    expect(warnings, 'React duplicate-key warning must not be emitted').toEqual([])
  })

  test('operate-mode: two consecutive actions never surface "PageAgent has been disposed"', async ({ page }) => {
    // Invariant: the chat history must NEVER contain
    // "PageAgent has been disposed. Create a new instance." regardless
    // of how many times the config query is refetched between actions.
    //
    // The old PublicPageAgentMount used to depend the create-agent
    // effect on `[configQ.data]`, so every React Query refetch (window
    // focus, HMR, staleTime) re-ran the effect and called `a.dispose()`
    // on the previous instance — but the panel still held the stale
    // `agent` prop and the next sendOperate() threw the disposed error.
    //
    // The fix holds the agent in a ref, creates it once when config
    // is first available, and disposes only on real component unmount.
    //
    // NOTE: this is a smoke / invariant test, not a precise race
    // reproducer. The production bug is a microsecond race between
    // dispose() and React's re-render commit, which is hard to pin
    // down in a deterministic Playwright test. We assert the
    // "disposed" string must NEVER appear after any sequence of
    // operate-mode actions + config refetches — the bug's unique
    // fingerprint and the one thing the user sees in their console.
    let configHits = 0
    await page.route('**/api/public/agent/config', (route) => {
      configHits++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
          system_prompt: `n=${configHits}`,
        }),
      })
    })
    await page.route('**/api/public/agent/llm', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{
            message: { tool_calls: [{ function: { name: 'done', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          }],
        }),
      }),
    )

    await page.goto('/')
    expect(configHits).toBeGreaterThanOrEqual(1)
    await page.getByTestId('page-agent-fab').click({ force: true })

    // Drive the production trigger: force a config refetch via the
    // dev-only window hook (added in App.tsx), then click "让他操作"
    // twice. With the BUG, the second click lands on a disposed agent.
    // With the FIX, the agent is the same instance across refetches.
    for (let i = 1; i <= 2; i++) {
      await page.getByTestId('page-agent-input').fill(`第${i}条任务`)
      await page.getByTestId('page-agent-operate-btn').click()
      // Wait for the agent to settle (LLM round-trips, retries, chat write).
      await page.waitForTimeout(2_500)

      // Force a config refetch between actions (mimics window-focus /
      // HMR / staleTime auto-refetch — the production trigger).
      if (i < 2) {
        await page.evaluate(() => {
          const w = window as unknown as { __hbsc_query?: { invalidateQueries: (q: { queryKey: string[] }) => Promise<unknown> } }
          void w.__hbsc_query?.invalidateQueries({ queryKey: ['public', 'agent', 'config'] })
        })
        await expect.poll(() => configHits, { timeout: 3_000 }).toBeGreaterThan(i)
      }
    }

    // The bug's unique fingerprint is this exact string. If it ever
    // appears in the chat history, the agent lifecycle broke.
    await expect(page.getByText(/PageAgent has been disposed/)).toHaveCount(0)
  })

  test('operate-mode: auto-recovers when the session is disposed between actions', async ({ page }) => {
    // Regression for the "second operate fails after first" bug.
    //
    // Production trigger: Vite HMR or React Fast Refresh updates
    // PublicPageAgentMount during a session, which previously fired
    // the unmount cleanup that called agent.dispose(). The panel still
    // held the stale `agent` prop, so the next agent.execute() threw
    // "PageAgent has been disposed".
    //
    // The fix: PageAgentSession is a module-level singleton (immune
    // to component lifecycle) and PageAgentPanel.sendOperate catches
    // the disposed error and requests a fresh agent via acquire().
    //
    // This test forces the failure deterministically by calling
    // disposeSession() (the module-level singleton's dispose fn)
    // between two operates, then asserts the second operate succeeds.

    let llmCalls = 0
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
          system_prompt: '',
        }),
      }),
    )
    await page.route('**/api/public/agent/llm', (route) => {
      llmCalls++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  // Alternate done / click so each operate takes one round-trip
                  name: llmCalls % 2 === 1 ? 'done' : 'AgentOutput',
                  arguments: llmCalls % 2 === 1
                    ? JSON.stringify({ text: 'OK', success: true })
                    : JSON.stringify({
                        evaluation_previous_goal: 'noop',
                        memory: 'noop',
                        next_goal: 'noop',
                        action: { done: { text: 'OK', success: true } },
                      }),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }),
      })
    })

    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })

    // First operate: should succeed
    await page.getByTestId('page-agent-input').fill('第一轮')
    await page.getByTestId('page-agent-operate-btn').click()
    await expect(page.getByText(/已完成/).first()).toBeVisible({ timeout: 8_000 })

    // Force the dispose — this is what HMR / component remount would do
    await page.evaluate(async () => {
      const mod = (await import('/src/lib/pageAgentSession.ts')) as {
        disposeSession: () => void
      }
      mod.disposeSession()
    })

    // Second operate: with the bug, this throws "PageAgent has been
    // disposed" and shows up as an error in the chat. With the fix,
    // sendOperate catches the disposed error, calls acquire() to get a
    // fresh agent, and retries — so it succeeds.
    await page.getByTestId('page-agent-input').fill('第二轮')
    await page.getByTestId('page-agent-operate-btn').click()
    await expect(page.getByText(/已完成/).first()).toBeVisible({ timeout: 8_000 })
    // Two "已完成" messages should now exist in the chat history
    await expect(page.getByText(/已完成/)).toHaveCount(2, { timeout: 5_000 })

    // The disposed error string must NEVER appear
    await expect(page.getByText(/PageAgent has been disposed/)).toHaveCount(0)
  })
})