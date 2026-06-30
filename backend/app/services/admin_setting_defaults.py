"""Single source of truth for default AdminSetting values.

Centralizes preset defaults (e.g. minimax token plan for AI 排版) so that
both the settings-list endpoint and the LLM service layer agree on what a
"missing row" should mean.

Add a new (key, value, is_secret) tuple here — settings_router.list_settings
will synthesize a row for any admin who hasn't set it yet, and the relevant
service module can read the same default instead of its own hard-coded one.

Adding a new key here is a zero-cost change for admins who already have an
explicit value saved — the DB row always wins.
"""
from __future__ import annotations


# ---- AI 排版 (article_typesetter) — minimax token plan preset -------------
DEFAULT_TYPESETTER_ENABLED = "true"
DEFAULT_TYPESETTER_MODEL = "MiniMax-M3"
DEFAULT_TYPESETTER_BASE_URL = "https://api.minimax.chat/v1"


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


# key → (default value, is_secret)
#   is_secret=True → value never sent to the browser; masked preview only.
KNOWN_KEYS_DEFAULTS: dict[str, tuple[str, bool]] = {
    # ---- article_typesetter — minimax 预设 ----
    "article_typesetter.enabled":       (DEFAULT_TYPESETTER_ENABLED, False),
    "article_typesetter.model":         (DEFAULT_TYPESETTER_MODEL, False),
    "article_typesetter.base_url":      (DEFAULT_TYPESETTER_BASE_URL, False),
    # api_key MUST be entered by the admin — no default; masked view is
    # shown to the browser ("sk-cp***") once they save it via the UI.
    "article_typesetter.api_key":       ("", True),
    "article_typesetter.system_prompt": (DEFAULT_SYSTEM_PROMPT, False),
}


def default_for(key: str) -> str | None:
    """Return the preset default for ``key``, or None if there's no default."""
    entry = KNOWN_KEYS_DEFAULTS.get(key)
    if entry is None:
        return None
    return entry[0]


def is_secret_default(key: str) -> bool:
    """Return whether ``key`` is in the defaults table and flagged as secret."""
    entry = KNOWN_KEYS_DEFAULTS.get(key)
    if entry is None:
        return False
    return entry[1]


def is_known(key: str) -> bool:
    return key in KNOWN_KEYS_DEFAULTS
