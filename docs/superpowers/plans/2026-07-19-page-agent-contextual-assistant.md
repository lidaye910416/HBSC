# Page-Agent Contextual Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将公开页 AI 助手升级为匹配湖北数创视觉、能精准理解当前页面且不破坏 Page-Agent 页面操作能力的上下文助手。

**Architecture:** 新增纯函数页面上下文采集器，从语义化 DOM 获取页面类型、标题、正文和技术文章标记；聊天模式把该上下文作为隐藏 system 消息随请求发送，操作模式继续原样调用 `PageAgent.execute()`。FAB 与面板只重做展示层，保留现有测试 ID、session singleton 和恢复链路。

**Tech Stack:** React 19、TypeScript、CSS Modules、TanStack Query、Page-Agent、Playwright。

---

### Task 1: Current-page context contract

**Files:**
- Create: `frontend-vite/src/components/ai/pageContext.ts`
- Modify: `frontend-vite/tests/public-page-agent.spec.ts`

- [ ] 增加 Playwright 用例，拦截 `/api/public/agent/execute` 并断言文章页请求含 system 上下文、页面标题、URL、正文片段及思维导图提示。
- [ ] 运行 `npx playwright test tests/public-page-agent.spec.ts --grep "current article context"`，确认测试先失败。
- [ ] 实现 `collectPageContext(document, location)` 与 `buildPageContextMessage()`，限制正文长度并排除导航、助手面板等非正文区域。
- [ ] 重跑目标用例，确认通过。

### Task 2: Context-aware chat panel

**Files:**
- Modify: `frontend-vite/src/components/ai/PageAgentPanel.tsx`
- Modify: `frontend-vite/tests/public-page-agent.spec.ts`

- [ ] 增加空状态页面识别、技术文章思维导图提示及当前页问答快捷问题的断言。
- [ ] 将上下文 system 消息仅注入聊天 `/execute` 请求；历史记录仍只保存用户可见消息。
- [ ] 保持 `sendOperate()`、`acquire()` 恢复轮询和 `agent.execute(userText)` 完全独立，不向 Page-Agent 指令拼接正文。
- [ ] 运行聊天与操作模式回归用例。

### Task 3: Site-coordinated visual redesign

**Files:**
- Modify: `frontend-vite/src/components/ai/PageAgentFab.tsx`
- Modify: `frontend-vite/src/components/ai/PageAgentFab.module.css`
- Modify: `frontend-vite/src/components/ai/PageAgentPanel.tsx`
- Modify: `frontend-vite/src/components/ai/PageAgentPanel.module.css`

- [ ] 更新 FAB 文案为“页面 AI / 理解本页 · 执行操作”，采用深蓝玻璃底、蓝色状态点与克制金色强调。
- [ ] 面板增加当前页面状态条、清晰的“问当前页”和“执行操作”动作层级，以及适配移动端的底部面板布局。
- [ ] 保留所有现有 `data-testid` 和可访问性标签，避免破坏 Page-Agent E2E 选择器。
- [ ] 截取首页和文章页桌面截图，检查与导航、正文、浮层的视觉协调。

### Task 4: Full regression and completion audit

**Files:**
- Test: `frontend-vite/tests/public-page-agent.spec.ts`

- [ ] 运行 `npx playwright test tests/public-page-agent.spec.ts`，确认 FAB、聊天、操作、disposed recovery 全部通过。
- [ ] 运行 `npx eslint src/components/ai/PageAgentFab.tsx src/components/ai/PageAgentPanel.tsx src/components/ai/pageContext.ts`。
- [ ] 运行 `git diff --check` 并检查 diff 未修改 `pageAgentSession.ts` 的核心生命周期逻辑。
- [ ] 对照三项用户要求逐项核验：视觉匹配、当前页精准问答与技术文章提示、Page-Agent 操作正常。
