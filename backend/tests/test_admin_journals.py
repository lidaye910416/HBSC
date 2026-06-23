from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.models.journal import Journal
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
    db = TestingSessionLocal()
    db.add(Journal(title="Existing", slug="2026-q1", issue_number="2026-Q1"))
    db.commit()
    db.close()
    return {"client": TestClient(app)}


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _token():
    return create_access_token(sub="admin")


def test_list_journals(env):
    res = env["client"].get("/api/admin/journals", headers=_auth(_token()))
    assert res.status_code == 200
    assert res.json()["total"] >= 1


def test_create_journal(env):
    res = env["client"].post(
        "/api/admin/journals",
        headers=_auth(_token()),
        json={"title": "Q2", "slug": "2026-q2", "issue_number": "2026-Q2"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["slug"] == "2026-q2"


def test_create_journal_slug_conflict_409(env):
    res = env["client"].post(
        "/api/admin/journals",
        headers=_auth(_token()),
        json={"title": "Dup", "slug": "2026-q1"},
    )
    assert res.status_code == 409


def test_update_journal(env):
    res = env["client"].get("/api/admin/journals", headers=_auth(_token()))
    jid = res.json()["items"][0]["id"]
    res = env["client"].put(
        f"/api/admin/journals/{jid}",
        headers=_auth(_token()),
        json={"title": "Updated Title"},
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Updated Title"


def test_delete_journal(env):
    res = env["client"].get("/api/admin/journals", headers=_auth(_token()))
    jid = next(j["id"] for j in res.json()["items"] if j["slug"] == "2026-q1")
    res = env["client"].delete(f"/api/admin/journals/{jid}", headers=_auth(_token()))
    assert res.status_code == 200
