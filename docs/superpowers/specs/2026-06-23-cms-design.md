# 后端管理后台（CMS）— 设计文档

**日期**：2026-06-23
**作者**：Claude
**范围**：仅本轮（CMS）；UI 重做与内容完善作为后续轮次
**状态**：待用户复核

---

## 一、目标

为寄思科技 / 湖北数创项目新增一个**仅限单管理员使用的内容管理后台**，覆盖文章与期刊的完整 CRUD，并支持封面上传与 Markdown 正文图片上传。其他资源（研究人员、案例、领域、资讯）不在本轮范围。

## 二、范围与非目标

### 范围内
- 管理员登录（账号 + 密码 + JWT）
- 文章 CRUD（创建/列表/详情/编辑/删除/状态切换）
- 期刊 CRUD
- 封面上传 + Markdown 正文图片上传
- 草稿/发布两态（公开 API 默认仅返回 published）
- 后端 pytest 测试

### 非目标（推迟到后续轮次）
- UI 重做与 Markdown 排版增强
- 从 docx 自动提取内容到数据库的管线
- 多用户 / 多角色 / 审计日志
- 回收站 / 软删除
- E2E（Playwright）测试
- 内容版本管理

## 三、用户与角色

| 角色 | 用途 |
|------|------|
| 访客（公开站） | 阅读 published 文章 |
| 管理员（单账号） | 登录后台管理文章/期刊/媒体 |

多角色是 YAGNI：单管理员（环境变量配置账号密码哈希）足够覆盖当前需求。

## 四、技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 管理 UI 形态 | 在 SPA 内 `/admin/*` 路由组 | 共享 React 栈与组件、单部署 |
| 认证方式 | JWT（HS256）+ bcrypt | FastAPI 生态标准；无状态；自然免疫 CSRF |
| 编辑器 | `@uiw/react-md-editor` | 实时预览、轻量、维护活跃 |
| 媒体存储 | 本地文件系统 `backend/uploads/YYYY/MM/` | 单机部署足够；下轮可换 S3 |
| 图片校验 | mime + magic bytes + 大小限制（5MB） | 防止恶意文件 |
| Token 过期 | 8 小时 | 日常使用舒适；过期需重登 |
| 速率限制 | slowapi 限登录（5 次/分钟/IP） | 防爆破 |

## 五、架构

### 5.1 模块边界

```
backend/
├── app/
│   ├── security.py          # NEW: bcrypt 哈希、JWT 编解码、当前管理员依赖
│   ├── auth_router.py       # NEW: POST /api/auth/login, GET /api/auth/me
│   ├── admin_router.py      # NEW: /api/admin/articles, /api/admin/journals, /api/admin/media
│   ├── upload_service.py    # NEW: 写入 uploads/,生成 URL,校验 mime/大小/magic
│   ├── models/article.py    # MODIFY: +status, +cover_image_alt, +updated_at
│   ├── models/journal.py    # MODIFY: +updated_at
│   ├── schemas/admin_*.py   # NEW: ArticleCreate/Update, JournalCreate/Update, MediaOut
│   └── routers/articles_router.py # MODIFY: 公开 GET 默认过滤 status='published'

frontend-vite/src/
├── pages/admin/
│   ├── Login.tsx            # NEW
│   ├── Dashboard.tsx        # NEW
│   ├── ArticleList.tsx      # NEW
│   ├── ArticleEditor.tsx    # NEW
│   ├── JournalList.tsx      # NEW
│   ├── JournalEditor.tsx    # NEW
│   └── MediaLibrary.tsx     # NEW
├── components/admin/
│   ├── AdminLayout.tsx      # NEW
│   ├── ProtectedRoute.tsx   # NEW
│   └── ImageUploader.tsx    # NEW
├── services/api.ts          # MODIFY: 新增 api.admin.* 命名空间
└── App.tsx                  # MODIFY: 加 /admin/* 路由组

backend/tests/
├── conftest.py              # NEW: 临时 DB + 临时 uploads 目录 fixtures
├── test_auth.py             # NEW
├── test_admin_articles.py   # NEW
├── test_admin_journals.py   # NEW
└── test_admin_media.py      # NEW
```

### 5.2 静态文件

`backend/uploads/YYYY/MM/<uuid>.<ext>` 由 FastAPI `app.mount("/uploads", StaticFiles(...))` 提供。

文件名强制使用 uuid4，**不接受用户提供的原始文件名参与路径**，防止 path traversal。

## 六、数据模型

### 6.1 `articles` 表改动

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `status` | String(20) index | `"published"` | `"draft"` 或 `"published"` |
| `cover_image_alt` | String(255) | `NULL` | 图片 alt 文本（无障碍） |
| `updated_at` | DateTime | onupdate=utcnow | 自动维护 |

公开 API 行为：
- `GET /api/articles` → 默认过滤 `status='published'`
- `GET /api/articles/{slug}` → 404 if not published
- `GET /api/articles/featured` → 仍仅返回 published
- 管理 API 不应用此过滤

### 6.2 `article_images` 新表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | Integer PK | |
| `filename` | String(255) unique | uuid4 + ext（不含路径） |
| `original_name` | String(255) | 用户原始文件名（仅展示） |
| `mime` | String(50) | 实际嗅探的 mime |
| `size` | Integer | 字节 |
| `uploaded_at` | DateTime | |
| `uploaded_by` | String(100) | 管理员用户名 |

用途：管理已上传图片、记录引用计数（删除时若被引用则提示）。

### 6.3 `journals` 表改动

仅加 `updated_at`（其他字段已存在：`title`, `slug`, `cover_image`, `description`, `issue_number`, `published_at`, `articles` 关系）。

## 七、API 设计

### 7.1 公开 API（不变，仅追加过滤）

无路径变更。

### 7.2 认证

| 方法 | 路径 | 请求 | 响应 | 错误 |
|------|------|------|------|------|
| POST | `/api/auth/login` | `{username, password}` | `{access_token, token_type, expires_at}` | 401 |
| GET | `/api/auth/me` | — | `{username}` | 401 |

### 7.3 管理 API（全部需 `Authorization: Bearer <jwt>`）

| 方法 | 路径 | 请求 | 响应 | 错误 |
|------|------|------|------|------|
| GET | `/api/admin/articles` | `?status=&category=&q=&page=&per_page=` | `{items: ArticleListItem, total, page, pages}` | 401 |
| POST | `/api/admin/articles` | `ArticleCreate` | `Article` | 401, 409 (slug), 422 |
| GET | `/api/admin/articles/{id}` | — | `Article` | 401, 404 |
| PUT | `/api/admin/articles/{id}` | `ArticleUpdate` | `Article` | 401, 404, 409, 422 |
| DELETE | `/api/admin/articles/{id}` | — | `{ok: true}` | 401, 404 |
| POST | `/api/admin/articles/{id}/publish` | — | `Article` | 401, 404 |
| GET | `/api/admin/journals` | `?q=&page=&per_page=` | `{items, total, page, pages}` | 401 |
| POST | `/api/admin/journals` | `JournalCreate` | `Journal` | 401, 409, 422 |
| GET | `/api/admin/journals/{id}` | — | `Journal` | 401, 404 |
| PUT | `/api/admin/journals/{id}` | `JournalUpdate` | `Journal` | 401, 404, 409, 422 |
| DELETE | `/api/admin/journals/{id}` | — | `{ok: true}` | 401, 404 |
| GET | `/api/admin/media` | `?page=&per_page=` | `{items: MediaOut, total, ...}` | 401 |
| POST | `/api/admin/media` | `multipart/form-data: file` | `MediaOut` | 401, 413 (>5MB), 415 (mime 不允许) |
| DELETE | `/api/admin/media/{id}` | — | `{ok: true}` | 401, 404, 409 (被引用) |

### 7.4 Schema 摘要

```python
class ArticleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=300, pattern=r"^[a-z0-9-]+$")
    summary: Optional[str] = None
    content: Optional[str] = None
    cover_image: Optional[str] = None
    cover_image_alt: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    author_name: Optional[str] = Field(None, max_length=100)
    author_avatar: Optional[str] = None
    reading_time: int = Field(5, ge=1, le=999)
    featured: bool = False
    status: Literal["draft", "published"] = "draft"
    tags: Optional[List[str]] = None
    journal_id: Optional[int] = None

class ArticleUpdate(BaseModel):
    # 全字段 Optional
    ...

class MediaOut(BaseModel):
    id: int
    filename: str
    url: str            # /uploads/2026/06/<uuid>.<ext>
    original_name: str
    mime: str
    size: int
    uploaded_at: datetime
```

## 八、组件与数据流

### 8.1 认证流

```
Login.tsx ─POST /api/auth/login─▶ auth_router
                                      │
                                      ▼
                                 security.verify_admin
                                      │ bcrypt.checkpw
                                      ▼
                                 create_access_token(sub=username)
                                      │
                                      ▼
   {access_token, expires_at} ◀───────┘
   │
   ▼
   localStorage['admin_token']
   React Query 注入 Authorization 头
```

`get_current_admin()` 依赖从 `Authorization: Bearer <token>` 解析 JWT，注入 `Request.state.admin_username`。失败返回 401。

### 8.2 文章管理流

```
ArticleList ─GET /api/admin/articles?status=&page=─▶ admin_router
   ▲                                                       │
   │                                                       ▼
   │                                              SQL: WHERE status=? ORDER BY published_at DESC
   │
   └──────────────────────────────────────────────────────┘

ArticleEditor
   ├─▶ POST /api/admin/articles {status:'draft'}        (新建)
   ├─▶ PUT  /api/admin/articles/{id} {...}              (更新)
   ├─▶ POST /api/admin/articles/{id}/publish {status:'published'}  (发布)
   └─▶ DELETE /api/admin/articles/{id}                   (删除)

ImageUploader ─POST /api/admin/media (multipart)─▶ upload_service
   ├─ 校验 mime ∈ {png, jpeg, webp, gif}
   ├─ 嗅探 magic bytes
   ├─ 校验 size ≤ 5 MB
   ├─ 写入 uploads/2026/06/<uuid>.<ext>
   ├─ INSERT article_images
   └─▶ {url, filename, mime, size}
       客户端把 url 插入到 form (cover_image) 或 Markdown ![](url)
```

### 8.3 草稿/发布过滤

`articles_router.py`（公开）的所有查询增加 `.filter(Article.status == "published")`。`featured` 同样。

## 九、错误处理

| 错误 | HTTP | 触发 | 前端处理 |
|------|------|------|---------|
| 未认证 | 401 | 无/无效/过期 JWT | 清 localStorage，跳 `/admin/login` |
| slug 冲突 | 409 | 创建/更新时 slug 已存在 | 表单内联错误"该 slug 已被使用" |
| 字段校验 | 422 | Pydantic 验证失败 | 表单字段高亮 + 顶部 toast |
| 上传超限 | 413 | file > 5MB | ImageUploader 内错误条 |
| 上传类型错 | 415 | mime/扩展不在白名单 | 同上 |
| 媒体被引用 | 409 | 至少一篇文章 cover_image 或 Markdown 中引用 | toast 提示"该图片正被 N 篇文章使用" |
| 服务器错误 | 500 | DB/IO 异常 | toast + 控制台日志 |

## 十、安全

| 关注点 | 措施 |
|--------|------|
| 密码存储 | bcrypt，cost=12 |
| JWT 密钥 | `JWT_SECRET` 环境变量；启动时未设置则 fatal 退出 |
| Token 过期 | 8 小时 |
| 上传路径 | 文件名强制 uuid；用户原始文件名仅入 DB，不参与路径 |
| 上传校验 | mime 白名单 + magic bytes 嗅探 + size ≤ 5MB |
| XSS | react-markdown 默认安全；不支持 `<script>`/`<iframe>`；image URL 仅 http(s) |
| CSRF | JWT 在 Authorization 头，天然免疫 |
| 速率限制 | slowapi 限登录 5 次/分钟/IP |
| 凭据配置 | `.env` 不进 git；`.env.example` 跟踪 |
| 静态目录 | `/uploads` 仅 GET，禁止脚本执行（无 `.html`、无 `.htm`） |

## 十一、配置

`.env.example`（git 跟踪）：

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=
JWT_SECRET=
JWT_EXPIRE_HOURS=8
UPLOAD_DIR=./uploads
UPLOAD_MAX_SIZE_MB=5
```

`backend/scripts/create_admin.py`：
- 输入用户名 + 明文密码
- 输出 bcrypt 哈希
- 提示用户写入 `.env`

## 十二、测试策略

后端 pytest，覆盖：

| 文件 | 覆盖 |
|------|------|
| `test_auth.py` | 登录成功/失败/过期 token/错误密码 |
| `test_admin_articles.py` | CRUD 全覆盖、状态过滤、slug 冲突、未登录 401、状态切换 |
| `test_admin_journals.py` | CRUD 全覆盖、slug 冲突 |
| `test_admin_media.py` | 上传成功、超大文件 413、错误 mime 415、删除（含引用计数检查） |

`conftest.py` 提供：
- `tmp_db`：临时 SQLite 文件
- `tmp_uploads`：临时 uploads 目录
- `client`：注入 admin JWT 的 TestClient
- `unauth_client`：未认证客户端

**前端本轮不引入测试框架**（YAGNI）。`ProtectedRoute` 可加 Vitest 单测（成本低，价值高，作为可选扩展）。

## 十三、部署

- 后端：`backend/Dockerfile` 加 `VOLUME /app/uploads`
- 不需要新容器
- `docker-compose.yml`：在 backend 服务挂载 `./backend/uploads:/app/uploads`
- 前端：bundle 增加约 80 KB
- 反代（Nginx）无需特殊配置，`/uploads/*` 由 FastAPI 直接服务

## 十四、Milestone 拆分

| 阶段 | 范围 | 验证 |
|------|------|------|
| **M1 后端 auth** | security.py + auth_router + create_admin 脚本 + .env.example | curl 登录拿 JWT；pytest test_auth.py |
| **M2 后端 admin API** | admin_router（articles/journals/media）+ 状态过滤 + upload_service + ArticleImage 模型 | curl 完整 CRUD + 上传；pytest |
| **M3 前端 admin 骨架** | /admin/login + AdminLayout + ProtectedRoute + 路由表 + api.ts admin 命名空间 | 浏览器能登录；未登录访问 /admin/* 跳登录 |
| **M4 前端文章/期刊 CRUD** | 列表 + 编辑器 + 图片上传 + Markdown 编辑器 + 媒体库 | 完整流程：登录→新建→上传封面→保存草稿→发布→公开站可见 |
| **M5 测试 + 文档** | 后端 pytest 100% 通过 + README + .env.example + docker-compose 更新 | pytest + 人工 smoke test |

每个 milestone 完成后由 code-reviewer 审查后再进下一个。

## 十五、风险与缓解

| 风险 | 缓解 |
|------|------|
| Markdown 渲染 XSS | react-markdown 默认安全；限定 image URL scheme |
| 上传文件滥用 | size + mime + 引用计数三重防御 |
| JWT 泄露 | 8 小时过期；管理员可手动改 `JWT_SECRET` 强制下线 |
| slug 变更导致外链失效 | 不允许编辑已发布文章的 slug（仅创建时设置） |
| 删除文章不可恢复 | 删除前确认弹窗 + 显示标题；下轮可加回收站 |
| uploads 目录占满磁盘 | 本轮不监控；下轮可加 cron 清理孤儿文件 |

## 十六、未来扩展（不在本轮）

- 内容版本管理（git-like 历史）
- 多用户 + 角色 + 审计日志
- 媒体库搜索/标签/批量操作
- 文章定时发布（scheduled_at）
- 回收站 + 软删除
- 内容预览（带样式的未发布版本链接）
- 文档自动从 docx 提取管线
- UI 视觉重做 + Markdown 排版增强
