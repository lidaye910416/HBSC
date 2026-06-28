# HBSC Admin — 期刊完整性、Word 导入、page-agent 集成 设计

> 状态：**已批准，待用户复核**
> 日期：2026-06-28
> 项目：hubei-shuchuang (湖北数创)
> 作者：brainstorming session

## 1. 背景与目标

当前项目前端已基本完成，后端 admin 路由（journals/articles/media CRUD）已实现，
但存在以下缺口：

1. **期刊"完整期"无强约束**：每期应包含 4 类文章（战略与政策、技术与产业、方案与思考、动态与文化），
   缺类时仍能"发布"，导致首页矩阵展示不完整。
2. **缺少 Word 文档自动转换**：admin 写文章目前只能手动撰写 Markdown，缺少 `.docx → Markdown` 工作流。
3. **编辑器内配图/表格编辑能力弱**：当前只能通过 ImageUploader 设置封面，
   无法在正文内插入/修改图片、表格。
4. **前后端联动手工化**：admin 修改期刊/文章后，前端首页矩阵、Navigation 期刊列表依赖 react-query 失效机制，
   未做显式验证。
5. **缺少 page-agent 集成**：admin 操作步骤多（建期刊→加 4 篇文章→发布），可借助自然语言代理改善体验。

本文档给出上述 5 个问题的设计。

## 2. 用户已确认的关键决策

| # | 决策点 | 选择 |
|---|---|---|
| D1 | 期刊四类完整性约束 | **硬约束**：每类至少一篇，必须四类齐全（后期可补充同类文章） |
| D2 | Word → Markdown 工具 | **后端 pandoc**（Docker 镜像安装 pandoc） |
| D3 | 编辑器图片/表格交互 | **完整 inline 编辑**（MDEditor 工具栏扩展 + 预览区点击编辑），**保留 TipTap 切换作为 fallback** |
| D4 | page-agent 集成 | **仅 admin 后台** + 配置面板（开关、API Key、模型） |
| D5 | 配置存储 | **SQLite 新表 `admin_settings`**，敏感字段 Fernet 加密 |
| D6 | 期刊创建流程 | **两步提交**：先 JournalEditor 填元数据，再 JournalDetail 4-Tab 管文章 |
| D7 | API Key 暴露 | **服务端中转 LLM**，API Key 不下发浏览器 |
| D8 | Word 导入流程 | **先返回不落库**，admin review 后再保存 |

## 3. 数据模型

### 3.1 新增表

```python
# app/models/admin_setting.py
class AdminSetting(Base):
    __tablename__ = "admin_settings"
    key: str            # PK
    value_encrypted: str  # Fernet 加密后的 JSON
    description: str       # 人类可读描述（明文）
    is_secret: bool        # True 时 GET 仅返回 masked
    updated_at: datetime
    updated_by: str
```

预置 key：
- `page_agent.enabled` (bool, 非敏感)
- `page_agent.model` (str, 非敏感) — 默认 `"MiniMax-M3"`
- `page_agent.base_url` (str, 非敏感)
- `page_agent.api_key` (str, **敏感**，Fernet 加密)
- `page_agent.system_prompt` (str, 非敏感，可覆盖默认 prompt)

### 3.2 复用现有表 + 字段

- `journals` 表新增 `status` 字段（`draft` | `published`，默认 `draft`）。
- `articles` / `article_images` / `researchers` 不变。

### 3.3 完整性规则（业务层，不改 DB 结构）

```python
REQUIRED_CATEGORIES = ["战略与政策", "技术与产业", "方案与思考", "动态与文化"]

def is_journal_complete(journal: Journal) -> dict:
    """返回每类文章计数 + complete 标记。"""
    counts = {cat: 0 for cat in REQUIRED_CATEGORIES}
    for a in journal.articles:
        if a.category in counts and a.status == "published":
            counts[a.category] += 1
    return {
        **counts,
        "complete": all(c >= 1 for c in counts.values()),
    }
```

发布期刊：`POST /admin/journals/{id}/publish` 时校验 `complete == True`，否则 422。

## 4. API 设计

### 4.1 新增端点

```
GET    /api/admin/journals/{id}/completeness     # 完整性详情
POST   /api/admin/journals/{id}/publish          # 校验后置 status='published'
POST   /api/admin/journals/{id}/unpublish        # 回退 draft

POST   /api/admin/articles/import-docx           # form: file, journal_id?, category?
                                                # → {title, content_markdown, suggested_slug, warnings[], images[]}

GET    /api/admin/settings                       # 列出所有 key（敏感项 masked）
PUT    /api/admin/settings/{key}                 # 单项设置
POST   /api/admin/settings/{key}/test            # 连通性测试（如调 LLM 探活）

GET    /api/admin/agent/config                   # 公开开关给前端 page-agent widget
POST   /api/admin/agent/execute                  # 服务端中转 LLM 调用（不暴露 API Key）
```

### 4.2 修改端点

- `POST /api/admin/journals`：接受 `status` 字段
- `PUT /api/admin/articles/{id}`：现有，无需调整
- `GET /api/issues`（公开）：过滤 `status == 'published'`
- `GET /api/journals/{slug}`（公开）：过滤同
- `POST /api/admin/media`：增加可选 `kind=image|table` 查询参数；`kind=table` 时允许 `.csv` 上传

### 4.3 响应格式（沿用现有 `{error: {code, message}}` 格式）

错误码扩展：
- `422 incomplete_journal`：发布期刊时四类不全
- `422 pandoc_failed`：docx 转换失败
- `413 file_too_large`：现有
- `400 invalid_mime`：现有

## 5. 前端设计

### 5.1 路由

```
/admin                        → Dashboard（增加"完整性提示"）
/admin/journals               → JournalList（增完整性徽章）
/admin/journals/new           → JournalEditor
/admin/journals/:id           → JournalDetail (NEW, 4-Tab)
/admin/articles               → ArticleList
/admin/articles/new           → ArticleEditor（含"导入 .docx"按钮）
/admin/articles/:id           → ArticleEditor
/admin/media                  → MediaLibrary
/admin/settings               → AdminSettings (NEW)
```

### 5.2 关键组件

| 组件 | 用途 | 状态 |
|---|---|---|
| `JournalDetail.tsx` | 4-Tab 期刊文章管理 | NEW |
| `MarkdownToolbar.tsx` | MDEditor 工具栏扩展（插入图片/表格） | NEW |
| `PageAgentMount.tsx` | admin 路由挂载 page-agent widget | NEW |
| `AdminSettings.tsx` | page-agent 配置页 | NEW |
| `insertImagePlugin.tsx` | MDEditor 工具栏按钮 → 弹 MediaLibrary | NEW |
| `insertTablePlugin.tsx` | 工具栏按钮 → 表格编辑器 | NEW |
| `inlineImageEdit.tsx` | 预览区点击图片 → 替换/改 alt | NEW |
| `inlineTableEdit.tsx` | 预览区点击表格 → 单元格编辑 | NEW |
| `ImageUploader.tsx` | 现有，复用 | — |
| `ArticleEditor.tsx` | 加 Word 导入按钮 + MarkdownToolbar 挂载 | MODIFY |
| `AdminLayout.tsx` | 挂 PageAgentMount + Settings 链接 | MODIFY |

### 5.3 关键流程

**新建期刊 + 添加 4 篇文章：**
1. `/admin/journals/new` → 填元数据 → POST `/admin/journals` → 跳转 `/admin/journals/{id}`
2. JournalDetail 4-Tab，每 Tab 显示该类文章
3. 点 "新建文章" → 跳 `/admin/articles/new?journal_id=X&category=Y`
4. ArticleEditor 顶部 "导入 .docx" → 选文件 → POST `/import-docx` → 后端调 pandoc → 返回 markdown → 填入编辑器
5. 校对 → 保存 → 回 JournalDetail
6. 4 类齐全后，"发布" 按钮启用 → POST `/publish` → 公开页面生效

**page-agent 配置：**
1. `/admin/settings` → 勾选启用 → 填 API Key → 选模型 → 保存（Fernet 加密入库）
2. 切回任意 `/admin/*` 页面 → 右下角出现 page-agent 输入框
3. 管理员输入 "把这一期的 4 篇文章分类列出来" → widget 通过 DOM 操作直接读取页面内容并回答

## 6. 安全设计

1. **API Key 加密**：`page_agent.api_key` 用 `cryptography.Fernet` 加密；`Fernet` key 由
   `ADMIN_SETTINGS_SECRET` 环境变量提供（与 `JWT_SECRET` 分开）。无该环境变量时设置端点返回 503。
2. **Fernet Key 轮换**：启动时读 `ADMIN_SETTINGS_SECRET`；轮换需管理员手动执行迁移脚本。
3. **page-agent 不接收 API Key**：前端只调 `/api/admin/agent/execute`，由后端解密 LLM Key 后调上游。
4. **import-docx 临时图片**：pandoc 提取的图片存到 `/uploads/imports/<request-uuid>/`，
   若 admin 24 小时内未 commit 则清理（cron job）。
5. **CSRF**：admin 接口继续走 httpOnly cookie + SameSite=Strict；page-agent widget 在
   同源 admin 页面内运行，不跨域。

## 7. 依赖与构建

### 7.1 后端新增依赖（requirements.txt）

```
cryptography>=42.0.0   # Fernet 加密
pypandoc>=1.11         # Python 绑定 pandoc（首次运行时自动下载或要求系统已装）
```

### 7.2 Docker 镜像修改

`backend/Dockerfile`：
- `apt-get install -y pandoc` （约 100MB）
- 或用 alpine：`apk add pandoc`（按基础镜像调整）

### 7.3 前端新增依赖（package.json）

```
page-agent@^1.10.0      # 仅 admin 路由懒加载
```

## 8. 测试策略

### 8.1 后端单元测试

- `test_completeness.py`：4 类齐全 / 缺 1 类 / 多余文章
- `test_publish.py`：publish draft 缺类 → 422；publish 齐全 → 200
- `test_import_docx.py`：正常 .docx / 无 pandoc / 损坏文件
- `test_settings_encryption.py`：写入加密、读取解密、敏感字段 GET 时 masked

### 8.2 前端组件测试

- JournalDetail 4-Tab 状态显示
- ArticleEditor import-docx 流程
- page-agent widget 开关切换

### 8.3 集成验证（手工）

- curl：建期刊 → 加 4 篇 → publish → `/api/issues` 包含此刊
- UI：建期刊 → 导入 .docx → 编辑配图 → 发布 → 首页可见

## 9. 里程碑

| M | 内容 | 验收 |
|---|---|---|
| M1 | 数据模型 + 完整性约束 | curl 测 publish 422/200；admin UI 显示完整性徽章 |
| M2 | Word 导入 + MarkdownToolbar + inline 编辑 | 上传 1 个含表格和图片的 .docx；如效果不佳则评估切换 TipTap |
| M3 | JournalDetail 4-Tab 管理 | UI 走查「新建期刊→4-Tab→逐类添加→发布」全流程 |
| M4 | page-agent 集成 + AdminSettings | admin 路由启用 widget；输入中文指令验证 |

每个里程碑完成后独立可 ship；M2 完成后用 checklist 决定是否切换 TipTap。

## 10. 范围之外（YAGNI）

- 多管理员账号 / 权限分级（保持单管理员环境变量登录）
- Word 导入时的服务端 OCR / 公式识别（依赖 pandoc 内置支持）
- page-agent 在公开站启用
- 文章版本历史 / 撤销重做
- 实时协作编辑
- 自动 SEO/封面图生成

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| pandoc 在 Docker 中体积大 | 镜像 +100MB | 接受；pandoc 是行业标准，权衡值得 |
| MDEditor 内联编辑 UX 不达预期 | 用户体验差 | M2 后评估切换 TipTap/Lexical |
| page-agent 操纵 DOM 失败 | 用户挫败感 | 提供"显示指令帮助"，降级为"复制指令到剪贴板" |
| Fernet Key 丢失 | 已加密 API Key 不可读 | 文档强调"妥善备份 ADMIN_SETTINGS_SECRET"；提供重新输入流程 |
| 数据库 migration 失败 | 现有数据损坏 | M1 阶段先在 dev 验证，不直接动 prod |

## 12. 待办（spec 批准后转入 writing-plans）

- [ ] M1: 数据模型 + 完整性
- [ ] M2: Word 导入 + 编辑器
- [ ] M3: JournalDetail 4-Tab
- [ ] M4: page-agent 集成