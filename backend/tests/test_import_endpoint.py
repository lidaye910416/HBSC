import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

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
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))

    yield {"client": TestClient(app), "tmp": tmp_path}
    app.dependency_overrides.clear()


def _auth():
    return {"Authorization": f"Bearer {create_access_token(sub='admin')}"}


def _tiny_docx(tmp_path) -> bytes:
    """Build a real .docx via pandoc if available; else skip."""
    if shutil.which("pandoc") is None:
        pytest.skip("pandoc not installed")
    md = tmp_path / "src.md"
    md.write_text("# Hello Title\n\nFirst paragraph.\n", encoding="utf-8")
    out = tmp_path / "in.docx"
    subprocess.run(["pandoc", str(md), "-o", str(out)], check=True)
    return out.read_bytes()


def test_import_docx_happy_path(env):
    data = _tiny_docx(env["tmp"])
    res = env["client"].post(
        "/api/admin/articles/import-docx",
        headers=_auth(),
        files={"file": ("hello.docx", data, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["title"] == "Hello Title"
    assert "First paragraph" in body["content_markdown"]
    assert body["suggested_slug"].startswith("hello")


def test_import_docx_rejects_non_docx(env):
    res = env["client"].post(
        "/api/admin/articles/import-docx",
        headers=_auth(),
        files={"file": ("not.txt", b"plain text", "text/plain")},
    )
    assert res.status_code in (400, 415, 422)


def test_import_docx_requires_auth(env):
    data = _tiny_docx(env["tmp"]) if shutil.which("pandoc") else b""
    if not data:
        pytest.skip("pandoc not installed")
    res = env["client"].post(
        "/api/admin/articles/import-docx",
        files={"file": ("hello.docx", data, "application/octet-stream")},
    )
    assert res.status_code == 401
