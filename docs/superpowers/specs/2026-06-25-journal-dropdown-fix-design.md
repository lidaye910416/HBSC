# 期刊下拉菜单 hover 关闭 Bug — 修复设计

**日期：** 2026-06-25
**范围：** `frontend-vite/src/components/Navigation.tsx` + `Navigation.css`
**目标 Bug：** 首页 header 的"期刊"下拉菜单无法点击选择，鼠标移走即消失

---

## 1. 问题陈述

### 用户可见症状
- 用户鼠标悬停"期刊"按钮 → 下拉菜单展开
- 鼠标向下移动准备点击某个 Issue 链接 → **菜单瞬间消失**
- 用户无法选中期刊条目

### 根本原因（已定位）

| 根因 | 位置 |
|------|------|
| `onMouseLeave` 立即同步调用 `setIssuesOpen(false)`，无延迟 | `Navigation.tsx:77` |
| `.nav__dropdown-menu` 用 `top: calc(100% + 8px)` 与按钮间留 8px 间隙，鼠标必然穿过 | `Navigation.css:89` |
| 菜单用条件渲染 `{issuesOpen && ...}`，无淡出动画 | `Navigation.tsx:89` |

### 触发链路
1. 鼠标进入 `.nav__dropdown` → `onMouseEnter` → `setIssuesOpen(true)` → 菜单挂载
2. 鼠标向下移入菜单 → **穿过 8px 间隙** → `onMouseLeave` 立即触发 → `setIssuesOpen(false)` → 菜单卸载
3. 用户还没来得及点击，菜单就消失了

---

## 2. 修复设计

**交互模式（已与用户确认）：** 保留 hover 触发 + 关闭加延迟 + 不可见 hover bridge

### 2.1 三层防护

**层 1：不可见 hover bridge（CSS）**
- 在 `.nav__dropdown-menu` 顶部加一个透明的伪元素
- 覆盖按钮与菜单之间的 8px 间隙
- 鼠标在此区域内不会触发容器的 `mouseleave`

**层 2：延迟关闭（TS）**
- `onMouseLeave` 不再立即关闭，改用 `setTimeout(150)` 延迟
- `onMouseEnter` 时 `clearTimeout`，避免"鼠标已返回但菜单仍关闭"
- 用 `useRef` 持有 timeout id，确保组件卸载时清理

**层 3：淡出动画（CSS，可选但建议）**
- 进入已有 `navDropdownFade` 0.18s 动画
- 退出加 `transition: opacity 0.15s, transform 0.15s`
- 用额外 className `nav__dropdown-menu--closing` 控制
- 关闭时不立即卸载 DOM，等 transition end 后再卸载

### 2.2 改动文件

| 文件 | 改动 |
|------|------|
| `frontend-vite/src/components/Navigation.tsx` | `onMouseLeave` 改为延迟关闭（150ms），新增 `closeTimeoutRef`，`onMouseEnter` clearTimeout；state 结构支持淡出 |
| `frontend-vite/src/components/Navigation.css` | `.nav__dropdown-menu::before` 透明 hover bridge（高 8px，位于 top:-8px）；`.nav__dropdown-menu--closing` 添加 opacity/transform transition |

### 2.3 保留行为
- `onClick` 切换菜单状态（已有）— 保留
- click-outside 关闭（`useEffect` + `mousedown` 监听）— 保留
- 路由切换时关闭（`useEffect` 依赖 `location`）— 保留
- `aria-expanded` / `aria-haspopup` 无障碍属性 — 保留
- React Query 缓存的 `api.issues.list` 数据流 — 不变

### 2.4 不做的事
- 不改 API 调用
- 不改路由
- 不改其他 Navigation 菜单（如有）
- 不引入新依赖

---

## 3. 验证方案

### 3.1 静态验证
- Read 修复后的文件，确认：
  - `onMouseLeave` 行为是延迟关闭
  - `onMouseEnter` 清理 timeout
  - CSS bridge 高度 = 间隙（8px）
  - useEffect cleanup 清理 timeout
- 用 grep 检查整个 `frontend-vite/src/components/` 是否有相同模式的 bug

### 3.2 动态验证（用户手动）
- 启动后端 `uvicorn app.main:app --reload --port 8000`
- 启动前端 `npm run dev -- --port 5173`
- 访问 `http://localhost:5173/`
- 鼠标悬停"期刊"→ 等待菜单展开 → 鼠标缓慢移向菜单条目 → **菜单保持展开** → 点击链接 → 跳转成功

### 3.3 边缘情况
- 快速来回 hover：菜单状态切换正常，无残留 timeout
- 键盘 Tab + Enter：button 可聚焦，可点击展开
- 触屏设备：tap 展开，tap 其他区域关闭
- 移动端 / 小屏：导航栏收起的状态下是否还有问题（不在本次修复范围内）

---

## 4. 影响范围

- **正面：** 所有页面（导航栏是全局组件）— 期刊选择器都能正常工作了
- **风险：** 极低。延迟关闭是常见 UX 模式；hover bridge 是 CSS 透明元素，不影响视觉
- **可回滚：** 改动局限于 2 个文件，git revert 即可

---

## 5. 验收标准

- [ ] 鼠标悬停"期刊"按钮 → 菜单展开
- [ ] 鼠标从按钮向下移动到菜单条目 → **菜单保持展开**（不消失）
- [ ] 点击菜单条目 → 跳转到 `/issues/:slug`
- [ ] 鼠标点击页面其他区域 → 菜单关闭
- [ ] 鼠标离开导航栏区域 → 150ms 后菜单关闭（带淡出动画）
- [ ] 键盘 Tab 聚焦到按钮 → Enter 可展开/收起
- [ ] 路由切换时菜单正确关闭
- [ ] 现有 React Query 数据流不变，后端 API 不变