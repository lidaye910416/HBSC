# MiniCast Embed Mode Patch — 2026-07-14

## 上下文

MiniCast Web 前端（`/Users/jasonlee/Projects/MiniCast/`）的 `App.tsx` 默认渲染
完整的导航条（`Header`）和进度条（`ProgressBar`），但是当它被作为嵌入式
iframe 嵌入到 hbsc 的 `/labs/minicast` lab 时，这些外围 UI 是冗余甚至有害的：

- 嵌入场景下不需要 reset / settings / 全局 step 跳转（父页面 Lab 拥有
  自己的导航和状态机）
- ProgressBar 在 iframe 内重复显示会误导用户（嵌入版只展示生成步骤）

因此引入 `?embed=1` query string 模式：当 URL 包含 `embed=1` 时，隐藏
`Header` 和 `ProgressBar`，仅保留核心 step 内容区域与底部 footer
（footer 保留以便保留 Apache-2.0 协议标识）。

## 实施位置

文件：`/Users/jasonlee/Projects/MiniCast/web/src/App.tsx`

### 1. import 保持不变

```tsx
import { useEffect, useReducer, useState } from 'react'
```

> ⚠️ 修正记录（2026-07-14，T14 集成测试发现）：早先版本曾把 `isEmbedded`
> 写成模块顶层的 `useMemo(...)` 并额外 import `useMemo`。这是非法用法 ——
> React Hook 不能在组件外调用，会在运行时抛错并导致整个 MiniCast 应用
> 白屏（`#root` 为空）。集成测试的 iframe body 为空 + 独立访问无 `<header>`
> 即由此引起。已改为下方的模块级普通常量，`useMemo` import 一并移除。

### 2. 在 imports 之后、type Action 之前新增 isEmbedded 常量

```tsx
// 在模块加载时计算一次（URL query 运行期不变），因此无需 React Hook。
const isEmbedded =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('embed') === '1'
```

要点：
- `typeof window !== 'undefined'` SSR 防御（Vite 默认 SSR 关闭，但保留
  这层可移植性）
- 模块级常量只在加载时求值一次，避免每次 render 重新解析 URL，且不违反
  Hook 规则
- 触发条件：URL query 包含 `embed=1`（严格匹配，避免 `embed=11` 误判）

### 3. JSX 中 Header 改为始终渲染（2026-07-15 用户反馈调整）

```tsx
{/* Header 在 embed 模式也显示 —— 它暴露设置按钮（API key、voice
    defaults）和 "返回首页" reset 操作，lab 嵌入 hbsc 后用户需要这些
    控制入口。hbsc Nav（页面导航）与 minicast Header（应用内控制）
    服务不同层级，不冲突。 */}
<Header
  onReset={() => {
    if (confirm('确定重置整个工作流？已生成的音频链接也会丢失。')) {
      dispatch({ type: 'RESET' })
    }
  }}
  onOpenSettings={() => setSettingsOpen(true)}
  keySource={keySource}
/>
```

**变更动机**：早先版本把 Header 也隐藏，导致嵌入场景下用户无法访问
设置面板（API key、6 个精选音色选择、提取来源映射等关键配置）。
实测反馈"设置什么的无法设置"正是这个原因。Header 与 hbsc Nav 视觉风格
完全不同（前者深色 + Logo + 状态指示，后者浅色 + 页面链接），共存不冲突。

### 4. ProgressBar 改为始终渲染（2026-07-15 用户反馈调整）

```tsx
{/* ProgressBar 在 embed 模式下也显示 —— hbsc 用户需要看到 4 步进度
    上下文。仅 Header 保持隐藏（hbsc Nav 充当 header 角色）。 */}
<ProgressBar
  steps={stepsOrder}
  current={state.step}
  onJump={(s) => go(s)}
/>
```

**变更动机**：早先版本把 Header 和 ProgressBar 都隐藏，导致嵌入场景
下用户看不到 4-step wizard 的进度提示（仅看到 Step 1 的内容 + "下一步"
按钮，缺少"现在在哪一步"反馈）。实测反馈"minicast 没有完全显示"
正是这个原因。保留 ProgressBar + 仅隐藏 Header 的组合既不与 hbsc Nav
冲突，又给用户完整的进度上下文。

注意：原 ProgressBar 实际 prop 是 `current={state.step}`，不是 `step`。
之前 task 描述里 `step={state.step}` 是简写，实际 patch 必须匹配真实
prop 签名（否则 TS 编译失败）。

## 设计要点

1. **不删除、不重构原有组件**：仅在 App.tsx 顶层做条件渲染，Header
   和 ProgressBar 组件本身保持纯净，可独立测试。
2. **保持所有 props 行为**：条件渲染包住整个 JSX 块，保留全部 props
   与 callback，确保非嵌入模式行为完全不变。
3. **保留 `app-bg` 渐变背景 + 底部 footer**：footer 中包含 Apache-2.0
   与 MiniMax Speech 标识，协议要求保留。
4. **保留 `Toaster`**：嵌入场景下仍可能需要 toast 通知生成完成状态。
5. **保留 `SettingsPanel`**：嵌入场景下 Lab 仍然可以通过
   `setSettingsOpen(true)` 触发（虽然当前嵌入版本 Lab 暂未使用）。

## 验证

- 手动：访问 `http://localhost:5173/?embed=1` 应该看不到顶部 Header
  和顶部 ProgressBar，但 step 内容、app-bg、footer 都还在。
- 手动：访问 `http://localhost:5173/`（无 query）应该看到完整 UI，与
  修改前一致。
- 通过 hbsc 的 `/labs/minicast` Lab 嵌入 iframe `http://.../?embed=1`
  应该呈现干净的 step 流式界面。

## 副作用 / 风险

- 无新依赖
- 无 breaking change（query 默认值为 false）
- 无路由变更
- 无 API 变更
- MiniCast 自身构建（vite build）应照常通过

## 快照

MiniCast 仓根目录 `.snapshots/` 下已创建：

```
.snapshots/embed_mode_20260714_225613.tar.gz           # 初版（含模块级 useMemo bug）
.snapshots/embed_mode_fix_20260714_232103.tar.gz        # 修正版（模块级常量，Header+ProgressBar 都隐藏）
.snapshots/progress_in_embed_20260715_084119.tar.gz    # ProgressBar 在 embed 模式下保留
.snapshots/header_in_embed_20260715_084832.tar.gz       # Header 也保留（暴露设置按钮）
```

包含 patch 后的 `web/src/App.tsx`，便于回滚或对比。

## 关联

- hbsc `MiniCastLab.tsx` 内的 iframe 后续会在 src URL 后追加
  `?embed=1`，与本 patch 配套生效。
- `registry.json` 中 MiniCast lab 的 `path` 指向 `/labs/minicast`，由
  React Router 处理路由，iframe src 解析由 Lab 组件完成。