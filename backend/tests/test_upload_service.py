import io
from pathlib import Path
import pytest
from PIL import Image

from app.upload_service import save_upload, ALLOWED_MIMES
from app.config import settings


@pytest.fixture
def tmp_uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))
    return tmp_path / "uploads"


def _make_png_bytes() -> bytes:
    img = Image.new("RGB", (10, 10), color="red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_save_upload_writes_file_and_returns_url(tmp_uploads):
    data = _make_png_bytes()
    info = save_upload(filename="test.png", content=data, uploaded_by="admin")
    assert info["url"].startswith("/uploads/")
    full_path = tmp_uploads / info["url"].lstrip("/uploads/").lstrip("/")
    assert full_path.exists()
    assert full_path.read_bytes() == data


def test_save_upload_rejects_bad_mime(tmp_uploads):
    with pytest.raises(ValueError, match="不支持的文件类型"):
        save_upload(filename="evil.exe", content=b"MZ", uploaded_by="admin")


def test_save_upload_rejects_too_large(tmp_uploads, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_MAX_SIZE_MB", 0)  # 0 MB 上限
    data = _make_png_bytes()
    with pytest.raises(ValueError, match="超过"):
        save_upload(filename="big.png", content=data, uploaded_by="admin")


def test_save_upload_filename_is_uuid(tmp_uploads):
    data = _make_png_bytes()
    info = save_upload(filename="../../../etc/passwd.png", content=data, uploaded_by="admin")
    # 路径中不应出现 .. 或 用户原始名
    assert ".." not in info["url"]
    assert "passwd" not in info["url"]
