"""Tests for sort_by/sort_dir query params on GET /api/admin/articles.

These params let the admin list view order by updated_at / published_at /
title in either direction. Bad values must fall back to the default
(updated_at desc) rather than 422 — the toolbar is supposed to be forgiving.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models.base import Base  # noqa: F401
from app.models import admin_setting as _admin_setting_model  # noqa: F401
from app.models.journal import Article
from app.security import create_access_token


@pytest.fixture()
def client():
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
    token = create_access_token(sub="admin")
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as c:
        yield c, headers, Session

    app.dependency_overrides.clear()


def _seed(Session):
    """Three articles with distinct updated_at, published_at, title."""
    s = Session()
    base = datetime(2026, 1, 1)
    rows = [
        Article(
            title="Charlie", slug="charlie", content="", summary="",
            published_at=base + timedelta(days=3),
            updated_at=base + timedelta(days=30),
        ),
        Article(
            title="Alpha", slug="alpha", content="", summary="",
            published_at=base + timedelta(days=1),
            updated_at=base + timedelta(days=10),
        ),
        Article(
            title="Bravo", slug="bravo", content="", summary="",
            published_at=base + timedelta(days=2),
            updated_at=base + timedelta(days=20),
        ),
    ]
    for r in rows:
        s.add(r)
    s.commit()
    return s


def _titles(c: TestClient, headers: dict, **params) -> list[str]:
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    r = c.get(f"/api/admin/articles?{qs}", headers=headers)
    assert r.status_code == 200, r.text
    return [it["title"] for it in r.json()["items"]]


def test_list_default_sorts_by_updated_at_desc(client):
    c, headers, Session = client
    _seed(Session)
    # Default = updated_at desc → Charlie (30d) → Bravo (20d) → Alpha (10d)
    assert _titles(c, headers) == ["Charlie", "Bravo", "Alpha"]


def test_list_sort_by_updated_at_asc(client):
    c, headers, Session = client
    _seed(Session)
    assert _titles(c, headers, sort_by="updated_at", sort_dir="asc") == ["Alpha", "Bravo", "Charlie"]


def test_list_sort_by_published_at_desc(client):
    c, headers, Session = client
    _seed(Session)
    # published_at desc → Charlie (3d) → Bravo (2d) → Alpha (1d)
    assert _titles(c, headers, sort_by="published_at", sort_dir="desc") == ["Charlie", "Bravo", "Alpha"]


def test_list_sort_by_title_asc(client):
    c, headers, Session = client
    _seed(Session)
    assert _titles(c, headers, sort_by="title", sort_dir="asc") == ["Alpha", "Bravo", "Charlie"]


def test_list_invalid_sort_by_falls_back_to_default(client):
    c, headers, Session = client
    _seed(Session)
    # "garbage" is not whitelisted → fallback to updated_at desc
    assert _titles(c, headers, sort_by="garbage") == ["Charlie", "Bravo", "Alpha"]


def test_list_invalid_sort_dir_falls_back_to_desc(client):
    c, headers, Session = client
    _seed(Session)
    # "sideways" is not asc/desc → fallback to desc
    assert _titles(c, headers, sort_by="title", sort_dir="sideways") == ["Charlie", "Bravo", "Alpha"]


def test_list_category_filter_still_works(client):
    """B2: category filter must continue to narrow results alongside sort."""
    c, headers, Session = client
    s = _seed(Session)
    # Move Charlie into a category; only he should come back.
    s.query(Article).filter(Article.slug == "charlie").update({"category": "战略与政策"})
    s.commit()

    r = c.get("/api/admin/articles?category=战略与政策", headers=headers)
    assert r.status_code == 200
    titles = [it["title"] for it in r.json()["items"]]
    assert titles == ["Charlie"]