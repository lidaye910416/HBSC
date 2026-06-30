"""Integration tests for the public page-agent proxy at /api/public/agent/*.

No admin auth — these endpoints are intended for the public homepage FAB.
Covers:
- config endpoint shape (no api_key leak)
- execute happy path (mocked chat_complete)
- not_enabled / no_api_key 409 paths
- rate-limit 429 at the 11th call/minute/IP
- payload-too-large 413
- body validation 422 (over MAX messages)
- anti-leak: upstream error must never echo api_key
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models.base import Base  # noqa: F401
from app.models.admin_setting import AdminSetting
from app.services.crypto import encrypt_value
from app.routers import public_agent_router as _public_agent_router_obj  # noqa: F401  (APIRouter)
# The MODULE `app.routers.public_agent_router` is what tests need to patch
# (`chat_complete` is a bound name inside that module). Using
# `from app.routers import public_agent_router` resolves to the APIRouter
# because of __init__.py's `from ... import router as public_agent_router`,
# so we have to grab the module out of `sys.modules` explicitly.
import sys as _sys
public_agent_router = _sys.modules["app.routers.public_agent_router"]
from app.services import llm_client
from app.services.llm_client import LLMUnavailable


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    # Public endpoint is rate-limited per-IP; reset the global bucket.
    from app.middleware import rate_limit as rl
    rl._buckets.clear()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    with TestClient(app) as c:
        yield c, Session
    app.dependency_overrides.clear()


def _seed_enabled(Session, *, api_key="public-test-key-DEADBEEF"):
    s = Session()
    rows = [
        ("page_agent.enabled",       "true",                              False),
        ("page_agent.api_key",       api_key,                             True),
        ("page_agent.model",         "deepseek-v4-flash",                 False),
        ("page_agent.base_url",      "https://api.deepseek.com/v1",       False),
        ("page_agent.system_prompt", "你是湖北数创的小助手。",            False),
    ]
    for key, value, is_secret in rows:
        existing = s.query(AdminSetting).filter_by(key=key).first()
        if existing:
            existing.value_encrypted = encrypt_value(value)
            existing.is_secret = is_secret
        else:
            s.add(AdminSetting(key=key, value_encrypted=encrypt_value(value), is_secret=is_secret))
    s.commit()


def test_public_config_returns_enabled_shape(client):
    c, Session = client
    _seed_enabled(Session)
    r = c.get("/api/public/agent/config")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert body["model"] == "deepseek-v4-flash"
    assert body["base_url"] == "https://api.deepseek.com/v1"
    # CRITICAL: api_key must never appear in the public config payload.
    assert "api_key" not in body
    assert "sk-" not in r.text


def test_public_config_no_auth_required(client):
    """The public endpoint must work without any Authorization header."""
    c, Session = client
    _seed_enabled(Session)
    r = c.get("/api/public/agent/config")
    assert r.status_code == 200


def test_public_config_disabled_returns_false(client):
    c, _ = client
    r = c.get("/api/public/agent/config")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False
    # When disabled, model/base_url still surfaced so the admin can see config.
    assert body["model"] == "deepseek-v4-flash"


def test_execute_happy_path_returns_content(client):
    c, Session = client
    _seed_enabled(Session)

    async def fake_chat(**kwargs):
        # Echo user message back so we can assert it reaches upstream.
        return f"echo: {kwargs['messages'][-1]['content']}"

    with patch.object(public_agent_router, "chat_complete", new=AsyncMock(side_effect=fake_chat)):
        r = c.post(
            "/api/public/agent/execute",
            json={"messages": [{"role": "user", "content": "你好"}]},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"content": "echo: 你好"}


def test_execute_disabled_returns_409(client):
    c, Session = client
    # Seed enabled then flip to false.
    _seed_enabled(Session)
    s = Session()
    s.query(AdminSetting).filter_by(key="page_agent.enabled").first()
    row = s.query(AdminSetting).filter_by(key="page_agent.enabled").first()
    row.value_encrypted = encrypt_value("false")
    s.commit()

    r = c.post(
        "/api/public/agent/execute",
        json={"messages": [{"role": "user", "content": "hi"}]},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "not_enabled"


def test_execute_missing_api_key_returns_409(client):
    c, Session = client
    _seed_enabled(Session)
    s = Session()
    s.query(AdminSetting).filter_by(key="page_agent.api_key").delete()
    s.commit()
    r = c.post(
        "/api/public/agent/execute",
        json={"messages": [{"role": "user", "content": "hi"}]},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "no_api_key"


def test_execute_rate_limit_returns_429_on_eleventh_call(client):
    c, Session = client
    _seed_enabled(Session)

    async def fake_chat(**kwargs):
        return "ok"

    with patch.object(public_agent_router, "chat_complete", new=AsyncMock(side_effect=fake_chat)):
        codes = []
        for i in range(11):
            r = c.post(
                "/api/public/agent/execute",
                json={"messages": [{"role": "user", "content": f"hi {i}"}]},
            )
            codes.append(r.status_code)
        assert codes[:10] == [200] * 10, codes
        assert codes[10] == 429, codes


def test_execute_payload_too_large_returns_413(client):
    c, Session = client
    _seed_enabled(Session)
    huge = "x" * (1_100_000)  # ~1.1 MB > MAX_PUBLIC_AGENT_BYTES (1 MB)
    r = c.post(
        "/api/public/agent/execute",
        json={"messages": [{"role": "user", "content": huge}]},
    )
    assert r.status_code in (413, 422)  # FastAPI may 422 first depending on which check fires


def test_execute_too_many_messages_returns_422(client):
    c, Session = client
    _seed_enabled(Session)
    too_many = [{"role": "user", "content": f"msg {i}"} for i in range(60)]
    r = c.post("/api/public/agent/execute", json={"messages": too_many})
    assert r.status_code == 422


def test_execute_upstream_failure_does_not_leak_api_key(client):
    c, Session = client
    _seed_enabled(Session, api_key="public-leak-test-XXXXXXXX")

    async def boom(**kwargs):
        # Simulate httpx erroring with the Authorization header in the message,
        # which is exactly what httpx does on 4xx responses.
        raise llm_client.LLMUnavailable(
            "Authorization: Bearer public-leak-test-XXXXXXXX upstream 502"
        )

    with patch.object(public_agent_router, "chat_complete", new=AsyncMock(side_effect=boom)):
        r = c.post(
            "/api/public/agent/execute",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
    assert r.status_code == 502
    # CRITICAL: api_key must not appear in the response body.
    assert "public-leak-test-XXXXXXXX" not in r.text
    assert r.json()["error"]["code"] == "upstream_llm_failed"
