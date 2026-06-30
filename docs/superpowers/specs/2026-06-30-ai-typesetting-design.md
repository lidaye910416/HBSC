# 管理后台 — Word 上传后的 AI 排版（设计）

> 日期 2026-06-30
> 状态 已锁定（用户要求直接完成所有工作）

## 目标 & 非目标

**目标**：在管理后台已有的 `.docx → Markdown` 导入流程基础上，加入可选的 "AI 排版" 步骤 —— 由 LLM 对 pandoc 转换出的 Markdown 做格式清洗，不改变语义、不触碰元数据（标题 / 摘要 / 标签 / 分类 / slug），不替换现有 Markdown 编辑功能。

**非目标**：
- ❌ 让 AI 写入或重写 metadata（元数据由管理员手填，参见 `ArticleEditor.tsx` 的 `title`/`summary`/`tags`/`category`/`slug` 字段，全部保留现状）
- ❌ 替换或删除现有 `.docx` 导入按钮（保留它作为纯 pandoc 路径）
- ❌ 改动 `page_agent.*` 配置（已有路由与本次新增互不干扰）
- ❌ 自动 / 定时排版（必须由管理员手动触发）

## 已确认的关键决策

| 决策点 | 选定值 | 理由 |
|---|---|---|
| 排版范围 | **仅 Markdown 清理** | 管理员亲自填元数据，AI 不擅自改写 |
| 触发位置 | **手动按钮** | LLM 调用昂贵 / 可能失败 / 可能拒绝；解耦 docx 导入与 LLM 调用，任一步独立可工作；可重试 |
| 配置命名空间 | **新开 `article_typesetter.*`** | 与 `page_agent.*` 用途不同，prompt / 配额诉求不同；共用会让 system_prompt 难写 |
| 输出体验 | **预览弹窗 → 应用** | 改写不可见就不安心；弹窗内一眼对照，新增 UI 几乎不增加复杂度（复用现有 `ui/` 原子组件） |
| LLM Provider 预设 | **MiniMax token plan**（base_url 默认 `https://api.minimax.chat/v1`，model 默认 `MiniMax-M3`） | 用户明确要求 |

## ⚠️ 安全约束（重要）

**API Key 永远不进版本控制、不进 `.env` 明文、不进浏览器**：

1. 用户已经在对话里贴过一份疑似 MiniMax API Key —— 该 Key 应视为已泄露，**请在 MiniMax 控制台立即 rotate**。
2. 新版管理员操作流程：登录 admin → 「设置」→ 在 `article_typesetter.api_key` 输入框填入新 Key → 后端用 Fernet 加密落库 → 浏览器永远只看到 `sk-cp***` 形式的 masked 值。
3. 服务端日志、错误响应、HTML 注释里都不允许出现明文 key。`agent_router.execute_llm` 里已有"异常时记录 full trace、回客户端走泛化消息"的范式 —— 严格沿用。

## 架构

### 后端新增

```
backend/app/
├── services/
│   └── markdown_typesetter.py        # 新：核心服务
└── routers/
    └── admin_articles_typeset.py     # 新：API 端点
```

**`services/markdown_typesetter.py`**

```python
DEFAULT_SYSTEM_PROMPT = """你是一名中文科技期刊的资深排版编辑，专精于把 pandoc 从 Word 导出的 Markdown 清洗为可直接发布的稿件。

【必须做】
- 修正标题层级（# ## ### ……），确保只有一个 H1
- 中英文 / 中文与数字之间补全角空格（CJK 排版习惯）
- 全角 / 半角标点统一
- 列表层级、表格列对齐
- 清除 pandoc 残留（例如反斜杠续行、空格+换行）

【绝对不要做】
- 不改写、不润色、不删减任何正文句子
- 不修改图片引用 ![](...) 路径
- 不输出 markdown 围栏（```）、前言、解释、注释
- 不输出元数据（title / summary / tags）建议

【输出】
直接返回清洗后的 Markdown，不要任何包裹。
"""

def typeset_markdown(content: str, *, db: Session) -> TypesetResult: ...
    # 1) 读 settings（enabled / model / base_url / api_key / system_prompt）
    # 2) 输入超 32k Python 字符（len(...)）截断 + warnings
    # 3) 调 chat_complete(...)
    # 4) 剥掉多余 ```markdown``` 围栏
    # 5) 返回 TypesetResult（含 prompt_version = len(system_prompt.encode('utf-8'))）
```

**`routers/admin_articles_typeset.py`**

```python
router = APIRouter(prefix="/api/admin/articles", tags=["admin-articles"])

@router.post("/typeset")
@rate_limit(max_calls=5, window_seconds=60)
async def typeset_article(body: TypesetRequest, request: Request, db: ...): ...
```

错误映射：

| 状态 | code | message |
|---|---|---|
| 200 | — | 返回 `TypesetResponse` |
| 401 | `unauthorized` | 未登录 |
| 403 | `forbidden` | 非管理员 |
| 409 | `not_enabled` | `article_typesetter.enabled != true` |
| 409 | `no_api_key` | 未配置 api_key |
| 409 | `no_system_prompt` | system_prompt 不可为空 |
| 413 | `payload_too_large` | 请求体 > 1 MB |
| 422 | `validation_error` | body 字段缺失 |
| 429 | `rate_limited` | 超过 5 次/分钟 |
| 502 | `upstream_llm_failed` | 上游 LLM 调用失败（不回显原始异常） |

### 复用清单（**不**写新的，只连入现有）

| 现有组件 | 怎么用 |
|---|---|
| `services.llm_client.chat_complete` | 直接调，参数 `base_url/api_key/model/messages` |
| `services.crypto.encrypt_value` / `decrypt_value` / `mask_value` | AdminSetting 读写流程已包含 |
| `models.AdminSetting` | 新增 N 行 key；无 schema 变化 |
| `middleware.rate_limit.rate_limit` | 需小改：当前实现对 `async def` 不友好（每个 tick 同步跑），让它可以直接挂在 async 路由上 |
| 全局异常 handler (`app/main.py`) | 抛 HTTPException 即可，自动走 `{"error":{"code","message"}}` 信封 |
| `ArticleEditor.tsx` 现有的 `.docx` 导入 button + `handleImportDocx` | 完全不动；新增 "AI 排版" 按钮与 modal 各自独立 |

### 前端新增

```
frontend-vite/src/
├── components/admin/
│   └── TypesetPreviewDialog.tsx      # 新：预览弹窗（基于现有 ui/ Modal）
└── pages/admin/
    └── AdminSettings.tsx             # 改：KNOWN_KEYS 数组追加 article_typesetter.* 5 项
```

`frontend-vite/src/services/api.ts`：

```ts
admin.articles.typeset(content: string): Promise<{
  content_markdown: string
  warnings: string[]
  model: string
  prompt_version: string
}>
```

`ArticleEditor.tsx` 改造（最小侵入）：

1. 在当前「从 .docx 导入」区块下方新增一个独立的「AI 排版」区块，复用相同的 `disabled` / `busy` UX：
   - 按钮 `AI 排版` —— 调 `api.admin.articles.typeset(form.content)`
   - 缺 LLM 配置时按钮 disabled + tooltip「请先在 设置 → AI 排版 配置 API Key」（由 `article_typesetter.enabled` + `api_key` 推导）
2. 成功后把清洗结果送进新建的 `TypesetPreviewDialog`，show 出原文 vs 清洗后：
   - 左栏：原文（不可编辑，纯只读）
   - 右栏：清洗后（不可编辑）
   - 头：统计（字符数 delta、`warnings` 列表）
   - 底：「应用到编辑器」（主按钮）/「取消」（secondary）
3. 应用 → `update('content', cleaned)`；关闭 dialog；toast 提示
4. 失败 → toast，沿用现 Toast 组件

`AdminSettings.tsx` 改造（极小）：

- `KNOWN_KEYS` 数组追加 5 项：
  ```ts
  { key: 'article_typesetter.enabled',     label: '启用 AI 排版',           kind: 'bool'   },
  { key: 'article_typesetter.model',       label: '模型',                   kind: 'string' },
  { key: 'article_typesetter.base_url',    label: 'API Base URL',           kind: 'string' },
  { key: 'article_typesetter.api_key',     label: 'API Key',                kind: 'secret' },
  { key: 'article_typesetter.system_prompt', label: '系统 Prompt（可覆盖）', kind: 'string' },
  ```
- 「测试连通」按钮要对 `article_typesetter.api_key` 也生效 —— 在 `routers/settings_router.py` 的 `test_setting` 里把允许的 key 集合从单 key 扩展为 `{page_agent.api_key, article_typesetter.api_key}`。

### 默认值（在 AdminSetting 里读不到时回退）

| key | 默认 |
|---|---|
| `article_typesetter.enabled` | `"false"` |
| `article_typesetter.model` | `"MiniMax-M3"` |
| `article_typesetter.base_url` | `"https://api.minimax.chat/v1"` |
| `article_typesetter.system_prompt` | `DEFAULT_SYSTEM_PROMPT` 常量 |

`enabled` 与 `api_key` 没有合理默认 —— 服务端必须显式启用 + 提供 key，否则 409。

### 流水示意

```
管理员在 ArticleEditor.tsx 里:
  1. [可选] 上传 .docx        → POST /api/admin/articles/import-docx  (现有流程不变)
  2. 编辑或不动正文
  3. 点击 "AI 排版"           → POST /api/admin/articles/typeset {content_markdown}
                              ← {content_markdown, warnings, model, prompt_version}
  4. TypesetPreviewDialog 打开，左右对照
     - 应用 → update('content', cleaned)
     - 取消 → 关弹窗，原文不动
  5. 继续编辑或保存草稿 / 发布（已有逻辑）
```

LLM 失败 / 配置缺失：按钮 disabled 或 toast，不打断管理员主路径。

## 数据流 & 错误处理

```
[button click]
   └─ if !enabled || !api_key → button disabled（前端 disable）+ tooltip
   └─ else POST /api/admin/articles/typeset {content_markdown}
        └─ 服务端 enabled check → 409 not_enabled
        └─ 服务端 api_key check → 409 no_api_key
        └─ 服务端 cap 32k chars
        └─ 服务端调 chat_complete
             └─ LLMUnavailable → 502 upstream_llm_failed
                                → 日志记录 full trace，客户端只看到泛化文案
        └─ 剥 markdown 围栏（如果 LLM 真包了 ```）
        └─ 返回 TypesetResponse
   └─ TypesetPreviewDialog 打开
        └─ "应用" → update('content', cleaned); close; toast '已应用 AI 排版'
        └─ "取消" → close
```

## 测试

- **`backend/tests/test_markdown_typesetter.py`**：mock `chat_complete`，验证 prompt 构造、字符截断、`LLMUnavailable` 透传、围栏剥离。
- **`backend/tests/test_admin_articles_typeset.py`**：用 `TestClient` + 内存 sqlite，伪造 admin JWT，覆盖：
  - 正常路径：200，响应结构
  - `enabled=false` → 409 `not_enabled`
  - 缺 `api_key` → 409 `no_api_key`
  - 32k 截断 → 200 + `warnings` 含「原文超过 32k 字符，已截断」
  - 上游失败 → 502 `upstream_llm_failed`，断言响应 body 不含明文 api_key
  - rate limit 第 6 次/分 → 429
- **前端**：沿用现有 `frontend-vite/tests/admin-snapshots.spec.ts` 模式（Playwright + 视觉回归快照），新增 1 个 spec：`ai-typesetter-dialog.spec.ts`，覆盖：
  - 「AI 排版」按钮在 enabled=false 时为 disabled
  - 启用 + mock 服务端后，点击 → dialog 出现，左右两栏渲染 + 「应用」/「取消」按钮
  - 「取消」不替换 content

## 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| LLM 改写语义 | prompt 里写死「不改写、不润色」；前端 preview 让管理员一眼看见 |
| LLM 拒绝 / 超时 / 限流 | 不阻塞 pandoc 路径；按钮失败仅 toast |
| API Key 泄露 | Fernet 落库 + masked 回显 + 错误响应不回显原文 |
| LLM 上下文超限 | 32k 字符硬截断 + warning；超出部分管理员自行分次处理 |
| prompt_version 漂移导致前端缓存陈旧 | 每次响应都返回当前 `prompt_version` —— 值为 `len(system_prompt.encode('utf-8'))`。改动 prompt 即刻能观测到 |
| 与 page_agent.* 命名冲突 | 命名空间独立；各自 K/V 隔离 |

## 验收标准

1. 在 Admin → 设置新增 5 项 `article_typesetter.*`，与 `page_agent.*` 互不影响
2. 在「测试连通」按钮下，`article_typesetter.api_key` 也能联通测试
3. ArticleEditor 不破坏现有 .docx 导入、Markdown 编辑、保存草稿、发布
4. 「AI 排版」按钮在管理员未启用或未配置 key 时 disabled + tooltip
5. 点击 AI 排版 → dialog 弹出 → 「应用」/「取消」按预期工作
6. LLM 失败时 toast 报错，原文不动；服务日志记录全量 trace
7. 后端单测覆盖见"测试"章节的 case 列表，全过
8. 前端 Playwright spec 新增 1 个，全过；视觉回归快照不破坏现有断言
