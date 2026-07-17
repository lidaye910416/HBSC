"""Tests for issue (期数) filters and pagination shape on admin article list.

The plan adds:
- `journal_id` filter
- `unassigned` filter
- mutually exclusive combination (422)
- `journal_title` field on each row
- pagination shape = {items, total, page, per_page} (no `pages`)
- `status` query alias (the original parameter was `status_`; alias makes
  the standard `?status=draft` parameter work too).

A nonexistent journal_id returns 200 with an empty page; the *write* path
raises 422 separately.
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
from app.models.base import Base
from app.models.journal import Article, Journal
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

    db = Session()
    db.add_all([
        Journal(id=1, title="2026年第一期", slug="2026-q1", status="published",
                published_at=datetime(2026, 3, 31)),
        Journal(id=2, title="2026年第二期", slug="2026-q2", status="published",
                published_at=datetime(2026, 6, 30)),
        Article(id=1, title="Q1 published", slug="q1-p", journal_id=1,
                status="published"),
        Article(id=2, title="Q2 draft", slug="q2-d", journal_id=2,
                status="draft", category="方案与思考"),
        Article(id=3, title="Loose draft", slug="loose", journal_id=None,
                status="draft"),
    ])
    db.commit()
    db.close()

    headers = {"Authorization": f"Bearer {create_access_token(sub='admin')}"}
    with TestClient(app) as test_client:
        yield test_client, headers, Session

    app.dependency_overrides.clear()


def test_filters_by_journal_and_serializes_title(client):
    c, headers, _ = client
    response = c.get("/api/admin/articles?journal_id=2", headers=headers)
    assert response.status_code == 200, response.text
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["Q2 draft"]
    assert response.json()["items"][0]["journal_title"] == "2026年第二期"


def test_unassigned_combines_with_status_alias(client):
    c, headers, _ = client
    response = c.get("/api/admin/articles?unassigned=true&status=draft",
                     headers=headers)
    assert response.status_code == 200, response.text
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["Loose draft"]


def test_journal_and_unassigned_are_mutually_exclusive(client):
    c, headers, _ = client
    response = c.get("/api/admin/articles?journal_id=2&unassigned=true",
                     headers=headers)
    assert response.status_code == 422, response.text
    body = response.json()
    code = body.get("error", {}).get("code") or body.get("detail", {}).get("code")
    assert code == "invalid_issue_filter"


def test_list_uses_project_pagination_shape(client):
    c, headers, _ = client
    response = c.get("/api/admin/articles", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body.keys()) == {"items", "total", "page", "per_page"}


def test_nonexistent_journal_id_returns_empty_page(client):
    c, headers, _ = client
    response = c.get("/api/admin/articles?journal_id=999", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_unassigned_excludes_assigned_articles(client):
    c, headers, _ = client
    response = c.get("/api/admin/articles?unassigned=true", headers=headers)
    assert response.status_code == 200, response.text
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["Loose draft"]
    assert response.json()["items"][0]["journal_id"] is None