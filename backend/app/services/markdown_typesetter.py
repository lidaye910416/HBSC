"""Server-side markdown typesetter.

Reads ``article_typesetter.*`` AdminSetting keys, truncates oversized input,
calls the OpenAI-compatible ``chat_complete`` once, and strips accidental
markdown code fences from the response.

Defaults live in ``app.services.admin_setting_defaults`` so the settings UI
can show the same preset the service will fall back to.

The router converts all ``TypesetError`` / ``LLMUnavailable`` exceptions to
the project's standard ``{"error": {"code", "message"}}`` envelope, so the
service intentionally raises rather than returning HTTP objects.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from .crypto import decrypt_value
from .llm_client import chat_complete  # re-exported so tests can monkeypatch the bound name
from .llm_client import LLMUnavailable  # noqa: F401  (re-export for downstream routers)
from ..models.admin_setting import AdminSetting
from .admin_setting_defaults import (
    KNOWN_KEYS_DEFAULTS,
    default_for,
    DEFAULT_SYSTEM_PROMPT,
)


# Re-exports so existing tests/routers can still import these names.
DEFAULT_ENABLED = KNOWN_KEYS_DEFAULTS["article_typesetter.enabled"][0]
DEFAULT_MODEL = KNOWN_KEYS_DEFAULTS["article_typesetter.model"][0]
DEFAULT_BASE_URL = KNOWN_KEYS_DEFAULTS["article_typesetter.base_url"][0]


# Cap at 32k Python characters; trimming happens BEFORE the LLM call so we
# never blow past the upstream context window.
MAX_INPUT_CHARS = 32_000


# ----- Exceptions -------------------------------------------------------------
class TypesetError(Exception):
    """Service-level failure raised for the router to map to HTTP."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ----- DTO --------------------------------------------------------------------
@dataclass
class TypesetResult:
    content_markdown: str
    warnings: list[str] = field(default_factory=list)
    model: str = ""
    prompt_version: str = ""  # byte-length of system_prompt; mirrors admin setting changes


# ----- Helpers ----------------------------------------------------------------
def _get_setting(db: Session, key: str) -> str | None:
    """Read setting from DB. Returns None if row missing or decrypt fails."""
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


def _is_enabled(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in ("true", "1", "yes")


def _strip_fences(text: str) -> str:
    """Remove leading ```markdown and trailing ``` if both present."""
    s = text.strip()
    if not s.startswith("```"):
        return s.strip()
    first_nl = s.find("\n")
    if first_nl == -1:
        # Single-line ```markdown\n``` case (rare)
        return ""
    s = s[first_nl + 1 :]
    if s.rstrip().endswith("```"):
        idx = s.rfind("```")
        s = s[:idx].rstrip()
    return s.strip()


def _strip_think_block(text: str) -> str:
    """Strip MiniMax/MiniMax-style reasoning tags when they're leaked into
    the assistant's visible content.

    Two variants are emitted by these reasoning models on the same
    OpenAI-compatible surface:
      1. ````…````  (a fenced-thinking block)
      2. ``…``  (a bare tag, not fenced)

    Both belong to the same family of "chain-of-thought leakage". The
    system prompt we send already forbids any preamble or annotation, so
    these blocks are noise from the admin's perspective. Strip them.
    """
    import re
    if not text:
        return text
    # Variant 1: ```thinking / ``` block at the start, optional fence
    text = re.sub(r"^\s*```(?:thinking|think)?\n.*?\n```\s*\n?", "", text, count=1, flags=re.DOTALL)
    # Variant 2: bare  reasoning tag at the start (closing tag may or
    # may not appear depending on truncation). Match opening tag greedily
    # up to first matching close OR a long stretch that looks like content.
    text = re.sub(
        r"^\s*<(?:think|thinking|reasoning|reason)>[\s\S]*?(?:</(?:think|thinking|reasoning|reason)>|$)",
        "",
        text,
        count=1,
    )
    return text.lstrip()


def _resolve_config(db: Session) -> tuple[str, str, str, str]:
    """Return (api_key, model, base_url, system_prompt). Raises TypesetError on missing required keys."""
    # enabled: default is "true" (article_typesetter is on by default in this
    # project). Only the api_key is non-defaultable.
    enabled_raw = _get_or_default(db, "article_typesetter.enabled") or DEFAULT_ENABLED
    if not _is_enabled(enabled_raw):
        raise TypesetError("not_enabled", "AI 排版未启用")

    # api_key has NO usable preset default — the admin must enter one.
    api_key = _get_setting(db, "article_typesetter.api_key")
    if not api_key:
        raise TypesetError("no_api_key", "未配置 article_typesetter.api_key")

    model = _get_or_default(db, "article_typesetter.model") or DEFAULT_MODEL
    base_url = _get_or_default(db, "article_typesetter.base_url") or DEFAULT_BASE_URL
    system_prompt = _get_or_default(db, "article_typesetter.system_prompt") or DEFAULT_SYSTEM_PROMPT
    return api_key, model, base_url, system_prompt


# ----- Entry point ------------------------------------------------------------
async def typeset_markdown(content: str, *, db: Session) -> TypesetResult:
    """Clean ``content`` via the configured typesetter LLM."""
    api_key, model, base_url, system_prompt = _resolve_config(db)

    warnings: list[str] = []
    user_content = content or ""
    if len(user_content) > MAX_INPUT_CHARS:
        user_content = user_content[:MAX_INPUT_CHARS]
        warnings.append(f"原文超过 {MAX_INPUT_CHARS} 字符，已截断")

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    raw = await chat_complete(
        base_url=base_url,
        api_key=api_key,
        model=model,
        messages=messages,
        # Reason: MiniMax's reasoning models leak ```` and ``
        # tags into the visible content, and their first-token latency
        # can run to 60+ seconds on long inputs. 90s gives a comfortable
        # margin while still failing fast enough for the admin UX.
        timeout=90.0,
    )

    cleaned = _strip_fences(_strip_think_block(raw or ""))
    if not cleaned:
        warnings.append("模型返回为空，请重试或更换模型")

    return TypesetResult(
        content_markdown=cleaned,
        warnings=warnings,
        model=model,
        prompt_version=str(len(system_prompt.encode("utf-8"))),
    )
