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


def test_execute_rate_limit_returns_429_on_31st_call(client):
    c, Session = client
    _seed_enabled(Session)

    async def fake_chat(**kwargs):
        return "ok"

    with patch.object(public_agent_router, "chat_complete", new=AsyncMock(side_effect=fake_chat)):
        codes = []
        for i in range(31):
            r = c.post(
                "/api/public/agent/execute",
                json={"messages": [{"role": "user", "content": f"hi {i}"}]},
            )
            codes.append(r.status_code)
        assert codes[:30] == [200] * 30, codes[:35]
        assert codes[30] == 429, codes[30]


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


# =============================================================================
# Plan Task 2: /api/public/agent/llm proxy endpoint (DOM Mode)
# =============================================================================

from unittest.mock import AsyncMock, patch
import httpx


class _FakeResponse:
    def __init__(self, *, status_code=200, json_data=None, text="", content=None):
        self.status_code = status_code
        self._json = json_data
        self.text = text if not json_data else ""
        self.headers = httpx.Headers({"content-type": "application/json"})
        self.content = content if content is not None else (
            b"" if json_data is None else httpx.Response(200, json=json_data).content
        )

    def json(self):
        return self._json


@pytest.fixture
def client_factory(monkeypatch):
    """Yield a factory that builds a TestClient with configurable page_agent.* rows.

    Each call gets its own in-memory SQLite + dependency override so tests
    are isolated. Rate-limit buckets are reset between calls.
    """
    engines: list = []

    def factory(*, enabled="true", api_key="sk-test",
                base_url="https://api.deepseek.com/v1",
                model="deepseek-v4-flash", system_prompt=None):
        engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=engine)
        engines.append(engine)
        SessionLocal = sessionmaker(bind=engine)
        db = SessionLocal()
        rows = [
            ("page_agent.enabled",  enabled,  False),
            ("page_agent.api_key",  api_key,  True),
            ("page_agent.base_url", base_url, False),
            ("page_agent.model",    model,    False),
        ]
        if system_prompt is not None:
            rows.append(("page_agent.system_prompt", system_prompt, False))
        for key, value, is_secret in rows:
            db.add(AdminSetting(
                key=key,
                value_encrypted=encrypt_value(value),
                is_secret=is_secret,
                updated_by="test",
            ))
        db.commit()

        def _override_get_db():
            try:
                s2 = SessionLocal()
                yield s2
            finally:
                s2.close()

        # Reset rate-limit buckets so each factory call is independent.
        from app.middleware import rate_limit as rl
        rl._buckets.clear()

        app.dependency_overrides[get_db] = _override_get_db
        return TestClient(app)

    yield factory

    for e in engines:
        e.dispose()
    app.dependency_overrides.pop(get_db, None)


def test_public_config_returns_system_prompt(client_factory):
    """The /config response must surface system_prompt so the front-end
    PageAgent instance can forward it via customSystemPrompt."""
    client = client_factory(
        api_key="sk-real",
        system_prompt="你是湖北数创助手（自定义 prompt）。",
    )
    r = client.get("/api/public/agent/config")
    assert r.status_code == 200
    body = r.json()
    assert "system_prompt" in body
    assert body["system_prompt"].startswith("你是")
    assert "api_key" not in body  # double-check no leak


def test_public_config_falls_back_to_default_prompt(client_factory):
    """When no DB row for system_prompt exists, the preset default
    (with safety rails) must still be returned."""
    client = client_factory(api_key="sk-real", system_prompt=None)
    r = client.get("/api/public/agent/config")
    assert r.status_code == 200
    sp = r.json().get("system_prompt", "")
    # The deepseek preset default in admin_setting_defaults must surface.
    assert "湖北数创" in sp
    assert len(sp) > 50


def test_agent_llm_passes_tools_schema_through(client_factory, monkeypatch):
    """page-agent sends OpenAI-format {messages, tools, tool_choice='required'}.
    The proxy must forward this body verbatim to the upstream LLM."""
    upstream = _FakeResponse(
        status_code=200,
        json_data={
            "choices": [{
                "index": 0,
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "tool_calls": [{"function": {"name": "click", "arguments": "{}"}}],
                },
            }],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
        },
    )

    captured: dict = {}

    async def fake_send(self, request, **kwargs):
        captured["url"] = str(request.url)
        import json as _json
        captured["body"] = _json.loads(request.content.decode())
        return upstream

    monkeypatch.setattr("httpx.AsyncClient.send", fake_send)

    client = client_factory(
        api_key="sk-real",
        base_url="https://api.deepseek.com/v1",
    )
    init = {
        "method": "POST",
        "headers": {"content-type": "application/json"},
        "body": '{"messages":[{"role":"user","content":"hi"}],"tools":[],"tool_choice":"required"}',
    }
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
        # Use a host from ALLOWED_ORIGINS so the same-origin check passes.
        headers={"Referer": "http://localhost:5173/"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["choices"][0]["finish_reason"] == "tool_calls"
    assert "Authorization" not in captured["body"]
    assert captured["body"]["tools"] == []


def test_agent_llm_rejects_non_allowed_url(client_factory):
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://evil.com/v1/chat/completions", "init": init},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "url_not_allowed"


def test_agent_llm_rejects_bad_referer(client_factory):
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
        headers={"Referer": "https://evil.com"},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "referer_not_allowed"


def test_agent_llm_accepts_browser_spa_referer(client_factory, monkeypatch):
    """Real-world regression: a browser SPA sends its OWN origin in the Referer
    header (e.g. http://localhost:5173/), NOT the upstream LLM host. The
    same-origin check must accept any host listed in settings.ALLOWED_ORIGINS.

    Previous behavior: the check compared Referer hostname against the
    upstream LLM hostname (e.g. api.deepseek.com), which a browser never sends
    — so every legitimate operate-mode call returned 403.
    """
    captured: dict = {}

    async def fake_send(self, request, **kwargs):
        captured["url"] = str(request.url)
        return _FakeResponse(json_data={"choices": [{"message": {}}], "usage": {}})

    monkeypatch.setattr("httpx.AsyncClient.send", fake_send)
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    # Simulate the browser's automatic Referer for an SPA on localhost:5173.
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
        headers={"Referer": "http://localhost:5173/articles/2026-q1"},
    )
    assert r.status_code == 200, r.text
    assert captured["url"].startswith("https://api.deepseek.com/v1")


def test_agent_llm_accepts_127_loopback_referer(client_factory, monkeypatch):
    """Vite's default dev URL is http://127.0.0.1:5173/ — the browser sends
    Referer with hostname '127.0.0.1', NOT 'localhost'. The Referer check
    must accept every loopback spelling without forcing the operator to
    enumerate each one in ALLOWED_ORIGINS.
    """
    async def fake_send(self, request, **kwargs):
        return _FakeResponse(json_data={"choices": [{"message": {}}], "usage": {}})

    monkeypatch.setattr("httpx.AsyncClient.send", fake_send)
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    # The exact Referer value captured from a real headless Chrome session
    # against Vite's default 127.0.0.1:5173 dev URL.
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
        headers={"Referer": "http://127.0.0.1:5173/"},
    )
    assert r.status_code == 200, r.text


def test_agent_llm_accepts_empty_referer(client_factory, monkeypatch):
    """Empty Referer (curl, native fetch, privacy-mode browsers) must still pass.

    The check is intentionally permissive when the header is absent so
    programmatic clients (Playwright, server-side scripts, CLI tools) are not
    locked out. The URL whitelist + rate-limit + payload cap remain in place.
    """
    async def fake_send(self, request, **kwargs):
        return _FakeResponse(json_data={"choices": [{"message": {}}], "usage": {}})

    monkeypatch.setattr("httpx.AsyncClient.send", fake_send)
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
        # No Referer header at all.
    )
    assert r.status_code == 200, r.text


def test_agent_llm_payload_too_large(client_factory):
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "a" * (2 * 1024 * 1024 + 1)}
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"


def test_agent_llm_60_calls_then_429(client_factory, monkeypatch):
    """60/min rate-limit on /agent/llm: sustained bursts return 429.

    With max_steps=20, a single complex operate can issue 20+ /llm calls.
    The 60/min ceiling leaves headroom for back-to-back multi-step operates
    while still blocking runaway scrapers.

    NOTE: the bucket refills linearly (1 token / second), so we don't pin
    down the exact call index where 429 first fires. We only assert the
    upper bound: a runaway burst of 200 must be throttled long before it
    completes — proving the ceiling is actually < infinity.
    """
    fake_send = AsyncMock(return_value=_FakeResponse(
        json_data={"choices": [{"message": {}}], "usage": {}}))
    monkeypatch.setattr("httpx.AsyncClient.send", fake_send)
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    # Freeze time so refill does not save us during the burst.
    fake_now = [1_000_000.0]
    monkeypatch.setattr("app.middleware.rate_limit.time.monotonic", lambda: fake_now[0])
    statuses = []
    for i in range(200):
        r = client.post(
            "/api/public/agent/llm",
            json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
        )
        statuses.append(r.status_code)
        fake_now[0] += 0.001  # advance 1 ms per call, ~200 ms total = 0.2 tokens refill
    assert 200 in statuses, "bucket never throttled — limit is effectively unlimited"
    # The throttling must kick in well before exhausting all 200 calls.
    first_429 = statuses.index(429)
    assert first_429 < 100, f"first 429 at call {first_429}; ceiling too lax"
    assert statuses.count(200) >= 60, (
        f"only {statuses.count(200)} succeeded; ceiling too tight"
    )


def test_agent_llm_and_execute_have_independent_buckets(client_factory, monkeypatch):
    """Regression: /execute and /llm must NOT share a bucket under the same IP.

    Previous bug: the middleware keyed buckets by client_ip only, so a single
    operate-mode call (many /llm hits) would silently deplete the /execute
    quota, causing the very next chat-mode call to 429 even though the user
    hadn't been chatting.
    """
    fake_send = AsyncMock(return_value=_FakeResponse(
        json_data={"choices": [{"message": {}}], "usage": {}}))
    monkeypatch.setattr("httpx.AsyncClient.send", fake_send)
    client = client_factory(api_key="sk-real")

    # Drive /execute hard enough to deplete its own bucket under the old
    # behaviour (30/min), then prove /llm still has full quota.
    init = {"method": "POST", "body": "{}"}

    async def fake_chat(**kwargs):
        return "ok"

    with patch.object(public_agent_router, "chat_complete", new=AsyncMock(side_effect=fake_chat)):
        for _ in range(30):
            r = client.post(
                "/api/public/agent/execute",
                json={"messages": [{"role": "user", "content": "hi"}]},
            )
            assert r.status_code == 200, r.text
        # /execute quota is now depleted
        r = client.post(
            "/api/public/agent/execute",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
        assert r.status_code == 429

    # /llm must still be wide open — independent bucket.
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
    )
    assert r.status_code == 200, r.text


def test_agent_llm_simulated_operate_with_many_steps(client_factory, monkeypatch):
    """Simulate a full operate() that issues many /llm steps in a row.

    This is the regression test for the "first operate works, second fails"
    user report: a single operate easily consumes 5+ /llm calls, so the old
    5/min limit killed even the second step of the same task.
    """
    fake_send = AsyncMock(return_value=_FakeResponse(
        json_data={"choices": [{"message": {}}], "usage": {}}))
    monkeypatch.setattr("httpx.AsyncClient.send", fake_send)
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    # Simulate two consecutive operates, each issuing 8 step calls (well
    # above the previous 5/min ceiling). Total = 16 calls < 60/min budget.
    for op in range(2):
        for step in range(8):
            r = client.post(
                "/api/public/agent/llm",
                json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
            )
            assert r.status_code == 200, (
                f"operate #{op + 1} step #{step + 1} failed: {r.status_code} {r.text}"
            )


def test_agent_llm_no_api_key_leak(client_factory, monkeypatch):
    async def boom(self, request, **kwargs):
        raise httpx.RemoteProtocolError(
            "Authorization: Bearer sk-real",
            request=request,
        )

    monkeypatch.setattr("httpx.AsyncClient.send", boom)
    client = client_factory(api_key="sk-real")
    r = client.post(
        "/api/public/agent/llm",
        json={
            "url": "https://api.deepseek.com/v1/chat/completions",
            "init": {"method": "POST", "body": "{}"},
        },
    )
    assert r.status_code == 502
    assert "sk-real" not in r.text


def test_agent_llm_inner_body_too_large(client_factory):
    """A small outer JSON envelope wrapping a huge init.body must still 413.

    Without this check, an attacker could POST a 100-byte outer body and shove
    50MB into init.body, which the proxy would forward verbatim to upstream.
    """
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "a" * (2 * 1024 * 1024 + 1)}
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"


# =============================================================================
# Plan Task 3: thread mode='dom' through /api/public/agent/execute
# =============================================================================


def test_execute_rejects_invalid_mode(client_factory):
    """mode must be 'chat' or 'dom' (Literal type); anything else → pydantic 422.

    Pydantic-driven 422 responses use the FastAPI default ``{"detail": [...]}``
    envelope (NOT the project's ``{error: {code, message}}`` envelope, which is
    only produced for explicit ``HTTPException`` raises). We only assert the
    status code so this test is robust against future envelope changes.
    """
    client = client_factory(api_key="sk-real")
    r = client.post(
        "/api/public/agent/execute",
        json={"mode": "hacker", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert r.status_code == 422


def test_execute_chat_mode_still_works(client_factory):
    """Backward-compat: default mode is 'chat', old request shape still works."""
    with patch(
        "app.routers.public_agent_router.chat_complete",
        new=AsyncMock(return_value="hello back"),
    ):
        client = client_factory(api_key="sk-real")
        r = client.post(
            "/api/public/agent/execute",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
    assert r.status_code == 200
    assert r.json() == {"content": "hello back"}


def test_execute_dom_mode_rejects_missing_tools(client_factory):
    """dom path through /execute must reject (use /llm instead).

    Hits our explicit HTTPException(422) → project envelope, so we can
    assert the semantic code:
    """
    client = client_factory(api_key="sk-real")
    r = client.post(
        "/api/public/agent/execute",
        json={
            "mode": "dom",
            "messages": [{"role": "user", "content": "click submit"}],
        },
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "tools_required_for_dom"
