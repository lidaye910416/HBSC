"""AI 图像生成服务 + /api/admin/media/generate 端点测试。"""
import io
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.security import hash_password, create_access_token
from app.config import settings
from app.services import image_gen


# ----- 通用 fixtures -----

@pytest.fixture
def env(tmp_path, monkeypatch):
    test_db = tmp_path / "test.db"
    uploads = tmp_path / "uploads"
    uploads.mkdir()

    engine = create_engine(
        f"sqlite:///{test_db}", connect_args={"check_same_thread": False}
    )
    TestingSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=engine
    )
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
    # 默认无 token：测试占位图模式
    monkeypatch.setattr(settings, "MINIMAX_TOKEN", None)
    return {"client": TestClient(app), "uploads": uploads}


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _token():
    return create_access_token(sub="admin")


def _png_bytes(color="blue", size=(100, 100)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ----- image_gen service -----

@pytest.mark.asyncio
async def test_generate_image_placeholder(tmp_path, monkeypatch):
    """无 MINIMAX_TOKEN → 走 PIL 占位图分支。"""
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "MINIMAX_TOKEN", None)

    info = await image_gen.generate_image("hello world placeholder", aspect_ratio="1:1")

    assert info["url"].startswith("/uploads/")
    assert info["filename"].endswith(".png")
    assert info["mime"] == "image/png"
    assert info["prompt"] == "hello world placeholder"
    assert info["status"] == "placeholder"
    assert info["size"] > 0

    # 文件确实落盘
    rel = info["url"].lstrip("/uploads/")
    full = Path(settings.UPLOAD_DIR) / rel
    assert full.exists()

    # 占位图是合法 PNG
    with Image.open(full) as img:
        assert img.size == (1024, 1024)


@pytest.mark.asyncio
async def test_generate_image_via_api(tmp_path, monkeypatch):
    """设置 MINIMAX_TOKEN + mock httpx → 调用真实 API 分支。"""
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "MINIMAX_TOKEN", "fake-token")
    monkeypatch.setattr(settings, "MINIMAX_API_URL", "https://example.com/img")
    monkeypatch.setattr(settings, "MINIMAX_MODEL", "image-01")

    # 构造一个假 API 响应：返回 b64_json
    import base64
    fake_png = _png_bytes(color="red", size=(64, 36))
    payload_bytes = base64.b64encode(fake_png).decode("ascii")

    fake_response = AsyncMock()
    fake_response.status_code = 200
    # AsyncMock 的所有属性默认也是 AsyncMock；
    # 但 resp.json() / resp.text 是同步访问，必须用普通 Mock 的语义。
    fake_response.json = lambda: {"b64_json": payload_bytes}
    fake_response.text = ""

    fake_client = AsyncMock()
    fake_client.__aenter__.return_value = fake_client
    fake_client.__aexit__.return_value = None
    fake_client.post.return_value = fake_response

    with patch("app.services.image_gen.httpx.AsyncClient", return_value=fake_client):
        info = await image_gen.generate_image("a red 16:9 cover", aspect_ratio="16:9")

    assert info["status"] == "generated"
    assert info["model"] == "image-01"
    assert info["mime"] == "image/png"

    # 校验 httpx 收到正确参数
    args, kwargs = fake_client.post.call_args
    assert args[0] == "https://example.com/img"
    assert kwargs["json"]["model"] == "image-01"
    assert kwargs["json"]["prompt"] == "a red 16:9 cover"
    assert kwargs["headers"]["Authorization"] == "Bearer fake-token"

    # 落盘文件确实是红色 64x36
    rel = info["url"].lstrip("/uploads/")
    full = Path(settings.UPLOAD_DIR) / rel
    with Image.open(full) as img:
        assert img.size == (64, 36)


# ----- admin endpoint -----

def test_admin_media_generate_endpoint(env):
    """POST /api/admin/media/generate 返回 url + prompt。"""
    res = env["client"].post(
        "/api/admin/media/generate",
        headers=_auth(_token()),
        json={"prompt": "未来城市天际线", "aspect_ratio": "16:9"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["url"].startswith("/uploads/")
    assert data["prompt"] == "未来城市天际线"
    assert data["aspect_ratio"] == "16:9"
    assert data["model"] == settings.MINIMAX_MODEL
    assert data["status"] in {"placeholder", "generated"}
    assert "id" in data
    assert data["mime"] == "image/png"

    # 文件确实落盘
    rel = data["url"].lstrip("/uploads/")
    assert (env["uploads"] / rel).exists()


def test_admin_media_generate_requires_auth(env):
    res = env["client"].post(
        "/api/admin/media/generate",
        json={"prompt": "x", "aspect_ratio": "1:1"},
    )
    assert res.status_code == 401


def test_admin_media_generate_validates_prompt(env):
    res = env["client"].post(
        "/api/admin/media/generate",
        headers=_auth(_token()),
        json={"prompt": "", "aspect_ratio": "16:9"},
    )
    assert res.status_code == 422  # Pydantic 校验


def test_admin_media_generate_validates_aspect(env):
    res = env["client"].post(
        "/api/admin/media/generate",
        headers=_auth(_token()),
        json={"prompt": "valid prompt", "aspect_ratio": "21:9"},
    )
    assert res.status_code == 422
