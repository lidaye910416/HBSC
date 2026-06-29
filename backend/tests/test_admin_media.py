import io
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from PIL import Image
import pytest

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.security import hash_password, create_access_token
from app.config import settings


@pytest.fixture
def env(tmp_path, monkeypatch):
    test_db = tmp_path / "test.db"
    uploads = tmp_path / "uploads"
    uploads.mkdir()

    engine = create_engine(f"sqlite:///{test_db}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    # 重要：使用 Base（包含 ArticleImage）创建所有表
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
    return {
        "client": TestClient(app),
        "uploads": uploads,
        "SessionLocal": TestingSessionLocal,
    }


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _token():
    return create_access_token(sub="admin")


def _png_bytes():
    img = Image.new("RGB", (100, 100), "blue")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_upload_png_success(env):
    res = env["client"].post(
        "/api/admin/media",
        headers=_auth(_token()),
        files={"file": ("hello.png", _png_bytes(), "image/png")},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["url"].startswith("/uploads/")
    assert data["mime"] == "image/png"
    # 文件确实写入磁盘
    rel = data["url"].lstrip("/uploads/")
    assert (env["uploads"] / rel).exists()


def test_upload_requires_auth(env):
    res = env["client"].post(
        "/api/admin/media",
        files={"file": ("x.png", _png_bytes(), "image/png")},
    )
    assert res.status_code == 401


def test_upload_rejects_non_image(env):
    res = env["client"].post(
        "/api/admin/media",
        headers=_auth(_token()),
        files={"file": ("evil.exe", b"MZ\x90\x00", "application/octet-stream")},
    )
    assert res.status_code == 400  # ValueError → 400


def test_list_media(env):
    env["client"].post("/api/admin/media", headers=_auth(_token()),
                       files={"file": ("a.png", _png_bytes(), "image/png")})
    env["client"].post("/api/admin/media", headers=_auth(_token()),
                       files={"file": ("b.png", _png_bytes(), "image/png")})
    res = env["client"].get("/api/admin/media", headers=_auth(_token()))
    assert res.status_code == 200
    assert res.json()["total"] == 2


def test_delete_media(env):
    res = env["client"].post("/api/admin/media", headers=_auth(_token()),
                             files={"file": ("a.png", _png_bytes(), "image/png")})
    mid = res.json()["id"]
    res = env["client"].delete(f"/api/admin/media/{mid}", headers=_auth(_token()))
    assert res.status_code == 200


def test_upload_csv_kind_table(env):
    """kind=table branch must not NameError on uuid/Path imports."""
    csv_bytes = b"col1,col2\nrow1,row2\n"
    res = env["client"].post(
        "/api/admin/media?kind=table",
        headers=_auth(_token()),
        files={"file": ("table.csv", csv_bytes, "text/csv")},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["kind"] == "table"
    assert body["filename"].endswith(".csv")
    assert body["mime"] == "text/csv"
    # File should be on disk
    rel = body["url"].lstrip("/uploads/")
    assert (env["uploads"] / rel).exists()


def test_delete_media_path_traversal(env):
    """If the DB has been tampered with filename containing '..', the
    endpoint must refuse to touch a path outside UPLOAD_DIR."""
    import uuid
    from app.models.article_image import ArticleImage
    from datetime import datetime
    SessionLocal = env["SessionLocal"]
    db = SessionLocal()
    evil_name = f"../../etc/passwd-{uuid.uuid4().hex[:8]}"
    rec = ArticleImage(
        filename=evil_name,
        original_name="passwd",
        mime="text/plain",
        size=10,
        uploaded_by="admin",
        uploaded_at=datetime.utcnow(),
    )
    db.add(rec)
    db.commit()
    mid = rec.id
    db.close()

    res = env["client"].delete(f"/api/admin/media/{mid}", headers=_auth(_token()))
    assert res.status_code == 400, res.text
    # Row still exists
    db2 = SessionLocal()
    still = db2.query(ArticleImage).filter_by(id=mid).first()
    assert still is not None
    db2.close()
