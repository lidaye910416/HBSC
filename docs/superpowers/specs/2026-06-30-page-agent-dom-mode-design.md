# 公开页面 AI 助手升级为 DOM Agent（设计）

> 日期 2026-06-30
> 状态 设计中（等待用户复核）

## 背景 & 现状

公开页面右下角 `<button class="page-agent-fab">`（`frontend-vite/src/components/admin/PageAgentPanel.tsx:237-244`）当前仅是一个**纯 LLM 问答助手**：调用 `/api/public/agent/execute`，后端透传 messages 到 OpenAI 兼容接口，**仅返回 `{content}` 文本**。它没有读取页面 DOM、没有执行任何点击/输入操作，也没有官方 page-agent (`alibaba/page-agent` v1.10) 的 reflect-before-action 多步 tool-calling 能力。

而官方 page-agent 文档（`https://alibaba.github.io/page-agent/docs/introduction/overview` 中文版）明确该库定位是"页面内嵌式 GUI Agent"：

> 「把答疑助手变成全能 Agent。客服机器人不再只说『请先点击设置按钮然后点击...』，而是直接帮用户现场操作。」

本设计的核心目标是把 FAB 升级为**真的能读当前页面 DOM、帮用户现场操作的 GUI Agent**，同时保留一个轻量聊天入口。

## 目标 & 非目标

**目标**：
1. 在公开页面的 page-agent FAB 上**同时提供两种模式**：聊天（text-only）和操作（DOM 多步 tool-calling）
2. 用户输入框下方两个按钮 `✿ 问他` / `✿ 让他操作` 让用户自选模式
3. **API Key 永不离开服务器** —— 通过 `LLMConfig.customFetch` 把所有 OpenAI 协议请求转发到后端 `/api/public/agent/llm`
4. 在 admin 后台和首页关键操作按钮上加 `data-ai-blocked` 属性，形成 page-agent 元素级黑名单
5. FAB 视觉重塑为"AI 助手"调性（Sparkles 图标 + 拟物化动效）

**非目标**：
- ❌ admin 后台继续提供 page-agent 对话入口（用户决策 admin 不再用）
- ❌ 引入新的 API Key 命名空间（chat 与 dom 共用现有 `page_agent.api_key`）
- ❌ 全量改写 page-agent 内部实现或 fork 上游包
- ❌ 替换现有 AdminSettings 中 `page_agent.*` 配置（**配置 schema 不变**）
- ❌ 改造 article_typesetter.* / CMS 编辑器

## 已确认的关键决策

| 决策点 | 选定值 | 理由 |
|---|---|---|
| 行为模式 | **chat + DOM 双模式并存** | 用户决策 |
| 触发方式 | **一个输入框 + 两个按钮** | 用户决策 —— 最明确，避免误触 |
| 模型 | **复用现有 `page_agent.api_key`** | 用户决策 —— 配置最简 |
| 启用范围 | **仅公开页面启用（public）** | 用户决策 —— admin 不再使用 |
| 视觉风格 | **Sparkles + 拟物化**（墨色渐变 + 金边 + 漂浮动效） | 用户决策 |
| 集成方案 | **npm `page-agent` v1.10 + `customFetch` 后端代理** | 推荐方案 —— key 不出门 |
| 高危按钮 | **本期同步加 `data-ai-blocked`** | 用户决策 —— 缓解 anonymous DOM agent 滥用 |
| `agent_router` admin 端 | **删除 `/config` + `/execute`** | 与"admin 不再用 page-agent"一致；保留 settings 测试连通端点 |

## ⚠️ 安全约束（重要）

**API Key 永远不进浏览器**：复用已有 AdminSetting Fernet 加密 + masked 回显链路。具体的 `page_agent.api_key` 已经被加密存储在 `AdminSetting` 表里（`backend/app/models/admin_setting.py`），前端仅看到形如 `sk-cp***` 的 masked 值。新的 `/api/public/agent/llm` 端点从数据库 decrypt 后注入到上游请求的 `Authorization` header，**绝不让浏览器侧缓存或转发过 plaintext key**。

**Anonymous DOM Agent 操作边界**：visitor 是 anonymous 用户，理论上可以反复发起 DOM 操作请求造成：
- 滥用 token 配额
- 误点击（提交表单、删除数据）
- 越权调用（POST/PUT/DELETE 等可能影响服务端状态的请求）

**必须强制**的几条护栏：
1. **元素级黑名单 `data-ai-blocked`** —— page-agent 的 PageController 会扫描元素的 `data-*` attribute 并把含此属性的元素视为不可操作
2. **prompt 强化护栏** —— 在 `page_agent.system_prompt` 末尾追加「禁止点击任何含 `data-ai-blocked` 属性的元素；禁止提交表单（`<form>` element 的 submit）；禁止触发 DELETE/PUT/POST 方法的网络请求」
3. **URL 类型白名单** —— `getPageInstructions(url)` 根据 URL 路由附加 mode-specific 指引（详见 §架构）
4. **后端 URL-prefix 校验** —— `agent_llm` 端点拒绝 `url` 不是 `settings.page_agent.base_url` 前缀的请求
5. **Same-origin Referer** —— `agent_llm` 端点拒绝 Referer 不是本站的请求（允许 `""` 兼容 curl 测试）
6. **rate-limit 收紧** —— dom 模式 5/min/IP，chat 模式 10/min/IP（dom 因多步循环 + 长上下文更贵）
7. **payload cap 区分** —— chat 1MB，dom 2MB（tools schema 比纯 chat 大）
8. **关掉 JS 注入** —— `experimentalScriptExecutionTool: false`
9. **敏感信息脱敏** —— `transformPageContent` 替换手机号/邮箱/token-like 字符串为 `***`
10. **limits** —— 单任务 `maxSteps: 20`，单 step timeout 30s（page-agent 默认值）

## 架构

### 后端变更

```
backend/app/routers/
├── public_agent_router.py            # 改：execute 支持 mode + 新增 /llm 端点
└── agent_router.py                   # 改：仅保留 settings 测试连通；删除 /config + /execute

backend/app/services/
├── llm_client.py                     # 不动（chat 模式继续走它）
└── admin_setting_defaults.py         # 改：DEFAULT_PAGE_AGENT_SYSTEM_PROMPT 末尾追加护栏
```

**`public_agent_router.py` 改 `execute`**：

现有签名接受 `{messages: [...]}`，新增可选字段 `mode: 'chat' | 'dom'`、`tools`、`tool_choice`、`page_url`、`page_kind`：

| `mode` | 路径 |
|---|---|
| `chat`（默认） | 现有 chat_complete 流不变 |
| `dom` | 把 `{ messages, tools, tool_choice, page_url, page_kind }` 整体打包 forward 到 `/api/public/agent/llm`（实际上前端通过 `customFetch` 直接打 `/api/public/agent/llm`，不走 `/execute`） |

**`public_agent_router.py` 新增 `/api/public/agent/llm`**：

```python
class AgentLLMRequest(BaseModel):
    url: str        # 上游完整 OpenAI URL
    init: dict      # fetch init 的 dict: {method, headers (除 Authorization), body}

@router.post("/agent/llm")
@rate_limit(max_calls=5, window_seconds=60)   # dom 专属 limit
async def agent_llm(req: AgentLLMRequest, request: Request, db: Session = Depends(get_db)):
    settings = _load_chat_config(db, mode='dom')
    # 1) enabled + api_key 已由 _load_chat_config 校验
    # 2) URL 必须严格匹配 base_url：(parsed.scheme, parsed.hostname, parsed.port, '/v1/'.startswith(parsed.path)) 全等，否则 403
    #    防御 DNS rebinding / suffix 绕过
    # 3) Referer 校验：必须为空或同源（same scheme+hostname+port），否则 403
    # 4) body cap 2MB，否则 413
    # 5) 注入 Authorization: Bearer <decrypted_key>
    # 6) 用 httpx.AsyncClient 转发，原样返回 response 字节 + headers（除 hop-by-hop）
```

> URL 严格校验放在 `_is_allowed_url(req.url, settings.base_url)` 帮手里：
> ```python
> def _is_allowed_url(target: str, base_url: str) -> bool:
>     a = urlparse(target); b = urlparse(base_url)
>     return (a.scheme == b.scheme == 'https'
>             and a.hostname == b.hostname
>             and a.port == b.port
>             and a.path.startswith(b.path))     # b.path 形如 '/v1/'
> ```

> 重要：原 `OpenAIClient` 自带 `fetch`，`customFetch` 接收的是 `RequestInfo | URL` 而不是 string，因此前置代码里改成 `await fetch('/api/public/agent/llm', {...body: JSON.stringify({url: String(url), init})})` 把上游 URL 序列化进 body。

**`public_agent_router.py` 复用机制** —— 把现在的 `execute` 与新建的 `llm` **共享**一个 `_load_chat_config()` 帮手（已存在但分散），把"读 enabled / decrypt api_key / 限速闸门"集中到一个函数：

```python
def _load_chat_config(db, *, mode: Literal['chat', 'dom']) -> ChatConfig:
    settings = load_all_page_agent_settings(db)
    if not settings.enabled: raise HTTPException(409, "not_enabled")
    if not settings.api_key: raise HTTPException(409, "no_api_key")
    if mode == 'dom':
        # dom 模式额外要求 base_url 是 https
        if not settings.base_url.startswith("https://"):
            raise HTTPException(409, "dom_requires_https_base_url")
    return settings
```

**`agent_router.py` 改动 —— 部分删除**：

| 函数 | 处置 |
|---|---|
| `GET /api/admin/agent/config` | **删除**（admin 不再 chat） |
| `POST /api/admin/agent/execute` | **删除** |
| `POST /api/admin/settings/{key}/test`（connectivity probe） | **保留** —— 但改成放到 `settings_router.py` 里更合适 |
| `_TESTABLE_API_KEYS` 常量 | **保留** —— 搬移到 `settings_router.py` |

> 备注：`/api/admin/settings/{key}/test` 当前在 `agent_router.py` 是历史遗留，把它物理迁移到 `settings_router.py` 是顺势修复（与命名一致）。同时 `_TESTABLE_API_KEYS` 中追加未来的 `article_typesetter.api_key` 等 secret key 时无需修改 router 注册表。

**`admin_setting_defaults.py` 改 `DEFAULT_PAGE_AGENT_SYSTEM_PROMPT`**：

```text
（原 Hubei Guide concierge 文案不变）
...
[NEW —— 追加在末尾]

## ⚠️ DOM 操作护栏（强约束）

当你通过 page-agent 操作当前页面时，以下行为**绝对禁止**，违反任何一条视为失败：
1. 禁止点击、悬停、聚焦任何含 `data-ai-blocked` HTML 属性的元素（包括它的祖先 / 子节点）。
2. 禁止 submit 任何 `<form>` 表单；禁止 `input[type=submit]`、`button[type=submit]` 的点击。
3. 禁止触发任何 HTTP DELETE / PUT / POST 请求；只允许 GET（导航、读取）。
4. 禁止操作登录后可见的页面元素（任何 `/admin`、`/login`、`/account` 路由）；遇到 URL 不在公开白名单时立刻 `done` 并告知用户。
5. 禁止读取 / 暴露页面里出现的 11 位中国大陆手机号、邮箱地址、看起来像 token 的长字符串。
6. 禁止执行 `experimentalScriptExecutionTool`（已禁用，遇到 user 提及时明确说明不可用）。
```

### 前端变更

```
frontend-vite/src/components/
├── PublicPageAgentMount.tsx        # 重写：初始化 page-agent
├── ai/                             # NEW
│   ├── PageAgentFab.tsx           # NEW：浮动按钮（Sparkles + 拟物化）
│   ├── PageAgentPanel.tsx         # NEW：聊天 panel（继承 page-agent 内置 panel 接管）
│   └── PageAgentPanel.module.css  # NEW：FAB + panel 的 CSS（CSS Modules）
├── admin/
│   ├── PageAgentPanel.tsx         # 删除（admin 不用）
│   ├── PageAgentMount.tsx         # 删除（历史 shim）
│   ├── PublicPageAgentMount.tsx   # 删除（被新版 PublicPageAgentMount 替换）
│   └── AdminLayout.tsx            # 改：移除 <PageAgentMount/>

frontend-vite/src/pages/admin/
└── AdminSettings.tsx              # 改：PAGE_AGENT_SECTION.blurb 改成"配置首页公开 FAB 使用的 AI 助手"

frontend-vite/src/
├── App.tsx                        # 改：<PublicPageAgentMount /> 路径更新
└── services/api.ts                # 改：去掉 api.admin.agent.*；新增 api.public.agent.llm({url, init})
```

**`components/PublicPageAgentMount.tsx`** （`useEffect` 内）：

```ts
useEffect(() => {
  if (!configQ.data?.enabled) return
  const customFetch = async (url, init) => {
    const r = await fetch('/api/public/agent/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: String(url), init }),
    })
    // 后端是 OpenAI 兼容的 JSON response
    return new Response(await r.text(), {
      status: r.status,
      headers: r.headers,
    })
  }
  const instructions = configQ.data.system_prompt ?? ''
  const agentRef = new PageAgent({
    baseURL: 'http://placeholder.invalid/v1',     // 永远走 customFetch
    apiKey: 'placeholder',
    model: configQ.data.model,
    language: 'zh-CN',
    customSystemPrompt: instructions,            // 已含护栏
    getPageInstructions: (url) => getPageHint(url),
    // getPageHint(url): 根据 URL 路径返回模式提示
    //   - /articles、/articles/:slug、/、/insights、/cases、/about、/search → "你处于公开页面，可在导航栏、表单字段、链接之间自由操作，注意 data-ai-blocked"
    //   - /admin、/admin/*、/login、/account → 立刻调用 done 工具并告知「此页面不在我可操作范围内」
    //   - 其他 → "未知页面，请谨慎操作"
    maxSteps: 20,
    stepDelay: 0.4,
    transformPageContent: maskSecrets,
    // maskSecrets(content): 把以下命中替换为 ***：
    //   /\b1[3-9]\d{9}\b/g                       (中国大陆手机号)
    //   /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g  (邮箱)
    //   /\b(sk-[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{20,})\b/g (常见 API key 前缀)
    //   /\bBearer\s+[A-Za-z0-9._\-]{20,}\b/g  (Authorization 字串)
    //   /\b\d{16,19}\b/g                          (16-19 位银行卡号)
    experimentalScriptExecutionTool: false,
    customFetch,
  })
  setAgent(agentRef)
  return () => agentRef.dispose()
}, [configQ.data])

if (!configQ.data?.enabled || !agent) return null
return <PageAgentFab onClick={() => agent.panel.show()} />
```

**`components/ai/PageAgentFab.tsx`** —— 浮动按钮组件，CSS Modules 隔离样式：

- 圆形 56×56（移动端 48×48），渐变 `linear-gradient(135deg, #1A1A2E 0%, #16213E 100%)`
- 中心 `<Sparkles size={22} />`（lucide-react），颜色 `#C9A84C`（古铜金）
- 默认 backdrop-filter blur(20px) + box-shadow `0 8px 24px rgba(26,26,46,.28)`
- hover：边框 `--brand-gold` `#C9A84C` 1.5px + scale(1.04) + 阴影变金色
- 漂浮动效：`@keyframes float` 4s infinite，translateY 0 → -4 → 0
- 进入：`@keyframes enter`，scale 0.6 → 1，300ms cubic-bezier，延迟 800ms（避免首屏抖动）

**`components/ai/PageAgentPanel.tsx`** —— 包装 page-agent 内置 panel，按钮分流：

- **整体 panel** 来自 `agent.panel`（page-agent 内置，提供任务进度 / 思考过程 / 操作结果显示）
- **底部两个按钮严格分流到两条独立的代码路径**：
  - `✿ 让他操作`（主按钮）→ `agent.execute(text)` —— 走 page-agent 完整多步循环（DOM 提取 + tool calling + 操作执行）
  - `✿ 问他`（次按钮）→ **不**走 page-agent，而是直接 `fetch('/api/public/agent/execute', { method:'POST', body: JSON.stringify({ mode:'chat', messages: buildChatMessages(prevHistory, text) }) })`，把用户消息追加到现有的本地 chat 历史（panel 自己维护一个 `messages: ChatMessage[]` 状态），渲染后端返回的 assistant 文本气泡
- 这种"两路"设计**不**复用 `agent.execute`，是因为 page-agent v1.10 的 `PageAgent` 类未暴露"只调 LLM 而不动 DOM"的入口；如果走 execute 即便 prompt 强调"不动手"也无法 100% 防止 LLM 输出 tool_call 流。我们宁愿多维护一份轻量 chat 历史，也不想给纯问答走 DOM 循环的副作用。

> **为什么不装两个 PageAgent 实例**：一个用于 DOM 操作，一个用于聊天？答：会浪费一次预热的 token，且 panel 状态难统一。让"问他"走纯 LLM 路径足够。

**`services/api.ts`** 增改：

```ts
api.public.agent.config()       // 已存在，不变
api.public.agent.execute()      // 已存在，不变（chat mode 走它）
api.public.agent.llm({url, init})   // 新增：customFetch 转发
api.admin.agent.*               // 删除
api.admin.settings.test(key)   // 不变（迁到 settings_router 后）
```

### 包安装

```bash
cd frontend-vite
npm install page-agent@^1.10
```

依赖链：`page-agent` → `@page-agent/core` + `@page-agent/llms` + `@page-agent/page-controller` + `@page-agent/ui` + `chalk`。peer dep `zod` 已有（devDependency 里）。

### 配置（不变）

| key | 默认 | 说明 |
|---|---|---|
| `page_agent.enabled` | `"true"` | 总闸 |
| `page_agent.model` | `deepseek-v4-flash` | chat + dom 共用 |
| `page_agent.base_url` | `https://api.deepseek.com/v1` | dom 端点 URL-prefix 白名单 |
| `page_agent.api_key` | （空，admin 必填） | chat + dom 共用，已 Fernet 加密 |
| `page_agent.system_prompt` | 见 §默认护栏文本 | 末尾已追加护栏 |

### 默认值变更（仅一处）

`backend/app/services/admin_setting_defaults.py` 的 `DEFAULT_PAGE_AGENT_SYSTEM_PROMPT` 末尾追加 `## ⚠️ DOM 操作护栏（强约束）` 整段（见 §架构后端变更段）。`KNOWN_KEYS_DEFAULTS` 表不变。

### 流水示意

**chat 模式**（点 `✿ 问他`）—— **不走 page-agent**，直接打后端 chat proxy：
```
[textarea + ✿问他 ✿让他操作]
        │ 点击 ✿ 问他
        ▼
panel 维护的 ChatMessage[] 加一条 user 消息，渲染用户气泡
   └─ fetch('/api/public/agent/execute', {
            method:'POST',
            body: JSON.stringify({
              mode: 'chat',
              messages: buildChatMessages(historyRef.current, text),  // system + 历史 + 当前 user
            })
          })
        └─ 后端 chat_complete(messages) — 现有路径不变
              └─ DeepSeek API
              └─ 返回 { content: "..." }
        └─ panel 把 assistant content 追加到 ChatMessage[]，渲染回复气泡
```

**dom 模式**（点 `✿ 让他操作`）—— 走 page-agent 完整循环：
```
[textarea + ✿问他 ✿让他操作]
        │ 点击 ✿ 让他操作
        ▼
agent.execute('帮我打开首页第三篇文章')
   └─ 循环（最多 maxSteps=20）：
        ├─ PageController 提取精简 DOM（含所有非 [data-ai-blocked] 元素 + locator 编号）
        ├─ transformPageContent 替换手机号/邮箱/token
        ├─ LLMClient.invoke(messages + tools)
        │     └─ OpenAIClient → customFetch
        │           └─ POST /api/public/agent/llm  { url: <deepseek>, init: {...} }
        │                 └─ 后端 decrypt key + 转发 → DeepSeek
        ├─ 解析 toolCall（click / input / scroll / done）
        ├─ PageController 执行（如：locator 5 → .click()）
        └─ 把执行结果写回消息历史，继续下一步
   └─ 当 finish_reason=tool_calls 且 tool=done → 退出循环，渲染结果说明
```

**dom 模式**（点 `✿ 让他操作`）：
```
[textarea + ✿问他 ✿让他操作]
        │ 点击 ✿ 让他操作
        ▼
agent.execute('帮我打开首页第三篇文章')
   └─ 循环（最多 maxSteps=20）：
        ├─ PageController 提取精简 DOM（含所有非 [data-ai-blocked] 元素 + locator 编号）
        ├─ transformPageContent 替换手机号/邮箱/token
        ├─ LLMClient.invoke(messages + tools)
        │     └─ OpenAIClient → customFetch → POST /api/public/agent/llm
        ├─ 解析 toolCall（click / input / scroll / done）
        ├─ PageController 执行（如：locator 5 → .click()）
        └─ 把执行结果写回消息历史，继续下一步
   └─ 当 finish_reason=tool_calls 且 tool=done → 退出循环
```

### `data-ai-blocked` 审计清单（本期同步实施）

按照"被 AI 点到一次就可能造成不可逆后果"的标准审计以下按钮：

**admin 后台**（公开 white-listed 排除，不在 AI 操作范围内 —— 但仍加 `data-ai-blocked` 兜底）：
- `ArticleEditor.tsx`：保存草稿、发布、下线（archived）、删除
- `ArticleIssueEditor.tsx` / `JournalEditor.tsx`（无论项目实际叫哪个）：发布、撤稿、删除
- `Dashboard.tsx`、`AdminArticles.tsx`：删除按钮、批量操作
- `MediaLibrary.tsx`：删除媒体、批量删除
- `AdminLogin.tsx`：登录提交按钮（不让 AI 替用户登录）

**公开页面**：
- `NewsletterForm.tsx`：订阅按钮（visitor 可能确实想让 AI 帮忙订阅，但本期保守地 disable —— 后续按需打开）
- `Search.tsx`：可能让 AI 帮忙搜索 —— **不禁用**
- `ArticleDetail.tsx` 的"分享"按钮 —— **不禁用**（visitor 主动分享 OK）

实施方式：在 JSX 上加 `data-ai-blocked={true}` 或 `data-ai-blocked="delete"`（值任意，PageController 仅看 attribute 存在性）。CSS 也加上 `.page-agent-blocked { /* 与普通按钮视觉一致，但可加细微提示色 */ }` 方便日后做高亮态。

### 集成到现有结构

**`App.tsx`** —— 当前 import 路径：
```ts
import PublicPageAgentMount from '@/components/admin/PublicPageAgentMount'
```
改为：
```ts
import PublicPageAgentMount from '@/components/PublicPageAgentMount'
```

**`AdminLayout.tsx`**（line 85）—— 删除 `import PageAgentMount` 和 `<PageAgentMount/>`；`AdminSettings.tsx` 的 `PAGE_AGENT_SECTION` blurb 改为"用于配置首页公开 FAB 使用的 AI 助手"。

**`frontend-vite/src/services/api.ts`** —— `api.admin.agent` 整块删除；`api.public.agent` 增 `llm`。

## 数据流 & 错误处理

**`/api/public/agent/llm` 错误映射**：

| 状态 | code | 触发条件 |
|---|---|---|
| 200 | — | 成功，返回 OpenAI 响应原样 |
| 401 | `unauthorized` | 无效 token（session expired 之类，理论上此端点不要求 auth，但保留） |
| 403 | `url_not_allowed` | `url` 不以 `settings.page_agent.base_url` 为前缀 |
| 403 | `referer_not_allowed` | Referer 非同源（且非空） |
| 409 | `not_enabled` | `page_agent.enabled != true` |
| 409 | `no_api_key` | `page_agent.api_key` decryptable 失败或为空 |
| 409 | `dom_requires_https_base_url` | base_url 不是 https |
| 413 | `payload_too_large` | body > 2 MB |
| 429 | `rate_limited` | 5/min/IP 触发 |
| 502 | `upstream_llm_failed` | 上游 DeepSeek 5xx / network error（不回显原文） |
| 502 | `api_key_leaked_check_failed` | 不可能触发 —— 仅供后端 sanity check |

**`/api/public/agent/execute` 错误映射**（保持现有，新增 mode 校验）：

| 状态 | code | 触发条件 |
|---|---|---|
| 422 | `invalid_mode` | mode 不在 {chat, dom} |
| 422 | `tools_required_for_dom` | mode='dom' 但 tools 为空 |
| 409 | `not_enabled` / `no_api_key` | 不变 |
| 413 | `payload_too_large` | 不变（chat 1MB） |
| 422 | `too_many_messages` | 不变（50） |
| 429 | `rate_limited` | chat 10/min/IP，dom 5/min/IP |
| 502 | `upstream_llm_failed` | 不变 |

## 测试

### `backend/tests/test_public_agent.py` 新增 / 修改

- ✅ 保留现有 chat mode 测试（不删 7 个现有 case）
- ✅ 新增 `mode='dom'` 路径：mock `page-agent` 风格的 OpenAI tool-calling request body（messages + tools schema + tool_choice='required'），验证请求体透传给上游、tools schema 保真
- ✅ 新增 URL-prefix 拒绝：用一个非 DeepSeek 域名的 URL → 403 `url_not_allowed`
- ✅ 新增 Referer 拒绝：用 TestClient 设 `Referer=https://evil.com` → 403 `referer_not_allowed`
- ✅ 新增 rate-limit-dom：连发 6 次 → 第 6 次 429（chat 不会被 hit，证明两个 limiter 独立）
- ✅ 新增 payload cap 2MB：发送超过 2MB body → 413
- ✅ 新增 key 不外泄：`patch httpx.AsyncClient.send` 让其 raise `LLMUnavailable(api_key='sk-real-key')` → 验证响应不包含 `sk-real-key` 且 status=502

### `backend/tests/test_admin_settings_synthesis.py` 部分更新

- `test_page_agent_defaults_synthesis`：在 `system_prompt` 断言中加上"data-ai-blocked"必须出现的检查（证明默认 prompt 包含护栏）

### `backend/tests/test_agent_router_admin.py` 删除（如果存在）

或者改为：把仍然有用的 `_TESTABLE_API_KEYS` 测试迁到 `test_admin_settings.py`（确认 `page_agent.api_key` 联通测试仍工作）

### `frontend-vite/tests/public-page-agent.spec.ts` 新增

基于现有 `ai-typesetter-dialog.spec.ts` 的 Playwright + intercept 模式：
- **case 1**：admin 启用 page_agent 后，访问 `/`，右下角 FAB 出现（截图 + 断言类名）
- **case 2**：点 FAB → panel 出现，可见两个按钮 `page-agent-ask-btn` 与 `page-agent-operate-btn`
- **case 3**：`intercept /api/public/agent/llm` 返回 mock OpenAI tool-calling 响应 → 点 `让他操作` 后 panel 显示任务进度
- **case 4**：`intercept /api/public/agent/execute`（mode=chat） → 点 `问他` 后消息气泡出现 mock 回答

### 手动验证清单（文档不写进自动化）

1. `data-ai-blocked` 加完后跑一遍 Playwright，验证含此属性的按钮 page-agent **真的不会去点**（写一个 e2e：让 page-agent 执行"点击 admin 删除按钮" → 应该 done 并说"无法操作"）
2. 真机打开首页，调一次"帮我打开第一篇最新文章"，观察是否 multi-step 走通
3. 真机连续触发 6 次 DOM 任务，验证第 6 次收到 429 toast

## 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| LLM 在 dom 模式下访问手机号 / token | `transformPageContent` 脱敏 |
| 鼠标点击误触敏感按钮 | `data-ai-blocked` 全站审计 + prompt 护栏 |
| maxSteps 设太大 → 一次调用耗尽 quota | maxSteps=20 + 单 step 30s timeout + 5/min/IP rate-limit |
| page-agent v1.10 API 在 minor upgrade 时 breaking | 锁定 `^1.10`，升级前看 CHANGELOG；agent.dispose() 在 cleanup |
| `customFetch` 失败时不暴露 key | 后端 `agent_llm` 用 httpx + 不带 Authorization 到响应 |
| Referer 在某些客户端（postman / curl）为空 | 服务端允许空 Referer，仅当非空且不匹配时拒绝 |
| URL-prefix 白名单被绕过（DNS rebinding / base_url 是 `evil.com/api.openai.com/`） | `_is_allowed_url` 严格匹配 scheme+host+port+path 前缀（见 §架构 §后端变更） |
| admin 删除 `/api/admin/agent/execute` 影响其他地方 | 已被 search 确认只有 AdminLayout / AdminSettings 用，且这一路本来就只是被替换 |
| 包体大小：page-agent 全包 +zod+chalk 等约 12 MB | vite build 已经 tree-shaking；检查构建产物 gzip 后大小；若影响首屏，用 dynamic import 包住 `<PublicPageAgentMount />` 仅在用户首次 hover footer 链接时按需加载 |

## 验收标准

1. **打开首页** → 右下角看到 `<Sparkles>` 图标 FAB，4 秒一循环上下漂移
2. **点 FAB** → page-agent 内置 panel 弹出（中文），输入框 + 两个按钮 `✿ 问他` / `✿ 让他操作`
3. **点 ✿ 问他** + 输入"你好" → 1-3 秒后看到回答气泡（来自 DeepSeek）
4. **点 ✿ 让他操作** + 输入"帮我打开导航栏的文章列表" → panel 显示多步思考过程，最终跳到 `/articles` 页面
5. **完整跑一次**："帮我搜索『react』" → panel 中显示"已输入搜索词"+"已点击搜索按钮"+"已显示结果"
6. **admin 后台** → `/admin/dashboard` 右下角**不**再有 FAB（admin 已停用）
7. **DevTools 检查** → Network 面板任何 LLM 请求的 request headers 中**不包含** `Authorization: Bearer sk-*` 字段
8. **敏感按钮防护** → 让 page-agent 执行"删除草稿"或"发布文章" → 1-3 步后提示"无法操作" + 任务提前结束
9. **rate-limit** → 连续 6 次 dom 任务，第 6 次 toast 显示 "操作过于频繁，请稍后再试"
10. **后端单测**：`test_public_agent.py` 全部 case 通过（含新增 6 个 dom case）
11. **Playwright**：`public-page-agent.spec.ts` 4 个 case 通过
12. **admin settings**：`page_agent.api_key` 连通测试按钮仍然工作（路由迁到 settings_router.py 后不退化）

## 实施顺序（建议）

1. 后端 router：先做 `public_agent_router.py` 的 `/llm` 新端点 + 单测（最关键、最先验证）
2. 后端 router：删除 `agent_router.py` 的 admin chat 端点 + 把 connectivity probe 迁到 `settings_router.py`
3. 后端：升级 `DEFAULT_PAGE_AGENT_SYSTEM_PROMPT`，加护栏
4. 前端：装 `page-agent` 包
5. 前端：写新 `PublicPageAgentMount.tsx` + `PageAgentFab.tsx` + panel 包装（FAB 视觉先做对）
6. 前端：审计并加 `data-ai-blocked`（admin + public 同步）
7. 前端：删除 `PageAgentPanel.tsx` / `PageAgentMount.tsx` / `AdminLayout` import
8. 集成验证：手动跑通两个模式，加 Playwright spec
