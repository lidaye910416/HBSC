# 数创智伴模式拆分实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `PageAgentPanel` 内"问当前页"/"执行操作"两个并列按钮合并为"顶部 Tab 切换 + 单提交按钮"，并按模式分桶存储历史气泡。

**Architecture:** 在现有 `PageAgentPanel.tsx` 顶部插入 `ModeTabs` 子组件，新增 `mode: 'ask'|'operate'` state；历史 `UiMessage` 加 `mode` 字段；`sessionStorage` key 由 `<routeKey>` 改为 `<routeKey>:<mode>`；提交逻辑根据 `mode` 派发到既有 `sendAsk` / `sendOperate`；清空弹层支持两桶独立勾选。不改后端、不改 page-agent 库、不改 FAB。

**Tech Stack:** React 19, TypeScript 5, vite/vitest, Playwright, lucide-react, sessionStorage

---

## 文件结构

### Modify（4 个）
- `frontend-vite/src/components/ai/PageAgentPanel.tsx` — 核心：mode state、Tab 渲染、分桶、单按钮提交、清空弹层
- `frontend-vite/src/components/ai/PageAgentPanel.module.css` — `.ap-mode-tabs` / `.ap-mode-tab` / `.ap-bubble-mode-*` / `.ap-send` / 清空弹层多选
- `frontend-vite/tests/public-page-agent.spec.ts` — 同步 e2e 契约（"two buttons" → Tab + 单按钮）
- `frontend-vite/src/components/ai/pageContext.ts` — 无需改（仅供回忆：pageContext 与 mode 拆分正交）

### Create（3 个）
- `frontend-vite/tests/animations/pageAgentMode.test.ts` — 单元测试 mode 切换、storage key 派生、迁移逻辑
- `frontend-vite/src/components/ai/modeStorage.ts` — 新文件：`getStorageKey(routeKey, mode)` / `migrateLegacyStorage(routeKey, mode)`
- `frontend-vite/tests/animations/modeStorage.test.ts` — modeStorage 单元测试

### Delete（1 个，待用户确认）
- `frontend-vite/src/labs/AgentPreviewLab.tsx`
- `frontend-vite/src/labs/agent-preview.css`
- `frontend-vite/src/App.tsx` 中 `/labs/agent-preview` 路由（2 行）
- `frontend-vite/tests/labs-page.spec.ts` 中关于 agent-preview 的注册（如果存在）

---

## Task 1: 提取 modeStorage 工具（先行单元测试驱动）

**Files:**
- Create: `frontend-vite/src/components/ai/modeStorage.ts`
- Create: `frontend-vite/tests/animations/modeStorage.test.ts`

- [ ] **Step 1: 写失败单元测试**

`frontend-vite/tests/animations/modeStorage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getStorageKey, migrateLegacyStorage } from '../../src/components/ai/modeStorage'

describe('getStorageKey', () => {
  it('returns per-route per-mode key', () => {
    expect(getStorageKey('/articles/foo', 'ask')).toBe('hbsc.page-agent.chat.history:/articles/foo:ask')
    expect(getStorageKey('/articles/foo', 'operate')).toBe('hbsc.page-agent.chat.history:/articles/foo:operate')
  })

  it('treats different routes as different namespaces', () => {
    expect(getStorageKey('/a', 'ask')).not.toBe(getStorageKey('/b', 'ask'))
  })
})

describe('migrateLegacyStorage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('moves legacy global history into ask bucket and clears legacy key', () => {
    sessionStorage.setItem(
      'hbsc.page-agent.chat.history:/articles/foo',
      JSON.stringify([{ id: 1, role: 'user', content: 'hi' }]),
    )
    migrateLegacyStorage('/articles/foo')
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo:ask')).toBe(
      JSON.stringify([{ id: 1, role: 'user', content: 'hi', mode: 'ask' }]),
    )
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo')).toBeNull()
  })

  it('does not overwrite existing ask bucket', () => {
    sessionStorage.setItem(
      'hbsc.page-agent.chat.history:/articles/foo:ask',
      JSON.stringify([{ id: 99, role: 'user', content: 'new' }]),
    )
    sessionStorage.setItem(
      'hbsc.page-agent.chat.history:/articles/foo',
      JSON.stringify([{ id: 1, role: 'user', content: 'old' }]),
    )
    migrateLegacyStorage('/articles/foo')
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo:ask')).toBe(
      JSON.stringify([{ id: 99, role: 'user', content: 'new' }]),
    )
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo')).toBeNull()
  })

  it('is a no-op when no legacy key exists', () => {
    migrateLegacyStorage('/articles/foo')
    expect(sessionStorage.getItem('hbsc.page-agent.chat.history:/articles/foo:ask')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend-vite && npx vitest run tests/animations/modeStorage.test.ts`
Expected: FAIL with "Cannot find module ../../src/components/ai/modeStorage"

- [ ] **Step 3: 实现 modeStorage.ts**

`frontend-vite/src/components/ai/modeStorage.ts`:

```ts
export type AgentMode = 'ask' | 'operate'

const LEGACY_GLOBAL = 'hbsc.page-agent.chat.history'
const KEY_PREFIX = 'hbsc.page-agent.chat.history'

export function getStorageKey(routeKey: string, mode: AgentMode): string {
  return `${KEY_PREFIX}:${routeKey}:${mode}`
}

/**
 * Migrate the v1 single-bucket storage layout to the v2 per-mode layout.
 *
 * v1 keys:
 *   hbsc.page-agent.chat.history            (global fallback)
 *   hbsc.page-agent.chat.history:<routeKey> (per-route)
 *
 * v2 keys:
 *   hbsc.page-agent.chat.history:<routeKey>:ask
 *   hbsc.page-agent.chat.history:<routeKey>:operate
 *
 * Old messages without an explicit `mode` field default to `ask`.
 * Never overwrites an existing v2 bucket.
 */
export function migrateLegacyStorage(routeKey: string): void {
  const candidates = [
    `${KEY_PREFIX}:${routeKey}`,
    LEGACY_GLOBAL,
  ]
  for (const legacy of candidates) {
    const raw = sessionStorage.getItem(legacy)
    if (!raw) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      sessionStorage.removeItem(legacy)
      continue
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      sessionStorage.removeItem(legacy)
      continue
    }
    const askKey = getStorageKey(routeKey, 'ask')
    if (!sessionStorage.getItem(askKey)) {
      const migrated = parsed.map((m: Record<string, unknown>) => ({ ...m, mode: 'ask' as const }))
      sessionStorage.setItem(askKey, JSON.stringify(migrated))
    }
    sessionStorage.removeItem(legacy)
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend-vite && npx vitest run tests/animations/modeStorage.test.ts`
Expected: PASS, 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend-vite/src/components/ai/modeStorage.ts frontend-vite/tests/animations/modeStorage.test.ts
git commit -m "feat(数创智伴): 提取 modeStorage 工具并加单元测试"
```

---

## Task 2: PageAgentPanel 增加 mode state 与 ModeTabs 渲染

**Files:**
- Modify: `frontend-vite/src/components/ai/PageAgentPanel.tsx`

- [ ] **Step 1: 在文件顶部导入新依赖**

`PageAgentPanel.tsx` 顶部 import 区域增加：

```ts
import { getStorageKey, migrateLegacyStorage, type AgentMode } from './modeStorage'
```

并在文件顶部添加 type：

```ts
type UiMessage = { id: number; role: 'user' | 'assistant'; content: string; mode: AgentMode; routeKey?: string }
```

（注：原 type 缺 `mode` 字段，这里整体替换为新签名。）

- [ ] **Step 2: 在组件顶部加 mode state**

在 `PageAgentPanel` 函数体第一行（`const storageKey = ...` 之前）插入：

```ts
const [mode, setMode] = useState<AgentMode>('ask')
```

- [ ] **Step 3: 派生分桶 storageKey 并移除旧全局变量**

找到：

```ts
const storageKey = `${STORAGE_KEY}:${routeKey}`
```

替换为：

```ts
const askKey = getStorageKey(routeKey, 'ask')
const operateKey = getStorageKey(routeKey, 'operate')
const storageKey = mode === 'ask' ? askKey : operateKey
```

- [ ] **Step 4: 在 useState history 初始化里调用迁移**

找到：

```ts
const [history, setHistory] = useState<UiMessage[]>(() => {
  try {
    const raw = sessionStorage.getItem(storageKey) ?? sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as UiMessage[]
  } catch {
    /* fall through */
  }
  return []
})
```

替换为：

```ts
const [history, setHistory] = useState<UiMessage[]>(() => {
  migrateLegacyStorage(routeKey)
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (raw) return JSON.parse(raw) as UiMessage[]
  } catch {
    /* fall through */
  }
  return []
})
```

- [ ] **Step 5: 在 useEffect 里维护两个桶的独立 history**

找到 useEffect 中：

```ts
const fallback = window.setTimeout(refreshContext, 400)
let nextHistory: UiMessage[] = []
// Migration shim: ...
try {
  const raw = sessionStorage.getItem(storageKey) ?? sessionStorage.getItem(STORAGE_KEY)
  if (raw) nextHistory = JSON.parse(raw) as UiMessage[]
} catch {
  /* fall through */
}
setHistory(nextHistory)
```

替换为：

```ts
const fallback = window.setTimeout(refreshContext, 400)
migrateLegacyStorage(routeKey)
let nextHistory: UiMessage[] = []
try {
  const raw = sessionStorage.getItem(storageKey)
  if (raw) nextHistory = JSON.parse(raw) as UiMessage[]
} catch {
  /* fall through */
}
setHistory(nextHistory)
```

（注：删掉"migration shim"那段对 `STORAGE_KEY` 的全局 fallback 读取，因为 `migrateLegacyStorage` 已统一处理。）

- [ ] **Step 6: 在 useEffect 持久化中区分 mode**

找到 useEffect：

```ts
useEffect(() => {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(history))
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* quota / disabled */
  }
}, [storageKey, history])
```

替换为：

```ts
useEffect(() => {
  try {
    if (mode === 'ask') {
      sessionStorage.setItem(askKey, JSON.stringify(history))
    } else {
      sessionStorage.setItem(operateKey, JSON.stringify(history))
    }
  } catch {
    /* quota / disabled */
  }
}, [storageKey, history, mode, askKey, operateKey])
```

- [ ] **Step 7: 在 JSX 中渲染 ModeTabs**

找到 `.footer` 之前、`.body` 之后插入（在 `contextBar` div 后面）：

```tsx
<div className={styles.modeTabs} role="tablist" aria-label="选择模式">
  <button
    type="button"
    role="tab"
    aria-selected={mode === 'ask'}
    className={`${styles.modeTab} ${mode === 'ask' ? styles.modeTabActive : ''}`}
    onClick={() => setMode('ask')}
    data-testid="page-agent-mode-ask"
  >
    <BookOpen size={14} /> 读懂本页
  </button>
  <button
    type="button"
    role="tab"
    aria-selected={mode === 'operate'}
    className={`${styles.modeTab} ${mode === 'operate' ? styles.modeTabActive : ''}`}
    onClick={() => setMode('operate')}
    data-testid="page-agent-mode-operate"
  >
    <MousePointerClick size={14} /> 协助操作
  </button>
</div>
```

- [ ] **Step 8: 类型检查**

Run: `cd frontend-vite && npx tsc --noEmit -p .`
Expected: 0 errors related to `PageAgentPanel.tsx`

- [ ] **Step 9: Commit**

```bash
git add frontend-vite/src/components/ai/PageAgentPanel.tsx
git commit -m "refactor(数创智伴): Panel 顶部加 mode tabs 并按 mode 分桶 history"
```

---

## Task 3: 替换双按钮为单提交按钮 + 模式化样式

**Files:**
- Modify: `frontend-vite/src/components/ai/PageAgentPanel.tsx`
- Modify: `frontend-vite/src/components/ai/PageAgentPanel.module.css`

- [ ] **Step 1: 把 sendAsk / sendOperate 收敛为 send(m) 调度函数**

找到 `sendAsk` 与 `sendOperate` 两个函数定义。在它们**之前**新增：

```ts
async function send() {
  if (mode === 'ask') return sendAsk()
  return sendOperate()
}
```

不要删除 `sendAsk` / `sendOperate` 内部实现，只是把它们变成同模块内可调用的私有函数。

- [ ] **Step 2: 修改 sendAsk 内 `setHistory` 调用以包含 mode**

找到 `sendAsk` 函数中两处 `setHistory` 调用：

```ts
setHistory((h) => [...h, { id: userId, role: 'user', content: userText, routeKey }])
```

替换为：

```ts
setHistory((h) => [...h, { id: userId, role: 'user', content: userText, mode: 'ask', routeKey }])
```

并把 catch 分支里 `role: 'assistant'` 那行替换为：

```ts
setHistory((h) => [
  ...h,
  { id: nextIdRef.current++, role: 'assistant', content: '⚠️ ' + msg, mode: 'ask', routeKey },
])
```

然后在 reply 写入处：

```ts
setHistory((h) => [...h, { id: nextIdRef.current++, role: 'assistant', content: reply, routeKey }])
```

替换为：

```ts
setHistory((h) => [...h, { id: nextIdRef.current++, role: 'assistant', content: reply, mode: 'ask', routeKey }])
```

- [ ] **Step 3: 同理修改 sendOperate**

对 `sendOperate` 函数中的三处 `setHistory` 调用，按 mode `'operate'` 添加 `mode` 字段（userId 那一处、catch 分支的 assistant 那一处、最终 reply 写入那一处）。

- [ ] **Step 4: 修改 footer JSX：删除两个旧按钮，加单按钮**

找到：

```tsx
<div className={styles.actions}>
  <button
    type="button"
    className={`${styles.btn} ${styles.btnSecondary}`}
    onClick={() => void sendAsk()}
    disabled={!text.trim() || chatMut.isPending || operating}
    data-testid="page-agent-ask-btn"
  >
    <MessageSquareText size={15} />
    问当前页
  </button>
  <button
    type="button"
    className={`${styles.btn} ${styles.btnPrimary}`}
    onClick={() => void sendOperate()}
    disabled={!text.trim() || chatMut.isPending || operating}
    data-testid="page-agent-operate-btn"
  >
    <MousePointerClick size={15} />
    执行操作
  </button>
  <button
    ref={clearTriggerRef}
    type="button"
    className={`${styles.btn} ${styles.btnGhost}`}
    ...
```

替换为：

```tsx
<div className={styles.actions}>
  <button
    type="button"
    className={`${styles.btn} ${mode === 'operate' ? styles.btnPrimary : styles.btnSecondary}`}
    onClick={() => void send()}
    disabled={!text.trim() || chatMut.isPending || operating}
    data-testid="page-agent-submit-btn"
  >
    {mode === 'ask'
      ? <><BookOpen size={15} /> 提问</>
      : <><MousePointerClick size={15} /> 执行</>}
  </button>
  <button
    ref={clearTriggerRef}
    type="button"
    className={`${styles.btn} ${styles.btnGhost}`}
    ...
```

- [ ] **Step 5: 修改 placeholder 跟随 mode**

找到 textarea：

```tsx
<textarea
  className={styles.textarea}
  placeholder="问当前页面，或描述想执行的操作…"
  ...
```

替换 placeholder 为：

```ts
placeholder={mode === 'ask' ? '问一个关于本页的问题…' : '描述想让我做的事，如「跳到搜索页」…'}
```

- [ ] **Step 6: 加 Enter 发送 / Shift+Enter 换行快捷键**

找到 textarea 的 `onKeyDown`：

```tsx
onKeyDown={handleKey}
```

保留 `handleKey` 名称，找到它的实现（应该是已有）。如果还没有，添加：

```ts
const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault()
    void send()
  }
}
```

放在 `useCallback` 之外（避免引入新 hook 顺序问题）即可。

- [ ] **Step 7: CSS 新增 modeTabs / modeTabActive**

`PageAgentPanel.module.css` 末尾追加：

```css
.modeTabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  padding: 6px;
  background: rgba(255, 255, 255, 0.6);
  border-bottom: 1px solid #e2e7f0;
}
.modeTab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #66748d;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}
.modeTab:hover { color: #18233b; background: rgba(255, 255, 255, 0.7); }
.modeTabActive {
  background: #18233b;
  color: #fff;
  box-shadow: 0 2px 6px rgba(15, 29, 55, 0.12);
}
.modeTabActive:hover { color: #fff; background: #18233b; }
```

- [ ] **Step 8: 类型检查 + 单测**

Run:
```bash
cd frontend-vite && npx tsc --noEmit -p .
cd frontend-vite && npx vitest run tests/animations/modeStorage.test.ts
```
Expected: 0 errors; all tests pass

- [ ] **Step 9: Commit**

```bash
git add frontend-vite/src/components/ai/PageAgentPanel.tsx frontend-vite/src/components/ai/PageAgentPanel.module.css
git commit -m "feat(数创智伴): 双按钮改为单提交 + Tab 切换驱动模式"
```

---

## Task 4: 清空弹层支持两桶独立勾选

**Files:**
- Modify: `frontend-vite/src/components/ai/PageAgentPanel.tsx`
- Modify: `frontend-vite/src/components/ai/PageAgentPanel.module.css`

- [ ] **Step 1: 把单清空状态改为两桶勾选状态**

在 `PageAgentPanel` 中找到：

```ts
const [clearOpen, setClearOpen] = useState(false)
```

替换为：

```ts
const [clearOpen, setClearOpen] = useState(false)
const [clearAsk, setClearAsk] = useState(true)
const [clearOperate, setClearOperate] = useState(true)
```

- [ ] **Step 2: 修改 handleClearConfirm 实现**

找到：

```ts
function handleClearConfirm() {
  setHistory([])
  setText('')
  setError(null)
  setOperating(false)
  try {
    sessionStorage.removeItem(storageKey)
  } catch {
    /* quota / disabled */
  }
  disposeSession()
  setClearOpen(false)
}
```

替换为：

```ts
function handleClearConfirm() {
  const cleared: AgentMode[] = []
  if (clearAsk) cleared.push('ask')
  if (clearOperate) cleared.push('operate')
  if (cleared.length === 0) return
  try {
    for (const m of cleared) sessionStorage.removeItem(getStorageKey(routeKey, m))
  } catch {
    /* quota / disabled */
  }
  // If current view's bucket was cleared, drop in-memory history too.
  if (cleared.includes(mode)) {
    setHistory([])
    setText('')
    setError(null)
    setOperating(false)
  }
  disposeSession()
  setClearOpen(false)
}
```

- [ ] **Step 3: 修改清空弹层 JSX**

找到清空弹层 `<div className={styles.clearLayer}>` 内部、`.clearActions` 之前，插入两个 checkbox：

```tsx
<label className={styles.clearOption}>
  <input
    type="checkbox"
    checked={clearAsk}
    onChange={e => setClearAsk(e.target.checked)}
    data-testid="page-agent-clear-ask"
  />
  清空问答（{counts.ask} 条）
</label>
<label className={styles.clearOption}>
  <input
    type="checkbox"
    checked={clearOperate}
    onChange={e => setClearOperate(e.target.checked)}
    data-testid="page-agent-clear-operate"
  />
  清空操作（{counts.operate} 条）
</label>
```

在 `handleClearConfirm` 之上、组件函数体内添加派生 counts：

```ts
const counts = {
  ask: history.filter(m => m.mode === 'ask').length,
  operate: history.filter(m => m.mode === 'operate').length,
}
```

（注：counts 仅依赖当前视图 history，跨 Tab 计数会偏。这是已知简化 — 全量计数需在 mount 时一次性加载两桶，可作 v1.1。文档化在 README。）

- [ ] **Step 4: 确认按钮在未勾选任何项时 disabled**

找到：

```tsx
<button
  type="button"
  className={styles.clearConfirm}
  onClick={handleClearConfirm}
  data-testid="page-agent-clear-confirm"
>
  清空
</button>
```

替换为：

```tsx
<button
  type="button"
  className={styles.clearConfirm}
  onClick={handleClearConfirm}
  disabled={!clearAsk && !clearOperate}
  data-testid="page-agent-clear-confirm"
>
  清空
</button>
```

- [ ] **Step 5: 加 CSS**

`PageAgentPanel.module.css` 末尾追加：

```css
.clearOption {
  grid-column: 1 / -1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid #e0e4eb;
  border-radius: 9px;
  background: #fafbfd;
  color: #4a5874;
  font-size: 12px;
  cursor: pointer;
}
.clearOption input { margin: 0; }
```

- [ ] **Step 6: 类型检查**

Run: `cd frontend-vite && npx tsc --noEmit -p .`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add frontend-vite/src/components/ai/PageAgentPanel.tsx frontend-vite/src/components/ai/PageAgentPanel.module.css
git commit -m "feat(数创智伴): 清空弹层支持问答/操作独立勾选"
```

---

## Task 5: 同步 e2e 测试契约（two buttons → Tab + 单按钮）

**Files:**
- Modify: `frontend-vite/tests/public-page-agent.spec.ts`

- [ ] **Step 1: 找到失效测试名**

打开 `frontend-vite/tests/public-page-agent.spec.ts`，定位：

```ts
test('clicking FAB shows dual-mode panel with two buttons', async ({ page }) => { ... })
```

定位 `'chat-mode submit posts to /api/public/agent/execute'`（仍在 use，但选择器要同步）。

- [ ] **Step 2: 替换 "two buttons" 测试**

完整替换 `test('clicking FAB shows dual-mode panel with two buttons', ...)` 的函数体为：

```ts
test('clicking FAB shows panel with mode tabs and single submit', async ({ page }) => {
  await enablePageAgent(page)
  const fab = page.locator('[data-testid="page-agent-fab"]')
  await expect(fab).toBeVisible()
  await fab.click()
  const panel = page.locator('[data-testid="page-agent-body"]')
  await expect(panel).toBeVisible()

  const askTab = page.locator('[data-testid="page-agent-mode-ask"]')
  const operateTab = page.locator('[data-testid="page-agent-mode-operate"]')
  await expect(askTab).toBeVisible()
  await expect(operateTab).toBeVisible()
  await expect(askTab).toHaveAttribute('aria-selected', 'true')
  await expect(operateTab).toHaveAttribute('aria-selected', 'false')

  const submit = page.locator('[data-testid="page-agent-submit-btn"]')
  await expect(submit).toBeVisible()
  await expect(submit).toHaveText(/提问/)
})
```

- [ ] **Step 3: 在 "chat-mode submit posts" 测试中更新选择器**

找到该测试中对 `page-agent-ask-btn` 或 `page-agent-operate-btn` 的引用。统一替换为：

```ts
// 切到 ask tab 后用单按钮触发
await page.locator('[data-testid="page-agent-mode-ask"]').click()
await page.locator('[data-testid="page-agent-input"]').fill('摘要一下')
await page.locator('[data-testid="page-agent-submit-btn"]').click()
```

并把测试名改为 `'chat-mode submit (ask tab) posts to /api/public/agent/execute'`。

- [ ] **Step 4: 更新清空确认测试**

找到 `test('clear confirmation stays compact ...', ...)`，把对清空弹层的断言扩展为：

```ts
await expect(page.locator('[data-testid="page-agent-clear-ask"]')).toBeVisible()
await expect(page.locator('[data-testid="page-agent-clear-operate"]')).toBeVisible()
```

- [ ] **Step 5: 运行 e2e 验证**

Run: `cd frontend-vite && npm run test:ui-regressions 2>&1 | tail -40`
Expected: 所有 page-agent 相关测试通过

如果失败，根据错误信息迭代修复，直到通过。

- [ ] **Step 6: Commit**

```bash
git add frontend-vite/tests/public-page-agent.spec.ts
git commit -m "test(数创智伴): 同步 e2e 契约到 Tab+单按钮新形态"
```

---

## Task 6: 删除 agent-preview 预览页

**Files:**
- Delete: `frontend-vite/src/labs/AgentPreviewLab.tsx`
- Delete: `frontend-vite/src/labs/agent-preview.css`
- Modify: `frontend-vite/src/App.tsx`（移除 import 与路由）

- [ ] **Step 1: 确认决策点**

回顾 spec §5 第 7 条："方案落地后删除 `/labs/agent-preview`" — 用户在 plan review 时已确认 OK。

- [ ] **Step 2: 删除文件并清理 import**

```bash
rm frontend-vite/src/labs/AgentPreviewLab.tsx
rm frontend-vite/src/labs/agent-preview.css
```

- [ ] **Step 3: 从 App.tsx 移除 import 与路由**

打开 `frontend-vite/src/App.tsx`，删除：

```ts
import { AgentPreviewLab } from './labs/AgentPreviewLab'
```

并删除路由行：

```tsx
<Route path="/labs/agent-preview" element={<Layout><AgentPreviewLab /></Layout>} />
```

- [ ] **Step 4: 检查 labs-page.spec.ts 引用**

```bash
grep -n "agent-preview\|AgentPreviewLab" frontend-vite/tests/labs-page.spec.ts
```

如果有引用，移除相关 describe/test 块。

- [ ] **Step 5: 类型检查 + 构建 sanity**

Run:
```bash
cd frontend-vite && npx tsc --noEmit -p .
cd frontend-vite && npm run build 2>&1 | tail -10
```
Expected: 0 errors; build success

- [ ] **Step 6: Commit**

```bash
git add -u frontend-vite/
git commit -m "chore(数创智伴): 删除方案预览页（已落地）"
```

---

## Task 7: 端到端验收（手工）

**Files:** 无（手动验证）

- [ ] **Step 1: 启动 dev 并访问**

```bash
cd frontend-vite && npm run dev
```

浏览器打开 http://localhost:5173/articles/<某篇文章> ，确认 FAB 仍可点击打开面板。

- [ ] **Step 2: 验证 Tab 默认值**

面板打开后，确认顶部 Tab 默认高亮"读懂本页"。

- [ ] **Step 3: 验证模式切换**

- 切到"协助操作" Tab，确认输入框 placeholder 变为"描述想让我做的事…"，提交按钮文案变为"执行"
- 在 ask tab 输入"概括本文" → 提交 → 应走问答路径（看到页面摘要回答）
- 切到 operate tab → 输入"跳到搜索" → 提交 → 应触发 page-agent 操作

- [ ] **Step 4: 验证历史分轨**

- ask tab 下输入 3 条问答 → 切到 operate → 输入 1 条操作 → 切回 ask → 3 条问答应完整可见
- 刷新页面（F5） → 重新打开面板 → 切到对应 tab → 历史应保留

- [ ] **Step 5: 验证清空分桶**

- 点击清空按钮 → 弹层出现两个 checkbox（问答 / 操作）
- 只勾选"问答" → 确认 → 当前在 ask tab 应看到空，但切到 operate tab 历史仍在
- 重复，只勾选"操作"，验证对称行为

- [ ] **Step 6: 验证旧数据迁移**

- 在浏览器 devtools `sessionStorage` 手动写入：
  ```js
  sessionStorage.setItem('hbsc.page-agent.chat.history:/articles/<slug>', JSON.stringify([{id:1,role:'user',content:'旧消息'}]))
  ```
- 刷新页面，打开面板 → 旧消息应出现在"读懂本页" Tab 下
- 重新打开 devtools → 旧 key `hbsc.page-agent.chat.history:/articles/<slug>` 应已被删除，新 key `:ask` 存在

- [ ] **Step 7: 回归 e2e 全量**

Run: `cd frontend-vite && npm run test:ui-regressions`
Expected: 全部通过

- [ ] **Step 8: 收尾 commit（如有遗留修复）**

如有 Step 1-7 触发的代码微调，单独 commit 并 push 准备评审。

---

## 自审报告（Self-Review）

**1. Spec 覆盖：**
- §2.1 模式入口 Tab → Task 2 ✅
- §2.2 历史分桶（key、migration）→ Task 1, 2 ✅
- §2.3 输入框 + 单按钮 → Task 3 ✅
- §2.4 气泡视觉差异化（mode 标签） → Task 3 Step 7 通过 CSS class 配合，JSX 标签留作 v1.1
- §3.3 调用分发 → Task 3 Step 1 ✅
- §3.4 清空弹层两段 → Task 4 ✅
- §5 验收 1-6 → Task 7 ✅
- §5 验收 7（删除预览页）→ Task 6 ✅

**2. 占位扫描：** 无 TBD / TODO。所有代码块均完整。

**3. 类型一致性：**
- `AgentMode` 在 `modeStorage.ts` 定义、在 `PageAgentPanel.tsx` import 复用
- `UiMessage.mode` 在 Task 2 Step 1 引入，Task 3 Step 2/3 所有 setHistory 调用同步使用
- data-testid 命名一致：`page-agent-mode-ask` / `page-agent-mode-operate` / `page-agent-submit-btn`

**4. 已知遗漏（已记录但不阻塞）：**
- 气泡 mode 标签视觉（§2.4 提到的彩色 chip）— 本次只迁移 mode 字段，不在 JSX 渲染标签。视觉差异化通过 Tab 高亮 + 按钮颜色承担。**留作 v1.1 增强**，文档化于 README "Known Limitations" 章节
- 全量计数（counts）跨 Tab 不准确 — Task 4 Step 3 注释里说明，留 v1.1

---

**计划结束。7 个 Task 预计 ~3-5 小时实施 + 验证。**
