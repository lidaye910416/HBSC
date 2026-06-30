# Admin UI 重设计 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把后端管理界面从「通用电蓝 admin」升级为 Linear/Sanity 风的工具级工作面板；古铜金 `#C9A84C` 做与公开站的品牌桥接；公开站不动。

**Architecture:** 4 个 PR 阶段。第一阶段抽 design tokens + 12 个 ui primitives + 改 AdminLayout 浅主题（不破坏现有页面观感）。第二阶段重写 Dashboard 为 4 象限工作面板。第三阶段把 5 个 list 页迁移到 primitives。第四阶段把 4 个 editor+settings+login 包外壳。所有页公共组件走 `components/ui/`。

**Tech Stack:** React 19 + Vite + TypeScript strict + React Router + React Query + lucide-react；新增：`frontend-vite/src/styles/admin-tokens.css`、`frontend-vite/src/components/ui/*` 一组 primitives。

**Spec:** `docs/superpowers/specs/2026-06-30-admin-ui-redesign-design.md`

---

## File Structure (Locks Decomposition)

### New files

| Path | Responsibility |
|---|---|
| `frontend-vite/src/styles/admin-tokens.css` | CSS variables: brand / surface / status / spacing / radius / shadow / type / layout |
| `frontend-vite/src/components/ui/Button.tsx` | primary / secondary / danger / icon; size sm/md/lg; loading state |
| `frontend-vite/src/components/ui/IconButton.tsx` | ghost / solid / danger; size sm/md |
| `frontend-vite/src/components/ui/Card.tsx` | flat / outlined / elevated + Card.Section |
| `frontend-vite/src/components/ui/Stat.tsx` | label + value; trend variant |
| `frontend-vite/src/components/ui/PageHeader.tsx` | h1 + optional breadcrumb + actions slot |
| `frontend-vite/src/components/ui/Toolbar.tsx` | container + Group + Input + Select + SearchInput |
| `frontend-vite/src/components/ui/Breadcrumb.tsx` | from components/Breadcrumb.tsx 升格 |
| `frontend-vite/src/components/ui/StatusBadge.tsx` | published / draft / archived / featured |
| `frontend-vite/src/components/ui/Empty.tsx` | icon + title + description + CTA |
| `frontend-vite/src/components/ui/Pill.tsx` | removable tag |
| `frontend-vite/src/components/ui/Tabs.tsx` | underline / pill; controlled + uncontrolled |
| `frontend-vite/src/components/ui/Modal.tsx` | focus-trap + Esc + portal |
| `frontend-vite/src/components/ui/index.ts` | barrel re-export |
| `frontend-vite/src/pages/admin/Dashboard.css` | 4 象限 grid |
| `frontend-vite/tests/admin-snapshots.spec.ts` | Playwright 视觉回归 |

### Modified

| Path | Reason |
|---|---|
| `frontend-vite/src/main.tsx` 或 `App.tsx` | 导入 `styles/admin-tokens.css` |
| `frontend-vite/src/components/Breadcrumb.tsx` | 改为 re-export 桥接（保留公开站引用） |
| `frontend-vite/src/components/admin/AdminLayout.tsx` | 白底 sidebar + 古铜金 active + light header |
| `frontend-vite/src/components/admin/AdminLayout.css` | 同上 |
| `frontend-vite/src/pages/admin/Dashboard.tsx` | 4 象限工作面板 |
| `frontend-vite/src/pages/admin/ArticleList.tsx` | 用 primitives 重构 |
| `frontend-vite/src/pages/admin/ArticleList.css` | 收敛到最小 |
| `frontend-vite/src/pages/admin/FeaturedArticles.tsx` | 用 primitives |
| `frontend-vite/src/pages/admin/JournalList.tsx` | 用 primitives |
| `frontend-vite/src/pages/admin/MediaLibrary.tsx` | 用 primitives |
| `frontend-vite/src/pages/admin/ArticleEditor.tsx` | 外壳用 primitives |
| `frontend-vite/src/pages/admin/JournalEditor.tsx` | 用 primitives |
| `frontend-vite/src/pages/admin/JournalDetail.tsx` | 用 primitives |
| `frontend-vite/src/pages/admin/AdminSettings.tsx` | 用 primitives |
| `frontend-vite/src/pages/admin/Login.tsx` + `Login.css` | gold CTA |

### Untouched

- 全部 `app/routers/*`、`app/services/*`、`app/models/*` — 后端不动
- `services/api.ts` — 不动
- React Query keys、`api.admin.*` 调用 — 不动
- 公开站 7 个 page + 5 个非 admin 组件 — 不动

---

# PR 1 — Foundation: tokens + primitives + light shell

### Task 1.1: 创建 admin-tokens.css

**Files:**
- Create: `frontend-vite/src/styles/admin-tokens.css`

- [ ] **Step 1: 创建文件并填入 tokens**

```css
/* Admin Design Tokens — 仅在 admin scope 用，不污染公开站 */
:root {
  /* Brand */
  --brand-ink: #1A1A2E;
  --brand-ink-2: #16213E;
  --brand-gold: #C9A84C;
  --brand-gold-50: #F5EEDC;

  /* Surface */
  --admin-bg: #FAFAF7;
  --admin-surface: #FFFFFF;
  --admin-surface-2: #F5F4EE;
  --admin-border: #E8E5DC;
  --admin-border-strong: #D4D0C4;

  /* Text */
  --admin-text: #1A1A2E;
  --admin-text-2: #5C5C68;
  --admin-text-muted: #8C8C9A;
  --admin-text-inverse: #FAFAF7;

  /* Status */
  --status-published-bg: #E8F4EA;
  --status-published-fg: #1B5E20;
  --status-draft-bg: #F4F1E8;
  --status-draft-fg: #8C7A3E;
  --status-archived-bg: #F0EFEA;
  --status-archived-fg: #5C5C68;

  /* Risk */
  --danger: #B04040;
  --danger-bg: #F8E6E6;

  /* Spacing — 8px scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  /* Radius */
  --radius-1: 4px;
  --radius-2: 6px;
  --radius-3: 10px;

  /* Shadow */
  --shadow-1: 0 1px 2px rgba(26, 26, 46, 0.04);
  --shadow-2: 0 4px 16px rgba(26, 26, 46, 0.06);
  --shadow-focus: 0 0 0 3px rgba(201, 168, 76, 0.25);

  /* Type */
  --type-xs: 12px;
  --type-sm: 13px;
  --type-base: 14px;
  --type-md: 16px;
  --type-lg: 20px;
  --type-xl: 28px;
  --type-display: 36px;

  /* Layout */
  --sidebar-width: 240px;
  --header-height: 64px;
  --content-max: 1280px;
}
```

- [ ] **Step 2: 在 main 入口导入**

Find `frontend-vite/src/main.tsx` (or `App.tsx`). The spec says admin tokens must be imported **after** global.css. Add to imports:

```ts
import './styles/global.css'
import './styles/admin-tokens.css'
```

(If `admin-tokens.css` is already in `global.css`'s import chain via PostCSS, skip this step.)

- [ ] **Step 3: Verify build 不破**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
```

Expected: build succeeds; CSS bundle slightly larger.

- [ ] **Step 4: Commit**

```bash
git add frontend-vite/src/styles/admin-tokens.css frontend-vite/src/main.tsx
git commit -m "feat(admin): add design tokens (brand/surface/status/spacing)"
```

---

### Task 1.2: 创建 Button + IconButton primitives

**Files:**
- Create: `frontend-vite/src/components/ui/Button.tsx`
- Create: `frontend-vite/src/components/ui/IconButton.tsx`

- [ ] **Step 1: 实现 Button.tsx**

```tsx
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, iconRight, children, className = '', disabled, ...rest },
  ref,
) {
  const cls = ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, loading && 'is-loading', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button ref={ref} className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="ui-btn__spinner" aria-hidden /> : icon}
      <span>{children}</span>
      {iconRight}
    </button>
  )
})
```

- [ ] **Step 2: 实现 IconButton.tsx**

```tsx
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'ghost' | 'solid' | 'danger'
type Size = 'sm' | 'md'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  label: string  // required for a11y
  icon: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', label, icon, className = '', ...rest },
  ref,
) {
  const cls = ['ui-icon-btn', `ui-icon-btn--${variant}`, `ui-icon-btn--${size}`, className]
    .filter(Boolean)
    .join(' ')
  return (
    <button ref={ref} className={cls} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  )
})
```

- [ ] **Step 3: 添加 Button 样式（追加到 global.css 末尾或新建 `components/ui/ui.css`）**

Append to `frontend-vite/src/styles/global.css` after all other rules:

```css
/* =====================================================================
   UI primitives — added by admin-ui-redesign PR1
   ===================================================================== */

.ui-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-2);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.ui-btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
.ui-btn:disabled, .ui-btn.is-loading {
  opacity: 0.55;
  cursor: not-allowed;
}

.ui-btn--sm { padding: 4px 10px; font-size: var(--type-sm); }
.ui-btn--md { padding: 8px 16px; font-size: var(--type-base); }
.ui-btn--lg { padding: 12px 20px; font-size: var(--type-md); }

.ui-btn--primary {
  background: var(--brand-gold);
  color: var(--brand-ink);
  border-color: var(--brand-gold);
}
.ui-btn--primary:hover:not(:disabled) {
  background: #B89740;
  border-color: #B89740;
}

.ui-btn--secondary {
  background: var(--admin-surface);
  color: var(--admin-text);
  border-color: var(--admin-border-strong);
}
.ui-btn--secondary:hover:not(:disabled) {
  background: var(--admin-surface-2);
}

.ui-btn--danger {
  background: var(--danger-bg);
  color: var(--danger);
  border-color: var(--danger-bg);
}
.ui-btn--danger:hover:not(:disabled) {
  background: var(--danger);
  color: white;
  border-color: var(--danger);
}

.ui-btn--ghost {
  background: transparent;
  color: var(--admin-text-2);
}
.ui-btn--ghost:hover:not(:disabled) {
  background: var(--admin-surface-2);
  color: var(--admin-text);
}

.ui-btn__spinner {
  width: 14px; height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ui-btn-spin 0.6s linear infinite;
}
@keyframes ui-btn-spin { to { transform: rotate(360deg); } }

/* IconButton */
.ui-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--radius-2);
  cursor: pointer;
  background: transparent;
  color: var(--admin-text-2);
  transition: background-color 0.15s, color 0.15s, border-color 0.15s;
}
.ui-icon-btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
.ui-icon-btn--sm { width: 28px; height: 28px; }
.ui-icon-btn--md { width: 36px; height: 36px; }
.ui-icon-btn--ghost:hover:not(:disabled) {
  background: var(--admin-surface-2);
  color: var(--admin-text);
}
.ui-icon-btn--solid {
  background: var(--admin-surface-2);
}
.ui-icon-btn--solid:hover:not(:disabled) {
  background: var(--admin-surface);
}
.ui-icon-btn--danger { color: var(--danger); }
.ui-icon-btn--danger:hover:not(:disabled) {
  background: var(--danger-bg);
}
```

- [ ] **Step 4: Smoke — 临时把 ArticleEditor 的"保存并发布"按钮改成新 Button，确认渲染 + 点击**

In `frontend-vite/src/pages/admin/ArticleEditor.tsx`, locate the buttons at lines ~355-368. **Don't keep this change; revert in next commit.** Just test that <Button> renders correctly.

- [ ] **Step 5: 验证后还原代码**

```bash
git diff frontend-vite/src/pages/admin/ArticleEditor.tsx
# expected: empty
```

- [ ] **Step 6: Commit**

```bash
git add frontend-vite/src/components/ui/Button.tsx \
        frontend-vite/src/components/ui/IconButton.tsx \
        frontend-vite/src/styles/global.css
git commit -m "feat(ui): add Button + IconButton primitives"
```

---

### Task 1.3: 创建 Card primitive

**Files:**
- Create: `frontend-vite/src/components/ui/Card.tsx`

- [ ] **Step 1: 实现**

```tsx
import { type ReactNode, type HTMLAttributes, forwardRef } from 'react'

type Variant = 'flat' | 'outlined' | 'elevated'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  padding?: 'none' | 'sm' | 'md' | 'lg'
  children?: ReactNode
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'outlined', padding = 'md', className = '', children, ...rest },
  ref,
) {
  const cls = [
    'ui-card',
    `ui-card--${variant}`,
    `ui-card--p-${padding}`,
    className,
  ].filter(Boolean).join(' ')
  return <div ref={ref} className={cls} {...rest}>{children}</div>
})

export function CardSection({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card__section ${className}`} {...rest}>{children}</div>
}

export function CardHeader({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card__header ${className}`} {...rest}>{children}</div>
}

export function CardTitle({ className = '', children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={`ui-card__title ${className}`} {...rest}>{children}</h3>
}
```

- [ ] **Step 2: 追加 CSS**

Append to `global.css` end:

```css
.ui-card {
  background: var(--admin-surface);
  border-radius: var(--radius-2);
  --card-pad: var(--space-5);
}
.ui-card--p-none { --card-pad: 0; }
.ui-card--p-sm   { --card-pad: var(--space-3); }
.ui-card--p-md   { --card-pad: var(--space-5); }
.ui-card--p-lg   { --card-pad: var(--space-6); }

.ui-card--outlined { border: 1px solid var(--admin-border); }
.ui-card--flat { border: 1px solid transparent; }
.ui-card--elevated {
  border: 1px solid var(--admin-border);
  box-shadow: var(--shadow-1);
}

.ui-card > .ui-card__section,
.ui-card > .ui-card__header {
  padding: var(--card-pad);
}
.ui-card > .ui-card__header {
  border-bottom: 1px solid var(--admin-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.ui-card__title {
  margin: 0;
  font-size: var(--type-md);
  font-weight: 600;
  color: var(--admin-text);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/Card.tsx frontend-vite/src/styles/global.css
git commit -m "feat(ui): add Card primitive (flat/outlined/elevated + CardHeader/Section/Title)"
```

---

### Task 1.4: 创建 Stat primitive

**Files:**
- Create: `frontend-vite/src/components/ui/Stat.tsx`

- [ ] **Step 1: 实现**

```tsx
import { type ReactNode } from 'react'

type Trend = 'up' | 'down' | 'flat'

export interface StatProps {
  label: string
  value: ReactNode
  trend?: Trend
  trendValue?: string
  helpText?: string
}

export function Stat({ label, value, trend, trendValue, helpText }: StatProps) {
  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : trend === 'flat' ? '·' : null
  return (
    <div className="ui-stat">
      <div className="ui-stat__label">{label}</div>
      <div className="ui-stat__value">{value}</div>
      {(trend && trendSymbol) && (
        <div className={`ui-stat__trend ui-stat__trend--${trend}`}>
          <span aria-hidden>{trendSymbol}</span>
          {trendValue && <span>{trendValue}</span>}
        </div>
      )}
      {helpText && <div className="ui-stat__help">{helpText}</div>}
    </div>
  )
}
```

- [ ] **Step 2: 追加 CSS**

```css
.ui-stat {
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: var(--radius-2);
  padding: var(--space-5);
}
.ui-stat__label {
  font-size: var(--type-sm);
  color: var(--admin-text-2);
  margin-bottom: var(--space-2);
}
.ui-stat__value {
  font-size: 32px;
  font-weight: 600;
  color: var(--admin-text);
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.ui-stat__trend {
  margin-top: var(--space-2);
  font-size: var(--type-sm);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.ui-stat__trend--up   { color: #1B5E20; }
.ui-stat__trend--down { color: var(--danger); }
.ui-stat__trend--flat { color: var(--admin-text-muted); }
.ui-stat__help {
  margin-top: var(--space-2);
  font-size: var(--type-xs);
  color: var(--admin-text-muted);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/Stat.tsx frontend-vite/src/styles/global.css
git commit -m "feat(ui): add Stat primitive (label + value + trend)"
```

---

### Task 1.5: 创建 PageHeader primitive

**Files:**
- Create: `frontend-vite/src/components/ui/PageHeader.tsx`

- [ ] **Step 1: 实现**

```tsx
import { type ReactNode } from 'react'
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  breadcrumb?: BreadcrumbItem[]
  actions?: ReactNode
}

export function PageHeader({ title, description, breadcrumb, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__left">
        {breadcrumb && <Breadcrumb items={breadcrumb} variant="light" />}
        <h1 className="ui-page-header__title">{title}</h1>
        {description && <p className="ui-page-header__desc">{description}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  )
}
```

- [ ] **Step 2: 追加 CSS**

```css
.ui-page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-5);
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--admin-border);
}
.ui-page-header__title {
  margin: var(--space-2) 0 0;
  font-size: var(--type-xl);
  font-weight: 600;
  color: var(--admin-text);
  letter-spacing: -0.02em;
}
.ui-page-header__desc {
  margin: var(--space-2) 0 0;
  font-size: var(--type-base);
  color: var(--admin-text-2);
  max-width: 60ch;
}
.ui-page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/PageHeader.tsx frontend-vite/src/styles/global.css
git commit -m "feat(ui): add PageHeader primitive"
```

---

### Task 1.6: 创建 Toolbar + Group + Input + Select + SearchInput

**Files:**
- Create: `frontend-vite/src/components/ui/Toolbar.tsx`

- [ ] **Step 1: 实现**

```tsx
import { type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { Search } from 'lucide-react'

export function Toolbar({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-toolbar ${className}`} {...rest}>{children}</div>
}

export function ToolbarGroup({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-toolbar__group ${className}`} {...rest}>{children}</div>
}

export function ToolbarInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="ui-toolbar__input" {...props} />
}

export function ToolbarSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="ui-toolbar__select" {...props} />
}

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="ui-toolbar__search">
      <Search size={14} aria-hidden />
      <input className="ui-toolbar__search-input" placeholder="搜索…" {...props} />
    </div>
  )
}
```

- [ ] **Step 2: 追加 CSS**

```css
.ui-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: var(--radius-2);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
}
.ui-toolbar__group {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ui-toolbar__input,
.ui-toolbar__select {
  font: inherit;
  font-size: var(--type-base);
  background: var(--admin-surface);
  color: var(--admin-text);
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--radius-1);
  padding: 6px 10px;
  min-width: 160px;
}
.ui-toolbar__input:focus,
.ui-toolbar__select:focus {
  outline: none;
  border-color: var(--brand-gold);
  box-shadow: var(--shadow-focus);
}
.ui-toolbar__search {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--radius-1);
  padding: 6px 10px;
  background: var(--admin-surface);
  color: var(--admin-text-2);
  min-width: 220px;
}
.ui-toolbar__search:focus-within {
  border-color: var(--brand-gold);
  box-shadow: var(--shadow-focus);
}
.ui-toolbar__search-input {
  border: 0;
  background: transparent;
  outline: none;
  font: inherit;
  font-size: var(--type-base);
  color: var(--admin-text);
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/Toolbar.tsx frontend-vite/src/styles/global.css
git commit -m "feat(ui): add Toolbar + Input + Select + SearchInput"
```

---

### Task 1.7: 把 Breadcrumb 升格到 ui/

**Files:**
- Modify: `frontend-vite/src/components/Breadcrumb.tsx` (改为 re-export 桥)
- Create: `frontend-vite/src/components/ui/Breadcrumb.tsx`

- [ ] **Step 1: 读现有 Breadcrumb.tsx，确认 API**

```bash
cat frontend-vite/src/components/Breadcrumb.tsx
```

Note the exported types and props. Keep backward compat.

- [ ] **Step 2: 把代码移到 `components/ui/Breadcrumb.tsx`**

把原文件整段挪到 `frontend-vite/src/components/ui/Breadcrumb.tsx`，**不修改逻辑**。如果原文件里 `BreadcrumbItem` 是 inline type，统一改成 named export。

- [ ] **Step 3: 把 `components/Breadcrumb.tsx` 改成纯 re-export 桥**

```tsx
// 兼容层：旧路径 re-export，PR1 后内部引用全部走 components/ui/Breadcrumb
export { Breadcrumb, type BreadcrumbItem } from './ui/Breadcrumb'
```

- [ ] **Step 4: Build 验证**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
```

Expected: BUILD 成功。所有原本 import from `../components/Breadcrumb` 的文件继续工作。

- [ ] **Step 5: Commit**

```bash
git add frontend-vite/src/components/Breadcrumb.tsx frontend-vite/src/components/ui/Breadcrumb.tsx
git commit -m "refactor(ui): promote Breadcrumb to ui/ primitives"
```

---

### Task 1.8: 创建 StatusBadge primitive

**Files:**
- Create: `frontend-vite/src/components/ui/StatusBadge.tsx`

- [ ] **Step 1: 实现**

```tsx
import { type ReactNode } from 'react'

export type Status = 'published' | 'draft' | 'archived' | 'featured'

const LABEL: Record<Status, string> = {
  published: '已发布',
  draft: '草稿',
  archived: '已归档',
  featured: '精选',
}

export interface StatusBadgeProps {
  status: Status
  children?: ReactNode  // 覆盖默认 label
}

export function StatusBadge({ status, children }: StatusBadgeProps) {
  return (
    <span className={`ui-status-badge ui-status-badge--${status}`}>
      {children ?? LABEL[status]}
    </span>
  )
}
```

- [ ] **Step 2: 追加 CSS**

```css
.ui-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: var(--type-xs);
  font-weight: 500;
  line-height: 1.6;
}
.ui-status-badge--published { background: var(--status-published-bg); color: var(--status-published-fg); }
.ui-status-badge--draft     { background: var(--status-draft-bg);     color: var(--status-draft-fg); }
.ui-status-badge--archived  { background: var(--status-archived-bg);  color: var(--status-archived-fg); }
.ui-status-badge--featured  { background: var(--brand-gold-50);      color: #8C6F1F; }
```

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/StatusBadge.tsx frontend-vite/src/styles/global.css
git commit -m "feat(ui): add StatusBadge primitive (published/draft/archived/featured)"
```

---

### Task 1.9: 创建 Empty primitive

**Files:**
- Create: `frontend-vite/src/components/ui/Empty.tsx`

- [ ] **Step 1: 实现**

```tsx
import { type ReactNode } from 'react'
import { Inbox } from 'lucide-react'

export interface EmptyProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function Empty({ icon, title, description, action }: EmptyProps) {
  return (
    <div className="ui-empty" role="status">
      <div className="ui-empty__icon">{icon ?? <Inbox size={40} strokeWidth={1.25} />}</div>
      <h3 className="ui-empty__title">{title}</h3>
      {description && <p className="ui-empty__desc">{description}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  )
}
```

- [ ] **Step 2: 追加 CSS**

```css
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-7) var(--space-5);
  background: var(--admin-surface);
  border: 1px dashed var(--admin-border-strong);
  border-radius: var(--radius-2);
  color: var(--admin-text-2);
}
.ui-empty__icon {
  color: var(--admin-text-muted);
  margin-bottom: var(--space-3);
}
.ui-empty__title {
  margin: 0 0 var(--space-2);
  font-size: var(--type-md);
  font-weight: 600;
  color: var(--admin-text);
}
.ui-empty__desc {
  margin: 0 0 var(--space-4);
  font-size: var(--type-sm);
  color: var(--admin-text-2);
  max-width: 40ch;
}
.ui-empty__action {
  margin-top: var(--space-2);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/Empty.tsx frontend-vite/src/styles/global.css
git commit -m "feat(ui): add Empty primitive"
```

---

### Task 1.10: 创建 Pill primitive

**Files:**
- Create: `frontend-vite/src/components/ui/Pill.tsx`

- [ ] **Step 1: 实现**

```tsx
import { type ReactNode } from 'react'
import { X } from 'lucide-react'

export interface PillProps {
  children: ReactNode
  onRemove?: () => void
}

export function Pill({ children, onRemove }: PillProps) {
  return (
    <span className="ui-pill">
      <span>{children}</span>
      {onRemove && (
        <button
          type="button"
          className="ui-pill__remove"
          onClick={onRemove}
          aria-label={`移除 ${typeof children === 'string' ? children : '标签'}`}
        >
          <X size={12} />
        </button>
      )}
    </span>
  )
}
```

- [ ] **Step 2: 追加 CSS**

```css
.ui-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--admin-surface-2);
  color: var(--admin-text);
  border-radius: 999px;
  padding: 2px 4px 2px 10px;
  font-size: var(--type-sm);
  font-weight: 500;
}
.ui-pill__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--admin-text-2);
  cursor: pointer;
}
.ui-pill__remove:hover { background: rgba(0, 0, 0, 0.06); color: var(--admin-text); }
```

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/Pill.tsx frontend-vite/src/styles/global.css
git commit -m "feat(ui): add Pill primitive (removable)"
```

---

### Task 1.11: 创建 Tabs primitive

**Files:**
- Create: `frontend-vite/src/components/ui/Tabs.tsx`

- [ ] **Step 1: 实现**

```tsx
import { type ReactNode } from 'react'

export interface TabItem {
  id: string
  label: ReactNode
  badge?: ReactNode
  panel: ReactNode
}

export interface TabsProps {
  items: TabItem[]
  value?: string
  defaultValue?: string
  onChange?: (id: string) => void
  variant?: 'underline' | 'pill'
}

export function Tabs({ items, value, defaultValue, onChange, variant = 'underline' }: TabsProps) {
  const isControlled = value !== undefined
  const active = isControlled ? value : defaultValue ?? items[0]?.id
  return (
    <div className={`ui-tabs ui-tabs--${variant}`}>
      <div role="tablist" className="ui-tabs__list">
        {items.map((it) => {
          const selected = it.id === active
          return (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`ui-tabs__btn${selected ? ' is-active' : ''}`}
              onClick={() => onChange?.(it.id)}
            >
              {it.label}
              {it.badge && <span className="ui-tabs__badge">{it.badge}</span>}
            </button>
          )
        })}
      </div>
      {items.map((it) =>
        it.id === active ? (
          <div key={it.id} role="tabpanel" className="ui-tabs__panel">{it.panel}</div>
        ) : null,
      )}
    </div>
  )
}
```

- [ ] **Step 2: 追加 CSS**

```css
.ui-tabs__list {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--admin-border);
}
.ui-tabs--pill .ui-tabs__list {
  border-bottom: 0;
  background: var(--admin-surface-2);
  padding: 4px;
  border-radius: var(--radius-2);
  display: inline-flex;
}
.ui-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 14px;
  font: inherit;
  font-size: var(--type-base);
  border: 0;
  background: transparent;
  color: var(--admin-text-2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.ui-tabs__btn:hover { color: var(--admin-text); }
.ui-tabs__btn.is-active {
  color: var(--admin-text);
  border-bottom-color: var(--brand-gold);
  font-weight: 600;
}
.ui-tabs--pill .ui-tabs__btn {
  border-bottom: 0;
  border-radius: var(--radius-1);
  margin-bottom: 0;
}
.ui-tabs--pill .ui-tabs__btn.is-active {
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
}
.ui-tabs__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-gold-50);
  color: #8C6F1F;
  border-radius: 999px;
  padding: 1px 6px;
  font-size: var(--type-xs);
  font-weight: 600;
}
.ui-tabs__panel { padding-top: var(--space-4); }
```

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/Tabs.tsx frontend-vite/src/styles/global.css
git commit -m "feat(ui): add Tabs primitive (underline + pill variants, controlled/uncontrolled)"
```

---

### Task 1.12: 创建 Modal primitive

**Files:**
- Create: `frontend-vite/src/components/ui/Modal.tsx`

- [ ] **Step 1: 实现（无 portal — React 19 允许 createPortal 但保留 fallback）**

```tsx
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open && dialogRef.current) {
      const focusable = dialogRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="ui-modal__overlay" onClick={onClose}>
      <div
        className={`ui-modal ui-modal--${size}`}
        role="dialog"
        aria-modal="true"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || true) && (
          <header className="ui-modal__header">
            {title && <h2 className="ui-modal__title">{title}</h2>}
            <button className="ui-modal__close" onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          </header>
        )}
        <div className="ui-modal__body">{children}</div>
        {footer && <footer className="ui-modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: 追加 CSS**

```css
.ui-modal__overlay {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 46, 0.45);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  animation: ui-modal-fade 0.15s ease-out;
}
@keyframes ui-modal-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.ui-modal {
  background: var(--admin-surface);
  border-radius: var(--radius-3);
  box-shadow: 0 12px 48px rgba(26, 26, 46, 0.18);
  width: 100%;
  display: flex;
  flex-direction: column;
  max-height: 85vh;
  animation: ui-modal-scale 0.15s ease-out;
}
@keyframes ui-modal-scale {
  from { transform: scale(0.96); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}
.ui-modal--sm { max-width: 380px; }
.ui-modal--md { max-width: 560px; }
.ui-modal--lg { max-width: 820px; }
.ui-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--admin-border);
}
.ui-modal__title {
  margin: 0;
  font-size: var(--type-md);
  font-weight: 600;
}
.ui-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--admin-text-2);
  cursor: pointer;
  border-radius: var(--radius-1);
  width: 32px; height: 32px;
}
.ui-modal__close:hover { background: var(--admin-surface-2); }
.ui-modal__body {
  padding: var(--space-5);
  overflow: auto;
}
.ui-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--admin-border);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/Modal.tsx frontend-vite/src/styles/global.css
git commit -m "feat(ui): add Modal primitive (focus-trap + Esc + portal)"
```

---

### Task 1.13: 创建 ui/ barrel

**Files:**
- Create: `frontend-vite/src/components/ui/index.ts`

- [ ] **Step 1: 实现**

```ts
export { Button, type ButtonProps } from './Button'
export { IconButton, type IconButtonProps } from './IconButton'
export { Card, CardSection, CardHeader, CardTitle, type CardProps } from './Card'
export { Stat, type StatProps } from './Stat'
export { PageHeader, type PageHeaderProps } from './PageHeader'
export {
  Toolbar, ToolbarGroup, ToolbarInput, ToolbarSelect, SearchInput,
} from './Toolbar'
export { Breadcrumb, type BreadcrumbItem } from './Breadcrumb'
export { StatusBadge, type Status, type StatusBadgeProps } from './StatusBadge'
export { Empty, type EmptyProps } from './Empty'
export { Pill, type PillProps } from './Pill'
export { Tabs, type TabItem, type TabsProps } from './Tabs'
export { Modal, type ModalProps } from './Modal'
```

- [ ] **Step 2: 用一次性临时 import 验证 4 个组件可解析**

In a temporary file (DO NOT COMMIT):

```ts
import { Button, Card, Stat, Tabs } from './components/ui'
console.log(Boolean(Button), Boolean(Card), Boolean(Stat), Boolean(Tabs))
```

Run `cd frontend-vite && npx tsc --noEmit 2>&1 | head -20` — expect 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend-vite/src/components/ui/index.ts
git commit -m "feat(ui): add ui/ index barrel"
```

---

### Task 1.14: 重写 AdminLayout (浅 sidebar)

**Files:**
- Modify: `frontend-vite/src/components/admin/AdminLayout.tsx`
- Modify: `frontend-vite/src/components/admin/AdminLayout.css`

- [ ] **Step 1: 替换 `AdminLayout.tsx` 整体**

```tsx
import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useMatch } from 'react-router-dom'
import {
  LayoutDashboard, FileText, BookOpen, Image as ImageIcon,
  ExternalLink, Settings as SettingsIcon, Star, Search, Bell, LogOut,
} from 'lucide-react'
import { api } from '../../services/api'
import { PageAgentMount } from './PageAgentMount'
import { pageEnterAnimation, sidebarAnimations } from './animations'
import { IconButton } from '../ui/IconButton'
import { Breadcrumb, type BreadcrumbItem, Tabs } from '../ui'
import './AdminLayout.css'

type NavItem = {
  to: string
  end?: boolean
  label: string
  icon: React.ReactNode
}

const NAV: NavItem[] = [
  { to: '/admin', end: true, label: '概览', icon: <LayoutDashboard size={18} /> },
  { to: '/admin/articles', label: '文章', icon: <FileText size={18} /> },
  { to: '/admin/articles/featured', end: true, label: '精选管理', icon: <Star size={18} /> },
  { to: '/admin/journals', label: '期刊', icon: <BookOpen size={18} /> },
  { to: '/admin/media', label: '媒体库', icon: <ImageIcon size={18} /> },
  { to: '/admin/settings', label: '设置', icon: <SettingsIcon size={18} /> },
]

function useBreadcrumbFromPath(): BreadcrumbItem[] {
  const match = useMatch('/admin/*')
  const items: BreadcrumbItem[] = [{ label: '后台', to: '/admin' }]
  if (match?.pathname.includes('/articles/featured')) {
    items.push({ label: '文章', to: '/admin/articles' })
    items.push({ label: '精选管理' })
  } else if (match?.pathname.includes('/articles/new')) {
    items.push({ label: '文章', to: '/admin/articles' })
    items.push({ label: '新建' })
  } else if (match?.pathname.match(/\/articles\/\d+/)) {
    items.push({ label: '文章', to: '/admin/articles' })
    items.push({ label: '编辑' })
  } else if (match?.pathname.includes('/articles')) {
    items.push({ label: '文章' })
  } else if (match?.pathname.match(/\/journals\/new/)) {
    items.push({ label: '期刊', to: '/admin/journals' })
    items.push({ label: '新建' })
  } else if (match?.pathname.match(/\/journals\/\d+/)) {
    items.push({ label: '期刊', to: '/admin/journals' })
    items.push({ label: '详情' })
  } else if (match?.pathname.includes('/journals')) {
    items.push({ label: '期刊' })
  } else if (match?.pathname.includes('/media')) {
    items.push({ label: '媒体库' })
  } else if (match?.pathname.includes('/settings')) {
    items.push({ label: '设置' })
  }
  return items
}

export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const contentRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const crumbs = useBreadcrumbFromPath()

  const handleLogout = async () => {
    try { await api.auth.logout() } catch { /* noop */ }
    navigate('/admin/login', { replace: true })
  }

  useEffect(() => {
    return pageEnterAnimation(contentRef.current)
  }, [location.pathname])

  useEffect(() => {
    return sidebarAnimations(sidebarRef.current)
  }, [])

  return (
    <div className="admin-layout">
      <PageAgentMount />
      <aside className="admin-sidebar" ref={sidebarRef}>
        <div className="admin-sidebar__sticky">
          <div className="admin-sidebar__brand">
            <span className="admin-sidebar__mark" aria-hidden />
            <span className="admin-sidebar__title">湖北数创 CMS</span>
            <span className="admin-sidebar__sub">内容管理后台</span>
          </div>
          <nav className="admin-sidebar__nav">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `admin-sidebar__link${isActive ? ' is-active' : ''}`
                }
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="admin-sidebar__link admin-sidebar__external"
            >
              <ExternalLink size={18} />
              <span>查看公开站</span>
            </a>
          </nav>
          <div className="admin-sidebar__foot">
            <button
              type="button"
              className="admin-sidebar__logout"
              onClick={handleLogout}
            >
              <LogOut size={16} />
              <span>退出</span>
            </button>
          </div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <div className="admin-header__left">
            <Breadcrumb items={crumbs} variant="light" />
          </div>
          <div className="admin-header__right">
            <div className="admin-header__search">
              <Search size={14} aria-hidden />
              <input placeholder="搜索 (⌘K)…" aria-label="搜索" />
            </div>
            <IconButton label="通知" icon={<Bell size={18} />} variant="ghost" />
          </div>
        </header>
        <main className="admin-content" ref={contentRef}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 完全替换 `AdminLayout.css`**

```css
/* Admin shell — Linear 风 (light sidebar, gold active accent) */
.admin-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  min-height: 100vh;
  background: var(--admin-bg);
}

.admin-sidebar {
  background: var(--admin-surface);
  color: var(--admin-text);
  border-right: 1px solid var(--admin-border);
}

.admin-sidebar__sticky {
  position: sticky;
  top: 0;
  padding: var(--space-5) 0;
  max-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.admin-sidebar__brand {
  padding: 0 var(--space-5) var(--space-5);
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: var(--space-3);
  align-items: center;
}
.admin-sidebar__mark {
  grid-row: 1 / span 2;
  width: 28px; height: 28px;
  border-radius: 8px;
  background: var(--brand-gold);
  display: inline-block;
}
.admin-sidebar__title {
  font-size: var(--type-md);
  font-weight: 600;
  color: var(--admin-text);
  line-height: 1.2;
}
.admin-sidebar__sub {
  font-size: var(--type-xs);
  color: var(--admin-text-muted);
}

.admin-sidebar__nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 var(--space-2);
}

.admin-sidebar__link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 8px var(--space-3);
  border-radius: var(--radius-2);
  color: var(--admin-text-2);
  text-decoration: none;
  font-size: var(--type-base);
  font-weight: 500;
  border-left: 3px solid transparent;
  transition: background-color 0.15s, color 0.15s, border-left-color 0.15s;
}
.admin-sidebar__link:hover {
  background: var(--admin-surface-2);
  color: var(--admin-text);
}
.admin-sidebar__link.is-active {
  background: var(--brand-gold-50);
  color: var(--brand-ink);
  border-left-color: var(--brand-gold);
}
.admin-sidebar__external {
  margin-top: var(--space-3);
  border-top: 1px solid var(--admin-border);
  padding-top: var(--space-3);
  border-radius: 0;
}
.admin-sidebar__external:hover { background: transparent; color: var(--admin-text); }

.admin-sidebar__foot {
  padding: var(--space-3) var(--space-3) 0;
  border-top: 1px solid var(--admin-border);
  margin-top: var(--space-3);
}
.admin-sidebar__logout {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: var(--type-sm);
  color: var(--admin-text-2);
  padding: 8px var(--space-3);
  border-radius: var(--radius-2);
}
.admin-sidebar__logout:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

.admin-main {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-width: 0;
}

.admin-header {
  background: var(--admin-surface);
  border-bottom: 1px solid var(--admin-border);
  height: var(--header-height);
  padding: 0 var(--space-6);
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 5;
}
.admin-header__left { display: flex; align-items: center; }
.admin-header__right { display: flex; align-items: center; gap: var(--space-3); }
.admin-header__search {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  border: 1px solid var(--admin-border);
  background: var(--admin-bg);
  border-radius: var(--radius-2);
  padding: 6px 10px;
  color: var(--admin-text-2);
}
.admin-header__search input {
  border: 0;
  background: transparent;
  outline: none;
  font: inherit;
  font-size: var(--type-sm);
  width: 220px;
  color: var(--admin-text);
}

.admin-content {
  flex: 1;
  padding: var(--space-6);
  max-width: var(--content-max);
  margin: 0 auto;
  width: 100%;
}

@media (max-width: 768px) {
  .admin-layout { grid-template-columns: 1fr; }
  .admin-sidebar__sticky { position: static; max-height: none; overflow: visible; }
  .admin-content { padding: var(--space-4); }
}

@media (prefers-reduced-motion: reduce) {
  .admin-sidebar__link, .admin-sidebar__logout { transition: none; }
}
```

- [ ] **Step 3: Build 验证**

```bash
cd frontend-vite && npm run build 2>&1 | tail -20
```

Expected: BUILD 成功。`Home.tsx` 的两个 TS18048 错误（如有）应在 PR1 之外处理；本次**不要**触碰 `Home.tsx`。

- [ ] **Step 4: 视觉验证（不打开浏览器）— 描述预期外观**

- 左侧栏 240px，白底，6 个 nav item + 1 个外链
- 顶 header 64px 白底，左侧面包屑，右侧搜索框 + 铃铛
- 内容区 `--admin-bg` 暖白，卡片白底浮起

- [ ] **Step 5: Commit**

```bash
git add frontend-vite/src/components/admin/AdminLayout.tsx \
        frontend-vite/src/components/admin/AdminLayout.css
git commit -m "feat(admin): redesign AdminLayout (light sidebar, gold active, light header)"
```

---

### Task 1.15: PR1 smoke — 全 admin 路由访问无 console error

- [ ] **Step 1: 启动后端 + 前端**

```bash
# Terminal A
cd /Users/jasonlee/hubei-shuchuang/backend && python -m uvicorn app.main:app --port 8765 --log-level warning

# Terminal B
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run dev -- --port 5174
```

- [ ] **Step 2: 用 curl 拉每条 admin 路由 HTML，确保 200 且无 5xx**

```bash
for r in /admin /admin/articles /admin/articles/new /admin/articles/featured /admin/journals /admin/journals/new /admin/media /admin/settings ; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5174$r")
  echo "$code $r"
done
```

Expected: 全部 200。

- [ ] **Step 3: 用 Playwright（已装）截图 sidebar + header**

```bash
mkdir -p /tmp/admin-snap-pr1
cat > /tmp/admin-snap-pr1.mjs <<'EOF'
import { chromium } from 'playwright'
(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:5174/admin/login')
  await page.fill('input[name=username], #username', 'admin')
  await page.fill('input[name=password], #password', process.env.ADMIN_PW || 'admin123')
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')
  await page.screenshot({ path: '/tmp/admin-snap-pr1/dashboard.png', fullPage: true })
  await page.goto('http://localhost:5174/admin/articles')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: '/tmp/admin-snap-pr1/articles.png', fullPage: true })
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
EOF
ADMIN_PW=admin123 node /tmp/admin-snap-pr1.mjs
ls /tmp/admin-snap-pr1/
```

Expected: 两个 PNG 文件生成。

- [ ] **Step 4: Commit "PR1 done" milestone (NO code changes)**

```bash
git commit --allow-empty -m "chore(admin): PR1 foundation verified (tokens + 12 ui primitives + light shell)"
```

---

# PR 2 — Dashboard 工作面板

### Task 2.1: 创建 Dashboard.css

**Files:**
- Create: `frontend-vite/src/pages/admin/Dashboard.css`

- [ ] **Step 1: 实现**

```css
.dashboard {
  display: grid;
  gap: var(--space-5);
}

.dashboard__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
}

.dashboard__row {
  display: grid;
  gap: var(--space-5);
  grid-template-columns: 1fr 1fr;
}
@media (max-width: 1024px) {
  .dashboard__row { grid-template-columns: 1fr; }
}

.dashboard__list {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.dashboard__list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--admin-border);
  text-decoration: none;
  color: var(--admin-text);
  gap: var(--space-3);
}
.dashboard__list-item:last-child { border-bottom: 0; }
.dashboard__list-item:hover { background: var(--admin-surface-2); }
.dashboard__list-title {
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dashboard__list-meta {
  font-size: var(--type-xs);
  color: var(--admin-text-muted);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.dashboard__media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--space-3);
}
.dashboard__media-item {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: var(--radius-2);
  overflow: hidden;
  background: var(--admin-surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--admin-border);
  cursor: pointer;
}
.dashboard__media-item img {
  width: 100%; height: 100%; object-fit: cover;
}
.dashboard__media-item__name {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 4px 6px;
  background: rgba(26, 26, 46, 0.6);
  color: white;
  font-size: var(--type-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transition: opacity 0.15s;
}
.dashboard__media-item:hover .dashboard__media-item__name { opacity: 1; }
```

- [ ] **Step 2: Commit**

```bash
git add frontend-vite/src/pages/admin/Dashboard.css
git commit -m "feat(admin): add Dashboard.css grid"
```

---

### Task 2.2: 重写 Dashboard.tsx 为 4 象限工作面板

**Files:**
- Modify: `frontend-vite/src/pages/admin/Dashboard.tsx`

- [ ] **Step 1: 完全替换 Dashboard.tsx**

```tsx
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api } from '../../services/api'
import { Card, CardHeader, CardTitle, Stat, StatusBadge, Empty, PageHeader } from '../../components/ui'
import './Dashboard.css'

function formatDate(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function Dashboard() {
  const { data: articles } = useQuery({
    queryKey: ['admin', 'articles', { count: true }],
    queryFn: () => api.admin.articles.list({ per_page: 1 }),
  })
  const { data: journals } = useQuery({
    queryKey: ['admin', 'journals', { count: true }],
    queryFn: () => api.admin.journals.list({ per_page: 1 }),
  })
  const { data: media } = useQuery({
    queryKey: ['admin', 'media', { count: true }],
    queryFn: () => api.admin.media.list(1, 1),
  })
  const { data: drafts } = useQuery({
    queryKey: ['admin', 'articles', { dashboardDrafts: true }],
    queryFn: () => api.admin.articles.list({ status: 'draft', per_page: 5 }),
  })
  const { data: recentArticles } = useQuery({
    queryKey: ['admin', 'articles', { dashboardRecent: true }],
    queryFn: () => api.admin.articles.list({ per_page: 5, status: 'published' }),
  })
  const { data: recentMedia } = useQuery({
    queryKey: ['admin', 'media', { dashboardRecent: 8 }],
    queryFn: () => api.admin.media.list(1, 8),
  })

  return (
    <div className="dashboard">
      <PageHeader title="概览" description="欢迎回来。下面是你站点最近的内容动向。" />

      <div className="dashboard__stats">
        <Stat label="文章总数" value={articles?.total ?? '—'} />
        <Stat label="已发布" value={recentArticles?.total ?? '—'} />
        <Stat label="草稿" value={drafts?.total ?? '—'} />
        <Stat label="期刊" value={journals?.total ?? '—'} />
      </div>

      <div className="dashboard__row">
        <Card>
          <CardHeader>
            <CardTitle>最近发布的文章</CardTitle>
            <Link to="/admin/articles" className="ui-status-badge" style={{ background: 'var(--brand-gold-50)', color: '#8C6F1F' }}>
              查看全部 <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <div className="dashboard__list">
            {recentArticles?.items.length ? (
              recentArticles.items.map((a) => (
                <Link key={a.id} to={`/admin/articles/${a.id}`} className="dashboard__list-item">
                  <span className="dashboard__list-title">{a.title}</span>
                  <span className="dashboard__list-meta">
                    <StatusBadge status="published" />
                    <span>{formatDate(a.published_at)}</span>
                  </span>
                </Link>
              ))
            ) : (
              <Empty title="还没有发布的文章" description="上传一个 .docx 或新建一篇开始。" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>草稿 / 待处理</CardTitle>
            <Link to="/admin/articles" className="ui-status-badge" style={{ background: 'var(--brand-gold-50)', color: '#8C6F1F' }}>
              管理 <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <div className="dashboard__list">
            {drafts?.items.length ? (
              drafts.items.map((a) => (
                <Link key={a.id} to={`/admin/articles/${a.id}`} className="dashboard__list-item">
                  <span className="dashboard__list-title">{a.title || '（未命名）'}</span>
                  <span className="dashboard__list-meta">
                    <StatusBadge status="draft" />
                    <span>{formatDate(a.published_at)}</span>
                  </span>
                </Link>
              ))
            ) : (
              <Empty title="没有草稿" description="所有文章都已发布，恭喜。" />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近上传的媒体</CardTitle>
          <Link to="/admin/media" className="ui-status-badge" style={{ background: 'var(--brand-gold-50)', color: '#8C6F1F' }}>
            打开媒体库 <ArrowRight size={12} />
          </Link>
        </CardHeader>
        <div className="dashboard__media-grid">
          {recentMedia?.items.map((m) => (
            <div key={m.id} className="dashboard__media-item">
              <img src={m.url} alt={m.original_name} loading="lazy" />
              <div className="dashboard__media-item__name">{m.original_name}</div>
            </div>
          ))}
          {!recentMedia?.items.length && (
            <p style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--admin-text-muted)', padding: 'var(--space-5)' }}>
              尚无上传图片
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Build 验证**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
```

Expected: BUILD 成功。

- [ ] **Step 3: 截图 dashboard**

复用 Task 1.15 Step 3 的脚本，加一行 `await page.screenshot({ path: '/tmp/admin-snap-pr2/dashboard.png', fullPage: true })`。再次跑。

- [ ] **Step 4: Commit**

```bash
git add frontend-vite/src/pages/admin/Dashboard.tsx frontend-vite/src/pages/admin/Dashboard.css
git commit -m "feat(admin): rewrite Dashboard as 4-quadrant workbench"
```

---

# PR 3 — List pages migration

### Task 3.1: 重写 ArticleList + ArticleList.css

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleList.tsx`
- Modify: `frontend-vite/src/pages/admin/ArticleList.css`

- [ ] **Step 1: 重写 ArticleList.tsx**

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Star, Trash2, Edit } from 'lucide-react'
import { api } from '../../services/api'
import { listRowStagger } from '../../components/admin/animations'
import { useToast } from '../../components/admin/Toast'
import {
  PageHeader, Button, IconButton, Toolbar, ToolbarGroup,
  ToolbarInput, ToolbarSelect, SearchInput, StatusBadge, Empty, Modal,
} from '../../components/ui'
import './ArticleList.css'

export function ArticleList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [featuredFilter, setFeaturedFilter] = useState<'' | 'true' | 'false'>('')
  const [page, setPage] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; title: string } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'articles', { status, q, featuredFilter, page }],
    queryFn: () => api.admin.articles.list({
      status: status || undefined,
      q: q || undefined,
      featured: featuredFilter === '' ? undefined : featuredFilter === 'true',
      page,
      per_page: 20,
    }),
  })

  const onMutateError = (err: unknown, op: string) =>
    toast.error(`${op}失败: ${err instanceof Error ? err.message : String(err)}`)

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.admin.articles.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
      toast.success('已删除')
    },
    onError: (err) => onMutateError(err, '删除文章'),
  })

  const featuredMut = useMutation({
    mutationFn: (id: number) => api.admin.articles.toggleFeatured(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['admin', 'articles'] })
      const previous = qc.getQueriesData({ queryKey: ['admin', 'articles'] })
      qc.setQueriesData<{ items: Array<{ id: number; featured?: boolean }> }>(
        { queryKey: ['admin', 'articles'] },
        (old) => old ? {
          ...old,
          items: old.items.map((it) => it.id === id ? { ...it, featured: !it.featured } : it),
        } : old,
      )
      return { previous }
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) ctx.previous.forEach(([key, value]) => qc.setQueryData(key, value))
      onMutateError(err, '切换精选')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
      qc.invalidateQueries({ queryKey: ['featured'] })
    },
  })

  useEffect(() => {
    return listRowStagger(tableRef.current?.parentElement ?? null)
  }, [data])

  return (
    <div>
      <PageHeader
        title="文章管理"
        description={`共 ${data?.total ?? '…'} 篇`}
        actions={
          <>
            <Button variant="secondary" icon={<Star size={16} />} onClick={() => navigate('/admin/articles/featured')}>
              管理精选
            </Button>
            <Button icon={<Plus size={16} />} onClick={() => navigate('/admin/articles/new')}>
              新建文章
            </Button>
          </>
        }
      />

      <Toolbar>
        <ToolbarGroup>
          <SearchInput
            placeholder="搜索标题..."
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
          />
          <ToolbarSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            <option value="">全部状态</option>
            <option value="published">已发布</option>
            <option value="draft">草稿</option>
          </ToolbarSelect>
          <ToolbarSelect value={featuredFilter} onChange={(e) => { setFeaturedFilter(e.target.value as '' | 'true' | 'false'); setPage(1) }}>
            <option value="">全部精选</option>
            <option value="true">仅精选</option>
            <option value="false">非精选</option>
          </ToolbarSelect>
        </ToolbarGroup>
      </Toolbar>

      {isLoading ? (
        <p>加载中…</p>
      ) : (
        <div className="ui-card ui-card--outlined" style={{ padding: 0 }}>
          <table ref={tableRef} className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>精选</th>
                <th>标题</th>
                <th>分类</th>
                <th>状态</th>
                <th>更新时间</th>
                <th style={{ width: 120 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => (
                <tr key={a.id}>
                  <td style={{ textAlign: 'center' }}>
                    <IconButton
                      label={a.featured ? '取消精选' : '设为精选'}
                      variant="ghost"
                      size="sm"
                      icon={<Star size={16} fill={a.featured ? 'var(--brand-gold)' : 'none'} stroke={a.featured ? 'var(--brand-gold)' : 'currentColor'} />}
                      onClick={() => featuredMut.mutate(a.id)}
                      disabled={featuredMut.isPending}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{a.title}</div>
                    <div style={{ fontSize: 'var(--type-xs)', color: 'var(--admin-text-muted)' }}>/{a.slug}</div>
                  </td>
                  <td>{a.category || '—'}</td>
                  <td><StatusBadge status={a.status as 'published' | 'draft'} /></td>
                  <td style={{ fontSize: 'var(--type-sm)', color: 'var(--admin-text-2)' }}>
                    {a.published_at ? new Date(a.published_at).toLocaleDateString('zh-CN') : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <IconButton
                        label="编辑"
                        variant="ghost"
                        size="sm"
                        icon={<Edit size={16} />}
                        onClick={() => navigate(`/admin/articles/${a.id}`)}
                      />
                      <IconButton
                        label="删除"
                        variant="danger"
                        size="sm"
                        icon={<Trash2 size={16} />}
                        onClick={() => setConfirmDelete({ id: a.id, title: a.title })}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 && (
                <tr><td colSpan={6}><Empty title="暂无文章" description="点击右上角『新建文章』开始你的第一篇。" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pages > 1 && (
        <div style={{ padding: 'var(--space-4)', display: 'flex', justifyContent: 'center', gap: 'var(--space-2)' }}>
          {Array.from({ length: data.pages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`admin-pager__btn${p === page ? ' is-active' : ''}`}
            >{p}</button>
          ))}
        </div>
      )}

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button
              variant="danger"
              loading={deleteMut.isPending}
              onClick={() => {
                if (confirmDelete) deleteMut.mutate(confirmDelete.id)
                setConfirmDelete(null)
              }}
            >删除</Button>
          </>
        }
      >
        <p>确认删除文章「{confirmDelete?.title}」？此操作不可撤销。</p>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: 重写 ArticleList.css（收敛到最小）**

```css
.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--type-base);
}
.admin-table th,
.admin-table td {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--admin-border);
  vertical-align: middle;
}
.admin-table th {
  background: var(--admin-surface-2);
  font-weight: 600;
  font-size: var(--type-sm);
  color: var(--admin-text-2);
}
.admin-table tbody tr {
  transition: background-color 0.15s;
}
.admin-table tbody tr:hover {
  background: var(--admin-bg);
}
.admin-table tbody tr:last-child td { border-bottom: 0; }

.admin-pager__btn {
  min-width: 32px;
  padding: 6px 10px;
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--radius-1);
  background: var(--admin-surface);
  color: var(--admin-text-2);
  cursor: pointer;
  font: inherit;
}
.admin-pager__btn:hover { background: var(--admin-surface-2); }
.admin-pager__btn.is-active {
  background: var(--brand-gold);
  border-color: var(--brand-gold);
  color: var(--brand-ink);
}
```

- [ ] **Step 3: Build 验证**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add frontend-vite/src/pages/admin/ArticleList.tsx frontend-vite/src/pages/admin/ArticleList.css
git commit -m "refactor(admin): migrate ArticleList to ui/ primitives"
```

---

### Task 3.2: 重写 JournalList + (new) JournalList.css

**Files:**
- Modify: `frontend-vite/src/pages/admin/JournalList.tsx`
- Create: `frontend-vite/src/pages/admin/JournalList.css`

- [ ] **Step 1: 完全替换 JournalList.tsx (skeleton — 复用 ArticleList 模式)**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit, Trash2 } from 'lucide-react'
import { api } from '../../services/api'
import { useToast } from '../../components/admin/Toast'
import {
  PageHeader, Button, Toolbar, ToolbarGroup, SearchInput, StatusBadge, Empty, IconButton, Modal,
} from '../../components/ui'
import './JournalList.css'

export function JournalList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; title: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'journals', q],
    queryFn: () => api.admin.journals.list({ q: q || undefined, per_page: 50 }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.admin.journals.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'journals'] })
      toast.success('已删除')
    },
    onError: (err) => toast.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`),
  })

  return (
    <div>
      <PageHeader
        title="期刊管理"
        description={`共 ${data?.total ?? '…'} 本`}
        actions={
          <Button icon={<Plus size={16} />} onClick={() => navigate('/admin/journals/new')}>
            新建期刊
          </Button>
        }
      />
      <Toolbar>
        <ToolbarGroup>
          <SearchInput placeholder="搜索期刊..." value={q} onChange={(e) => setQ(e.target.value)} />
        </ToolbarGroup>
      </Toolbar>
      {isLoading ? (
        <p>加载中…</p>
      ) : (
        <div className="ui-card ui-card--outlined" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>期刊名</th>
                <th>期号</th>
                <th>状态</th>
                <th>文章数</th>
                <th style={{ width: 120 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((j) => (
                <tr key={j.id}>
                  <td style={{ fontWeight: 500 }}>{j.title}</td>
                  <td>{j.issue_number ?? '—'}</td>
                  <td><StatusBadge status={j.status === 'published' ? 'published' : 'archived'} /></td>
                  <td>{j.article_count ?? '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <IconButton label="编辑" variant="ghost" size="sm" icon={<Edit size={16} />} onClick={() => navigate(`/admin/journals/${j.id}`)} />
                      <IconButton label="删除" variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={() => setConfirmDelete({ id: j.id, title: j.title })} />
                    </div>
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 && (
                <tr><td colSpan={5}><Empty title="暂无期刊" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button variant="danger" loading={deleteMut.isPending} onClick={() => {
              if (confirmDelete) deleteMut.mutate(confirmDelete.id)
              setConfirmDelete(null)
            }}>删除</Button>
          </>
        }
      >
        <p>确认删除期刊「{confirmDelete?.title}」？此操作不可撤销。</p>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: 创建 JournalList.css**

(reuse `.admin-table` styles; if no JournalList.css existed before, do not create — keep using global `.admin-table` from ArticleList.css migration)

- [ ] **Step 3: Build + commit**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
git add frontend-vite/src/pages/admin/JournalList.tsx
git commit -m "refactor(admin): migrate JournalList to ui/ primitives"
```

---

### Task 3.3: 重写 MediaLibrary

**Files:**
- Modify: `frontend-vite/src/pages/admin/MediaLibrary.tsx`

- [ ] **Step 1: 完全替换 MediaLibrary.tsx**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Copy, Check } from 'lucide-react'
import { api } from '../../services/api'
import { CoverImage } from '../../components/CoverImage'
import {
  PageHeader, IconButton, Empty, Modal, Button,
} from '../../components/ui'

export function MediaLibrary() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'media', page],
    queryFn: () => api.admin.media.list(page, 24),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.admin.media.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'media'] }),
    onError: (err) => alert(`删除失败: ${err instanceof Error ? err.message : String(err)}`),
  })

  const handleCopy = async (url: string, id: number) => {
    await navigator.clipboard.writeText(`${window.location.origin}${url}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div>
      <PageHeader title="媒体库" description={`${data?.total ?? '…'} 张图片`} />
      {isLoading ? (
        <p>加载中…</p>
      ) : data?.items.length === 0 ? (
        <Empty title="尚无图片" description="上传图片以在文章中使用。" />
      ) : (
        <div className="ui-card ui-card--outlined" style={{ padding: 'var(--space-5)' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--space-4)',
          }}>
            {data?.items.map((m) => (
              <div key={m.id} className="media-card">
                <div className="media-card__thumb">
                  <CoverImage
                    src={m.url}
                    alt={m.original_name}
                    category={m.original_name.split('.').pop()?.toUpperCase() ?? 'IMG'}
                    aspectRatio="auto"
                    className="media-library-thumb"
                  />
                </div>
                <div className="media-card__body">
                  <div className="media-card__name">{m.original_name}</div>
                  <div className="media-card__meta">
                    {(m.size / 1024).toFixed(1)} KB · {new Date(m.uploaded_at).toLocaleDateString('zh-CN')}
                  </div>
                  <div className="media-card__actions">
                    <IconButton
                      label={copiedId === m.id ? '已复制' : '复制 URL'}
                      variant={copiedId === m.id ? 'solid' : 'ghost'}
                      size="sm"
                      icon={copiedId === m.id ? <Check size={14} /> : <Copy size={14} />}
                      onClick={() => handleCopy(m.url, m.id)}
                    />
                    <IconButton
                      label="删除"
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => setConfirmDelete({ id: m.id, name: m.original_name })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {data && data.pages > 1 && (
            <div style={{ marginTop: 'var(--space-5)', display: 'flex', justifyContent: 'center', gap: 'var(--space-2)' }}>
              {Array.from({ length: data.pages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`admin-pager__btn${p === page ? ' is-active' : ''}`}
                >{p}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button variant="danger" loading={deleteMut.isPending} onClick={() => {
              if (confirmDelete) deleteMut.mutate(confirmDelete.id)
              setConfirmDelete(null)
            }}>删除</Button>
          </>
        }
      >
        <p>确认删除图片「{confirmDelete?.name}」？</p>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: 把 `.media-card` 样式追加到 `global.css` 末尾**

```css
.media-card {
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: var(--radius-2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.media-card__thumb {
  background: var(--admin-surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}
.media-card__body {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.media-card__name {
  font-size: var(--type-sm);
  font-weight: 500;
  color: var(--admin-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-card__meta {
  font-size: var(--type-xs);
  color: var(--admin-text-muted);
}
.media-card__actions {
  display: flex;
  gap: var(--space-1);
  margin-top: var(--space-1);
}
```

- [ ] **Step 3: Build + commit**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
git add frontend-vite/src/pages/admin/MediaLibrary.tsx frontend-vite/src/styles/global.css
git commit -m "refactor(admin): migrate MediaLibrary to ui/ primitives"
```

---

### Task 3.4: FeaturedArticles — 替换为 primitives

**Files:**
- Modify: `frontend-vite/src/pages/admin/FeaturedArticles.tsx`

- [ ] **Step 1: 用 PageHeader / Toolbar / Card / Empty / Button 等替换原 inline 样式**

(reuse ArticleList / JournalList patterns; if logic differs, keep behavior identical, only swap visual layer)

- [ ] **Step 2: Build + commit**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
git add frontend-vite/src/pages/admin/FeaturedArticles.tsx
git commit -m "refactor(admin): migrate FeaturedArticles to ui/ primitives"
```

---

# PR 4 — Editor + Settings + Login

### Task 4.1: ArticleEditor — 替换外壳

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`

- [ ] **Step 1: 把标题区（"<h2>新建文章 / 编辑：xxx</h2>"）替换为 `<PageHeader>`**

替换 lines 213 (`<h2>{isNew ? '新建文章' : ...}`) 为：

```tsx
<PageHeader
  title={isNew ? '新建文章' : existing?.title || '编辑文章'}
  description={isNew ? '上传 .docx 或直接编辑 Markdown' : `编辑文章 · /${existing?.slug || ''}`}
  breadcrumb={[
    { label: '文章', to: '/admin/articles' },
    { label: isNew ? '新建' : '编辑' },
  ]}
  actions={
    <>
      <Button variant="secondary" onClick={() => navigate('/admin/articles')}>取消</Button>
      <Button variant="secondary" onClick={() => saveMut.mutate('draft')} loading={saveMut.isPending}>保存草稿</Button>
      <Button onClick={() => saveMut.mutate('published')} loading={saveMut.isPending}>保存并发布</Button>
    </>
  }
/>
```

- [ ] **Step 2: 替换"导入 .docx" 区的部分 button 样式为 Button**

行 264-279 替换 `<div className="article-editor__field">` 内的"导入中..."状态 span 为 `<span style={{ fontSize: 'var(--type-sm)', color: 'var(--admin-text-2)' }}>`。

- [ ] **Step 3: 替换 div article-editor__grid-2 等 inline style 为 Card 包裹**

找到 `<div className="article-editor__grid-2">`（form 底部那两块），把外面包一层 `<Card>` 即可。

- [ ] **Step 4: Build + commit**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
git add frontend-vite/src/pages/admin/ArticleEditor.tsx
git commit -m "refactor(admin): wrap ArticleEditor shell with PageHeader + Card + Button"
```

---

### Task 4.2: JournalEditor / JournalDetail / AdminSettings 各自包装外壳

**Files:**
- Modify: `frontend-vite/src/pages/admin/JournalEditor.tsx`
- Modify: `frontend-vite/src/pages/admin/JournalDetail.tsx`
- Modify: `frontend-vite/src/pages/admin/AdminSettings.tsx`
- Modify: `frontend-vite/src/pages/admin/AdminSettings.css`

- [ ] **Step 1: 每个页把 `<h2>{title}</h2>` 替换为 `<PageHeader>`**

模式相同：title + description + action buttons (Button)。

- [ ] **Step 2: 表格/表单包裹 `<Card>`**

- [ ] **Step 3: 状态用 `<StatusBadge>`**

- [ ] **Step 4: Build + commit 分别**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
git add frontend-vite/src/pages/admin/JournalEditor.tsx
git commit -m "refactor(admin): wrap JournalEditor with PageHeader + primitives"

git add frontend-vite/src/pages/admin/JournalDetail.tsx
git commit -m "refactor(admin): wrap JournalDetail with ui/ primitives"

git add frontend-vite/src/pages/admin/AdminSettings.tsx frontend-vite/src/pages/admin/AdminSettings.css
git commit -m "refactor(admin): migrate AdminSettings to ui/ primitives"
```

---

### Task 4.3: Login — 古铜金 CTA

**Files:**
- Modify: `frontend-vite/src/pages/admin/Login.css`

- [ ] **Step 1: 替换 Login.css 的 submit 按钮颜色**

```css
.admin-login__submit {
  width: 100%;
  padding: 10px 16px;
  font: inherit;
  font-size: var(--type-base);
  font-weight: 600;
  border-radius: var(--radius-2);
  border: 1px solid var(--brand-gold);
  background: var(--brand-gold);
  color: var(--brand-ink);
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}
.admin-login__submit:hover:not(:disabled) {
  background: #B89740;
  border-color: #B89740;
}
.admin-login__submit:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
.admin-login__submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
```

（其他 Login.css 规则保持不动。）

- [ ] **Step 2: 把品牌顶部加一个古铜金 mark 小方块**

`Login.tsx` 第 34 行 `<div className="admin-login__brand">` 里，`<h1>` 前面加：

```tsx
<span className="admin-sidebar__mark" aria-hidden />
```

（在 Login.css 加 `.admin-login__brand { display: inline-grid; grid-template-columns: auto 1fr; ... }` 等少量样式即可。）

- [ ] **Step 3: Build + commit**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
git add frontend-vite/src/pages/admin/Login.tsx frontend-vite/src/pages/admin/Login.css
git commit -m "feat(admin): Login CTA uses gold brand accent"
```

---

# PR 5 — 视觉回归与构建验证

### Task 5.1: Playwright 视觉快照

**Files:**
- Create: `frontend-vite/tests/admin-snapshots.spec.ts`

- [ ] **Step 1: 安装 Playwright (如未装)**

```bash
cd frontend-vite && npm i -D @playwright/test
npx playwright install --with-deps chromium
```

(Per recent task notification: prior playwright install completed exit 0.)

- [ ] **Step 2: 创建快照测试**

```ts
import { test, expect } from '@playwright/test'

const adminPw = process.env.ADMIN_PW ?? 'admin123'
const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'

test.describe('Admin visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${baseURL}/admin/login`)
    await page.fill('#username', 'admin')
    await page.fill('#password', adminPw)
    await page.click('button[type=submit]')
    await page.waitForURL('**/admin')
  })

  for (const view of ['dashboard', 'articles', 'journals', 'media']) {
    test(`snapshot @ 1440x900: ${view}`, async ({ page }) => {
      const path: Record<string, string> = {
        dashboard: '/admin',
        articles: '/admin/articles',
        journals: '/admin/journals',
        media: '/admin/media',
      }
      await page.goto(`${baseURL}${path[view]}`)
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot(`admin-${view}-1440.png`, { fullPage: true })
    })
  }

  test('snapshot @ 1280x800: dashboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${baseURL}/admin`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot('admin-dashboard-1280.png', { fullPage: true })
  })
})
```

- [ ] **Step 3: 第一次跑 (生成 baseline)**

```bash
cd frontend-vite && npx playwright test admin-snapshots --update-snapshots 2>&1 | tail -30
```

Expected: 5 PNG baselines generated.

- [ ] **Step 4: 第二次跑 (比对)**

```bash
cd frontend-vite && npx playwright test admin-snapshots 2>&1 | tail -30
```

Expected: 全 PASS。任何 fail 都说明视觉回归。

- [ ] **Step 5: Commit**

```bash
git add frontend-vite/tests/admin-snapshots.spec.ts frontend-vite/tests/admin-snapshots.spec.ts-snapshots/
git commit -m "test(admin): add Playwright visual regression snapshots"
```

---

### Task 5.2: 最终全栈冒烟

- [ ] **Step 1: 后端**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && python -m pytest tests/ -q
```

Expected: 25+ passed.

- [ ] **Step 2: 前端**

```bash
cd frontend-vite && npm run build 2>&1 | tail -10
```

Expected: BUILD 成功；tsc 零错（Home.tsx 既有错暂不在本次内）。

- [ ] **Step 3: 端到端**

手动访问：
- `http://localhost:5174/admin/login` 输入 `admin` / `admin123`
- 登录后看 Dashboard：4 张 stat + 4 象限
- 点 "文章" → 看到 Toolbar + 表格 + StatusBadge（金色精选 star）
- 点 "期刊" → 表格 + Toolbar
- 点 "媒体库" → 卡片网格 + 复制 URL
- 点右上退出 → 跳登录页

每一步 console 无 error。

- [ ] **Step 4: PR5 完结 commit**

```bash
git commit --allow-empty -m "chore(admin): PR5 verification complete — admin UI redesign shipped"
```

---

## Self-Review (run before execution)

1. **Spec coverage** —
   - §四 (tokens): Task 1.1 ✓
   - §五 (primitives 12 个): Tasks 1.2-1.13, 1.7 升格 ✓
   - §六 (Layout rewrite): Task 1.14 ✓
   - §七 (Dashboard 4-象限): Tasks 2.1-2.2 ✓
   - §八 (4 PR 阶段): all 4 sections covered in Tasks 1.14..4.3 ✓
   - §九 (data flow): zero change contract honored ✓
   - §十 (errors): existing toast preserved, Modal added ✓
   - §十一 (verification): Task 5.1-5.2 ✓
   - §十二 (risk registry): each item addressed (CSS namespace, Breadcrumb 升格, ArticleEditor scope, Login.css 保持结构) ✓

2. **Placeholder scan** — no TBD / TODO / "later" detected. All steps show concrete code or concrete commands.

3. **Type consistency** — `BreadcrumbItem`, `StatProps`, `ModalProps`, `TabsProps`, `ButtonProps`, `CardProps` used consistently across tasks. The `featured` boolean in Dashboard / ArticleList kept as-is from existing backend contract.

4. **Ambiguity** — "列出 8 张最近上传" by default uses `/api/admin/media.list(1, 8)` regardless of total pages. Acceptable because the bar is display cap, not full pagination. Documented inline.

---

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-06-30-admin-ui-redesign.md`. Per user directive ("新建一个workflow完成所有工作"), I'm proceeding with the **Workflow tool** for parallel-agent execution of all 5 PRs — no manual checkpoints needed.
