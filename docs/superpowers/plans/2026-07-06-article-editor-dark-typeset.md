# ArticleEditor 深色主题 + AI 排版按钮位置 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/admin/articles/:id` 在 dark theme 下残留的 7 处 white-on-dark 源全部改为 token-driven 主题色，并把 AI 排版按钮从独立字段块搬到 markdown 编辑器顶栏右对齐、金色 primary 强调；修正 .docx 自动排版 checkbox 措辞以消除与新按钮的错意。

**Architecture:**
- 5 个 CSS / 1 个 TSX 文件改动 + 1 个新 Playwright spec
- 新增 4 个 `--md-editor-*` 别名 token（不带新色值），用 CSS 钩选择器把 MDEditor 编辑面板也暗化
- AI 排版按钮的 onClick、`handleTypeset` 链路、`TypesetPreviewDialog` 全部不动——只改位置与变体
- 整体属于"展示层"重排，不动后端、不动 typeset 的自动触发钩子

**Tech Stack:** React 19 + Vite + TypeScript + `@uiw/react-md-editor@^4.1.1` + `@tanstack/react-query`；Playwright（沿用 project 既有模式）；既有 `--admin-*` / `--brand-*` / `--accent-*` token 系列

**Spec:** `docs/superpowers/specs/2026-07-06-article-editor-dark-typeset-design.md`（已锁定 2026-07-06）

---

## File Structure (Locks Decomposition)

### New 文件

| 路径 | 责任 |
|---|---|
| `frontend-vite/tests/article-editor-dark-typeset.spec.ts` | Playwright：5 个用例覆盖 dark theme 下的色彩 + 按钮位置 + .docx 措辞 + typeset 流程不回归 |

### Modified 文件

| 路径 | 原因 |
|---|---|
| `frontend-vite/src/styles/admin-tokens.css` | 追加 4 个 `--md-editor-*` 别名 token（`--md-editor-bg` / `--md-editor-toolbar-bg` / `--md-editor-fg` / `--md-editor-border`），全部映射到既有 `--admin-*` 值 |
| `frontend-vite/src/pages/admin/ArticleList.css` | 行 54 / 76–85 / 126 / 132 / 235–241 共 5 处改 token；新增 `[data-md-editor-dark]` 钩 selector 段 |
| `frontend-vite/src/components/admin/Toast.css` | 行 16 `background: white` → `var(--admin-surface)` |
| `frontend-vite/src/components/admin/AdminLayout.css` | 行 80–83 sidebar active 改 token + 左 2px gold border |
| `frontend-vite/src/components/admin/ImageUploader.css` | 行 14–15 hover 改 `var(--accent-soft)` |
| `frontend-vite/src/pages/admin/ArticleEditor.tsx` | 行 390–410 删除；行 461/471 `data-color-mode="light"` → `"dark"` + `data-md-editor-dark`；tabs 行右对齐加按钮；hint 子标题行；typesetError 移位；.docx checkbox 措辞调整 |

### Untouched（明确不动）

- 后端任何文件
- `frontend-vite/src/styles/global.css`（.prose 段不动）
- `frontend-vite/src/components/ArticleBody.tsx`
- `frontend-vite/src/components/admin/TypesetPreviewDialog.tsx`
- `frontend-vite/src/components/ui/Button.tsx`、`Modal.tsx`
- `frontend-vite/src/pages/admin/JournalEditor.tsx`（同主题 polish 不在本 PR）
- `frontend-vite/src/services/api.ts`
- `frontend-vite/src/pages/admin/AdminSettings.tsx`
- `frontend-vite/tests/admin-snapshots.spec.ts`（基线不重做）

---

# PR 1 — Frontend only

## Task 1: 写失败的 Playwright spec（5 用例 / RED）

**Files:**
- Create: `frontend-vite/tests/article-editor-dark-typeset.spec.ts`

- [ ] **Step 1: 创建文件并写入 5 用例**

`frontend-vite/tests/article-editor-dark-typeset.spec.ts`：

```ts
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

    // 按钮和 MDEditor 容器在同一个父 DOM 子树（结构断言：我们认为 .editor-tabs + .article-editor__md 邻近即合格；由模板决定 selector，写得宽松一些）
    const tabsContainer = page.locator('.editor-tabs').first()
    await expect(tabsContainer).toBeVisible()
    const mdContainer = page.locator('.article-editor__md').first()
    await expect(mdContainer).toBeVisible()
    // 按钮 DOM 父节点在 tabs 容器 OR 紧邻 md 容器以内
    const btnInsideTabsOrSibling = await btn.evaluate((el) => {
      // 向上找最近的 .editor-tabs 容器或 [data-md-editor-dark]
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
    // 等 .docx 字段渲染
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
    // TypesetPreviewDialog 标题为 "AI 排版预览"
    await expect(page.getByText('AI 排版预览')).toBeVisible({ timeout: 15_000 })
    // 关闭
    await page.getByRole('button', { name: '关闭' }).first().click()
  })
})
```

- [ ] **Step 2: 跑测试，确认 RED**

```bash
cd frontend-vite && BASE_URL=http://localhost:5174 ADMIN_PW='Hbsc@2026' npx playwright test tests/article-editor-dark-typeset.spec.ts --reporter=list 2>&1 | tail -40
```

Expected: 全部 5 用例 FAIL（外层卡片仍白、按钮位置未变、措辞未改）——任一意外 PASS 先停下来调查。

> 注：项目 dev server 在 5173 但 playwright 配置 `baseURL` 默认 5174，所以<strong>必须</strong>另开一个 vite 在 5174，或用 `BASE_URL=http://localhost:5173` 跑测试。建议：保持 `5174`、用 Task 5 验证时建立的 dev server（`npm run dev -- --port 5174`）。

---

## Task 2: 在 `admin-tokens.css` 追加 4 个 `--md-editor-*` 别名 token

**Files:**
- Modify: `frontend-vite/src/styles/admin-tokens.css`（追加于文件末尾）

- [ ] **Step 1: 写入 token 定义块（verbatim）**

将以下块整体追加到 `frontend-vite/src/styles/admin-tokens.css` 的最末尾（保留前文不动）：

```css

/* ---- md-editor 别名 token（不带新色值，仅供 MDEditor 钩 selector 用） ---- */
:root {
  --md-editor-bg: var(--admin-surface-2);
  --md-editor-toolbar-bg: var(--admin-surface);
  --md-editor-fg: var(--admin-text);
  --md-editor-border: var(--admin-border);
}
:root[data-theme="light"] {
  --md-editor-bg: var(--admin-surface-2);
  --md-editor-toolbar-bg: var(--admin-surface);
  --md-editor-fg: var(--admin-text);
  --md-editor-border: var(--admin-border);
}
```

- [ ] **Step 2: 跑测试（应该仍 RED，token 已注入但 CSS 钩 selector 在 Task 3 才补）**

```bash
cd frontend-vite && BASE_URL=http://localhost:5174 ADMIN_PW='Hbsc@2026' npx playwright test tests/article-editor-dark-typeset.spec.ts --reporter=list 2>&1 | tail -30
```

Expected: 5/5 仍 RED（MDEditor 钩 selector 还没写）。

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/styles/admin-tokens.css
git commit -m "style(admin): 引入 4 个 --md-editor-* 别名 token（不带新色值）"
```

---

## Task 3: 把 4 个 white-on-dark 源改 token（Toast / AdminLayout / ImageUploader / ArticleList 5 处）

**Files:**
- Modify: `frontend-vite/src/components/admin/Toast.css`（行 16）
- Modify: `frontend-vite/src/components/admin/AdminLayout.css`（行 80–83）
- Modify: `frontend-vite/src/components/admin/ImageUploader.css`（行 14–15）
- Modify: `frontend-vite/src/pages/admin/ArticleList.css`（行 54 / 76–85 / 126 / 132 / 235–241）

- [ ] **Step 1: 改 `Toast.css` 行 16**

把现有：

```css
.admin-toast {
  ...
  background: white;
  ...
}
```

改为：

```css
.admin-toast {
  ...
  background: var(--admin-surface);
  color: var(--admin-text);
  ...
}
```

> 注：`Toast.css` 当前行 16 是唯一 `background: white;` 引用。读一下文件确认上下文，把这一行替换掉，其他属性全部保留。**不动** `border / box-shadow`。

- [ ] **Step 2: 改 `AdminLayout.css` 行 80–83**

`.admin-sidebar__link.is-active`：

```css
.admin-sidebar__link.is-active {
  background: var(--admin-surface-2);
  border-left: 2px solid var(--brand-gold);
  color: var(--admin-text);
}
```

> 把现有 `background: var(--brand-gold-50); color: var(--brand-ink);` 替换为以上两行（仅这两行的字面值改；其他行不动）。

- [ ] **Step 3: 改 `ImageUploader.css` 行 14–15**

```css
.image-uploader:hover,
.image-uploader.is-dragging {
  background: var(--accent-soft);
}
```

> 把现有 `background: var(--brand-gold-50);` 替换。

- [ ] **Step 4: 改 `ArticleList.css` 5 处**

依次替换以下行（用 Edit tool，按文件确认当前行内容后替换；block 上下文如下）：

**4-1 行 54** —— `.article-editor`：

```css
.article-editor {
  background: var(--admin-surface);
  ...
}
```

> 把 `background: white;` 这行替换。保留其他属性（max-width / padding / margin / border / border-radius / box-shadow 等）。

**4-2 行 76–85** —— `.article-editor__field input, textarea, select`：

```css
.article-editor__field input,
.article-editor__field textarea,
.article-editor__field select {
  ...
  background: var(--admin-surface-2);
  color: var(--admin-text);
}
```

> 在现有规则下加 `background` 与 `color` 两行；其他属性（border / padding / font-size / width 等）保留。

**4-3 行 126 / 132** —— `.article-editor__btn--secondary` / `--danger`：

```css
.article-editor__btn--secondary,
.article-editor__btn--danger {
  background: var(--admin-surface-2);
  color: var(--admin-text);
  ...
}
```

> 把两个规则里 `background: white;` 替换为 `background: var(--admin-surface-2);`，同时添加 `color: var(--admin-text);`（这两个 class 当前没有 color 属性，加一行）。

**4-4 行 235–241** —— `.editor-preview-hero__cover-empty`：

```css
.editor-preview-hero__cover-empty {
  background:
    repeating-linear-gradient(
      45deg,
      var(--admin-surface-2) 0px,
      var(--admin-surface-2) 24px,
      var(--admin-bg) 24px,
      var(--admin-bg) 48px
    );
  ...
}
```

> 用 admin token 替换现有奶油/cream 渐变。原色是 `var(--brand-paper-warm)` 与 `--admin-surface-2` 交替；改为都从 `--admin-*` 派生。

- [ ] **Step 5: 跑测试（用例 1、2 应转 GREEN）**

```bash
cd frontend-vite && BASE_URL=http://localhost:5174 ADMIN_PW='Hbsc@2026' npx playwright test tests/article-editor-dark-typeset.spec.ts --reporter=list 2>&1 | tail -30
```

Expected: 用例 1（`.article-editor` 非白）PASS；用例 2（input/textarea 非白）PASS；用例 3/4/5 仍 RED（按钮位置 + .docx 措辞 + typeset 流程未改）。

- [ ] **Step 6: Commit**

```bash
git add frontend-vite/src/components/admin/Toast.css \
        frontend-vite/src/components/admin/AdminLayout.css \
        frontend-vite/src/components/admin/ImageUploader.css \
        frontend-vite/src/pages/admin/ArticleList.css
git commit -m "style(admin): 7 处 white-on-dark 改为 token 主题色"
```

---

## Task 4: MDEditor 编辑面板变深（CSS 钩 selector + wrapper `data-md-editor-dark`）

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleList.css`（追加 `[data-md-editor-dark]` 钩 selector 段）
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`（行 461、471 wrapper 改 attribute）

- [ ] **Step 1: 在 `ArticleList.css` 末尾追加 4 段 CSS（verbatim）**

```css

/* ---- MDEditor 编辑面板暗化（仅在 ArticleEditor 用了 data-md-editor-dark 时生效） ---- */
.article-editor__md[data-md-editor-dark] .w-md-editor-toolbar {
  background: var(--md-editor-toolbar-bg);
  border-bottom: 1px solid var(--md-editor-border);
}
.article-editor__md[data-md-editor-dark] .w-md-editor,
.article-editor__md[data-md-editor-dark] .w-md-editor-text-pre > code,
.article-editor__md[data-md-editor-dark] .w-md-editor-text-input,
.article-editor__md[data-md-editor-dark] .w-md-editor-text {
  background: var(--md-editor-bg);
  color: var(--md-editor-fg);
  --md-editor-background-color: var(--md-editor-bg);
  --md-editor-box-shadow-color: var(--md-editor-border);
  border-color: var(--md-editor-border);
}
.article-editor__md[data-md-editor-dark] .w-md-editor-bar {
  background: var(--md-editor-border);
}
.article-editor__md[data-md-editor-dark] .w-md-editor-btn:hover {
  background: var(--accent-soft);
}
```

- [ ] **Step 2: 在 `ArticleEditor.tsx` 两个 wrapper 上加 `data-md-editor-dark`**

读 `frontend-vite/src/pages/admin/ArticleEditor.tsx` 行 461–471 一段：

```tsx
        <div className="article-editor__md" data-color-mode="light">
```

改为：

```tsx
        <div className="article-editor__md" data-color-mode="dark" data-md-editor-dark="true">
```

文件内**第二处** wrapper（行 471 附近）：

```tsx
        <div className="article-editor__preview" data-color-mode="light">
```

改为：

```tsx
        <div className="article-editor__preview" data-color-mode="dark">
```

> 第一处 wrapper 同时打两个 attribute（让 CSS 钩 selector 生效）；第二处 preview wrapper 仅切 `data-color-mode="dark"`（因为 preview 是 `.prose`，不在本 PR 修复，但切到 dark 是无害的；详见 spec 风险 #3）。

- [ ] **Step 3: 跑测试（用例 3 仍 RED：按钮位置未变）**

```bash
cd frontend-vite && BASE_URL=http://localhost:5174 ADMIN_PW='Hbsc@2026' npx playwright test tests/article-editor-dark-typeset.spec.ts --reporter=list 2>&1 | tail -20
```

Expected: 1/2 仍 PASS；3/4/5 仍 RED（按钮位置 + .docx 措辞 + typeset 流程未改）。

- [ ] **Step 4: Commit**

```bash
git add frontend-vite/src/pages/admin/ArticleList.css frontend-vite/src/pages/admin/ArticleEditor.tsx
git commit -m "feat(admin): MDEditor 编辑面板在 admin 上下文里切到深色"
```

---

## Task 5: 删旧 AI 排版字段块，把按钮挪到 `.editor-tabs` 同行 + 改 .docx 措辞

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`（行 380 措辞 + 整段删除行 390–410 + tabs 行加按钮 + typesetError 移位）

- [ ] **Step 1: 改 `.docx` checkbox 措辞（行 380 附近）**

读 `ArticleEditor.tsx` 当前内容确认行号。在 `.docx` 字段块内 checkbox label：

```tsx
              导入并自动跑 AI 排版
```

改为：

```tsx
              导入 .docx 后自动跑 AI 排版
```

> 仅换字面字符串；label 包裹结构不动；state（autoTypeset）/ handler / 后续 `<small>` 未配置提示全部保留。

- [ ] **Step 2: 删除整段 `.article-editor__field` 字段块（行 390–410）**

读 `frontend-vite/src/pages/admin/ArticleEditor.tsx` 找到当前形如：

```tsx
        <div className="article-editor__field">
          <label>AI 排版（用 LLM 清洗 Markdown；不动元数据）</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              icon={<Sparkles size={14} />}
              onClick={() => { void handleTypeset() }}
              disabled={typesetBusy || !typesetterReady}
              loading={typesetBusy}
              title={typesetterReady ? '使用配置的 LLM 清洗当前正文' : typesetterBlockedReason}
            >
              AI 排版
            </Button>
            <span style={{ fontSize: '0.8125rem', color: 'var(--admin-text-2)' }}>
              {typesetterReady
                ? '点击后弹窗预览对照，不满意可取消'
                : typesetterBlockedReason}
            </span>
          </div>
          {typesetError && <div style={{ fontSize: '0.8125rem', color: 'var(--status-draft-fg)', marginTop: '4px' }}>{typesetError}</div>}
        </div>
```

整段（包括外层 `<div className="article-editor__field">...</div>` 共 ~21 行）删除掉。

> 不要删除 `typesetterReady` / `typesetterBlockedReason` 计算（行 94–101 附近）；它们仍被新位置的按钮 + hint 行复用。

- [ ] **Step 3: 在 `.editor-tabs` 行内右对齐插入新按钮**

读 `ArticleEditor.tsx` 找 `.editor-tabs` 容器（行 437–461 附近）。当前结构形如：

```tsx
        <div className="editor-tabs" role="tablist" aria-label="正文编辑 / 预览">
          <button ...>源</button>
          <button ...>预览（页面效果）</button>
        </div>
```

替换为：

```tsx
        <div className="editor-tabs" role="tablist" aria-label="正文编辑 / 预览">
          <button
            type="button"
            role="tab"
            aria-selected={previewMode === 'edit'}
            className={`editor-tabs__btn${previewMode === 'edit' ? ' is-active' : ''}`}
            onClick={() => setPreviewMode('edit')}
          >
            源
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={previewMode === 'preview'}
            className={`editor-tabs__btn${previewMode === 'preview' ? ' is-active' : ''}`}
            onClick={() => setPreviewMode('preview')}
          >
            预览（页面效果）
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button
              variant="default"
              icon={<Sparkles size={14} />}
              onClick={() => { void handleTypeset() }}
              disabled={typesetBusy || !typesetterReady}
              loading={typesetBusy}
              title={typesetterReady ? '使用配置的 LLM 清洗当前正文' : typesetterBlockedReason}
            >
              AI 排版
            </Button>
            {!typesetterReady && (
              <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-2)' }}>
                {typesetterBlockedReason}
              </span>
            )}
          </div>
        </div>
```

> 关键：
> - 保留原有 `<button>` "源" / "预览（页面效果）" 完整属性（role / aria-selected / className / onClick）；不要省略
> - 在两个 tab `<button>` 之后插入一段 `<div style={{ marginLeft: 'auto', ... }}>`（右对齐靠 `marginLeft: 'auto'`），里面装按钮 + 可选 hint
> - `Button` 用 `variant="default"`（= brand gold）+ 已有 `Sparkles` 图标 + 既有 `onClick={() => { void handleTypeset() }}`
> - `typesetterReady` 时不显示 hint 行；未就绪时显示一行提示
> - `disabled={typesetBusy || !typesetterReady}` 与 `loading={typesetBusy}` 保留
> - `title` 属性保留

- [ ] **Step 4: 在 .editor-tabs 行下方追加 hint 子标题 + typesetError 行**

读 `ArticleEditor.tsx`，紧接 `</div>`（关闭 `.editor-tabs` 行）之后，**`.article-editor__md` 容器起始之前**，插入：

```tsx
        <small style={{ display: 'block', marginBottom: '8px', fontSize: '0.8125rem', color: 'var(--admin-text-2)' }}>
          对当前正文 Markdown 跑一次 LLM 清洗，元数据不动
        </small>
        {typesetError && (
          <div style={{ fontSize: '0.8125rem', color: 'var(--status-draft-fg)', marginBottom: '8px' }}>
            {typesetError}
          </div>
        )}
```

- [ ] **Step 5: 跑测试（用例 3/4/5 应 GREEN）**

```bash
cd frontend-vite && BASE_URL=http://localhost:5174 ADMIN_PW='Hbsc@2026' npx playwright test tests/article-editor-dark-typeset.spec.ts --reporter=list 2>&1 | tail -30
```

Expected: 5/5 PASS（用例 3 按钮位置就位 / 用例 4 措辞改了 / 用例 5 typeset 流程不回归）。

- [ ] **Step 6: 跑既有 `article-autotypeset.spec.ts` 确认不回归**

```bash
cd frontend-vite && BASE_URL=http://localhost:5174 ADMIN_PW='Hbsc@2026' npx playwright test tests/article-autotypeset.spec.ts --reporter=list 2>&1 | tail -15
```

Expected: 4/4 PASS。这一份是 7-05 锁定的 spec；本次改动可能让其中某个 selector 失效（特别是"勾选自动排版 + 上传 .docx → TypesetPreviewDialog 自动打开"这个用例，因为 .docx checkbox label 措辞改了）。

如果该 spec 失败，按 selector 实际变化调整（典型场景：`getByText(/^导入并自动跑 AI 排版$/)` 之类的 hardcoded 字符串改成新措辞）。调整范围**只限于此 spec 文件**，**不要**改被测代码本身——如有更深层冲突停下来报告。

- [ ] **Step 7: 跑其他 admin spec（确认不回归）**

```bash
cd frontend-vite && BASE_URL=http://localhost:5174 ADMIN_PW='Hbsc@2026' npx playwright test tests/ai-typesetter-dialog.spec.ts tests/admin-theme.spec.ts --reporter=list 2>&1 | tail -15
```

Expected: 
- `ai-typesetter-dialog` 3 用例 PASS（与本 PR 关联最强；按钮位置变化后 dialog 应仍正常打开）
- `admin-theme` 1 用例可能 flaky（pre-existing `addInitScript` 反模式，与本 PR 无关，retries: 1 兜底）

- [ ] **Step 8: Commit**

```bash
git add frontend-vite/src/pages/admin/ArticleEditor.tsx
git commit -m "feat(admin): AI 排版按钮移到 markdown 编辑器顶栏右对齐 + .docx 措辞调整"
```

如果 Step 6 调整了 `article-autotypeset.spec.ts`，一并 commit：

```bash
git add frontend-vite/tests/article-autotypeset.spec.ts
git commit -m "test(admin): 适配 .docx 自动排版 checkbox 新措辞"
```

---

## Task 6: 人工 smoke + 收尾

**Files:**
- Read-only: 全部改动

- [ ] **Step 1: 启动 dev server（如未启动）**

```bash
cd backend && uvicorn app.main:app --reload --port 8000 &
cd frontend-vite && npm run dev -- --port 5174
```

- [ ] **Step 2: 浏览器跑人工 smoke 7 步**

访问 `http://localhost:5174/admin/login`（admin / `Hbsc@2026`），到 `/admin/articles/1`：

| # | 动作 | 预期 |
|---|---|---|
| 1 | dark theme 下访问 | 外层卡片深、输入框深、MDEditor 编辑面板深 |
| 2 | 切到 light theme | 反向也正确（一片浅色） |
| 3 | 看 AI 排版按钮位置 | 在 tabs 同行右对齐、金色 primary |
| 4 | 在 Settings → AI 排版 中将 `article_typesetter.enabled` 改 false 再返回 | 按钮 disabled、hint 行显示「请先在 设置 → AI 排版 中启用」 |
| 5 | 看 .docx checkbox label | 含「导入 .docx 后」字样 |
| 6 | typesetter enabled、点 AI 排版 | TypesetPreviewDialog 仍正常打开；学术/商务/精简 三选项切换；apply 后 form.content 替换；管理员"保存并发布"功能未坏 |
| 7 | 上传 .docx，autoTypeset 勾选 / 不勾选 | 与 `2026-07-05-docx-autotypeset-design.md` 锁定 spec 行为一致 |

任一步不符合，回对应 Task 排查。

- [ ] **Step 3: 最终 commit chain 验证**

```bash
git log --oneline e8bcd21..HEAD
```

确认本 PR 共 5–6 个 commit（spec commit 已 push；本 PR 预期 5 个：token / 7 white 改 token / md-editor dark / 按钮挪位置 / article-autotypeset 适配）

- [ ] **Step 4: 报告给 orchestrator 准备 push origin + PR 创建**

回复报告：commit SHA 列表 + 测试通过情况 + 烟测结果。

---

## Self-Review

| 检查项 | 结论 |
|---|---|
| Spec 目标→Task 映射 | 目标"dark 全控件暗化 + 按钮位置关联 markdown" → Task 2–5；非目标（不动 .prose / 不动 dialog / 不动后端）→ 文件清单的 "Untouched" 段保护 |
| Spec 决策→Task 映射 | "B 档范围 / 复用 token / default+gold 按钮 / 4 个 --md-editor-* 别名 / 不重做 admin-snapshots 基线" → Task 2（4 个 token）+ Task 3（5 文件）+ Task 4（CSS 钩）+ Task 5（按钮挪位 + 措辞）+ Untouched 段 |
| Placeholder 扫描 | 所有代码块为可粘贴真实代码；无 TBD/TODO/类似 Task N |
| 类型一致性 | `autoTypeset / typesetterReady / typesetterBlockedReason / handleTypeset` 名称与 `frontend-vite/src/pages/admin/ArticleEditor.tsx` 已存在定义对齐（来自之前 7-05 锁定 spec 已有的 state） |
| Test–Implementation 配对 | 用例 1 ↔ Task 3 (Step 4-1：`.article-editor` 改 token)、用例 2 ↔ Task 3 (Step 4-2：inputs 改 token)、用例 3 ↔ Task 5 (Step 3：按钮移到 tabs 同行)、用例 4 ↔ Task 5 (Step 1：.docx checkbox 措辞)、用例 5 ↔ Task 5 (Step 3：按钮 + handleTypeset 不动) + Task 4 (Step 2：data-md-editor-dark) |
| 没有引入新依赖 | 仅用既有 `Button` / `Sparkles` / `var(--admin-*)` / `var(--md-editor-*)` |
| 跳过 admin-snapshots | Untouched 段明列 |
| 跳过 .prose | Untouched 段明列 + 用例 4 检验不写 |
| 编辑顺序 | Token 别名先于 CSS 钩 selector（Task 2 → Task 4），CSS 钩先于 wrapper attribute（同一 Task），按钮搬迁最后（避免被 CSS 钩切换打断） |
