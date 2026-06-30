"""Server-side markdown typesetter.

Reads ``article_typesetter.*`` AdminSetting keys, truncates oversized input,
calls the OpenAI-compatible ``chat_complete`` once, and strips accidental
markdown code fences from the response.

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


# ----- Defaults — overridable through AdminSetting ---------------------------
DEFAULT_ENABLED = "false"
DEFAULT_MODEL = "MiniMax-M3"
DEFAULT_BASE_URL = "https://api.minimax.chat/v1"

DEFAULT_SYSTEM_PROMPT = """你是一名中文科技期刊的资深排版编辑，专精于把 pandoc 从 Word 导出的 Markdown 清洗为可直接发布的稿件。

【必须做】
- 修正标题层级（# ## ### ……），确保只有一个 H1
- 中英文 / 中文与数字之间补全角空格（CJK 排版习惯）
- 全角 / 半角标点统一
- 列表层级、表格列对齐
- 清除 pandoc 残留（例如反斜杠续行、空格+换行）

【绝对不要做】
- 不改写、不润色、不删减任何正文句子
- 不修改图片引用 ![](...) 路径
- 不输出 markdown 围栏（```）、前言、解释、注释
- 不输出元数据（title / summary / tags）建议

【输出】
直接返回清洗后的 Markdown，不要任何包裹。
"""

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
    row = db.query(AdminSetting).filter_by(key=key).first()
    if not row:
        return None
    try:
        return decrypt_value(row.value_encrypted)
    except Exception:
        return None


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


def _resolve_config(db: Session) -> tuple[str, str, str, str]:
    """Return (api_key, model, base_url, system_prompt). Raises TypesetError on missing required keys."""
    enabled_raw = _get_setting(db, "article_typesetter.enabled") or DEFAULT_ENABLED
    if not _is_enabled(enabled_raw):
        raise TypesetError("not_enabled", "AI 排版未启用")

    api_key = _get_setting(db, "article_typesetter.api_key")
    if not api_key:
        raise TypesetError("no_api_key", "未配置 article_typesetter.api_key")

    model = _get_setting(db, "article_typesetter.model") or DEFAULT_MODEL
    base_url = _get_setting(db, "article_typesetter.base_url") or DEFAULT_BASE_URL
    system_prompt = _get_setting(db, "article_typesetter.system_prompt") or DEFAULT_SYSTEM_PROMPT
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
    )

    cleaned = _strip_fences(raw or "")
    if not cleaned:
        warnings.append("模型返回为空，请重试或更换模型")

    return TypesetResult(
        content_markdown=cleaned,
        warnings=warnings,
        model=model,
        prompt_version=str(len(system_prompt.encode("utf-8"))),
    )
