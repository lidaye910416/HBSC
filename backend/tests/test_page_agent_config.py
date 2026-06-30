"""Unit tests for backend/app/services/page_agent_config.py."""
import pytest

from app.services.page_agent_config import (
    is_allowed_url,
    load_chat_config,
    ChatConfig,
)


def test_load_chat_config_returns_required_fields():
    cfg = load_chat_config({
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
        load_chat_config({"page_agent.enabled": "false", "page_agent.api_key": "sk-x"})


def test_load_chat_config_rejects_missing_api_key():
    with pytest.raises(ValueError, match="no_api_key"):
        load_chat_config({"page_agent.enabled": "true"})


def test_load_chat_config_requires_https_for_dom():
    """Dom mode requires https:// base_url; http:// is rejected with a clear error code."""
    rows = {
        "page_agent.enabled": "true",
        "page_agent.api_key": "sk-x",
        "page_agent.base_url": "http://api.deepseek.com/v1",   # http!
    }
    with pytest.raises(ValueError, match="dom_requires_https"):
        load_chat_config(rows, mode="dom")


def test_load_chat_config_accepts_https_for_dom():
    """Dom mode accepts https:// base_url (positive case for the https gate)."""
    rows = {
        "page_agent.enabled": "true",
        "page_agent.api_key": "sk-x",
        "page_agent.base_url": "https://api.deepseek.com/v1",
    }
    cfg = load_chat_config(rows, mode="dom")
    assert cfg.base_url == "https://api.deepseek.com/v1"


def test_is_allowed_url_strict_match():
    base = "https://api.deepseek.com/v1"
    assert is_allowed_url("https://api.deepseek.com/v1/chat/completions", base) is True
    assert is_allowed_url("https://api.deepseek.com/v2/chat/completions", base) is False
    assert is_allowed_url("http://api.deepseek.com/v1/chat/completions", base) is False
    assert is_allowed_url("https://evil.com/v1/chat/completions", base) is False
    assert is_allowed_url("https://api.deepseek.com.evil.com/v1/chat/completions", base) is False
    assert is_allowed_url("https://api.deepseek.com:8443/v1/chat/completions", base) is False