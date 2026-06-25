# 前后端 API 审计 + 优化设计

**日期：** 2026-06-25
**范围：** `/Users/jasonlee/hubei-shuchuang/backend` + `/Users/jasonlee/hubei-shuchuang/frontend-vite`
**目标：** 审计 4 个维度（安全 / 数据完整性 / API 设计 / 前端集成）+ 修复 P0/P1 关键问题

---

## 1. 审计发现概览

由 Explore agent 在设计阶段扫描得出，本轮 workflow 中审计 agent 会再次验证。

### 1.1 🔴 P0 关键风险（必须立即修复）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| **P0-1** | CORS `allow_origins=["*"]` + `allow_credentials=True` | `backend/app/main.py:28-34` | 浏览器拒绝带凭证请求 + 跨域不安全 |
| **P0-2** | `/api/search` SQLite `contains` 通配符无 ESCAPE、无长度限制、无 trim | `backend/app/routers/team.py` | SQL 注入面 / DoS（无长度限制）/ 全表扫描 |
| **P0-3** | JWT `SECRET_KEY` 默认明文 `"hubei-shuchuang-secret-key-2024"` | `backend/app/config.py` | 生产密钥泄露即系统沦陷 |
| **P0-4** | `GET /api/articles/{slug}` 自增 views（GET 副作用） | `backend/app/routers/articles_router.py` | 爬虫 / prefetch 放大计数；违反 REST 原则 |

### 1.2 🟡 P1 严重问题（应当修复）

| # | 问题 | 位置 |
|---|------|------|
| **P1-1** | 登录端点无 rate limit → 暴力破解 | `backend/app/routers/auth_router.py` |
| **P1-2** | MediaLibrary 硬编码 `http://localhost:8001` | `frontend-vite/src/pages/admin/MediaLibrary.tsx:8` |
| **P1-3** | seed_all 用临时类插入 Researcher，永远失败 | `backend/app/main.py:seed_all` |
| **P1-4** | Journal cascade 物理删除所有关联文章 | `backend/app/models/journal.py` cascade="all, delete-orphan" |
| **P1-5** | Media 删除只删 DB 记录不删文件 | `backend/app/admin_router.py:delete_media` |
| **P1-6** | 公开 `/api/journals` 与 `/api/issues` 同数据双端点 | `backend/app/routers/articles_router.py` |

### 1.3 🟢 P2/P3 设计缺陷（标记 follow-up）

- 重复 Base 模型（`models/base.py` + `models/__init__.py` + `database.py`）
- `models/article.py` 死代码（Article 重复定义 + article_tags 表未注册）
- 无 Alembic migration（schema 变更不可追踪）
- 无软删除（全部物理删除）
- 公开端点完全不用 Pydantic schema（手写 dict）
- 前端 TS interface 手写无自动生成（无 openapi-typescript / orval）
- Researcher/Case/Domain/Insight 4 个死模型（Product 决策）
- 公开搜索 `contains` 大小写敏感（SQLite）
- 无全局 exception handler（401/403/422/500 响应格式不统一）
- token 存 localStorage + 手动注入（无 interceptor、无 refresh）

---

## 2. 修复策略

### 2.1 范围控制

- 仅修复 P0-1 ~ P0-4 + P1-1 ~ P1-6（共 **10 处**）
- P2/P3 留作 follow-up workflow
- 改动最小化，不引入新依赖（除 SlowAPI 备选）

### 2.2 修复详细方案

#### F1（P0-1）CORS 配置修复
**文件：** `backend/app/main.py` + `backend/app/config.py`
```python
# main.py 替换 CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,  # 不用 "*"
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
```
- `settings.ALLOWED_ORIGINS` 已存在但未使用，启用即可
- 生产期通过 `ALLOWED_ORIGINS` env 变量覆盖（CSV 解析）

#### F2（P0-2）Search 注入防护
**文件：** `backend/app/routers/team.py` (`/api/search`)
```python
@app.get("/api/search")
def search(q: str = Query("", max_length=100)):
    q = q.strip()
    if not q:
        return {"items": [], "total": 0}
    # ESCAPE % and _
    safe = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{safe}%"
    query = db.query(Article).filter(
        or_(
            Article.title.ilike(pattern, escape="\\"),
            Article.summary.ilike(pattern, escape="\\"),
        )
    ).filter(Article.status == "published")
```
- 加 `max_length=100`、`strip()`、`escape="\\"` 参数
- 用 `ilike`（SQLite 在 3.23+ 支持）实现大小写不敏感

#### F3（P0-3）JWT SECRET 强制
**文件：** `backend/app/config.py`
```python
class Settings:
    SECRET_KEY: str = ""
    
    def __init__(self):
        if not self.SECRET_KEY:
            # 生产期必须通过 env 设置
            if os.getenv("ENV") == "production":
                raise ValueError("JWT_SECRET must be set in production")
            # 开发期给出明确警告而非默认明文
            import secrets
            self.SECRET_KEY = "dev-only-" + secrets.token_hex(16)
            print(f"[SECURITY] Using ephemeral dev SECRET_KEY: {self.SECRET_KEY}")
```
- 移除默认明文 `"hubei-shuchuang-secret-key-2024"`
- 开发期自动生成 ephemeral key（每次启动不同，强制 dev 重启失效）
- 生产期 `ENV=production` 且 `JWT_SECRET` 未设 → 启动失败

#### F4（P0-4）Views 自增改 POST
**文件：** `backend/app/routers/articles_router.py`
```python
# 删除 GET 中的 views 自增
@app.get("/api/articles/{slug}", response_model=...)
def get_article(slug: str, ...):
    article = db.query(Article).filter(Article.slug == slug, Article.status == "published").first()
    if not article:
        raise HTTPException(404)
    return _article_to_dict(article, ...)

# 新增 POST 端点
@app.post("/api/articles/{slug}/view", status_code=204)
def increment_view(slug: str, ...):
    db.query(Article).filter(Article.slug == slug).update({"views": Article.views + 1})
    db.commit()
```
- 前端 `useEffect` 改用 `api.articles.view(slug)`
- 用 `POST` 因为有副作用（符合 REST）

#### F5（P1-1）登录 Rate Limit
**文件：** 新建 `backend/app/middleware/__init__.py` + `backend/app/middleware/rate_limit.py` + 在 `main.py` 注册
- 实现轻量 in-memory token bucket：
  - login：5 次 / 分钟 / IP
  - search：30 次 / 分钟 / IP
  - upload：10 次 / 分钟 / admin
- 用 `slowapi` 库 OR 手写（避免新依赖优先手写）
- 超限返回 429 + Retry-After header

#### F6（P1-2）MediaLibrary 硬编码修复
**文件：** `frontend-vite/src/pages/admin/MediaLibrary.tsx:8`
- 删除 `const API_BASE = 'http://localhost:8001'`
- 上传成功后用后端返回的 `url` 字段（相对路径 `/uploads/...`）
- 删除所有手动拼接 URL 的代码

#### F7（P1-3）seed_all Researcher 修复
**文件：** `backend/app/main.py:seed_all`
- 删除 `type('TeamMember', (), {...})` 临时类
- 直接用 `Researcher(**data)` 插入
- 删除 try/except 吞错，让真正的异常暴露

#### F8（P1-4）Journal cascade UI 提示修复
**文件：** `frontend-vite/src/pages/admin/JournalList.tsx`（确认删除确认对话框）
- 修改删除确认文案：从 "外键将变为 NULL" 改为 "将一并删除所有 N 篇文章（X 篇）"
- 通过 `articles_count` 字段展示数量（已有 `article_count` 字段）
- 不改后端 cascade 行为（保留物理删除的产品决策）

#### F9（P1-5）Media 删除同步磁盘
**文件：** `backend/app/admin_router.py:delete_media`
```python
@router.delete("/api/admin/media/{media_id}")
def delete_media(media_id: int, ...):
    media = db.query(ArticleImage).filter(ArticleImage.id == media_id).first()
    if not media:
        raise HTTPException(404)
    
    # 先删磁盘文件（失败 rollback DB）
    file_path = os.path.join(settings.UPLOAD_DIR, media.filename)
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except OSError as e:
        raise HTTPException(500, f"Failed to delete file: {e}")
    
    # 再删 DB 记录
    db.delete(media)
    db.commit()
    return {"ok": True}
```

#### F10（P1-6）Issues/Journals 端点统一
**文件：** `backend/app/routers/articles_router.py`
- 保留 `/api/journals` 与 `/api/issues` 两路径（前端都用了）
- 内部用 `_list_journals()` helper 返回数据，避免两处代码漂移
- 不强制前端改 import（向后兼容）

---

## 3. 改动文件清单

| 文件 | 改动 |
|------|------|
| `backend/app/main.py` | CORS 配置 + 注册 rate limit middleware + 修 seed_all |
| `backend/app/config.py` | SECRET_KEY 强制 |
| `backend/app/middleware/__init__.py` | 新建（package marker） |
| `backend/app/middleware/rate_limit.py` | 新建（rate limit 实现） |
| `backend/app/routers/articles_router.py` | GET views 改 POST + Journals/Issues 统一 helper |
| `backend/app/routers/team.py` | search 注入防护 |
| `backend/app/admin_router.py` | delete_media 同步删文件 |
| `frontend-vite/src/pages/admin/MediaLibrary.tsx` | 删硬编码 localhost:8001 |
| `frontend-vite/src/services/api.ts` | 加 `articles.view(slug)` 方法 |
| `frontend-vite/src/pages/admin/JournalList.tsx` | 删除确认文案修复 |
| `frontend-vite/src/pages/ArticleDetail.tsx` | 改用 `api.articles.view()` |

---

## 4. 验证标准

### 4.1 后端验证

- [ ] `cd backend && python -c "from app.main import app"` 无错误
- [ ] `cd backend && uvicorn app.main:app --reload --port 8000` 启动成功
- [ ] `curl http://localhost:8000/api/articles | jq .` 返回 200 + items
- [ ] `curl http://localhost:8000/api/search?q=%25` 返回 0 结果（通配符已转义）
- [ ] 登录 6 次连续失败 → 第 6 次返回 429
- [ ] `ENV=production uvicorn app.main:app` 未设 JWT_SECRET → 启动失败

### 4.2 前端验证

- [ ] `cd frontend-vite && npx tsc --noEmit` 无错误
- [ ] `cd frontend-vite && npm run build` 成功
- [ ] 上传一张图片 → 返回的 url 是相对路径 `/uploads/...`
- [ ] 访问文章详情页 → 第二次刷新 views 应+1（说明 POST view 端点工作）
- [ ] 删除图片 → 磁盘文件同步消失（`ls backend/uploads/...` 验证）

### 4.3 回归检查

- [ ] 主页文章列表正常
- [ ] 文章详情正常
- [ ] 期刊列表 / 详情正常
- [ ] Admin 登录正常
- [ ] Admin CRUD 正常

---

## 5. 不在本轮范围

- Alembic migration 引入
- httpOnly cookie refresh token
- OpenAPI 自动生成前端类型
- 全局软删除
- 死代码模型清理（Product 决策）
- 全局 exception handler 统一
- 大小写不敏感的全局搜索（仅 ilike 部分解决）

---

## 6. 工作流时长

- 审计验证：~2 分钟（4 个并行 agent）
- 修复：~4 分钟（10 个并行 fix agent）
- 验证：~1 分钟
- **总计 ~7 分钟**