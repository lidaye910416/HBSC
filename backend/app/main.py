# -*- coding: utf-8 -*-
import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
import os

from .config import settings
from .database import engine, Base, get_db
from .routers import (
    articles_router,
    team_router,
    auth_router,
    admin_router,
    settings_router,
    agent_router,
    public_agent_router,
    admin_articles_import_router,
    admin_articles_typeset_router,
)
# Import the podcast router via the dotted submodule path — the
# `__init__.py` deliberately does NOT re-export it under the same name
# as the submodule, to avoid breaking pytest monkeypatch.setattr on
# module-level helpers. See backend/app/routers/__init__.py comment.
from .routers.public_podcast_router import router as public_podcast_router
from .middleware.rate_limit import rate_limit
from .models import Journal, Article, Researcher, PodcastAudio
from .services.seed_data import seed_journals, seed_articles, seed_researchers
from sqlalchemy.orm import Session

# 导入所有模型以确保它们被注册到 Base.metadata
from .models.base import Base as ModelBase


def _code_for_status(status_code: int) -> str:
    """Map an HTTP status code to a stable, machine-readable error code."""
    return {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "validation_error",
        429: "rate_limited",
        500: "internal_error",
    }.get(status_code, "error")


# 创建数据库表
ModelBase.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="湖北数创 — 湖北数字产业创新期刊",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# 全局异常处理 — 统一错误响应格式为 {"error": {"code", "message", ...extras}}
# 前端 api.ts 已经按 {error: {code, message}} 解析。
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    # If detail is a dict with a "code" key, use it as the error code (semantic errors).
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        body = dict(exc.detail)
        code = body.pop("code")
        message = body.pop("message", str(body))
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": code, "message": message, **body}},
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": _code_for_status(exc.status_code), "message": exc.detail}},
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    # 生产环境不泄漏堆栈；调试模式下附带 traceback 便于排查
    if settings.DEBUG:
        tb = traceback.format_exc()
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": str(exc), "traceback": tb}},
        )
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "internal_error", "message": "An internal error occurred"}},
    )


# 挂载上传文件目录（首次启动时创建）
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# 注册路由
app.include_router(articles_router)
app.include_router(team_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(settings_router)
app.include_router(agent_router)
app.include_router(public_agent_router)
app.include_router(public_podcast_router)
app.include_router(admin_articles_import_router)
app.include_router(admin_articles_typeset_router)

@app.get("/")
def root():
    return {"message": "湖北数创 API", "version": settings.VERSION}

@app.get("/api/health")
def health():
    return {"status": "healthy", "service": settings.APP_NAME}

def _migrate_podcast_audios_progress():
    """One-shot migration: ensure PodcastAudio has the progress / stage /
    started_at / last_successful_duration_seconds columns. Mirrors the
    existing _backfill_journal_status pattern — idempotent ALTER TABLE
    ADD COLUMN for SQLite. The columns power the in-progress UX (stage
    label, progress bar, ETA) on the admin list / editor / podcast panel.

    Skipped when pytest has installed a get_db override.
    """
    from sqlalchemy import text, inspect
    if get_db in app.dependency_overrides:
        return
    insp = inspect(engine)
    if not insp.has_table("podcast_audios"):
        return
    cols = {c["name"] for c in insp.get_columns("podcast_audios")}
    adds = []
    if "stage" not in cols:
        adds.append("ALTER TABLE podcast_audios ADD COLUMN stage VARCHAR(20) NOT NULL DEFAULT 'pending'")
    if "progress" not in cols:
        adds.append("ALTER TABLE podcast_audios ADD COLUMN progress INTEGER NOT NULL DEFAULT 0")
    if "started_at" not in cols:
        adds.append("ALTER TABLE podcast_audios ADD COLUMN started_at DATETIME")
    if "last_successful_duration_seconds" not in cols:
        adds.append("ALTER TABLE podcast_audios ADD COLUMN last_successful_duration_seconds INTEGER NOT NULL DEFAULT 0")
    if adds:
        with engine.begin() as conn:
            for stmt in adds:
                conn.execute(text(stmt))
        print(f"[migration] podcast_audios: added {len(adds)} column(s)")


def _backfill_journal_status():
    """One-shot migration: ensure Journal.status column exists and is non-null.
    For pre-Phase-1 databases that have no `status` column, this runs an
    idempotent ALTER TABLE first, then backfills any NULL/empty values to
    'published'. Safe to run on every startup.

    Skipped when the test suite has installed a `get_db` dependency override
    (pytest tests use a per-test tmp_path SQLite — the dev migration would
    pollute the wrong database).
    """
    from sqlalchemy import text, inspect
    if get_db in app.dependency_overrides:
        return
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("journals")}
    if "status" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE journals ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'published'"))
        print("[migration] added Journal.status column")
    db = Session(bind=engine)
    try:
        rows = db.execute(text("SELECT id, status FROM journals")).fetchall()
        updated = 0
        for rid, status in rows:
            if status is None or status == "":
                db.execute(text("UPDATE journals SET status='published' WHERE id=:id"), {"id": rid})
                updated += 1
        if updated:
            db.commit()
            print(f"[migration] backfilled status='published' on {updated} journals")
    finally:
        db.close()


def seed_all():
    """初始化种子数据。测试套件注入了 get_db 覆盖时跳过 — pytest 用的 tmp_path
    SQLite 没有 seed 数据，强行运行会污染 dev research.db。"""
    if get_db in app.dependency_overrides:
        return
    db = Session(bind=engine)
    try:
        # 检查是否已有数据
        if db.query(Journal).count() > 0:
            print("数据已存在，跳过初始化")
            return

        # 插入所有期刊 (issues)
        for j in seed_journals():
            db.add(Journal(**j))
        db.commit()

        # 建立 slug -> id 映射, 供文章绑定使用
        slug_to_id = {j.slug: j.id for j in db.query(Journal).all()}

        # 插入文章, 按 article['journal_slug'] 解析到正确的 journal_id
        article_count = 0
        for a in seed_articles():
            article_data = {k: v for k, v in a.items() if k != 'journal_slug'}
            slug = a.get('journal_slug')
            article_data['journal_id'] = slug_to_id.get(slug)
            if article_data['journal_id'] is None:
                print(f"⚠️  article '{a.get('title')}' has no matching journal_slug='{slug}', skipping")
                continue
            db.add(Article(**article_data))
            article_count += 1
        db.commit()

        # 插入团队成员 (Researcher)
        researcher_count = 0
        for r in seed_researchers():
            db.add(Researcher(**r))
            researcher_count += 1
        db.commit()

        print("✅ 湖北数创种子数据初始化完成")
        print(f"   - 期刊: {len(slug_to_id)}期")
        print(f"   - 文章: {article_count}篇")
        print(f"   - 研究人员: {researcher_count}位")
    except Exception as e:
        print(f"❌ 初始化失败: {e}")
        db.rollback()
        raise
    finally:
        db.close()

@app.on_event("startup")
def on_startup():
    _backfill_journal_status()
    _migrate_podcast_audios_progress()
    seed_all()
