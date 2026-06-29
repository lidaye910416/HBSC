import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from unittest.mock import patch, AsyncMock

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.security import hash_password, create_access_token
from app.config import settings


@pytest.fixture
def env(tmp_path, monkeypatch):
    test_db = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{test_db}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD_HASH", hash_password("pw"))
    yield {"client": TestClient(app)}
    app.dependency_overrides.clear()


def _auth():
    return {"Authorization": f"Bearer {create_access_token(sub='admin')}"}


def test_config_returns_disabled_when_no_settings(env):
    res = env["client"].get("/api/admin/agent/config", headers=_auth())
    assert res.status_code == 200
    body = res.json()
    # Defaults: enabled=False, model and base_url use the safe defaults
    assert body["enabled"] is False
    assert body["model"]  # non-empty default
    assert body["base_url"]  # non-empty default
    assert "api_key" not in body
    assert "apiKey" not in body


def test_config_reflects_settings(env):
    # Seed settings
    env["client"].put("/api/admin/settings/page_agent.enabled", headers=_auth(),
                      json={"value": "true", "description": "toggle"})
    env["client"].put("/api/admin/settings/page_agent.model", headers=_auth(),
                      json={"value": "MiniMax-M3", "description": "model"})
    env["client"].put("/api/admin/settings/page_agent.base_url", headers=_auth(),
                      json={"value": "https://api.example.com/v1", "description": "base"})

    res = env["client"].get("/api/admin/agent/config", headers=_auth())
    body = res.json()
    assert body["enabled"] is True
    assert body["model"] == "MiniMax-M3"
    assert body["base_url"] == "https://api.example.com/v1"
    # api_key must NOT appear
    assert "api_key" not in body
    assert "apiKey" not in body


def test_execute_requires_enabled(env):
    res = env["client"].post("/api/admin/agent/execute", headers=_auth(),
                              json={"messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 409


def test_execute_proxies_to_llm(env):
    # Enable + set key + base + model
    env["client"].put("/api/admin/settings/page_agent.enabled", headers=_auth(),
                      json={"value": "true"})
    env["client"].put("/api/admin/settings/page_agent.api_key", headers=_auth(),
                      json={"value": "sk-test"})
    env["client"].put("/api/admin/settings/page_agent.base_url", headers=_auth(),
                      json={"value": "https://example.com/v1"})
    env["client"].put("/api/admin/settings/page_agent.model", headers=_auth(),
                      json={"value": "m"})

    with patch("app.routers.agent_router.chat_complete", new=AsyncMock(return_value="hello back")):
        res = env["client"].post("/api/admin/agent/execute", headers=_auth(),
                                  json={"messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 200
    assert res.json() == {"content": "hello back"}


def test_settings_test_endpoint_pings_llm(env):
    env["client"].put("/api/admin/settings/page_agent.api_key", headers=_auth(),
                      json={"value": "sk-test"})
    env["client"].put("/api/admin/settings/page_agent.base_url", headers=_auth(),
                      json={"value": "https://example.com/v1"})
    env["client"].put("/api/admin/settings/page_agent.model", headers=_auth(),
                      json={"value": "m"})

    with patch("app.routers.agent_router.chat_complete", new=AsyncMock(return_value="pong")):
        res = env["client"].post("/api/admin/settings/page_agent.api_key/test", headers=_auth())
    assert res.status_code == 200
    assert res.json() == {"ok": True, "sample": "pong"}
