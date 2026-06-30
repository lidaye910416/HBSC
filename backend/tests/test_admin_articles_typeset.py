"""Integration tests for POST /api/admin/articles/typeset."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models.base import Base  # noqa: F401 — registers all model metadata
# Side-effect imports ensure every model is registered on Base.metadata.
from app.models import admin_setting as _admin_setting_model  # noqa: F401
from app.models.admin_setting import AdminSetting
from app.security import create_access_token
from app.services.crypto import encrypt_value
from app.services import markdown_typesetter
from app.services.llm_client import LLMUnavailable


@pytest.fixture()
def client():
    # StaticPool keeps a single shared connection so :memory: tables persist
    # across the request-time session and the seed-time session.
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
    token = create_access_token(sub="admin")
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as c:
        yield c, headers, Session

    app.dependency_overrides.clear()


def _seed(Session, **overrides):
    s = Session()
    rows = {
        "article_typesetter.enabled": ("true", False),
        "article_typesetter.api_key": ("sk-abc-1234567890", True),
        "article_typesetter.model": ("MiniMax-M3", False),
        "article_typesetter.base_url": ("https://api.minimax.chat/v1", False),
        "article_typesetter.system_prompt": ("system", False),
    }
    rows.update({k: v for k, v in overrides.items() if k in rows})
    for k, (v, secret) in rows.items():
        existing = s.query(AdminSetting).filter_by(key=k).first()
        if existing:
            existing.value_encrypted = encrypt_value(v)
            existing.is_secret = secret
        else:
            s.add(AdminSetting(key=k, value_encrypted=encrypt_value(v), is_secret=secret))
    s.commit()


def test_typeset_happy_path(client):
    c, headers, Session = client
    _seed(Session)

    async def fake_chat(**kwargs):
        return "# 标题\n\n清洗后正文。"

    with patch.object(markdown_typesetter, "chat_complete", new=AsyncMock(side_effect=fake_chat)):
        r = c.post(
            "/api/admin/articles/typeset",
            headers=headers,
            json={"content_markdown": "# 标题\n\n原文段落"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["content_markdown"] == "# 标题\n\n清洗后正文。"
    assert body["model"] == "MiniMax-M3"
    assert "prompt_version" in body and body["prompt_version"].isdigit()


def test_typeset_disabled_returns_409(client):
    c, headers, Session = client
    _seed(Session, **{"article_typesetter.enabled": ("false", False)})
    r = c.post(
        "/api/admin/articles/typeset",
        headers=headers,
        json={"content_markdown": "x"},
    )
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "not_enabled"


def test_typeset_missing_api_key_returns_409(client):
    c, headers, Session = client
    _seed(Session)  # ensure enabled=true (defensive against earlier tests)
    s = Session()
    s.query(AdminSetting).filter_by(key="article_typesetter.api_key").delete()
    s.commit()
    r = c.post(
        "/api/admin/articles/typeset",
        headers=headers,
        json={"content_markdown": "x"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "no_api_key"


def test_typeset_unauthenticated_returns_401(client):
    c, _, Session = client
    _seed(Session)
    r = c.post("/api/admin/articles/typeset", json={"content_markdown": "x"})
    assert r.status_code == 401


def test_typeset_upstream_failure_returns_502_and_no_key_leak(client):
    c, headers, Session = client
    _seed(Session)

    async def boom(**kwargs):
        raise LLMUnavailable("Bearer sk-abc-1234567890 upstream 502")

    with patch.object(markdown_typesetter, "chat_complete", new=AsyncMock(side_effect=boom)):
        r = c.post(
            "/api/admin/articles/typeset",
            headers=headers,
            json={"content_markdown": "x"},
        )
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "upstream_llm_failed"
    # CRITICAL: the api_key must not appear in the response body.
    assert "sk-abc-1234567890" not in r.text


def test_typeset_truncates_long_input(client):
    c, headers, Session = client
    _seed(Session)

    async def fake_chat(**kwargs):
        # Echo the last 50 chars of the user message back so we can prove truncation
        user_msg = kwargs["messages"][-1]["content"]
        return "末段：" + user_msg[-50:]

    with patch.object(markdown_typesetter, "chat_complete", new=AsyncMock(side_effect=fake_chat)):
        r = c.post(
            "/api/admin/articles/typeset",
            headers=headers,
            json={"content_markdown": "中" * 50_000},
        )
    assert r.status_code == 200
    body = r.json()
    assert any("截断" in w for w in body["warnings"])
    # 32k truncation should land the suffix inside the 32k window
    assert body["content_markdown"].startswith("末段：")


def test_typeset_missing_body_field_returns_422(client):
    c, headers, Session = client
    _seed(Session)
    r = c.post("/api/admin/articles/typeset", headers=headers, json={})
    assert r.status_code == 422
