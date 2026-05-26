from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models.article import Article
from ..schemas.article import ArticleSchema, ArticleListSchema

router = APIRouter(prefix="/api/articles", tags=["Articles"])

@router.get("", response_model=dict)
def get_articles(
    category: Optional[str] = None,
    featured: Optional[bool] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(9, ge=1, le=50),
    db: Session = Depends(get_db)
):
    query = db.query(Article)
    
    if category:
        query = query.filter(Article.category == category)
    if featured is not None:
        query = query.filter(Article.featured == featured)
    
    total = query.count()
    articles = query.order_by(Article.published_at.desc())\
                    .offset((page-1)*per_page).limit(per_page).all()
    
    return {
        "items": [ArticleListSchema.model_validate(a) for a in articles],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }

@router.get("/featured", response_model=List[ArticleListSchema])
def get_featured_articles(db: Session = Depends(get_db)):
    articles = db.query(Article).filter(Article.featured == True)\
                   .order_by(Article.published_at.desc()).limit(3).all()
    return [ArticleListSchema.model_validate(a) for a in articles]

@router.get("/{slug}", response_model=ArticleSchema)
def get_article(slug: str, db: Session = Depends(get_db)):
    article = db.query(Article).filter(Article.slug == slug).first()
    if not article:
        raise HTTPException(status_code=404, detail="文章未找到")
    article.views += 1
    db.commit()
    return ArticleSchema.model_validate(article)
