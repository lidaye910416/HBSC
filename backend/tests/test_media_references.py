"""References service: AST extraction, URL normalization, usage sync.

Each test pins one invariant of the sync pipeline:

* duplicate ``![...](same)`` references count as multiple usages
* non-image tokens (links, plain text) are NOT counted
* brackets used as Chinese parentheticals are NOT counted
* percent-encoding is decoded; ``?query`` / ``#frag`` are dropped
* external / data / protocol-relative URLs return ``None``
* traversal-encoded src raises ``ValueError``
* sync reconcile: insert / update count / delete by absence
* sync fail-fast on unknown / trashed / unhealthy asset
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest  # noqa: E402
from PIL import Image  # noqa: E402

from app.services.media_references import (  # noqa: E402
    UnknownMediaAsset,
    UnavailableMediaAsset,
    extract_local_image_counts,
    normalize_upload_src,
)


def png_bytes(color: str = "red") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), color).save(buf, "PNG")
    return buf.getvalue()


def test_extracts_only_markdown_images_and_counts_duplicates(tmp_path):
    md = (
        "![a](/uploads/x/a.png)\n"
        "![a2](/uploads/x/a.png)\n"
        "[link](/uploads/x/b.png)\n"
        "（图像路径：/uploads/x/c.png）"
    )
    counts = extract_local_image_counts(md, slug=None, upload_root=tmp_path)
    assert counts == {"x/a.png": 2}


def test_normalizes_percent_encoding_and_drops_query(tmp_path):
    assert normalize_upload_src("/uploads/a%20b/c.png?v=1#x", None, tmp_path) == "a b/c.png"


def test_skips_external_data_and_protocol_relative(tmp_path):
    for src in ["https://a/x.png", "data:image/png;base64,xx", "//cdn/x.png"]:
        assert normalize_upload_src(src, None, tmp_path) is None


def test_rejects_encoded_traversal(tmp_path):
    with pytest.raises(ValueError):
        normalize_upload_src("/uploads/a/%2E%2E/b.png", None, tmp_path)


def test_legacy_media_ref_resolves_through_slug(tmp_path):
    # "openclaw-agent-framework" is in the legacy SLUG_TO_IMAGE_DIR map,
    # so media/image1.png should resolve to source-images/03-openclaw/image1.png.
    counts = extract_local_image_counts(
        "![x](media/image1.png)", slug="openclaw-agent-framework", upload_root=tmp_path,
    )
    assert counts == {"source-images/03-openclaw/image1.png": 1}


def test_sync_article_content_inserts_updates_removes(tmp_path):
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import _enable_sqlite_foreign_keys
    from app.models.base import Base
    from app.models.media import MediaAsset, MediaUsage
    from app.services.media_references import sync_article_content

    upload = tmp_path
    a1 = upload / "a.png"
    a1.parent.mkdir(parents=True, exist_ok=True)
    a1.write_bytes(png_bytes("red"))
    a2 = upload / "b.png"
    a2.write_bytes(png_bytes("blue"))

    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    asset_a = MediaAsset(
        storage_path="a.png", original_name="a.png", mime_type="image/png",
        byte_size=a1.stat().st_size, width=32, height=24,
        sha256="a" * 64, source="upload", status="active", uploaded_by="admin",
    )
    asset_b = MediaAsset(
        storage_path="b.png", original_name="b.png", mime_type="image/png",
        byte_size=a2.stat().st_size, width=32, height=24,
        sha256="b" * 64, source="upload", status="active", uploaded_by="admin",
    )
    db.add_all([asset_a, asset_b])
    db.commit()

    # First sync: insert two usages.
    md1 = "![x](/uploads/a.png)\n![y](/uploads/b.png)"
    sync_article_content(db, article_id=7, markdown=md1, slug=None, upload_root=upload)
    db.commit()
    usages = {
        u.asset.storage_path: u.reference_count for u in db.query(MediaUsage).all()
    }
    assert usages == {"a.png": 1, "b.png": 1}

    # Second sync: a.png duplicated, b.png removed.
    md2 = "![x](/uploads/a.png)\n![x2](/uploads/a.png)"
    sync_article_content(db, article_id=7, markdown=md2, slug=None, upload_root=upload)
    db.commit()
    usages = {
        u.asset.storage_path: u.reference_count for u in db.query(MediaUsage).all()
    }
    assert usages == {"a.png": 2}

    # Unknown asset fast-fails with a structured error and leaves the
    # previous usage set intact.
    md3 = "![z](/uploads/missing.png)"
    with pytest.raises(UnknownMediaAsset):
        sync_article_content(db, article_id=7, markdown=md3, slug=None, upload_root=upload)
    db.rollback()
    usages = {
        u.asset.storage_path: u.reference_count for u in db.query(MediaUsage).all()
    }
    assert usages == {"a.png": 2}

    # Trashed asset fast-fails.
    asset_a.status = "trashed"
    db.commit()
    with pytest.raises(UnavailableMediaAsset):
        sync_article_content(db, article_id=7, markdown=md1, slug=None, upload_root=upload)
    db.close()
