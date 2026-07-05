# Admin 后台主题系统设计

**日期：** 2026-07-05
**状态：** 已批准（brainstorming 通过）
**关联 commit：** `9f2f650 refactor(frontend): unify admin color palette to match brand`（前序轮次）

---

## 1. 背景与目标

### 1.1 现状

`9f2f650` 完成了 admin 配色的第一轮统一：6 个新 token、15 个文件重命名、把 `--brand-*` 系统铺到 admin。但还有两类遗留问题：

1. **散落字面量（11 处）**：`JournalList.tsx` 的 `#E8F4EA` / `#1B5E20` / `#F4F1E8` / `#8C7A3E`，`inlineImageEdit.tsx` / `inlineTableEdit.tsx` / `TypesetPreviewDialog.css` 的 `#C9A84C`，`ArticleList.css` 的 `#ffffff`，`AdminSettings.css` 的 `#fff`，`Dashboard.css` 的 `rgba(26,26,46,0.6)` 等。这些色值与已有 token 完全重复，应统一替换。
2. **admin 整体观感仍是浅色 Linear 风**——与公开站「深墨 hero → 暖白 body」的双段式品牌识别不呼应。管理员长时间在浅色界面编辑，对品牌识别度弱。

### 1.2 目标

- **G1**：admin 默认采用深色主题（侧栏 + 主体同深墨 `#1A1A2E`，卡面 `#232536`，文字 `#FAFAF7`，金色 logo 是唯一的暖光源），呼应公开站品牌识别。
- **G2**：admin 保留浅色主题作为回退，用户可在 Settings → 外观切换。
- **G3**：切换瞬时完成，无 FOUC（页面刷新第一帧就是正确主题）。
- **G4**：主题偏好持久化在浏览器 localStorage，无需后端。
- **G5**：公开站（首页、文章、期刊、资讯、搜索）像素级零回归。
- **G6**：admin 范围内**任何颜色字面量都为 0**，全靠 token。

### 1.3 非目标

- 不做品牌色本身的调整（`#1A1A2E` / `#C9A84C` 等不动）。
- 不做整套视觉重设计（布局、间距、字体、组件形状不变）。
- 不引入深色以外的第三主题。
- 不做主题编辑器或实时预览调色板。

---

## 2. 视觉方向

**选项 C2 · 深墨 + 暖白字色。**

| 区域 | 暗色（默认） | 浅色 |
|---|---|---|
| 页面底色 `--surface-base` | `#1A1A2E` | `#FAFAF7` |
| 卡面 `--surface-1` | `#232536` | `#FFFFFF` |
| 悬浮/选中底 `--surface-2` | `#2D2F45` | `#F5F4EE` |
| 描边 `--border` | `#2D2F45` | `#E8E5DC` |
| 主文字 `--text-1` | `#FAFAF7` | `#1A1A2E` |
| 次文字 `--text-2` | `#C8C8D0` | `#5C5C68` |
| 弱文字 `--text-muted` | `#8C8C9A` | `#8C8C9A` |
| 高亮 `--accent` | `var(--brand-gold)` | `var(--brand-gold)` |
| 高亮弱化 `--accent-soft` | `rgba(201,168,76,0.18)` | `#F5EEDC` |

侧栏与主体同色（不再分冷暖），让金色 logo 成为唯一暖光源。整体观感：「夜里点灯」。

---

## 3. Token 三层体系

### 3.1 第一层：品牌原子（两主题共用，永不变）

```css
--brand-ink: #1A1A2E;
--brand-ink-2: #16213E;
--brand-gold: #C9A84C;
--brand-gold-50: #F5EEDC;
--brand-gold-hover: #B89740;
--brand-gold-dark: #a07f2c;
--brand-gold-deep: #6e5b29;
--brand-paper-warm: #F5F0E8;
--brand-cream: #FAFAF7;
```

### 3.2 第二层：语义角色（按主题切换）

```css
/* DARK · 默认 */
:root {
  --surface-base: #1A1A2E;
  --surface-1:    #232536;
  --surface-2:    #2D2F45;
  --border:       #2D2F45;
  --text-1:       #FAFAF7;
  --text-2:       #C8C8D0;
  --text-muted:   #8C8C9A;
  --accent:       var(--brand-gold);
  --accent-soft:  rgba(201, 168, 76, 0.18);
}

/* LIGHT · 备选 */
:root[data-theme="light"] {
  --surface-base: #FAFAF7;
  --surface-1:    #FFFFFF;
  --surface-2:    #F5F4EE;
  --border:       #E8E5DC;
  --text-1:       #1A1A2E;
  --text-2:       #5C5C68;
  --text-muted:   #8C8C9A;
  --accent:       var(--brand-gold);
  --accent-soft:  #F5EEDC;
}
```

### 3.3 第三层：状态/风险（按主题提供双值）

```css
/* DARK */
--status-published-bg: rgba(232, 244, 234, 0.12);
--status-published-fg: #A8D5AC;
--status-draft-bg:     rgba(244, 241, 232, 0.12);
--status-draft-fg:     #D4C896;
--status-archived-bg:  rgba(240, 239, 234, 0.10);
--status-archived-fg:  #C8C8D0;
--status-featured-fg:  #C9A84C;
--danger:              #E07B7B;
--danger-bg:           rgba(224, 123, 123, 0.15);
--danger-border:       rgba(224, 123, 123, 0.4);

/* LIGHT */
:root[data-theme="light"] {
  --status-published-bg: #E8F4EA;
  --status-published-fg: #1B5E20;
  --status-draft-bg:     #F4F1E8;
  --status-draft-fg:     #8C7A3E;
  --status-archived-bg:  #F0EFEA;
  --status-archived-fg:  #5C5C68;
  --status-featured-fg:  #8C6F1F;
  --danger:              #B04040;
  --danger-bg:           #F8E6E6;
  --danger-border:       rgba(176, 64, 64, 0.4);
}
```

### 3.4 向后兼容（保留旧名，避免破坏 import 的现存用法）

保留以下 token 名作为第二/三层的别名映射，让现有代码无需立即重写：

```css
:root {
  --admin-bg:        var(--surface-base);
  --admin-surface:   var(--surface-1);
  --admin-surface-2: var(--surface-2);
  --admin-border:    var(--border);
  --admin-border-strong: #4A4D6A;        /* dark */
  --admin-text:      var(--text-1);
  --admin-text-2:    var(--text-2);
  --admin-text-muted: var(--text-muted);
  --admin-text-disabled: #6B6B82;         /* dark */
  --admin-text-inverse: #FAFAF7;
}
:root[data-theme="light"] {
  --admin-border-strong: #D4D0C4;
  --admin-text-disabled: #4b4b62;
}
```

---

## 4. 切换机制

### 4.1 数据流

```
localStorage['hbsc-theme']
       │
       ▼
   ┌───────┐  React mount
   │ main.tsx │ ─inline <script>──────────────► document.documentElement.dataset.theme
   └───────┘                                       │
                                                  ▼
                                            :root[data-theme]
                                                  │
                                                  ▼
                                            CSS 变量解析
                                                  │
                                                  ▼
                                            渲染正确主题
                                                  │
       ┌─────────────────┐  onChange            │
       │ AdminSettings   │ ◄────────────────────┘
       │ radio[dark/light]│
       └─────────────────┘
              │
              ▼
       写 localStorage + 改 document.documentElement.dataset.theme
```

### 4.2 三处接入点

**接入点 1：`main.tsx` 内联脚本（防 FOUC）**

```tsx
// 在 React 挂载前同步执行，避免页面闪一下默认色
const theme = localStorage.getItem('hbsc-theme')
if (theme === 'light') document.documentElement.dataset.theme = 'light'
```

**接入点 2：`AdminLayout.tsx` 启动同步**

```tsx
useEffect(() => {
  const saved = localStorage.getItem('hbsc-theme')
  if (saved === 'light') document.documentElement.dataset.theme = 'light'
}, [])
```

**接入点 3：`AdminSettings.tsx` 外观卡片**

```tsx
function AppearanceCard() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('hbsc-theme') === 'light' ? 'light' : 'dark')
  )
  const handleChange = (next: 'dark' | 'light') => {
    setTheme(next)
    localStorage.setItem('hbsc-theme', next)
    document.documentElement.dataset.theme = next === 'light' ? 'light' : ''
    toast.success(`已切换到${next === 'dark' ? '深色' : '浅色'}主题`)
  }
  return (
    <Card title="外观">
      <Radio value="dark" checked={theme==='dark'} onChange={() => handleChange('dark')}>
        深色 <Description>深墨底 + 暖白字 · 默认 · 长时间编辑更护眼</Description>
      </Radio>
      <Radio value="light" checked={theme==='light'} onChange={() => handleChange('light')}>
        浅色 <Description>暖白底 + 深墨字 · 与公开站视觉一致</Description>
      </Radio>
    </Card>
  )
}
```

### 4.3 切换性能

- 切换只改 `document.documentElement.dataset.theme`，触发 CSS 变量重解析
- 无 React 重渲染（除 Settings 组件自身的 state）
- 视觉切换瞬时完成

---

## 5. 文件改动清单

22 个文件，分 4 级：

### 5.1 🔴 重构（1）

- `frontend-vite/src/styles/admin-tokens.css` — 完整重写为三层 + 双主题结构；保留旧 token 名作为别名。

### 5.2 🟠 主要改动（1）

- `frontend-vite/src/pages/admin/AdminSettings.tsx` — 新增"外观"卡片（radio + 描述 + Toast 反馈）
- `frontend-vite/src/pages/admin/AdminSettings.css` — 卡片样式跟随 token，无需硬编码

### 5.3 🟡 接入点（2）

- `frontend-vite/src/main.tsx` — 内联 FOUC 防护脚本
- `frontend-vite/src/components/admin/AdminLayout.tsx` — 启动同步 localStorage

### 5.4 🟢 字面量替换（12）

| 文件 | 字面量 → token |
|---|---|
| `pages/admin/Login.css` | `white` → `var(--surface-1)` |
| `pages/admin/Dashboard.css` | `rgba(26,26,46,0.6)` → `color-mix(in srgb, var(--brand-ink) 60%, transparent)` |
| `pages/admin/ArticleList.css` | `#ffffff` → `var(--surface-1)`；`rgba(201,168,76,0.35)` → `color-mix` |
| `pages/admin/ArticleList.tsx` | 状态徽章 4 处 → `var(--status-*)` |
| `pages/admin/ArticleEditor.tsx` | `#d97706` → `var(--status-draft-fg)`；`var(--color-*)` → `var(--admin-text-2)` |
| `pages/admin/JournalList.tsx` | 完整性徽章 4 处 → `var(--status-*)` |
| `pages/admin/JournalDetail.css` | 残留 rgba 验证并替换 |
| `pages/admin/AdminSettings.css` | `#fff` × 2 → `var(--surface-1)`；rgba 阴影 → `var(--shadow-2)` |
| `components/admin/Toast.css` | `rgba(0,0,0,0.08)` → `var(--shadow-2)` |
| `components/admin/TypesetPreviewDialog.css` | `#C9A84C` × 3 → `var(--brand-gold)` |
| `components/admin/Mde/inlineImageEdit.tsx` | `#C9A84C` × 2 → `var(--brand-gold)` |
| `components/admin/Mde/inlineTableEdit.tsx` | `#C9A84C`、`#FFFBEF` → token |

### 5.5 ✅ 无改动（5）

- `App.tsx`（admin-tokens import 位置已正确）
- `AdminLayout.css`（已全 token 化）
- `ProtectedRoute.tsx`（已 token 化）
- `ImageUploader.tsx + .css`（已 token 化）
- `animations.ts`（无颜色）

---

## 6. 数据与 API

- **无后端改动**
- **无数据库改动**
- **无 API 改动**
- **无数据库迁移**
- localStorage key：`hbsc-theme`，值 `'dark' | 'light'`，缺失视为默认 `dark`

---

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| localStorage 不可用（隐私模式） | try/catch 包裹读取，失败时退化为默认深色 |
| localStorage 中值非法 | 退化为默认深色 |
| 用户清缓存后首次访问 | 默认深色 |
| 切换过程中 JS 报错 | 不影响当前显示（已是上一主题），下次刷新按 localStorage 恢复 |
| 旧版本浏览器不支持 `data-theme` 属性选择器 | 退化为单主题（无切换），但 95%+ 现代浏览器支持 |

---

## 8. 测试与验证

### 8.1 L1 — 自动化扫描（新增）

新增 `frontend-vite/scripts/scan-admin-literals.sh`（git keep 父目录的占位 README 解释用途）：

```bash
#!/usr/bin/env bash
set -e
SRC=frontend-vite/src
HITS=$(grep -rEn "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" \
  "$SRC/pages/admin" "$SRC/components/admin" \
  --include='*.ts' --include='*.tsx' --include='*.css' \
  | grep -vE "var\(--|color-mix|//|^\s*\*" || true)

if [ -n "$HITS" ]; then
  echo "❌ Found color literals in admin:"
  echo "$HITS"
  exit 1
fi
echo "✅ No admin color literals"
```

加入 `package.json` scripts：

```json
"lint:admin-tokens": "bash scripts/scan-admin-literals.sh"
```

### 8.2 L2 — 浏览器实测（手动）

覆盖页面 × 主题：Dashboard / ArticleList / ArticleEditor / JournalList / MediaLibrary / Settings / Login。

每个页面在 dark / light 下都正确显示，无对比度问题、无错位、无遗漏 token。

### 8.3 L3 — FOUC 与持久化（手动）

1. 打开 admin → 深色默认
2. Settings → 切到浅色 → 立即变浅
3. 硬刷新 (⌘⇧R) → 第一帧就是浅色，不闪深色
4. 关浏览器 tab → 再开 /admin → 仍是浅色
5. 清 localStorage → 刷新 → 回到默认深色

### 8.4 L4 — 公开站零回归（手动 8 项）

- ✅ 首页 hero 渐变不变
- ✅ 文章详情 prose 排版不变
- ✅ 期刊列表卡片 hover 不变
- ✅ Navigation 透明→白底滚动不变
- ✅ Footer 链接颜色不变
- ✅ 搜索页输入框样式不变
- ✅ 公开站不加载 `admin-tokens.css`
- ✅ 公开站不受 `<html data-theme>` 影响（无 admin token 引用）

---

## 9. 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 暗色下文字对比度不足 | 中 | 设计阶段已验证；CSS 变量集中；状态色独立处理 |
| Status pill 在暗色下看不清 | 中 | 第三层专门定义暗色 status 色值 |
| FOUC 闪烁 | 低 | 内联脚本同步执行 |
| 公开站被污染 | 低 | admin-tokens.css 仍在 AdminLayout 内 import（9f2f650 已修）；新增 data-theme 不影响公开组件 |
| 旧 token 名（如 `--admin-bg`）引用遗漏 | 低 | 保留别名映射，向后兼容 |
| 浏览器不支持 `data-theme` | 低 | 95%+ 支持；不支持时退化为单主题深色 |

---

## 10. 交付物

1. **1 个 GitHub PR**，标题：`feat(frontend): admin theme system — dark default + light toggle`
2. **1 个新脚本**：`frontend-vite/scripts/scan-admin-literals.sh`
3. **1 个 npm script**：`frontend-vite` 的 `package.json` 中添加 `"lint:admin-tokens": "bash scripts/scan-admin-literals.sh"`
4. **1 个新文档片段**：本 spec 文件
5. **0 后端改动 · 0 数据库改动 · 0 API 改动**

---

## 11. 实施优先级

- **P0**：token 三层重构 + 双主题定义 + 别名映射
- **P0**：3 处 JS 接入点
- **P0**：12 个文件的字面量替换
- **P1**：Settings 外观卡片 UI
- **P1**：scan-admin-literals.sh 脚本 + npm script
- **P2**：手动 L2/L3/L4 验证

---

## 12. 后续可能的扩展（不在本次范围）

- 后端持久化用户主题偏好（跨设备同步）
- 主题编辑器 / 自定义 accent 色
- 自动跟随系统 `prefers-color-scheme`（虽然用户选了手动模式，但可作为可选项加入）
- 高对比度模式（accessibility）