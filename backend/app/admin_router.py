"""Admin API：articles/journals/media CRUD + 上传。"""
import os
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .config import settings
from .database import get_db
from .models.journal import Article, Journal
from .models.article_image import ArticleImage
from .schemas.admin import (
    ArticleCreate, ArticleUpdate, ArticleAdminOut,
    JournalCreate, JournalUpdate, JournalAdminOut,
    MediaOut, OkResponse, ImageGenRequest,
)
from .security import get_current_admin
from .upload_service import save_upload
from .services.image_gen import generate_image


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


# ============== JOURNALS ==============

def _journal_to_dict(j: Journal) -> dict:
    return {
        "id": j.id,
        "title": j.title,
        "slug": j.slug,
        "cover_image": j.cover_image,
        "description": j.description,
        "issue_number": j.issue_number,
        "published_at": j.published_at.isoformat() if j.published_at else None,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "updated_at": j.updated_at.isoformat() if j.updated_at else None,
        "article_count": len(j.articles) if j.articles else 0,
    }


@router.get("/journals")
def list_journals(
    q: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    query = db.query(Journal)
    if q:
        query = query.filter(Journal.title.contains(q))
    total = query.count()
    items = query.order_by(Journal.published_at.desc()).offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [_journal_to_dict(j) for j in items],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


@router.post("/journals")
def create_journal(
    body: JournalCreate,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    data = body.model_dump()
    j = Journal(**data)
    db.add(j)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"slug '{body.slug}' 已被使用")
    db.refresh(j)
    return _journal_to_dict(j)


@router.get("/journals/{journal_id}")
def get_journal_admin(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    return _journal_to_dict(j)


@router.put("/journals/{journal_id}")
def update_journal(
    journal_id: int,
    body: JournalUpdate,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(j, k, v)
    db.commit()
    db.refresh(j)
    return _journal_to_dict(j)


@router.delete("/journals/{journal_id}", response_model=OkResponse)
def delete_journal(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    db.delete(j)
    db.commit()
    return OkResponse()


# ============== MEDIA ==============

def _media_to_dict(m: ArticleImage) -> dict:
    return {
        "id": m.id,
        "filename": m.filename,
        "url": f"/uploads/{m.uploaded_at.year:04d}/{m.uploaded_at.month:02d}/{m.filename}",
        "original_name": m.original_name or "",
        "mime": m.mime,
        "size": m.size,
        "uploaded_at": m.uploaded_at.isoformat(),
    }


@router.get("/media")
def list_media(
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    query = db.query(ArticleImage)
    total = query.count()
    items = query.order_by(ArticleImage.uploaded_at.desc()).offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [_media_to_dict(m) for m in items],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


@router.post("/media")
async def upload_media(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    content = await file.read()
    try:
        info = save_upload(
            filename=file.filename or "upload",
            content=content,
            uploaded_by=admin,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "id": info["id"],
        "filename": info["filename"],
        "url": info["url"],
        "original_name": info["original_name"],
        "mime": info["mime"],
        "size": info["size"],
        "uploaded_at": info["uploaded_at"],
    }


@router.delete("/media/{media_id}", response_model=OkResponse)
def delete_media(
    media_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    m = db.query(ArticleImage).filter(ArticleImage.id == media_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="图片不存在")
    file_path = os.path.join(settings.UPLOAD_DIR, m.filename)
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Failed to delete file: {e}")
    db.delete(m)
    db.commit()
    return OkResponse()


# ============== AI IMAGE GENERATION ==============

@router.post("/media/generate")
async def generate_cover_image(
    req: ImageGenRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """通过 minimax 平台生成封面/配图（无 token 时回退到 PIL 占位图）。"""
    info = await generate_image(req.prompt, req.aspect_ratio)

    record = ArticleImage(
        filename=info["filename"],
        original_name=f"generated-{info['filename']}",
        mime=info["mime"],
        size=info["size"],
        uploaded_by=admin,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "id": record.id,
        "url": info["url"],
        "filename": info["filename"],
        "mime": info["mime"],
        "size": info["size"],
        "prompt": req.prompt,
        "aspect_ratio": req.aspect_ratio,
        "model": info["model"],
        "status": info["status"],
        "uploaded_at": record.uploaded_at.isoformat(),
    }