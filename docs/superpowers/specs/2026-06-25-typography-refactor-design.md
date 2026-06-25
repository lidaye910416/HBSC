# 全局排版重构 — 设计文档

**日期：** 2026-06-25
**范围：** 前端 typography + 通用 Breadcrumb 组件 + 所有详情页迁移
**目标：**
1. 修复文章详情页表格等 markdown 元素的排版问题
2. 修复面包屑与 eyebrow 分类重复的细节 bug
3. 全局统一 typography 类与 Breadcrumb 组件
4. 引入 Cormorant Garamond 字体，实现 CLAUDE.md 中已声明但未落地的设计意图

---

## 1. 现状问题

### 1.1 视觉问题（截图证据）

| 现象 | 文件:行 |
|------|---------|
| 面包屑分类"战略与政策"与 eyebrow 分类重复显示 | `ArticleDetail.tsx:199-204, 207` |
| 面包屑是纯文本堆叠，无分隔符样式 | `ArticleDetail.css` 缺 `.article-detail__breadcrumbs` 样式 |
| H1 文章标题"关于...规划纲要的解读报告"被截断 | `ArticleDetail.css:35-39` 缺 `text-wrap: balance` / `overflow-wrap` |
| 文章详情页缺 hero/eyebrow 样式 | `ArticleDetail.css` 缺 `.article-detail__hero` / `__eyebrow` |

### 1.2 架构问题

| 问题 | 证据 |
|------|------|
| 没有通用 `Breadcrumb` 组件 | 3 处页面（ArticleDetail / IssueDetail / Articles）各自内联实现 |
| Markdown 样式散落在每个详情页 CSS | `ArticleDetail.css:60-169` + `IssueDetail.css` 类似块 |
| CLAUDE.md 提到的 Cormorant Garamond 未引入 | `global.css:1` 只引入了 Noto Serif SC / Sans SC / Inter |
| 表格样式简陋，无斑马纹/hover | `ArticleDetail.css:135-151` 仅基础 border + padding |

### 1.3 内容格式确认

- 后端模型：`Article.content`（`backend/app/models/article.py:20`，Markdown 原文）
- 前端渲染：`react-markdown` + `remark-gfm`（`ArticleDetail.tsx:4-5`）
- 不是 `dangerouslySetInnerHTML`，是组件式渲染

---

## 2. 设计目标

**精品出版物风格** —— 适合战略/研究类长文深阅读。Noto Serif SC 作正文，引入 Cormorant Garamond 作英文标题，加大行高与段距，首字下沉，表格斑马纹与 hover 高亮。

**实现方式：** 自定义 `.prose` 类族（不引入 Tailwind Typography 插件），用全局 CSS 一次定义、多页复用。

---

## 3. 架构设计

### 3.1 Typography 类族（新增于 `global.css`）

| 类 | 用途 | 关键参数 |
|----|------|----------|
| `.prose` | 基础长文正文 | 1.0625rem, line-height 1.9, max-width 720px |
| `.prose-lg` | 详情页主文（用 `.prose` + 加强标题/段距） | 1.125rem, line-height 1.95, drop cap on first p |
| `.prose-sm` | 卡片摘要/侧栏简介 | 0.9375rem, line-height 1.7 |

`.prose` 内置对以下元素的全套样式：
- `h1`–`h6`、段落、列表（ul/ol/li）、强调（strong/em）
- 引用（blockquote，带大引号 ::before）
- 行内代码、代码块（pre+code）
- **表格（带斑马纹、hover 高亮、响应式横向滚动）**
- 图片、figure/figcaption
- 链接、分割线（hr 渐变）
- 内嵌脚注（`.footnote`）

### 3.2 字体策略

```css
/* global.css 第 1 行 Google Fonts 引入新增 */
@import url('...&family=Cormorant+Garamond:wght@400;500;600;700&display=swap');

:root {
  --font-display-en: 'Cormorant Garamond', serif;
  --font-serif-cn: 'Noto Serif SC', 'Songti SC', serif;
  --font-sans-cn: 'Noto Sans SC', 'PingFang SC', sans-serif;
}

/* H1/H2 字体策略：纯英文 → Cormorant Garamond；中文 → Noto Serif SC；混排 → 中文优先 */
.prose h1:lang(en),
.prose h2:lang(en) { font-family: var(--font-display-en); }
.prose h1,
.prose h2,
.prose h3 { font-family: var(--font-serif-cn); }
```

实际生效策略（无需 `lang` 属性）：用 `:lang(zh)` 匹配 + 默认 fallback。或更简单 —— 通过 CSS `unicode-range` 让 Cormorant Garamond 仅作用于拉丁字符，中文自动 fallback 到 Noto Serif SC（这是 Google Fonts 的标准行为，最稳定）。

### 3.3 通用 `<Breadcrumb>` 组件

**文件：** `frontend-vite/src/components/Breadcrumb.tsx` + `Breadcrumb.css`

```tsx
interface BreadcrumbItem {
  label: string;
  to?: string;  // 不传则为当前页
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  variant?: 'dark' | 'light';  // 默认 light
  className?: string;
}

// 用法
<Breadcrumb
  variant="dark"
  items={[
    { label: '首页', to: '/' },
    { label: '文章', to: '/articles' },
    { label: article.category, to: `/articles?category=${encodeURIComponent(article.category)}` },
    { label: article.title },
  ]}
/>
```

**行为细节：**
- 自动渲染分隔符（ChevronRight from lucide-react）
- 最后一项渲染为 `<span>` + `aria-current="page"`
- 中间项渲染为 `<Link>`
- 自带 `aria-label="面包屑"`、`role="navigation"`、`ol/li` 结构（语义化）
- `variant="dark"` 用半透明白色文字（适配深色 hero），`light` 用 ink 色文字
- 支持空 items 数组（不渲染）

### 3.4 关键样式细节

#### 表格（精品出版物核心）
```css
.prose table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
  margin: 2rem 0;
  /* 响应式：包裹 div 实现横向滚动 */
}
.prose th {
  background: var(--color-accent-soft);
  padding: 0.75rem 1rem;
  font-weight: 600;
  text-align: left;
  border-bottom: 2px solid var(--color-accent);
  color: var(--color-ink);
}
.prose td {
  padding: 0.625rem 1rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}
.prose tbody tr:nth-child(even) td {
  background: var(--color-paper-warm);
}
.prose tbody tr:hover td {
  background: var(--color-accent-light);
  transition: background var(--transition-fast);
}

/* 移动端响应式：表格包 .prose-table-wrap 横向滚动 */
.prose-table-wrap {
  overflow-x: auto;
  margin: 2rem 0;
  border-radius: 8px;
  border: 1px solid var(--color-border);
}
```

#### 首字下沉（drop cap）
```css
.prose-lg > p:first-of-type::first-letter,
.prose-lg > p:first-child::first-letter {
  float: left;
  font-family: var(--font-display-en);
  font-size: 3.5em;
  line-height: 0.85;
  font-weight: 600;
  margin: 0.1em 0.15em 0 0;
  color: var(--color-accent);
}
```

#### 引用（大引号）
```css
.prose blockquote {
  position: relative;
  border-left: 4px solid var(--color-accent);
  background: var(--color-accent-soft);
  padding: 1.25rem 1.5rem;
  margin: 2rem 0;
  font-style: italic;
  color: var(--color-ink-deep);
  border-radius: 0 8px 8px 0;
}
.prose blockquote::before {
  content: '❝';
  position: absolute;
  top: -0.25em;
  left: 0.5em;
  font-size: 3em;
  font-family: var(--font-display-en);
  color: var(--color-accent);
  opacity: 0.3;
  line-height: 1;
}
```

#### 标题层级
```css
.prose h1 {
  font-family: var(--font-serif-cn);
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 1.5rem;
  color: var(--color-ink);
  text-wrap: balance;  /* 解决长标题截断 */
  overflow-wrap: anywhere;
}
.prose h2 {
  font-family: var(--font-serif-cn);
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 2.5rem 0 1rem;
  padding-left: 0.875rem;
  border-left: 3px solid var(--color-accent);
  color: var(--color-ink);
}
.prose h3 {
  font-family: var(--font-serif-cn);
  font-size: 1.35rem;
  font-weight: 600;
  margin: 2rem 0 0.75rem;
  color: var(--color-ink-deep);
}
```

---

## 4. 迁移策略

### 4.1 删除/收敛的样式

| 文件 | 删除范围 |
|------|----------|
| `ArticleDetail.css:60-169` | 整个 markdown typography 块（改用 `.prose-lg`） |
| `ArticleDetail.css` 内 `.article-detail__breadcrumbs` 相关（如果存在） | 改用 `<Breadcrumb variant="dark">` |
| `ArticleDetail.css` 内 `.article-detail__eyebrow` | 改为 `<Breadcrumb>` 自动渲染分类 |
| `IssueDetail.css` 重复的 markdown typography | 改用 `.prose-lg` |
| `IssueDetail.css:77-99` 面包屑样式 | 改用 `<Breadcrumb>` |
| `Articles.css:94-102` 面包屑样式 | 改用 `<Breadcrumb>` |

### 4.2 详情页接入

| 页面 | Breadcrumb items | Prose 类 |
|------|------------------|----------|
| `ArticleDetail` | 首页 > 文章 > 分类 > 标题 | `.prose-lg` + table wrap |
| `IssueDetail` | 首页 > 期刊 > 期号 > 标题 | `.prose-lg` + table wrap |
| `Articles` | 首页 | 仅 Breadcrumb，无 prose |
| `Insights` | 首页 > 前沿资讯 | `.prose`（如详情页） |

### 4.3 修复截图中的 bug

| Bug | 修复方式 |
|-----|----------|
| 分类"战略与政策"重复显示 | 删除 `ArticleDetail.tsx:207` 的 eyebrow 分类展示；如需保留"研究员"/"刊号"信息，eyebrow 改为显示 `article.issue?.title` 或 `article.published_at` |
| H1 截断 | `.prose h1` 加 `text-wrap: balance; overflow-wrap: anywhere` |
| 面包屑是纯文本 | 改为 `<Breadcrumb>` 组件，自动 gap + 分隔符 |
| 缺 hero 样式 | 保留 `.article-detail__hero` 既有结构，添加缺失的 padding/background CSS |

---

## 5. 改动文件清单

| 文件 | 类型 | 改动 |
|------|------|------|
| `frontend-vite/src/styles/global.css` | 改 | +Cormorant Garamond @import + `--font-display-en` + `.prose*` 类族（约 200 行） |
| `frontend-vite/tailwind.config.js` | 改 | +`fontFamily.display` 映射到 Cormorant Garamond |
| `frontend-vite/src/components/Breadcrumb.tsx` | 新建 | 通用组件（约 60 行） |
| `frontend-vite/src/components/Breadcrumb.css` | 新建 | 样式（约 50 行） |
| `frontend-vite/src/pages/ArticleDetail.tsx` | 改 | 用 Breadcrumb + `.prose-lg`，删除 eyebrow 分类重复 |
| `frontend-vite/src/pages/ArticleDetail.css` | 改 | 删除 60-169 markdown 样式；补齐 hero 缺失 CSS |
| `frontend-vite/src/pages/IssueDetail.tsx` | 改 | 用 Breadcrumb + `.prose-lg` |
| `frontend-vite/src/pages/IssueDetail.css` | 改 | 删除 markdown + 面包屑样式 |
| `frontend-vite/src/pages/Articles.tsx` | 改 | 用 Breadcrumb |
| `frontend-vite/src/pages/Articles.css` | 改 | 删除面包屑样式 |
| `frontend-vite/src/pages/Insights.tsx` | 改 | 用 Breadcrumb（如有详情） |
| `frontend-vite/src/components/ArticleCard.tsx` | 改 | 摘要区可选 `.prose-sm` |
| `frontend-vite/index.html` | 改 | 加 preconnect 到 fonts.googleapis.com |
| `CLAUDE.md` | 改 | 注明 Cormorant Garamond 已实际引入；新增 typography 体系文档 |

---

## 6. 验证标准

### 6.1 视觉验证

- [ ] 详情页 H1：长标题（如"关于...规划纲要的解读报告"）不被截断
- [ ] 面包屑：分类不再重复显示（breadcrumb 显示，eyebrow 不显示分类）
- [ ] 面包屑：所有详情页统一分隔符样式（ChevronRight，hover 颜色变化）
- [ ] 表格：斑马纹可见、hover 行高亮、移动端可横向滚动
- [ ] 首字下沉：详情页首段首字生效（仅 `.prose-lg`）
- [ ] 字体：英文 H1 显示 Cormorant Garamond（衬线、明显与中文不同）
- [ ] 代码块：深色背景、行号（可选）

### 6.2 静态验证

- [ ] `npx tsc --noEmit` 无错误
- [ ] 全局 `grep -r "border-collapse" src/` 只在 `.prose table` 处出现
- [ ] 全局 `grep -r "面包屑" src/` 只在 `<Breadcrumb>` 组件定义处出现
- [ ] `<Breadcrumb>` 在 4+ 个页面被使用

### 6.3 兼容性

- [ ] 不影响后端 API、不影响数据库 schema
- [ ] 不影响 Admin 后台
- [ ] 不引入新的 npm 依赖（仅 Google Fonts 链接）

---

## 7. 不做的事

- 不改 Markdown 内容本身
- 不改路由结构
- 不重构 Layout（除非必要）
- 不引入 Tailwind Typography 插件
- 不添加代码块行号插件（先做基础版，行号作为 future work）

---

## 8. 回滚方案

所有改动局限于前端 `src/` 和 `CLAUDE.md`。git revert 单个 commit 即可。

---

## 9. 影响范围

- **正面：** 所有详情页排版统一提升；表格等长内容可读性显著改善；分类重复 bug 修复
- **风险：** 中等。涉及 13+ 文件，但每处改动都是替换式（不是创造性）。TypeScript 类型会在迁移过程中暴露问题。
- **缓解：** workflow 中加一个 "verify TS clean + grep 收敛" 阶段