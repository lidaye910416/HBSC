# Page-Agent "Clear Context" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmation-gated "清空" button to the page-agent footer that clears the chat history UI, sessionStorage, input, error state, AND disposes the page-agent LLM context.

**Architecture:** New third button in `PageAgentPanel.tsx` footer (sibling to "问他" / "让他操作"). Click opens a project-standard `Modal` confirming the destructive action. On confirm: reset local state, `sessionStorage.removeItem`, and `disposeSession()` from `pageAgentSession.ts` (the singleton's existing dispose path used by the 5+ previous lifecycle fixes). Singleton re-acquires on next operate.

**Tech Stack:** React + Vite, project-internal `Modal.tsx`, `pageAgentSession.ts`, lucide-react `Trash2` icon, Playwright for e2e.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `frontend-vite/src/components/ai/PageAgentPanel.tsx` | Modify | Add footer button + Modal state + `handleClear` |
| `frontend-vite/tests/public-page-agent.spec.ts` | Modify | Add 3 regression tests (button presence, cancel, confirm) |

No backend changes. No new files. The existing `Modal.tsx` provides all confirmation UI.

---

## Task 1: Add the failing Playwright test

**Files:**
- Modify: `frontend-vite/tests/public-page-agent.spec.ts` (append after the existing `auto-recovers when the session is disposed` test, around line 510)

- [ ] **Step 1.1: Append the test block**

Insert after the closing `})` of the auto-recovers test (line 510 area):

```typescript
  test('operate-mode: 清空 button shows confirmation modal', async ({ page }) => {
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
    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await expect(page.getByTestId('page-agent-clear-btn')).toBeVisible()
  })

  test('operate-mode: 清空 → 取消 keeps history intact', async ({ page }) => {
    // Pre-populate sessionStorage so the panel shows restored history.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'hbsc.page-agent.chat.history',
        JSON.stringify([
          { id: 1, role: 'user',      content: '保留这条' },
          { id: 2, role: 'assistant', content: '保留这条回答' },
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
    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })
    await expect(page.getByText('保留这条')).toBeVisible()

    await page.getByTestId('page-agent-clear-btn').click()
    // Modal opens
    await expect(page.getByText('确定要清空上下文吗')).toBeVisible()
    // Click cancel
    await page.getByRole('button', { name: '取消' }).click()
    // Modal closes; history preserved
    await expect(page.getByText('确定要清空上下文吗')).toHaveCount(0)
    await expect(page.getByText('保留这条')).toBeVisible()
    // sessionStorage NOT cleared
    const stored = await page.evaluate(() =>
      sessionStorage.getItem('hbsc.page-agent.chat.history'),
    )
    expect(stored).toContain('保留这条')
  })

  test('operate-mode: 清空 → 确认 clears UI, sessionStorage, and disposes session', async ({ page }) => {
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
            message: { tool_calls: [{ function: { name: 'done', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          }],
        }),
      })
    })

    await page.goto('/')
    await page.getByTestId('page-agent-fab').click({ force: true })

    // Drive one operate so sessionStorage + agent.history have content.
    await page.getByTestId('page-agent-input').fill('第一条任务')
    await page.getByTestId('page-agent-operate-btn').click()
    await expect(page.getByText(/已完成/).first()).toBeVisible({ timeout: 8_000 })
    const callsBefore = llmCalls

    // Open confirm modal and confirm.
    await page.getByTestId('page-agent-clear-btn').click()
    await expect(page.getByText('确定要清空上下文吗')).toBeVisible()
    await page.getByRole('button', { name: '确认清空' }).click()

    // Modal closes.
    await expect(page.getByText('确定要清空上下文吗')).toHaveCount(0)
    // History cleared.
    await expect(page.getByText('已完成')).toHaveCount(0)
    // sessionStorage cleared.
    const stored = await page.evaluate(() =>
      sessionStorage.getItem('hbsc.page-agent.chat.history'),
    )
    // null OR "[]" both acceptable (depending on whether panel re-runs persist effect)
    expect(stored === null || stored === '[]').toBe(true)

    // Subsequent operate hits /llm again — proves a new agent was acquired.
    await page.getByTestId('page-agent-input').fill('清空后第一条')
    await page.getByTestId('page-agent-operate-btn').click()
    await expect(page.getByText(/已完成/).first()).toBeVisible({ timeout: 8_000 })
    expect(llmCalls).toBeGreaterThan(callsBefore)
  })
```

- [ ] **Step 1.2: Run the new tests to verify RED**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite
BASE_URL=http://localhost:5173 npx playwright test tests/public-page-agent.spec.ts -g "清空" --reporter=list
```

Expected: 3 failed (button missing, cancel missing, confirm missing).

---

## Task 2: Implement the button + Modal + handler

**Files:**
- Modify: `frontend-vite/src/components/ai/PageAgentPanel.tsx`

- [ ] **Step 2.1: Add imports**

Replace the existing import block (lines 1-7):

```tsx
import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquare, Sparkles, Trash2, X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../../services/api'
import { PageAgent } from 'page-agent'
import { acquire, disposeSession, isRecoverableDisposedError } from '../../lib/pageAgentSession'
import { Modal } from '../ui/Modal'
import styles from './PageAgentPanel.module.css'
```

Note: existing import was `import { acquire, isRecoverableDisposedError }`. We add `disposeSession` and the new imports.

- [ ] **Step 2.2: Add Modal state + handler**

Inside `PageAgentPanel` function body, after the existing `useEffect(() => {...}, [history])` (around line 61), add:

```tsx
  // Clear-context confirmation modal.
  const [clearOpen, setClearOpen] = useState(false)

  function handleClearConfirm() {
    setHistory([])
    setText('')
    setError(null)
    setOperating(false)
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* quota / disabled */
    }
    disposeSession()
    // Singleton auto-reacquires on next operate via the existing
    // PublicPageAgentMount auto-recover effect.
    setClearOpen(false)
  }
```

- [ ] **Step 2.3: Add the button to the footer actions**

Find the existing footer actions block (around lines 237-258). After the `让他操作` button, add a third button:

```tsx
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={() => void sendAsk()}
            disabled={!text.trim() || chatMut.isPending || operating}
            data-testid="page-agent-ask-btn"
          >
            <MessageSquare size={14} />
            问他
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void sendOperate()}
            disabled={!text.trim() || chatMut.isPending || operating}
            data-testid="page-agent-operate-btn"
          >
            <Sparkles size={14} />
            让他操作
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => setClearOpen(true)}
            disabled={operating || chatMut.isPending}
            aria-label="清空上下文"
            data-testid="page-agent-clear-btn"
          >
            <Trash2 size={14} />
            清空
          </button>
        </div>
```

- [ ] **Step 2.4: Add the Modal at the end of the panel JSX**

Find the closing `</div>` of the panel root (around line 261). Just before that closing tag, add:

```tsx
      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="清空上下文"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => setClearOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleClearConfirm}
              data-testid="page-agent-clear-confirm"
            >
              确认清空
            </button>
          </>
        }
      >
        <p>确定要清空上下文吗？这将清除当前对话和 LLM 的记忆，无法撤销。</p>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2.5: Verify TypeScript compiles**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite
npx tsc --noEmit
```

Expected: clean exit, no errors.

- [ ] **Step 2.6: Run the new tests to verify GREEN**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite
BASE_URL=http://localhost:5173 npx playwright test tests/public-page-agent.spec.ts -g "清空" --reporter=list
```

Expected: 3 passed.

- [ ] **Step 2.7: Full regression run**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite
BASE_URL=http://localhost:5173 npx playwright test tests/public-page-agent.spec.ts --reporter=list
```

Expected: 15 passed (12 existing + 3 new).

- [ ] **Step 2.8: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/ai/PageAgentPanel.tsx frontend-vite/tests/public-page-agent.spec.ts
git commit -m "feat(frontend): page-agent clear-context button with confirmation modal"
```

---

## Self-Review

1. **Spec coverage:** Every requirement from the brainstorm is covered:
   - Clear UI history → `setHistory([])` ✓
   - Clear sessionStorage → `sessionStorage.removeItem` ✓
   - Clear LLM context → `disposeSession()` ✓
   - Third button in footer → Step 2.3 ✓
   - Confirmation modal → Step 2.4 ✓
   - Disabled while operate in progress → Step 2.3 `disabled` ✓

2. **Placeholder scan:** No TBDs, TODOs, or vague references. Every code block is complete.

3. **Type consistency:** `data-testid="page-agent-clear-btn"` used in both test and impl. `disposeSession` imported from the same module the test already exercises.

4. **No backend changes needed** — confirmed by brainstorming step 5.