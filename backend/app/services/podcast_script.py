"""Generate a conversational podcast script via an OpenAI-compatible LLM.

Used by public_podcast_router when a `page_agent.*` config is present:
the deepseek preset from admin_setting_defaults is sufficient for this
feature because the FAB was already wired against the page-agent
credentials. Falling back to a deterministic slice when no LLM is
configured keeps the feature usable on hermetic dev boxes.

Output contract — strict JSON list of {speaker, text}:

    [{"speaker": "A"|"B", "text": "..."}]

The router's downstream TTS code already understands the {A, B} label
contract (see VOICE_CATALOG). Speakers named in prose ("小数", "小创")
are NOT used in segments because they're persona names, not protocol
fields — hbsc's product naming is rendered by the FAB, not by the TTS.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Iterable

from .llm_client import LLMUnavailable, chat_complete

_log = logging.getLogger(__name__)


# Tunables for the LLM call — match the page-agent chat preset so we
# don't introduce a second LLM configuration to maintain.
SCRIPT_LLM_MODEL_DEFAULT = "deepseek-v4-flash"
SCRIPT_LLM_BASE_URL_DEFAULT = "https://api.deepseek.com/v1"
SCRIPT_TARGET_SEGMENTS = 6
SCRIPT_MIN_SEGMENTS = 4
SCRIPT_MAX_SEGMENTS = 8


SCRIPT_SYSTEM_PROMPT = """你是一名中文双人播客脚本编辑，擅长把长文改写成两人对谈稿。

【硬性格式要求 — 必须严格遵守】
- 输出必须是合法 JSON 数组，且数组中每个元素形如：
  {"speaker": "A", "text": "..."}
  或
  {"speaker": "B", "text": "..."}
- 不要输出 JSON 之外的任何字符（包括 ```json 围栏、前言、解释、注释）。
- "speaker" 字段只能取 "A" 或 "B"。
- 不要编造原文没有的事实、数字、引用、人名。

【角色定位】
- A：小数（嘉宾 · 磁性沉稳男声）。负责展开观点、补充细节、回应追问。
- B：小创（主持人 · 温暖热情女声）。负责开场、串联、收尾、抛出问题。
- 第一段必须是 B 开场，点明本期主题并向听众问好。
- 最后一段必须是 A 收尾（"以上就是本期节目的主要内容..."或类似表达）。
- A / B 严格交替，避免连续两段同一 speaker。

【内容要求】
- 每段 text 控制在 60~140 字之间，避免长段（太长会影响语音节奏）。
- 段数控制在 4~8 之间；默认 6 段；正文过短时可适当压缩到 4 段。
- 用词口语化，可使用"咱们"、"嗯"、"对吧"等口语词，避免书面腔。
- 严格基于【正文】中的事实，不引入外部信息、不杜撰数据。
- 不要重复【正文】中已经说得非常清楚的句子，要做"改写为对话"的工作。

【输出示例】
[{"speaker":"B","text":"欢迎收听本期播客，今天我们来聊聊XXX。"},{"speaker":"A","text":"嗯，这个话题挺有意思。"}]"""


def _strip_code_fence(text: str) -> str:
    """Drop a leading/trailing ```json ... ``` wrapper if the model emits one.

    Most instruction-tuned models honor the "no fence" directive, but
    a few still wrap. Keeping this defensive means a single bad output
    doesn't break the whole /generate call.
    """
    t = (text or "").strip()
    if t.startswith("```"):
        # Drop the first line (```json) and the trailing fence.
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def _extract_json_array(text: str) -> list | None:
    """Pull the first JSON array out of ``text``. Returns None on failure."""
    if not text:
        return None
    cleaned = _strip_code_fence(text)
    # Direct parse first (the common case).
    try:
        data = json.loads(cleaned)
        if isinstance(data, list):
            return data
    except (ValueError, TypeError):
        pass
    # Fall back to bracket-scan in case the model added a leading sentence.
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end > start:
        try:
            data = json.loads(cleaned[start:end + 1])
            if isinstance(data, list):
                return data
        except (ValueError, TypeError):
            return None
    return None


def _normalize(segments: list, *, target: int) -> list[dict]:
    """Validate, clean and pad/trim a list of segment dicts.

    Invalid rows are dropped. If too few remain, the caller falls back
    to the deterministic generator. If too many, we keep the first
    ``target`` and re-anchor the speakers to start with B and end with A.
    """
    out: list[dict] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        spk = str(seg.get("speaker", "")).strip().upper()
        if spk not in ("A", "B"):
            continue
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        out.append({"speaker": spk, "text": text})

    if not out:
        return out

    # Re-anchor: first turn is B (host intro), last turn is A (guest outro),
    # adjacent same-speaker segments get the next one swapped.
    if out[0]["speaker"] != "B":
        out[0]["speaker"] = "B"
    if out[-1]["speaker"] != "A":
        out[-1]["speaker"] = "A"
    for i in range(1, len(out) - 1):
        if out[i]["speaker"] == out[i - 1]["speaker"]:
            out[i]["speaker"] = "A" if out[i - 1]["speaker"] == "B" else "B"

    if len(out) > target:
        out = out[:target]
        # Re-anchor after trimming (last char must be A).
        if out[-1]["speaker"] != "A":
            out[-1]["speaker"] = "A"
    return out


async def generate_script(
    *,
    content: str,
    title: str,
    api_key: str,
    base_url: str,
    model: str,
    target_segments: int = SCRIPT_TARGET_SEGMENTS,
) -> list[dict]:
    """Ask the LLM to rewrite ``content`` as a 2-speaker dialogue.

    Raises LLMUnavailable on any failure (network, auth, malformed JSON,
    zero valid segments). The router catches this and falls back to the
    deterministic local generator.
    """
    if not api_key:
        raise LLMUnavailable("podcast script LLM: empty api_key")
    if not content.strip():
        raise LLMUnavailable("podcast script LLM: empty content")

    # Cap content length so the prompt stays cheap — ~6000 chars is
    # already plenty for 4-8 dialogue segments.
    capped = content[:6000]
    user_msg = (
        f"【本期主题】{title.strip() or '本期话题'}\n\n"
        f"【正文】\n{capped}"
    )

    raw = await chat_complete(
        base_url=base_url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": SCRIPT_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        timeout=60.0,
    )

    data = _extract_json_array(raw)
    if not data:
        raise LLMUnavailable(
            f"podcast script LLM: response is not a JSON list "
            f"(first 80 chars: {raw[:80]!r})"
        )

    normalized = _normalize(data, target=target_segments)
    if len(normalized) < SCRIPT_MIN_SEGMENTS:
        raise LLMUnavailable(
            f"podcast script LLM: only {len(normalized)} valid segments "
            f"after normalization; need >= {SCRIPT_MIN_SEGMENTS}"
        )
    _log.info(
        "podcast script LLM ok: %d segments for %r",
        len(normalized), title[:30],
    )
    return normalized


__all__ = ["generate_script", "SCRIPT_LLM_MODEL_DEFAULT", "SCRIPT_LLM_BASE_URL_DEFAULT"]
