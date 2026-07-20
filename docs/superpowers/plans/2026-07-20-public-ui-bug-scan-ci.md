# Public UI Bug Scan and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复期刊下拉菜单滞留和搜索结果缺失，并建立覆盖静态检查、单测和关键公开页交互的 CI 基线。

**Architecture:** 导航下拉改为单一 hover/focus/click 状态规则，离开完整触发器与菜单区域即关闭；搜索页面直接消费后端权威 `{items,total}` 契约并将文章条目渲染为可点击链接。GitHub Actions 使用现有 npm scripts 加关键 Playwright smoke tests，防止交互与数据契约回归。

**Tech Stack:** React 19、TypeScript、TanStack Query、GSAP、Vitest、Playwright、GitHub Actions。

---

### Task 1: Dropdown close regression

**Files:**
- Modify: `frontend-vite/tests/e2e/visibility-fixes.spec.ts`
- Modify: `frontend-vite/src/components/Navigation.tsx`

- [ ] 添加真实 hover 打开、鼠标移到页面正文后菜单 `aria-hidden=true` 的失败用例。
- [ ] 运行目标 Playwright 用例，确认当前实现失败。
- [ ] 消除 hover 与 click 竞争，确保鼠标离开整个 dropdown wrapper 后关闭。
- [ ] 验证点击、Escape、外部点击、路由切换继续关闭菜单。

### Task 2: Search response contract

**Files:**
- Modify: `frontend-vite/src/services/api.ts`
- Modify: `frontend-vite/src/pages/Search.tsx`
- Create: `frontend-vite/tests/search-page.spec.ts`

- [ ] 拦截 `/api/search` 返回真实 `{items,total}` 并断言文章标题、类型、链接出现。
- [ ] 运行测试确认当前前端只显示计数、不显示条目。
- [ ] 定义 `SearchResponse` 类型并渲染 `items`，移除不存在的 `insights` 分支。
- [ ] 验证零结果、加载态、至少两个字符规则和文章跳转。

### Task 3: CI baseline

**Files:**
- Create: `.github/workflows/frontend-ci.yml`
- Modify: `frontend-vite/package.json`

- [ ] 增加 `test:e2e:smoke` 脚本，覆盖导航下拉、搜索页和 Page-Agent 核心测试。
- [ ] GitHub Actions 安装 Node、npm dependencies 与 Chromium，运行 `lint`、`test`、`build`、smoke E2E。
- [ ] 使用现有命令本地执行并记录仓库既有失败，不顺手修改无关问题。

### Task 4: Completion audit

**Files:**
- Test: `frontend-vite/tests/e2e/visibility-fixes.spec.ts`
- Test: `frontend-vite/tests/search-page.spec.ts`

- [ ] 用单进程 Chromium 复现两个原始场景并截图。
- [ ] 运行目标测试、ESLint、TypeScript/build 与 `git diff --check`。
- [ ] 核对 CI 文件只引用仓库存在的脚本和测试路径。
