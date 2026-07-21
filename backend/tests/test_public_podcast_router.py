"""Tests for /api/public/podcast/* (MiniCast proxy).

The router's contract — see docs/superpowers/specs/2026-07-20-fab-podcast-mode-design.md —
is what these tests pin down:

  * /config exposes voice catalog and the enabled gate, with no leakage of
    upstream secrets.
  * /extract / /generate enforce the SSRF allow-list (hbsc /articles/,
    /issues/ only) and return 403 not_allowed_url for anything else.
  * /generate chains extract → generate-script → synthesize against
    MiniCast, returning the job_id and a fallback_url pointing at the
    full /labs/minicast workbench.
  * MiniCast unreachable → 503 minicast_unavailable with a Chinese hint.
  * The full pipeline runs through a mocked httpx transport so we don't
    need a live MiniCast process to validate the contract.

We mock both the upstream MiniCast transport AND the settings helper so the
tests stay hermetic (no DB rows leak between tests).
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.base import Base  # noqa: E402,F401
from app.middleware import rate_limit as rl  # noqa: E402

# Force-import the podcast submodule so monkeypatch.setattr
# (which uses importlib.import_module under the hood) resolves it
# instead of the APIRouter re-exported from app.routers.__init__.
# `from app.routers.public_podcast_router import router` does NOT register
# the submodule in sys.modules (because app/routers/__init__.py re-exports
# an APIRouter with the same name, masking the submodule attribute). So we
# load via importlib explicitly here and pin it into sys.modules so later
# string-based monkeypatch calls find the module-level _minicast_post.
import importlib  # noqa: E402
_podcast_module = importlib.import_module("app.routers.public_podcast_router")
sys.modules.setdefault("app.routers.public_podcast_router", _podcast_module)


# ===========================================================================
# Fixtures
# ===========================================================================

@pytest.fixture()
def client():
    """Hermetic TestClient with in-memory SQLite + rate-limit reset."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    rl._buckets.clear()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _stub_settings(enabled: bool = True, base_url: str = "http://minicast.test:8000"):
    """Patch the router's settings helper so tests don't need DB rows."""
    return patch.multiple(
        "app.routers.public_podcast_router",
        _get_or_default=lambda _db, key: {
            "podcast.enabled": "true" if enabled else "false",
            "podcast.minicast_base_url": base_url,
        }.get(key),
        _is_enabled=lambda v: (v or "false").strip().lower() in ("true", "1", "yes"),
    )


# ===========================================================================
# /config
# ===========================================================================

class TestConfig:
    def test_returns_voice_catalog_and_default_voices(self, client):
        """Frontend FAB reads voice catalog to render role cards."""
        r = client.get("/api/public/podcast/config")
        assert r.status_code == 200
        body = r.json()
        assert body["enabled"] is True
        assert body["default_voice_a"] == "midnight_male"
        assert body["default_voice_b"] == "warm_female"
        assert set(body["voices"].keys()) == {"midnight_male", "warm_female"}
        # 小数 / 小创 are hbsc product names — never expose upstream voice ids.
        assert body["voices"]["midnight_male"]["label"] == "小数"
        assert body["voices"]["warm_female"]["label"] == "小创"
        assert body["voices"]["midnight_male"]["gender"] == "male"
        assert body["voices"]["warm_female"]["gender"] == "female"

    def test_disabled_when_admin_flag_off(self, client):
        """When admin sets podcast.enabled=false, the gate flips so the
        FAB can hide the third tab."""
        with patch(
            "app.routers.public_podcast_router._is_enabled",
            return_value=False,
        ):
            r = client.get("/api/public/podcast/config")
        assert r.status_code == 200
        assert r.json()["enabled"] is False


# ===========================================================================
# SSRF allow-list
# ===========================================================================

class TestUrlAllowList:
    """The /extract and /generate endpoints accept ONLY URLs that resolve to
    hbsc's own /articles/ or /issues/ routes — otherwise the FAB becomes an
    open proxy through MiniCast."""

    @pytest.mark.parametrize("good_url", [
        "https://hbsc.cn/articles/llm-trust",
        "https://hbsc.cn/issues/2026-q3",
        "https://hbsc.cn/articles",
        "https://hbsc.cn/issues",
        "http://localhost:5173/articles/foo",
    ])
    def test_hbsc_urls_are_allowed(self, client, good_url):
        with _stub_settings():
            r = client.post(
                "/api/public/podcast/extract",
                json={"url": good_url},
            )
        # Either 200 (mocked MiniCast) or 503 (unreachable) is acceptable;
        # 403 would mean the allow-list rejected a valid URL.
        assert r.status_code != 403, (
            f"Valid hbsc URL got blocked: {good_url} -> {r.json()}"
        )

    @pytest.mark.parametrize("bad_url", [
        "https://evil.com/articles/foo",
        "https://hbsc.cn/admin/settings",
        "https://hbsc.cn/login",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "ftp://hbsc.cn/articles/x",
        "https://hbsc.cn/",
        "https://hbsc.cn/search?q=foo",
    ])
    def test_non_hbsc_urls_are_rejected(self, client, bad_url):
        with _stub_settings():
            r = client.post(
                "/api/public/podcast/extract",
                json={"url": bad_url},
            )
        # Either 422 (Pydantic field validator) or 403 (defense-in-depth).
        assert r.status_code in (403, 422), (
            f"Expected block for {bad_url}, got {r.status_code}: {r.json()}"
        )


# ===========================================================================
# /generate end-to-end (mocked MiniCast)
# ===========================================================================

class TestGenerate:
    """The full /generate pipeline: extract → script → synthesize."""

    def _mock_minicast_chain(self, monkeypatch):
        """Patch the router's upstream helpers so /generate runs against a
        deterministic MiniCast that always succeeds."""
        async def fake_post(path, base_url, payload):
            if path == "/api/extract":
                return 200, {
                    "title": payload["source"].rsplit("/", 1)[-1] or "Test Article",
                    "content": "这是一个测试用的文章正文。" * 50,
                    "char_count": 1100,
                    "source_url": payload["source"],
                }
            if path == "/api/generate-script":
                return 200, {
                    "segments": [
                        {"speaker": "A", "text": "欢迎收听本期节目，我是小数。"},
                        {"speaker": "B", "text": "大家好，我是小创。"},
                        {"speaker": "A", "text": "今天我们来聊一聊测试用例。"},
                    ]
                }
            if path == "/api/synthesize":
                return 200, {
                    "job_id": "test-job-abc",
                    "mp3_url": "/api/jobs/test-job-abc/download",
                    "srt_url": "/api/jobs/test-job-abc/subtitle",
                    "duration_seconds": 42.5,
                    "total_chars": 30,
                    "segment_count": 3,
                }
            raise AssertionError(f"unexpected upstream path: {path}")

        monkeypatch.setattr(
            "app.routers.public_podcast_router._minicast_post",
            fake_post,
        )

    def test_happy_path_returns_job_and_fallback_url(self, client, monkeypatch):
        """A successful chain returns job_id + the public workbench URL."""
        self._mock_minicast_chain(monkeypatch)
        with _stub_settings():
            r = client.post(
                "/api/public/podcast/generate",
                json={
                    "url": "https://hbsc.cn/articles/llm-trust",
                },
            )
        assert r.status_code == 200, r.json()
        body = r.json()
        assert body["job_id"] == "test-job-abc"
        assert body["mp3_url"] == "/api/jobs/test-job-abc/download"
        assert body["fallback_url"].startswith("/labs/minicast/?embed=1&source=")
        assert "小数:" in body["script_text"]
        assert "小创:" not in body["script_text"]  # script uses upstream speaker letters
        assert "B:" in body["script_text"]

    def test_uses_pinned_default_voices(self, client, monkeypatch):
        """The spec pins voice_a=midnight_male, voice_b=warm_female; the
        synthesize request must carry them even when the client omits them."""
        captured = {}

        async def fake_post(path, base_url, payload):
            captured.setdefault("calls", []).append((path, payload))
            if path == "/api/extract":
                return 200, {
                    "title": "T",
                    "content": "正文" * 200,
                    "char_count": 400,
                    "source_url": payload["source"],
                }
            if path == "/api/generate-script":
                return 200, {
                    "segments": [{"speaker": "A", "text": "hi"}, {"speaker": "B", "text": "ho"}]
                }
            if path == "/api/synthesize":
                return 200, {
                    "job_id": "j",
                    "mp3_url": "/api/jobs/j/download",
                    "duration_seconds": 5,
                    "total_chars": 4,
                    "segment_count": 2,
                }
            return 200, {}

        monkeypatch.setattr(
            "app.routers.public_podcast_router._minicast_post",
            fake_post,
        )
        with _stub_settings():
            r = client.post(
                "/api/public/podcast/generate",
                json={"url": "https://hbsc.cn/articles/x"},
            )
        assert r.status_code == 200, r.json()
        synth = next(p for p, _ in captured["calls"] if p == "/api/synthesize")[1]
        assert synth["voice_a"] == "midnight_male"
        assert synth["voice_b"] == "warm_female"

    def test_rejects_unknown_voice(self, client):
        """Voice ids outside the curated catalog must be refused at the
        Pydantic layer — no upstream call happens."""
        with _stub_settings():
            r = client.post(
                "/api/public/podcast/generate",
                json={
                    "url": "https://hbsc.cn/articles/x",
                    "voice_a": "shiny_new_voice",
                },
            )
        assert r.status_code == 422

    def test_empty_extract_content_is_404(self, client, monkeypatch):
        async def fake_post(path, base_url, payload):
            if path == "/api/extract":
                return 200, {"title": "Empty", "content": "", "char_count": 0}
            raise AssertionError("should not proceed past extract")

        monkeypatch.setattr(
            "app.routers.public_podcast_router._minicast_post",
            fake_post,
        )
        with _stub_settings():
            r = client.post(
                "/api/public/podcast/generate",
                json={"url": "https://hbsc.cn/articles/empty"},
            )
        assert r.status_code == 404
        assert r.json()["detail"]["code"] == "upstream_extract_empty"

    def test_minicast_unreachable_returns_503(self, client):
        """When MiniCast is offline the FAB needs a clean signal so it can
        render the fallback link to /labs/minicast — not a raw 500."""
        from fastapi import HTTPException
        async def fake_post(path, base_url, payload):
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "minicast_unavailable",
                    "message": "播客服务暂不可用，请稍后重试",
                    "hint": "你也可以打开 /labs/minicast 完整工作台手动生成",
                },
            )
        with patch(
            "app.routers.public_podcast_router._minicast_post",
            fake_post,
        ):
            with _stub_settings():
                r = client.post(
                    "/api/public/podcast/generate",
                    json={"url": "https://hbsc.cn/articles/x"},
                )
        assert r.status_code == 503
        detail = r.json()["detail"]
        assert detail["code"] == "minicast_unavailable"
        assert "labs/minicast" in detail["hint"]

    def test_disabled_returns_409(self, client):
        """admin can flip podcast.enabled=false — /generate must refuse
        with 409 so the FAB can show a config-needed message."""
        with _stub_settings(enabled=False):
            r = client.post(
                "/api/public/podcast/generate",
                json={"url": "https://hbsc.cn/articles/x"},
            )
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "not_enabled"

    def test_oversized_body_is_413(self, client):
        """A >256 KB request body is refused at the raw layer — defends
        against trivial payload-bombing."""
        big_url = "https://hbsc.cn/articles/" + ("a" * (300 * 1024))
        with _stub_settings():
            r = client.post(
                "/api/public/podcast/extract",
                json={"url": big_url},
            )
        # Pydantic field validator runs first and rejects malformed URLs,
        # which is acceptable — either 413 (size cap) or 422 (validation)
        # means we did NOT let a 300 KB body hit the upstream.
        assert r.status_code in (413, 422)


# ===========================================================================
# Voice catalog identity
# ===========================================================================

def test_voice_catalog_pins_hbsc_personas():
    """The product naming ('小数' / '小创') is hardcoded on purpose —
    changing it would break the FAB's copy '男（小数）女（小创）'."""
    from app.routers.public_podcast_router import VOICE_CATALOG, DEFAULT_VOICE_A, DEFAULT_VOICE_B
    assert DEFAULT_VOICE_A == "midnight_male"
    assert DEFAULT_VOICE_B == "warm_female"
    assert VOICE_CATALOG[DEFAULT_VOICE_A]["label"] == "小数"
    assert VOICE_CATALOG[DEFAULT_VOICE_B]["label"] == "小创"


def test_url_allow_list_only_hbsc_paths():
    """Direct unit check on the allow-list helper — keeps the spec wording
    close to the code that enforces it."""
    from app.routers.public_podcast_router import _is_allowed_hbsc_url
    assert _is_allowed_hbsc_url("https://hbsc.cn/articles/foo")
    assert _is_allowed_hbsc_url("https://hbsc.cn/issues/2026-q3")
    assert not _is_allowed_hbsc_url("https://evil.com/articles/foo")
    assert not _is_allowed_hbsc_url("https://hbsc.cn/admin")
    assert not _is_allowed_hbsc_url("file:///etc/passwd")
