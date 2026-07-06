# ArticleEditor 深色主题 + AI 排版按钮位置 — 设计

> 把 `/admin/articles/:id` 在 dark theme 下仍然"白成一片"的若干处修复为 token-driven 主题色，并把 `AI 排版` 按钮从独立字段块搬到 markdown 编辑器顶栏、改为 gold/primary 强调色、修正 `.docx` 自动排版 checkbox 措辞以消除与新按钮的语义混淆。
>
> 与 `2026-07-05-docx-autotypeset-design.md`（已锁定）相互独立——本 spec 不动该 spec 已定的 hook 链路，只改展示层。

---

## 目标

让 `/admin/articles/:id` 在 dark theme 下**所有用户可操作的控件**都正确暗化，且 AI 排版入口与它真正影响的 markdown 内容在视觉上属于同一区块，解决"按钮位置错意"问题。

---

## 非目标

- ❌ 不动 `global.css:176–551` `.prose` 全局 token（公开站点仍需浅色 token；动它会破坏公开站样式）
- ❌ 不动 ArticleEditor 的 Preview tab（仍由 `.prose` 渲染，B 档显式跳过）
- ❌ 不动后端、API、TypesetPreviewDialog、settings page 结构
- ❌ 不动 `handleTypeset` / `handleTypesetRegenerate` / 自动触发钩子
- ❌ 不动 `localStorage['hbsc-article-auto-typeset']` 行为
- ❌ 不为本次改样式新建主题。配色尽量复用既有 `--admin-*` + `--brand-*` + `--accent-*`；唯一新增的 4 个 token（`--md-editor-bg` / `--md-editor-toolbar-bg` / `--md-editor-fg` / `--md-editor-border`，均在 admin-tokens.css 内）只是这些系列的**别名**（alias），仅用于 MDEditor 钩 selector 里语义清晰，**不带任何新色值**
- ❌ 不重做 `admin-snapshots` 视觉基线（历史遗留 deviceScaleFactor 2x 问题不在本 PR 边界）

---

## 关键决策

| 决策点 | 选定值 | 理由 |
|---|---|---|
| 范围 | B 档（中等）| 用户在 scope-options 屏幕选定 |
| 配色策略 | 替换硬编码色为已存在 token | 不新增主题 |
| MDEditor 编辑面板 | wrapper 切到 dark + 用 hook selector 注入 --md-editor-* 变量 | data-color-mode="dark" 只覆盖 preview；edit 区需 CSS override |
| 按钮 variant | `default`（= brand gold/accent）+ `Sparkles` 图标 | 与已有"主操作"一致；不引入新变体 / 不引入新图标语言 |
| 按钮位置 | `.editor-tabs` 同一行内右对齐 | 视觉上与 markdown 编辑器同处 |
| 旧字段块 | 删除 | 整块不再有功能价值 |
| .docx checkbox 措辞 | `导入 .docx 后自动跑 AI 排版` | 与新主按钮区分；强调仅作用于 docx 流程 |
| 测试 | 新增 1 个 playwright spec，5 用例；admin-snapshots 不重做基线 | 范围克制；前 9 个 white 源修 7 个，留 2 个给未来 C 档 |

---

## 文件改动清单

### Modified 文件

| 路径 | 改动 |
|---|---|
| `frontend-vite/src/styles/admin-tokens.css` | 追加 4 个 token：`--md-editor-bg` / `--md-editor-toolbar-bg` / `--md-editor-fg` / `--md-editor-border`，全部映射到既有 `--admin-surface*` / `--admin-text` / `--admin-border` |
| `frontend-vite/src/pages/admin/ArticleList.css` | 行 54 + 76–85 + 126 + 132 + 235–241 共 5 处改用 token；新增 `.article-editor__md[data-md-editor-dark] ...` 钩 selector 段（覆盖 toolbar / textarea / bar / btn-hover） |
| `frontend-vite/src/pages/admin/ArticleEditor.tsx` | 行 390–410 字段块删除；行 461 + 471 wrapper `data-color-mode="light"` → `data-color-mode="dark"` 并加 `data-md-editor-dark="true"` 钩；tabs 行右侧插入新按钮；hint 子标题行处理；typesetError 移到编辑器底部；typesetterBlockedReason 移到 hint 行 |
| `frontend-vite/src/components/admin/Toast.css` | 行 16 `background: white` → `var(--admin-surface)` + `color: var(--admin-text)` |
| `frontend-vite/src/components/admin/AdminLayout.css` | 行 80–83 sidebar active link：奶油胶囊 → `var(--admin-surface-2)` + left 2px gold border |
| `frontend-vite/src/components/admin/ImageUploader.css` | 行 14–15 hover/drag 闪奶油 → `var(--accent-soft)`（dark/light 共用） |
| `frontend-vite/src/pages/admin/JournalEditor.tsx` | 不动；本次范围只覆盖 ArticleEditor；后续若 JournalEditor 也想要 dark 可单 PR 跟进 |

### New 文件

| 路径 | 责任 |
|---|---|
| `frontend-vite/tests/article-editor-dark-typeset.spec.ts` | Playwright，5 用例：按钮位置 + `.article-editor` 深色 + 输入框深色 + .docx checkbox 措辞 + 不破坏既有 typeset 路径 |

### Untouched（明确不动）

- `frontend-vite/src/styles/global.css`（.prose 段）
- `frontend-vite/src/components/ArticleBody.tsx`
- `frontend-vite/src/components/admin/TypesetPreviewDialog.tsx`
- `frontend-vite/src/components/ui/Button.tsx`、`Modal.tsx`
- `frontend-vite/src/components/admin/AdminLayout.tsx` JSX
- `frontend-vite/src/components/admin/ImageUploader.tsx` JSX
- 后端任何文件
- `admin-snapshots.spec.ts` 视觉基线

---

## 详细设计

### §1 配色 token 重构（7 处 white 源）

| 文件:行 | 现在 | 改成 |
|---|---|---|
| `ArticleList.css:54` | `.article-editor { background: white; }` | `background: var(--admin-surface);` |
| `ArticleList.css:76-85` | input/textarea/select 无 background | `background: var(--admin-surface-2); color: var(--admin-text);` |
| `ArticleList.css:126,132` | `--btn--secondary/--danger { background: white }` | `background: var(--admin-surface-2); color: var(--admin-text);` |
| `ArticleList.css:235-241` | hero 空 cover 奶油斜条纹 | 把渐变色改成 `--admin-surface-2` ↔ `--admin-bg`（仅复用既有 token，不引入新颜色） |
| `Toast.css:16` | `.admin-toast { background: white; }` | `background: var(--admin-surface); color: var(--admin-text);` |
| `AdminLayout.css:80-83` | sidebar active 奶油胶囊 | `background: var(--admin-surface-2); border-left: 2px solid var(--brand-gold); color: var(--admin-text);` |
| `ImageUploader.css:14-15` | hover/drag 闪奶油 | `background: var(--accent-soft);` |

**不动**：`global.css:176-551` .prose 系列样式、`.prose` 在 admin preview tab 内的浅色（已知 B 档边界）。

### §2 MDEditor 编辑面板变深

| 元素 | 现状 | 改成 |
|---|---|---|
| wrapper `.article-editor__md` | `data-color-mode="light"` | `data-color-mode="dark"` 同时 `data-md-editor-dark="true"` |
| 工具栏 toolbar | 内置 light | 覆盖：`background: var(--md-editor-toolbar-bg); border-bottom: 1px solid var(--md-editor-border);` |
| 编辑 textarea / 整块 | 白底 `--md-editor-background-color` 落回 `#ffffff` | 在钩 selector 下注入：`--md-editor-background-color: var(--md-editor-bg); color: var(--md-editor-fg); --md-editor-box-shadow-color: var(--md-editor-border); border-color: var(--md-editor-border);` |
| 拖拽 handle | 默认白 | `.w-md-editor-bar { background: var(--md-editor-border); }` |
| 工具栏按钮 hover | 默认浅蓝 | `.w-md-editor-btn:hover { background: var(--accent-soft); }` |

**新 CSS 块（追加到 admin-tokens.css）：**
```css
--md-editor-bg: var(--admin-surface-2);
--md-editor-toolbar-bg: var(--admin-surface);
--md-editor-fg: var(--admin-text);
--md-editor-border: var(--admin-border);
```

**新规则（追加到 ArticleList.css）：**
```css
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

**Preview tab（line 471+）**：那里用 `<ArticleBody>` + `.prose`，**不在本 spec 修复**——B 档显式边界，C 档（`.prose-dark` 变体）跟进。

### §3 按钮位置 + .docx checkbox 措辞

**3-1 主按钮位置搬迁**

| 之前 | 之后 |
|---|---|
| 独立 `<div className="article-editor__field">`（行 390–410） | `.editor-tabs` 同一行右对齐 |
| `variant="secondary"` + `Sparkles size={14}` | `variant="default"`（= brand gold/accent）+ `Sparkles size={14}` |
| `<label>AI 排版（用 LLM 清洗 Markdown；不动元数据）</label>` | 删除字段 label |
| 灰色 hint 子标题 | 在 tabs 行下方 1 行 `<small>`：「对当前正文 Markdown 跑一次 LLM 清洗，元数据不动」|
| 红字 `typesetError` | 移到 editor 卡片底部（不动文案） |
| `typesetterBlockedReason` 三档文字 | 移到 hint 子标题行内（disabled 时显示） |

**整块删除**：`ArticleEditor.tsx` 行 390–410 整个 `<div className="article-editor__field">`。`typesetterReady` / `typesetterBlockedReason` 计算保留（被新位置的按钮和 hint 复用）。

**重构后编辑器顶栏布局：**
```
┌─────────────────────────────────────────────────────────────┐
│ [源] [预览（页面效果）]              [✦ AI 排版]（gold primary） │
│ <small>对当前正文 Markdown 跑一次 LLM 清洗，元数据不动</small>   │
├─────────────────────────────────────────────────────────────┤
│ MDEditor body（已切到 dark）                                  │
├─────────────────────────────────────────────────────────────┤
│ typesetError 红字区（必要时显示）                              │
└─────────────────────────────────────────────────────────────┘
```

**3-2 .docx checkbox 措辞**

- 旧：`导入并自动跑 AI 排版`
- 新：`导入 .docx 后自动跑 AI 排版`

触发逻辑（`if (autoTypeset && typesetterReady && result.content_markdown)`）**不动**——只是 human-readable label 改了。

**3-3 行为不回归红线**

- `handleTypeset` / `handleTypesetRegenerate` / `TypesetPreviewDialog` 全部不动
- docx 自动触发链路不动
- typesetter 未配置时按钮 disable + 显示 hint，不动
- admin-snapshots 不重做基线（已知历史遗留问题，不在本 PR 边界）

### §4 测试

**4-1 新增 Playwright spec**

`frontend-vite/tests/article-editor-dark-typeset.spec.ts` — 5 用例：

| # | 用例 | 验收方式 |
|---|---|---|
| 1 | dark theme 下 `.article-editor` 计算 background ≠ white | `getComputedStyle(...).backgroundColor !== 'rgb(255, 255, 255)'` |
| 2 | dark theme 下 input/textarea 计算 background ≠ white | 同上，针对 `.article-editor input, textarea` |
| 3 | AI排版按钮位于 tabs 行内（不在独立 field 块） | DOM 结构断言：button 存在 selector `.editor-tabs-row` 或 `tabs __btn + AI排版 button` 这种"邻近 markup editor 容器"的位置关系 |
| 4 | .docx checkbox label 含"导入 .docx 后自动跑 AI 排版" | `getByText(/导入 \.docx 后自动跑 AI 排版/)` 存在 |
| 5 | 不回归：typesetter config OK → button enabled；点 button → dialog 打开 | 复用既有的 typeset e2e 流程断言 |

**4-2 不写的东西**

- ❌ 像素级视觉回归（B 档改 CSS 色值范围大；admin-snapshots 历史问题不重做基线）
- ❌ MDEditor 编辑面板 computed color 断言（MDEditor 内部 hardcoded 白边残留不归我们管）
- ❌ `.prose` 反向断言（B 档明确不修复）

**4-3 人工 smoke（验收模板）**

| 步骤 | 期望 |
|---|---|
| `/admin/articles/1` 在 dark theme | 全卡片深、所有输入深、MDEditor 编辑面板深 |
| 切到 light theme | 反向也正确 |
| AI 排版按钮 | tabs 同行右对齐、gold/primary |
| typesetter enabled 关闭再访问 | 按钮 disabled、hint 行显示「请先在 设置 → AI 排版 中启用」|
| .docx checkbox label | 含"导入 .docx 后"字样 |
| 点 AI 排版 → TypesetPreviewDialog | 仍正常；apply 后 form.content 替换；管理员保存功能未坏 |
| 上传 .docx，autoTypeset 勾选 / 不勾选 | 行为与 `2026-07-05-docx-autotypeset-design.md` 锁定 spec 一致 |

---

## 与既有 locked specs 的关系

| Spec | 关系 |
|---|---|
| `2026-07-05-docx-autotypeset-design.md` | 锁定；本 spec 不动其 hook 链路；本 spec 删除的是其 `.article-editor__field` 容器，但 checkbox state、condition、localStorage 行为全部沿用 |
| `2026-06-30-ai-typesetting-design.md` | 锁定；本 spec 仅改按钮位置和颜色，不动 endpoint / dialog / prompt |
| `2026-07-05-admin-theme-design.md` | 可能存在；如果该 spec 已经定义了 `--md-editor-*` token 或 dialog 主题，本文以本文为准（避免重复定义） |

---

## 风险

1. **MDEditor 版本敏感性**：当前锁 `@uiw/react-md-editor@^4.1.1`。若 major 升级（v5），`data-color-mode` 与 class 名可能变化；本 spec 假定 v4.x 不变
2. **admin-snapshots 视觉基线失配**：本次改 CSS 色值会进一步让基线失配；本 spec 不重做基线，但需在 PR 描述里告知
3. **`.prose` 在 admin preview tab 仍浅色**：B 档已知边界；用户需要等待 C 档（`.prose-dark` 变体）落地
4. **JournalEditor 同步未做**：本 spec 仅覆盖 ArticleEditor；若 JournalEditor 也要 dark polish 单独 PR
5. **Toast.css 全局影响**：改 `.admin-toast` 背景会影响所有用 toast 的页面（ArticleEditor 之外）；由于 token 在 light/dark 都有定义，dark/light 双场景都正确，**风险可控**
