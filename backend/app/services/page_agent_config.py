"""Shared settings-loader for the page-agent endpoints (chat + LLM proxy).

Centralised so that ``public_agent_router.execute`` and the new
``public_agent_router.agent_llm`` endpoint both read the same way and
enforce the same mode-specific guards. The model is intentionally a tiny
plain dataclass — admin setting rows are the SoT and what admin stores
is what gets read.
"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class ChatConfig:
    model: str
    base_url: str
    api_key: str


class PageAgentConfigError(ValueError):
    """Raised by ``_load_chat_config`` when the admin-visible gate fails.

    Each error carries a stable ``code`` matching the {error.code} envelope
    that the public router already returns (so the frontend toasts the
    right remediation hint).
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _is_enabled(value: str | None) -> bool:
    if value is None or value == "":
        return True
    return value.strip().lower() in ("true", "1", "yes")


def _load_chat_config(rows: dict, *, mode: str = "chat") -> ChatConfig:
    """Lift settings rows (or a synthesised default-dict) into a ChatConfig.

    ``rows`` is a key→decrypted-value dict (read by the caller). This
    function enforces the gate that both ``/agent/execute`` and
    ``/agent/llm`` share (admin toggle + non-empty key), plus the
    ``dom_requires_https_base_url`` check for the LLM proxy mode.
    """
    if not rows:
        raise PageAgentConfigError("not_enabled", "[not_enabled] page-agent 未启用")
    enabled_raw = rows.get("page_agent.enabled", "")
    if not _is_enabled(enabled_raw):
        raise PageAgentConfigError("not_enabled", "[not_enabled] page-agent 未启用")
    api_key = rows.get("page_agent.api_key") or ""
    if not api_key:
        raise PageAgentConfigError("no_api_key", "[no_api_key] 未配置 page_agent.api_key")
    base_url = rows.get("page_agent.base_url", "")
    if mode == "dom" and not base_url.startswith("https://"):
        raise PageAgentConfigError(
            "dom_requires_https_base_url",
            "[dom_requires_https_base_url] DOM 模式要求 base_url 为 https",
        )
    model = rows.get("page_agent.model") or "deepseek-v4-flash"
    return ChatConfig(model=model, base_url=base_url, api_key=api_key)


def _is_allowed_url(target: str, base_url: str) -> bool:
    """Strictly match ``target`` against ``base_url`` (scheme+host+port+path).

    Defends against DNS-rebinding suffix tricks (e.g.
    ``evil.com/api.deepseek.com/``). The scheme must be https for both;
    host names are an exact (case-insensitive) string match; ports must
    match (or both be the https default); the path must be a prefix of
    the configured base URL.
    """
    try:
        a = urlparse(target)
        b = urlparse(base_url)
    except ValueError:
        return False
    if a.scheme != "https" or b.scheme != "https":
        return False
    if (a.hostname or "").lower() != (b.hostname or "").lower():
        return False
    if (a.port or 443) != (b.port or 443):
        return False
    return (a.path or "").startswith(b.path.rstrip("/") + "/") or a.path == b.path


__all__ = ["ChatConfig", "PageAgentConfigError", "_load_chat_config", "_is_allowed_url"]