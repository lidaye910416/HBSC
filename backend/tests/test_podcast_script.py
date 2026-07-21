"""Unit tests for the podcast script LLM helper.

We mock ``chat_complete`` to avoid hitting the real LLM endpoint during
tests. The wrapper is intentionally tiny so most behaviour worth
testing is in the JSON extraction + normalization helpers.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services import podcast_script as ps  # noqa: E402
from app.services.llm_client import LLMUnavailable  # noqa: E402


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------

class TestExtractJsonArray:
    """JSON fallback parser — kept for models that still emit JSON.

    The primary path is plain-text parsing (see TestParse). These tests
    pin down the JSON fallback behaviour so the fallback stays
    backwards-compatible.
    """

    def test_pure_array(self):
        raw = json.dumps([{"speaker": "A", "text": "hi"}])
        assert ps._extract_json_array(raw) == [{"speaker": "A", "text": "hi"}]

    def test_array_with_surrounding_prose(self):
        raw = "好的，下面是脚本：\n[{\"speaker\":\"B\",\"text\":\"hi\"}]\n希望对您有帮助。"
        result = ps._extract_json_array(raw)
        assert result == [{"speaker": "B", "text": "hi"}]

    def test_strips_code_fence(self):
        raw = "```json\n[{\"speaker\":\"A\",\"text\":\"ok\"}]\n```"
        assert ps._extract_json_array(raw) == [{"speaker": "A", "text": "ok"}]

    def test_returns_none_on_garbage(self):
        assert ps._extract_json_array("I don't know") is None
        assert ps._extract_json_array("") is None
        assert ps._extract_json_array("[not json") is None


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

class TestParse:
    """Plain-text parser mirrors MiniCast's generator.parse_script_text."""

    def test_parses_a_and_b_lines(self):
        raw = (
            "A: 大家好欢迎收听\n"
            "B: 我是小数\n"
            "A: 今天我们聊聊\n"
            "B: 好的开始吧\n"
        )
        segs = ps._parse_plain_text(raw)
        assert [s["speaker"] for s in segs] == ["A", "B", "A", "B"]
        assert segs[0]["text"] == "大家好欢迎收听"

    def test_accepts_chinese_colon(self):
        segs = ps._parse_plain_text("A：第一个\nB：第二个\n")
        assert [s["speaker"] for s in segs] == ["A", "B"]

    def test_accepts_host_aliases(self):
        segs = ps._parse_plain_text("主持人A：第一个\n主持人B：第二个\n")
        assert [s["speaker"] for s in segs] == ["A", "B"]

    def test_continuation_lines_attach_to_previous(self):
        raw = "A: 这是一段\n继续的内容\nB: 下一段\n"
        segs = ps._parse_plain_text(raw)
        assert len(segs) == 2
        assert segs[0]["text"] == "这是一段 继续的内容"

    def test_unprefixed_lead_assumed_speaker_a(self):
        segs = ps._parse_plain_text("没有任何前缀\nB: 第二个\n")
        assert segs[0]["speaker"] == "A"

    def test_strips_think_block(self):
        """The top-level ``_parse`` strips <think>...</think> before
        dispatching to the plain-text parser. Test the end-to-end path
        rather than ``_parse_plain_text`` directly."""
        raw = "<think>internal reasoning</think>\nA: 实际脚本\nB: 第二句\n"
        segs = ps._parse(raw)
        assert [s["speaker"] for s in segs] == ["A", "B"]


class TestNormalize:
    """Normalizer just validates and trims. Anchoring is intentionally
    NOT enforced (LLM is free to decide who opens / closes — this
    matches MiniCast's design)."""

    def test_drops_invalid_rows(self):
        raw = [
            {"speaker": "A", "text": "good"},
            {"speaker": "Z", "text": "bad speaker"},
            {"speaker": "B"},  # missing text
            {"text": "missing speaker"},
            "garbage row",
        ]
        out = ps._normalize(raw, target=6)
        assert len(out) == 1
        assert out[0]["speaker"] == "A"

    def test_does_not_force_anchor_speakers(self):
        """New behaviour: don't rewrite the LLM's natural speaker flow."""
        raw = [{"speaker": "A", "text": f"x{i}"} for i in range(4)]
        out = ps._normalize(raw, target=6)
        # First and last stay whatever the LLM chose — no override.
        assert out[0]["speaker"] == "A"
        assert out[-1]["speaker"] == "A"

    def test_trims_to_target(self):
        raw = [{"speaker": "A" if i % 2 else "B", "text": str(i)} for i in range(10)]
        out = ps._normalize(raw, target=4)
        assert len(out) == 4



# ---------------------------------------------------------------------------
# generate_script (LLM wrapper)
# ---------------------------------------------------------------------------

def _patch_chat_complete(monkeypatch, return_value):
    fake = AsyncMock(return_value=return_value)
    monkeypatch.setattr(ps, "chat_complete", fake)
    return fake


class TestGenerateScript:
    def test_empty_api_key_raises(self, monkeypatch):
        _patch_chat_complete(monkeypatch, "")
        with pytest.raises(LLMUnavailable):
            asyncio.run(ps.generate_script(
                content="anything", title="t", api_key="", base_url="x", model="m",
            ))

    def test_valid_llm_response_is_returned(self, monkeypatch):
        llm_payload = json.dumps([
            {"speaker": "B", "text": "欢迎"},
            {"speaker": "A", "text": "好的"},
            {"speaker": "B", "text": "怎么看"},
            {"speaker": "A", "text": "这样"},
        ])
        _patch_chat_complete(monkeypatch, llm_payload)
        segments = asyncio.run(ps.generate_script(
            content="文章正文" * 10, title="t",
            api_key="sk-fake", base_url="https://api.example.com", model="m",
        ))
        assert len(segments) >= ps.SCRIPT_MIN_SEGMENTS
        assert all(s["speaker"] in ("A", "B") for s in segments)
        assert segments[0]["speaker"] == "B"
        assert segments[-1]["speaker"] == "A"

    def test_too_few_valid_segments_raises(self, monkeypatch):
        _patch_chat_complete(monkeypatch, json.dumps([
            {"speaker": "A", "text": "only one"},
        ]))
        with pytest.raises(LLMUnavailable):
            asyncio.run(ps.generate_script(
                content="x" * 100, title="t",
                api_key="sk", base_url="https://x", model="m",
            ))

    def test_malformed_response_raises(self, monkeypatch):
        _patch_chat_complete(monkeypatch, "not json at all")
        with pytest.raises(LLMUnavailable):
            asyncio.run(ps.generate_script(
                content="x" * 100, title="t",
                api_key="sk", base_url="https://x", model="m",
            ))

    def test_empty_content_raises(self, monkeypatch):
        _patch_chat_complete(monkeypatch, "[]")
        with pytest.raises(LLMUnavailable):
            asyncio.run(ps.generate_script(
                content="   ", title="t",
                api_key="sk", base_url="https://x", model="m",
            ))
