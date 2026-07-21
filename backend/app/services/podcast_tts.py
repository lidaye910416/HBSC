"""Local TTS pipeline for 数创智伴 「播一下」 — physical isolation from MiniCast.

When ``HBSC_PODCAST_ISOLATED=true`` (the default), hbsc never talks to
the upstream MiniCast service. This module owns the on-machine
alternative — a pure-MiniMax implementation that mirrors the local
``~/Projects/MiniCast`` project so operators get equivalent audio
quality without leaving hbsc's trust boundary.

Pipeline:

1. For each segment, POST to ``/v1/t2a_v2`` on api.minimaxi.com with the
   hbsc voice id translated to the curated MiniMax voice id. MiniMax
   returns raw s16le PCM 32 kHz mono audio as a HEX-encoded string —
   decode it straight into bytes, write to ``<tmp>/seg_<i>.pcm``.
2. Insert inter-segment silence by emitting a zero-filled PCM buffer.
3. Byte-concatenate (PCM segments + silence) and pipe through ffmpeg
   to encode a single MP3 at 128 kbps — same approach as MiniCast's
   ``core/assembler.concat_segments_to_mp3``.
4. Write an SRT subtitle alongside the mp3, using measured PCM durations.

Why raw PCM bytes instead of per-segment mp3?

  Concatenating PCM is trivial (byte-level join). Concatenating mp3s
  forces re-encode at every join and produces audible clicks at the
  boundaries. MiniCast's assembler makes the same trade-off and we
  follow suit — single ffmpeg pass over the whole stream is faster
  and cleaner than N passes over N segments.

API key resolution order (highest priority wins):

  1. ``podcast.tts_api_key`` admin setting (operator-pinned, secret).
  2. ``article_typesetter.api_key`` admin setting — the MiniMax Token
     Plan also covers TTS, so reusing the existing preset is the
     zero-friction default. Documented in admin_setting_defaults.
  3. ``settings.MINIMAX_TOKEN`` env var — works for local dev where the
     env is the source of truth.

When no key is available the module raises PodcastTTSError with a
caller-actionable hint; the router catches it and returns a friendly
502 so the FAB never silently produces a silent mp3.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import httpx
from tenacity import (
    retry, stop_after_attempt, wait_exponential,
    retry_if_exception_type,
)

_log = logging.getLogger(__name__)


# Discover tools at import time.
FFMPEG_BIN = shutil.which("ffmpeg") or "/usr/local/bin/ffmpeg"


# ---------------------------------------------------------------------------
# MiniMax TTS API constants
# ---------------------------------------------------------------------------
#
# Mirrors ~/Projects/MiniCast/src/minicast/core/tts.py so the two stay
# in lockstep. Update one → update the other.

MINIMAX_TTS_BASE_URL = "https://api.minimaxi.com/v1"
MINIMAX_TTS_PATH = "/t2a_v2"
MINIMAX_TTS_MODEL_DEFAULT = "speech-2.6-hd"
MINIMAX_TTS_TIMEOUT_S = 120.0
MINIMAX_TTS_SAMPLE_RATE = 32_000  # MiniMax only supports 32 kHz output
MINIMAX_TTS_CHANNELS = 1
MINIMAX_TTS_BYTES_PER_SAMPLE = 2   # s16le


# ---------------------------------------------------------------------------
# Voice catalog (curated, pinned)
# ---------------------------------------------------------------------------
#
# hbsc exposes only two product voices on the FAB ("小数" / "小创"); we
# map them to the two MiniMax voices used by the local MiniCast project
# (female-shaonv / male-qn-qingse). The mapping is hardcoded on purpose
# so admin can't accidentally remap the persona copy in the FAB.

VOICE_MAP: dict[str, str] = {
    "warm_female":   "female-shaonv",     # 小创 — 温暖女声
    "midnight_male": "male-qn-qingse",    # 小数 — 磁性男声
}


# Tunables; raised as constants so tests can assert against them.
DEFAULT_PAUSE_S = 0.5
PCM_HEADER_BYTES = 0  # raw PCM has no header — just samples


@dataclass(frozen=True)
class SynthResult:
    """Where the synthesized artifacts landed and how long they are."""
    mp3_path: Path
    srt_path: Path | None
    duration_seconds: float


class PodcastTTSError(RuntimeError):
    """Raised when any step of the local TTS pipeline fails irrecoverably.

    Callers translate this into a 502 with a stable error code so the
    frontend FAB can show a remediation hint.
    """


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

def storage_root() -> Path:
    """Where generated podcasts live. Resolved against the backend root
    so the location is independent of the shell's CWD.

    Layout: ``<backend>/data/podcasts/`` — sibling of ``uploads/``.
    """
    from .app_paths import backend_root
    return backend_root() / "data" / "podcasts"


def job_dir(job_id: str) -> Path:
    """The per-job subdirectory. Created lazily by ``synthesize``."""
    if not re.fullmatch(r"[a-zA-Z0-9_-]{4,40}", job_id):
        raise ValueError(f"invalid job_id: {job_id!r}")
    return storage_root() / job_id


# ---------------------------------------------------------------------------
# API key resolution
# ---------------------------------------------------------------------------

def resolve_tts_credentials() -> tuple[str, str]:
    """Resolve (api_key, base_url) for the MiniMax TTS endpoint.

    Lookup order (first hit wins):
      1. ``podcast.tts_api_key`` / ``podcast.tts_base_url`` admin rows.
      2. ``article_typesetter.api_key`` / ``article_typesetter.base_url``
         — the MiniMax Token Plan covers TTS, so reusing the existing
         preset is the zero-friction default. Documented in
         admin_setting_defaults.
      3. ``settings.MINIMAX_TOKEN`` env var (via app.config.settings).
      4. Raises PodcastTTSError with a caller-actionable hint.

    Returns ``(api_key, base_url)``. base_url already has no trailing
    slash and points at the API root (``https://api.minimaxi.com/v1``);
    callers append ``/t2a_v2`` themselves.
    """
    from ..config import settings
    from ..database import SessionLocal
    from ..models.admin_setting import AdminSetting
    from ..services.crypto import decrypt_value

    api_key = ""
    base_url = ""

    db = SessionLocal()
    try:
        # 1. Dedicated podcast.tts_* rows (highest priority).
        for k in ("podcast.tts_api_key", "podcast.tts_base_url"):
            row = db.query(AdminSetting).filter_by(key=k).first()
            if row:
                try:
                    val = decrypt_value(row.value_encrypted)
                except Exception:
                    val = ""
                if val:
                    if k == "podcast.tts_api_key" and not api_key:
                        api_key = val
                    if k == "podcast.tts_base_url" and not base_url:
                        base_url = val

        # 2. Fall back to article_typesetter.* — same MiniMax account.
        if not api_key:
            row = db.query(AdminSetting).filter_by(key="article_typesetter.api_key").first()
            if row:
                try:
                    val = decrypt_value(row.value_encrypted)
                except Exception:
                    val = ""
                if val:
                    api_key = val
        if not base_url:
            row = db.query(AdminSetting).filter_by(key="article_typesetter.base_url").first()
            if row:
                try:
                    val = decrypt_value(row.value_encrypted)
                except Exception:
                    val = ""
                if val:
                    base_url = val

        # 3. Fall back to MINIMAX_TOKEN env var (dev convenience).
        if not api_key and settings.MINIMAX_TOKEN:
            api_key = settings.MINIMAX_TOKEN
        if not base_url and settings.MINIMAX_API_URL:
            # settings.MINIMAX_API_URL is the image-gen endpoint; use
            # its origin (https://api.minimax.chat) only as a last
            # resort. Real TTS calls need api.minimaxi.com.
            from urllib.parse import urlparse
            parsed = urlparse(settings.MINIMAX_API_URL)
            if parsed.netloc:
                base_url = f"{parsed.scheme}://{parsed.netloc}/v1"
    finally:
        db.close()

    if not api_key:
        raise PodcastTTSError(
            "未配置 MiniMax TTS API key。请在 Admin Settings 中填入 "
            "podcast.tts_api_key 或 article_typesetter.api_key，"
            "或在环境变量中设置 MINIMAX_TOKEN。"
        )
    if not base_url:
        base_url = MINIMAX_TTS_BASE_URL

    return api_key, base_url.rstrip("/")


# ---------------------------------------------------------------------------
# Tool wrappers
# ---------------------------------------------------------------------------

class _TTSRetryableError(Exception):
    """Signals a TTS failure worth retrying — rate limit, transient
    network blip, or MiniMax returning 200 with no audio payload
    (which is how the API signals "throttled" today)."""


class _TTSFatalError(Exception):
    """TTS failure that won't get better by retrying — auth / 4xx /
    malformed payload / repeated base_resp.status_code != 0."""


# 3 retries with exponential backoff (2s → 4s → 8s, capped at 10s),
# matching MiniCast's src/minicast/core/utils/retry.py:tts_retry.
# We extend MiniCast's set with _TTSRetryableError because MiniMax
# surfaces rate limits as 200 + empty data.audio rather than a 429.
_tts_retry_decorator = retry(
    # 3 retries, 3s -> 6s -> 12s, capped at 30s. MiniMax's RPM window
    # is ~60s; 12+12+12=36s backoff inside the same minute means most
    # soft-throttles clear by the time the next attempt fires.
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=3, max=30),
    retry=retry_if_exception_type(_TTSRetryableError),
    reraise=True,
)


def _pcm_duration_seconds(pcm_bytes: bytes) -> float:
    """Length of a raw s16le mono PCM stream at MiniMax's 32 kHz rate."""
    return len(pcm_bytes) / (MINIMAX_TTS_SAMPLE_RATE * MINIMAX_TTS_CHANNELS * MINIMAX_TTS_BYTES_PER_SAMPLE)


def _probe_mp3_duration_seconds(mp3_path: Path) -> float:
    """Parse the Duration line from ``ffmpeg -i <mp3>``.

    Faster than spinning up ffprobe (which has a dyld issue on this
    machine) and avoids adding mutagen as a runtime dep. Returns 0.0 on
    failure so the caller can fall back to a measured sum.
    """
    try:
        proc = subprocess.run(
            [FFMPEG_BIN, "-hide_banner", "-i", str(mp3_path)],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (subprocess.SubprocessError, FileNotFoundError) as e:
        _log.warning("ffmpeg probe failed for %s: %s", mp3_path, e)
        return 0.0
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", proc.stderr or "")
    if not m:
        return 0.0
    h, mn, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mn * 60 + s


def _build_silence_pcm(path: Path, duration_s: float) -> None:
    """Emit raw s16le mono 32 kHz silence of the requested length.

    PCM has no header — we just write the right number of zero bytes.
    """
    n_samples = int(round(duration_s * MINIMAX_TTS_SAMPLE_RATE * MINIMAX_TTS_CHANNELS))
    path.write_bytes(b"\x00\x00" * n_samples)


def _pcm_to_mp3(combined_pcm: Path, mp3_out: Path) -> None:
    """Pipe a raw PCM stream through ffmpeg's libmp3lame encoder.

    Mirrors MiniCast's ``concat_segments_to_mp3`` final step. 128 kbps
    mono is the same bitrate MiniCast uses — quality headroom is
    generous for speech, and keeping parity means the FAB's audio
    element gets byte-identical specs to a MiniCast-generated episode.
    """
    subprocess.run(
        [
            FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "s16le",
            "-ar", str(MINIMAX_TTS_SAMPLE_RATE),
            "-ac", str(MINIMAX_TTS_CHANNELS),
            "-i", str(combined_pcm),
            "-acodec", "libmp3lame",
            "-b:a", "128k",
            str(mp3_out),
        ],
        check=True, capture_output=True, text=True, timeout=180,
    )


async def _minimax_tts_one(
    text: str,
    voice_id: str,
    *,
    api_key: str,
    base_url: str,
    model: str,
) -> bytes:
    """Call MiniMax TTS and return raw s16le PCM 32 kHz mono bytes.

    Mirrors ``~/Projects/MiniCast/src/minicast/core/tts.py:35`` so the
    two implementations stay byte-identical at the audio level. The
    request body and response shape are exactly what MiniMax documents
    at https://platform.minimaxi.com/docs/api-reference/voice-synthesis-t2a.

    Network failures / non-2xx / malformed audio fields all raise
    PodcastTTSError so the router can degrade gracefully.
    """
    payload = {
        "model": model,
        "text": text,
        "stream": False,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": 1.0,
            "vol": 1.0,
            "pitch": 0,
            "emotion": "neutral",
        },
        "audio_setting": {
            "sample_rate": MINIMAX_TTS_SAMPLE_RATE,
            "bitrate": 128000,
            "format": "pcm",
            "channel": MINIMAX_TTS_CHANNELS,
        },
        "language_boost": "auto",
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    url = base_url.rstrip("/") + MINIMAX_TTS_PATH

    # Status / signal vocabulary that MiniMax uses to mean "try again":
    #   HTTP 429, 503
    #   base_resp.status_code != 0 with status_msg mentioning limit/quota/
    #     rate/throttle/frequency
    #   200 OK but data.audio missing (the API's silent throttle)
    _RATE_LIMIT_HINTS = (
        "rate", "limit", "quota", "throttle", "frequency",
        "too many", "too frequent",
    )

    @_tts_retry_decorator
    def _do() -> bytes:
        try:
            resp = httpx.post(
                url, json=payload, headers=headers,
                timeout=MINIMAX_TTS_TIMEOUT_S,
            )
        except httpx.HTTPError as e:
            # Network blip — worth retrying.
            raise _TTSRetryableError(f"MiniMax TTS network error: {e}") from e

        if resp.status_code == 429 or resp.status_code == 503:
            snippet = resp.text[:200] if resp.text else ""
            raise _TTSRetryableError(
                f"MiniMax TTS HTTP {resp.status_code} (rate-limited): {snippet}"
            )
        if resp.status_code >= 400:
            # 4xx other than 429 is fatal — retrying won't change auth/perm.
            snippet = resp.text[:300] if resp.text else ""
            raise _TTSFatalError(
                f"MiniMax TTS HTTP {resp.status_code}: {snippet}"
            )

        try:
            data = resp.json()
        except ValueError as e:
            raise _TTSFatalError(f"MiniMax TTS non-JSON response: {e}") from e

        # Inspect base_resp — non-zero status_code with a rate-limit hint
        # is a soft throttle we should back off and retry.
        base_resp = data.get("base_resp") or {}
        status_code = base_resp.get("status_code")
        status_msg = (base_resp.get("status_msg") or "").lower()
        if status_code not in (None, 0):
            if any(h in status_msg for h in _RATE_LIMIT_HINTS):
                raise _TTSRetryableError(
                    f"MiniMax TTS base_resp rate-limit signal: "
                    f"status_code={status_code} status_msg={status_msg!r}"
                )
            raise _TTSFatalError(
                f"MiniMax TTS base_resp error: "
                f"status_code={status_code} status_msg={status_msg!r}"
            )

        audio_field = (data.get("data") or {}).get("audio")
        if not audio_field:
            # 200 + base_resp ok + empty audio — silent throttle. Retry.
            raise _TTSRetryableError(
                f"MiniMax TTS response missing data.audio: keys={list(data.keys())}"
            )
        try:
            return bytes.fromhex(audio_field)
        except ValueError as e:
            raise _TTSFatalError(
                f"MiniMax TTS audio field is not valid hex: {e}"
            ) from e

    try:
        return await asyncio.get_running_loop().run_in_executor(None, _do)
    except _TTSRetryableError as e:
        # Exhausted retries — convert to PodcastTTSError so the router
        # surfaces the same error envelope callers already handle.
        raise PodcastTTSError(str(e)) from e
    except _TTSFatalError as e:
        raise PodcastTTSError(str(e)) from e


def _format_srt_timestamp(sec: float) -> str:
    if sec < 0:
        sec = 0.0
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int(round((sec - int(sec)) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _write_srt(
    segments: Sequence[dict],
    timings: Sequence[float],
    pause_s: float,
    out_path: Path,
) -> None:
    """Render an SRT subtitle using measured PCM durations per segment.

    Falls back to ``len(text) / 13`` seconds per character (a known
    good estimate for zh-CN neural voices at neutral speed) when the
    measured duration is unavailable.
    """
    lines: list[str] = []
    cursor = 0.0
    for i, (seg, dur) in enumerate(zip(segments, timings), start=1):
        text = (seg.get("text") or "").strip().replace("\n", " ")
        if not text:
            continue
        effective = dur if dur > 0 else max(1.0, len(text) / 13.0)
        lines.append(str(i))
        lines.append(f"{_format_srt_timestamp(cursor)} --> {_format_srt_timestamp(cursor + effective)}")
        lines.append(text)
        lines.append("")
        cursor += effective + pause_s
    out_path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def synthesize(
    segments: Sequence[dict],
    *,
    voice_a: str,
    voice_b: str,
    job_id: str,
    output_dir: Path | None = None,
    pause_s: float = DEFAULT_PAUSE_S,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str = MINIMAX_TTS_MODEL_DEFAULT,
) -> SynthResult:
    """Synthesize a per-segment script to one mp3 + optional srt.

    segments: ``[{speaker: "A"|"B", text: str}, ...]`` in speaking order.
    voice_a / voice_b: hbsc voice ids (``midnight_male`` / ``warm_female``).
    job_id: caller-supplied id used as the artifact filename.

    The ``api_key`` / ``base_url`` arguments are explicit injection
    points so tests don't have to touch the admin_settings DB. When
    omitted the module resolves credentials via ``resolve_tts_credentials``
    (which checks podcast.tts_* → article_typesetter.* → env var in
    that order).
    """
    if not segments:
        raise ValueError("segments is empty")

    if api_key is None or base_url is None:
        resolved_key, resolved_url = resolve_tts_credentials()
        api_key = api_key or resolved_key
        base_url = base_url or resolved_url
    if not api_key:
        raise PodcastTTSError("MiniMax TTS api_key is empty")
    if not base_url:
        raise PodcastTTSError("MiniMax TTS base_url is empty")

    out_dir = output_dir or job_dir(job_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(tempfile.mkdtemp(prefix=f"podcast-{job_id}-"))
    final_mp3 = out_dir / f"{job_id}.mp3"
    final_srt = out_dir / f"{job_id}.srt"

    pcm_paths: list[Path] = []
    timings: list[float] = []

    try:
        # 1. TTS each segment in parallel.
        async def synth_one(i: int, seg: dict) -> tuple[Path, float]:
            text = (seg.get("text") or "").strip()
            if not text:
                # Empty segment — emit silence PCM of 1 s so the concat
                # never sees a missing file; the SRT skips empty rows.
                p = tmp_dir / f"seg_{i}_skip.pcm"
                _build_silence_pcm(p, 1.0)
                return p, 1.0
            speaker = (seg.get("speaker") or "A").upper()
            mapped = voice_a if speaker == "A" else voice_b
            upstream_id = VOICE_MAP.get(mapped)
            if upstream_id is None:
                raise PodcastTTSError(
                    f"speaker {speaker} mapped to unknown voice id {mapped!r}"
                )
            pcm_bytes = await _minimax_tts_one(
                text, upstream_id,
                api_key=api_key, base_url=base_url, model=model,
            )
            p = tmp_dir / f"seg_{i}.pcm"
            p.write_bytes(pcm_bytes)
            return p, _pcm_duration_seconds(pcm_bytes)

        # Sequential, not parallel — MiniMax's per-IP RPM quota is
        # shared across segments, so 12 concurrent calls in one
        # generate all collide and trigger 1002 rate-limit. Sequential
        # means a 12-segment job takes ~12x longer per segment but
        # stays inside the quota window.
        for i, seg in enumerate(segments):
            try:
                p, t = await synth_one(i, seg)
            except _TTSRetryableError as e:
                raise PodcastTTSError(f"segment {i} TTS failed: {e}") from e
            pcm_paths.append(p)
            timings.append(t)

        # 2. Build silence PCM (one shared buffer reused in the concat).
        silence_pcm = tmp_dir / "silence.pcm"
        _build_silence_pcm(silence_pcm, pause_s)

        # 3. Byte-concat segments + silence gaps. Cheaper than N-way
        # ffmpeg re-encode and the join is click-free because every
        # frame is zero-padded PCM.
        combined_pcm = tmp_dir / "combined.pcm"
        with combined_pcm.open("wb") as fh:
            for p in pcm_paths:
                fh.write(p.read_bytes())
                fh.write(silence_pcm.read_bytes())

        # 4. ffmpeg encode → 128 kbps mono MP3.
        _pcm_to_mp3(combined_pcm, final_mp3)

        # 5. SRT subtitle.
        _write_srt(segments, timings, pause_s, final_srt)

        # 6. Duration: prefer the ffmpeg probe (real length); fall back
        # to the measured PCM sum on probe failure.
        duration = _probe_mp3_duration_seconds(final_mp3)
        if duration <= 0:
            duration = sum(timings) + pause_s * max(0, len(segments) - 1)

        return SynthResult(
            mp3_path=final_mp3,
            srt_path=final_srt if final_srt.exists() else None,
            duration_seconds=duration,
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


__all__ = [
    "SynthResult",
    "PodcastTTSError",
    "VOICE_MAP",
    "MINIMAX_TTS_MODEL_DEFAULT",
    "DEFAULT_PAUSE_S",
    "synthesize",
    "resolve_tts_credentials",
    "storage_root",
    "job_dir",
]
