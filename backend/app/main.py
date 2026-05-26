from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import engine, Base
from .routers import articles_router, team_router
from .models import Journal, Article, Researcher
from .services.seed_data import seed_journals, seed_articles, seed_researchers
from sqlalchemy.orm import Session

# 导入所有模型以确保它们被注册到 Base.metadata
from .models.base import Base as ModelBase

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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(articles_router)
app.include_router(team_router)

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
        
        # 插入期刊
        for j in seed_journals():
            db.add(Journal(**j))
        db.commit()
        
        # 获取期刊ID
        journal = db.query(Journal).first()
        journal_id = journal.id if journal else 1
        
        # 插入文章
        for a in seed_articles():
            article_data = {k: v for k, v in a.items() if k != 'journal_slug'}
            article_data['journal_id'] = journal_id
            db.add(Article(**article_data))
        db.commit()
        
        # 插入团队成员
        for r in seed_researchers():
            db.add(type('TeamMember', (), {'name': r['name'], 'name_en': r.get('name_en', ''), 'title': r['title'], 'bio': r.get('bio', ''), 'avatar': r.get('avatar', ''), 'research_area': r.get('research_area', ''), 'email': r.get('email', ''), 'order': r.get('order', 0)})())
        db.commit()
        
        print("✅ 湖北数创种子数据初始化完成")
        print(f"   - 期刊: 1期")
        print(f"   - 文章: {len(seed_articles())}篇")
    except Exception as e:
        print(f"❌ 初始化失败: {e}")
        db.rollback()
    finally:
        db.close()

@app.on_event("startup")
def on_startup():
    seed_all()
