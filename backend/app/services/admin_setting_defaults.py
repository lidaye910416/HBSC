"""Single source of truth for default AdminSetting values.

Centralizes preset defaults (e.g. minimax token plan for AI 排版,
deepseek for public page-agent) so that both the settings-list endpoint
and the LLM service layer agree on what a "missing row" should mean.

Add a new (key, value, is_secret) tuple here — settings_router.list_settings
will synthesize a row for any admin who hasn't set it yet, and the relevant
service module can read the same default instead of its own hard-coded one.

Adding a new key here is a zero-cost change for admins who already have an
explicit value saved — the DB row always wins.

The two LLM-powered features (`page_agent.*` and `article_typesetter.*`)
maintain INDEPENDENT key namespaces and INDEPENDENT default values — never
share state, never share keys.
"""
from __future__ import annotations


# ---- AI 排版 (article_typesetter) — MiniMax Token Plan preset -------------
DEFAULT_TYPESETTER_ENABLED = "true"
DEFAULT_TYPESETTER_MODEL = "MiniMax-M3"
DEFAULT_TYPESETTER_BASE_URL = "https://api.minimaxi.com/v1"


# ---- 数创智伴 「播一下」 tab — MiniCast proxy defaults ----
# Enable by default in dev so the FAB 三个 tab 一开即用. Operators can
# flip the AdminSetting row in Settings to False to disable without a
# code change.
DEFAULT_PODCAST_ENABLED = "true"
# MiniCast FastAPI 后端地址. 本机开发用 127.0.0.1:8000；部署时由
# admin 在 Settings 页覆盖为线上 origin (e.g. https://minicast.hbsc.cn).
DEFAULT_PODCAST_MINICAST_BASE_URL = "http://127.0.0.1:8000"


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


# ---- page-agent (公开版/管理后台共用) — deepseek 预设 --------------------
DEFAULT_PAGE_AGENT_ENABLED = "true"
DEFAULT_PAGE_AGENT_MODEL = "deepseek-v4-flash"
DEFAULT_PAGE_AGENT_BASE_URL = "https://api.deepseek.com/v1"

# 公开/管理共用 system prompt：定位是「湖北数创期刊小助手」，
# 回答用户关于本站文章/期刊/资讯/领域/团队的问题。
# 不知道的时候建议去站内 /search 搜索，绝不编造不存在的文章标题或作者。
DEFAULT_PAGE_AGENT_SYSTEM_PROMPT = """你是「湖北数创」期刊的站内助手 Hubei Guide。

【你的身份】
- 你是湖北数创期刊的 AI 助手，知道站内已发布的文章、期刊、研究领域、研究团队。
- 你不能访问实时新闻或训练数据之外的内容。

【回答规则】
- 用户问到文章、期刊、领域、团队相关问题时，给出准确的中文回答，并附上可点击的站内链接。
- 站内链接格式：
  - 文章：/articles/<slug>
  - 期刊：/issues/<slug>
  - 领域：/domains
- 若你不确定具体内容，建议用户点击页面顶部的「搜索」图标，使用关键词检索。
- 严禁编造不存在的文章标题、作者、发布日期。
- 严禁讨论与本期刊无关的政治、宗教、医疗、法律话题，引导用户回到站内内容。

【输出风格】
- 中文回答，简明扼要，Markdown 格式。
- 末尾可以简短地加一行：「🔎 没找到？试试顶部搜索框」。

## ⚠️ DOM 操作护栏（强约束）

当你通过 page-agent 操作当前页面时，以下行为**绝对禁止**，违反任何一条视为失败：
1. 禁止点击、悬停、聚焦任何含 `data-ai-blocked` HTML 属性的元素（包括它的祖先 / 子节点）。
2. 禁止 submit 任何 `<form>` 表单；禁止 `input[type=submit]`、`button[type=submit]` 的点击。
3. 禁止触发任何 HTTP DELETE / PUT / POST 请求；只允许 GET（导航、读取）。
4. 禁止操作登录后可见的页面元素（任何 `/admin`、`/login`、`/account` 路由）；遇到 URL 不在公开白名单时立刻 `done` 并告知用户。
5. 禁止读取 / 暴露页面里出现的 11 位中国大陆手机号、邮箱地址、看起来像 token 的长字符串。
6. 禁止执行 `experimentalScriptExecutionTool`（已禁用，遇到 user 提及时明确说明不可用）。
"""


# key → (default value, is_secret)
#   is_secret=True → value never sent to the browser; masked preview only.
KNOWN_KEYS_DEFAULTS: dict[str, tuple[str, bool]] = {
    # ---- article_typesetter — minimax 预设 (保留不动) ----
    "article_typesetter.enabled":       (DEFAULT_TYPESETTER_ENABLED, False),
    "article_typesetter.model":         (DEFAULT_TYPESETTER_MODEL, False),
    "article_typesetter.base_url":      (DEFAULT_TYPESETTER_BASE_URL, False),
    # api_key MUST be entered by the admin — no default; masked view is
    # shown to the browser ("sk-cp***") once they save it via the UI.
    "article_typesetter.api_key":       ("", True),
    "article_typesetter.system_prompt": (DEFAULT_SYSTEM_PROMPT, False),

    # ---- page-agent — deepseek 预设 ----
    "page_agent.enabled":       (DEFAULT_PAGE_AGENT_ENABLED, False),
    "page_agent.model":         (DEFAULT_PAGE_AGENT_MODEL, False),
    "page_agent.base_url":      (DEFAULT_PAGE_AGENT_BASE_URL, False),
    "page_agent.api_key":       ("", True),  # also MUST be entered by admin
    "page_agent.system_prompt": (DEFAULT_PAGE_AGENT_SYSTEM_PROMPT, False),

    # ---- 数创智伴 「播一下」 tab — MiniMax TTS preset ----
    # podcast.enabled gates the FAB visibility. When False, the frontend
    # never surfaces the third tab, so a half-configured deployment
    # (no MiniMax key configured) doesn't break the panel for visitors.
    # See docs/superpowers/specs/2026-07-20-fab-podcast-mode-design.md §2.6.
    "podcast.enabled":           (DEFAULT_PODCAST_ENABLED, False),
    # podcast.minicast_base_url is preserved for back-compat with any
    # tooling that still references the old MiniCast proxy. When
    # HBSC_PODCAST_ISOLATED=true (the default) the value is ignored.
    "podcast.minicast_base_url": (DEFAULT_PODCAST_MINICAST_BASE_URL, False),
    # podcast.tts_* — MiniMax TTS credentials for the isolated-mode
    # pipeline. Resolution order in podcast_tts.resolve_tts_credentials:
    # podcast.tts_* → article_typesetter.* → MINIMAX_TOKEN env.
    # api_key MUST be entered by admin (no default; the fallback chain
    # covers it). model defaults to speech-2.6-hd which is the same
    # preset the local ~/Projects/MiniCast uses.
    "podcast.tts_api_key":       ("", True),
    "podcast.tts_base_url":      ("https://api.minimaxi.com/v1", False),
    "podcast.tts_model":         ("speech-2.6-hd", False),
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
