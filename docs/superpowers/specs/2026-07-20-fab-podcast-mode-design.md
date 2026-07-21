# 数创智伴 · FAB 播客播放模式设计

**日期**：2026-07-20
**作者**：Codex + 用户共创
**状态**：设计草案 v1（待用户审阅）
**前置**：`2026-07-20-page-agent-mode-split-design.md`（"读懂本页 / 协助操作"两 tab 已落地）
**范围**：前端 `PageAgentPanel` 加第三 tab + 后端新增 `/api/public/podcast/*` 代理 MiniCast 服务

---

## 1. 问题陈述

当前 `PageAgentPanel` 已支持"读懂本页"和"协助操作"两个文字模式。但对于一篇 8000 字的技术文章，用户真正想要的是**躺着听完**而不是看完——这才是播客形态存在的理由。

参照本地 `~/Projects/MiniCast`（一个独立的中文 AI 播客生成项目），它已经能用 URL → 提取正文 → LLM 写两人对谈脚本 → TTS 出 MP3 这条流水线跑通。但是它的 Web UI 是 4 步向导，每次生成都要点 4 次，对临时想听一篇文章的用户摩擦太高。

**目标**：把 MiniCast 的"生成 → 试听"功能**直接内嵌**到数创智伴的 FAB 第三 tab 里——用户在文章详情页点 FAB → 切到"播一下"→ 一键生成 → 直接内嵌 `<audio>` 播放。

---

## 2. 设计决策

### 2.1 第三 tab：「播一下」

`PageAgentPanel` 顶部 modeTabs 从 2 个扩到 3 个：

| Tab | 文案 | 图标 | 默认激活 |
|---|---|---|---|
| 读懂本页 | `BookOpen` | 蓝 | ❌（沿用现默认） |
| 协助操作 | `MousePointerClick` | 金 | ❌ |
| **播一下** | `Headphones` | 紫（#9d6bdc） | ❌ |

**激活态样式**：与其他 tab 一致（深色实心背景 + 白字）。

### 2.2 「播一下」tab 的 body 内容（不是聊天框）

切到播一下 tab 后，body 区域**不再显示历史**，而是显示一个**播客生成面板**：

```
┌─ 播一下 ──────────────────────────────┐
│                                       │
│  本期嘉宾：                            │
│   [🎙️ 小数 (男) · 磁性深沉]  ← 默认选中│
│   [🌸 小创 (女) · 温暖热情]  ← 默认选中│
│                                       │
│  时长预估：~3 分 30 秒                  │
│                                       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                       │
│  状态：                                │
│   · idle   → 显示 [开始生成] 按钮     │
│   · loading → 显示 4 段进度：           │
│       1/4 提取正文 ✓                   │
│       2/4 编写对谈脚本... (LLM)         │
│       3/4 合成音频... (TTS)             │
│       4/4 准备播放器                   │
│   · ready  → 显示                      │
│       <audio controls>                 │
│       + 脚本预览 (折叠面板)             │
│       + [下载 MP3] [下载字幕 SRT]       │
│                                       │
└───────────────────────────────────────┘
```

**关键 UX 约束**：
- **音色固定为「小数（男）+ 小创（女）」**，不允许用户切换（用户原话："以男（小数）女（小创）对谈的方式"）。但音色卡仍展示卡片，让用户知道是谁在说话。
- **生成按钮始终是单按钮**，叫「开始生成」（不要让人误以为可以中途插入文本）。
- **生成中显示 4 段进度**，每段开始时打勾，给用户"事情在推进"的视觉反馈。
- **失败时显示降级提示**：「MiniCast 服务暂不可用，你可以[打开完整工作台 →]」——指向 `/labs/minicast/?embed=1&source=<当前页 URL>`。

### 2.3 当前页面 → MiniCast 素材

切到"播一下"tab 时，前端从 `collectPageContext()` 拿当前页：
- **URL**（必备，作为 MiniCast `/api/extract` 的输入）
- **标题**（作为 `title_hint` 让 MiniCast LLM 写脚本时更贴题）
- **正文内容**（备选——若 URL 提取失败，可直接传纯文本 fallback）

### 2.4 音色映射（hbsc 命名 → MiniCast voice_id）

| hbsc 角色 | MiniCast `voice_id` | 性别 | 说明 |
|---|---|---|---|
| **小数**（男） | `midnight_male`（老 K · 深夜电台） | 男 | 磁性低沉，最适合"嘉宾"身份 |
| **小创**（女） | `warm_female`（小 A · 温暖电台） | 女 | 热情感染力，最适合"主持人"身份 |

这两个组合在 MiniCast 自带示例里就是默认的"双人新闻对谈"组合，不需要改 MiniCast 端。

### 2.5 跨服务架构

MiniCast 是独立服务（端口 `5577` web + `8000` API），跑在用户本机。hbsc 后端**不能**假设 MiniCast 在线上 —— 必须做**优雅降级**：

```
┌────────────┐  /api/public/podcast/extract   ┌────────────┐
│            │ ─────────────────────────────► │            │
│  Frontend  │  POST {url}                    │  hbsc      │  httpx  ┌────────────┐
│  PageAgent │                                │  backend   │ ──────► │  MiniCast  │
│  Panel     │  /api/public/podcast/generate  │  (新 router│         │  API :8000 │
│            │ ─────────────────────────────► │   public_  │ ◄────── │            │
│            │  POST {url, voice_a, voice_b}  │   podcast) │  JSON   │            │
│            │                                │            │         │            │
│            │  /api/public/podcast/download  │            │         │            │
│            │ ─────────────────────────────► │            │         │            │
│            │  GET  {job_id}                 │            │         │            │
│            │ ◄────────────────────────── MP3 │            │         │            │
└────────────┘                                └────────────┘         └────────────┘
```

**关键不变量**：
- API key / MiniCast 配 MiniMax Token 留在 hbsc **后端**；前端不直接调 MiniCast，避免 CORS 与凭据泄漏
- MiniCast 不可达时返回 `{ok: false, code: "minicast_unavailable", hint: "..."}`；前端展示降级提示
- MiniCast 自身接口契约不变（hbsc 是消费者，不是 fork）

### 2.6 配置开关

参考 page_agent.enabled 的模式，新加一对设置：

| 设置 key | 默认值 | 说明 |
|---|---|---|
| `podcast.enabled` | `true` | 总开关；admin 关掉后 FAB 隐藏"播一下" tab |
| `podcast.minicast_base_url` | `http://127.0.0.1:8000` | MiniCast 后端地址（开发环境用 `127.0.0.1:8000`，生产部署再覆盖） |

`podcast.enabled` 也作为 `/api/public/podcast/config` 的 FAB 可见性 gate（跟 page_agent 同样策略）。

---

## 3. 数据流

### 3.1 前端状态机

```ts
type PodcastStatus =
  | { kind: 'idle' }
  | { kind: 'extracting' }
  | { kind: 'scripting'; chars: number }
  | { kind: 'synthesizing'; segment: number; total: number }
  | { kind: 'ready'; jobId: string; mp3Url: string; srtUrl?: string; durationSec: number }
  | { kind: 'error'; code: string; message: string; fallbackHref?: string }
```

进度条对应：

```ts
const steps = [
  { key: 'extracting',  label: '提取正文' },
  { key: 'scripting',   label: '编写对谈脚本' },
  { key: 'synthesizing',label: '合成音频' },
  { key: 'ready',       label: '准备播放器' },
]
```

### 3.2 后端路由（新文件）

`backend/app/routers/public_podcast_router.py`：

```
POST /api/public/podcast/extract
  body: { url: string }
  → 调 MiniCast /api/extract，返回 { title, content, char_count }

POST /api/public/podcast/generate
  body: { url: string, voice_a?: str='midnight_male', voice_b?: str='warm_female',
          title_hint?: str, mode?: str='duo' }
  → 1) /api/extract (拿 content)
    2) /api/generate-script (拿 script)
    3) /api/synthesize (拿 job_id + mp3_url)
  → 返回 { job_id, mp3_url, srt_url?, duration_seconds, script_text }

GET /api/public/podcast/download/{job_id}
  → 反向代理 MiniCast /api/jobs/{job_id}/download，吐 MP3 流

GET /api/public/podcast/config
  → 返回 { enabled: bool, voice_a: {label,emoji}, voice_b: {...} }
```

**复用基础设施**：
- `rate_limit(max_calls=N, window_seconds=60, key="public_podcast_...")` — 比 agent_llm 略宽（一次完整播客要 3 次 MiniCast 调用，给 30/分钟）
- **API key 不暴露**：MiniCast 自己从 env 读 `MINIMAX_API_KEY`；hbsc 这边不动 key（跟 agent_llm 注入 key 不同）
- **body cap**：`MAX_PUBLIC_PODCAST_BYTES = 256 KB`（URL 不大，留足余量）
- **超时**：`httpx.Timeout(180.0)` — MiniCast synthesize 可能要 30-90 秒

### 3.3 配置读写

复用 `admin_setting_defaults.py` 命名空间 `podcast.*`：

```python
DEFAULT_PODCAST_ENABLED = "true"
DEFAULT_PODCAST_MINICAST_BASE_URL = "http://127.0.0.1:8000"
```

admin 在 `AdminSettings` 页新增一对 row；前端 `/config` 拉这两个值。

### 3.4 模式存储扩展

`modeStorage.ts` 的 `AgentMode` 从 `'ask' | 'operate'` 扩展为 `'ask' | 'operate' | 'podcast'`：

```ts
export type AgentMode = 'ask' | 'operate' | 'podcast'
```

播客模式**不写 history**（它的"上下文"是脚本本身，已经在播客面板里了）；只有 ask/operate 写 sessionStorage。

---

## 4. UI 改动示意

```
┌─ PageAgentPanel ──────────────────────────┐
│ [Header: 数创智伴 / 关闭]                   │
│ [ContextBar: 当前页 · 标题]                 │
│ [ModeTabs: 读懂本页 | 协助操作 | 播一下]    │  ← 多一个 tab
│ ─────────────────────────────────────────│
│ [Body:                                     │
│   ask / operate: 沿用现有气泡历史            │
│   podcast: PodcastPanel 组件                │  ← 新组件
│ ]                                          │
│ ─────────────────────────────────────────│
│ [Footer:                                   │
│   ask/operate: textarea + 提问/执行按钮     │
│   podcast:    (由 PodcastPanel 自带按钮)    │  ← footer 在 podcast 时不渲染
│ ]                                          │
└─────────────────────────────────────────┘
```

---

## 5. 验收标准

1. **FAB 默认两 tab 文案不变**（「读懂本页 · 协助操作」），进入面板时仍默认"读懂本页"
2. **第三个 tab「播一下」可点**——切过去后 body 切换为 PodcastPanel，原 history 隐藏但**不删除**
3. **音色卡显示**小数(男)+ 小创(女)，固定不可切换
4. **点击「开始生成」** 在文章详情页能跑通完整链路：extract → script → synthesize → audio ready
5. **音频就绪后**：HTML5 `<audio controls>` 可直接播放；显示「下载 MP3」「下载字幕 SRT」按钮
6. **MiniCast 不可达**：显示降级文案 + 「打开完整工作台」链接到 `/labs/minicast/?embed=1&source=<URL>`
7. **admin 关 podcast.enabled = false**：FAB 仍可点开面板，但播一下 tab 不渲染（连同整组入口隐藏）
8. **回归**：「读懂本页」「协助操作」两 tab 行为完全不变
9. **持久化**：刷新页面后，ask/operate 的 history 各自按 (routeKey, mode) 恢复；播客面板回到 idle（不持久化生成进度）
10. **单次限额**：`/api/public/podcast/generate` 被 rate limit 触发时，返回 429 + 友好中文文案

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| MiniCast 不在线时每次都 timeout 90 秒 | httpx timeout 缩到 30 秒 + 失败立即降级（提示打开完整工作台） |
| MiniCast 自己的 API 契约变 | 后端是单一入口（一个 router 文件），MiniCast 接口变只动这一个文件 |
| TTS 慢导致用户以为卡死 | 4 段进度条 + 每段独立状态文案，不只是 spinner |
| 音色"小数/小创"被误解为 MiniCast 原生音色 | 音色卡副标题写明"基于 MiniCast · 老 K 磁性男声"，避免误导 |
| 后端代理引入新的攻击面（SSRF 到内网） | url 必须通过 `_is_allowed_hbsc_url` 白名单（只允许 hbsc 自家域名 + 用户当前路由）；不在白名单的 URL 走纯文本回退或拒绝 |
| 播客生成失败但前端 retry 时浪费配额 | 同一 url + 5 分钟内只允许 2 次重试（前端按钮在生成中禁用，错误时 [重试] 按钮也加 30s 冷却） |

---

## 7. 验收后动作

- `docs/superpowers/specs/2026-07-14-hbsc-labs-minicast-design.md` 增加一节「与数创智伴播一下 tab 的关系」，说明两者职责（labs/minicast 是完整 4 步工作台，FAB 播一下是 1 步精简入口）
- 不删 `MiniCastLab.tsx`——它继续作为完整工作台存在

---

## 附录 A：与「直接跳到 /labs/minicast」的对比

| 维度 | A 内嵌（推荐） | B 直接跳 |
|---|---|---|
| 摩擦 | 1 步（点 FAB → 点生成） | 4 步（点 FAB → 跳转 → Step1 → Step2 → Step3 → Step4） |
| 视觉一致 | 高（沿用 panel 风格） | 中（切到另一个 iframe 风格） |
| API key 安全 | 高（留在后端） | 高（同） |
| MiniCast 不可达 | 降级提示 | 空白页/iframe 加载失败 |
| 可扩展性 | 中（写死 1 步 UI） | 高（MiniCast 自带编辑脚本能力） |
| 开发成本 | 中（前后端各 1 个文件） | 低（只改前端） |

**选 A 的核心理由**：用户原话强调"**点击播客播放可以自动生成播客**"——这是一键语义，B 方案的 4 步流程不符合预期。
