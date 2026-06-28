# -*- coding: utf-8 -*-
import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
import os

from .config import settings
from .database import engine, Base
from .routers import articles_router, team_router, auth_router, admin_router, settings_router
from .middleware.rate_limit import rate_limit
from .models import Journal, Article, Researcher
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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# 全局异常处理 — 统一错误响应格式为 {"error": {"code", "message"}}
# NOTE: 响应格式从 {detail: "..."} 变为 {error: {code, message}}。
#       前端 api.ts 暂时仍按 err.detail 处理，将在 G4 任务中统一适配，这里不要修改 api.ts。
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
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

@app.get("/")
def root():
    return {"message": "湖北数创 API", "version": settings.VERSION}

@app.get("/api/health")
def health():
    return {"status": "healthy", "service": settings.APP_NAME}

def seed_all():
    """初始化种子数据"""
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
    seed_all()
