# 数创实验室 + MiniCast 整合 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 hbsc 主站新增 `/labs` landing 与 `/labs/minicast` iframe 子页，把 MiniCast 作为第一个实验项目嵌入；架构上保持 hbsc 与 minicast 完全独立、互不干扰。

**Architecture:** iframe + 反向代理模式。hbsc 通过静态 `registry.json` 列出所有 lab，MiniCast 通过 URL `?embed=1` query 参数切换 embed 模式（默认独立运行）。Dev 中 iframe src 直接指向 `http://localhost:5577`；prod 中由后续 spec 用 Nginx 反代。

**Tech Stack:**
- 前端：React 19.2 + Vite 8.0 + TypeScript 6.0 + react-router-dom 6.30 + Tailwind 3.4
- 测试：Playwright 1.61（项目唯一测试框架，无 vitest）
- 全局 CSS 令牌：`--color-ink #1a1a2e`、`--color-accent #2563eb`、`--color-text-secondary #4b5563` 等
- Worktree: `.worktrees/feat-labs-minicast`（branch `feat/labs-minicast` from `c1203d2`）

**Worktree Context:** 所有工作在本 worktree 内；主 worktree 的脏改动和 `.claude/worktrees/agent-aa31589f09a2d12e4` 与本计划无关。

**Prerequisites (engineer 启动前必须完成):**
- 在 worktree 目录：`cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast`
- 确认 `npm install` 已完成（运行 `ls frontend-vite/node_modules | head -5`，应非空）
- 确认 minicast 项目可访问：`ls /Users/jasonlee/Projects/MiniCast/web/src/App.tsx`
- 确认 `git status` 干净（除本计划的 spec commit 外无其他修改）

---

## Task 1: 定义 lab registry 的 TypeScript 类型

**Files:**
- Create: `frontend-vite/src/labs/types.ts`

- [ ] **Step 1: 写类型定义文件**

```ts
// frontend-vite/src/labs/types.ts
//
// Static registry schema for 数创实验室 lab listings.
// Mirrors frontend-vite/src/labs/registry.json at build time.

export type LabStatus = 'active' | 'coming-soon'

export interface LabIframeSrc {
  /** dev iframe src (e.g. http://localhost:5577/?embed=1) */
  dev: string
  /** prod iframe src (e.g. /labs/minicast/?embed=1) */
  prod: string
}

export interface LabEntry {
  id: string
  title: string
  subtitle: string
  description: string
  icon: string
  iframeSrc: LabIframeSrc
  status: LabStatus
  tags: string[]
}

export interface LabRegistry {
  labs: LabEntry[]
}
```

- [ ] **Step 2: 验证类型文件可被 Vite 解析**

Run: `cd frontend-vite && npx tsc --noEmit src/labs/types.ts`
Expected: `tsc` exits 0，no output

- [ ] **Step 3: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/labs/types.ts
git commit -m "feat(labs): add TypeScript types for lab registry"
```

---

## Task 2: 创建 registry.json 数据文件

**Files:**
- Create: `frontend-vite/src/labs/registry.json`

- [ ] **Step 1: 写 registry.json**

```json
{
  "labs": [
    {
      "id": "minicast",
      "title": "MiniCast",
      "subtitle": "AI 播客生成器 · Mandarin / English",
      "description": "输入一个 URL、PDF 或一段文本，自动生成中英双人对谈播客。6 个精选音色，强制用户审阅脚本，30 秒即可产出可发布音频。",
      "icon": "🎙️",
      "iframeSrc": {
        "dev": "http://localhost:5577/?embed=1",
        "prod": "/labs/minicast/?embed=1"
      },
      "status": "active",
      "tags": ["LLM", "TTS", "FFMPEG", "VIBE-CODING"]
    },
    {
      "id": "placeholder-1",
      "title": "下一个 Lab",
      "subtitle": "Prototyping",
      "description": "数创实验室是开放的实验场，后续会有更多由团队用 vibe coding 方式构建的 AI 工具陆续上线。",
      "icon": "🧪",
      "iframeSrc": {
        "dev": "",
        "prod": ""
      },
      "status": "coming-soon",
      "tags": ["PLANNED"]
    },
    {
      "id": "placeholder-2",
      "title": "下一个 Lab",
      "subtitle": "Prototyping",
      "description": "数创实验室是开放的实验场，后续会有更多由团队用 vibe coding 方式构建的 AI 工具陆续上线。",
      "icon": "🧪",
      "iframeSrc": {
        "dev": "",
        "prod": ""
      },
      "status": "coming-soon",
      "tags": ["PLANNED"]
    }
  ]
}
```

- [ ] **Step 2: 验证 JSON 语法**

Run: `python3 -m json.tool frontend-vite/src/labs/registry.json > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: 验证 schema 与 types.ts 一致**

Run: `cd frontend-vite && npx tsx -e "import r from './src/labs/registry.json'; console.log(r.labs.length, 'labs loaded')"`
Expected: `3 labs loaded`

> 若 `tsx` 不可用，跳过此步，TypeScript build 会在 Task 11 验证。

- [ ] **Step 4: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/labs/registry.json
git commit -m "feat(labs): seed registry.json with MiniCast + 2 placeholders"
```

---

## Task 3: 写 LabsPage Playwright spec（TDD 红）

**Files:**
- Create: `frontend-vite/tests/labs-page.spec.ts`

- [ ] **Step 1: 写 spec**

```ts
// frontend-vite/tests/labs-page.spec.ts
import { test, expect } from '@playwright/test'

test.describe('数创实验室 /labs landing page', () => {
  test('loads at /labs with hero + lab cards', async ({ page }) => {
    await page.goto('/labs')

    // Hero
    await expect(page.getByRole('heading', { name: '数创实验室', level: 1 })).toBeVisible()
    await expect(page.getByText('探索 AI 驱动的内部实验项目')).toBeVisible()

    // Lab cards: 1 active + 2 coming-soon
    const cards = page.getByTestId('lab-card')
    await expect(cards).toHaveCount(3)

    // MiniCast is active with CTA pointing to /labs/minicast
    const minicastCard = page.getByTestId('lab-card').filter({ hasText: 'MiniCast' })
    await expect(minicastCard).toContainText('AI 播客生成器')
    await expect(minicastCard.getByRole('link', { name: /开始使用/ })).toHaveAttribute('href', '/labs/minicast')

    // Coming-soon cards are not clickable
    const comingSoon = page.getByTestId('lab-card').filter({ hasText: '下一个 Lab' })
    await expect(comingSoon.first()).toContainText('敬请期待')
  })

  test('theme uses hbsc 科技蓝 tokens (not gold)', async ({ page }) => {
    await page.goto('/labs')
    const accentLink = page.getByRole('link', { name: /开始使用/ }).first()
    const bg = await accentLink.evaluate((el) => getComputedStyle(el).backgroundColor)
    // accent = #2563eb = rgb(37, 99, 235)
    expect(bg).toMatch(/rgb\(37,\s*99,\s*235\)/)
  })
})
```

- [ ] **Step 2: 启动 dev server 在 5174 端口（background）**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast/frontend-vite
npx vite --port 5174 --host 127.0.0.1
```

> 在另一个终端/后台运行。baseURL 来自 `playwright.config.ts` 默认 `http://localhost:5174`。

- [ ] **Step 3: 跑 spec 看它失败**

Run: `cd frontend-vite && npx playwright test labs-page --reporter=list`
Expected: **FAIL** —— 404 on `/labs` (route doesn't exist yet)

- [ ] **Step 4: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/tests/labs-page.spec.ts
git commit -m "test(labs): add Playwright spec for /labs landing page"
```

---

## Task 4: 写 labs.css 样式表

**Files:**
- Create: `frontend-vite/src/labs/labs.css`

- [ ] **Step 1: 写 CSS（**严格使用 hbsc 全局 token，不引入新颜色/字体**）**

```css
/* frontend-vite/src/labs/labs.css
   Uses ONLY global.css tokens. No new colors, no new fonts.
   No fixed widths on root containers (respect CSS_LAYOUT_GOTCHAS). */

.labs-page { padding: 0; }

/* ===== Hero ===== */
.labs-hero {
  padding: 80px 0 48px;
  text-align: center;
  background: linear-gradient(180deg, var(--color-bg) 0%, var(--color-paper-warm) 100%);
  border-bottom: 1px solid var(--color-border);
}
.labs-hero h1 {
  font-size: 3rem;
  margin-bottom: var(--space-2);
}
.labs-hero .lead {
  color: var(--color-text-secondary);
  font-size: 1.0625rem;
  max-width: 640px;
  margin: 0 auto;
  line-height: 1.8;
}

/* ===== Section ===== */
.labs-section { padding: var(--space-8) 0 var(--space-10); }
.labs-section-header { margin-bottom: var(--space-5); }
.labs-section-title {
  font-size: 1.75rem;
  margin-bottom: var(--space-1);
}
.labs-section-subtitle {
  color: var(--color-text-secondary);
  max-width: 560px;
}

/* ===== Grid ===== */
.lab-grid {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(3, 1fr);
}
@media (max-width: 1024px) { .lab-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 768px)  { .lab-grid { grid-template-columns: 1fr; } }

/* ===== Card ===== */
.lab-card {
  position: relative;
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 28px;
  transition: all 250ms ease;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 360px;
}
.lab-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-pop);
  border-color: var(--color-accent-light);
}
.lab-card--featured {
  border-color: var(--color-accent);
  background: linear-gradient(135deg, var(--color-paper) 0%, var(--color-accent-soft) 100%);
}
.lab-card--featured::before {
  content: "ACTIVE";
  position: absolute; top: 16px; right: 16px;
  font-family: var(--font-sans-en);
  font-size: 0.625rem; font-weight: 700;
  letter-spacing: 0.12em; padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-accent); color: #fff;
}
.lab-card--disabled { opacity: 0.55; cursor: not-allowed; }
.lab-card--disabled:hover { transform: none; box-shadow: var(--shadow-card); }

.lab-icon {
  width: 56px; height: 56px;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-accent-soft);
  border-radius: 14px;
  font-size: 1.75rem;
  margin-bottom: var(--space-3);
}
.lab-card--featured .lab-icon {
  background: var(--color-accent);
  color: #fff;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
}
.lab-card--disabled .lab-icon { background: var(--color-muted); }

.lab-title { font-size: 1.375rem; margin-bottom: 6px; }
.lab-subtitle {
  font-family: var(--font-sans-en);
  font-size: 0.8125rem;
  color: var(--color-accent); font-weight: 500;
  letter-spacing: 0.02em; margin-bottom: var(--space-3);
}

.lab-preview {
  margin: -8px -8px var(--space-3);
  border-radius: 10px;
  background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
  height: 88px;
  position: relative;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  gap: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-sans-en);
  font-size: 0.75rem;
  letter-spacing: 0.05em;
}
.lab-preview::before {
  content: "";
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 20% 50%, rgba(37, 99, 235, 0.12), transparent 50%),
    radial-gradient(circle at 80% 50%, rgba(147, 197, 253, 0.18), transparent 50%);
}
.lab-waveform {
  display: flex; align-items: center; gap: 3px; z-index: 1;
}
.lab-waveform span {
  display: inline-block; width: 3px;
  background: var(--color-accent);
  border-radius: 2px;
  animation: lab-wave 1.4s ease-in-out infinite;
}
.lab-waveform span:nth-child(1)  { height: 8px;  animation-delay: 0s; }
.lab-waveform span:nth-child(2)  { height: 18px; animation-delay: 0.1s; }
.lab-waveform span:nth-child(3)  { height: 12px; animation-delay: 0.2s; }
.lab-waveform span:nth-child(4)  { height: 24px; animation-delay: 0.3s; }
.lab-waveform span:nth-child(5)  { height: 16px; animation-delay: 0.4s; }
.lab-waveform span:nth-child(6)  { height: 28px; animation-delay: 0.5s; }
.lab-waveform span:nth-child(7)  { height: 14px; animation-delay: 0.6s; }
.lab-waveform span:nth-child(8)  { height: 22px; animation-delay: 0.7s; }
.lab-waveform span:nth-child(9)  { height: 10px; animation-delay: 0.8s; }
.lab-waveform span:nth-child(10) { height: 18px; animation-delay: 0.9s; }
@keyframes lab-wave {
  0%, 100% { transform: scaleY(0.4); }
  50%      { transform: scaleY(1); }
}

.lab-desc {
  color: var(--color-text-secondary);
  font-size: 0.9375rem;
  line-height: 1.7;
  margin-bottom: var(--space-3);
  flex: 1;
}

.lab-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: var(--space-3); }
.lab-tag {
  font-family: var(--font-sans-en);
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 3px 10px; border-radius: 999px;
  background: var(--color-muted); color: var(--color-text-secondary);
  letter-spacing: 0.04em;
}

.lab-cta {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 20px; border-radius: 8px;
  background: var(--color-accent); color: #fff;
  font-size: 0.875rem; font-weight: 500;
  transition: all 150ms ease;
  align-self: flex-start;
  border: none; cursor: pointer; font-family: inherit;
}
.lab-cta:hover {
  background: var(--color-accent-hover);
  transform: translateX(2px);
  color: #fff;
}
.lab-card--disabled .lab-cta {
  background: var(--color-muted); color: var(--color-text-muted);
  pointer-events: none; cursor: default;
}
.lab-card--disabled .lab-cta:hover { transform: none; background: var(--color-muted); }

.lab-status {
  position: absolute; top: 16px; right: 16px;
  font-family: var(--font-sans-en);
  font-size: 0.625rem; font-weight: 600;
  letter-spacing: 0.12em; padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-muted); color: var(--color-text-muted);
}

/* ===== MiniCastLab iframe wrapper ===== */
.minicast-lab {
  display: flex; flex-direction: column;
  height: calc(100vh - var(--nav-height));
  width: 100%;
}
.minicast-lab__frame {
  flex: 1;
  border: none;
  width: 100%;
  background: var(--color-paper-warm);
}
.minicast-lab__error {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: var(--space-10);
  text-align: center;
  color: var(--color-text-secondary);
  flex: 1;
}
.minicast-lab__error h3 {
  margin-bottom: var(--space-2);
  color: var(--color-ink);
}
.minicast-lab__error ul {
  list-style: disc; padding-left: 24px;
  text-align: left; max-width: 480px;
  margin-bottom: var(--space-4);
}
```

- [ ] **Step 2: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/labs/labs.css
git commit -m "feat(labs): add labs.css with global-token-only styles"
```

---

## Task 5: 实现 LabCard 组件

**Files:**
- Create: `frontend-vite/src/labs/LabCard.tsx`

- [ ] **Step 1: 写 LabCard.tsx**

```tsx
// frontend-vite/src/labs/LabCard.tsx
import { Link } from 'react-router-dom'
import type { LabEntry } from './types'

interface LabCardProps {
  lab: LabEntry
}

export function LabCard({ lab }: LabCardProps) {
  const isActive = lab.status === 'active'
  const cardClass = [
    'lab-card',
    isActive ? 'lab-card--featured' : 'lab-card--disabled',
  ].join(' ')

  return (
    <article
      className={cardClass}
      data-testid="lab-card"
      data-lab-id={lab.id}
    >
      {isActive ? null : (
        <span className="lab-status">COMING SOON</span>
      )}
      <div className="lab-icon" aria-hidden="true">{lab.icon}</div>
      <h3 className="lab-title">{lab.title}</h3>
      <div className="lab-subtitle">{lab.subtitle}</div>

      {isActive && lab.id === 'minicast' ? (
        <div className="lab-preview" aria-hidden="true">
          <div className="lab-waveform">
            <span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>
      ) : null}

      <p className="lab-desc">{lab.description}</p>

      <div className="lab-tags">
        {lab.tags.map((tag) => (
          <span key={tag} className="lab-tag">{tag}</span>
        ))}
      </div>

      {isActive ? (
        <Link to="/labs/minicast" className="lab-cta">
          开始使用 →
        </Link>
      ) : (
        <span className="lab-cta" role="status">敬请期待</span>
      )}
    </article>
  )
}
```

- [ ] **Step 2: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/labs/LabCard.tsx
git commit -m "feat(labs): add LabCard component (active + coming-soon states)"
```

---

## Task 6: 实现 LabsPage 组件

**Files:**
- Create: `frontend-vite/src/labs/LabsPage.tsx`

- [ ] **Step 1: 写 LabsPage.tsx**

```tsx
// frontend-vite/src/labs/LabsPage.tsx
import registry from './registry.json'
import type { LabRegistry } from './types'
import { LabCard } from './LabCard'
import './labs.css'

const typedRegistry = registry as LabRegistry

export function LabsPage() {
  return (
    <div className="labs-page">
      <header className="labs-hero">
        <div className="container">
          <div className="section-label">DIGITAL INNOVATION LAB</div>
          <h1>数创实验室</h1>
          <p className="lead">
            探索 AI 驱动的内部实验项目。把一句话、一篇文章变成可交付的内容，
            让 AI 从概念走向真实的生产力。
          </p>
        </div>
      </header>

      <section className="labs-section">
        <div className="container">
          <div className="labs-section-header">
            <div className="section-label">CURRENT PROJECTS</div>
            <h2 className="labs-section-title">已上线实验</h2>
            <p className="labs-section-subtitle">
              实验室收录的、由内部团队用 vibe coding 方式构建的 AI 产品原型。
            </p>
          </div>

          <div className="lab-grid">
            {typedRegistry.labs.map((lab) => (
              <LabCard key={lab.id} lab={lab} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
```

> 严格使用 global.css 已有的 `section-label` 工具类；不重新定义。

- [ ] **Step 2: 添加 `resolveJsonModule` 到 tsconfig（如未启用）**

Run: `cd frontend-vite && grep -q '"resolveJsonModule"' tsconfig.json && echo OK || echo NEED`

Expected: `OK`（项目通常已开启）—— 若 `NEED`，编辑 `tsconfig.json` 加 `"resolveJsonModule": true`。

- [ ] **Step 3: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/labs/LabsPage.tsx
git commit -m "feat(labs): add LabsPage landing component"
```

---

## Task 7: 在 App.tsx 注册 /labs 路由

**Files:**
- Modify: `frontend-vite/src/App.tsx:73-79`

- [ ] **Step 1: 在公开站路由区插入 /labs**

定位到 App.tsx 第 73-79 行（`{/* 公开站 */}` 区块），在 `<Route path="/search"` 后插入：

```tsx
          <Route path="/labs" element={<Layout><LabsPage /></Layout>} />
```

并在文件顶部 import 区（约第 14 行附近）加：

```tsx
import { LabsPage } from './labs/LabsPage'
```

- [ ] **Step 2: TypeScript 检查**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: exit 0，no errors

- [ ] **Step 3: 跑 Playwright spec 看绿**

Run: `cd frontend-vite && npx playwright test labs-page --reporter=list`
Expected: **PASS** —— 2 tests passed

> 若 dev server 未运行，先启动：`cd frontend-vite && npx vite --port 5174 --host 127.0.0.1 &`

- [ ] **Step 4: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/App.tsx
git commit -m "feat(labs): register /labs route in App.tsx"
```

---

## Task 8: Navigation.tsx 添加 数创实验室 链接

**Files:**
- Modify: `frontend-vite/src/components/Navigation.tsx:81-162` (desktop) and `:178-208` (mobile)

- [ ] **Step 1: 添加激活态计算**

在 `const isArticlesActive = ...`（第 79 行）后插入：

```tsx
  const isLabsActive = location.pathname.startsWith('/labs')
```

- [ ] **Step 2: 在桌面 nav 添加链接**

定位到第 156-162 行（`<Link to="/articles">所有文章</Link>` 后），插入：

```tsx

          <Link
            to="/labs"
            className={`nav__link ${isLabsActive ? 'nav__link--active' : ''}`}
          >
            数创实验室
          </Link>
```

- [ ] **Step 3: 在移动 nav 添加链接**

定位到第 201-206 行（移动端"所有文章"链接后），插入：

```tsx
          <Link
            to="/labs"
            className={`nav__mobile-link ${isLabsActive ? 'active' : ''}`}
          >
            数创实验室
          </Link>
```

- [ ] **Step 4: TypeScript 检查**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/components/Navigation.tsx
git commit -m "feat(nav): add 数创实验室 link with /labs active state"
```

---

## Task 9: Footer.tsx 添加 数创实验室 链接

**Files:**
- Modify: `frontend-vite/src/components/Footer.tsx:12-15`

- [ ] **Step 1: 在 siteLinks 数组插入新条目**

定位到第 12-15 行 `const siteLinks = [...]`，改为：

```tsx
const siteLinks = [
  { label: '期刊', path: '/articles' },
  { label: '数创实验室', path: '/labs' },
  { label: '关于我们', path: '/about' },
]
```

- [ ] **Step 2: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/components/Footer.tsx
git commit -m "feat(footer): add 数创实验室 link to site links"
```

---

## Task 10: 写 MiniCastLab Playwright spec（TDD 红）

**Files:**
- Create: `frontend-vite/tests/minicast-lab.spec.ts`

- [ ] **Step 1: 写 spec**

```ts
// frontend-vite/tests/minicast-lab.spec.ts
import { test, expect } from '@playwright/test'

test.describe('MiniCast iframe page /labs/minicast', () => {
  test('renders iframe with embed=1 query param', async ({ page }) => {
    await page.goto('/labs/minicast')

    const iframe = page.locator('iframe.minicast-lab__frame')
    await expect(iframe).toBeVisible()

    const src = await iframe.getAttribute('src')
    expect(src).toContain('embed=1')

    // In dev, src should point to localhost:5577
    // In prod, src should be a relative path starting with /labs/minicast
    const isDev = src?.startsWith('http://localhost:5577')
    const isProd = src?.startsWith('/labs/minicast')
    expect(isDev || isProd).toBe(true)
  })

  test('hbsc nav remains visible (no double header)', async ({ page }) => {
    await page.goto('/labs/minicast')
    // hbsc nav is always rendered (sticky)
    await expect(page.locator('nav.nav').first()).toBeVisible()
    // 数创实验室 nav item should be active
    const labsNav = page.locator('nav.nav a').filter({ hasText: '数创实验室' })
    await expect(labsNav).toHaveClass(/nav__link--active/)
  })
})
```

- [ ] **Step 2: 跑 spec 看它失败**

Run: `cd frontend-vite && npx playwright test minicast-lab --reporter=list`
Expected: **FAIL** —— 404 on `/labs/minicast` (route doesn't exist yet)

- [ ] **Step 3: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/tests/minicast-lab.spec.ts
git commit -m "test(labs): add Playwright spec for /labs/minicast iframe"
```

---

## Task 11: 实现 MiniCastLab 组件

**Files:**
- Create: `frontend-vite/src/labs/MiniCastLab.tsx`

- [ ] **Step 1: 写 MiniCastLab.tsx**

```tsx
// frontend-vite/src/labs/MiniCastLab.tsx
import { useState } from 'react'
import registry from './registry.json'
import type { LabRegistry } from './types'

const typedRegistry = registry as LabRegistry
const minicast = typedRegistry.labs.find((l) => l.id === 'minicast')!

export function MiniCastLab() {
  const src = import.meta.env.DEV ? minicast.iframeSrc.dev : minicast.iframeSrc.prod
  const [loadError, setLoadError] = useState(false)

  if (loadError) {
    return (
      <div className="minicast-lab">
        <div className="minicast-lab__error" role="alert">
          <h3>MiniCast 服务暂不可用</h3>
          <p>请确认 MiniCast 已启动：</p>
          <ul>
            <li>前端 dev 服务：<code>cd /Users/jasonlee/Projects/MiniCast/web && npm run dev</code></li>
            <li>后端：<code>cd /Users/jasonlee/Projects/MiniCast && python -m minicast server</code></li>
          </ul>
          <button
            type="button"
            className="lab-cta"
            onClick={() => {
              setLoadError(false)
              // Force iframe reload by re-mounting via key change
              window.location.reload()
            }}
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="minicast-lab">
      <iframe
        className="minicast-lab__frame"
        src={src}
        title="MiniCast"
        // Sandbox: allow scripts + same-origin (so localStorage works for API key)
        sandbox="allow-scripts allow-same-origin allow-forms"
        onError={() => setLoadError(true)}
        onLoad={(e) => {
          // Detect failure: if iframe loaded but contents are blank (cross-origin
          // unreachable), surface a fallback. Same-origin dev loads succeed silently.
          const iframe = e.currentTarget
          try {
            const doc = iframe.contentDocument
            if (doc && doc.body && doc.body.innerHTML === '') {
              setLoadError(true)
            }
          } catch {
            // Cross-origin — cannot inspect, assume OK
          }
        }}
      />
      <noscript>
        <div className="minicast-lab__error">
          <p>MiniCast 需要启用 JavaScript。请<a href={minicast.iframeSrc.dev} target="_blank" rel="noopener noreferrer">在新窗口打开</a>。</p>
        </div>
      </noscript>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 检查**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/labs/MiniCastLab.tsx
git commit -m "feat(labs): add MiniCastLab iframe wrapper with error fallback"
```

---

## Task 12: 在 App.tsx 注册 /labs/minicast 路由

**Files:**
- Modify: `frontend-vite/src/App.tsx`

- [ ] **Step 1: 在 import 区加 MiniCastLab import**

在第 14 行（`import { LabsPage }` 后）插入：

```tsx
import { MiniCastLab } from './labs/MiniCastLab'
```

- [ ] **Step 2: 注册路由**

在 Task 7 插入的 `/labs` 路由后（约第 80 行），插入：

```tsx
          <Route path="/labs/minicast" element={<Layout><MiniCastLab /></Layout>} />
```

- [ ] **Step 3: TypeScript 检查**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: 跑 spec 看绿**

Run: `cd frontend-vite && npx playwright test minicast-lab --reporter=list`
Expected: **PASS** —— 2 tests passed

> 提示：在 iframe 加载失败的情况下，spec 会因为 onLoad 触发 setLoadError 而进入错误态。spec 只检查 `iframe` 元素存在 + src 包含 `embed=1` + nav 仍可见，**不**检查 iframe 内容是否真的渲染成功（那是 Task 14 的工作）。

- [ ] **Step 5: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/App.tsx
git commit -m "feat(labs): register /labs/minicast route in App.tsx"
```

---

## Task 13: 修改 MiniCast App.tsx 支持 ?embed=1

> ⚠️ 此任务修改的是**另一项目** `/Users/jasonlee/Projects/MiniCast/`，不是 hbsc 仓内文件。
> 此项目的 spec 是 2026-07-14 spec 在 hbsc worktree 内，但本任务的 commit 走 minicast 自带的 tar.gz 快照机制（minicast 没有 git）。

**Files:**
- Modify: `/Users/jasonlee/Projects/MiniCast/web/src/App.tsx`

- [ ] **Step 1: 读当前 App.tsx 顶部**

```bash
head -30 /Users/jasonlee/Projects/MiniCast/web/src/App.tsx
```

> 确认 Header / ProgressBar 的 import 名字（可能叫 Header / ProgressBar / TopBar 等）。

- [ ] **Step 2: 加 isEmbedded 状态**

在文件顶部 import 区下面（紧跟 imports）插入：

```tsx
import { useMemo } from 'react'

// embed mode hides internal Header + ProgressBar when minicast is
// loaded inside hbsc's iframe at /labs/minicast/?embed=1.
// Default: false (standalone use is unaffected).
const isEmbedded = useMemo(() => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('embed') === '1'
}, [])
```

- [ ] **Step 3: 条件渲染 Header 和 ProgressBar**

在 JSX 顶层 `return (` 内，找出 `<Header />` 和 `<ProgressBar />`（或等价组件）的位置，包裹：

```tsx
{!isEmbedded && <Header />}
{!isEmbedded && <ProgressBar step={state.step} />}
```

> 若 Header / ProgressBar 名字不同，按 Step 1 的实际 import 名称调整。

- [ ] **Step 4: 验证 minicast 独立运行未受影响**

启动 minicast 后端 + 前端 dev：

```bash
cd /Users/jasonlee/Projects/MiniCast && python -m minicast server &
cd /Users/jasonlee/Projects/MiniCast/web && npm run dev &
```

浏览器访问 `http://localhost:5577/`（**不带** `?embed=1`），确认：
- ✅ Header 仍显示在顶部
- ✅ ProgressBar 仍显示
- ✅ 4-step wizard 正常工作

- [ ] **Step 5: 验证 embed 模式**

浏览器访问 `http://localhost:5577/?embed=1`：
- ✅ Header 隐藏
- ✅ ProgressBar 隐藏
- ✅ 4-step wizard 内容仍正常

- [ ] **Step 6: 创建 minicast 快照**

```bash
cd /Users/jasonlee/Projects/MiniCast
# 用项目自带的 snapshot 脚本（如果有），否则手动 tar
ls .snapshots/ | head -5  # 查看既有命名风格
# 推荐命名：embed_mode_20260714_HHMMSS.tar.gz
SNAP_NAME="embed_mode_$(date +%Y%m%d_%H%M%S).tar.gz"
tar czf ".snapshots/$SNAP_NAME" \
  --exclude='web/node_modules' \
  --exclude='web/dist' \
  --exclude='__pycache__' \
  --exclude='*.egg-info' \
  --exclude='.pytest_cache' \
  web/src/App.tsx
echo "Snapshot: .snapshots/$SNAP_NAME"
```

- [ ] **Step 7: 在 hbsc worktree 留记录（不修改 minicast 文件）**

在 hbsc worktree 创建 `frontend-vite/src/labs/MINICAST_PATCH.md`：

```markdown
# MiniCast embed mode patch — 2026-07-14

**配套 spec：** `docs/superpowers/specs/2026-07-14-hbsc-labs-minicast-design.md` §4.3

**改动文件：** `/Users/jasonlee/Projects/MiniCast/web/src/App.tsx`

**改动摘要：**
- 新增 `useMemo` import
- 新增 `isEmbedded` 常量（读 `?embed=1` URL query）
- 条件渲染 `<Header />` 和 `<ProgressBar />`

**minicast 快照：** `/Users/jasonlee/Projects/MiniCast/.snapshots/embed_mode_*.tar.gz`

**回归验证：**
- minicast 独立运行（URL 无 `?embed=1`）：Header / ProgressBar 正常显示 ✓
- embed 模式（URL 带 `?embed=1`）：Header / ProgressBar 隐藏 ✓
```

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/src/labs/MINICAST_PATCH.md
git commit -m "docs(labs): record minicast embed mode patch in hbsc repo"
```

> minicast 项目本身无 git，所以 patch 记录放在 hbsc 仓内供后续 merge 时回溯。

---

## Task 14: 写完整集成 Playwright spec（需 minicast dev 启动）

**Files:**
- Create: `frontend-vite/tests/labs-integration.spec.ts`

- [ ] **Step 1: 启动所有 dev 服务（前置）**

```bash
# Terminal 1: hbsc backend
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast/backend
uvicorn app.main:app --reload --port 8000

# Terminal 2: hbsc frontend (5174 for tests)
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast/frontend-vite
npx vite --port 5174 --host 127.0.0.1

# Terminal 3: minicast backend
cd /Users/jasonlee/Projects/MiniCast
python -m minicast server

# Terminal 4: minicast frontend (5577)
cd /Users/jasonlee/Projects/MiniCast/web
npm run dev
```

- [ ] **Step 2: 写完整 spec**

```ts
// frontend-vite/tests/labs-integration.spec.ts
//
// Full integration: nav → /labs → MiniCast card → /labs/minicast →
// iframe loads minicast → embed mode hides minicast Header →
// minicast step 1 form is interactive.
//
// REQUIRES: all 4 dev servers running (hbsc FE+BE, minicast FE+BE).
// Skip in CI by tagging as @manual — see Step 3.

import { test, expect } from '@playwright/test'

test.describe('Labs full integration (manual smoke)', () => {
  test('nav → labs → minicast iframe → embed mode hides inner header', async ({ page }) => {
    // 1. Home → click nav 数创实验室
    await page.goto('/')
    await page.locator('nav.nav a').filter({ hasText: '数创实验室' }).click()
    await expect(page).toHaveURL(/\/labs$/)

    // 2. /labs: hero + 3 cards + minicast CTA visible
    await expect(page.getByRole('heading', { name: '数创实验室' })).toBeVisible()
    const minicastCard = page.getByTestId('lab-card').filter({ hasText: 'MiniCast' })
    await expect(minicastCard).toBeVisible()

    // 3. Click "开始使用"
    await minicastCard.getByRole('link', { name: /开始使用/ }).click()
    await expect(page).toHaveURL(/\/labs\/minicast$/)

    // 4. iframe loads minicast
    const iframe = page.frameLocator('iframe.minicast-lab__frame')
    // Wait for minicast's app root to appear
    await expect(iframe.locator('body')).not.toBeEmpty({ timeout: 15_000 })

    // 5. embed mode: minicast's internal Header must NOT be visible
    //    (assumes minicast's Header has a known testid; if not, this
    //    assertion may need adjustment based on minicast's actual DOM)
    const innerHeader = iframe.locator('header').first()
    // If minicast's Header is rendered, this will fail (which is what we want)
    await expect(innerHeader).toHaveCount(0)
  })

  test('minicast standalone still has header (regression check)', async ({ page }) => {
    // Direct visit to minicast WITHOUT ?embed=1
    await page.goto('http://localhost:5577/')
    // minicast's Header should be present
    await expect(page.locator('header').first()).toBeVisible()
  })
})
```

- [ ] **Step 3: 跑 spec 看绿**

Run: `cd frontend-vite && npx playwright test labs-integration --reporter=list`
Expected: **PASS** —— 2 tests passed

> 若 minicast Header 的实际 DOM 不在 `<header>` 标签，断言可能需要按 minicast 实际 DOM 调整（如 `.minicast-header` class）。这是 acceptable 的偏差 —— 在 PR description 里注明实际选择器。

- [ ] **Step 4: 提交**

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/tests/labs-integration.spec.ts
git commit -m "test(labs): add full integration spec (nav → iframe → embed mode)"
```

---

## Task 15: 跑完整 Playwright suite 确保零回归

**Files:** (none)

- [ ] **Step 1: 跑所有 frontend-vite 测试**

Run: `cd frontend-vite && npx playwright test --reporter=list`
Expected: all suites pass（包含 labs-page、minicast-lab、labs-integration、其他既有 spec）

- [ ] **Step 2: 若有失败，分析并修复**

常见失败原因：
- **`.nav` 选择器被其他测试影响** → 检查 Navigation.tsx 修改是否动了既有 class
- **iframe 加载超时** → 确认 4 个 dev 服务都运行中
- **minicast Header 选择器不对** → 用 dev tools 查实际 DOM，调整 Task 14 spec

- [ ] **Step 3: 记录最终测试结果**

Run: `cd frontend-vite && npx playwright test --reporter=html`
Expected: HTML report 在 `playwright-report/`（已 gitignored）

无文件改动可提交。若 spec 有调整，单独提交：

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git add frontend-vite/tests/labs-integration.spec.ts
git commit -m "test(labs): adjust minicast header selector after manual check" || echo "no changes"
```

---

## Task 16: Build 验证

**Files:** (none)

- [ ] **Step 1: 跑 frontend-vite production build**

Run: `cd frontend-vite && npm run build`
Expected: 
- `tsc -b` exit 0
- `vite build` exit 0
- `dist/` 目录生成，含 `assets/index-*.{css,js}` 和 `index.html`

- [ ] **Step 2: 检查 dist 输出大小**

Run: `cd frontend-vite && du -sh dist/ && ls dist/assets/`
Expected: dist < 5MB；assets 含 index-*.css 和 index-*.js

- [ ] **Step 3: 验证 labs 路由在 SPA 入口**

Run: `grep -c "data-lab-id" frontend-vite/dist/assets/index-*.js`
Expected: `3`（registry 里 3 个 lab 都被静态嵌入）

无文件改动可提交。

---

## Task 17: 主仓状态完整性检查 + 收尾

**Files:** (none)

- [ ] **Step 1: 确认本 worktree 状态干净（仅计划内的提交）**

Run: `git status --short`
Expected: empty（无未提交改动）

- [ ] **Step 2: 查看完整 commit log**

Run: `git log --oneline c1203d2..HEAD`
Expected: 13 commits（Tasks 1-14 + Task 13 docs commit），每条 commit message 描述清楚

- [ ] **Step 3: 确认主 worktree 未受影响**

```bash
cd /Users/jasonlee/hubei-shuchuang
git status --short | wc -l
```

Expected: 数字与本 worktree 创建前一致（之前探索时是 89 条 main worktree 脏改动，应仍是 89 条左右）

- [ ] **Step 4: 写最终 summary commit（如需要）**

若发现需要在 merge 时给团队看的元信息，写一个空 commit：

```bash
cd /Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast
git commit --allow-empty -m "chore(labs): merge summary

数创实验室 + MiniCast 整合完成。

配套文档：
- docs/superpowers/specs/2026-07-14-hbsc-labs-minicast-design.md
- docs/superpowers/plans/2026-07-14-hbsc-labs-minicast.md
- frontend-vite/src/labs/MINICAST_PATCH.md (另一项目 patch 记录)

合并前检查清单：
- [ ] 主仓 .worktrees/ 已被 .gitignore 覆盖（本次 commit 含此项）
- [ ] 另一 session 的脏改动已 commit 或 stash
- [ ] main 分支与本分支无 conflict（主要冲突点：Navigation.tsx, Footer.tsx, App.tsx, .gitignore）

合并后验证：
- [ ] npm install 在主 worktree 重跑
- [ ] npx playwright test --reporter=list 全绿
- [ ] minicast dev 服务仍可独立启动
- [ ] 主 worktree 的脏改动与本分支无重叠"

Expected: empty commit created

- [ ] **Step 5: 最终验证**

Run: `git log --oneline c1203d2..HEAD | wc -l`
Expected: 13 或 14 条 commits（Tasks 1-14 + 1 summary commit）

---

## 完成标准（与 spec §10 对齐）

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 在 `feat/labs-minicast` 分支提交 | `git log --oneline c1203d2..HEAD` |
| 2 | frontend-vite build 通过 | Task 16 |
| 3 | Playwright e2e 全绿 | Task 15 |
| 4 | /labs 页面与 mockup 视觉一致 | 手动浏览器验收 |
| 5 | /labs/minicast iframe 嵌入正常 | Task 14 |
| 6 | minicast 独立运行行为不变 | Task 13 Step 4 |
| 7 | 主 worktree 状态未受影响 | Task 17 Step 3 |
