"""Shared test fixtures for the unified media test suite.

The fixtures here build a hermetic environment: in-memory SQLite with
SQLite FK enforcement on, a per-test tmp uploads root, an authenticated
admin client. They DO NOT touch the configured dev database.

Specialized fixtures (article_with_asset, etc.) live next to the tests
that use them so the seed shape is visible at the call site.
"""
from __future__ import annotations

import io
import sys
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import _enable_sqlite_foreign_keys, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.base import Base  # noqa: E402
from app.models.journal import Article, Journal  # noqa: E402
from app.models.media import MediaAsset, MediaUsage  # noqa: E402
from app.security import create_access_token  # noqa: E402


def make_png_bytes(*args, size=(32, 24), color="red") -> bytes:
    """Build a tiny real PNG. Accepts both ``make_png_bytes()`` and
    ``make_png_bytes("blue")`` (the legacy positional color).
    """
    if args and isinstance(args[0], str):
        color = args[0]
    elif args and isinstance(args[0], tuple):
        size = args[0]
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, "PNG")
    return buffer.getvalue()


@dataclass
class SeededMedia:
    """Test handle returned by the ``media_asset`` fixture."""

    asset: MediaAsset
    url: str


@pytest.fixture()
def media_test_env(monkeypatch, tmp_path):
    """Per-test in-memory DB + tmp uploads root, with admin_media/admin_router
    pointed at the tmp dir so the routes' storage_path writes stay hermetic.
    """
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    # Refresh rate-limit state so login isn't throttled across tests.
    from app.middleware import rate_limit as rl
    rl._buckets.clear()

    # The admin media router (Task 5) binds UPLOAD_ROOT from settings via
    # app.services.app_paths.uploads_root at import time; tests reach into
    # the same module-level constant to point it at the tmp dir.
    from app.routers import admin_media as media_router
    monkeypatch.setattr(media_router, "UPLOAD_ROOT", tmp_path)

    yield {"client": TestClient(app), "Session": Session, "upload_root": tmp_path}
    app.dependency_overrides.clear()


@pytest.fixture()
def admin_client(media_test_env):
    """An authenticated admin TestClient with the in-memory DB."""
    client = media_test_env["client"]
    client.headers["Authorization"] = f"Bearer {create_access_token(sub='admin')}"
    with client:
        yield client


@pytest.fixture()
def png_file():
    """Return a (filename, BytesIO, mimetype) tuple ready for TestClient ``files=``."""
    return ("image.png", io.BytesIO(make_png_bytes()), "image/png")


@pytest.fixture()
def media_asset(media_test_env):
    """Seed one active MediaAsset + on-disk PNG.

    The asset is referenced by ``storage_path`` ``2026/07/existing.png``
    so tests can build Markdown pointing at ``/uploads/2026/07/existing.png``.
    """
    storage_path = "2026/07/existing.png"
    target = media_test_env["upload_root"] / storage_path
    target.parent.mkdir(parents=True, exist_ok=True)
    content = make_png_bytes()
    target.write_bytes(content)
    db = media_test_env["Session"]()
    asset = MediaAsset(
        storage_path=storage_path, original_name="existing.png",
        mime_type="image/png", byte_size=len(content), width=32, height=24,
        sha256=sha256(content).hexdigest(), source="upload",
        status="active", uploaded_by="admin",
    )
    db.add(asset); db.commit(); db.refresh(asset)
    seeded = SeededMedia(asset=asset, url=f"/uploads/{storage_path}")
    db.close()
    return seeded


@pytest.fixture()
def referenced_asset(media_test_env, media_asset):
    """Add an article-19 journal+article and one ``content`` usage for the asset."""
    db = media_test_env["Session"]()
    journal = Journal(id=1, title="J1", slug="j1", status="published")
    article = Article(
        id=19, title="Article 19", slug="article-19",
        status="draft", journal=journal,
    )
    db.add(article); db.flush()
    db.add(MediaUsage(
        asset_id=media_asset.asset.id,
        owner_type="article", owner_id=19, field="content",
    ))
    db.commit(); db.close()
    return media_asset.asset
