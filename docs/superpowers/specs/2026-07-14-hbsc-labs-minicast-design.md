# Design Spec: hubei-shuchuang 数创实验室 + MiniCast 整合

| | |
|---|---|
| **Date** | 2026-07-14 |
| **Author** | Claude (via brainstorming session) |
| **Status** | Awaiting review |
| **Branch** | `feat/labs-minicast` |
| **Worktree** | `/Users/jasonlee/hubei-shuchuang/.worktrees/feat-labs-minicast` |

## 1. Background

hubei-shuchuang（湖北数创）主站已上线，本期需求是新增"数创实验室"作为承载内部 vibe coding 实验项目的容器。第一个实验项目是 MiniCast（中文 AI 播客生成器）。

**约束**（用户明确提出）：
1. **互不干扰**：hbsc 与 minicast 两个项目不能相互影响代码和运行状态
2. **两项目都正常**：hbsc 主站不能因本次集成出现退化，minicast 必须保留独立可运行
3. **可扩展**：未来还会有其他 vibe coding 项目接入"数创实验室"

**当前状态**：
- hbsc 主仓在 `main` 分支，HEAD 为 `c1203d2`；领先 origin/main 6 commits；工作区有 40 文件脏改动 + 51 未跟踪（**由另一个 session 推进中，本次任务不触碰**）
- minicast 在 `/Users/jasonlee/Projects/MiniCast/`，**不是 git 仓库**（用 tar.gz 快照代替），独立 Vite+React+FastAPI 项目
- hbsc 已有嵌套 worktree `.claude/worktrees/agent-aa31589f09a2d12e4`（同仓并行开发）

## 2. Goals

1. hbsc 首页 Nav 增加"数创实验室"标签，激活态匹配 `/labs` 前缀
2. `/labs` 是 landing 页：列出当前所有 lab 项目，含 MiniCast（active）和若干占位（coming soon）
3. 点 MiniCast 卡片 → 跳转 `/labs/minicast` → 全屏 iframe 加载 minicast SPA，minicast 自带 Header/ProgressBar 隐藏，避免与 hbsc Nav 双层
4. minicast 必须**仍然能独立运行**（URL 不带 `?embed=1` 时行为不变）
5. 后期加新 lab 只需：(a) 在 hbsc 注册表添一行；(b) 启动新 lab 服务；(c) prod 加 Nginx location

## 3. Non-Goals（本期不做）

- minicast 后端合并到 hbsc FastAPI
- 生产环境 Nginx 反向代理配置（dev 跑通即可，prod spec 留后续）
- labs 列表的运行时增删（先用静态 JSON；需要动态化时再开新 spec）
- iframe 内外的 postMessage 联动（高度自适应、路由同步等）
- minicast 自身代码的重构或新功能
- 跨项目统一登录态（保持 hbsc 公开站无登录，minicast 仍只用 localStorage API key）

## 4. Architecture

### 4.1 系统拓扑

```
┌──────────────────────────────────────────────────────────────┐
│ hubei-shuchuang (独立项目，不动其代码组织)                       │
│ ├─ frontend-vite/src/                                         │
│ │   ├─ labs/                          ← 本期新增              │
│ │   │   ├─ registry.json              ← 新增                  │
│ │   │   ├─ LabsPage.tsx               ← 新增                  │
│ │   │   ├─ LabCard.tsx                ← 新增                  │
│ │   │   ├─ MiniCastLab.tsx            ← 新增                  │
│ │   │   └─ labs.css                   ← 新增                  │
│ │   ├─ components/Navigation.tsx      ← 改：加 数创实验室 链接 │
│ │   ├─ components/Footer.tsx          ← 改：加 数创实验室 链接 │
│ │   └─ App.tsx                        ← 改：加 2 个 Route      │
│ ├─ .gitignore                         ← 改：加 .worktrees/     │
│ └─ backend/                            ← 完全不动              │
│                                                               │
│ MiniCast (独立项目，只动 1 个文件)                                │
│ └─ web/src/App.tsx                    ← 改：读 ?embed=1 隐藏    │
│                                            Header+ProgressBar  │
└──────────────────────────────────────────────────────────────┘

Dev 端口：
  hbsc 前端      :5173  (vite dev)
  hbsc 后端      :8000  (uvicorn)
  minicast 前端  :5577  (vite dev, vite.config 中 strictPort)
  minicast 后端  :8899  (uvicorn)

iframe src 在 dev 中：
  http://localhost:5577/?embed=1
```

### 4.2 Worktree 隔离

```bash
# 已执行
cd /Users/jasonlee/hubei-shuchuang
git worktree add .worktrees/feat-labs-minicast -b feat/labs-minicast
cd .worktrees/feat-labs-minicast
```

- 新分支 `feat/labs-minicast` 从 main HEAD `c1203d2` 分支
- 主 worktree 的脏改动和 `.claude/worktrees/agent-aa31589f09a2d12e4` 都不影响本 worktree
- `.worktrees/` 已加入本仓 `.gitignore`（在 `feat/labs-minicast` 分支 commit），merge 回 main 后生效
- 完成后通过 PR / merge 回到 `main`，与另一 session 的工作协调合并

### 4.3 minicast embed 模式

修改 `MiniCast/web/src/App.tsx`：

```tsx
// 新增：URL query 读取，默认 false（独立运行不受影响）
const isEmbedded = useMemo(() => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('embed') === '1'
}, [])

// 渲染：embed 模式下隐藏 Header + ProgressBar
return (
  <ErrorBoundary>
    <div className="minicast-root">
      {!isEmbedded && <Header />}
      <main className={isEmbedded ? 'embedded' : ''}>
        {!isEmbedded && <ProgressBar step={state.step} />}
        {renderStep(state.step)}
      </main>
    </div>
  </ErrorBoundary>
)
```

**为什么用 URL query 而不是 postMessage**：
- URL 方案代码量最小（5 行以内）、语义清晰、deep-link 友好
- minicast 独立运行时无 query，feature flag 默认关闭，零回归风险
- 跨域 sandbox 限制让 postMessage 方案复杂且不可靠

## 5. Components

### 5.1 新增文件

| 路径 | 职责 |
|---|---|
| `frontend-vite/src/labs/registry.json` | 静态 lab 注册表。schema：`{ labs: [{ id, title, subtitle, description, icon, dev: { iframeSrc }, prod: { iframeSrc }, status, tags }] }` |
| `frontend-vite/src/labs/LabsPage.tsx` | `/labs` 落地页组件。从 registry.json 读数据，渲染 hero + 卡片网格 |
| `frontend-vite/src/labs/LabCard.tsx` | 卡片组件。三态：`active`（蓝边框 + ACTIVE 徽章 + CTA 链接）/ `coming-soon`（灰显 + COMING SOON 徽章 + 禁用 CTA）/ `disabled`（同 coming-soon，文案略不同） |
| `frontend-vite/src/labs/MiniCastLab.tsx` | `/labs/minicast` 全屏 iframe 容器。读 `import.meta.env.DEV` 决定 src 是 `http://localhost:5577/?embed=1` 还是 `/labs/minicast/?embed=1` |
| `frontend-vite/src/labs/labs.css` | 局部样式。**只引用 `var(--color-*)` 和 `var(--font-*)` token，不引入新颜色或字体**；遵守全局 CSS 布局规范（不锁宽、不负 margin、保留 `html/body overflow-x: hidden`） |

### 5.2 修改文件

| 路径 | 改动 |
|---|---|
| `frontend-vite/.gitignore` | 不改 |
| `.gitignore`（仓库根） | 新增 `.worktrees/` 条目 |
| `frontend-vite/src/App.tsx` | Routes 数组加 `/labs` 和 `/labs/minicast` 两条 |
| `frontend-vite/src/components/Navigation.tsx` | `navLinks` 数组加 `{ label: '数创实验室', path: '/labs' }`；`isLabsActive` 判断 `location.pathname.startsWith('/labs')` |
| `frontend-vite/src/components/Footer.tsx` | 内容列加 "数创实验室" 链接 |
| **另一项目** `/Users/jasonlee/Projects/MiniCast/web/src/App.tsx` | 加 `isEmbedded` 状态，条件渲染 `<Header />` 和 `<ProgressBar />`（注意：此文件不在 hbsc 仓内，需单独在 minicast 项目目录修改 + 留快照记录） |

### 5.3 不动的文件

- `frontend-vite/src/index.css` —— 极简原则，按 CLAUDE.md
- `frontend-vite/src/App.css` —— 同上
- `frontend-vite/src/styles/global.css` —— 不改，新增样式全部在 `labs.css` 内
- `hbsc/backend/**` —— 完全不动

## 6. Data Flow

```
用户点 Nav "数创实验室"
  ↓ router push '/labs'
LabsPage 渲染
  ├─ import registry.json（Vite 编译时静态包含）
  ├─ 过滤 status === 'active' 或 'coming-soon' 的 lab
  └─ 遍历 → 渲染 LabCard 列表

用户点 MiniCast 卡片
  ↓ router push '/labs/minicast'
MiniCastLab 渲染
  ├─ import.meta.env.DEV ? 'http://localhost:5577/?embed=1' : '/labs/minicast/?embed=1'
  └─ <iframe src={...} title="MiniCast" />

iframe 加载 minicast SPA
  ├─ minicast App.tsx 读 ?embed=1
  ├─ true → 不渲染 Header、不渲染 ProgressBar
  └─ false → 完整渲染（默认行为，minicast 独立运行不受影响）

用户在 minicast 内操作
  └─ minicast 调用 /api/* （同源 → minicast vite proxy → :8899 后端）
     dev 中 minicast 自己处理；prod 中由后续 spec 负责 Nginx 反代
```

## 7. Error Handling

| 场景 | 表现 |
|---|---|
| iframe 加载超时（minicast dev 服务未启） | 显示「MiniCast 服务暂不可用，请确认 :5577 已启动」+ 重试按钮 + 跳转到 minicast 独立页链接 |
| minicast 后端挂了 | iframe 内显示 minicast 自身的错误页（minicast 已实现）；MiniCastLab 不重复渲染 |
| `registry.json` JSON 语法错 | Vite 编译时报错；运行时手动改坏了 → 显示「暂无实验项目」+ 联系管理员文本 |
| `registry.json` schema 不符 | LabCard 用 optional chaining + 默认值容错，不致崩页 |
| 浏览器禁用 iframe | `<noscript>` 降级为「点击在新窗口打开 MiniCast」 |
| 跨域 iframe 限制 | 不依赖跨域通信（纯 src URL 控制），无此问题 |

## 8. Testing

### 8.1 单元 / 集成

| 测试 | 工具 | 范围 |
|---|---|---|
| LabCard 三态快照测试 | vitest + @testing-library/react | active / coming-soon / disabled 渲染差异 |
| registry.json schema 校验 | 自定义 JSON Schema + vitest | 启动时校验所有 lab 字段存在且类型正确 |
| Navigation 渲染含「数创实验室」 | vitest + jsdom | navLinks 数组新增项后断言 |
| Navigation 激活态 `/labs` 和 `/labs/minicast` 都高亮 | vitest + jsdom | `isLabsActive` 逻辑覆盖 |
| MiniCastLab iframe src 选择 | vitest + jsdom | `import.meta.env.DEV` 切换 dev/prod URL |

### 8.2 E2E（Playwright，hbsc 已有）

| 测试 | 步骤 |
|---|---|
| Nav → Labs 全链路 | 1. 访问 / 2. 点 Nav "数创实验室" → 断言 URL=/labs 3. 看到 MiniCast 卡片 + 2 个占位卡片 4. 断言卡片文案、CTA、徽章 |
| MiniCast iframe 嵌入 | 前置：手动启 `cd /Users/jasonlee/Projects/MiniCast && python -m minicast server` + `cd web && npm run dev`。步骤：1. 访问 /labs/minicast 2. iframe 加载成功 3. iframe 内 miniCast Header 不在 DOM 4. iframe 内 miniCast step1 可输入 |
| iframe 降级 | 1. 关闭 minicast dev 2. 访问 /labs/minicast 3. 看到降级提示 + 重试按钮 |
| minicast 独立运行未受影响 | 1. 直接访问 http://localhost:5577/ 2. 断言 Header 和 ProgressBar 都在 3. 走完 4-step 流程 |

### 8.3 视觉回归

- `/labs` 页面与 mockup 视觉对比（用 Playwright visual snapshot）
- 响应式：1280px / 768px / 375px 三档宽度截图

## 9. Risks & Open Questions

### 9.1 已识别风险

| 风险 | 缓解 |
|---|---|
| 另一 session 在 main 上改了 Navigation.tsx，我们 merge 时冲突 | 本分支不修改他们可能改的逻辑区域；merge 时人工 resolve |
| iframe 在某些浏览器被第三方 cookie 策略拦截 | minicast API 用 same-origin，无 cookie；嵌入不受影响 |
| minicast 后端 :8899 在生产环境没起来 | 本期 prod 不在范围；dev 跑通即可 |
| React 19 vs React 18 兼容 | 我们不修改 minicast 的 package.json；iframe 是黑盒，版本差异互不影响 |

### 9.2 后续 spec 候选

1. **Prod 部署 spec**：Nginx 反代 `/labs/minicast/` → :5577，`/api/minicast/` → :8899；minicast docker-compose 接入 hbsc 部署栈
2. **Labs 动态化 spec**：从 hbsc 后端 `GET /api/labs` 读取；支持 admin 后台增删
3. **postMessage 联动 spec**：iframe 高度自适应 + 路由同步（如果用户体验需要）

## 10. Success Criteria

完成本期实现的标志：

1. ✅ 在新 worktree `feat/labs-minicast` 上提交，所有新增 / 修改文件都在本分支
2. ✅ `frontend-vite` build 通过（`npm run build` 无错误）
3. ✅ 单元测试全绿（`npm run test` 或 vitest）
4. ✅ Playwright e2e 全绿（依赖 minicast dev 服务启动）
5. ✅ `/labs` 页面与 mockup 视觉一致
6. ✅ `/labs/minicast` iframe 嵌入正常，minicast Header 隐藏
7. ✅ minicast 独立运行（无 query）行为不变
8. ✅ 主 worktree 状态未受影响（git status 与创建 worktree 前一致）
