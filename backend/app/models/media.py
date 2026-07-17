"""MediaAsset / MediaUsage models and their constraints.

These two tables back the reference-aware media backend. ``MediaAsset``
holds the immutable record of every upload; ``MediaUsage`` records
where each asset is referenced (which article or journal owns a
``content`` or ``cover_image`` reference). The unique constraint on
``(asset_id, owner_type, owner_id, field)`` plus the FK from usages to
assets with ``ondelete=RESTRICT`` enforces the lint rule directly in the
schema: an asset cannot be hard-deleted while any owner still
references it, and the same owner cannot accumulate duplicate rows for
the same field.
"""
from datetime import datetime
from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, Integer, String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from .base import Base


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id = Column(Integer, primary_key=True, index=True)
    # storage_path is the immutable public/relative path under UPLOAD_DIR,
    # always in POSIX form ("YYYY/MM/<uuid>.png" for fresh uploads, and
    # arbitrary rel-paths for legacy inventory entries). Unique so that
    # re-running the migration is idempotent and so the apply step can
    # upsert by exact path.
    storage_path = Column(String(1000), unique=True, nullable=False, index=True)
    original_name = Column(String(255), nullable=False)
    mime_type = Column(String(50), nullable=False)
    byte_size = Column(Integer, nullable=False)
    width = Column(Integer)
    height = Column(Integer)
    sha256 = Column(String(64), nullable=False, index=True)
    source = Column(String(20), nullable=False)
    source_ref = Column(String(255))
    status = Column(String(20), nullable=False, default="active", index=True)
    uploaded_by = Column(String(100))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    trashed_at = Column(DateTime)

    usages = relationship(
        "MediaUsage",
        back_populates="asset",
        passive_deletes=True,
        cascade="save-update, merge",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('active','trashed')",
            name="ck_media_asset_status",
        ),
        CheckConstraint(
            "source IN ('paste','drop','upload','docx','legacy','cover','generated')",
            name="ck_media_asset_source",
        ),
    )


class MediaUsage(Base):
    __tablename__ = "media_usages"

    id = Column(Integer, primary_key=True)
    # RESTRICT (not CASCADE): the schema MUST reject asset deletion while
    # any usage exists. The lifecycle code is responsible for first clearing
    # usages (typically because the owner was deleted) before unlinking.
    asset_id = Column(
        Integer,
        ForeignKey("media_assets.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    owner_type = Column(String(20), nullable=False, index=True)
    owner_id = Column(Integer, nullable=False, index=True)
    field = Column(String(30), nullable=False)
    # Tracks how many times the same owner/field references this asset
    # within their content (e.g. the same image inserted N times in
    # markdown). 1 for cover_image references; >1 when Markdown body
    # duplicates the same URL — checked > 0 by constraint.
    reference_count = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    asset = relationship("MediaAsset", back_populates="usages")

    __table_args__ = (
        UniqueConstraint(
            "asset_id", "owner_type", "owner_id", "field",
            name="uq_media_usage_owner",
        ),
        CheckConstraint(
            "(owner_type='article' AND field IN ('content','cover_image')) OR "
            "(owner_type='journal' AND field='cover_image')",
            name="ck_media_usage_owner_field",
        ),
        CheckConstraint(
            "reference_count > 0",
            name="ck_media_usage_count",
        ),
    )
