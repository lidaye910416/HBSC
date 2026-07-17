"""Unified admin media API.

Endpoints:

    GET    /api/admin/media               — list with search/filter/pagination
    POST   /api/admin/media               — upload image (kind=image) or CSV (kind=table)
    GET    /api/admin/media/{id}          — detail
    GET    /api/admin/media/{id}/usages   — list owner references
    DELETE /api/admin/media/{id}          — trash (blocked by usages → 409)
    POST   /api/admin/media/{id}/restore  — undo trash
    DELETE /api/admin/media/{id}/purge    — manual hard delete (eligible only)
    POST   /api/admin/media/generate      — AI image generation

Pagination returns exactly ``{items, total, page, per_page}`` with no
``pages`` field — clients compute pages via ceil(total/per_page).

Image list/detail/include the union of new ``MediaAsset`` fields and the
legacy ``{filename, mime, size, uploaded_at, kind}`` aliases so the
existing front-end media library keeps working without changes.
"""
from __future__ import annotations

import io
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.article_image import ArticleImage
from ..models.journal import Article, Journal
from ..models.media import MediaAsset, MediaUsage
from ..security import get_current_admin
from ..services.app_paths import uploads_root
from ..services.image_gen import ASPECT_RATIOS, generate_image_assets
from ..services.media_lifecycle import (
    AssetInUse,
    eligible_for_purge,
    restore_asset,
    trash_asset,
)
from ..services.media_storage import (
    cleanup_stored_file,
    file_health,
    public_url,
    resolve_inside_uploads,
    store_image,
)
from ..upload_service import UploadTooLarge, read_upload_with_limit


router = APIRouter(prefix="/api/admin/media", tags=["admin-media"])

# Resolved at import time; tests monkeypatch to a tmp path.
UPLOAD_ROOT = uploads_root(settings.UPLOAD_DIR)
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


# ---- helpers --------------------------------------------------------------

_MAX_SEARCH_Q = 100


def _escape_like(q: str) -> str:
    """Escape SQL LIKE wildcards in user input."""
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _validate_search_q(q: Optional[str]) -> Optional[str]:
    if q is None:
        return None
    if len(q) > _MAX_SEARCH_Q:
        raise HTTPException(status_code=422, detail=f"q 长度不能超过 {_MAX_SEARCH_Q}")
    return _escape_like(q)


def _sanitize_filename(name: str) -> str:
    if not name:
        return "upload"
    name = re.sub(r"[\x00-\x1f\x7f<>\"\'\\/]", "", name)
    name = name[:100].strip()
    return name or "upload"


def _health_for(asset: MediaAsset) -> Literal["healthy", "missing_file", "invalid_image"]:
    return file_health(UPLOAD_ROOT, asset.storage_path)


def _serialize_asset(asset: MediaAsset) -> dict:
    health = _health_for(asset)
    return {
        "id": asset.id,
        "storage_path": asset.storage_path,
        "url": f"/uploads/{asset.storage_path}",
        "original_name": asset.original_name,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
        "width": asset.width,
        "height": asset.height,
        "sha256": asset.sha256,
        "source": asset.source,
        "status": asset.status,
        "health": health,
        "uploaded_by": asset.uploaded_by,
        "created_at": asset.created_at.isoformat(),
        "trashed_at": asset.trashed_at.isoformat() if asset.trashed_at else None,
        # legacy aliases
        "filename": asset.storage_path.split("/")[-1],
        "mime": asset.mime_type,
        "size": asset.byte_size,
        "uploaded_at": asset.created_at.isoformat(),
        "kind": "image",
    }


def _owner_title(db: Session, owner_type: str, owner_id: int) -> str:
    if owner_type == "article":
        a = db.get(Article, owner_id)
        return a.title if a else f"article#{owner_id}"
    if owner_type == "journal":
        j = db.get(Journal, owner_id)
        return j.title if j else f"journal#{owner_id}"
    return f"{owner_type}#{owner_id}"


# ---- list / detail --------------------------------------------------------

@router.get("")
def list_media(
    page: int = Query(1, ge=1),
    per_page: int = Query(24, ge=1, le=200),
    q: Optional[str] = None,
    source: Optional[str] = None,
    usage: Optional[Literal["used", "unused"]] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    health: Optional[Literal["healthy", "missing_file", "invalid_image"]] = None,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """List image assets with optional search and filters.

    Filter semantics:
      * ``q``               — LIKE on ``original_name`` (LIKE wildcards escaped)
      * ``source``          — exact match
      * ``status``          — defaults to ``active`` when omitted
      * ``usage=used``      — only assets with ≥1 ``MediaUsage`` row
      * ``usage=unused``    — only assets with zero usages
      * ``health``          — derived per asset; pagination is applied AFTER
                              the health bucket to keep results coherent.

    ``usage`` values are the spec §7.2 contract: ``used`` / ``unused``.
    The legacy ``referenced`` / ``orphan`` aliases used during the
    initial rollout were renamed for parity with the design doc.
    """
    query = db.query(MediaAsset)
    if status_filter:
        query = query.filter(MediaAsset.status == status_filter)
    else:
        query = query.filter(MediaAsset.status == "active")
    safe_q = _validate_search_q(q)
    if safe_q:
        query = query.filter(MediaAsset.original_name.ilike(f"%{safe_q}%", escape="\\"))
    if source:
        query = query.filter(MediaAsset.source == source)

    assets = query.order_by(MediaAsset.created_at.desc()).all()

    if usage in ("used", "unused"):
        referenced_ids = {
            row.asset_id for row in db.query(MediaUsage.asset_id).distinct().all()
        }
        if usage == "used":
            assets = [a for a in assets if a.id in referenced_ids]
        else:  # "unused"
            assets = [a for a in assets if a.id not in referenced_ids]

    if health:
        assets = [a for a in assets if _health_for(a) == health]

    total = len(assets)
    start = (page - 1) * per_page
    items = assets[start:start + per_page]
    return {
        "items": [_serialize_asset(a) for a in items],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/{asset_id}")
def get_media(
    asset_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail={"code": "asset_not_found", "message": "图片不存在"})
    return _serialize_asset(asset)


@router.get("/{asset_id}/usages")
def list_usages(
    asset_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail={"code": "asset_not_found", "message": "图片不存在"})
    usages = db.query(MediaUsage).filter_by(asset_id=asset.id).all()
    return [
        {
            "owner_type": u.owner_type,
            "owner_id": u.owner_id,
            "field": u.field,
            "title": _owner_title(db, u.owner_type, u.owner_id),
            "reference_count": u.reference_count,
        }
        for u in usages
    ]


# ---- upload (image + CSV) -------------------------------------------------

_ALLOWED_CLIENT_SOURCES = {"paste", "drop", "upload"}


@router.post("")
async def upload_media(
    file: UploadFile = File(...),
    kind: str = Query("image"),
    source: str = Query("upload"),
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Upload an image (default) or a CSV table.

    For images, the bytes are Pillow-validated and stored under the
    canonical ``YYYY/MM/<uuid>.<ext>`` layout, then registered as a
    ``MediaAsset(source=source, status='active')`` row. On DB commit
    failure the new file is unlinked so the disk and DB stay in sync.

    For CSV tables, the bytes are written as-is with a ``.csv``
    extension and recorded in the legacy ``ArticleImage`` row only —
    table assets do not appear in the image list (no MediaAsset row,
    no usage tracking).
    """
    if kind not in ("image", "table"):
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_kind", "message": "kind 必须是 image 或 table"},
        )

    try:
        content = await read_upload_with_limit(file, kind=kind)
    except UploadTooLarge as e:
        raise HTTPException(status_code=413, detail=str(e))

    safe_name = _sanitize_filename(file.filename or "upload")

    if kind == "image":
        if source not in _ALLOWED_CLIENT_SOURCES:
            raise HTTPException(
                status_code=422,
                detail={"code": "invalid_kind", "message": "invalid image source"},
            )
        try:
            stored = store_image(UPLOAD_ROOT, safe_name, content)
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_image", "message": str(e)},
            )
        asset = MediaAsset(
            storage_path=stored.storage_path,
            original_name=safe_name,
            mime_type=stored.mime_type,
            byte_size=stored.byte_size,
            width=stored.width,
            height=stored.height,
            sha256=stored.sha256,
            source=source,
            status="active",
            uploaded_by=admin,
        )
        db.add(asset)
        try:
            db.commit()
        except Exception:
            db.rollback()
            cleanup_stored_file(UPLOAD_ROOT, stored.storage_path)
            raise
        db.refresh(asset)
        body = _serialize_asset(asset)
        # Source is not surfaced to the front-end for image assets.
        body["source"] = asset.source
        return body

    # kind == "table"
    if not safe_name.lower().endswith(".csv"):
        safe_name = safe_name + ".csv"
    new_filename = f"{uuid.uuid4().hex}.csv"
    now = datetime.utcnow()
    rel_dir = f"{now.year:04d}/{now.month:02d}"
    target_dir = resolve_inside_uploads(UPLOAD_ROOT, rel_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = resolve_inside_uploads(UPLOAD_ROOT, f"{rel_dir}/{new_filename}")
    target_path.write_bytes(content)
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
        "url": f"/uploads/{rel_dir}/{new_filename}",
        "filename": new_filename,
        "original_name": safe_name,
        "mime": "text/csv",
        "size": len(content),
        "uploaded_at": record.uploaded_at.isoformat(),
        "kind": "table",
    }


# ---- lifecycle ------------------------------------------------------------

@router.delete("/{asset_id}")
def trash_media(
    asset_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail={"code": "asset_not_found", "message": "图片不存在"})

    if asset.status == "trashed":
        return {"ok": True}

    usages = db.query(MediaUsage).filter_by(asset_id=asset.id).all()
    try:
        trash_asset(db, asset, now=datetime.utcnow())
    except AssetInUse:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "asset_in_use",
                "message": "该图片仍被引用",
                "usages": [
                    {
                        "owner_type": u.owner_type,
                        "owner_id": u.owner_id,
                        "field": u.field,
                        "title": _owner_title(db, u.owner_type, u.owner_id),
                        "reference_count": u.reference_count,
                    }
                    for u in usages
                ],
            },
        )
    db.commit()
    return {"ok": True}


@router.post("/{asset_id}/restore")
def restore_media(
    asset_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail={"code": "asset_not_found", "message": "图片不存在"})
    restore_asset(asset)
    db.commit()
    db.refresh(asset)
    return _serialize_asset(asset)


@router.delete("/{asset_id}/purge")
def purge_media(
    asset_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Manual, explicit purge. Allowed only when the asset is trashed and
    older than the configured retention window (default 30 days).
    """
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail={"code": "asset_not_found", "message": "图片不存在"})
    now = datetime.utcnow()
    if not eligible_for_purge(asset, now=now, retention_days=settings.MEDIA_TRASH_RETENTION_DAYS):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "not_eligible_for_purge",
                "message": "未过保留期或状态不允许",
            },
        )

    # Re-check usages under the same transaction — a trashed asset can
    # already have had every usage cleared, but a concurrent editor save
    # could be racing to attach a fresh one. We rely on the FK RESTRICT
    # to enforce the hard invariant.
    if db.query(MediaUsage).filter_by(asset_id=asset.id).count() > 0:
        raise HTTPException(
            status_code=409,
            detail={"code": "asset_in_use", "message": "该图片仍被引用"},
        )

    target_path = (UPLOAD_ROOT / asset.storage_path).resolve()
    try:
        target_path.relative_to(UPLOAD_ROOT)
    except ValueError:
        raise HTTPException(status_code=500, detail={"code": "invalid_path", "message": "invalid media path"})

    try:
        target_path.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        # Don't lose the row on unlink failure — leave for later retry.
        raise HTTPException(
            status_code=500,
            detail={"code": "unlink_failed", "message": "failed to unlink stored file"},
        )

    try:
        db.delete(asset)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail={"code": "delete_failed", "message": "missing_file: row preserved after unlink"},
        )
    return {"ok": True}


# ---- AI image generation --------------------------------------------------

from pydantic import BaseModel as _PydBase  # noqa: E402


class GenerateImageRequest(_PydBase):
    prompt: str
    aspect_ratio: Literal["16:9", "1:1", "4:3"] = "16:9"


@router.post("/generate")
async def generate_media(
    body: GenerateImageRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Generate an image and register it as a ``MediaAsset``.

    Calls ``image_gen.generate_image_assets`` which returns raw bytes
    plus generation metadata (model, status). The bytes flow through
    ``store_image`` so the row stays consistent with the file system.
    """
    if body.aspect_ratio not in ASPECT_RATIOS:
        raise HTTPException(status_code=422, detail="不支持的宽高比")
    gen = await generate_image_assets(body.prompt, body.aspect_ratio)
    safe_name = _sanitize_filename(
        f"generated-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.png",
    )
    stored = store_image(UPLOAD_ROOT, safe_name, gen.content)
    asset = MediaAsset(
        storage_path=stored.storage_path,
        original_name=safe_name,
        mime_type=stored.mime_type,
        byte_size=stored.byte_size,
        width=stored.width,
        height=stored.height,
        sha256=stored.sha256,
        source="generated",
        status="active",
        uploaded_by=admin,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    body_out = _serialize_asset(asset)
    body_out["prompt"] = body.prompt
    body_out["model"] = gen.model
    body_out["aspect_ratio"] = body.aspect_ratio
    body_out["status"] = gen.generation_status
    return body_out
