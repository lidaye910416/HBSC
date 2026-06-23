"""Admin API：articles/journals/media CRUD + 上传。"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .database import get_db
from .models.journal import Article, Journal
from .models.article_image import ArticleImage
from .schemas.admin import (
    ArticleCreate, ArticleUpdate, ArticleAdminOut,
    JournalCreate, JournalUpdate, JournalAdminOut,
    MediaOut, OkResponse,
)
from .security import get_current_admin
from .upload_service import save_upload


router = APIRouter(prefix="/api/admin", tags=["admin"])


def _serialize_tags(tags_field) -> Optional[List[str]]:
    if tags_field is None:
        return None
    if isinstance(tags_field, list):
        return tags_field
    return [t.strip() for t in str(tags_field).split(",") if t.strip()]


def _article_to_dict(a: Article) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "slug": a.slug,
        "summary": a.summary,
        "content": a.content,
        "cover_image": a.cover_image,
        "cover_image_alt": a.cover_image_alt,
        "category": a.category,
        "author_name": a.author_name,
        "author_avatar": a.author_avatar,
        "reading_time": a.reading_time or 5,
        "views": a.views or 0,
        "featured": bool(a.featured),
        "status": a.status or "published",
        "tags": _serialize_tags(a.tags),
        "journal_id": a.journal_id,
        "published_at": a.published_at.isoformat() if a.published_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


# ============== ARTICLES ==============

@router.get("/articles")
def list_articles(
    status_: Optional[str] = None,
    category: Optional[str] = None,
    q: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    query = db.query(Article)
    if status_:
        query = query.filter(Article.status == status_)
    if category:
        query = query.filter(Article.category == category)
    if q:
        query = query.filter(Article.title.contains(q))
    total = query.count()
    items = query.order_by(Article.published_at.desc()).offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [_article_to_dict(a) for a in items],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


@router.post("/articles")
def create_article(
    body: ArticleCreate,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    data = body.model_dump()
    tags = data.pop("tags", None)
    data["tags"] = ",".join(tags) if tags else None
    data["featured"] = 1 if data.get("featured") else 0

    article = Article(**data)
    db.add(article)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"slug '{body.slug}' 已被使用")
    db.refresh(article)
    return _article_to_dict(article)


@router.get("/articles/{article_id}")
def get_article_admin(
    article_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    a = db.query(Article).filter(Article.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="文章不存在")
    return _article_to_dict(a)


@router.put("/articles/{article_id}")
def update_article(
    article_id: int,
    body: ArticleUpdate,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    a = db.query(Article).filter(Article.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="文章不存在")
    data = body.model_dump(exclude_unset=True)
    if "tags" in data:
        tags = data.pop("tags")
        data["tags"] = ",".join(tags) if tags else None
    if "featured" in data:
        data["featured"] = 1 if data["featured"] else 0
    for k, v in data.items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return _article_to_dict(a)


@router.post("/articles/{article_id}/publish", response_model=ArticleAdminOut)
def publish_article(
    article_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    a = db.query(Article).filter(Article.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="文章不存在")
    a.status = "published"
    db.commit()
    db.refresh(a)
    return _article_to_dict(a)


@router.delete("/articles/{article_id}", response_model=OkResponse)
def delete_article(
    article_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    a = db.query(Article).filter(Article.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="文章不存在")
    db.delete(a)
    db.commit()
    return OkResponse()