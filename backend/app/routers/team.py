from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session
from ..database import engine
from ..models import Researcher

router = APIRouter(prefix="/api", tags=["Team"])

@router.get("/team")
def get_team():
    """获取团队成员列表"""
    db = Session(bind=engine)
    try:
        members = db.query(Researcher).order_by(Researcher.order).all()
        return [
            {
                "id": m.id,
                "name": m.name,
                "name_en": m.name_en,
                "title": m.title,
                "bio": m.bio,
                "avatar": m.avatar,
                "research_area": m.research_area,
                "email": m.email,
                "order": m.order
            }
            for m in members
        ]
    finally:
        db.close()

@router.get("/search")
def search(q: str):
    """搜索文章"""
    from ..models import Article
    db = Session(bind=engine)
    try:
        articles = db.query(Article).filter(
            Article.title.contains(q) | Article.summary.contains(q)
        ).limit(10).all()
        
        return {
            "items": [
                {"id": a.id, "title": a.title, "slug": a.slug, "category": a.category, "type": "article"}
                for a in articles
            ],
            "total": len(articles)
        }
    finally:
        db.close()

@router.post("/newsletter")
def subscribe_newsletter(email: str):
    """订阅newsletter"""
    return {"message": "订阅成功", "email": email}
