"""Unit tests for backend/app/services/page_agent_config.py."""
import pytest
from urllib.parse import urlparse

from app.services.page_agent_config import (
    _load_chat_config,
    _is_allowed_url,
    ChatConfig,
)


class FakeResult:
    """Mimics the DB row returned by ``_load_chat_config``."""
    def __init__(self, rows):
        self._rows = {k: v for k, v in rows.items()}
    def get(self, key, default=None):
        return self._rows.get(key, default)


def test_load_chat_config_returns_required_fields():
    cfg = _load_chat_config({
        "page_agent.enabled": "true",
        "page_agent.model": "deepseek-v4-flash",
        "page_agent.base_url": "https://api.deepseek.com/v1",
        "page_agent.api_key": "sk-test-key",
    })
    assert isinstance(cfg, ChatConfig)
    assert cfg.model == "deepseek-v4-flash"
    assert cfg.base_url == "https://api.deepseek.com/v1"
    assert cfg.api_key == "sk-test-key"


def test_load_chat_config_rejects_disabled():
    with pytest.raises(ValueError, match="not_enabled"):
        _load_chat_config({"page_agent.enabled": "false", "page_agent.api_key": "sk-x"})


def test_load_chat_config_rejects_missing_api_key():
    with pytest.raises(ValueError, match="no_api_key"):
        _load_chat_config({"page_agent.enabled": "true"})


def test_load_chat_config_requires_https_for_dom():
    cfg = _load_chat_config({
        "page_agent.enabled": "true",
        "page_agent.api_key": "sk-x",
        "page_agent.base_url": "http://api.deepseek.com/v1",   # http!
    })
    with pytest.raises(ValueError, match="dom_requires_https"):
        _load_chat_config(
            {k: v for k, v in cfg.__dict__.items() if k != "api_key"} | {"page_agent.api_key": "sk-x"},
            mode="dom",
        )


def test_is_allowed_url_strict_match():
    base = "https://api.deepseek.com/v1"
    assert _is_allowed_url("https://api.deepseek.com/v1/chat/completions", base) is True
    assert _is_allowed_url("https://api.deepseek.com/v2/chat/completions", base) is False
    assert _is_allowed_url("http://api.deepseek.com/v1/chat/completions", base) is False
    assert _is_allowed_url("https://evil.com/v1/chat/completions", base) is False
    assert _is_allowed_url("https://api.deepseek.com.evil.com/v1/chat/completions", base) is False
    assert _is_allowed_url("https://api.deepseek.com:8443/v1/chat/completions", base) is False