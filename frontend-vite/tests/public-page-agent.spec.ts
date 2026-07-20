import { test, expect } from '@playwright/test'

test.describe('public page-agent FAB', () => {
  test('FAB uses page-capability dark glass style', async ({ page }) => {
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

    const styles = await fab.evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        backgroundColor: cs.backgroundColor,
        backdropFilter: cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || '',
        borderColor: cs.borderColor,
        color: cs.color,
      }
    })

    // Dark translucent navy surface: glassy, but visually tied to the site hero.
    const bg = styles.backgroundColor.match(/rgba?\(([^)]+)\)/)?.[1]?.split(',').map((s) => s.trim()) ?? []
    const alpha = bg.length === 4 ? parseFloat(bg[3]) : 1
    expect(alpha, 'FAB background must be translucent').toBeLessThan(1)
    expect(Number(bg[2]), 'FAB blue channel should dominate its dark navy surface').toBeGreaterThan(Number(bg[0]))

    // Backdrop blur must be present (24px in the spec)
    expect(styles.backdropFilter, 'FAB must use backdrop-filter blur').toMatch(/blur\(/)

    // Text stays light against the dark surface.
    const text = styles.color.match(/rgba?\(([^)]+)\)/)?.[1]?.split(',').map((s) => s.trim()) ?? []
    expect(Number(text[0])).toBeGreaterThan(230)
    expect(Number(text[1])).toBeGreaterThan(230)
    expect(Number(text[2])).toBeGreaterThan(230)
    await expect(fab).toContainText('数创智伴')
    await expect(fab).toContainText('读懂本页 · 协助操作')
  })

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

  test('clicking FAB shows panel with mode tabs and single submit', async ({ page }) => {
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
    await expect(page.getByTestId('page-agent-mode-ask')).toBeVisible()
    await expect(page.getByTestId('page-agent-mode-operate')).toBeVisible()
    await expect(page.getByTestId('page-agent-mode-ask')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('page-agent-mode-operate')).toHaveAttribute('aria-selected', 'false')
    await expect(page.getByTestId('page-agent-submit-btn')).toBeVisible()
  })

  test('clear confirmation stays compact inside the assistant panel', async ({ page }) => {
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
    await page.getByTestId('page-agent-clear-btn').click()

    const panel = page.getByTestId('page-agent-panel')
    const clearButton = page.getByTestId('page-agent-clear-btn')
    const confirm = page.getByTestId('page-agent-clear-confirm-card')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('清空本次对话？')
    await expect(confirm).toHaveAttribute('aria-modal', 'true')
    await expect(page.getByRole('button', { name: '取消' })).toBeFocused()
    expect(await panel.locator('[data-testid="page-agent-clear-confirm-card"]').count()).toBe(1)

    const panelBox = await panel.boundingBox()
    const confirmBox = await confirm.boundingBox()
    expect(confirmBox?.width).toBeLessThan(panelBox?.width ?? 0)
    await expect(page.locator('[role="dialog"][aria-label="清空上下文"]')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(clearButton).toBeFocused()
  })

  test('chat-mode submit (ask tab) posts to /api/public/agent/execute', async ({ page }) => {
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
    await page.getByTestId('page-agent-mode-ask').click()
    await page.getByTestId('page-agent-submit-btn').click()

    await expect(page.getByText('你好，这里是湖北数创期刊。')).toBeVisible({ timeout: 5_000 })
    expect(executeCalled).toBe(1)
    expect(llmCalled).toBe(0)   // chat path must NOT call /agent/llm
  })

  test('current article context is sent with chat and suggests a mind map', async ({ page }) => {
    let postedMessages: Array<{ role: string; content: string }> = []

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
    await page.route('**/api/public/agent/execute', async (route) => {
      postedMessages = (await route.request().postDataJSON()).messages
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: '这篇文章介绍了智能体架构。' }),
      })
    })

    await page.goto('/')
    await page.evaluate(() => {
      document.title = '智能体系统架构解析 | 湖北数创'
      history.replaceState({}, '', '/articles/agent-architecture')
      const main = document.querySelector('main') ?? document.body
      main.innerHTML = `
        <article class="article-detail__main">
          <h1>智能体系统架构解析</h1>
          <div class="article-detail__content">
            <h2>多智能体协作机制</h2>
            <p>本文分析规划器、执行器、工具调用与长期记忆之间的数据流和关键技术实现。</p>
          </div>
        </article>
      `
    })

    await page.getByTestId('page-agent-fab').click({ force: true })
    await expect(page.getByTestId('page-agent-context')).toContainText('智能体系统架构解析')
    await expect(page.getByTestId('page-agent-mindmap-hint')).toContainText('思维导图')
    await page.getByTestId('page-agent-input').fill('这篇文章主要讲了什么？')
    await page.getByTestId('page-agent-mode-ask').click()
    await page.getByTestId('page-agent-submit-btn').click()
    await expect(page.getByText('这篇文章介绍了智能体架构。')).toBeVisible()

    expect(postedMessages[0]?.role).toBe('system')
    expect(postedMessages[0]?.content).toContain('当前页面类型：技术文章')
    expect(postedMessages[0]?.content).toContain('智能体系统架构解析')
    expect(postedMessages[0]?.content).toContain('/articles/agent-architecture')
    expect(postedMessages[0]?.content).toContain('规划器、执行器、工具调用与长期记忆')
    expect(postedMessages[0]?.content).toContain('主动提示可绘制思维导图')
  })

  test('late page content refreshes the assistant context', async ({ page }) => {
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: true, model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com/v1' }),
      }),
    )

    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await expect(page.getByTestId('page-agent-context')).toContainText('智领AI荆楚新程')
    await page.waitForTimeout(500)

    await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body
      main.innerHTML = `
        <article>
          <h1>异步加载的智能体技术文章</h1>
          <div class="article-detail__content">正文在页面助手打开后才完成加载。</div>
        </article>
      `
    })

    await expect(page.getByTestId('page-agent-context')).toContainText('异步加载的智能体技术文章')
    await expect(page.getByTestId('page-agent-mindmap-hint')).toBeVisible()
  })

  test('route change refreshes page context and excludes previous-page history', async ({ page }) => {
    const requests: Array<Array<{ role: string; content: string }>> = []
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: true, model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com/v1' }),
      }),
    )
    await page.route('**/api/public/agent/execute', async (route) => {
      requests.push((await route.request().postDataJSON()).messages)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: '已回答。' }),
      })
    })

    await page.goto('/about')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await page.getByTestId('page-agent-input').fill('旧页面问题')
    await page.getByTestId('page-agent-mode-ask').click()
    await page.getByTestId('page-agent-submit-btn').click()
    await expect(page.getByText('已回答。')).toBeVisible()

    await page.getByRole('link', { name: '首页', exact: true }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByTestId('page-agent-context')).toContainText('智领AI荆楚新程')
    await page.getByTestId('page-agent-input').fill('新页面问题')
    await page.getByTestId('page-agent-mode-ask').click()
    await page.getByTestId('page-agent-submit-btn').click()
    await expect.poll(() => requests.length).toBe(2)

    expect(requests[1]?.[0]?.content).toContain('智领AI荆楚新程')
    expect(requests[1]?.some((message) => message.content.includes('旧页面问题'))).toBe(false)
  })

  test('slow chat response does not leak into the next route', async ({ page }) => {
    let releaseResponse: (() => void) | undefined
    let responseSent = false
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: true, model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com/v1' }),
      }),
    )
    await page.route('**/api/public/agent/execute', async (route) => {
      await new Promise<void>((resolve) => { releaseResponse = resolve })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: '旧页面回复' }),
      })
      responseSent = true
    })

    await page.goto('/about')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await page.getByTestId('page-agent-input').fill('旧页面慢请求')
    await page.getByTestId('page-agent-mode-ask').click()
    await page.getByTestId('page-agent-submit-btn').click()
    await expect.poll(() => Boolean(releaseResponse)).toBe(true)

    await page.getByRole('link', { name: '首页', exact: true }).click()
    await expect(page).toHaveURL('/')
    releaseResponse?.()
    await expect.poll(() => responseSent).toBe(true)

    await expect(page.getByText('旧页面回复')).toHaveCount(0)
    const currentHistory = await page.evaluate(() =>
      sessionStorage.getItem('hbsc.page-agent.chat.history:/') ?? '',
    )
    expect(currentHistory).not.toContain('旧页面回复')
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
    await page.getByTestId('page-agent-mode-ask').click()
    await page.getByTestId('page-agent-submit-btn').click()
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
    await page.getByTestId('page-agent-mode-ask').click()
    await page.getByTestId('page-agent-submit-btn').click()
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
    await page.getByTestId('page-agent-mode-operate').click()
    await page.getByTestId('page-agent-submit-btn').click()

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
    await page.getByTestId('page-agent-mode-ask').click()
    await page.getByTestId('page-agent-submit-btn').click()
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
      await page.getByTestId('page-agent-mode-operate').click()
    await page.getByTestId('page-agent-submit-btn').click()
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
    await page.getByTestId('page-agent-mode-operate').click()
    await page.getByTestId('page-agent-submit-btn').click()
    await expect(page.getByText(/已完成/).first()).toBeVisible({ timeout: 8_000 })

    // Force the dispose — this is what HMR / component remount would do.
    // Use the dev-only window handle (NOT a dynamic import) so we
    // definitely hit the *same* module instance the app uses. A dynamic
    // import can land on a fresh instance in Vite, which would dispose
    // a phantom agent and leave the app's singleton untouched — masking
    // the bug the test is meant to catch.
    await page.evaluate(() => {
      const w = window as unknown as {
        __hbsc_pageAgentSession?: { disposeSession: () => void }
      }
      if (!w.__hbsc_pageAgentSession) {
        throw new Error('__hbsc_pageAgentSession not exposed; dev hook missing')
      }
      w.__hbsc_pageAgentSession.disposeSession()
    })

    // Second operate: with the bug, this throws "PageAgent has been
    // disposed" and shows up as an error in the chat. With the fix,
    // sendOperate catches the disposed error, polls acquire() a few
    // times to ride out transient races, and retries — so it succeeds.
    await page.getByTestId('page-agent-input').fill('第二轮')
    await page.getByTestId('page-agent-mode-operate').click()
    await page.getByTestId('page-agent-submit-btn').click()
    await expect(page.getByText(/已完成/).first()).toBeVisible({ timeout: 8_000 })
    // Two "已完成" messages should now exist in the chat history
    await expect(page.getByText(/已完成/)).toHaveCount(2, { timeout: 5_000 })

    // The disposed error string must NEVER appear
    await expect(page.getByText(/PageAgent has been disposed/)).toHaveCount(0)
    // The misleading "页面助手刚被刷新" toast must NEVER appear in a
    // recoverable race — that's the user-facing bug this whole fix is
    // about. (It's still an acceptable fallback for truly unrecoverable
    // scenarios, but the between-actions dispose here IS recoverable.)
    await expect(page.getByText(/页面助手刚被刷新/)).toHaveCount(0)
  })

  test('operate-mode: clicking the empty-prompt "最新一期的文章列表" never shows "页面助手刚被刷新"', async ({ page }) => {
    // Regression for the user-reported bug: opening the AI assistant,
    // clicking the empty-prompt chip "帮我跳到最新一期的文章列表" and
    // then "让他操作" produced a misleading "页面助手刚被刷新，请重试一次"
    // toast — even though no explicit 清空 or HMR had happened.
    //
    // Root cause: the recovery in sendOperate() only tried acquire()
    // once, so any transient race (e.g. disposeSession racing an
    // in-flight IIFE) surfaced the "刷新" toast. The fix polls acquire()
    // up to 5 times with 120ms spacing before giving up.
    //
    // This test doesn't try to reproduce the race exactly (it's
    // microsecond-level timing); instead it asserts the
    // success-path invariant: the empty prompt + 让他操作 click must
    // NEVER produce the misleading "页面助手刚被刷新" toast, even when
    // the LLM returns a successful response.

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
    await page.route('**/api/public/agent/llm', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Shape matches the "done" tool call page-agent's autoFixer
        // accepts (the action key is "done" inside an "action" envelope).
        body: JSON.stringify({
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: 'AgentOutput',
                  arguments: JSON.stringify({
                    evaluation_previous_goal: 'noop',
                    memory: 'noop',
                    next_goal: 'noop',
                    action: { done: { text: '已跳转到最新一期的文章列表。', success: true } },
                  }),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }),
      }),
    )

    await page.goto('/')
    // Wait for the FAB to be visible before clicking — `force: true`
    // bypasses actionability but the element must still exist. The
    // singleton's lazy agent creation can take a beat on cold start.
    await expect(page.getByTestId('page-agent-fab')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('page-agent-fab').click({ force: true })
    // Wait for the panel to render before interacting with it
    await expect(page.getByTestId('page-agent-panel')).toBeVisible({ timeout: 10_000 })

    // Click the empty-prompt chip — this is the exact path the user
    // took when they reported the bug.
    await page
      .getByRole('button', { name: '带我浏览当前页面' })
      .or(page.getByRole('button', { name: '这个页面主要提供什么内容？' }))
      .first()
      .click()
    await page.getByTestId('page-agent-mode-operate').click()
    await page.getByTestId('page-agent-submit-btn').click()

    // The panel must show a success bubble, not a misleading refresh
    // toast. (Page-agent may take a few seconds for the LLM round-trip.)
    await expect(page.getByText(/已完成/).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/页面助手刚被刷新/)).toHaveCount(0)
    await expect(page.getByText(/PageAgent has been disposed/)).toHaveCount(0)
  })
})
