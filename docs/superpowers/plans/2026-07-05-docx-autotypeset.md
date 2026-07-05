# Docx 导入 + AI 排版一体化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理后台 ArticleEditor 页面的 `.docx` 导入块中加一个"导入并自动跑 AI 排版"开关；勾选后，`.docx` 上传成功后自动调用既有的 `handleTypeset()`，让 `TypesetPreviewDialog` 自动打开，复用全部既有 LLM/弹窗/错误处理。不动后端、不动 dialog、不动提示词。

**Architecture:**
- 仅修改 `frontend-vite/src/pages/admin/ArticleEditor.tsx`：新增 1 个 `useState`（`autoTypeset`，localStorage 持久化）+ 1 个 `useEffect` 同步 localStorage + 在 `handleImportDocx` 末尾按条件 `await handleTypeset(...)` + 在 `.docx` 字段下加 `<input type="checkbox">` 与"未配置时"提示分支
- 共用既有的 `POST /api/admin/articles/typeset`、`TypesetPreviewDialog`、`handleTypeset` 路径；不引入新端点、新组件、新键

**Tech Stack:** React 19 + Vite + TypeScript + `@tanstack/react-query` + 既有 `localStorage`；Playwright（既有 spec 模式复刻）

**Spec:** `docs/superpowers/specs/2026-07-05-docx-autotypeset-design.md`（已锁定 2026-07-05）

---

## File Structure (Locks Decomposition)

### New files

| Path | Responsibility |
|---|---|
| `frontend-vite/tests/article-autotypeset.spec.ts` | Playwright：勾选 / 取消勾选 / 未配置时 / localStorage 持久化 4 个场景 |

### Modified

| Path | Reason |
|---|---|
| `frontend-vite/src/pages/admin/ArticleEditor.tsx` | 新增 `autoTypeset` state + localStorage 同步 + 修改 `handleImportDocx` 末尾按条件 fire `handleTypeset` + `.docx` 字段下加 checkbox + 提示分支 |

### Untouched（明确不动）

- `backend/app/routers/admin_articles_typeset.py`
- `backend/app/services/markdown_typesetter.py`
- `backend/app/services/admin_setting_defaults.py`
- `frontend-vite/src/components/admin/TypesetPreviewDialog.tsx`
- `frontend-vite/src/services/api.ts`
- `frontend-vite/src/pages/admin/AdminSettings.tsx`
- `frontend-vite/src/pages/admin/JournalEditor.tsx`（无 markdown body 字段，不在范围）
- 任何后端文件

---

# PR 1 — Frontend only

## Task 1: 写失败的 Playwright spec（4 个场景）

**Files:**
- Create: `frontend-vite/tests/article-autotypeset.spec.ts`

- [ ] **Step 1: 写测试文件**

新建 `frontend-vite/tests/article-autotypeset.spec.ts`，内容：

```ts
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
    await page.context().addInitScript(() => {
      try { localStorage.removeItem('hbsc-article-auto-typeset') } catch {}
    })
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
    const checkbox = page.getByRole('checkbox', { name: /导入并自动跑 AI 排版/ })
    await expect(checkbox).toBeVisible({ timeout: 10_000 })
    await expect(checkbox).toBeChecked()

    // 上传 .docx 触发 handleImportDocx
    const fileInput = page.locator('input[type="file"][accept*="openxmlformats"]')
    await fileInput.setInputFiles({ name: 'fixture.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: MIN_DOCX })

    // TypesetPreviewDialog 应当自动打开（其 dialog role="dialog" 或标题可见）
    await expect(page.getByRole('dialog', { name: /清洗后/ }).or(page.locator('text=清洗后'))).toBeVisible({ timeout: 15_000 })
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
    const checkbox = page.getByRole('checkbox', { name: /导入并自动跑 AI 排版/ })
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
    await expect(page.getByRole('checkbox', { name: /导入并自动跑 AI 排版/ })).toHaveCount(0)
    // 出现未配置时的提示文案
    await expect(page.getByText(/请先在.*设置.*AI 排版.*启用/)).toBeVisible()
  })

  test('刷新页面后 checkbox 状态从 localStorage 还原', async ({ page }) => {
    await page.route('**/api/admin/settings', (r) => mockSettings(r, SETTINGS_CONFIGURED))

    await page.goto(`${baseURL}/admin/articles/new`)
    const checkbox = page.getByRole('checkbox', { name: /导入并自动跑 AI 排版/ })
    await expect(checkbox).toBeVisible({ timeout: 10_000 })
    await checkbox.uncheck()

    // 验证 localStorage 已写入 'false'
    const ls = await page.evaluate(() => localStorage.getItem('hbsc-article-auto-typeset'))
    expect(ls).toBe('false')

    await page.reload()
    await expect(page.getByRole('checkbox', { name: /导入并自动跑 AI 排版/ })).not.toBeChecked()
  })
})
```

- [ ] **Step 2: 跑测试，确认 RED**

```bash
cd frontend-vite && npx playwright test tests/article-autotypeset.spec.ts --reporter=list
```

Expected: 全部 4 个用例 FAIL（编辑器目前没有 checkbox 也没有 hook）。如果哪个用例意外 PASS，先停下来调查为什么。

---

## Task 2: ArticleEditor 加 `autoTypeset` state + localStorage 同步

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx:60-79`（state 集中区）

- [ ] **Step 1: 在 file 顶部 import 区确认 `useEffect` 已可用**

确认 `import { useEffect, useMemo, useState } from 'react'`（既有的第 1 行 import）。**不要新增 import。**

- [ ] **Step 2: 在 useState 集中区（第 63 行附近）追加两个声明**

在第 78 行的 `const toast = useToast()` **之后、第 81 行 `// Read article_typesetter.* settings...` 注释之前**，插入：

```tsx
  // Whether to auto-run the AI 排版 flow after a successful .docx import.
  // Persisted in localStorage so admins opt in/out once across sessions.
  const [autoTypeset, setAutoTypeset] = useState<boolean>(() => {
    try {
      return localStorage.getItem('hbsc-article-auto-typeset') !== 'false'
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('hbsc-article-auto-typeset', autoTypeset ? 'true' : 'false')
    } catch {
      // localStorage 不可用（隐私模式 / SSR）时静默回退，仅本次会话有效
    }
  }, [autoTypeset])
```

- [ ] **Step 3: 跑测试：至少步骤 4（localStorage 持久化）应当 PASS，其他仍 RED**

```bash
cd frontend-vite && npx playwright test tests/article-autotypeset.spec.ts --reporter=list
```

Expected: 第 4 个用例 PASS；1/2/3 仍 RED（因为还没在 `handleImportDocx` 末尾 fire，也没加 JSX checkbox）。

---

## Task 3: `handleImportDocx` 末尾按条件 fire `handleTypeset`

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx:106-124`（`handleImportDocx`）

- [ ] **Step 1: 调换 `handleImportDocx` 与 `handleTypeset` 的定义顺序**

把 `handleTypeset`（当前第 126–147 行）整体上移到 `handleImportDocx`（当前第 106–124 行）**之前**。整段剪切粘贴即可，不改函数体。这是为下一步在 `handleImportDocx` 内部 `await handleTypeset(...)` 避免 TypeScript TDZ 报错（`used before declaration`）。

- [ ] **Step 2: 替换 `handleImportDocx` 函数体**

把现有的：

```tsx
  const handleImportDocx = async (file: File) => {
    setImportBusy(true)
    setImportError('')
    try {
      const result = await api.admin.articles.importDocx(file)
      update('title', result.title || form.title)
      update('content', result.content_markdown || form.content)
      if (!form.slug && result.suggested_slug) {
        update('slug', result.suggested_slug)
      }
      if (result.warnings?.length) {
        setImportError(`提示：${result.warnings.join('；')}`)
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setImportBusy(false)
    }
  }
```

替换为：

```tsx
  const handleImportDocx = async (file: File) => {
    setImportBusy(true)
    setImportError('')
    try {
      const result = await api.admin.articles.importDocx(file)
      update('title', result.title || form.title)
      update('content', result.content_markdown || form.content)
      if (!form.slug && result.suggested_slug) {
        update('slug', result.suggested_slug)
      }
      if (result.warnings?.length) {
        setImportError(`提示：${result.warnings.join('；')}`)
      }
      // Auto-run AI 排版 immediately after import. Skipped when:
      //   • admin unchecks the preference, OR
      //   • typesetter is not configured (no enabled / no api key), OR
      //   • the import returned no content (don't call typeset on empty)
      if (autoTypeset && typesetterReady && result.content_markdown) {
        await handleTypeset('academic')
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setImportBusy(false)
    }
  }
```

要点：
- 新增的 `if` 块放在 warnings 处理之后、`catch` 之前，确保只在成功后 fire
- 用 `result.content_markdown` 作为"有没有真实内容"的判断，而不是 `form.content`——避免初始编辑老文章时误触发
- 不修改 `handleTypeset` 的签名；复用 `'academic'` 作为默认 style

- [ ] **Step 3: 跑测试**

```bash
cd frontend-vite && npx playwright test tests/article-autotypeset.spec.ts --reporter=list
```

Expected: 用例 1、2、3 由 RED 转 GREEN/部分 GREEN（用例 1 仍可能 RED，因为还没加 JSX checkbox，page.getByRole('checkbox') 会超时）。用例 4 已 PASS。

---

## Task 4: 在 `.docx` 字段下加 checkbox 与提示分支

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx:333-349`（`.docx` 字段 JSX）

- [ ] **Step 1: 在 `.docx` 字段 JSX 末尾追加 checkbox 块**

把第 349 行（`</div>` 关闭 `.docx` 字段）的紧前面，插入：

```tsx
          {typesetterReady ? (
            <label className="article-editor__autotypeset" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', color: 'var(--admin-text-2)' }}>
              <input
                type="checkbox"
                checked={autoTypeset}
                onChange={(e) => setAutoTypeset(e.target.checked)}
              />
              导入并自动跑 AI 排版
            </label>
          ) : (
            <small style={{ color: 'var(--admin-text-2)', fontSize: '0.75rem' }}>
              （如需导入后自动跑 AI 排版，请先在「设置 → AI 排版」中启用并配置 API Key）
            </small>
          )}
```

整段替换后，第 333–349 行（`.docx` 字段）的结构是：

```tsx
        <div className="article-editor__field">
          <label>从 .docx 导入（自动转 Markdown）</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={importBusy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleImportDocx(f)
                e.target.value = ''
              }}
            />
            {importBusy && <span style={{ fontSize: '0.8125rem', color: 'var(--admin-text-2)' }}>转换中…</span>}
          </div>
          {typesetterReady ? (
            <label className="article-editor__autotypeset" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', color: 'var(--admin-text-2)' }}>
              <input
                type="checkbox"
                checked={autoTypeset}
                onChange={(e) => setAutoTypeset(e.target.checked)}
              />
              导入并自动跑 AI 排版
            </label>
          ) : (
            <small style={{ color: 'var(--admin-text-2)', fontSize: '0.75rem' }}>
              （如需导入后自动跑 AI 排版，请先在「设置 → AI 排版」中启用并配置 API Key）
            </small>
          )}
          {importError && <div style={{ fontSize: '0.8125rem', color: 'var(--status-draft-fg)', marginTop: '4px' }}>{importError}</div>}
        </div>
```

- [ ] **Step 2: 跑测试：预期全部 PASS**

```bash
cd frontend-vite && npx playwright test tests/article-autotypeset.spec.ts --reporter=list
```

Expected: 4/4 PASS。如失败，根据输出回到对应 Task 排查。

---

## Task 5: 全套 Playwright 回归 + 手工烟测

**Files:**
- Read-only: 既有 specs

- [ ] **Step 1: 跑全套 Playwright**

```bash
cd frontend-vite && npx playwright test --reporter=list
```

Expected: 既有所有 spec（`admin-snapshots`、`admin-theme`、`ai-typesetter-dialog`、`public-page-agent`）+ 新的 `article-autotypeset` 全部 PASS。

如果 `ai-typesetter-dialog.spec.ts` 出现新失败，多半是它之前依赖 `.docx` 块的 DOM 结构而现在多了一个 `<input type="checkbox">`；用 `page.getByRole(...)` 重写 selector（可访问性 role 而不是 nth-child 索引）。

- [ ] **Step 2: 手工烟测（开发服务器跑起来后）**

```bash
cd backend && uvicorn app.main:app --reload --port 8000 &
cd frontend-vite && npm run dev -- --port 5174
```

打开 `http://localhost:5174/admin/login`（用户名 `admin`，密码见 `ADMIN_PW`），到 `/admin/articles/new`：
1. 未配 `article_typesetter.api_key` → 应看到灰字提示，不应看到 checkbox
2. 配好后回到该页面 → 应看到复选框默认打勾
3. 上传一份含 `pandoc` 残留的小 .docx → 弹窗应自动打开，里面至少展示清洗后 Markdown
4. 点 "取消" → 弹窗关闭，`form.content` 保持导入后的 raw
5. 再上传一次 → 重做测试，但这次**先点掉 checkbox** → 弹窗不应打开

任一步不符合，回到 Task 1–4 排查。

---

## Task 6: Commit

**Files:**
- New: `frontend-vite/tests/article-autotypeset.spec.ts`
- Modified: `frontend-vite/src/pages/admin/ArticleEditor.tsx`

- [ ] **Step 1: 仅添加本次改动的文件并 commit**

```bash
git add frontend-vite/tests/article-autotypeset.spec.ts frontend-vite/src/pages/admin/ArticleEditor.tsx
git commit -m "feat(admin): docx 导入后可选自动跑 AI 排版，复用既有 typeset 端点与弹窗"
```

Expected: 一个 commit，仅包含上述两文件以及未跟踪的 `package-lock.json` / `package.json` **不应**被包含（它们是另一主题；如果 `git status` 同时列出了它们，**不要** `git add`）。

---

## Self-Review

| 检查项 | 结果 |
|---|---|
| Spec 章节 → Task 映射 | Goal → Task 1–6；非目标"不动后端"→ 全 6 个 Task 只触碰 1 个 frontend 文件；决策表"localStorage key `hbsc-article-auto-typeset`"→ Task 2；"默认勾选，仅配置就绪时"→ Task 4 JSX 分支；"失败复用既有 UX"→ Task 3 仅 `await handleTypeset(...)`；测试计划 4 用例 → Task 1 |
| Placeholder 扫描 | 全部代码块为真实可粘贴代码；无 "TBD / TODO / 类似 to Task N" |
| 类型一致性 | `autoTypeset` 是 `boolean`；`setAutoTypeset` 来自 useState 解构；`typesetterReady` 既有 `useQuery` 产物；`handleTypeset(style)` 既有签名 `(style: TypesetStyle = 'academic') => Promise<void>`；`'academic'` 字面量与 `TypesetStyle` 定义一致 |
| 没有引入新依赖 | 仅使用 React 既有 hooks、`@playwright/test`（已配） |
