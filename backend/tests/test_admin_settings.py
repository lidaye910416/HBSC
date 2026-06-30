"""Tests for the /api/admin/settings/{key:path}/test connectivity probe.

The probe originally lived on `agent_router`; Plan Task 4 moved it to
`settings_router` so that the URL (``/api/admin/settings/{key}/test``) is
served from the same router as the rest of the admin-settings UI.

These tests pin the migrated behavior:
- An unknown ``key`` returns 400 ``bad_request``.
- ``page_agent.api_key`` triggers an LLM ping.
- ``article_typesetter.api_key`` triggers an LLM ping.

The probe uses the same ``chat_complete`` bound name the rest of the app
uses (``app.routers.settings_router.chat_complete``), so patching it here
prevents real network I/O.
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
from app.security import create_access_token
from app.services.crypto import encrypt_value


@pytest.fixture()
def admin_client_factory():
    """Return a factory that builds an authenticated TestClient + DB session.

    Behavior modeled on `test_admin_settings_synthesis.client` and
    `test_admin_articles_typeset.client`: an in-memory SQLite database with a
    StaticPool, the ``get_db`` dependency overridden, and rate-limit buckets
    cleared so test order doesn't matter.

    The returned factory accepts a ``prefix`` keyword so a single fixture
    can seed either the ``page_agent.*`` or ``article_typesetter.*`` namespace.
    A pre-encrypted ``api_key`` row is created so the probe has something
    to decrypt.
    """
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

    def _make(*, api_key: str | None = "sk-test-key", prefix: str = "page_agent"):
        s = Session()
        if api_key is not None:
            key_name = f"{prefix}.api_key"
            s.add(
                AdminSetting(
                    key=key_name,
                    value_encrypted=encrypt_value(api_key),
                    is_secret=True,
                )
            )
            s.commit()
        s.close()
        return TestClient(app), headers

    yield _make
    app.dependency_overrides.clear()


def test_settings_test_endpoint_rejects_unknown_key(admin_client_factory):
    client, headers = admin_client_factory()
    r = client.post("/api/admin/settings/foobar.api_key/test", headers=headers)
    assert r.status_code == 400
    body = r.json()
    assert body["error"]["code"] == "bad_request"


def test_settings_test_endpoint_runs_for_page_agent(admin_client_factory):
    with patch(
        "app.routers.settings_router.chat_complete",
        new=AsyncMock(return_value="pong"),
    ):
        client, headers = admin_client_factory(api_key="sk-test", prefix="page_agent")
        r = client.post(
            "/api/admin/settings/page_agent.api_key/test", headers=headers
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "sample": "pong"}


def test_settings_test_endpoint_runs_for_article_typesetter(admin_client_factory):
    with patch(
        "app.routers.settings_router.chat_complete",
        new=AsyncMock(return_value="pong"),
    ):
        client, headers = admin_client_factory(
            api_key="sk-test", prefix="article_typesetter"
        )
        r = client.post(
            "/api/admin/settings/article_typesetter.api_key/test", headers=headers
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "sample": "pong"}