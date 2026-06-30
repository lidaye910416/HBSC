"""Unit tests for the markdown typesetter service.

We monkey-patch ``chat_complete`` so the LLM never actually runs.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Import the model registry & each model so AdminSetting is registered with
# ``Base.metadata`` before we call create_all(...).
from app.models.base import Base  # noqa: F401 — registers Base for the app
from app.models import admin_setting as _admin_setting_model  # noqa: F401
from app.models.admin_setting import AdminSetting
from app.services.crypto import encrypt_value
from app.services import markdown_typesetter
from app.services.markdown_typesetter import (
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    TypesetError,
    typeset_markdown,
)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    rows = {
        "article_typesetter.enabled": ("true", False),
        "article_typesetter.api_key": ("sk-test-1234567890", True),
        "article_typesetter.model": ("my-custom-model", False),
        "article_typesetter.base_url": ("https://llm.example.com/v1", False),
        "article_typesetter.system_prompt": ("你只清洗 Markdown，不要润色。", False),
    }
    for k, (v, secret) in rows.items():
        s.add(AdminSetting(key=k, value_encrypted=encrypt_value(v), is_secret=secret))
    s.commit()
    yield s
    s.close()


def _patched_chat(monkeypatch, return_value: str):
    calls = []

    async def fake(base_url, api_key, model, messages, *, timeout=30.0):
        calls.append(
            {"base_url": base_url, "api_key": api_key, "model": model, "messages": messages}
        )
        return return_value

    monkeypatch.setattr(markdown_typesetter, "chat_complete", fake)
    return calls


def test_typeset_returns_cleaned_markdown(db, monkeypatch):
    calls = _patched_chat(monkeypatch, return_value="# 标题\n\n正文段落。")
    result = _run(typeset_markdown("## 标题\n\n  正文段落.   ", db=db))
    assert result.content_markdown == "# 标题\n\n正文段落。"
    assert result.warnings == []
    assert result.model == "my-custom-model"
    assert calls[0]["api_key"] == "sk-test-1234567890"
    assert calls[0]["base_url"] == "https://llm.example.com/v1"
    assert any(
        "你只清洗 Markdown" in m["content"]
        for m in calls[0]["messages"]
        if m["role"] == "system"
    )


def test_typeset_strips_markdown_fences(db, monkeypatch):
    _patched_chat(monkeypatch, return_value="```markdown\n# 标题\n\n正文\n```\n")
    result = _run(typeset_markdown("原文", db=db))
    assert result.content_markdown.strip() == "# 标题\n\n正文"
    assert not result.content_markdown.startswith("```")


def test_typeset_truncates_long_input(db, monkeypatch):
    calls = _patched_chat(monkeypatch, return_value="# 短")
    long_input = "中" * 50_000  # 50k chars > 32k cap
    result = _run(typeset_markdown(long_input, db=db))
    assert any("截断" in w for w in result.warnings)
    # The user message forwarded to LLM must be truncated to MAX_INPUT_CHARS
    user_msg = calls[0]["messages"][-1]["content"]
    assert len(user_msg) <= 32_000


def test_typeset_falls_back_to_defaults(db, monkeypatch):
    # Keep enabled + api_key (so the service proceeds), delete the
    # optional model / base_url / system_prompt rows so the defaults must kick in.
    db.query(AdminSetting).filter(
        AdminSetting.key.in_([
            "article_typesetter.model",
            "article_typesetter.base_url",
            "article_typesetter.system_prompt",
        ])
    ).delete()
    db.commit()
    calls = _patched_chat(monkeypatch, return_value="hello")
    _run(typeset_markdown("任何内容", db=db))
    assert calls[0]["model"] == DEFAULT_MODEL
    assert calls[0]["base_url"] == DEFAULT_BASE_URL
    assert DEFAULT_SYSTEM_PROMPT and "Markdown" in DEFAULT_SYSTEM_PROMPT


def test_typeset_disabled_raises(db, monkeypatch):
    db.query(AdminSetting).filter(AdminSetting.key == "article_typesetter.enabled").update(
        {AdminSetting.value_encrypted: encrypt_value("false")}
    )
    db.commit()
    with pytest.raises(TypesetError) as exc:
        _run(typeset_markdown("any", db=db))
    assert exc.value.code == "not_enabled"


def test_typeset_missing_api_key_raises(db, monkeypatch):
    db.query(AdminSetting).filter(AdminSetting.key == "article_typesetter.api_key").delete()
    db.commit()
    with pytest.raises(TypesetError) as exc:
        _run(typeset_markdown("any", db=db))
    assert exc.value.code == "no_api_key"
