# Admin UI 整体重设计 — 设计规格

**日期:** 2026-06-30
**范围:** 前端 `pages/admin/*` + `components/admin/AdminLayout` + 新增 `components/ui/*` primitives + `styles/admin-tokens.css`
**目标:** 把后端管理界面从「通用电蓝 admin」升级为 Linear/Sanity 风的工具级工作面板，以古铜金 `#C9A84C` 做与公开站的品牌桥接；公开站不动。

---

## 一、问题陈述

1. **品牌色断层**: 公开站用古铜金 `#C9A84C` 作 accent；admin 后台全站强调色是电蓝 `#2563eb`，并且蓝色落在深墨 sidebar 上刺眼、与公开站无视觉关联。
2. **大量 inline style**: `Dashboard.tsx`、`MediaLibrary.tsx`、`AdminSettings.tsx` 等页用 inline `style={{...}}` 拼版式与色彩，每页都是从 0 开始，没有可复用基类。
3. **缺少 ui 组件库**: 项目里有 `components/ui/` 目录但实际为空。`Button / Card / Stat / Toolbar / PageHeader / StatusBadge / Empty / Breadcrumb / Modal / Pill / Tabs` 都没抽。
4. **Dashboard 信息密度过低**: 只有 3 张数字 tile，缺"最近文章 / 待审 / 草稿 / 最近上传"工作面板。
5. **现有样式不统一**: 状态色（已发布/草稿）写在 `ArticleList.css` 局部；空状态（"暂无文章"）写在 `ArticleList.tsx` inline；表格分页按钮 inline 写死；不跨页复用。
6. **暗 sidebar + 长时编辑**: 当前暗 sidebar 在长时间内容编辑中视觉负担偏重；admin 作为工具，应偏向明亮工作区。

---

## 二、范围

### 包含

- 新增 `frontend-vite/src/styles/admin-tokens.css`（design tokens）
- 新增 `frontend-vite/src/components/ui/` 一组 primitives（12 个组件）
- 重写 `AdminLayout.tsx` / `AdminLayout.css`（白底 sidebar + 古铜金 active）
- `Dashboard.tsx` 重写为 4 象限工作面板
- 迁移 9 个 admin 页到 primitives：`ArticleList`、`FeaturedArticles`、`JournalList`、`JournalEditor`、`JournalDetail`、`MediaLibrary`、`AdminSettings`、`ArticleEditor`（外壳部分）、`Login`（CTA 颜色）
- 把现有的 `components/Breadcrumb.tsx`（dark/light variant）升格纳入 `components/ui/Breadcrumb.tsx`，保持向后兼容
- Playwright 视觉回归快照（1280×800、1440×900，4 个状态）

### 不包含

- 暗色模式切换
- 全局后台搜索（仅留 cmd-K 占位入口，不接真实搜索）
- 拖拽排序 / 批量操作 / 图表
- 业务逻辑、路由、API 调用、React Query key 任何变化
- 后端任何变动
- 公开站任何变动

---

## 三、视觉方向（已对焦）

**整体路线: B — 中性工具风**（白底 sidebar + 古铜金只在 active/CTA/focus 出现 + Inter 字体）

**视觉密度层次: B1 — Linear 风**（白 sidebar / 极浅灰 hover / 古铜金左边条 active / 白底 64px 顶部 header / 白卡 + 1px 描边，几乎无阴影）

---

## 四、设计 Tokens

新文件 `frontend-vite/src/styles/admin-tokens.css`，在 `global.css` 之后导入：

```css
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

  /* Status (article / journal) */
  --status-published-bg: #E8F4EA;
  --status-published-fg: #1B5E20;
  --status-draft-bg: #F4F1E8;
  --status-draft-fg: #8C7A3E;
  --status-archived-bg: #F0EFEA;
  --status-archived-fg: #5C5C68;

  /* Risk */
  --danger: #B04040;
  --danger-bg: #F8E6E6;

  /* Spacing (8px scale) */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;

  /* Radius */
  --radius-1: 4px; --radius-2: 6px; --radius-3: 10px;

  /* Shadow */
  --shadow-1: 0 1px 2px rgba(26, 26, 46, 0.04);
  --shadow-2: 0 4px 16px rgba(26, 26, 46, 0.06);
  --shadow-focus: 0 0 0 3px rgba(201, 168, 76, 0.25);

  /* Type */
  --type-xs: 12px; --type-sm: 13px; --type-base: 14px; --type-md: 16px;
  --type-lg: 20px; --type-xl: 28px; --type-display: 36px;

  /* Layout */
  --sidebar-width: 240px;
  --header-height: 64px;
  --content-max: 1280px;
}
```

**约束**: `--color-text-secondary` 等 `global.css` 已有的 var 保留；新加的 `--admin-*` 只在 admin scope 用，namespace 隔离。

---

## 五、Components / Primitives

新目录 `frontend-vite/src/components/ui/`。每个组件为 forward component + 命名 variant + 业务无关。

| 组件 | variant | 替换什么 |
|---|---|---|
| `Button` | primary(古铜金) / secondary(ghost) / danger / icon ；size: sm/md/lg；loading | 所有 `<button>` 与 inline 样式按钮 |
| `IconButton` | ghost / solid / danger ；size: sm/md | 头部按钮、列表行操作按钮 |
| `Card` | flat / outlined / elevated ；含 `Card.Section` | inline `bg:white;padding:24;border:1px solid #e8e8e0` 卡片 |
| `Stat` | simple / trend(up/down) | Dashboard 3 张统计 tile |
| `PageHeader` | 含 h1 + 可选 面包屑 + action slot | 各页 `<div justify-between><h2>` 头 |
| `Toolbar` | + Group + Input + Select + SearchInput | 列表页工具行 |
| `Breadcrumb` | dark / light variant（已存在升格） | 顶部 + 详情页侧栏 |
| `StatusBadge` | published / draft / archived / featured | inline `<span class=__status>` |
| `Empty` | icon + title + description + CTA | 各页"暂无 X" |
| `Modal` | title + body + footer + focus-trap + Esc 关闭 | 后续 `confirm()` 替换（PR3/4） |
| `Pill` | removable | 标签输入 |
| `Tabs` | underline / pill | ArticleEditor 已有的 source/preview 抽出 |

**注意**: `Breadcrumb.tsx` 从 `components/` 升格到 `components/ui/`。原 import 路径在 `Breadcrumb.tsx` 加 `from '../ui/Breadcrumb'` 的兼容桥接，或直接更新全部引用（PR1 一次性迁移）。

---

## 六、Layout 重写

**Sidebar**：
- 白底 `#FFFFFF`，文字 `#1A1A2E`，**无 left-border**
- active：4px 古铜金左边条 + `--brand-gold-50` 浅底
- hover：`-surface-2`
- Brand 顶部 16px：「湖北数创 CMS」+ 古铜金圆点 mark；移除下划线，用间距替代
- 底部贴底：当前管理员名 + 退出 IconButton

**Header**（64px 白底）：
- 左侧 `<Breadcrumb>`（自动根据 path）
- 右侧：`<SearchInput>`（cmd-K 占位）+ 通知 `<IconButton>` + 用户菜单
- 底部 1px `--admin-border`

**Content**：
- `--admin-bg` 背景
- 内部 `<Card>` 浮在上面
- `--content-max: 1280px` 居中
- 移动端：sidebar 收起为顶栏抽屉（保留旧动效）

---

## 七、Dashboard 升级

替换当前 3 张 stat tile 为 4 象限工作面板：

1. **统计 tile（4 张）**: 文章总数 / 已发布 / 草稿 / 媒体库大小
2. **最近文章（5 条）**: 标题 + 分类 + 状态 + 更新时间，点击跳编辑
3. **待审/草稿（5 条）**: 仅 draft 状态文章列表 + "继续编辑" CTA
4. **最近上传（8 张缩略）**: 缩略图 + 文件名 + 大小，点复制 URL

保持 `api.admin.articles.list` / `api.admin.journals.list` / `api.admin.media.list` 不变；用现有 React Query。

---

## 八、4 个 PR 阶段（实施粒度）

1. **Foundation**（不破坏现有页面观感）— `admin-tokens.css` + 全部 ui/ primitives + AdminLayout 切到浅主题。所有页面看起来不变，只换 shell。
2. **Dashboard** — 替 inline stat 为 `<Stat>`；新增 4 象限工作面板。新增 `Dashboard.css`。
3. **List 页** — ArticleList / JournalList / MediaLibrary：用 `<PageHeader>` / `<Toolbar>` / `<StatusBadge>` / `<Empty>` / `<Card>` 重构，inline style 减少 60–80%。
4. **Editor + Settings + Login** — ArticleEditor / JournalEditor / JournalDetail / AdminSettings / Login：primitives 包外壳；Login CTA 用古铜金。

---

## 九、数据流

零改动 — 同样 React Query keys（`['admin', …]`）、同样 `api.admin.*`、同样 auth。

可选新 hook：`useAdminOverview()` 包 3 个 count + 最近项；仅当 PR2 发现重复 fetch 才引入。

---

## 十、错误处理

- 现有 `useToast()` 不动
- 表单内联错误不动
- `confirm()` → `<Modal>` 替换留到后续阶段（不在本次 spec 内）

---

## 十一、验证

- **A11y**: primitives 都有 role / aria；`<Modal>` focus trap + Esc 关闭；`<PageHeader>` 渲染 `<h1>`；`<Breadcrumb>` 标 `aria-label="面包屑"`
- **视觉回归**: Playwright 装好后写 `frontend-vite/tests/admin-snapshots.spec.ts`，1280×800 / 1440×900 两个 viewport 锁 sidebar / header / Dashboard / list 四状态
- **冒烟**: 访问每条 admin 路由，无 console error；active nav 必是古铜金
- **构建**: `npm run build` 零错；`tsc -b` 零错；新增 TS 类型严格通过

---

## 十二、风险登记

1. **CSS var 重名**: 新加 `--admin-*` 与现有 `--color-*` 不冲突；用 namespace 隔离，避免全局污染。
2. **`<Breadcrumb>` 升格**: 已存在的 `components/Breadcrumb.tsx` 路径仍要被 `ArticleDetail.tsx` 等公开站使用。方案：原地升格到 `components/ui/Breadcrumb.tsx`，原 `components/Breadcrumb.tsx` 改为 re-export 行（仅 src 内部一处使用，便于一次性修改）。
3. **ArticleEditor 380 行**: 仅重构外壳与按钮样式；Markdown 编辑器内部（`MDEditor`、插入图片/表格按钮）不动。
4. **Login 页**: 保持当前 `Login.css` 结构，只调 CTA 按钮颜色为 `--brand-gold` + 微调文案间距。
5. **existing inline animations** (`animations.ts`): 保留，仅可能新增一个 stagger 效果给 Dashboard 卡片入场。

---

## 十三、明确不在范围

- 暗色模式切换
- 全局后台搜索（只占位）
- 拖拽排序
- 批量操作
- Dashboard 图表/数字可视化
- 后端
- 公开站
- 任何业务/数据逻辑修改
