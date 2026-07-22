"""Admin API：articles/journals/media CRUD + 上传。"""
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, status
from pydantic import BaseModel, Field
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
    JournalArticlesByCategoryOut,
)
from .security import get_current_admin
from .upload_service import save_upload, read_upload_with_limit, UploadTooLarge, get_public_path
from .services.image_gen import generate_image
from .services.completeness import is_journal_complete
from .models.podcast_audio import PodcastAudio


router = APIRouter(prefix="/api/admin", tags=["admin"])


def _sanitize_filename(name: str) -> str:
    """Sanitize user-supplied filename to prevent stored XSS.

    Strips control characters, HTML angle brackets, quotes, and path
    separators; caps length to 100 chars; falls back to "upload" when
    the input is empty or fully sanitized away.
    """
    if not name:
        return "upload"
    # Remove control chars, HTML angle brackets, quotes
    name = re.sub(r"[\x00-\x1f\x7f<>\"\'\\/]", "", name)
    # Limit length
    name = name[:100].strip()
    return name or "upload"


def _sanitize_prompt(prompt: str) -> str:
    """Sanitize free-text prompt returned to the client.

    Strips HTML angle brackets and quotes; caps length; falls back to
    empty string when fully sanitized away.
    """
    if not prompt:
        return ""
    prompt = re.sub(r"[<>\"\'`]", "", prompt)
    return prompt[:500].strip()


# Maximum characters allowed in a free-text search query. Anything longer is
# almost certainly abuse (or a script error); we reject with 422 to fail fast
# before hitting the database with an expensive LIKE.
_MAX_SEARCH_Q = 100


def _escape_like(q: str) -> str:
    """Escape SQL LIKE wildcards in user input so a query like q='%' does
    not match every row. Pair with .ilike(f"%{q}%", escape="\\\\")."""
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _validate_search_q(q: Optional[str]) -> Optional[str]:
    """Validate and normalize the search query. Returns the query to use,
    or raises HTTPException(422) if too long."""
    if q is None:
        return None
    if len(q) > _MAX_SEARCH_Q:
        raise HTTPException(status_code=422, detail=f"q 长度不能超过 {_MAX_SEARCH_Q}")
    return _escape_like(q)


def _serialize_tags(tags_field) -> Optional[List[str]]:
    if tags_field is None:
        return None
    if isinstance(tags_field, list):
        return tags_field
    return [t.strip() for t in str(tags_field).split(",") if t.strip()]


def _article_to_dict(a: Article, include_content: bool = True) -> dict:
    d = {
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
        "podcast_status": a.podcast_audio.status if a.podcast_audio else "pending",
        "podcast_job_id": a.podcast_audio.job_id if a.podcast_audio else None,
        "podcast_duration_seconds": a.podcast_audio.duration_seconds if a.podcast_audio else 0,
        "podcast_total_chars": a.podcast_audio.total_chars if a.podcast_audio else 0,
        "podcast_error": a.podcast_audio.error_message if a.podcast_audio else None,
        "podcast_updated_at": a.podcast_audio.updated_at.isoformat() if a.podcast_audio and a.podcast_audio.updated_at else None,
    }
    if not include_content:
        d.pop("content", None)
    return d


# ============== ARTICLES ==============

# Whitelists for sort params — accept only known columns/directions so we
# never feed user input straight into order_by().
_SORT_COLUMNS = {
    "updated_at": Article.updated_at,
    "published_at": Article.published_at,
    "title": Article.title,
}
_SORT_DIRS = {"asc", "desc"}


@router.get("/articles")
def list_articles(
    status_: Optional[str] = None,
    category: Optional[str] = None,
    q: Optional[str] = None,
    featured: Optional[bool] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
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
    if featured is not None:
        query = query.filter(Article.featured == (1 if featured else 0))
    safe_q = _validate_search_q(q)
    if safe_q:
        query = query.filter(Article.title.ilike(f"%{safe_q}%", escape="\\"))

    # Sort: default = updated_at desc. Bad values fall back to the default
    # rather than 422-ing — keeps the admin UI forgiving when fields rename.
    col = _SORT_COLUMNS.get(sort_by or "", _SORT_COLUMNS["updated_at"])
    direction = (sort_dir or "desc").lower()
    if direction not in _SORT_DIRS:
        direction = "desc"
    order_fn = col.desc if direction == "desc" else col.asc

    total = query.count()
    items = query.order_by(order_fn()).offset((page - 1) * per_page).limit(per_page).all()
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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    data = body.model_dump()
    tags = data.pop("tags", None)
    data["tags"] = ",".join(tags) if tags else None
    data["featured"] = 1 if data.get("featured") else 0

    article = Article(**data)
    # If created directly as published, stamp published_at so the public
    # ordering by published_at desc puts the new article at the top.
    if data.get("status") == "published" and article.published_at is None:
        article.published_at = datetime.utcnow()

    db.add(article)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"slug '{body.slug}' 已被使用")
    db.refresh(article)
    if (article.content or "").strip():
        from .routers.public_podcast_router import generate_article_podcast
        background_tasks.add_task(generate_article_podcast, article.id)
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


def _podcast_admin_dict(record: PodcastAudio | None) -> dict:
    if not record:
        return {"status": "pending", "job_id": None, "error_message": None}
    return {
        "id": record.id,
        "status": record.status,
        "job_id": record.job_id,
        "script_text": record.script_text or "",
        "segment_count": record.segment_count or 0,
        "total_chars": record.total_chars or 0,
        "duration_seconds": record.duration_seconds or 0,
        "mp3_url": f"/api/public/podcast/download/{record.job_id}" if record.job_id else "",
        "srt_url": f"/api/public/podcast/subtitle/{record.job_id}" if record.srt_path and record.job_id else "",
        "error_message": record.error_message or "",
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


@router.get("/articles/{article_id}/podcast")
def get_article_podcast(
    article_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    return _podcast_admin_dict(db.query(PodcastAudio).filter_by(article_id=article_id).first())


@router.post("/articles/{article_id}/podcast")
def regenerate_article_podcast(
    article_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    if not (article.content or "").strip():
        raise HTTPException(status_code=422, detail="文章正文为空，无法生成语音")
    record = db.query(PodcastAudio).filter_by(article_id=article_id).first()
    if record:
        record.status = "pending"
        record.error_message = None
        db.commit()
    from .routers.public_podcast_router import generate_article_podcast
    background_tasks.add_task(generate_article_podcast, article_id)
    return {"status": "pending"}


@router.delete("/articles/{article_id}/podcast")
def delete_article_podcast(
    article_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    import os
    record = db.query(PodcastAudio).filter_by(article_id=article_id).first()
    job_dir_path: str | None = None
    if record:
        if record.mp3_path:
            job_dir_path = os.path.dirname(record.mp3_path)
        for path in (record.mp3_path, record.srt_path):
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass
        db.delete(record)
        db.commit()
    if job_dir_path:
        try:
            os.rmdir(job_dir_path)
        except OSError:
            pass
    from .services.podcast_script_cache import delete_script
    article = db.get(Article, article_id)
    if article:
        delete_script(article.slug)
    return {"status": "deleted"}


@router.put("/articles/{article_id}")
def update_article(
    article_id: int,
    body: ArticleUpdate,
    background_tasks: BackgroundTasks,
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
    # Auto-stamp published_at when an article transitions draft → published
    # via the generic update path. Stamping here keeps front-end editor
    # behaviour symmetric with POST /publish and prevents the public list
    # ordering by published_at desc from sinking freshly published articles.
    if data.get("status") == "published" and a.published_at is None:
        a.published_at = datetime.utcnow()
    db.commit()
    db.refresh(a)
    if {"content", "title"} & data.keys():
        from .services.podcast_script_cache import delete_script
        delete_script(a.slug)
        from .routers.public_podcast_router import generate_article_podcast
        if (a.content or "").strip():
            background_tasks.add_task(generate_article_podcast, a.id)
    return _article_to_dict(a)


@router.post("/articles/{article_id}/publish", response_model=ArticleAdminOut)
def publish_article(
    article_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    a = db.query(Article).filter(Article.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="文章不存在")
    a.status = "published"
    db.commit()
    db.refresh(a)
    if (a.content or "").strip():
        from .routers.public_podcast_router import generate_article_podcast
        # Publishing a draft is also an article-available event.
        background_tasks.add_task(generate_article_podcast, a.id)
    return _article_to_dict(a)


@router.patch("/articles/{article_id}/featured", response_model=ArticleAdminOut)
def toggle_featured(
    article_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Toggle-only endpoint for the featured flag.

    The generic PUT /articles/{id} also accepts `featured` but requires the
    full payload, which is awkward from list-view quick-toggles. This route
    flips the bit in place; the public /api/articles/featured endpoint picks
    up the change on next request.
    """
    a = db.query(Article).filter(Article.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="文章不存在")
    a.featured = 0 if a.featured else 1
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
    import os
    if a.podcast_audio is not None:
        for path in (a.podcast_audio.mp3_path, a.podcast_audio.srt_path):
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass
    article_slug = a.slug
    db.delete(a)
    db.commit()
    from .services.podcast_script_cache import delete_script
    delete_script(article_slug)
    return OkResponse()


@router.post("/articles/{article_id}/cover")
async def upload_article_cover(
    article_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Upload a cover image for an article in one round-trip.

    Same semantics as ``POST /journals/{id}/cover`` — saves through
    ``save_upload``, writes URL back to ``Article.cover_image``, best-effort
    deletes the previous local file. Used by the per-article CMS cover widget
    and by the journal-detail bulk fix-up action.
    """
    a = db.query(Article).filter(Article.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="文章不存在")

    try:
        content = await read_upload_with_limit(file)
    except UploadTooLarge as e:
        raise HTTPException(status_code=413, detail=str(e))
    safe_name = _sanitize_filename(file.filename or "cover")

    try:
        info = save_upload(filename=safe_name, content=content, uploaded_by=admin, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    old_cover = a.cover_image
    a.cover_image = info["url"]
    db.commit()
    db.refresh(a)

    if old_cover and old_cover.startswith("/uploads/"):
        try:
            old_path = get_public_path(old_cover)
            upload_root = Path(settings.UPLOAD_DIR).resolve()
            if old_path.resolve().is_relative_to(upload_root) and old_path.exists():
                old_path.unlink()
        except OSError:
            pass

    return _article_to_dict(a)


@router.delete("/articles/{article_id}/cover", response_model=OkResponse)
def clear_article_cover(
    article_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    a = db.query(Article).filter(Article.id == article_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="文章不存在")
    old = a.cover_image
    a.cover_image = None
    db.commit()
    if old and old.startswith("/uploads/"):
        try:
            old_path = get_public_path(old)
            upload_root = Path(settings.UPLOAD_DIR).resolve()
            if old_path.resolve().is_relative_to(upload_root) and old_path.exists():
                old_path.unlink()
        except OSError:
            pass
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
        "status": getattr(j, "status", "published"),
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
    safe_q = _validate_search_q(q)
    if safe_q:
        query = query.filter(Journal.title.ilike(f"%{safe_q}%", escape="\\"))
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


@router.post("/journals/{journal_id}/cover")
async def upload_journal_cover(
    journal_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Upload a cover image for a journal in one round-trip.

    Saves the bytes through ``save_upload`` (Pillow validation, /uploads/YYYY/MM/),
    then writes the returned URL back to ``Journal.cover_image``. Old cover file
    (when local and inside the upload root) is deleted to avoid orphaned bytes.
    """
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")

    try:
        content = await read_upload_with_limit(file)
    except UploadTooLarge as e:
        raise HTTPException(status_code=413, detail=str(e))
    safe_name = _sanitize_filename(file.filename or "cover")

    try:
        info = save_upload(filename=safe_name, content=content, uploaded_by=admin, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    old_cover = j.cover_image
    j.cover_image = info["url"]
    db.commit()
    db.refresh(j)

    # Best-effort cleanup of previous cover file. Only delete when the URL
    # points inside the upload root (so we never try to remove arbitrary paths).
    if old_cover and old_cover.startswith("/uploads/"):
        try:
            old_path = get_public_path(old_cover)
            upload_root = Path(settings.UPLOAD_DIR).resolve()
            if old_path.resolve().is_relative_to(upload_root) and old_path.exists():
                old_path.unlink()
        except OSError:
            pass  # best-effort; orphan bytes are not fatal

    return _journal_to_dict(j)


@router.delete("/journals/{journal_id}/cover", response_model=OkResponse)
def clear_journal_cover(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Remove the journal's cover image (DB column cleared, file deleted when local)."""
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    old = j.cover_image
    j.cover_image = None
    db.commit()
    if old and old.startswith("/uploads/"):
        try:
            old_path = get_public_path(old)
            upload_root = Path(settings.UPLOAD_DIR).resolve()
            if old_path.resolve().is_relative_to(upload_root) and old_path.exists():
                old_path.unlink()
        except OSError:
            pass
    return OkResponse()


def _cover_status(url: Optional[str]) -> dict:
    """Compute 'ok' / 'missing' for a cover URL.

    - empty/null URL  -> missing (no URL set)
    - non-/uploads/ URL (e.g. external) -> ok (we can't verify, trust caller)
    - /uploads/ URL with file present -> ok
    - /uploads/ URL with file absent  -> missing_file (DB has stale URL)
    """
    if not url:
        return {"status": "missing", "reason": "no_url"}
    if not url.startswith("/uploads/"):
        return {"status": "ok", "reason": "external"}
    try:
        path = get_public_path(url)
        return {"status": "ok" if path.exists() else "missing_file", "reason": None}
    except Exception:
        return {"status": "ok", "reason": "external"}


@router.get("/covers/status")
def covers_status(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Batch report of cover image health across all journals and articles.

    Frontend uses this to highlight rows whose cover URL 404s so an admin
    can re-upload (rather than discovering the broken image only when a
    visitor opens the page).
    """
    journals = db.query(Journal).all()
    articles = db.query(Article).filter(Article.cover_image.isnot(None), Article.cover_image != "").all()

    return {
        "journals": [
            {
                "id": j.id,
                "title": j.title,
                "slug": j.slug,
                "cover_image": j.cover_image,
                **_cover_status(j.cover_image),
            }
            for j in journals
        ],
        "articles": [
            {
                "id": a.id,
                "title": a.title,
                "slug": a.slug,
                "journal_id": a.journal_id,
                "cover_image": a.cover_image,
                **_cover_status(a.cover_image),
            }
            for a in articles
        ],
    }


@router.get("/journals/{journal_id}/completeness")
def get_journal_completeness(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    return is_journal_complete(j)


class BatchCompletenessRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=200)


@router.post("/journals/completeness")
def batch_journal_completeness(
    body: BatchCompletenessRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Batch variant of /journals/{id}/completeness.

    The list view previously fired one request per row (20 parallel
    HTTP calls for a 20-item page). This endpoint collapses them into
    a single round-trip; missing ids are simply absent from the map.
    """
    journals = db.query(Journal).filter(Journal.id.in_(body.ids)).all()
    return {str(j.id): is_journal_complete(j) for j in journals}


_CATEGORY_KEYS = {
    "战略与政策": "strategy",
    "技术与产业": "technology",
    "方案与思考": "solution",
    "动态与文化": "dynamics",
}


@router.get("/journals/{journal_id}/articles-by-category", response_model=JournalArticlesByCategoryOut)
def articles_by_category(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Per-category article list for the 4-Tab JournalDetail UI.

    Drafts are included so the admin can see what still needs work.
    Sorted newest-first by published_at (falling back to created_at).
    """
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")

    # Defer Article.content — the 4-Tab listing serializes many articles
    # and full Markdown content is not needed (only summary/title/etc.).
    from sqlalchemy.orm import defer
    articles = (
        db.query(Article)
        .options(defer(Article.content))
        .filter(Article.journal_id == journal_id)
        .all()
    )
    buckets: dict[str, list] = {key: [] for key in _CATEGORY_KEYS.values()}
    for a in sorted(
        articles,
        key=lambda x: (x.published_at or x.created_at or datetime.min),
        reverse=True,
    ):
        key = _CATEGORY_KEYS.get(a.category)
        if key:
            buckets[key].append(_article_to_dict(a, include_content=False))

    return {
        "strategy": buckets["strategy"],
        "technology": buckets["technology"],
        "solution": buckets["solution"],
        "dynamics": buckets["dynamics"],
        "completeness": is_journal_complete(j),
    }


@router.post("/journals/{journal_id}/publish")
def publish_journal(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    report = is_journal_complete(j)
    if not report["complete"]:
        missing = [c for c in ("战略与政策", "技术与产业", "方案与思考", "动态与文化") if report[c] == 0]
        raise HTTPException(
            status_code=422,
            detail={
                "code": "incomplete_journal",
                "message": "期刊必须四类文章齐全才能发布",
                "missing": missing,
            },
        )
    j.status = "published"
    db.commit()
    db.refresh(j)
    return _journal_to_dict(j)


@router.post("/journals/{journal_id}/unpublish")
def unpublish_journal(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    j.status = "draft"
    db.commit()
    db.refresh(j)
    return _journal_to_dict(j)


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
    kind: str = "image",
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Upload image (default) or CSV (kind=table).

    kind=image: bytes validated by Pillow, saved under /uploads/YYYY/MM/.
    kind=table: bytes saved as-is with .csv extension, returned as a 'csv'
                 resource so the front-end can transform it to a GFM table.
    """
    if kind not in ("image", "table"):
        raise HTTPException(status_code=400, detail="kind 必须是 image 或 table")

    try:
        content = await read_upload_with_limit(file)
    except UploadTooLarge as e:
        raise HTTPException(status_code=413, detail=str(e))
    safe_name = _sanitize_filename(file.filename or "upload")

    if kind == "image":
        try:
            info = save_upload(
                filename=safe_name,
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
            "kind": "image",
        }

    # kind == "table"
    if not safe_name.lower().endswith(".csv"):
        safe_name = safe_name + ".csv"
    new_filename = f"{uuid.uuid4().hex}.csv"
    upload_root = Path(settings.UPLOAD_DIR)
    now = datetime.utcnow()
    target_dir = upload_root / f"{now.year:04d}" / f"{now.month:02d}"
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / new_filename
    target_path.write_bytes(content)
    url = f"/uploads/{now.year:04d}/{now.month:02d}/{new_filename}"
    record = ArticleImage(
        filename=new_filename,
        original_name=safe_name,
        mime="text/csv",
        size=len(content),
        uploaded_by=admin,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {
        "id": record.id,
        "filename": new_filename,
        "url": url,
        "original_name": safe_name,
        "mime": "text/csv",
        "size": len(content),
        "uploaded_at": record.uploaded_at.isoformat(),
        "kind": "table",
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
    # Path-traversal guard: resolve the upload dir and verify the resolved
    # target stays inside it. Reject anything that escapes (e.g. tampered
    # DB rows with filename="../../etc/passwd").
    upload_root = Path(settings.UPLOAD_DIR).resolve()
    target_path = (upload_root / m.filename).resolve()
    try:
        target_path.relative_to(upload_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法的文件路径")
    if target_path.exists():
        try:
            target_path.unlink()
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
    safe_original_name = _sanitize_filename(f"generated-{info['filename']}")
    safe_prompt = _sanitize_prompt(req.prompt)

    record = ArticleImage(
        filename=info["filename"],
        original_name=safe_original_name,
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
        "prompt": safe_prompt,
        "aspect_ratio": req.aspect_ratio,
        "model": info["model"],
        "status": info["status"],
        "uploaded_at": record.uploaded_at.isoformat(),
    }
