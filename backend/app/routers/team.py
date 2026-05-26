from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models.researcher import Researcher
from ..models.domain import Domain
from ..schemas.researcher import ResearcherSchema
from ..schemas.domain import DomainSchema

router = APIRouter(prefix="/api", tags=["Team & Domains"])

@router.get("/team", response_model=List[ResearcherSchema])
def get_team(db: Session = Depends(get_db)):
    members = db.query(Researcher).order_by(Researcher.order).all()
    return [ResearcherSchema.model_validate(m) for m in members]

@router.get("/domains", response_model=List[DomainSchema])
def get_domains(db: Session = Depends(get_db)):
    domains = db.query(Domain).order_by(Domain.order).all()
    return [DomainSchema.model_validate(d) for d in domains]

@router.get("/search")
def search(q: str, db: Session = Depends(get_db)):
    from ..models.article import Article
    from ..models.insight import Insight
    
    articles = db.query(Article).filter(
        Article.title.contains(q) | Article.summary.contains(q)
    ).limit(5).all()
    
    insights = db.query(Insight).filter(
        Insight.title.contains(q) | Insight.content.contains(q)
    ).limit(5).all()
    
    return {
        "articles": [{"id": a.id, "title": a.title, "slug": a.slug, "type": "article"} for a in articles],
        "insights": [{"id": i.id, "title": i.title, "type": "insight"} for i in insights],
        "total": len(articles) + len(insights)
    }

@router.post("/newsletter")
def subscribe_newsletter(email: str, db: Session = Depends(get_db)):
    return {"message": "订阅成功", "email": email}
