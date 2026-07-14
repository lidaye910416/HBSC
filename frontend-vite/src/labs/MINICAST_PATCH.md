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

### 1. 新增 useMemo import

```tsx
// before
import { useEffect, useReducer, useState } from 'react'
// after
import { useEffect, useMemo, useReducer, useState } from 'react'
```

### 2. 在 imports 之后、type Action 之前新增 isEmbedded 常量

```tsx
const isEmbedded = useMemo(() => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('embed') === '1'
}, [])
```

要点：
- `typeof window === 'undefined'` SSR 防御（Vite 默认 SSR 关闭，但保留
  这层可移植性）
- `useMemo(..., [])` 只在挂载时跑一次，避免每次 render 重新解析 URL
- 触发条件：URL query 包含 `embed=1`（严格匹配，避免 `embed=11` 误判）

### 3. JSX 中条件渲染 Header

```tsx
{!isEmbedded && (
  <Header
    onReset={() => {
      if (confirm('确定重置整个工作流？已生成的音频链接也会丢失。')) {
        dispatch({ type: 'RESET' })
      }
    }}
    onOpenSettings={() => setSettingsOpen(true)}
    keySource={keySource}
  />
)}
```

### 4. JSX 中条件渲染 ProgressBar

```tsx
{!isEmbedded && (
  <ProgressBar
    steps={stepsOrder}
    current={state.step}
    onJump={(s) => go(s)}
  />
)}
```

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
.snapshots/embed_mode_20260714_225613.tar.gz
```

包含 patch 后的 `web/src/App.tsx`，便于回滚或对比。

## 关联

- hbsc `MiniCastLab.tsx` 内的 iframe 后续会在 src URL 后追加
  `?embed=1`，与本 patch 配套生效。
- `registry.json` 中 MiniCast lab 的 `path` 指向 `/labs/minicast`，由
  React Router 处理路由，iframe src 解析由 Lab 组件完成。