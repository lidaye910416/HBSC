import io
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from PIL import Image
import pytest

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.models.journal import Article
from app.security import hash_password, create_access_token
from app.config import settings


@pytest.fixture
def env(tmp_path, monkeypatch):
    test_db = tmp_path / "test.db"
    uploads = tmp_path / "uploads"
    uploads.mkdir()

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
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(uploads))
    monkeypatch.setattr(settings, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD_HASH", hash_password("pw"))

    db = TestingSessionLocal()
    db.add(Article(title="Existing", slug="existing", content="old", status="published", published_at=datetime(2026, 1, 1)))
    db.commit()
    db.close()

    return {"client": TestClient(app), "db_path": str(test_db), "uploads": uploads}


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _token():
    return create_access_token(sub="admin")


def _png_bytes():
    img = Image.new("RGB", (10, 10), "red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_list_requires_auth(env):
    res = env["client"].get("/api/admin/articles")
    assert res.status_code == 401


def test_list_returns_paginated(env):
    res = env["client"].get("/api/admin/articles", headers=_auth(_token()))
    assert res.status_code == 200
    data = res.json()
    assert "items" in data and data["total"] >= 1


def test_create_article(env):
    res = env["client"].post(
        "/api/admin/articles",
        headers=_auth(_token()),
        json={"title": "New", "slug": "new-article", "content": "# hi", "status": "draft"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["slug"] == "new-article"
    assert data["status"] == "draft"


def test_create_article_slug_conflict_409(env):
    res = env["client"].post(
        "/api/admin/articles",
        headers=_auth(_token()),
        json={"title": "Dup", "slug": "existing"},
    )
    assert res.status_code == 409


def test_update_article_status(env):
    # 找到 existing 的 id
    res = env["client"].get("/api/admin/articles", headers=_auth(_token()))
    existing_id = next(a["id"] for a in res.json()["items"] if a["slug"] == "existing")

    res = env["client"].put(
        f"/api/admin/articles/{existing_id}",
        headers=_auth(_token()),
        json={"status": "draft"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "draft"


def test_publish_endpoint(env):
    res = env["client"].get("/api/admin/articles", headers=_auth(_token()))
    aid = next(a["id"] for a in res.json()["items"] if a["slug"] == "existing")

    res = env["client"].post(f"/api/admin/articles/{aid}/publish", headers=_auth(_token()))
    assert res.status_code == 200
    assert res.json()["status"] == "published"


def test_delete_article(env):
    res = env["client"].get("/api/admin/articles", headers=_auth(_token()))
    aid = next(a["id"] for a in res.json()["items"] if a["slug"] == "existing")

    res = env["client"].delete(f"/api/admin/articles/{aid}", headers=_auth(_token()))
    assert res.status_code == 200

    res = env["client"].get("/api/admin/articles", headers=_auth(_token()))
    assert all(a["slug"] != "existing" for a in res.json()["items"])