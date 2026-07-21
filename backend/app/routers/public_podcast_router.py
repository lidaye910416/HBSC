"""Public podcast proxy for the 数创智伴 FAB 「播一下」 tab.

Routes anonymous visitors through a single hbsc-friendly API and
exposes a /config endpoint that the frontend FAB uses as a visibility
gate.

Two operating modes — chosen via the ``HBSC_PODCAST_ISOLATED`` env var
(default ``true``):

* **Isolated (default)** — hbsc never talks to the upstream MiniCast
  service. The full pipeline runs locally: extract → LLM-rewrite script
  → edge-tts per-segment mp3 → ffmpeg concat → SRT. This is the mode
  required by the project's "physical isolation from MiniCast" rule.

* **Upstream** — preserves the original MiniCast proxy behaviour for
  deployments that want hbsc to delegate to a MiniCast instance on a
  trusted network. Off by default; enable with
  ``HBSC_PODCAST_ISOLATED=false``.

Design contract — see
  docs/superpowers/specs/2026-07-20-fab-podcast-mode-design.md

Why a separate router (and not just adding to public_agent_router)?
- Different upstream (MiniCast) and different failure modes (network
  timeout vs LLM error) deserve their own error envelopes and rate-limit
  buckets.
- MiniCast is OPTIONAL infrastructure — when isolated, the FAB works
  fully on hbsc's own compute. The page-agent tab still uses its own
  router.

Security guards (mirror public_agent_router):
- Never log or echo API keys / Authorization headers from upstream.
- Body cap (256 KB) at raw request layer.
- URL allow-list on /extract — only hbsc own URLs may be ingested via
  the FAB (SSRF guard). Other URLs are refused with 403
  not_allowed_url.
- Rate limit: 12 / minute per IP (each /generate = 3 upstream calls;
  leaves room for ~4 consecutive attempts before throttling).

Admin-managed settings (read here, written via /api/admin/settings):
- podcast.enabled                (boolean: FAB visibility gate)
- podcast.minicast_base_url      (upstream mode only; ignored when
                                  isolated — kept for back-compat)
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.admin_setting import AdminSetting
from ..services.crypto import decrypt_value
from ..services.admin_setting_defaults import default_for
from ..services.llm_client import LLMUnavailable
from ..services.podcast_script import (
    generate_script as llm_generate_script,
)
from ..services.podcast_tts import (
    PodcastTTSError,
    job_dir,
    synthesize as local_synthesize,
)
from ..middleware.rate_limit import rate_limit


router = APIRouter(prefix="/api/public/podcast", tags=["public-podcast"])
_log = logging.getLogger(__name__)


# Mirror public_agent_router's body caps; deliberately smaller because
# payloads are tiny (URL + voice ids).
MAX_PUBLIC_PODCAST_BYTES = 256 * 1024  # 256 KB

# Rate-limit: 12 / minute / IP. Each /generate = 3 upstream calls so this
# leaves ~4 back-to-back retries before throttling.
RATE_LIMIT_MAX_CALLS = 12
RATE_LIMIT_WINDOW_SECONDS = 60

# Upstream timeouts — only relevant when HBSC_PODCAST_ISOLATED=false.
MINICAST_HTTP_TIMEOUT = httpx.Timeout(180.0, connect=10.0)

# Default voices pinned for 数创智伴 「播一下」 — see spec §2.4.
DEFAULT_VOICE_A = "midnight_male"   # 小数 (男 · 磁性低沉)
DEFAULT_VOICE_B = "warm_female"     # 小创 (女 · 温暖热情)

# Voice display labels exposed to the frontend for the podcast role cards.
# Intentionally hardcoded: hbsc 命名（"小数" / "小创"）是产品级 persona,
# 不允许 admin 通过设置项改写 — 否则会破坏 FAB 上写死的 "男（数）女（创）"
# 文案契约。
VOICE_CATALOG = {
    "midnight_male": {
        "label": "小数",
        "subtitle": "男 · 磁性低沉 · 适合嘉宾身份",
        "emoji": "🎙️",
        "gender": "male",
    },
    "warm_female": {
        "label": "小创",
        "subtitle": "女 · 温暖热情 · 适合主持身份",
        "emoji": "🌸",
        "gender": "female",
    },
}


def _is_isolated() -> bool:
    """True unless the operator explicitly opts into upstream mode.

    Env var reads are intentionally minimal: this is a deployment-time
    decision, not a per-request switch. The default honours the project's
    "physical isolation from MiniCast" rule.
    """
    raw = os.getenv("HBSC_PODCAST_ISOLATED", "true").strip().lower()
    return raw not in ("false", "0", "no", "off")


# ---------------------------------------------------------------------------
# Local extract (always available — independent of isolation mode)
# ---------------------------------------------------------------------------

async def _extract_from_hbsc(url: str, request: Request) -> tuple[str, str]:
    """Read content directly from hbsc's own article/issue endpoints.

    This is what makes the FAB useful in environments where no upstream
    service is reachable (isolated mode, or upstream offline). The caller
    passes the original Request so we can resolve relative "host" URLs
    to the same host the client used.

    Returns (content, title). Raises ValueError when the URL doesn't map
    to a known hbsc route or the local endpoint returns empty content.
    """
    u = urlparse(url)
    path = u.path.rstrip("/")
    if path.startswith("/articles/"):
        kind, slug = "article", path[len("/articles/"):]
    elif path == "/articles":
        raise ValueError("article slug is required")
    elif path.startswith("/issues/"):
        kind, slug = "issue", path[len("/issues/"):]
    elif path == "/issues":
        raise ValueError("issue slug is required")
    else:
        raise ValueError(f"unsupported path: {path}")

    base = str(request.base_url).rstrip("/")
    api_path = f"/api/articles/{slug}" if kind == "article" else f"/api/issues/{slug}"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            r = await client.get(base + api_path)
    except httpx.HTTPError as e:
        _log.warning("local extract GET %s failed: %s", api_path, e)
        raise ValueError(f"local extract network error: {e}") from e

    if r.status_code != 200:
        raise ValueError(f"local extract returned HTTP {r.status_code}")

    data = r.json()
    if kind == "article":
        content = (data.get("content") or "").strip()
        title = data.get("title") or ""
    else:
        items = data.get("items") or []
        content = "\n\n".join(
            f"# {it.get('title','')}\n{(it.get('summary') or '').strip()}"
            for it in items
        ).strip()
        title = (data.get("issue") or {}).get("title") or path
    if not content:
        raise ValueError("local extract returned empty content")
    return content, title


# ---------------------------------------------------------------------------
# Local script (deterministic fallback when LLM is unavailable)
# ---------------------------------------------------------------------------

def _generate_deterministic_script(
    content: str,
    title: str,
    voice_a_label: str,
    voice_b_label: str,
    mode: str,
) -> tuple[list[dict], str]:
    """Last-resort script generator when LLM is unavailable or fails.

    Used by both operating modes: isolated mode when no LLM credentials
    are configured, and upstream mode when the upstream MiniCast
    /generate-script call falls through. Splits the article content
    into ~6 short segments alternating between the two personas so the
    frontend still has a meaningful script to render.

    Output mirrors the MiniCast script segment contract:
    ``[{speaker, text}, ...]``.
    """
    import re

    text = re.sub(r"\s+", " ", content).strip()
    if not text:
        raise ValueError("cannot generate script from empty content")

    raw = re.split(r"(?<=[。！？；!?;.])", text)
    parts = [p.strip() for p in raw if p.strip()]
    if not parts:
        parts = [text[:200]]

    target = 6
    if len(parts) > target:
        step = len(parts) / target
        indices = [int(i * step) for i in range(target)]
        indices = sorted(set(min(i, len(parts) - 1) for i in indices))
        sampled = [parts[i] for i in indices]
    else:
        sampled = parts[:target]
        while len(sampled) < target and parts:
            sampled.append(parts[len(sampled) % len(parts)])

    voice_a_turns = (mode != "solo")
    segments: list[dict] = []
    for i, segment in enumerate(sampled[:target]):
        snippet = segment if len(segment) <= 90 else segment[:87] + "…"
        speaker = voice_a_label if (i % 2 == 0 or not voice_a_turns) else voice_b_label
        if i == 0:
            speaker = voice_b_label
            intro = f"欢迎收听本期播客，今天我们来聊聊《{title}》。{snippet}"
            segments.append({"speaker": speaker, "text": intro})
        elif i == target - 1 and voice_a_turns:
            speaker = voice_a_label
            outro = f"以上就是本期节目的主要内容。我们下期再见。{snippet}"
            segments.append({"speaker": speaker, "text": outro})
        else:
            segments.append({"speaker": speaker, "text": snippet})

    script_text = "\n".join(
        f"{(seg['speaker'] or 'A').upper()}: {seg['text']}" for seg in segments
    )
    return segments, script_text


async def _generate_script_via_llm(
    content: str,
    title: str,
    db: Session,
) -> tuple[list[dict], str]:
    """Rewrite the article as a 2-speaker dialogue via the page-agent
    LLM preset (deepseek). Falls back to the deterministic generator on
    any LLMUnavailable so the FAB never surfaces a hard failure.

    Returns (segments, script_text).
    """
    api_key = _get_or_default(db, "page_agent.api_key") or ""
    base_url = _get_or_default(db, "page_agent.base_url") or ""
    model = _get_or_default(db, "page_agent.model") or "deepseek-v4-flash"

    voice_a_meta = VOICE_CATALOG[DEFAULT_VOICE_A]
    voice_b_meta = VOICE_CATALOG[DEFAULT_VOICE_B]

    if not api_key or not base_url:
        _log.info("podcast script: no LLM configured, using deterministic")
        return _generate_deterministic_script(
            content=content,
            title=title,
            voice_a_label=voice_a_meta["label"],
            voice_b_label=voice_b_meta["label"],
            mode="duo",
        )

    try:
        llm_segments = await llm_generate_script(
            content=content,
            title=title,
            api_key=api_key,
            base_url=base_url,
            model=model,
        )
    except LLMUnavailable as e:
        _log.warning("podcast script LLM failed, falling back: %s", e)
        return _generate_deterministic_script(
            content=content,
            title=title,
            voice_a_label=voice_a_meta["label"],
            voice_b_label=voice_b_meta["label"],
            mode="duo",
        )

    # Translate the LLM's "A"/"B" speakers into hbsc persona labels so
    # the on-screen 「对谈脚本」 preview matches what the frontend FAB
    # shows under each role card.
    translated = [
        {
            "speaker": (
                voice_b_meta["label"]
                if seg["speaker"] == "B"
                else voice_a_meta["label"]
            ),
            "text": seg["text"],
        }
        for seg in llm_segments
    ]
    script_text = "\n".join(
        f"{seg['speaker']}: {seg['text']}" for seg in translated
    )
    return translated, script_text


# ---------------------------------------------------------------------------
# Settings helpers (mirrors public_agent_router pattern)
# ---------------------------------------------------------------------------

def _is_enabled(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in ("true", "1", "yes")


def _get_setting(db: Session, key: str) -> str | None:
    row = db.query(AdminSetting).filter_by(key=key).first()
    if not row:
        return None
    try:
        return decrypt_value(row.value_encrypted)
    except Exception:
        return None


def _get_or_default(db: Session, key: str) -> str | None:
    val = _get_setting(db, key)
    if val is not None and val != "":
        return val
    default = default_for(key)
    if default is None or default == "":
        return None
    return default


def _send(code: str, message: str, status: int, hint: Optional[str] = None) -> None:
    detail: dict[str, str] = {"code": code, "message": message}
    if hint:
        detail["hint"] = hint
    raise HTTPException(status_code=status, detail=detail)


# ---------------------------------------------------------------------------
# URL allow-list (SSRF guard)
# ---------------------------------------------------------------------------

def _is_allowed_hbsc_url(url: str) -> bool:
    """Allow only URLs that resolve back to hbsc's own domain.

    SSRF guard: a public FAB that proxies an arbitrary URL through
    MiniCast would let an attacker probe MiniCast's intranet. By
    restricting to hbsc's own articles (articles/:slug) and journals
    (issues/:slug) routes, we ensure users can only ask the assistant
    to summarize content that was already published on hbsc.
    """
    try:
        u = urlparse(url)
    except ValueError:
        return False
    if u.scheme not in ("http", "https"):
        return False
    if not u.netloc:
        return False
    path = u.path.rstrip("/")
    path_ok = (
        path.startswith("/articles/")
        or path.startswith("/issues/")
        or path == "/articles"
        or path == "/issues"
    )
    if not path_ok:
        return False
    host = (u.hostname or "").lower()
    host_ok = (
        host in ("localhost", "127.0.0.1", "::1")
        or host.startswith("192.168.")
        or host.startswith("10.")
        or (
            host.startswith("172.")
            and host.split(".", 1)[0] == "172"
            and 16 <= int(host.split(".")[1]) <= 31
        )
        or host.endswith(".hbsc.cn")
        or host == "hbsc.cn"
    )
    return host_ok


# ---------------------------------------------------------------------------
# Upstream helpers (only used in non-isolated mode)
# ---------------------------------------------------------------------------

async def _minicast_get(path: str, base_url: str, params: Optional[dict] = None) -> tuple[int, Any]:
    """GET request to MiniCast. Returns (status_code, parsed_json_or_text)."""
    url = base_url.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=MINICAST_HTTP_TIMEOUT) as client:
            r = await client.get(url, params=params or {})
    except httpx.HTTPError as e:
        _log.warning("minicast GET %s failed: %s", path, e, exc_info=True)
        _send(
            "minicast_unavailable",
            "播客服务暂不可用，请稍后重试",
            503,
            hint="你也可以打开 /labs/minicast 完整工作台手动生成",
        )
    if r.status_code >= 500:
        _send(
            "minicast_upstream_error",
            f"MiniCast 上游返回 {r.status_code}",
            502,
            hint="请检查 MiniCast 服务状态",
        )
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, r.text


async def _minicast_post(path: str, base_url: str, payload: dict) -> tuple[int, Any]:
    """POST request to MiniCast. Returns (status_code, parsed_json_or_text)."""
    url = base_url.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=MINICAST_HTTP_TIMEOUT) as client:
            r = await client.post(url, json=payload)
    except httpx.HTTPError as e:
        _log.warning("minicast POST %s failed: %s", path, e, exc_info=True)
        _send(
            "minicast_unavailable",
            "播客服务暂不可用，请稍后重试",
            503,
            hint="你也可以打开 /labs/minicast 完整工作台手动生成",
        )
    if r.status_code >= 500:
        try:
            detail = r.json().get("detail") or r.json().get("error")
        except ValueError:
            detail = r.text
        _send(
            "minicast_upstream_error",
            f"MiniCast 上游错误: {detail or r.status_code}",
            502,
            hint="请检查输入 URL 或打开 /labs/minicast 查看详情",
        )
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, r.text


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class ExtractRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def _must_be_hbsc_url(cls, v: str) -> str:
        if not _is_allowed_hbsc_url(v):
            raise ValueError(
                "URL 必须指向 hbsc 的 /articles/ 或 /issues/ 页面"
            )
        return v


class GenerateRequest(BaseModel):
    url: str
    voice_a: Optional[str] = DEFAULT_VOICE_A
    voice_b: Optional[str] = DEFAULT_VOICE_B
    title_hint: Optional[str] = None
    # Forwarded to MiniCast's generate-script endpoint; hbsc never reads it.
    mode: str = "duo"

    @field_validator("url")
    @classmethod
    def _must_be_hbsc_url(cls, v: str) -> str:
        if not _is_allowed_hbsc_url(v):
            raise ValueError(
                "URL 必须指向 hbsc 的 /articles/ 或 /issues/ 页面"
            )
        return v

    @field_validator("voice_a", "voice_b")
    @classmethod
    def _voice_must_be_known(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v not in VOICE_CATALOG:
            raise ValueError(
                f"voice 必须是 {sorted(VOICE_CATALOG.keys())} 之一"
            )
        return v


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/config")
def get_podcast_config(db: Session = Depends(get_db)) -> dict:
    """Public read of the podcast config — no auth, no leakage.

    Returns voice catalog (hbsc product naming), FAB visibility gate, and
    the current operating mode so the frontend FAB can show the correct
    fallback copy ("本地生成" vs "完整工作台").

    The frontend FAB uses ``enabled`` to decide whether to show the
    「播一下」 tab; when False the panel never surfaces the entry, so
    no user input is wasted on a broken feature.
    """
    enabled_raw = _get_or_default(db, "podcast.enabled") or "false"
    minicast_base = (
        _get_or_default(db, "podcast.minicast_base_url")
        or "http://127.0.0.1:8000"
    )
    return {
        "enabled": _is_enabled(enabled_raw),
        "mode": "isolated" if _is_isolated() else "upstream",
        "minicast_base_url": minicast_base,
        "voices": VOICE_CATALOG,
        "default_voice_a": DEFAULT_VOICE_A,
        "default_voice_b": DEFAULT_VOICE_B,
    }


@router.post("/extract")
@rate_limit(
    max_calls=RATE_LIMIT_MAX_CALLS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
    key="public_podcast_extract",
)
async def extract(
    request: Request,
    body: ExtractRequest,
    db: Session = Depends(get_db),
):
    """Step 1: 内容提取. In isolated mode this always reads from
    hbsc's own article/issue endpoint (no upstream call). In upstream
    mode it proxies to MiniCast's /api/extract and falls back to local
    if MiniCast returns empty.
    """
    raw = await request.body()
    if len(raw) > MAX_PUBLIC_PODCAST_BYTES:
        _send("payload_too_large", "请求体超过 256KB 限制", 413)

    if _is_isolated():
        try:
            content, title = await _extract_from_hbsc(body.url, request)
        except ValueError as e:
            _send(
                "extract_empty",
                "未能从当前页提取到正文",
                404,
                hint=f"{e}",
            )
        return {
            "title": title,
            "content": content,
            "char_count": len(content),
            "source_url": body.url,
            "mode": "isolated",
        }

    # Upstream mode.
    base_url = _get_or_default(db, "podcast.minicast_base_url") or "http://127.0.0.1:8000"
    _, data = await _minicast_post(
        "/api/extract", base_url, {"source": body.url, "source_type": "url"}
    )
    return {
        "title": data.get("title"),
        "content": data.get("content", ""),
        "char_count": data.get("char_count", 0),
        "source_url": data.get("source_url", body.url),
        "mode": "upstream",
    }


def _new_job_id(url: str, title: str, segment_count: int) -> str:
    """Stable, deterministic job id derived from inputs.

    Same article + same segment count ⇒ same id. This makes the FAB
    idempotent across retries (refresh, network blip, etc.) without
    needing a persistent job store.
    """
    import hashlib
    seed = f"{url}|{title}|{segment_count}".encode("utf-8")
    return "local-" + hashlib.sha1(seed).hexdigest()[:16]


@router.post("/generate")
@rate_limit(
    max_calls=RATE_LIMIT_MAX_CALLS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
    key="public_podcast_generate",
)
async def generate(
    request: Request,
    body: GenerateRequest,
    db: Session = Depends(get_db),
):
    """All-in-one: extract → script → synthesize. Returns ready-to-play job.

    In isolated mode (default) the full pipeline runs on hbsc. In
    upstream mode the three MiniCast calls are chained server-side and
    the response is forwarded verbatim.

    Errors:
        403 not_allowed_url         — URL fails the SSRF allow-list
        404 upstream_extract_empty  — no content extractable
        409 not_enabled             — admin disabled podcast.enabled
        413 payload_too_large       — raw body > 256 KB
        429 rate_limited            — 13th call within 60s for the same IP
        502 tts_failed              — local TTS pipeline failed
        503 minicast_unavailable    — upstream mode + MiniCast offline
    """
    raw = await request.body()
    if len(raw) > MAX_PUBLIC_PODCAST_BYTES:
        _send("payload_too_large", "请求体超过 256KB 限制", 413)

    if not _is_enabled(_get_or_default(db, "podcast.enabled") or "false"):
        _send("not_enabled", "播客功能未启用", 409)

    if _is_isolated():
        return await _generate_isolated(body, request, db)
    return await _generate_upstream(body, request, db)


async def _generate_isolated(
    body: GenerateRequest,
    request: Request,
    db: Session,
) -> dict:
    """Full local pipeline: extract → LLM-rewrite script → TTS."""
    # 1. Extract content directly from hbsc's own API.
    try:
        content, local_title = await _extract_from_hbsc(body.url, request)
    except ValueError as e:
        _send(
            "extract_empty",
            "未能从当前页提取到正文",
            404,
            hint=f"{e}",
        )
    title_hint = body.title_hint or local_title

    # 2. Generate script (LLM if configured, deterministic fallback
    # otherwise). The LLM call is allowed to fail without aborting the
    # whole request — the deterministic generator keeps the FAB usable.
    segments, script_text = await _generate_script_via_llm(
        content=content, title=title_hint, db=db,
    )
    segment_count = len(segments)

    # 3. Synthesize audio locally via edge-tts + ffmpeg.
    job_id = _new_job_id(body.url, title_hint, segment_count)
    try:
        synth = await local_synthesize(
            segments,
            voice_a=body.voice_a or DEFAULT_VOICE_A,
            voice_b=body.voice_b or DEFAULT_VOICE_B,
            job_id=job_id,
            output_dir=job_dir(job_id),
        )
    except PodcastTTSError as e:
        _log.warning("podcast local TTS failed for %s: %s", body.url, e)
        _send(
            "tts_failed",
            "本地音频合成失败，请稍后重试",
            502,
            hint="确认 edge-tts / ffmpeg 已安装；或打开 /labs/minicast 工作台手动生成",
        )

    total_chars = sum(len(seg.get("text", "")) for seg in segments)
    return {
        "job_id": job_id,
        "mp3_url": f"/api/public/podcast/download/{job_id}",
        "srt_url": f"/api/public/podcast/subtitle/{job_id}" if synth.srt_path else "",
        "duration_seconds": synth.duration_seconds,
        "total_chars": total_chars,
        "segment_count": segment_count,
        "script_text": script_text,
        "mode": "isolated",
        "fallback_url": (
            f"/labs/minicast/?embed=1&source={body.url}"
        ),
    }


async def _generate_upstream(
    body: GenerateRequest,
    request: Request,
    db: Session,
) -> dict:
    """Original MiniCast-proxy pipeline (preserved for upstream mode)."""
    base_url = _get_or_default(db, "podcast.minicast_base_url") or "http://127.0.0.1:8000"

    content = ""
    title_hint = body.title_hint or ""
    minicast_status, extracted = await _minicast_post(
        "/api/extract", base_url, {"source": body.url, "source_type": "url"}
    )
    if isinstance(extracted, dict) and minicast_status < 400:
        content = (extracted.get("content") or "").strip()
        if not title_hint:
            title_hint = extracted.get("title") or ""
    if not content:
        try:
            content, local_title = await _extract_from_hbsc(body.url, request)
            if not title_hint:
                title_hint = local_title
        except ValueError as e:
            _send(
                "upstream_extract_empty",
                "未能从当前页提取到正文",
                404,
                hint=f"{e}；或打开 /labs/minicast 完整工作台手动生成",
            )

    segments: list[dict] = []
    script_text = ""
    script_status, script_resp = await _minicast_post(
        "/api/generate-script",
        base_url,
        {
            "content": content,
            "mode": body.mode,
            "title_hint": title_hint,
            "model": "deepseek-v4-flash",
            "language": "zh-CN",
        },
    )
    if isinstance(script_resp, dict) and script_status < 400:
        segments = script_resp.get("segments") or []
    if segments:
        script_text_lines: list[str] = []
        for seg in segments:
            speaker = (seg.get("speaker") or "A").upper()
            text = seg.get("text") or ""
            script_text_lines.append(f"{speaker}: {text}")
        script_text = "\n".join(script_text_lines)
    else:
        voice_a_meta = VOICE_CATALOG.get(body.voice_a or DEFAULT_VOICE_A, {})
        voice_b_meta = VOICE_CATALOG.get(body.voice_b or DEFAULT_VOICE_B, {})
        try:
            segments, script_text = _generate_deterministic_script(
                content=content,
                title=title_hint or "本期话题",
                voice_a_label=voice_a_meta.get("label", "A"),
                voice_b_label=voice_b_meta.get("label", "B"),
                mode=body.mode,
            )
        except ValueError as e:
            _send(
                "upstream_script_empty",
                "生成对谈脚本失败",
                502,
                hint=f"{e}；或打开 /labs/minicast 手动调整脚本",
            )

    synth_status, synth_resp = await _minicast_post(
        "/api/synthesize",
        base_url,
        {
            "script_text": script_text,
            "mode": body.mode,
            "voice_a": body.voice_a or DEFAULT_VOICE_A,
            "voice_b": body.voice_b or DEFAULT_VOICE_B,
            "model": "speech-2.6-hd",
            "language": "zh-CN",
            "pause_seconds": 0.5,
            "intro_silence": True,
            "speed": 1.0,
            "emotion": "neutral",
        },
    )
    job_id = ""
    mp3_url = ""
    srt_url = ""
    duration_seconds = 0
    total_chars = sum(len(seg.get("text", "")) for seg in segments)
    segment_count = len(segments)
    if isinstance(synth_resp, dict) and synth_status < 400:
        job_id = synth_resp.get("job_id") or ""
        mp3_url = synth_resp.get("mp3_url") or ""
        srt_url = synth_resp.get("srt_url") or ""
        duration_seconds = synth_resp.get("duration_seconds", 0) or 0
        total_chars = synth_resp.get("total_chars", total_chars) or total_chars
        segment_count = synth_resp.get("segment_count", segment_count) or segment_count
    if not job_id:
        # Fallback to local synth so the FAB stays usable even when
        # upstream synthesize returned nothing usable.
        job_id = _new_job_id(body.url, title_hint, segment_count)
        try:
            synth = await local_synthesize(
                segments,
                voice_a=body.voice_a or DEFAULT_VOICE_A,
                voice_b=body.voice_b or DEFAULT_VOICE_B,
                job_id=job_id,
                output_dir=job_dir(job_id),
            )
            mp3_url = f"/api/public/podcast/download/{job_id}"
            srt_url = (
                f"/api/public/podcast/subtitle/{job_id}" if synth.srt_path else ""
            )
            duration_seconds = synth.duration_seconds
        except PodcastTTSError as e:
            _log.warning(
                "upstream mode + local TTS fallback failed for %s: %s",
                body.url, e,
            )

    return {
        "job_id": job_id,
        "mp3_url": mp3_url,
        "srt_url": srt_url,
        "duration_seconds": duration_seconds,
        "total_chars": total_chars,
        "segment_count": segment_count,
        "script_text": script_text,
        "mode": "upstream",
        "fallback_url": (
            f"/labs/minicast/?embed=1&source={body.url}"
        ),
    }


@router.head("/download/{job_id}", include_in_schema=False)
@router.get("/download/{job_id}")
@rate_limit(
    max_calls=RATE_LIMIT_MAX_CALLS * 5,  # audio seek = lots of small GETs
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
    key="public_podcast_download",
)
async def download(job_id: str, request: Request, db: Session = Depends(get_db)):
    """Serve the synthesized mp3 from local storage (isolated mode) or
    proxy from upstream (upstream mode).

    In isolated mode the file lives under ``<backend>/data/podcasts/<job_id>/<job_id>.mp3``
    and is served directly via FileResponse so the browser can stream it
    with Range requests intact.

    In upstream mode the file lives on the MiniCast origin; we proxy
    byte-for-byte so the browser doesn't have to talk to a different
    port directly (which may be blocked by cross-origin policies).
    """
    if _is_isolated():
        mp3_path = job_dir(job_id) / f"{job_id}.mp3"
        if not mp3_path.exists():
            _send(
                "job_not_found",
                "找不到对应的音频文件",
                404,
                hint="重新点击「开始生成」即可",
            )
        return FileResponse(
            mp3_path,
            media_type="audio/mpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # Upstream mode: stream the file from MiniCast.
    base_url = _get_or_default(db, "podcast.minicast_base_url") or "http://127.0.0.1:8000"
    upstream_url = base_url.rstrip("/") + f"/api/jobs/{job_id}/download"

    async def _stream():
        try:
            async with httpx.AsyncClient(timeout=MINICAST_HTTP_TIMEOUT) as client:
                async with client.stream("GET", upstream_url) as upstream:
                    if upstream.status_code >= 400:
                        _log.warning(
                            "minicast download %s returned %s",
                            job_id, upstream.status_code,
                        )
                        return
                    async for chunk in upstream.aiter_bytes(chunk_size=64 * 1024):
                        yield chunk
        except httpx.HTTPError as e:
            _log.warning("minicast download stream failed: %s", e, exc_info=True)
            return

    return Response(
        _stream(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.head("/subtitle/{job_id}", include_in_schema=False)
@router.get("/subtitle/{job_id}")
@rate_limit(
    max_calls=RATE_LIMIT_MAX_CALLS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
    key="public_podcast_subtitle",
)
async def subtitle(job_id: str, request: Request, db: Session = Depends(get_db)):
    """Serve the SRT subtitle. Isolated mode reads from local disk;
    upstream mode proxies from MiniCast."""
    if _is_isolated():
        srt_path = job_dir(job_id) / f"{job_id}.srt"
        if not srt_path.exists():
            _send(
                "subtitle_unavailable",
                "字幕不可用",
                404,
            )
        return FileResponse(
            srt_path,
            media_type="application/x-subrip",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    base_url = _get_or_default(db, "podcast.minicast_base_url") or "http://127.0.0.1:8000"
    upstream_url = base_url.rstrip("/") + f"/api/jobs/{job_id}/subtitle"
    try:
        async with httpx.AsyncClient(timeout=MINICAST_HTTP_TIMEOUT) as client:
            r = await client.get(upstream_url)
    except httpx.HTTPError as e:
        _log.warning("minicast subtitle %s failed: %s", job_id, e, exc_info=True)
        _send("minicast_unavailable", "字幕下载失败", 503)
    if r.status_code >= 400:
        _send(
            "subtitle_unavailable",
            f"字幕不可用 (HTTP {r.status_code})",
            404,
        )
    return Response(
        content=r.content,
        media_type="application/x-subrip",
        headers={"Cache-Control": "public, max-age=3600"},
    )


__all__ = [
    "router",
    "MAX_PUBLIC_PODCAST_BYTES",
    "VOICE_CATALOG",
    "DEFAULT_VOICE_A",
    "DEFAULT_VOICE_B",
    "_is_isolated",
    "_is_allowed_hbsc_url",  # exposed for tests
]
