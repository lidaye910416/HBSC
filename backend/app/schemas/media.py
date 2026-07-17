"""Pydantic schemas for the unified media backend.

These types describe the shape returned by ``/api/admin/media``-style
endpoints. The legacy `ArticleImage` row is not represented here; the
admin router translates ``MediaAsset`` rows into ``MediaOut`` (with
compatibility aliases for the old ``filename/mime/size/uploaded_at``
field names used by the front-end media library).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


MediaSource = Literal[
    "paste", "drop", "upload", "docx", "legacy", "cover", "generated",
]
MediaStatus = Literal["active", "trashed"]
MediaHealth = Literal["healthy", "missing_file", "invalid_image"]


class MediaUsageOut(BaseModel):
    """One row from ``GET /api/admin/media/{id}/usages``.

    Title is hydrated by the router from the owner row so the front-end
    can render a clickable "used in article X" link without a second
    round-trip.
    """

    owner_type: Literal["article", "journal"]
    owner_id: int
    field: Literal["content", "cover_image"]
    title: str
    reference_count: int


class MediaOut(BaseModel):
    """Unified media response with compatibility aliases.

    The new fields (``storage_path``, ``mime_type``, ``byte_size``,
    ``created_at``) follow the database columns; the legacy aliases
    (``filename``, ``mime``, ``size``, ``uploaded_at``, ``kind``) are
    kept so the existing front-end media library keeps working with no
    changes.
    """

    id: int
    storage_path: str
    url: str
    original_name: str
    mime_type: str
    byte_size: int
    width: int | None
    height: int | None
    sha256: str
    source: MediaSource
    status: MediaStatus
    health: MediaHealth
    uploaded_by: str | None
    created_at: datetime
    trashed_at: datetime | None
    # Compatibility aliases for the legacy ArticleImage-backed API:
    filename: str
    mime: str
    size: int
    uploaded_at: datetime
    kind: Literal["image"] = "image"
