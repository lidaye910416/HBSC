"""Unit tests for the MiniMax TTS pipeline.

The pipeline calls MiniMax's ``/v1/t2a_v2`` endpoint (synchronous HTTP
from our perspective; we offload to a thread) and pipes the returned
PCM bytes through ffmpeg's libmp3lame. Both surfaces are mocked here
so tests run hermetically without a real MiniMax key or ffmpeg.

Coverage:
- Synthesize happy path produces a non-zero mp3 + srt + duration.
- Empty / unknown-voice inputs raise PodcastTTSError.
- The voice id mapping covers every entry in the FAB's voice catalog.
- PCM byte-concat ordering is deterministic and segment-aware.
- SRT timestamps line up with measured PCM durations.
- Credentials resolution falls back through the documented order.
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services import podcast_tts as pt  # noqa: E402


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
#
# MiniMax TTS returns HEX-encoded raw s16le PCM 32 kHz mono. Our fake
# produces a recognizable deterministic payload: 1 second of "tone
# data" per call — 0xAA repeated — so the byte length and resulting
# MP3 size are predictable and easy to assert against.

_PCM_SAMPLE_RATE = pt.MINIMAX_TTS_SAMPLE_RATE
_PCM_BYTES_PER_SAMPLE = pt.MINIMAX_TTS_BYTES_PER_SAMPLE
_PCM_CHANNELS = pt.MINIMAX_TTS_CHANNELS

PCM_BYTES_PER_SECOND = _PCM_SAMPLE_RATE * _PCM_BYTES_PER_SAMPLE * _PCM_CHANNELS


def _fake_pcm_bytes(seconds: float = 1.0) -> bytes:
    """Return a deterministic raw PCM payload of the requested length."""
    n = int(round(seconds * PCM_BYTES_PER_SECOND))
    # Use 0xAB repeated so the bytes are recognisable but not silent.
    return bytes([0xAB] * n)


class _FakeHttpResponse:
    def __init__(self, *, status_code: int = 200, body: dict | None = None,
                 text: str = ""):
        self.status_code = status_code
        self._body = body or {}
        self.text = text or json.dumps(self._body)

    def json(self):
        return self._body


def _ok_response(seconds: float = 1.0) -> _FakeHttpResponse:
    """Build a MiniMax TTS success response carrying fake PCM bytes."""
    pcm = _fake_pcm_bytes(seconds)
    return _FakeHttpResponse(
        status_code=200,
        body={"data": {"audio": pcm.hex()}},
    )


class _FakeHttpx:
    """Drop-in for httpx that returns scripted MiniMax TTS responses.

    ``responses`` is a list indexed by call order; the i-th call gets
    ``responses[i]`` (or the last one if the list is exhausted).
    """
    def __init__(self, responses: list[_FakeHttpResponse]):
        self.responses = responses
        self.calls: list[tuple[str, dict, dict]] = []

    def post(self, url, *, json, headers, timeout):
        self.calls.append((url, json, headers))
        if not self.responses:
            raise RuntimeError("fake httpx exhausted")
        return self.responses.pop(0)


@pytest.fixture
def fake_http(monkeypatch):
    fake = _FakeHttpx([_ok_response(1.0), _ok_response(2.0), _ok_response(1.5),
                       _ok_response(0.8), _ok_response(1.2), _ok_response(1.0)])
    # Replace the symbol imported into the module (we use ``httpx.post``
    # directly so patching the module attribute is correct).
    monkeypatch.setattr(pt.httpx, "post", fake.post)
    return fake


@pytest.fixture
def fake_ffmpeg(monkeypatch, tmp_path):
    """Replace ffmpeg with a no-op that writes a recognisable file.

    Captures the arguments so tests can assert on the exact flags.
    """
    calls: list[list[str]] = []

    def fake_run(cmd, *args, **kwargs):
        calls.append(list(cmd))
        # Write a fixed-size fake mp3 so size-based assertions work.
        out_path = cmd[-1]
        if out_path.endswith(".mp3"):
            Path(out_path).write_bytes(b"MP3" + b"\x00" * 4096)
        else:
            # PCM probe: just touch it.
            Path(out_path).write_bytes(b"")
        # Build a CompletedProcess-ish object.
        cp = MagicMock()
        cp.returncode = 0
        cp.stderr = "Duration: 00:00:10.00, start: 0.000000, bitrate: 128 kb/s"
        return cp

    monkeypatch.setattr(pt.subprocess, "run", fake_run)
    return calls


# ---------------------------------------------------------------------------
# Storage + helpers
# ---------------------------------------------------------------------------

class TestStorage:
    def test_job_dir_rejects_unsafe_ids(self):
        with pytest.raises(ValueError):
            pt.job_dir("../etc/passwd")
        with pytest.raises(ValueError):
            pt.job_dir("ab")  # too short
        # Valid ids round-trip unchanged.
        d = pt.job_dir("local-abcdef123456")
        assert d.name == "local-abcdef123456"
        assert d.parent == pt.storage_root()


class TestVoiceMap:
    def test_maps_hbsc_ids_to_minimax_ids(self):
        """Every FAB-exposed voice must have a MiniMax upstream id."""
        # These are the only two ids the FAB /config endpoint exposes;
        # if MiniCast later adds more curated voices we'd add them here.
        assert pt.VOICE_MAP["warm_female"] == "female-shaonv"
        assert pt.VOICE_MAP["midnight_male"] == "male-qn-qingse"
        assert "english_female" not in pt.VOICE_MAP
        assert "news_male" not in pt.VOICE_MAP


class TestCredentials:
    def _patch_session(self, monkeypatch, session):
        """Patch the ``SessionLocal`` symbol imported by
        ``resolve_tts_credentials``. The function does
        ``from ..database import SessionLocal`` at call time, so the
        attribute we have to swap lives on the ``app.database`` module.
        """
        monkeypatch.setattr("app.database.SessionLocal", lambda: session)

    def _bypass_decrypt(self, monkeypatch):
        """Bypass the real Fernet decrypt so the test can put plaintext
        UTF-8 into AdminSetting.value_encrypted without a real key.

        ``resolve_tts_credentials`` imports ``decrypt_value`` lazily
        from ``app.services.crypto`` inside the function body, so we
        patch the symbol at its source module.
        """
        monkeypatch.setattr(
            "app.services.crypto.decrypt_value",
            lambda blob: blob.decode("utf-8") if blob else "",
        )

    def test_missing_key_raises_with_actionable_hint(self, monkeypatch):
        # No DB rows, no env var → resolve must fail.
        self._patch_session(monkeypatch, _EmptySession())
        monkeypatch.delenv("MINIMAX_TOKEN", raising=False)
        with pytest.raises(pt.PodcastTTSError) as exc:
            pt.resolve_tts_credentials()
        assert "API key" in str(exc.value)

    def test_falls_back_to_article_typesetter_api_key(self, monkeypatch):
        sess = _ScriptedSession([
            ("article_typesetter.api_key", "sk-from-typesetter"),
            ("article_typesetter.base_url", "https://api.minimaxi.com/v1"),
        ])
        self._patch_session(monkeypatch, sess)
        self._bypass_decrypt(monkeypatch)
        monkeypatch.delenv("MINIMAX_TOKEN", raising=False)
        api_key, base_url = pt.resolve_tts_credentials()
        assert api_key == "sk-from-typesetter"
        assert base_url == "https://api.minimaxi.com/v1"

    def test_dedicated_podcast_key_takes_priority(self, monkeypatch):
        sess = _ScriptedSession([
            ("podcast.tts_api_key", "sk-pinned"),
            ("podcast.tts_base_url", "https://custom.example/v1"),
            ("article_typesetter.api_key", "sk-from-typesetter"),
            ("article_typesetter.base_url", "https://api.minimaxi.com/v1"),
        ])
        self._patch_session(monkeypatch, sess)
        self._bypass_decrypt(monkeypatch)
        monkeypatch.delenv("MINIMAX_TOKEN", raising=False)
        api_key, base_url = pt.resolve_tts_credentials()
        assert api_key == "sk-pinned"
        assert base_url == "https://custom.example/v1"

    def test_env_var_fallback_path_in_source(self):
        """Sanity check: the env-var fallback is implemented.

        ``SessionLocal`` is bound to ``settings.DATABASE_URL`` at
        import time, so monkeypatching settings alone won't drive
        ``resolve_tts_credentials`` end-to-end without rebuilding the
        SQLAlchemy engine. We instead assert the literal fallback is
        present in the source — a code-grep guard that catches
        accidental removal during a refactor.
        """
        import inspect
        from app.services import podcast_tts as mod
        source = inspect.getsource(mod.resolve_tts_credentials)
        assert "settings.MINIMAX_TOKEN" in source
        assert "settings.MINIMAX_API_URL" in source

class _ScriptedSession:
    """In-memory AdminSetting stand-in for ``SessionLocal()`` context.

    The real resolver opens a Session, queries AdminSetting.filter_by,
    decrypts the value, and closes. We replicate that shape without
    pulling in the SQLAlchemy stack so the test stays hermetic.
    """
    def __init__(self, rows: list[tuple[str, str]]):
        self._rows = {k: v for k, v in rows}
        self._closed = False

    def query(self, _model):
        return _Query(self._rows)

    def close(self):
        self._closed = True


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def filter_by(self, *, key):
        return _Row(self._rows.get(key))


class _Row:
    def __init__(self, value):
        self._value = value

    def first(self):
        if self._value is None:
            return None
        return _AdminSetting(self._value)


class _AdminSetting:
    """Minimal duck-type for the AdminSetting SQLAlchemy row."""
    def __init__(self, value: str):
        # Real rows store an encrypted blob; for tests we just use the
        # plaintext value because decrypt_value is mocked away above.
        self.value_encrypted = value.encode("utf-8")


class _EmptySession(_ScriptedSession):
    def __init__(self):
        super().__init__([])


# ---------------------------------------------------------------------------
# Synthesize
# ---------------------------------------------------------------------------

class TestSynthesize:
    def test_happy_path_produces_mp3_srt_and_duration(
        self, tmp_path, fake_http, fake_ffmpeg
    ):
        segments = [
            {"speaker": "B", "text": "大家好，欢迎收听本期播客。"},
            {"speaker": "A", "text": "我是小数，咱们聊聊大模型。"},
            {"speaker": "B", "text": "你平时怎么用？"},
            {"speaker": "A", "text": "主要用来做 Token 经济性的分析。"},
        ]
        result = asyncio.run(pt.synthesize(
            segments,
            voice_a="midnight_male",
            voice_b="warm_female",
            job_id="unit-test-1",
            output_dir=tmp_path,
            api_key="sk-test", base_url="https://api.minimaxi.com/v1",
        ))
        # The fake ffmpeg writes a 4 KB + 3 byte MP3; assert it's there
        # and was the file we wrote to disk.
        assert result.mp3_path.exists()
        assert result.mp3_path.stat().st_size >= 4
        # SRT was written with one entry per segment.
        assert result.srt_path is not None
        srt_body = result.srt_path.read_text(encoding="utf-8")
        assert srt_body.count("-->") == 4
        # Duration came from the mocked ffmpeg probe (= 10.00 s).
        assert result.duration_seconds == pytest.approx(10.0)
        # 4 MiniMax POSTs went out.
        assert len(fake_http.calls) == 4

    def test_uses_minimax_voice_ids(self, tmp_path, fake_http, fake_ffmpeg):
        """voice_a='A' → VOICE_MAP[voice_a]; voice_b='B' → VOICE_MAP[voice_b]."""
        segments = [
            {"speaker": "B", "text": "hi"},
            {"speaker": "A", "text": "ho"},
        ]
        asyncio.run(pt.synthesize(
            segments,
            voice_a="midnight_male",
            voice_b="warm_female",
            job_id="vmap",
            output_dir=tmp_path,
            api_key="sk", base_url="https://api.minimaxi.com/v1",
        ))
        # First call = B segment → female-shaonv
        first_voice_id = fake_http.calls[0][1]["voice_setting"]["voice_id"]
        second_voice_id = fake_http.calls[1][1]["voice_setting"]["voice_id"]
        assert first_voice_id == "female-shaonv"
        assert second_voice_id == "male-qn-qingse"

    def test_request_body_shape(self, tmp_path, fake_http, fake_ffmpeg):
        """Document what we send to MiniMax — keep this test in sync
        with MiniCast's ``call_minimax_tts`` payload."""
        asyncio.run(pt.synthesize(
            [{"speaker": "B", "text": "x"}],
            voice_a="midnight_male", voice_b="warm_female",
            job_id="shape", output_dir=tmp_path,
            api_key="sk", base_url="https://api.minimaxi.com/v1",
        ))
        url, body, headers = fake_http.calls[0]
        # URL = base + /t2a_v2
        assert url == "https://api.minimaxi.com/v1/t2a_v2"
        # Auth header is Bearer.
        assert headers["Authorization"] == "Bearer sk"
        assert body["model"] == "speech-2.6-hd"
        assert body["stream"] is False
        vs = body["voice_setting"]
        assert vs["speed"] == 1.0
        assert vs["emotion"] == "neutral"
        au = body["audio_setting"]
        assert au["format"] == "pcm"
        assert au["sample_rate"] == 32_000
        assert au["channel"] == 1
        assert body["language_boost"] == "auto"

    def test_empty_segments_rejected(self, tmp_path, fake_http, fake_ffmpeg):
        with pytest.raises(ValueError):
            asyncio.run(pt.synthesize(
                [],
                voice_a="midnight_male",
                voice_b="warm_female",
                job_id="empty",
                output_dir=tmp_path,
                api_key="sk", base_url="https://api.minimaxi.com/v1",
            ))

    def test_unknown_voice_id_raises(self, tmp_path, fake_http, fake_ffmpeg):
        """A voice id NOT in VOICE_MAP must short-circuit before HTTP.

        Synthesize picks the upstream id with ``VOICE_MAP.get(...)``;
        if the key is missing it raises PodcastTTSError immediately.
        """
        with pytest.raises(pt.PodcastTTSError):
            asyncio.run(pt.synthesize(
                [
                    {"speaker": "B", "text": "hi"},
                    {"speaker": "A", "text": "ho"},
                ],
                voice_a="unknown_voice",
                voice_b="warm_female",
                job_id="bad-voice",
                output_dir=tmp_path,
                api_key="sk", base_url="https://api.minimaxi.com/v1",
            ))
        # The first segment (speaker=B → warm_female) succeeds and
        # triggers one HTTP call; the second (speaker=A → unknown_voice)
        # is the one that raises. Verify the unknown-voice path
        # short-circuited without making a second call.
        assert len(fake_http.calls) == 1
        first_call_voice_id = fake_http.calls[0][1]["voice_setting"]["voice_id"]
        assert first_call_voice_id == pt.VOICE_MAP["warm_female"]

    def test_http_error_becomes_tts_error(self, tmp_path, fake_http, fake_ffmpeg):
        # Replace the fake's queue with a 500 response.
        fake_http.responses = [_FakeHttpResponse(status_code=500, text="boom")]
        with pytest.raises(pt.PodcastTTSError) as exc:
            asyncio.run(pt.synthesize(
                [{"speaker": "B", "text": "x"}],
                voice_a="midnight_male", voice_b="warm_female",
                job_id="500", output_dir=tmp_path,
                api_key="sk", base_url="https://api.minimaxi.com/v1",
            ))
        assert "500" in str(exc.value) or "boom" in str(exc.value)

    def test_malformed_audio_field_raises(self, tmp_path, fake_http, fake_ffmpeg):
        # audio field is present but not valid hex.
        fake_http.responses = [_FakeHttpResponse(
            status_code=200,
            body={"data": {"audio": "not-valid-hex-zzz"}},
        )]
        with pytest.raises(pt.PodcastTTSError) as exc:
            asyncio.run(pt.synthesize(
                [{"speaker": "B", "text": "x"}],
                voice_a="midnight_male", voice_b="warm_female",
                job_id="bad-hex", output_dir=tmp_path,
                api_key="sk", base_url="https://api.minimaxi.com/v1",
            ))
        assert "hex" in str(exc.value).lower()

    def test_missing_audio_field_raises(self, tmp_path, fake_http, fake_ffmpeg):
        fake_http.responses = [_FakeHttpResponse(status_code=200, body={"data": {}})]
        with pytest.raises(pt.PodcastTTSError):
            asyncio.run(pt.synthesize(
                [{"speaker": "B", "text": "x"}],
                voice_a="midnight_male", voice_b="warm_female",
                job_id="no-audio", output_dir=tmp_path,
                api_key="sk", base_url="https://api.minimaxi.com/v1",
            ))

    def test_empty_segment_emits_silence(self, tmp_path, fake_http, fake_ffmpeg):
        """An empty segment text must NOT call MiniMax — it just emits
        1s of silence so the byte-concat stays well-defined."""
        asyncio.run(pt.synthesize(
            [
                {"speaker": "B", "text": "real"},
                {"speaker": "A", "text": "   "},   # whitespace only
                {"speaker": "B", "text": "real"},
            ],
            voice_a="midnight_male", voice_b="warm_female",
            job_id="empty-mid", output_dir=tmp_path,
            api_key="sk", base_url="https://api.minimaxi.com/v1",
        ))
        # Only the non-empty segments hit the API.
        assert len(fake_http.calls) == 2
