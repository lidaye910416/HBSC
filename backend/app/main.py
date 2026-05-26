from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import engine, Base
from .routers import articles_router, insights_router, cases_router, team_router
from .models import Article, Insight, Case, Researcher, Domain
from .services.seed_data import seed_domains, seed_articles, seed_insights, seed_cases, seed_researchers
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import random

# 创建数据库表
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="寄思科技有限责任公司 — 聚焦前沿科技与复杂系统研发的科技公司",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(articles_router)
app.include_router(insights_router)
app.include_router(cases_router)
app.include_router(team_router)

@app.get("/")
def root():
    return {"message": "寄思科技 API", "version": settings.VERSION}

@app.get("/api/health")
def health():
    return {"status": "healthy", "service": settings.APP_NAME}

def seed_all():
    """初始化种子数据"""
    db = Session(bind=engine)
    try:
        # 检查是否已有数据
        if db.query(Domain).count() > 0:
            print("数据已存在，跳过初始化")
            return
        
        # 插入研究领域
        for d in seed_domains():
            db.add(Domain(**d))
        db.commit()
        
        # 插入文章
        for a in seed_articles():
            db.add(Article(**a))
        db.commit()
        
        # 插入资讯
        for i in seed_insights():
            db.add(Insight(**i))
        db.commit()
        
        # 插入案例
        for c in seed_cases():
            db.add(Case(**c))
        db.commit()
        
        # 插入研究人员
        for r in seed_researchers():
            db.add(Researcher(**r))
        db.commit()
        
        print("✅ 种子数据初始化完成")
    except Exception as e:
        print(f"❌ 初始化失败: {e}")
        db.rollback()
    finally:
        db.close()

@app.on_event("startup")
def on_startup():
    seed_all()

