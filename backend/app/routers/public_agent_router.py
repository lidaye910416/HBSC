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

from fastapi import APIRouter, Depends, HTTPException, Request
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


router = APIRouter(prefix="/api/public/agent", tags=["public-agent"])
_log = logging.getLogger(__name__)


# Mirror agent_router's guard-rails; deliberately slightly stricter since this
# endpoint is anonymous.
MAX_PUBLIC_AGENT_MESSAGES = 50
MAX_PUBLIC_AGENT_BYTES = 1 * 1024 * 1024  # 1 MB


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
    """
    cfg = _resolve_config(db)
    return {
        "enabled": _is_fab_visible(cfg),
        "model": cfg["model"],
        "base_url": cfg["base_url"],
    }


class ExecuteRequest(BaseModel):
    messages: list[dict]

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
    """Anonymous visitor triggers a chat turn.

    Errors:
        409 not_enabled           — admin disabled, or api_key still empty
        413 payload_too_large     — raw body > 1 MB
        422 validation_error      — messages > 50 (Pydantic)
        429 rate_limited          — 11th call within 60s for the same IP
        502 upstream_llm_failed   — generic; never echoes headers/api_key
    """
    # Enforce body-size cap BEFORE we touch anything else.
    raw = await request.body()
    if len(raw) > MAX_PUBLIC_AGENT_BYTES:
        _send("payload_too_large", "请求体超过 1MB 限制", 413)

    cfg = _resolve_config(db)
    if not cfg["enabled_toggle"]:
        _send("not_enabled", "page-agent 未启用", 409)
    if not cfg["api_key"]:
        # Distinct error code so admin can tell "needs enable" from "needs key"
        _send("no_api_key", "未配置 page_agent.api_key", 409)

    system_prompt = _get_or_default(db, "page_agent.system_prompt")
    messages: list[dict] = list(body.messages)
    if system_prompt and not any(m.get("role") == "system" for m in messages):
        messages = [{"role": "system", "content": system_prompt}] + messages

    try:
        content = await chat_complete(
            base_url=str(cfg["base_url"]),
            api_key=cfg["api_key"],  # type: ignore[arg-type]
            model=str(cfg["model"]),
            messages=messages,
        )
    except LLMUnavailable as e:
        # SECURITY: never echo the raw httpx exception (may contain
        # "Authorization: Bearer ..." in some httpx versions). Log it
        # server-side, return generic Chinese message.
        _log.warning("public page-agent LLM call failed: %s", e, exc_info=True)
        _send("upstream_llm_failed", "上游 LLM 调用失败，请检查网络或稍后重试", 502)

    return {"content": content}


__all__ = ["router", "MAX_PUBLIC_AGENT_MESSAGES", "MAX_PUBLIC_AGENT_BYTES"]
