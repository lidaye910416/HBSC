import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.models.admin_setting import AdminSetting
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


def test_list_settings_requires_auth(env):
    res = env["client"].get("/api/admin/settings")
    assert res.status_code == 401


def test_list_settings_empty(env):
    res = env["client"].get("/api/admin/settings", headers=_auth())
    assert res.status_code == 200
    assert res.json() == {"items": []}


def test_update_setting_creates_and_lists(env):
    res = env["client"].put(
        "/api/admin/settings/page_agent.enabled",
        headers=_auth(),
        json={"value": "true", "description": "Toggle page-agent"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["key"] == "page_agent.enabled"
    assert body["value"] == "true"
    assert body["is_secret"] is False

    res = env["client"].get("/api/admin/settings", headers=_auth())
    assert res.status_code == 200
    assert len(res.json()["items"]) == 1


def test_secret_value_is_encrypted_at_rest_and_masked_on_read(env):
    # api_key suffix triggers secret treatment
    res = env["client"].put(
        "/api/admin/settings/page_agent.api_key",
        headers=_auth(),
        json={"value": "sk-cp-SECRET", "description": "LLM key"},
    )
    assert res.status_code == 200, res.text
    # Response should mask the secret and not return plain
    body = res.json()
    assert body["is_secret"] is True
    assert body["value"] is None
    assert body["masked"] is not None
    assert "SECRET" not in (body["masked"] or "")

    # Confirm at-rest ciphertext doesn't contain the plain text
    from app.models.admin_setting import AdminSetting
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    row = db.query(AdminSetting).filter_by(key="page_agent.api_key").first()
    assert "SECRET" not in row.value_encrypted


def test_setting_unknown_key_creates_new(env):
    """PUT is upsert by key — create if absent."""
    res = env["client"].put(
        "/api/admin/settings/custom.key",
        headers=_auth(),
        json={"value": "hello"},
    )
    assert res.status_code == 200
    assert res.json()["value"] == "hello"
