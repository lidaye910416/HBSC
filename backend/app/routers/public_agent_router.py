"""Public page-agent proxy for the public homepage FAB.

NO admin auth — this router is intended for anonymous visitors of the public
site. It reuses:

- `chat_complete` from `llm_client` (OpenAI-compatible /chat/completions)
- `rate_limit` middleware (per-IP, in-memory bucket)
- The same `page_agent.*` AdminSetting rows as the admin `agent_router`

Security guards:
- Never returns the api_key (in /config OR /execute responses).
- Never echoes `httpx` exception strings (which can include Authorization
  headers) — log full detail server-side, return generic Chinese 502.
- Body cap (1 MB) enforced at the raw request layer before Pydantic
  validation to avoid parsing huge payloads.
- Messages cap (50) mirrors the admin endpoint to prevent prompt stuffing.
"""
from __future__ import annotations

import logging
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.admin_setting import AdminSetting
from ..services.crypto import decrypt_value
from ..services.llm_client import chat_complete  # re-exported so tests can monkeypatch the bound name
from ..services.llm_client import LLMUnavailable  # noqa: F401  (re-export for downstream routers)
from ..middleware.rate_limit import rate_limit
from ..services.admin_setting_defaults import (
    KNOWN_KEYS_DEFAULTS,
    default_for,
)
from ..services.page_agent_config import (
    ChatConfig,
    PageAgentConfigError,
    load_chat_config,
    is_allowed_url,
)


router = APIRouter(prefix="/api/public/agent", tags=["public-agent"])
_log = logging.getLogger(__name__)


# Mirror agent_router's guard-rails; deliberately slightly stricter since this
# endpoint is anonymous.
MAX_PUBLIC_AGENT_MESSAGES = 50
MAX_PUBLIC_AGENT_BYTES = 1 * 1024 * 1024  # 1 MB
MAX_PUBLIC_AGENT_LLM_BYTES = 2 * 1024 * 1024  # 2 MB (dom — tools schema makes bodies larger)


def _is_enabled(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in ("true", "1", "yes")


def _get_setting(db: Session, key: str) -> str | None:
    """Read setting from DB. Returns None if row missing or decrypt fails.

    Independent of `agent_router._get_setting` — duplicated to keep the two
    routers self-contained (admin auth boundary; no admin dep here).
    """
    row = db.query(AdminSetting).filter_by(key=key).first()
    if not row:
        return None
    try:
        return decrypt_value(row.value_encrypted)
    except Exception:
        return None


def _get_or_default(db: Session, key: str) -> str | None:
    """Read setting or fall back to the preset default in admin_setting_defaults.

    Returns None ONLY when there is no preset default (i.e. unknown key) OR
    when the preset default is the empty string (e.g. api_key pre-input).
    """
    val = _get_setting(db, key)
    if val is not None and val != "":
        return val
    default = default_for(key)
    if default is None or default == "":
        return None
    return default


def _resolve_config(db: Session) -> dict[str, str | bool]:
    """Read raw config from `page_agent.*` rows (admin-managed).

    The `enabled` flag returned by `/config` is the FAB-visibility gate:
    True ONLY when both the toggle is on AND a non-empty api_key exists.
    Without a key, the FAB must not render — we don't want to confuse
    visitors with a non-functional widget.

    The error envelope returned by `/execute` distinguishes the two
    409 cases (not_enabled vs no_api_key) so the admin can debug from
    logs / browser console which one is missing.
    """
    enabled_raw = _get_or_default(db, "page_agent.enabled") or "false"
    api_key = _get_setting(db, "page_agent.api_key")
    model = _get_or_default(db, "page_agent.model") or default_for("page_agent.model") or ""
    base_url = _get_or_default(db, "page_agent.base_url") or default_for("page_agent.base_url") or ""
    return {
        "enabled_toggle": _is_enabled(enabled_raw),
        "has_api_key": bool(api_key),
        "model": model,
        "base_url": base_url,
        "api_key": api_key,
    }


def _is_fab_visible(cfg: dict) -> bool:
    """`/config` returns True only when the FAB should appear."""
    return bool(cfg["enabled_toggle"]) and bool(cfg["has_api_key"])


# ----- Endpoints -----------------------------------------------------------

@router.get("/config")
def get_public_agent_config(db: Session = Depends(get_db)):
    """Public read of the page-agent config — no auth, no api_key leakage.

    `enabled` is True ONLY when the admin has set `page_agent.enabled=true`
    AND configured a non-empty api_key. Without a key, the FAB does not
    render — we don't want to confuse visitors with a non-functional widget.

    `system_prompt` is exposed so the front-end PageAgent instance can
    forward it via `customSystemPrompt` — without it the safety rails
    appended in admin_setting_defaults never reach the LLM.
    """
    cfg = _resolve_config(db)
    return {
        "enabled": _is_fab_visible(cfg),
        "model": cfg["model"],
        "base_url": cfg["base_url"],
        "system_prompt": _get_or_default(db, "page_agent.system_prompt") or "",
    }


class ExecuteRequest(BaseModel):
    mode: Literal["chat", "dom"] = "chat"
    messages: list[dict] = []

    @field_validator("messages")
    @classmethod
    def _cap_messages(cls, v: list[dict]) -> list[dict]:
        if len(v) > MAX_PUBLIC_AGENT_MESSAGES:
            raise ValueError(f"messages 长度超过最大限制 {MAX_PUBLIC_AGENT_MESSAGES}")
        return v


def _send(code: str, message: str, status: int) -> None:
    """Project-standard {error:{code,message}} error envelope."""
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


@router.post("/execute")
@rate_limit(max_calls=10, window_seconds=60)
async def execute_public_llm(
    request: Request,
    body: ExecuteRequest,
    db: Session = Depends(get_db),
):
    """Anonymous visitor triggers a chat turn (mode='chat' default).

    When mode='dom' the client SHOULD bypass this endpoint and call
    /api/public/agent/llm directly through the page-agent customFetch hook.
    Accepting mode='dom' here is only kept for compatibility — it must
    carry a non-empty tools array; otherwise 422.

    Errors:
        409 not_enabled           — admin disabled, or api_key still empty
        413 payload_too_large     — raw body > 1 MB
        422 validation_error      — messages > 50 (Pydantic) / bad mode /
                                    dom mode without tools (use /llm instead)
        429 rate_limited          — 11th call within 60s for the same IP
        502 upstream_llm_failed   — generic; never echoes headers/api_key
    """
    # Enforce body-size cap BEFORE we touch anything else.
    raw = await request.body()
    if len(raw) > MAX_PUBLIC_AGENT_BYTES:
        _send("payload_too_large", "请求体超过 1MB 限制", 413)

    if body.mode == "dom":
        # Defensive: refuse dom without tools schema even via this route.
        # The dom path lives at /api/public/agent/llm, so any dom call here
        # is a malformed client; respond with a clear 422.
        raise HTTPException(
            status_code=422,
            detail={"code": "tools_required_for_dom",
                    "message": "dom 模式必须通过 /api/public/agent/llm 调用并提供 tools schema"},
        )

    # Shared gate-check via the helper module (Important #4 fix from Task 2 review).
    rows = {
        "page_agent.enabled":  _get_or_default(db, "page_agent.enabled") or "",
        "page_agent.api_key":  _get_setting(db, "page_agent.api_key") or "",
        "page_agent.base_url": _get_or_default(db, "page_agent.base_url") or "",
        "page_agent.model":    _get_or_default(db, "page_agent.model") or "",
    }
    try:
        cfg = load_chat_config(rows, mode="chat")
    except PageAgentConfigError as e:
        _send(e.code, str(e), 409)

    system_prompt = _get_or_default(db, "page_agent.system_prompt")
    messages: list[dict] = list(body.messages)
    if system_prompt and not any(m.get("role") == "system" for m in messages):
        messages = [{"role": "system", "content": system_prompt}] + messages

    try:
        content = await chat_complete(
            base_url=cfg.base_url,
            api_key=cfg.api_key,
            model=cfg.model,
            messages=messages,
        )
    except LLMUnavailable as e:
        # SECURITY: never echo the raw httpx exception (may contain
        # "Authorization: Bearer ..." in some httpx versions). Log it
        # server-side, return generic Chinese message.
        _log.warning("public page-agent LLM call failed: %s", e, exc_info=True)
        _send("upstream_llm_failed", "上游 LLM 调用失败，请检查网络或稍后重试", 502)

    return {"content": content}


# =============================================================================
# Plan Task 2: /api/public/agent/llm — OpenAI proxy used by DOM-mode page-agent
# =============================================================================

class AgentLLMRequest(BaseModel):
    url: str
    init: dict


def _is_same_origin_referer(referer: str | None, expected_host: str) -> bool:
    """Accept empty Referer (curl, native fetch); reject cross-origin Referer."""
    if not referer:
        return True
    try:
        return urlparse(referer).hostname == expected_host
    except ValueError:
        return False


@router.post("/llm")
@rate_limit(max_calls=5, window_seconds=60)
async def agent_llm(
    request: Request,
    body: AgentLLMRequest,
    db: Session = Depends(get_db),
):
    """Proxy a page-agent OpenAI /chat/completions call to the configured LLM.

    Body schema:
        {
          "url": "<absolute upstream URL — must match page_agent.base_url>",
          "init": {
            "method": "POST",
            "headers": { ... non-Authorization headers ... },
            "body": "<raw JSON or other string>"
          }
        }

    Security guards (anonymous DOM proxy):
      409 not_enabled / no_api_key           — page_agent.* admin gates
      409 dom_requires_https_base_url        — base_url must be https
      403 url_not_allowed                    — URL strict match fails
      403 referer_not_allowed                — cross-origin Referer
      413 payload_too_large                  — raw body > 2 MB
      429 rate_limited                       — 6th call within 60s
      502 upstream_llm_failed                — generic; never echoes headers / api_key
    """
    raw = await request.body()
    if len(raw) > MAX_PUBLIC_AGENT_LLM_BYTES:
        _send("payload_too_large", "请求体超过 2MB 限制", 413)

    rows = {
        "page_agent.enabled":  _get_or_default(db, "page_agent.enabled") or "",
        "page_agent.api_key":  _get_setting(db, "page_agent.api_key") or "",
        "page_agent.base_url": _get_or_default(db, "page_agent.base_url") or "",
        "page_agent.model":    _get_or_default(db, "page_agent.model") or "",
    }
    try:
        cfg = load_chat_config(rows, mode="dom")
    except PageAgentConfigError as e:
        _send(e.code, str(e), 409)

    if not is_allowed_url(body.url, cfg.base_url):
        _send("url_not_allowed", "上游 URL 不在 base_url 白名单内", 403)

    base_host = urlparse(cfg.base_url).hostname or ""
    referer = request.headers.get("referer")
    if not _is_same_origin_referer(referer, base_host):
        _send("referer_not_allowed", "Referer 不匹配同源", 403)

    # ALSO bound the upstream body so a small wrapper around a huge body can't bypass.
    upstream_body = (body.init or {}).get("body") or ""
    if isinstance(upstream_body, str) and len(upstream_body.encode("utf-8")) > MAX_PUBLIC_AGENT_LLM_BYTES:
        _send("payload_too_large", "上游请求体超过 2MB 限制", 413)

    upstream_init = dict(body.init or {})
    upstream_init.setdefault("method", "POST")
    # Strip any Authorization the client tried to smuggle; we inject our own.
    headers = {k: v for k, v in (upstream_init.get("headers") or {}).items()
               if k.lower() != "authorization"}
    headers["Authorization"] = f"Bearer {cfg.api_key}"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            upstream_req = client.build_request(
                upstream_init["method"], body.url, headers=headers,
                content=upstream_init.get("body"),
            )
            resp = await client.send(upstream_req, stream=False)
            content = resp.content
            upstream_status = resp.status_code
            # Only forward safe headers; drop hop-by-hop.
            response_headers = {
                k: v for k, v in resp.headers.items()
                if k.lower() not in {"connection", "keep-alive", "proxy-authenticate",
                                     "proxy-authorization", "te", "trailers",
                                     "transfer-encoding", "upgrade"}
            }
    except httpx.HTTPError as e:
        # SECURITY: never echo the raw httpx exception (may contain
        # "Authorization: Bearer ..." in some httpx versions). Log it
        # server-side, return generic Chinese 502.
        _log.warning("agent_llm upstream failed: %s", e, exc_info=True)
        _send("upstream_llm_failed", "上游 LLM 调用失败，请检查网络或稍后重试", 502)

    return Response(
        content=content,
        status_code=upstream_status,
        headers=response_headers,
        media_type=response_headers.get("content-type"),
    )


__all__ = [
    "router",
    "MAX_PUBLIC_AGENT_MESSAGES",
    "MAX_PUBLIC_AGENT_BYTES",
    "MAX_PUBLIC_AGENT_LLM_BYTES",
]
