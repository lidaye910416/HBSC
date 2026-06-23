from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from ..database import engine, get_db
from ..models import Journal, Article

router = APIRouter(prefix="/api", tags=["articles"])

@router.get("/journals")
def get_journals():
    """获取期刊列表"""
    db = Session(bind=engine)
    try:
        journals = db.query(Journal).order_by(Journal.published_at.desc()).all()
        return [
            {
                "id": j.id,
                "title": j.title,
                "slug": j.slug,
                "cover_image": j.cover_image,
                "description": j.description,
                "issue_number": j.issue_number,
                "published_at": j.published_at.isoformat() if j.published_at else None,
                "article_count": len(j.articles)
            }
            for j in journals
        ]
    finally:
        db.close()

@router.get("/journals/{slug}")
def get_journal(slug: str):
    """获取期刊详情"""
    db = Session(bind=engine)
    try:
        journal = db.query(Journal).filter(Journal.slug == slug).first()
        if not journal:
            raise HTTPException(status_code=404, detail="期刊不存在")
        
        return {
            "id": journal.id,
            "title": journal.title,
            "slug": journal.slug,
            "cover_image": journal.cover_image,
            "description": journal.description,
            "issue_number": journal.issue_number,
            "published_at": journal.published_at.isoformat() if journal.published_at else None,
            "articles": [
                {
                    "id": a.id,
                    "title": a.title,
                    "slug": a.slug,
                    "summary": a.summary,
                    "category": a.category,
                    "reading_time": a.reading_time,
                    "views": a.views,
                    "tags": a.tags.split(",") if a.tags else [],
                    "published_at": a.published_at.isoformat() if a.published_at else None
                }
                for a in journal.articles
            ]
        }
    finally:
        db.close()

@router.get("/articles")
def get_articles(
    category: Optional[str] = Query(None),
    journal_slug: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """获取文章列表"""
    query = db.query(Article).filter(Article.status == "published")

    if category:
        query = query.filter(Article.category == category)
    if journal_slug:
        query = query.join(Journal).filter(Journal.slug == journal_slug)

    total = query.count()
    articles = query.order_by(Article.published_at.desc()).offset((page-1)*per_page).limit(per_page).all()

    return {
        "items": [
            {
                "id": a.id,
                "title": a.title,
                "slug": a.slug,
                "summary": a.summary,
                "cover_image": a.cover_image,
                "category": a.category,
                "author_name": a.author_name,
                "reading_time": a.reading_time,
                "views": a.views,
                "tags": a.tags.split(",") if a.tags else [],
                "published_at": a.published_at.isoformat() if a.published_at else None
            }
            for a in articles
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


@router.get("/articles/featured")
def get_featured_articles(db: Session = Depends(get_db)):
    """获取精选文章"""
    articles = db.query(Article).filter(Article.featured == 1, Article.status == "published").order_by(Article.published_at.desc()).limit(3).all()
    return [
        {
            "id": a.id,
            "title": a.title,
            "slug": a.slug,
            "summary": a.summary,
            "cover_image": a.cover_image,
            "category": a.category,
            "author_name": a.author_name,
            "reading_time": a.reading_time,
            "views": a.views,
            "published_at": a.published_at.isoformat() if a.published_at else None
        }
        for a in articles
    ]


@router.get("/articles/{slug}")
def get_article(slug: str, db: Session = Depends(get_db)):
    """获取文章详情"""
    article = db.query(Article).filter(Article.slug == slug, Article.status == "published").first()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    article.views = (article.views or 0) + 1
    db.commit()

    related = db.query(Article).filter(
        Article.category == article.category,
        Article.id != article.id
    ).limit(3).all()

    return {
        "id": article.id,
        "title": article.title,
        "slug": article.slug,
        "content": article.content,
        "summary": article.summary,
        "cover_image": article.cover_image,
        "category": article.category,
        "author_name": article.author_name,
        "author_avatar": article.author_avatar,
        "reading_time": article.reading_time,
        "views": article.views,
        "tags": article.tags.split(",") if article.tags else [],
        "published_at": article.published_at.isoformat() if article.published_at else None,
        "related": [
            {
                "id": r.id,
                "title": r.title,
                "slug": r.slug,
                "summary": r.summary,
                "category": r.category,
                "reading_time": r.reading_time
            }
            for r in related
        ]
    }

@router.get("/categories")
def get_categories():
    """获取文章分类列表"""
    db = Session(bind=engine)
    try:
        articles = db.query(Article.category).distinct().all()
        return [a[0] for a in articles if a[0]]
    finally:
        db.close()
