"""Tests for the synthesized-default behavior in settings_router.list_settings."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models.base import Base  # noqa: F401
from app.models.admin_setting import AdminSetting
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


def test_list_synthesizes_defaults_when_db_empty(client):
    c, headers, _ = client
    r = c.get("/api/admin/settings", headers=headers)
    assert r.status_code == 200
    items = r.json()["items"]
    keys = {it["key"] for it in items}
    # Every article_typesetter key must be present even with no DB rows.
    assert {
        "article_typesetter.enabled",
        "article_typesetter.model",
        "article_typesetter.base_url",
        "article_typesetter.api_key",
        "article_typesetter.system_prompt",
    } <= keys

    by_key = {it["key"]: it for it in items}

    # Synthesized non-secret rows should expose the default as `value` AND
    # `default_value` (the UI fills both).
    model = by_key["article_typesetter.model"]
    assert model["value"] == "MiniMax-M3"
    assert model["default_value"] == "MiniMax-M3"
    assert model["is_secret"] is False
    assert model["updated_at"] is None  # synth = not yet saved

    base_url = by_key["article_typesetter.base_url"]
    assert base_url["value"] == "https://api.minimax.chat/v1"

    enabled = by_key["article_typesetter.enabled"]
    assert enabled["value"] == "true"

    # Synthesized secret row: NEVER expose the default in `value`; admin
    # must enter their own.
    api_key = by_key["article_typesetter.api_key"]
    assert api_key["is_secret"] is True
    assert api_key["value"] is None
    assert api_key["default_value"] is None

    # system_prompt default truncated to ~80 chars in `default_value` but the
    # backend should ship the full text via... actually no — the form field
    # receives it via `value`, which is the full default.
    sysprompt = by_key["article_typesetter.system_prompt"]
    assert sysprompt["value"].startswith("你是一名中文科技期刊")


def test_list_returns_db_value_when_present(client):
    c, headers, Session = client
    s = Session()
    s.add(AdminSetting(key="article_typesetter.model", value_encrypted="placeholder"))
    s.commit()
    r = c.get("/api/admin/settings", headers=headers)
    rows = {it["key"]: it for it in r.json()["items"]}
    assert rows["article_typesetter.model"]["updated_at"] is not None
