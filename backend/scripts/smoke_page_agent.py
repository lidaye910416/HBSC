#!/usr/bin/env python3
"""End-to-end smoke test for the public page-agent (/api/public/agent/*).

Default mode (mocked LLM, hermetic):

    cd backend && python3 -m scripts.smoke_page_agent

Real-LLM mode (requires network + admin-set deepseek key):

    cd backend && ENV=development HUBEI_DEEPSEEK_KEY="<key>" \
        python3 -m scripts.smoke_page_agent --real

The script exercises:
- GET /api/public/agent/config shape (no api_key leak)
- POST /api/public/agent/execute happy path (mocked or real)
- 409 not_enabled / 409 no_api_key paths
- 429 on the 11th call within 60s (rate-limit)
- 422 on messages > 50
- 413 on body > 1 MB
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet
os.environ.setdefault("ADMIN_SETTINGS_SECRET", Fernet.generate_key().decode("ascii"))
os.environ.setdefault("ENV", "test")
os.environ.setdefault("SECRET_KEY", "smoke-agent-secret-" + uuid.uuid4().hex)
os.environ.setdefault("ADMIN_USERNAME", "smoke-agent-admin")

# Path setup
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.models.base import Base  # noqa: F401
from app.models.admin_setting import AdminSetting  # noqa: E402
from app.database import get_db  # noqa: E402
from app.services.crypto import encrypt_value  # noqa: E402

# Import the public-agent MODULE so we can patch chat_complete on it
# (the bound name, not the source module — same pattern as smoke_typeset).
# Note: `from app.routers import public_agent_router` resolves to the APIRouter
# (because __init__.py re-exports it as `public_agent_router`). We need the
# module, so we go through sys.modules directly.
public_agent_router = sys.modules["app.routers.public_agent_router"]  # noqa: E402


BANNER = "─" * 72


def banner(title: str) -> None:
    print(f"\n{BANNER}\n  {title}\n{BANNER}")


# ---------------------------------------------------------------------------
# Shared in-memory app + DB bootstrap
# ---------------------------------------------------------------------------

def _boot_app(deepseek_key: str = "mock-DEADBEEF-key"):
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
    from app.middleware import rate_limit as rl
    rl._buckets.clear()

    return app, Session


def _seed_page_agent(Session, *, enabled="true", api_key="mock-DEADBEEF-key"):
    s = Session()
    rows = [
        ("page_agent.enabled",       enabled,        False),
        ("page_agent.api_key",       api_key,        True),
        ("page_agent.model",         "deepseek-v4-flash", False),
        ("page_agent.base_url",      "https://api.deepseek.com/v1", False),
        ("page_agent.system_prompt", "你是湖北数创的小助手。",  False),
    ]
    for k, v, sec in rows:
        existing = s.query(AdminSetting).filter_by(key=k).first()
        if existing:
            existing.value_encrypted = encrypt_value(v)
            existing.is_secret = sec
        else:
            s.add(AdminSetting(key=k, value_encrypted=encrypt_value(v), is_secret=sec))
    s.commit()
    return Session


# ---------------------------------------------------------------------------
# MOCKED RUN — default, hermetic
# ---------------------------------------------------------------------------

def _run_mocked() -> int:
    banner("公共 page-agent — 端到端冒烟 (mock LLM)")

    _app, Session = _boot_app()
    _seed_page_agent(Session)

    async def fake_chat(**kwargs):
        user_msg = kwargs["messages"][-1]["content"]
        return f"echo: {user_msg}"

    with TestClient(_app) as c:
        # ---- 1. config ----
        banner("1. GET /api/public/agent/config")
        r = c.get("/api/public/agent/config")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["enabled"] is True
        assert body["model"] == "deepseek-v4-flash"
        assert body["base_url"] == "https://api.deepseek.com/v1"
        assert "api_key" not in body and "sk-" not in r.text
        print(f"   ✓ enabled={body['enabled']}  model={body['model']}")

        # ---- 2. execute happy path ----
        banner("2. POST /api/public/agent/execute (mocked chat)")
        with patch.object(public_agent_router, "chat_complete", new=AsyncMock(side_effect=fake_chat)):
            r = c.post(
                "/api/public/agent/execute",
                json={"messages": [{"role": "user", "content": "你好 AI"}]},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"content": "echo: 你好 AI"}
        print(f"   ✓ 收到 content: {body['content']!r}")

        # ---- 3. not_enabled ----
        banner("3. not_enabled → 409")
        _seed_page_agent(Session, enabled="false")
        r = c.post(
            "/api/public/agent/execute",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
        assert r.status_code == 409 and r.json()["error"]["code"] == "not_enabled", r.text
        print(f"   ✓ {r.status_code} {r.json()['error']['code']}")

        # Restore + try missing api_key
        banner("4. no_api_key → 409")
        _seed_page_agent(Session, enabled="true")
        s = Session()
        s.query(AdminSetting).filter_by(key="page_agent.api_key").delete()
        s.commit()
        r = c.post(
            "/api/public/agent/execute",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
        assert r.status_code == 409 and r.json()["error"]["code"] == "no_api_key", r.text
        print(f"   ✓ {r.status_code} {r.json()['error']['code']}")

        # Restore
        _seed_page_agent(Session, api_key="mock-DEADBEEF-key")

        # ---- 5. rate limit ----
        banner("5. 限流：11 次/min/IP → 第 11 次 429")
        # Reset the rate-limit bucket so prior sections (2-4) don't carry over.
        from app.middleware import rate_limit as rl
        rl._buckets.clear()
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
        print(f"   ✓ 前 10 次 200，第 11 次 429")

        # ---- 6. too many messages ----
        # Reset bucket — section 5 burned through it deliberately.
        rl._buckets.clear()
        banner("6. messages=60 → 422")
        r = c.post(
            "/api/public/agent/execute",
            json={"messages": [{"role": "user", "content": f"msg {i}"} for i in range(60)]},
        )
        assert r.status_code == 422
        print(f"   ✓ {r.status_code}")

        # ---- 7. payload too large ----
        # Reset bucket so 6 → 7 doesn't accidentally 429.
        rl._buckets.clear()
        banner("7. body > 1MB → 413/422")
        huge = "x" * (1_100_000)
        r = c.post(
            "/api/public/agent/execute",
            json={"messages": [{"role": "user", "content": huge}]},
        )
        assert r.status_code in (413, 422)
        print(f"   ✓ {r.status_code}")

        # ---- 8. upstream error doesn't leak key ----
        # Reset bucket so 7 → 8 doesn't accidentally 429.
        rl._buckets.clear()
        banner("8. 上游异常不泄露 api_key")
        async def boom(**kwargs):
            raise public_agent_router.LLMUnavailable(
                "Authorization: Bearer mock-DEADBEEF-key upstream 502"
            )
        with patch.object(public_agent_router, "chat_complete", new=AsyncMock(side_effect=boom)):
            r = c.post(
                "/api/public/agent/execute",
                json={"messages": [{"role": "user", "content": "hi"}]},
            )
        assert r.status_code == 502
        assert "mock-DEADBEEF-key" not in r.text
        assert r.json()["error"]["code"] == "upstream_llm_failed"
        print(f"   ✓ {r.status_code} {r.json()['error']['code']}, no key in body")

    banner("全部通过 ✅")
    return 0


# ---------------------------------------------------------------------------
# REAL RUN — requires network + HUBEI_DEEPSEEK_KEY
# ---------------------------------------------------------------------------

def _run_real() -> int:
    api_key = os.environ.get("HUBEI_DEEPSEEK_KEY")
    if not api_key:
        print("⛔  --real 需要 HUBEI_DEEPSEEK_KEY 环境变量", file=sys.stderr)
        return 2
    fingerprint = api_key[:4] + "***"
    banner(f"公共 page-agent — 真实 deepseek 冒烟 (api_key={fingerprint})")

    _app, Session = _boot_app()
    _seed_page_agent(Session, api_key=api_key)

    # Reset rate-limit so the real-mode test doesn't fight the test above.
    from app.middleware import rate_limit as rl
    rl._buckets.clear()

    with TestClient(_app) as c:
        banner("1. 真实调 deepseek — 发问并校验回答")
        t0 = time.time()
        r = c.post(
            "/api/public/agent/execute",
            json={"messages": [
                {"role": "user", "content": "用一句话介绍湖北数创。"},
            ]},
        )
        dt_ms = int((time.time() - t0) * 1000)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert isinstance(body["content"], str) and len(body["content"]) > 0
        print(f"   ✓ 200 OK in {dt_ms}ms")
        print(f"   content preview: {body['content'][:160].replace(chr(10), ' ')!r}")
        # CRITICAL: api_key must never appear in the response.
        assert api_key not in r.text

    banner(f"全部通过 ✅ 真实 deepseek 连通 ({fingerprint})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="公共 page-agent 冒烟测试")
    parser.add_argument("--real", action="store_true", help="调真 deepseek（需 ENV=development + HUBEI_DEEPSEEK_KEY）")
    args = parser.parse_args()
    if args.real:
        return _run_real()
    return _run_mocked()


if __name__ == "__main__":
    sys.exit(main())
