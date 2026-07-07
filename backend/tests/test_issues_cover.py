"""Regression test: GET /api/issues/{slug} must include cover_image in articles.

Bug history: the serializer in ``_journal_to_dict`` was missing ``cover_image``
(and ``author_name``) in the embedded article dict. The frontend's
``ArticleCard`` then fed ``undefined`` to ``<CoverImage>`` and every card fell
back to the blue-gradient placeholder — users reported it as "/issues/2026-q1
所有文章卡片都是白色的". This test pins the field so we don't lose it again.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models.base import Base  # noqa: F401
from app.models import admin_setting as _admin_setting_model  # noqa: F401
from app.models.journal import Article, Journal


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db

    s = Session()
    s.add(Journal(id=1, title="2026第一期", slug="2026-q1",
                  issue_number="2026-Q1", status="published",
                  published_at=datetime(2026, 4, 10)))
    s.add(Article(
        id=1, title="文章A", slug="a", journal_id=1, status="published",
        cover_image="/uploads/article-covers/a.jpg",
        author_name="作者甲",
        published_at=datetime(2026, 4, 10),
    ))
    s.add(Article(
        id=2, title="文章B", slug="b", journal_id=1, status="published",
        cover_image=None,  # the not-yet-uploaded case must not crash
        author_name=None,
        published_at=datetime(2026, 4, 11),
    ))
    s.commit()
    s.close()

    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_issue_detail_includes_cover_image_in_articles(client):
    """Every article in the embedded list MUST carry cover_image — even when null.

    A missing field is indistinguishable from null at the JS layer and triggers
    CoverImage's blue-gradient fallback. Both shapes must round-trip correctly.
    """
    r = client.get("/api/issues/2026-q1")
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "2026-q1"
    assert len(body["articles"]) == 2

    # Field must be present (not just truthy) on every article entry
    for a in body["articles"]:
        assert "cover_image" in a, f"article {a['slug']!r} missing cover_image field"
        assert "author_name" in a, f"article {a['slug']!r} missing author_name field"

    # The article that has a cover URL surfaces it
    with_cover = next(a for a in body["articles"] if a["slug"] == "a")
    assert with_cover["cover_image"] == "/uploads/article-covers/a.jpg"
    assert with_cover["author_name"] == "作者甲"

    # The article with null cover is null, NOT missing
    without = next(a for a in body["articles"] if a["slug"] == "b")
    assert without["cover_image"] is None
    assert without["author_name"] is None


def test_issue_detail_returns_404_for_unknown_slug(client):
    r = client.get("/api/issues/does-not-exist")
    assert r.status_code == 404
