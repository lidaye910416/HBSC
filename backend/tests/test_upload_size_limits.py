"""Per-class upload size limits: image=5MB, docx=50MB.

Audit found a single UPLOAD_MAX_SIZE_MB=5 was shared between image uploads
(Pillow-validated, 5MB reasonable) and .docx imports (zip archives with
embedded media, commonly 10-50MB). This file pins the split so neither
class can regress against the other.

Covers:
- image upload under 5MB succeeds (POST /api/admin/media, kind=image)
- image upload over 5MB returns 413
- docx upload under 50MB succeeds (POST /api/admin/articles/import-docx)
- docx upload over 50MB returns 413
- the two limits are independent (image 5MB cap does not block docx)
"""
from __future__ import annotations

import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models.base import Base  # noqa: F401


# --- helpers --------------------------------------------------------------

def _make_png_bytes(size_bytes: int) -> bytes:
    """Build an image-shaped payload at least ``size_bytes`` long.

    The upload router checks the size BEFORE Pillow decodes the bytes
    (see ``read_upload_with_limit``), so anything PNG-signature-shaped is
    fine — Pillow is never asked to open it when we want a 413.

    For the under-cap path we return a small real Pillow-encoded PNG so
    ``_detect_mime`` can confirm ``image/png``.
    """
    # Under-cap (< a few MB): return a tiny real PNG. The size check is the
    # only thing that matters and a 100-byte PNG trivially satisfies it.
    img = Image.new("RGB", (32, 32), color=(120, 90, 200))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    real_png = buf.getvalue()
    if len(real_png) >= size_bytes:
        return real_png
    # Over-cap (>5 MB): pad a valid PNG signature with random-ish bytes so
    # the on-disk length matches the requested size. The size check fires
    # before Pillow decodes, so the padding is irrelevant.
    padding = b"\x00" * (size_bytes - len(real_png))
    return real_png + padding


def _make_docx_bytes(size_bytes: int) -> bytes:
    """Build a fake .docx-sized payload.

    We don't need a *valid* docx here — the size-limit check fires BEFORE
    pandoc/mime validation. The bytes just need to look big.
    """
    return b"PK\x03\x04" + b"\x00" * max(0, size_bytes - 4)


@pytest.fixture()
def client(monkeypatch):
    """In-memory DB + an authenticated admin via JWT.

    Auth uses ``settings.ADMIN_USERNAME`` / ``ADMIN_PASSWORD_HASH``. The
    singleton ``settings`` object is already constructed at import time, so
    we just override the two attributes directly (the login router reads
    from the same singleton).

    We use ``monkeypatch.setattr`` so the override is scoped to this test
    and won't leak into siblings. We also patch the auth_router's bound
    ``settings`` reference — other test files sometimes ``importlib.reload``
    the config module, which leaves the routers holding a stale object.
    """
    from app import config as _config
    import sys as _sys
    _auth_mod = _sys.modules["app.routers.auth_router"]
    from app.security import hash_password
    hashed = hash_password("test-pass")
    monkeypatch.setattr(_config.settings, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(_config.settings, "ADMIN_PASSWORD_HASH", hashed)
    # Routers captured a reference at import time; if a prior test reloaded
    # ``app.config`` the auth router's ``settings`` may be a stale object.
    # Force them to point at the live singleton for the duration of this test.
    monkeypatch.setattr(_auth_mod, "settings", _config.settings)

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)

    def _override_db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_db

    # Avoid actually shelling out to pandoc — we only want to exercise the
    # size-limit guard. The router raises BEFORE pandoc is invoked when the
    # cap is exceeded; for under-cap tests we stub convert_docx_to_markdown.
    from app.routers import admin_articles_import as imp_mod
    monkeypatch.setattr(
        imp_mod, "convert_docx_to_markdown",
        lambda content, media_dir: type("R", (), {
            "title": "ok",
            "content_markdown": "# ok",
            "suggested_slug": "ok",
            "warnings": [],
            "images": [],
        })(),
    )

    # Reset rate-limit buckets between tests so login isn't 429-throttled.
    from app.middleware import rate_limit as rl
    rl._buckets.clear()

    with TestClient(app) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "test-pass"})
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        c.headers["Authorization"] = f"Bearer {token}"
        yield c

    app.dependency_overrides.clear()


# --- image tests ----------------------------------------------------------

def test_image_upload_under_5mb_succeeds(client):
    """A ~1 MB PNG (well under the 5 MB image cap) must be accepted."""
    png = _make_png_bytes(1024 * 1024)  # ~1 MB
    files = {"file": ("test.png", io.BytesIO(png), "image/png")}
    r = client.post("/api/admin/media?kind=image", files=files)
    assert r.status_code == 200, f"unexpected {r.status_code}: {r.text}"
    body = r.json()
    assert body["mime"] == "image/png"
    assert body["size"] == len(png)


def test_image_upload_over_5mb_returns_413(client):
    """An 8 MB PNG must be rejected with 413 (over the 5 MB image cap)."""
    png = _make_png_bytes(8 * 1024 * 1024)
    assert len(png) > 5 * 1024 * 1024, f"test setup wrong: only {len(png)} bytes"
    files = {"file": ("huge.png", io.BytesIO(png), "image/png")}
    r = client.post("/api/admin/media?kind=image", files=files)
    assert r.status_code == 413, f"expected 413, got {r.status_code}: {r.text}"


# --- docx tests -----------------------------------------------------------

def test_docx_upload_under_50mb_succeeds(client):
    """A 10 MB .docx-shaped payload (under the 50 MB cap) must be accepted."""
    payload = _make_docx_bytes(10 * 1024 * 1024)
    files = {
        "file": (
            "test.docx",
            io.BytesIO(payload),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
    }
    r = client.post("/api/admin/articles/import-docx", files=files)
    assert r.status_code == 200, f"unexpected {r.status_code}: {r.text}"


def test_docx_upload_over_50mb_returns_413(client):
    """A 60 MB payload must be rejected with 413 (over the 50 MB docx cap)."""
    payload = _make_docx_bytes(60 * 1024 * 1024)
    files = {
        "file": (
            "huge.docx",
            io.BytesIO(payload),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
    }
    r = client.post("/api/admin/articles/import-docx", files=files)
    assert r.status_code == 413, f"expected 413, got {r.status_code}: {r.text}"
    # Error message should reference the docx cap (50 MB), not the image cap.
    assert "50" in r.text or "docx" in r.text.lower(), r.text


# --- independence test ----------------------------------------------------

def test_image_and_docx_have_independent_limits(client):
    """A 10 MB image must be rejected (over 5 MB image cap) while a 10 MB
    docx payload is accepted (under 50 MB docx cap). The two limits must
    not be aliased — that was the bug we are fixing.
    """
    # Image over its 5 MB cap → 413
    big_png = _make_png_bytes(8 * 1024 * 1024)
    r_img = client.post(
        "/api/admin/media?kind=image",
        files={"file": ("big.png", io.BytesIO(big_png), "image/png")},
    )
    assert r_img.status_code == 413, (
        f"image cap regressed: got {r_img.status_code} {r_img.text}"
    )

    # Docx under its 50 MB cap → 200 (the stubbed converter returns ok)
    docx_payload = _make_docx_bytes(10 * 1024 * 1024)
    r_docx = client.post(
        "/api/admin/articles/import-docx",
        files={
            "file": (
                "ok.docx",
                io.BytesIO(docx_payload),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
        },
    )
    assert r_docx.status_code == 200, (
        f"docx cap regressed: got {r_docx.status_code} {r_docx.text}"
    )