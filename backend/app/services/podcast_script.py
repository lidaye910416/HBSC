"""LLM-driven podcast script generator — physically isolated from MiniCast.

When the page_agent LLM preset is configured, this module rewrites an
article as a two-speaker dialogue mirroring the local ~/Projects/MiniCast
pipeline (same MiniMax model, same segment target, same plain-text
``A:`` / ``B:`` parsing convention). When the LLM is unavailable the
router falls back to a deterministic slice so the FAB never blocks.

Design parity with MiniCast:
  * System prompt: ``prompts/duo_zh.txt`` of ~/Projects/MiniCast verbatim
    (translated to module-string form so we don't ship a prompt file
    alongside the Python module).
  * User prompt: same shape — title line + content block + numbered
    requirements.
  * Target length: 8-15 segments, 800-1500 chars — MiniCast's published
    range. Falls back gracefully below the floor when the article is
    short (deterministic fallback path on the router side).
  * Output format: plain-text ``A: ...`` / ``B: ...`` lines, parsed by
    the same regex MiniCast uses (see ``SPEAKER_PATTERN`` below). JSON
    output is also accepted as a fallback for models that prefer it.

Why plain text instead of strict JSON?
  * LLM emits more naturally without the schema constraint — closer to
    "real主播" tone, which is what the user is benchmarking against.
  * Easier to render in the FAB's 「对谈脚本」 preview block (one row
    per line, no JSON.stringify required).
  * The MiniCast project itself uses plain text as the canonical form;
    following that keeps the two implementations in lockstep.
"""
from __future__ import annotations

import logging
import re
from typing import Iterable

from .llm_client import LLMUnavailable, chat_complete

_log = logging.getLogger(__name__)


# Tunables for the LLM call — match the page-agent chat preset so we
# don't introduce a second LLM configuration to maintain.
SCRIPT_LLM_MODEL_DEFAULT = "deepseek-v4-flash"
SCRIPT_LLM_BASE_URL_DEFAULT = "https://api.deepseek.com/v1"

# Segment / char targets — copied from ~/Projects/MiniCast/.../duo_zh.txt
# (8-15 segments, ~800-1500 chars). We accept slightly below the floor
# when the article is short; the router surfaces a deterministic
# fallback for the truly-degenerate cases.
SCRIPT_TARGET_SEGMENTS = 12
SCRIPT_MIN_SEGMENTS = 4
SCRIPT_TARGET_CHARS_MIN = 600
SCRIPT_TARGET_CHARS_MAX = 1800


# System prompt — matches MiniCast's src/minicast/prompts/duo_zh.txt
# byte-for-byte (modulo trivial whitespace) so the two implementations
# stay in lockstep. Update one → update the other.
SCRIPT_SYSTEM_PROMPT = """你是一位资深播客主编，擅长把枯燥的文章改写成生动的两人对谈脚本。

你的任务：把原始文章改编成两位主持人（A 和 B）之间的对谈。

【风格要求】
1. A 角色：热情、好奇、爱追问，像资深主持人
2. B 角色：理性、专业、有深度，像嘉宾专家
3. 对话要自然、有来有回，不是你一句我一句的念稿
4. 适当加入口语化表达：「诶」「对吧」「你知道吗」「我跟你说」
5. 关键信息要让 B 解释清楚，避免空洞的概括
6. 可以加入评论、举例、反问、过渡，让对话有节奏

【格式要求】
1. 每段对话独占一行，前缀严格用 'A:' 或 'B:'（中文冒号「：」或英文冒号「:」都可）
2. 直接输出对话脚本，不要任何额外说明、不要标题、不要 markdown
3. 长度 8-15 段对话，总字数 800-1500 字
4. 开头一段自然引入话题，结尾一段收束总结

【示例】
A: 大家好，今天我们来聊聊一个最近特别火的话题。
B: 对，我最近也在关注这个事情，确实很有意思。
A: 我看到一份报告提到...
B: 这里面有个细节特别值得关注...

现在请根据用户提供的原始内容生成脚本。"""


# Speaker prefix pattern — same regex as MiniCast's generator.py so the
# two parsers accept the same shape.
SPEAKER_PATTERN = re.compile(
    r"^(A|B|主持人A|主持人B|主持人|Host|Speaker)\s*[:：]\s*(.+)$",
    re.MULTILINE,
)


def _strip_think_block(text: str) -> str:
    """Some reasoning models (qwen-deepseek variants) leak a
    ``<think>...</think>`` chain-of-thought before the actual script.
    Strip it so the parser sees only the script body.
    """
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL).strip()


def _parse_plain_text(text: str) -> list[dict]:
    """Parse MiniCast-style plain-text script output.

    Lines starting with ``A:`` / ``B:`` (or 中文冒号 variants) become
    one segment each. Unrecognized lines are appended to the previous
    segment (handles LLMs that wrap long text across two lines).
    """
    out: list[dict] = []
    for raw_line in (text or "").strip().split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        m = SPEAKER_PATTERN.match(line)
        if m:
            speaker_raw = m.group(1)
            content = m.group(2).strip()
            # Normalise Chinese speaker aliases ("主持人A" → "A").
            speaker = "B" if speaker_raw.startswith(("B", "主持人B")) else "A"
            # Drop the leading "主持人" prefix that some LLMs keep.
            speaker = speaker_raw.replace("主持人", "").strip() or speaker
            speaker = "A" if speaker not in ("A", "B") else speaker
            out.append({"speaker": speaker, "text": content})
        elif out:
            # Continuation of the previous segment.
            out[-1]["text"] = (out[-1]["text"] + " " + line).strip()
        else:
            # No speaker seen yet — assume A as MiniCast does.
            out.append({"speaker": "A", "text": line})
    return out


def _extract_json_array(text: str) -> list | None:
    """Pull the first JSON list out of ``text``. Returns None on failure.

    Retained as a fallback for models that prefer JSON output despite
    the plain-text system prompt.
    """
    if not text:
        return None
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip()).strip()
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        import json
        # Direct parse first (the common case).
        data = json.loads(cleaned)
        if not isinstance(data, list):
            return None
    except (ValueError, TypeError):
        # Fall back to bracket-scan in case the model added prose.
        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start != -1 and end > start:
            try:
                data = json.loads(cleaned[start:end + 1])
            except (ValueError, TypeError):
                return None
        else:
            return None
    if not data:
        try:
            import json
            data = json.loads(cleaned)
        except (ValueError, TypeError):
            return None
    return data if isinstance(data, list) else None


def _parse(text: str) -> list[dict]:
    """Try plain-text first (MiniCast canonical), fall back to JSON."""
    cleaned = _strip_think_block(text)
    parsed = _parse_plain_text(cleaned)
    if len(parsed) >= SCRIPT_MIN_SEGMENTS:
        return parsed
    # JSON fallback (kept for robustness — some models emit both).
    data = _extract_json_array(cleaned)
    if data:
        normalized: list[dict] = []
        for seg in data:
            if not isinstance(seg, dict):
                continue
            spk = str(seg.get("speaker", "")).strip().upper()
            if spk not in ("A", "B"):
                continue
            txt = str(seg.get("text", "")).strip()
            if txt:
                normalized.append({"speaker": spk, "text": txt})
        if len(normalized) >= SCRIPT_MIN_SEGMENTS:
            return normalized
    # If plain-text yielded < min and JSON didn't help, return whatever
    # plain-text gave us — the caller decides whether it's enough.
    return parsed


def _normalize(segments: list[dict], *, target: int) -> list[dict]:
    """Validate, clean and trim a list of segment dicts.

    Invalid rows are dropped. If too many remain, we keep the first
    ``target`` so the audio length stays in a sane range.
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
    if len(out) > target:
        out = out[:target]
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

    Mirrors ``~/Projects/MiniCast/src/minicast/core/generator.py:198``
    end-to-end — same prompt shape, same target ranges, same parsing
    convention. Falls back gracefully when the LLM rejects the request
    or returns too few segments.

    Raises LLMUnavailable on any failure (network, auth, malformed
    output). The router catches this and falls back to the deterministic
    local generator.
    """
    if not api_key:
        raise LLMUnavailable("podcast script LLM: empty api_key")
    if not content.strip():
        raise LLMUnavailable("podcast script LLM: empty content")

    # Cap content length so the prompt stays cheap. MiniCast also caps
    # at 6000 chars (see generator.py:217).
    capped = content[:6000]
    title_line = f"节目主题：{title.strip() or '本期话题'}\n" if title.strip() else ""
    user_msg = (
        f"{title_line}以下是一份原始文章或资料，请基于它生成播客脚本：\n\n"
        f"---\n{capped}\n---\n\n"
        "要求：\n"
        "1. 提取文章核心观点和有趣细节\n"
        "2. 用生动的对话形式重新组织（两人对谈）\n"
        "3. 适当加入评论、提问、过渡语，让对话自然流畅\n"
        f"4. 总长度控制在 {SCRIPT_MIN_SEGMENTS}-{target_segments} 段对话（中文约 {SCRIPT_TARGET_CHARS_MIN}-{SCRIPT_TARGET_CHARS_MAX} 字）\n"
        "5. 每段对话前用 'A:' 或 'B:' 标记\n"
        "6. 直接输出脚本，不要其他说明文字\n"
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

    parsed = _parse(raw)
    if not parsed:
        raise LLMUnavailable(
            f"podcast script LLM: parser returned 0 segments "
            f"(first 80 chars: {raw[:80]!r})"
        )

    normalized = _normalize(parsed, target=target_segments)
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


__all__ = [
    "generate_script",
    "SCRIPT_LLM_MODEL_DEFAULT",
    "SCRIPT_LLM_BASE_URL_DEFAULT",
    "SCRIPT_TARGET_SEGMENTS",
    "SCRIPT_MIN_SEGMENTS",
    "SPEAKER_PATTERN",
]
