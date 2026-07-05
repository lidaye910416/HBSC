"""Tests for the AI-typeset ``style`` parameter.

The style param lets the admin pick a voice for the LLM (academic / business
/ concise). Each style must append a distinct instruction block to the
system_prompt, and the resulting ``prompt_version`` must reflect the change.

We mock ``chat_complete`` and inspect the messages arg directly, so this
stays a pure unit test (no LLM calls).
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base  # noqa: F401
from app.models import admin_setting as _admin_setting_model  # noqa: F401
from app.models.admin_setting import AdminSetting
from app.services.crypto import encrypt_value
from app.services import markdown_typesetter
from app.services.markdown_typesetter import typeset_markdown


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
        "article_typesetter.model": ("test-model", False),
        "article_typesetter.base_url": ("https://llm.example.com/v1", False),
        "article_typesetter.system_prompt": ("BASE_SYSTEM", False),
    }
    for k, (v, secret) in rows.items():
        s.add(AdminSetting(key=k, value_encrypted=encrypt_value(v), is_secret=secret))
    s.commit()
    yield s
    s.close()


def _patched_chat(monkeypatch, return_value: str):
    calls = []

    async def fake(base_url, api_key, model, messages, *, timeout=30.0):
        calls.append({"messages": messages})
        return return_value

    monkeypatch.setattr(markdown_typesetter, "chat_complete", fake)
    return calls


def test_typeset_default_style_leaves_system_prompt_unchanged(db, monkeypatch):
    """When no style is supplied, the base system_prompt is used verbatim
    — backwards compatible with existing callers."""
    calls = _patched_chat(monkeypatch, return_value="# ok")
    result = _run(typeset_markdown("x", db=db))
    sys = calls[0]["messages"][0]["content"]
    assert sys == "BASE_SYSTEM"
    # prompt_version reflects the un-styled byte length
    assert result.prompt_version == str(len("BASE_SYSTEM".encode("utf-8")))


def test_typeset_style_academic_appends_academic_block(db, monkeypatch):
    calls = _patched_chat(monkeypatch, return_value="# ok")
    result = _run(typeset_markdown("x", db=db, style="academic"))
    sys = calls[0]["messages"][0]["content"]
    assert sys.startswith("BASE_SYSTEM")
    assert "academic" in sys.lower()
    # Distinct prompt_version from default
    assert result.prompt_version != str(len("BASE_SYSTEM".encode("utf-8")))
    assert int(result.prompt_version) > len("BASE_SYSTEM".encode("utf-8"))


def test_typeset_style_business_appends_business_block(db, monkeypatch):
    calls = _patched_chat(monkeypatch, return_value="# ok")
    _run(typeset_markdown("x", db=db, style="business"))
    sys = calls[0]["messages"][0]["content"]
    assert sys.startswith("BASE_SYSTEM")
    assert "business" in sys.lower()


def test_typeset_style_concise_appends_concise_block(db, monkeypatch):
    calls = _patched_chat(monkeypatch, return_value="# ok")
    _run(typeset_markdown("x", db=db, style="concise"))
    sys = calls[0]["messages"][0]["content"]
    assert sys.startswith("BASE_SYSTEM")
    assert "concise" in sys.lower()


def test_typeset_styles_produce_distinct_prompt_versions(db, monkeypatch):
    """Each style must change the prompt enough that prompt_version differs
    — otherwise the admin cannot tell styles apart from response shape."""
    _patched_chat(monkeypatch, return_value="# ok")
    pv_default = _run(typeset_markdown("x", db=db)).prompt_version
    pv_academic = _run(typeset_markdown("x", db=db, style="academic")).prompt_version
    pv_business = _run(typeset_markdown("x", db=db, style="business")).prompt_version
    pv_concise = _run(typeset_markdown("x", db=db, style="concise")).prompt_version

    assert len({pv_default, pv_academic, pv_business, pv_concise}) == 4


def test_typeset_unknown_style_falls_back_to_default(db, monkeypatch):
    """Unknown style values must not blow up — they fall back to the base
    prompt so the admin UI never hits a 5xx for a stray value."""
    calls = _patched_chat(monkeypatch, return_value="# ok")
    _run(typeset_markdown("x", db=db, style="not_a_real_style"))
    sys = calls[0]["messages"][0]["content"]
    assert sys == "BASE_SYSTEM"