"""Tests for cover image upload + status endpoints.

Covers the journal + article upload routes, the cover-status batch probe,
the path-traversal guard on the delete-cover helpers, and the admin-auth
requirement on the new endpoints.
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import get_db
from app.main import app
from app.models.base import Base  # noqa: F401
from app.models import admin_setting as _admin_setting_model  # noqa: F401
from app.models import article_image as _article_image_model  # noqa: F401
from app.models.journal import Article, Journal
from app.security import create_access_token


@pytest.fixture()
def tmp_uploads(monkeypatch, tmp_path):
    """Point UPLOAD_DIR at a tmp dir so save_upload doesn't pollute the repo."""
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    yield tmp_path


@pytest.fixture()
def client(tmp_uploads):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    from app.middleware import rate_limit as rl
    rl._buckets.clear()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db

    # Seed: 1 journal (no cover) + 2 articles (one with a stale URL)
    s = Session()
    s.add(Journal(id=1, title="J1", slug="j1", issue_number="2026-Q1",
                  cover_image=None, status="published"))
    s.add(Article(id=1, title="A1", slug="a1", journal_id=1, status="published",
                  cover_image=None))
    s.add(Article(id=2, title="A2", slug="a2", journal_id=1, status="published",
                  cover_image="/uploads/article-covers/a2.jpg"))
    s.commit()

    token = create_access_token(sub="admin")
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as c:
        yield c, headers, Session

    app.dependency_overrides.clear()


def _png_bytes(size=(64, 36), color=(20, 30, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


# ---------- journal cover upload ----------

def test_upload_journal_cover_writes_url_and_returns_journal(client, tmp_uploads):
    c, headers, _ = client
    files = {"file": ("cover.png", _png_bytes(), "image/png")}
    r = c.post("/api/admin/journals/1/cover", files=files, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cover_image"].startswith("/uploads/")
    assert body["cover_image"].endswith(".png")
    rel = body["cover_image"].lstrip("/").removeprefix("uploads/")
    assert (Path(settings.UPLOAD_DIR) / rel).exists()


def test_upload_journal_cover_replaces_old_local_file(client, tmp_uploads):
    c, headers, Session = client
    old = tmp_uploads / "old-cover.png"
    old.write_bytes(_png_bytes())
    # Point the journal at the old file
    s = Session()
    try:
        j = s.get(Journal, 1)
        j.cover_image = f"/uploads/{old.name}"
        s.commit()
    finally:
        s.close()

    files = {"file": ("new.png", _png_bytes(color=(255, 0, 0)), "image/png")}
    r = c.post("/api/admin/journals/1/cover", files=files, headers=headers)
    assert r.status_code == 200
    # save_upload renames to <uuid>.png — just check extension + presence
    assert r.json()["cover_image"].endswith(".png")
    assert r.json()["cover_image"].startswith("/uploads/")
    assert not old.exists()  # old file cleaned up


def test_upload_journal_cover_404_for_missing_journal(client):
    c, headers, _ = client
    files = {"file": ("c.png", _png_bytes(), "image/png")}
    r = c.post("/api/admin/journals/999/cover", files=files, headers=headers)
    assert r.status_code == 404


def test_upload_journal_cover_rejects_non_image(client):
    c, headers, _ = client
    files = {"file": ("c.txt", b"hello world", "text/plain")}
    r = c.post("/api/admin/journals/1/cover", files=files, headers=headers)
    assert r.status_code == 400


# ---------- article cover upload ----------

def test_upload_article_cover(client, tmp_uploads):
    c, headers, _ = client
    files = {"file": ("ac.png", _png_bytes(), "image/png")}
    r = c.post("/api/admin/articles/1/cover", files=files, headers=headers)
    assert r.status_code == 200
    assert r.json()["cover_image"].startswith("/uploads/")
    rel = r.json()["cover_image"].lstrip("/").removeprefix("uploads/")
    assert (Path(settings.UPLOAD_DIR) / rel).exists()


def test_upload_article_cover_404(client):
    c, headers, _ = client
    files = {"file": ("c.png", _png_bytes(), "image/png")}
    r = c.post("/api/admin/articles/999/cover", files=files, headers=headers)
    assert r.status_code == 404


# ---------- covers/status ----------

def test_covers_status_reports_missing_file(client):
    c, headers, _ = client
    # A2 was seeded with a stale URL that doesn't exist on disk
    r = c.get("/api/admin/covers/status", headers=headers)
    assert r.status_code == 200
    body = r.json()
    a_row = next(x for x in body["articles"] if x["id"] == 2)
    assert a_row["status"] == "missing_file"


def test_covers_status_reports_ok_when_file_present(client, tmp_uploads):
    c, headers, Session = client
    p = tmp_uploads / "ok.png"
    p.write_bytes(_png_bytes())
    s = Session()
    try:
        j = s.get(Journal, 1)
        j.cover_image = f"/uploads/{p.name}"
        s.commit()
    finally:
        s.close()

    r = c.get("/api/admin/covers/status", headers=headers)
    j_row = next(x for x in r.json()["journals"] if x["id"] == 1)
    assert j_row["status"] == "ok"


def test_covers_status_reports_missing_when_no_url(client):
    c, headers, _ = client
    r = c.get("/api/admin/covers/status", headers=headers)
    j_row = next(x for x in r.json()["journals"] if x["id"] == 1)
    assert j_row["status"] == "missing"
    assert j_row["reason"] == "no_url"


# ---------- clear cover ----------

def test_clear_journal_cover_removes_file(client, tmp_uploads):
    c, headers, Session = client
    p = tmp_uploads / "clear.png"
    p.write_bytes(_png_bytes())
    s = Session()
    try:
        j = s.get(Journal, 1)
        j.cover_image = f"/uploads/{p.name}"
        s.commit()
    finally:
        s.close()

    r = c.delete("/api/admin/journals/1/cover", headers=headers)
    assert r.status_code == 200
    assert not p.exists()
    s2 = Session()
    try:
        assert s2.get(Journal, 1).cover_image is None
    finally:
        s2.close()


def test_clear_journal_cover_refuses_path_traversal(client, tmp_uploads):
    c, headers, Session = client
    outside = tmp_uploads.parent / "outside-target.png"
    outside.write_bytes(_png_bytes())
    s = Session()
    try:
        j = s.get(Journal, 1)
        j.cover_image = f"/uploads/../{outside.name}"  # sneaky
        s.commit()
    finally:
        s.close()

    try:
        r = c.delete("/api/admin/journals/1/cover", headers=headers)
        # Path-traversal guard skips the unlink — must not raise, must not delete outside file
        assert r.status_code == 200
        assert outside.exists()
    finally:
        outside.unlink(missing_ok=True)


# ---------- auth ----------

def test_covers_status_requires_admin(client):
    c, _, _ = client
    r = c.get("/api/admin/covers/status")  # no auth header
    assert r.status_code == 401


def test_upload_requires_admin(client):
    c, _, _ = client
    files = {"file": ("c.png", _png_bytes(), "image/png")}
    r = c.post("/api/admin/journals/1/cover", files=files)  # no auth
    assert r.status_code == 401
