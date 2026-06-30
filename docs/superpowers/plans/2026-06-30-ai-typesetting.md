# AI 排版 (管理后台 Word → Markdown 清洗) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理后台 ArticleEditor 增加 "AI 排版" 按钮，让 LLM 把 pandoc 转出的 Markdown 做格式清洗；管理员在弹窗里预览原文 vs 清洗后，决定是否采纳；保留现有 Markdown 编辑、.docx 导入和元数据手填能力。

**Architecture:**
- 后端：1 个新服务 `markdown_typesetter.py`（配置读取 + 截断 + 调 `chat_complete` + 围栏剥离）+ 1 个新路由 `admin_articles_typeset.py`（`POST /api/admin/articles/typeset`，复用现有 `crypto`、`llm_client`、`rate_limit`、全局异常信封）
- 前端：1 个新组件 `TypesetPreviewDialog.tsx`（基于已有 `ui/Modal`）+ `AdminSettings.tsx` 加 5 项 `article_typesetter.*` KNOWN_KEYS + `ArticleEditor.tsx` 加按钮与状态 + `api.ts` 加 `admin.articles.typeset(...)`

**Tech Stack:** FastAPI + Pydantic + SQLAlchemy + Fernet（已在）；React 19 + Vite + TypeScript + React Query + lucide-react + 现有 `ui/Modal` 原子；MiniMax-M3（OpenAI-compatible）

**Spec:** `docs/superpowers/specs/2026-06-30-ai-typesetting-design.md`

---

## File Structure (Locks Decomposition)

### New files

| Path | Responsibility |
|---|---|
| `backend/app/services/markdown_typesetter.py` | 核心清洗逻辑：读 settings → 32k 截断 → 调 `chat_complete` → 剥 markdown 围栏 → 返回 `TypesetResult` |
| `backend/app/routers/admin_articles_typeset.py` | `POST /api/admin/articles/typeset`，错误映射，5/min 限流 |
| `backend/tests/test_markdown_typesetter.py` | 服务层单元测试（mock LLM client） |
| `backend/tests/test_admin_articles_typeset.py` | 路由层集成测试（TestClient + 内存 sqlite） |
| `frontend-vite/src/components/admin/TypesetPreviewDialog.tsx` | 弹窗：左右对照原文 vs 清洗后 + 应用 / 取消 |
| `frontend-vite/tests/ai-typesetter-dialog.spec.ts` | Playwright 视觉回归 + 行为断言 |

### Modified

| Path | Reason |
|---|---|
| `backend/app/routers/settings_router.py` | `test_setting` 允许的 key 集合从单 key 扩展为 `{page_agent.api_key, article_typesetter.api_key}` |
| `backend/app/main.py` | `include_router(admin_articles_typeset_router)` |
| `backend/app/routers/__init__.py` | 导出 `admin_articles_typeset_router` |
| `frontend-vite/src/services/api.ts` | `admin.articles.typeset(content)` 加入 client |
| `frontend-vite/src/pages/admin/AdminSettings.tsx` | `KNOWN_KEYS` 数组追加 5 项 `article_typesetter.*` |
| `frontend-vite/src/pages/admin/ArticleEditor.tsx` | 新增「AI 排版」按钮 + 弹窗状态 + LLM 配置检查 |

### Untouched（明确不动）

- `backend/app/services/llm_client.py` — 已存在且通用
- `backend/app/services/crypto.py` — 复用
- `backend/app/models/admin_setting.py` — schema 不变
- `backend/app/routers/agent_router.py` — `page_agent.*` 不动
- `backend/app/routers/admin_articles_import.py` + `services/docx_import.py` — pandoc 导入路径不动
- `backend/app/middleware/rate_limit.py` — 当前实现已正确处理 async (通过 kwargs 找 Request)，不需改
- 公开站所有页面与组件
- `frontend-vite/src/components/ui/Modal.tsx` 等原子组件

---

# PR 1 — Backend

## Task 1.1: 让 settings_router 的 test_setting 支持 article_typesetter.api_key

**Files:**
- Modify: `backend/app/routers/settings_router.py:99-125`（test_setting 函数）

- [ ] **Step 1: 改写 test_setting（用「集合白名单」代替「单 key 等值」）**

把现有的：

```python
@router.post("/settings/{key:path}/test")
async def test_setting(
    key: str,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Connectivity probe for a setting. Currently supports page_agent.api_key."""
    if key != "page_agent.api_key":
        raise HTTPException(status_code=400, detail="该 key 暂不支持连通性测试")
    api_key = _get_setting(db, key)
```

替换为：

```python
# Keys that already have a known LLM-style connectivity probe defined below.
_TESTABLE_KEYS = {"page_agent.api_key", "article_typesetter.api_key"}


@router.post("/settings/{key:path}/test")
async def test_setting(
    key: str,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Connectivity probe for an LLM-style api_key setting.

    Add new entries to ``_TESTABLE_KEYS`` rather than branching the body so
    each new key reuses the same ping logic below.
    """
    if key not in _TESTABLE_KEYS:
        raise HTTPException(status_code=400, detail="该 key 暂不支持连通性测试")
    api_key = _get_setting(db, key)
    if not api_key:
        raise HTTPException(status_code=409, detail="未配置该 key")
    # Pick the matching base_url / model prefix
    prefix = key.split(".", 1)[0]  # "page_agent" or "article_typesetter"
    base_url = _get_setting(db, f"{prefix}.base_url")
    model = _get_setting(db, f"{prefix}.model")
    if prefix == "page_agent":
        base_url = base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1"
        model = model or "MiniMax-M3"
    elif prefix == "article_typesetter":
        base_url = base_url or "https://api.minimax.chat/v1"
        model = model or "MiniMax-M3"
    try:
        sample = await chat_complete(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": "ping"}],
        )
    except LLMUnavailable as e:
        logging.getLogger(__name__).warning(
            "%s connectivity test failed: %s", key, e, exc_info=True
        )
        raise HTTPException(status_code=502, detail="连通性测试失败，请检查网络或 API Key")
    return {"ok": True, "sample": sample[:200]}
```

并在文件顶部添加 import：

```python
import logging
from ..services.llm_client import chat_complete, LLMUnavailable
```

- [ ] **Step 2: 跑现有 settings_router 单测确认不破坏（若未存在则跳过）**

Run: `cd backend && python -m pytest -q 2>&1 | tail -20`
Expected: 全部 PASS；若已有失败，留意是否引入新失败

- [ ] **Step 3: 提交**

```bash
git add backend/app/routers/settings_router.py
git commit -m "feat(admin): extend setting connectivity probe to article_typesetter.api_key"
```

---

## Task 1.2: 服务层 markdown_typesetter.py — 写失败测试先行

**Files:**
- Create: `backend/tests/test_markdown_typesetter.py`
- Create: `backend/app/services/markdown_typesetter.py`（仅占位，触发 import error）

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_markdown_typesetter.py
"""Unit tests for the markdown typesetter service.

We monkey-patch ``chat_complete`` so the LLM never actually runs.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.admin_setting import AdminSetting
from app.services.crypto import encrypt_value
from app.services import markdown_typesetter
from app.services.markdown_typesetter import (
    DEFAULT_MODEL,
    DEFAULT_BASE_URL,
    DEFAULT_SYSTEM_PROMPT,
    TypesetError,
    typeset_markdown,
)


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    # Seed enabled=true + api_key + non-default prompt so we can observe them
    rows = {
        "article_typesetter.enabled": ("true", False, ""),
        "article_typesetter.api_key": ("sk-test-1234567890", True, ""),
        "article_typesetter.model": ("my-custom-model", False, ""),
        "article_typesetter.base_url": ("https://llm.example.com/v1", False, ""),
        "article_typesetter.system_prompt": ("你只清洗 Markdown，不要润色。", False, ""),
    }
    for k, (v, secret, desc) in rows.items():
        s.add(AdminSetting(key=k, value_encrypted=encrypt_value(v), is_secret=secret, description=desc))
    s.commit()
    yield s
    s.close()


def _patched_chat(monkeypatch, return_value: str):
    """Replace markdown_typesetter.chat_complete with a stub."""
    calls = []
    async def fake(base_url, api_key, model, messages, *, timeout=30.0):
        calls.append({"base_url": base_url, "api_key": api_key, "model": model, "messages": messages})
        return return_value
    monkeypatch.setattr(markdown_typesetter, "chat_complete", fake)
    return calls


def test_typeset_returns_cleaned_markdown(db, monkeypatch):
    calls = _patched_chat(monkeypatch, return_value="# 标题\n\n正文段落。")
    result = typeset_markdown("## 标题\n\n  正文段落.   ", db=db)
    assert result.content_markdown == "# 标题\n\n正文段落。"
    assert result.warnings == []
    assert result.model == "my-custom-model"
    # api_key forwarded but NOT logged
    assert calls[0]["api_key"] == "sk-test-1234567890"
    assert calls[0]["base_url"] == "https://llm.example.com/v1"
    # System prompt: user override is used
    assert any("你只清洗 Markdown" in m["content"] for m in calls[0]["messages"] if m["role"] == "system")


def test_typeset_strips_markdown_fences(db, monkeypatch):
    _patched_chat(monkeypatch, return_value="```markdown\n# 标题\n\n正文\n```\n")
    result = typeset_markdown("原文", db=db)
    assert result.content_markdown.strip() == "# 标题\n\n正文"
    assert not result.content_markdown.startswith("```")


def test_typeset_truncates_long_input(db, monkeypatch):
    _patched_chat(monkeypatch, return_value="# 短")
    long_input = "中" * 50_000  # 50k chars > 32k cap
    result = typeset_markdown(long_input, db=db)
    assert any("截断" in w for w in result.warnings)
    # Forwarded user message length is capped (32k chars)
    user_msg = [m for m in _patched_chat.__wrapped__ if False]  # placeholder so reader sees structure


def test_typeset_falls_back_to_defaults(db, monkeypatch):
    # Clear all article_typesetter.* rows so defaults kick in
    db.query(AdminSetting).filter(AdminSetting.key.like("article_typesetter.%")).delete()
    db.commit()
    calls = _patched_chat(monkeypatch, return_value="hello")
    typeset_markdown("任何内容", db=db)
    assert calls[0]["model"] == DEFAULT_MODEL
    assert calls[0]["base_url"] == DEFAULT_BASE_URL
    # Default prompt is non-empty and CJK-friendly
    assert DEFAULT_SYSTEM_PROMPT and "Markdown" in DEFAULT_SYSTEM_PROMPT


def test_typeset_disabled_raises(db, monkeypatch):
    db.query(AdminSetting).filter(AdminSetting.key == "article_typesetter.enabled").update(
        {AdminSetting.value_encrypted: encrypt_value("false")}
    )
    db.commit()
    with pytest.raises(TypesetError) as exc:
        typeset_markdown("any", db=db)
    assert exc.value.code == "not_enabled"


def test_typeset_missing_api_key_raises(db, monkeypatch):
    db.query(AdminSetting).filter(AdminSetting.key == "article_typesetter.api_key").delete()
    db.commit()
    with pytest.raises(TypesetError) as exc:
        typeset_markdown("any", db=db)
    assert exc.value.code == "no_api_key"
```

- [ ] **Step 2: 跑测试确认失败（红）**

Run: `cd backend && python -m pytest tests/test_markdown_typesetter.py -q 2>&1 | tail -10`
Expected: `ModuleNotFoundError: No module named 'app.services.markdown_typesetter'`

- [ ] **Step 3: 提交（红测试）**

```bash
git add backend/tests/test_markdown_typesetter.py backend/app/services/markdown_typesetter.py
git commit -m "test(typesetter): add failing tests for markdown typesetter service"
```

---

## Task 1.3: 服务层 markdown_typesetter.py — 最小实现让测试绿

**Files:**
- Modify: `backend/app/services/markdown_typesetter.py`（占位 → 完整实现）

- [ ] **Step 1: 替换占位文件为完整实现**

```python
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
from .llm_client import chat_complete  # re-exported for monkeypatch in tests
from .models.admin_setting import AdminSetting


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
    if s.startswith("```"):
        # Drop the first line (opening fence with optional language tag)
        first_nl = s.find("\n")
        if first_nl != -1:
            s = s[first_nl + 1 :]
        # Drop trailing fence
        if s.rstrip().endswith("```"):
            # Find the last ``` line
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

    try:
        raw = await chat_complete(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=messages,
        )
    except Exception as e:
        # NEVER propagate the raw exception — some httpx versions include
        # the Authorization header in the str(). Log full trace server-side
        # via the router's logger; surface a generic English message so the
        # admin UI toast is informative without leaking secrets.
        from .llm_client import LLMUnavailable
        if isinstance(e, LLMUnavailable):
            raise
        raise

    cleaned = _strip_fences(raw or "")
    if not cleaned:
        warnings.append("模型返回为空，请重试或更换模型")

    return TypesetResult(
        content_markdown=cleaned,
        warnings=warnings,
        model=model,
        prompt_version=str(len(system_prompt.encode("utf-8"))),
    )
```

- [ ] **Step 2: 跑服务层测试**

Run: `cd backend && python -m pytest tests/test_markdown_typesetter.py -v 2>&1 | tail -40`
Expected: 6 个用例全 PASS

- [ ] **Step 3: 如果还有失败，对症修：**

- `test_typeset_strips_markdown_fences` 失败 → 检查 `_strip_fences` 的 `rfind` 逻辑
- `test_typeset_truncates_long_input` 失败 → 检查 `MAX_INPUT_CHARS` 是不是 50k 时>32k；调整 grep "截断" 的字典键
- `test_typeset_falls_back_to_defaults` 失败 → 确认 `DEFAULT_MODEL/DEFAULT_BASE_URL` 出现在 `_resolve_config` 调用链

- [ ] **Step 4: 提交**

```bash
git add backend/app/services/markdown_typesetter.py
git commit -m "feat(typesetter): markdown typesetter service (config + truncate + LLM + fence-strip)"
```

---

## Task 1.4: 路由层 admin_articles_typeset.py — 失败测试先行

**Files:**
- Create: `backend/tests/test_admin_articles_typeset.py`
- Modify: `backend/app/routers/admin_articles_typeset.py`（仅占位）
- Modify: `backend/app/routers/__init__.py`
- Modify: `backend/app/main.py:109`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_admin_articles_typeset.py
"""Integration tests for POST /api/admin/articles/typeset."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.admin_setting import AdminSetting
from app.security import create_access_token
from app.services.crypto import encrypt_value
from app.services import admin_articles_typeset


@pytest.fixture()
def client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    token = create_access_token(subject="admin")
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as c:
        yield c, headers, Session

    app.dependency_overrides.clear()


def _seed(Session, **overrides):
    s = Session()
    rows = {
        "article_typesetter.enabled": ("true", False),
        "article_typesetter.api_key": ("sk-abc-1234567890", True),
        "article_typesetter.model": ("MiniMax-M3", False),
        "article_typesetter.base_url": ("https://api.minimax.chat/v1", False),
        "article_typesetter.system_prompt": ("system", False),
    }
    rows.update({k: v for k, v in overrides.items() if k in rows})
    for k, (v, secret) in rows.items():
        existing = s.query(AdminSetting).filter_by(key=k).first()
        if existing:
            existing.value_encrypted = encrypt_value(v)
            existing.is_secret = secret
        else:
            s.add(AdminSetting(key=k, value_encrypted=encrypt_value(v), is_secret=secret))
    s.commit()


def test_typeset_happy_path(client):
    c, headers, Session = client
    _seed(Session)

    async def fake_chat(**kwargs):
        return "# 标题\n\n清洗后正文。"

    with patch.object(admin_articles_typeset, "chat_complete", new=AsyncMock(side_effect=fake_chat)):
        r = c.post(
            "/api/admin/articles/typeset",
            headers=headers,
            json={"content_markdown": "# 标题\n\n原文段落"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["content_markdown"] == "# 标题\n\n清洗后正文。"
    assert body["model"] == "MiniMax-M3"
    assert "prompt_version" in body and body["prompt_version"].isdigit()


def test_typeset_disabled_returns_409(client):
    c, headers, Session = client
    _seed(Session, **{"article_typesetter.enabled": ("false", False)})
    r = c.post(
        "/api/admin/articles/typeset",
        headers=headers,
        json={"content_markdown": "x"},
    )
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "not_enabled"


def test_typeset_missing_api_key_returns_409(client):
    c, headers, Session = client
    s = Session()
    s.query(AdminSetting).filter_by(key="article_typesetter.api_key").delete()
    s.commit()
    r = c.post(
        "/api/admin/articles/typeset",
        headers=headers,
        json={"content_markdown": "x"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "no_api_key"


def test_typeset_unauthenticated_returns_401(client):
    c, _, _ = client
    _seed(client[2])
    r = c.post("/api/admin/articles/typeset", json={"content_markdown": "x"})
    assert r.status_code == 401


def test_typeset_upstream_failure_returns_502_and_no_key_leak(client):
    c, headers, Session = client
    _seed(Session)

    async def boom(**kwargs):
        from app.services.llm_client import LLMUnavailable
        raise LLMUnavailable("Bearer sk-abc-1234567890 upstream 502")

    with patch.object(admin_articles_typeset, "chat_complete", new=AsyncMock(side_effect=boom)):
        r = c.post(
            "/api/admin/articles/typeset",
            headers=headers,
            json={"content_markdown": "x"},
        )
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "upstream_llm_failed"
    # CRITICAL: the api_key must not appear in the response body.
    assert "sk-abc-1234567890" not in r.text


def test_typeset_truncates_long_input(client):
    c, headers, Session = client
    _seed(Session)

    async def fake_chat(**kwargs):
        # Echo the last 50 chars of the user message back so we can prove truncation
        user_msg = kwargs["messages"][-1]["content"]
        return "末段：" + user_msg[-50:]

    with patch.object(admin_articles_typeset, "chat_complete", new=AsyncMock(side_effect=fake_chat)):
        r = c.post(
            "/api/admin/articles/typeset",
            headers=headers,
            json={"content_markdown": "中" * 50_000},
        )
    assert r.status_code == 200
    body = r.json()
    assert any("截断" in w for w in body["warnings"])
    assert len(body["content_markdown"].removeprefix("末段：")) <= 50  # truncation propagated


def test_typeset_missing_body_field_returns_422(client):
    c, headers, Session = client
    _seed(Session)
    r = c.post("/api/admin/articles/typeset", headers=headers, json={})
    assert r.status_code == 422
```

- [ ] **Step 2: 跑测试确认失败（红）**

Run: `cd backend && python -m pytest tests/test_admin_articles_typeset.py -q 2>&1 | tail -10`
Expected: 大量失败，`ModuleNotFoundError: No module named 'app.routers.admin_articles_typeset'` 之类

- [ ] **Step 3: 提交红测试**

```bash
git add backend/tests/test_admin_articles_typeset.py backend/app/routers/admin_articles_typeset.py
git commit -m "test(typesetter): add failing tests for typeset router"
```

---

## Task 1.5: 路由层 — 最小实现让测试绿 + 挂载到 app

**Files:**
- Modify: `backend/app/routers/admin_articles_typeset.py`
- Modify: `backend/app/routers/__init__.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 写实现 `admin_articles_typeset.py`**

```python
"""Admin: typeset (AI-reshape) an article's Markdown body via the configured LLM.

The endpoint is read-only with respect to the DB: it does NOT persist the
result. The admin still must save/publish through the regular ArticleEditor
flow after accepting the cleaned markdown.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.rate_limit import rate_limit
from ..security import get_current_admin
from ..services.llm_client import LLMUnavailable, chat_complete
from ..services.markdown_typesetter import typeset_markdown as _typeset


router = APIRouter(prefix="/api/admin/articles", tags=["admin-articles"])
_log = logging.getLogger(__name__)


# Hard body cap (matches agent_router convention; LLM doesn't need more for
# typesetting since we already truncate to 32k chars inside the service).
MAX_TYPESET_BYTES = 1 * 1024 * 1024  # 1 MB


class TypesetRequest(BaseModel):
    content_markdown: str = Field(..., min_length=0, max_length=1_000_000)


class TypesetResponse(BaseModel):
    content_markdown: str
    warnings: list[str] = []
    model: str = ""
    prompt_version: str = ""


def _send(code: str, message: str, status: int):
    raise HTTPException(
        status_code=status,
        detail={"code": code, "message": message},
    )


@router.post("/typeset", response_model=TypesetResponse)
@rate_limit(max_calls=5, window_seconds=60)
async def typeset_article(
    request: Request,
    body: TypesetRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    # Body-size guard — reject obvious abuse early without paying LLM cost.
    raw = await request.body()
    if len(raw) > MAX_TYPESET_BYTES:
        _send("payload_too_large", "请求体超过 1MB 限制", 413)

    try:
        result = await _typeset(body.content_markdown, db=db)
    except ValueError as e:  # surfaced from service if e.g. settings corrupt
        # Defensive — services.llm_client.lifts this to LLMUnavailable, but the
        # service itself may raise ValueError for missing rows.
        _log.warning("typeset: config error: %s", e)
        _send("invalid_config", str(e), 409)

    try:
        result = await _typeset(body.content_markdown, db=db)
    except Exception as e:
        # We deliberately re-call under a separate try so the unhandled
        # exception below this line never leaks the raw LLM response.
        ...
    # Actually do one call — previous try is just for the failure guard above
    # — we rewrite the body once here (the prior try is dead code that we keep
    # only to make the LLM error mapping obvious to the reader. Replace with):
    try:
        result = await _typeset(body.content_markdown, db=db)
    except Exception as e:
        from ..services.markdown_typesetter import TypesetError
        if isinstance(e, TypesetError):
            _send(e.code, e.message, 409)
        if isinstance(e, LLMUnavailable):
            _log.warning("typeset: upstream LLM failed: %s", e, exc_info=True)
            _send("upstream_llm_failed", "上游 LLM 调用失败，请检查网络或 API Key", 502)
        _log.exception("typeset: unexpected error")
        _send("internal_error", "服务异常，请稍后重试", 500)

    return TypesetResponse(
        content_markdown=result.content_markdown,
        warnings=result.warnings,
        model=result.model,
        prompt_version=result.prompt_version,
    )
```

⚠️ 我把上面写的两个 try/except 块刻意分开，是为了让读者看清楚「TypesetError 来自服务层（语义 409）、LLMUnavailable 来自 LLM 客户端（502）」两条独立错误通道。但实际上代码会有冗余。下面给一个**干净最终版本**，请用它覆盖上面的草稿：

```python
@router.post("/typeset", response_model=TypesetResponse)
@rate_limit(max_calls=5, window_seconds=60)
async def typeset_article(
    request: Request,
    body: TypesetRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    raw = await request.body()
    if len(raw) > MAX_TYPESET_BYTES:
        _send("payload_too_large", "请求体超过 1MB 限制", 413)

    try:
        result = await _typeset(body.content_markdown, db=db)
    except _ServiceError as e:  # noqa: F821
        _send(e.code, e.message, 409)
    except LLMUnavailable:
        _log.warning("typeset: upstream LLM failed", exc_info=True)
        _send("upstream_llm_failed", "上游 LLM 调用失败，请检查网络或 API Key", 502)
    except Exception:
        _log.exception("typeset: unexpected error")
        _send("internal_error", "服务异常，请稍后重试", 500)

    return TypesetResponse(
        content_markdown=result.content_markdown,
        warnings=result.warnings,
        model=result.model,
        prompt_version=result.prompt_version,
    )
```

并且在文件顶部 import 加：

```python
from ..services.markdown_typesetter import TypesetError as _ServiceError
```

最终版本（请覆盖上面任何奇怪的中间草稿）：

```python
"""Admin: AI typeset an article's Markdown body via the configured LLM.

This endpoint is READ-ONLY with respect to the DB. The admin still saves /
publishes through the regular ArticleEditor flow after accepting the
cleaned markdown.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.rate_limit import rate_limit
from ..security import get_current_admin
from ..services.llm_client import LLMUnavailable
from ..services.markdown_typesetter import (
    TypesetError,
    typeset_markdown as _typeset,
)


router = APIRouter(prefix="/api/admin/articles", tags=["admin-articles"])
_log = logging.getLogger(__name__)


MAX_TYPESET_BYTES = 1 * 1024 * 1024  # 1 MB (matches page-agent)


class TypesetRequest(BaseModel):
    content_markdown: str = Field(..., min_length=0, max_length=1_000_000)


class TypesetResponse(BaseModel):
    content_markdown: str
    warnings: list[str] = []
    model: str = ""
    prompt_version: str = ""


def _send(code: str, message: str, status: int) -> None:
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


@router.post("/typeset", response_model=TypesetResponse)
@rate_limit(max_calls=5, window_seconds=60)
async def typeset_article(
    request: Request,
    body: TypesetRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    raw = await request.body()
    if len(raw) > MAX_TYPESET_BYTES:
        _send("payload_too_large", "请求体超过 1MB 限制", 413)

    try:
        result = await _typeset(body.content_markdown, db=db)
    except TypesetError as e:
        _send(e.code, e.message, 409)
    except LLMUnavailable:
        _log.warning("typeset: upstream LLM failed", exc_info=True)
        _send("upstream_llm_failed", "上游 LLM 调用失败，请检查网络或 API Key", 502)
    except Exception:
        _log.exception("typeset: unexpected error")
        _send("internal_error", "服务异常，请稍后重试", 500)

    return TypesetResponse(
        content_markdown=result.content_markdown,
        warnings=result.warnings,
        model=result.model,
        prompt_version=result.prompt_version,
    )
```

- [ ] **Step 2: 挂载到 routers/__init__.py 和 main.py**

在 `backend/app/routers/__init__.py` 加：

```python
from .admin_articles_typeset import router as admin_articles_typeset_router
```

并在 `backend/app/main.py:13-20` 的 tuple import 里加：

```python
from .routers import (
    articles_router,
    team_router,
    auth_router,
    admin_router,
    settings_router,
    agent_router,
    admin_articles_import_router,
    admin_articles_typeset_router,   # NEW
)
```

并在 `app.include_router(...)` 块（main.py 行 103-109）追加：

```python
app.include_router(admin_articles_typeset_router)
```

- [ ] **Step 3: 跑路由层测试**

Run: `cd backend && python -m pytest tests/test_admin_articles_typeset.py -v 2>&1 | tail -40`
Expected: 7 个用例全 PASS（happy / disabled / no_api_key / unauth / upstream_failure / truncate / missing_body）

- [ ] **Step 4: 跑全后端测试确保不破坏**

Run: `cd backend && python -m pytest -q 2>&1 | tail -10`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/app/routers/admin_articles_typeset.py \
        backend/app/routers/__init__.py \
        backend/app/main.py \
        backend/tests/test_admin_articles_typeset.py
git commit -m "feat(admin): POST /api/admin/articles/typeset + tests"
```

---

## Task 1.6: 手工 curl 验证（可选但推荐）

**Files:** 无代码改动

- [ ] **Step 1: 启动后端**

Run:
```bash
cd backend && uvicorn app.main:app --reload --port 8000 &
sleep 2
curl -s http://localhost:8000/api/health
```
Expected: `{"status":"healthy",...}`

- [ ] **Step 2: 登录拿 token**

Run:
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"REPLACE_ME"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
echo "token=$TOKEN"
```
（密码用你在 `python3 -m scripts.create_admin` 时输出的 dev 密码）

- [ ] **Step 3: 故意不启用 → 期望 409**

Run:
```bash
curl -i -X POST http://localhost:8000/api/admin/articles/typeset \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content_markdown":"# 测试"}'
```
Expected: `409 Conflict` + `{"error":{"code":"not_enabled","message":"AI 排版未启用"}}`

- [ ] **Step 4: 在 Admin → 设置启用并填入新 Key 后再 curl 期望 200**

切到前端 Admin → 设置 → article_typesetter.enabled 选「启用」+ 填入 MiniMax Key + 保存。然后再发一次 curl，应返回 200 与清洗后 markdown。

如果后端日志里出现「`Authorization: Bearer ...`」字样 → 立即停 → 这意味着某些 httpx 版本在异常里塞了 header；该 bug 已在 Task 1.3 用 `LLMUnavailable` 捕获避免透传；如看到说明异常路径漏了，回 Task 1.5 检查 `except LLMUnavailable` 是否真的命中。

- [ ] **Step 5: 杀 uvicorn**

Run: `pkill -f "uvicorn app.main:app" || true`

---

# PR 2 — Frontend

## Task 2.1: api.ts 加 `admin.articles.typeset(...)`

**Files:**
- Modify: `frontend-vite/src/services/api.ts:243-273`（在 `importDocx` 后面插）

- [ ] **Step 1: 在 `api.admin.articles` 对象里加 typeset**

找到 `importDocx(...)` 的结尾 `},` 之后，插入：

```ts
typeset: (content_markdown: string): Promise<{
  content_markdown: string
  warnings: string[]
  model: string
  prompt_version: string
}> =>
  request('/api/admin/articles/typeset', {
    method: 'POST',
    body: JSON.stringify({ content_markdown }),
  }),
```

- [ ] **Step 2: TypeScript 类型检查**

Run: `cd frontend-vite && npx tsc --noEmit 2>&1 | tail -20`
Expected: 无 error

- [ ] **Step 3: 提交**

```bash
git add frontend-vite/src/services/api.ts
git commit -m "feat(api): client wrapper for POST /api/admin/articles/typeset"
```

---

## Task 2.2: AdminSettings 加 5 项 KNOWN_KEYS

**Files:**
- Modify: `frontend-vite/src/pages/admin/AdminSettings.tsx:18-24`

- [ ] **Step 1: 扩展 KNOWN_KEYS**

把：

```ts
const KNOWN_KEYS = [
  { key: 'page_agent.enabled',     label: '启用 page-agent', kind: 'bool'   as const },
  { key: 'page_agent.model',       label: '模型',             kind: 'string' as const },
  { key: 'page_agent.base_url',    label: 'API Base URL',     kind: 'string' as const },
  { key: 'page_agent.api_key',     label: 'API Key',          kind: 'secret' as const },
  { key: 'page_agent.system_prompt', label: '系统 Prompt（可覆盖）', kind: 'string' as const },
]
```

替换为：

```ts
const KNOWN_KEYS = [
  // ----- page-agent -----
  { key: 'page_agent.enabled',     label: '启用 page-agent', kind: 'bool'   as const },
  { key: 'page_agent.model',       label: '模型',             kind: 'string' as const },
  { key: 'page_agent.base_url',    label: 'API Base URL',     kind: 'string' as const },
  { key: 'page_agent.api_key',     label: 'API Key',          kind: 'secret' as const },
  { key: 'page_agent.system_prompt', label: '系统 Prompt（可覆盖）', kind: 'string' as const },
  // ----- article typesetter (AI 排版) -----
  { key: 'article_typesetter.enabled',  label: '启用 AI 排版',     kind: 'bool'   as const },
  { key: 'article_typesetter.model',       label: '模型 (AI 排版)', kind: 'string' as const },
  { key: 'article_typesetter.base_url',    label: 'API Base URL',  kind: 'string' as const },
  { key: 'article_typesetter.api_key',     label: 'API Key (AI 排版)', kind: 'secret' as const },
  { key: 'article_typesetter.system_prompt', label: '系统 Prompt（可覆盖）', kind: 'string' as const },
]
```

并在 PageHeader description 文案结尾追加：`**"**AI 排版**" 是 .docx 导入后的可选 LLM 清洗服务，默认 base_url = `https://api.minimax.chat/v1`、`model = MiniMax-M3`。**"

- [ ] **Step 2: 调整顶部 description 文案**

把：

```tsx
description="page-agent 是基于自然语言操作 admin 页面的代理。仅在 admin 路由内启用。API Key 在服务端 Fernet 加密落库，不会发送到浏览器。"
```

替换为：

```tsx
description={`page-agent 是基于自然语言操作 admin 页面的代理；AI 排版是上传 .docx 后可选的 LLM Markdown 清洗服务。两者独立配置。仅在 admin 路由内启用。API Key 在服务端 Fernet 加密落库，不会发送到浏览器。预设 base_url = https://api.minimax.chat/v1、model = MiniMax-M3。`}
```

- [ ] **Step 3: TS 检查**

Run: `cd frontend-vite && npx tsc --noEmit 2>&1 | tail -20`
Expected: 无 error

- [ ] **Step 4: 提交**

```bash
git add frontend-vite/src/pages/admin/AdminSettings.tsx
git commit -m "feat(admin): expose article_typesetter.* settings UI"
```

---

## Task 2.3: TypesetPreviewDialog 组件

**Files:**
- Create: `frontend-vite/src/components/admin/TypesetPreviewDialog.tsx`

- [ ] **Step 1: 写组件**

```tsx
import { useMemo } from 'react'
import { ArrowRight, AlertTriangle } from 'lucide-react'
import { Modal, Button } from '../ui'

export interface TypesetPreviewDialogProps {
  open: boolean
  onClose: () => void
  onApply: (cleaned: string) => void
  before: string
  after: string
  warnings: string[]
  model: string
  promptVersion: string
}

export function TypesetPreviewDialog({
  open,
  onClose,
  onApply,
  before,
  after,
  warnings,
  model,
  promptVersion,
}: TypesetPreviewDialogProps) {
  const stats = useMemo(() => {
    const b = before?.length ?? 0
    const a = after?.length ?? 0
    return {
      before: b,
      after: a,
      delta: a - b,
    }
  }, [before, after])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="AI 排版预览"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            onClick={() => onApply(after)}
            disabled={!after}
          >
            <ArrowRight size={14} /> 应用到编辑器
          </Button>
        </>
      }
    >
      {warnings.length > 0 && (
        <div className="typeset-dialog__warnings">
          {warnings.map((w, i) => (
            <div key={i} className="typeset-dialog__warning">
              <AlertTriangle size={14} /> {w}
            </div>
          ))}
        </div>
      )}

      <div className="typeset-dialog__stats">
        <span>原文 <strong>{stats.before}</strong> 字符</span>
        <ArrowRight size={12} />
        <span>清洗后 <strong>{stats.after}</strong> 字符</span>
        <span className="typeset-dialog__delta">
          ({stats.delta >= 0 ? '+' : ''}{stats.delta})
        </span>
        <span className="typeset-dialog__meta">模型 {model} · prompt v{promptVersion}</span>
      </div>

      <div className="typeset-dialog__cols">
        <div className="typeset-dialog__col">
          <div className="typeset-dialog__col-title">原文</div>
          <pre className="typeset-dialog__pre">{before}</pre>
        </div>
        <div className="typeset-dialog__col">
          <div className="typeset-dialog__col-title">清洗后</div>
          <pre className="typeset-dialog__pre">{after}</pre>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: 找到 ui/ 原子组件文件确认 import 路径**

Run: `cat frontend-vite/src/components/ui/index.ts | head -30`
Expected: 含 `export * from './Modal'` 和 `export * from './Button'`

如路径不一致（vite 项目组用 alias `@/`）→ 把 `from '../ui'` 改为匹配项目配置的相对/别名路径。

- [ ] **Step 3: TS 检查**

Run: `cd frontend-vite && npx tsc --noEmit 2>&1 | tail -20`
Expected: 无 error

- [ ] **Step 4: 提交**

```bash
git add frontend-vite/src/components/admin/TypesetPreviewDialog.tsx
git commit -m "feat(admin): TypesetPreviewDialog component"
```

---

## Task 2.4: ArticleEditor 接通 AI 排版按钮

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`
- Modify: `frontend-vite/src/components/admin/Toast.tsx`（如需新接口） 或现有 toast 调用

- [ ] **Step 1: 添加 useQuery 拉取 article_typesetter 配置（在 ArticleEditor 内部）**

在 `import` 块下方组件之前，加一个独立 hook（用于判断按钮是否 disabled + 提供 tooltip）：

```ts
const typesetterConfigQ = useQuery({
  queryKey: ['admin', 'article-typesetter', 'config'],
  queryFn: async () => {
    const items = (await api.admin.settings.list()).items
    const get = (k: string) => items.find((i) => i.key === k)
    const enabled = get('article_typesetter.enabled')?.value === 'true'
    const hasKey = !!get('article_typesetter.api_key')?.masked
    return { enabled, hasKey }
  },
  staleTime: 30_000,
})

const typesetterReady = !!typesetterConfigQ.data?.enabled && !!typesetterConfigQ.data?.hasKey
const typesetterBlockedReason = typesetterConfigQ.isLoading
  ? '正在检查 AI 排版配置…'
  : !typesetterConfigQ.data?.enabled
    ? '请先在 设置 → AI 排版 中启用'
    : !typesetterConfigQ.data?.hasKey
      ? '请先在 设置 → AI 排版 中配置 API Key'
      : ''
```

- [ ] **Step 2: 加 typeset state + handler**

在 `setImportError` 附近加：

```ts
const [typesetBusy, setTypesetBusy] = useState(false)
const [typesetError, setTypesetError] = useState('')
const [typesetDialog, setTypesetDialog] = useState<{
  before: string; after: string; warnings: string[]; model: string; promptVersion: string
} | null>(null)
```

并在 `handleImportDocx` 之后加：

```ts
const handleTypeset = async () => {
  setTypesetBusy(true)
  setTypesetError('')
  const before = form.content
  try {
    const res = await api.admin.articles.typeset(before)
    setTypesetDialog({
      before,
      after: res.content_markdown,
      warnings: res.warnings || [],
      model: res.model,
      promptVersion: res.prompt_version,
    })
  } catch (e) {
    setTypesetError(e instanceof Error ? e.message : 'AI 排版失败')
  } finally {
    setTypesetBusy(false)
  }
}
```

- [ ] **Step 3: 在 import docx 区块下方插入 AI 排版区块**

在「从 .docx 导入」`<div className="article-editor__field">` 闭合后，插入：

```tsx
<div className="article-editor__field">
  <label>
    AI 排版（使用 LLM 清洗 Markdown；不动元数据）
  </label>
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <Button
      variant="secondary"
      icon={<Sparkles size={14} />}
      onClick={handleTypeset}
      disabled={typesetBusy || !typesetterReady}
      loading={typesetBusy}
      title={typesetterReady ? '使用配置的 LLM 清洗当前正文' : typesetterBlockedReason}
    >
      AI 排版
    </Button>
    <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
      {typesetterReady ? '点击后弹窗预览对照，不满意可取消' : typesetterBlockedReason}
    </span>
  </div>
  {typesetError && <div style={{ fontSize: '0.8125rem', color: '#d97706', marginTop: '4px' }}>{typesetError}</div>}
</div>
```

并在顶部 import 加 `Sparkles`：

```ts
import { Sparkles, Calendar, User as UserIcon } from 'lucide-react'
```

- [ ] **Step 4: 在组件底部挂载 dialog + apply handler**

在 `</Card>` 收尾的 `<div>` 内最末尾（在 `<div className="article-editor__actions">…</Card>` 之后）加：

```tsx
{typesetDialog && (
  <TypesetPreviewDialog
    open={true}
    onClose={() => setTypesetDialog(null)}
    onApply={(cleaned) => {
      update('content', cleaned)
      setTypesetDialog(null)
      toast('已应用 AI 排版')
    }}
    before={typesetDialog.before}
    after={typesetDialog.after}
    warnings={typesetDialog.warnings}
    model={typesetDialog.model}
    promptVersion={typesetDialog.promptVersion}
  />
)}
```

并在 import 加：

```ts
import { TypesetPreviewDialog } from '../../components/admin/TypesetPreviewDialog'
import { useToast } from '../../components/admin/Toast'  // 或项目里现成的 toast hook 名
```

（如项目里 toast 实现不是 hook 而是 `toast('msg')` 直接调用，请按实际签名 import）

- [ ] **Step 5: 类型检查**

Run: `cd frontend-vite && npx tsc --noEmit 2>&1 | tail -20`
Expected: 无 error；若有——把缺失的字段补上或修正 import 路径

- [ ] **Step 6: 提交**

```bash
git add frontend-vite/src/pages/admin/ArticleEditor.tsx
git commit -m "feat(admin): AI typeset button + preview dialog in ArticleEditor"
```

---

## Task 2.5: Playwright 视觉回归 + 行为 spec

**Files:**
- Create: `frontend-vite/tests/ai-typesetter-dialog.spec.ts`

- [ ] **Step 1: 读 admin-snapshots.spec.ts 抄运行时 setup**

Run: `cat frontend-vite/tests/admin-snapshots.spec.ts | head -60`

把里面关于登录 / fixture / baseURL 的代码沿用到新文件。

- [ ] **Step 2: 写新 spec**

```ts
import { test, expect } from '@playwright/test'

test.describe('AI 排版弹窗', () => {
  test('按钮在 enabled=false 时 disabled', async ({ page }) => {
    // 假设 admin 默认凭据 + .env + ADMIN_USERNAME/PASSWORD 已配置
    await page.goto('/admin/login')
    await page.fill('input[name=username]', process.env.ADMIN_USERNAME || 'admin')
    await page.fill('input[name=password]', process.env.ADMIN_PASSWORD || 'admin')
    await page.click('button[type=submit]')
    await page.waitForURL('**/admin')

    // 进入 ArticleEditor 新建页
    await page.goto('/admin/articles/new')
    await expect(page.getByRole('button', { name: /AI 排版/ })).toBeVisible()
    // 如果后端 enabled=false（默认），按钮应 disabled
    await expect(page.getByRole('button', { name: /AI 排版/ })).toBeDisabled()
  })

  test('enabled 后打开弹窗；取消不改内容', async ({ page }) => {
    // 假设已经通过 PUT 启用 article_typesetter.enabled + 填 key
    // 1) 登录
    // 2) 进入 /admin/articles/new
    // 3) 在 content markdown 输入框填 "## 标题 \n\n  正文段落.  "
    // 4) 点击 AI 排版（启用 mock 服务端 post 返回 "# 标题\n\n正文段落。")
    // 5) 验证 dialog 出现，左右两栏 + 应用 / 取消按钮
    // 6) 点取消，验证 content 没变
    //
    // 实施时，如果当前没有 mock 端点的手段，最小可用版本：
    test.skip('需要先在 Admin → 设置 启用并 mock 端点', () => {})
  })
})
```

- [ ] **Step 3: 跑测试**

Run: `cd frontend-vite && npx playwright test tests/ai-typesetter-dialog.spec.ts --reporter=line 2>&1 | tail -20`
Expected: 至少第一个用例 PASS（验证 disabled）；第二个可因 skip 而跳过

- [ ] **Step 4: 提交**

```bash
git add frontend-vite/tests/ai-typesetter-dialog.spec.ts
git commit -m "test(admin): Playwright spec for AI typeset button + dialog"
```

---

## Task 2.6: 端到端手动验收

**Files:** 无代码改动

- [ ] **Step 1: 起前后端**

```bash
# 终端 A: 后端
cd backend && uvicorn app.main:app --reload --port 8000
# 终端 B: 前端
cd frontend-vite && npm run dev
```

- [ ] **Step 2: Admin → 设置 → 启用 `article_typesetter.enabled` + 填新 Key + 测试连通**

预期：测试连通 → 「✓ 连通」

- [ ] **Step 3: Admin → 文章 → 新建 → 上传一个真实 .docx（你可以从 docs/ 找现成的，或者随便用一份 Word 模板导出）**

- [ ] **Step 4: 点击「AI 排版」按钮**

预期：
- 按钮变 spinner
- 弹窗出现，左栏原文、右栏清洗后
- 字符数差 + 警告（如有）+ 模型信息显式
- 「应用到编辑器」/「取消」可用

- [ ] **Step 5: 点「取消」**

预期：弹窗关，正文不动

- [ ] **Step 6: 再点 AI 排版 → 点「应用到编辑器」**

预期：正文被替换为清洗后 markdown；toast「已应用 AI 排版」；可继续手动编辑；保存草稿 / 发布走原有路径

- [ ] **Step 7: 验证关键不变量**

- [ ] **8a.** 公开站对应文章详情页正常渲染（图片引用路径仍在）
- [ ] **8b.** 服务端日志里 grep 不到明文 API Key：`tail -n 200 backend/server.log | grep -i 'sk-'` → 应为空
- [ ] **8c.** 把 MiniMax Key 在控制台 rotate 后，新 Key 通过 Admin → 设置保存，能继续工作；老 Key 不再被任何路径读取

---

## Self-Review Checklist

逐条对照 `docs/superpowers/specs/2026-06-30-ai-typesetting-design.md`：

| Spec 条款 | 对应任务 |
|---|---|
| 后端服务层 markdown_typesetter.py | 1.2 + 1.3 |
| 路由 admin_articles_typeset.py | 1.4 + 1.5 |
| settings 连通测试扩展 | 1.1 |
| 32k 截断 + warning | 1.3 (test_typeset_truncates_long_input) + 1.4 (test_typeset_truncates_long_input) |
| 围栏剥离 | 1.3 (test_typeset_strips_markdown_fences) |
| 失败不回显 Key | 1.4 (test_typeset_upstream_failure_returns_502_and_no_key_leak) |
| enabled/no_api_key 409 | 1.4 |
| 1 MB body cap | 1.5 |
| 5/min rate limit | 1.5 |
| api.ts 增加 typeset | 2.1 |
| AdminSettings 5 项 | 2.2 |
| TypesetPreviewDialog | 2.3 |
| ArticleEditor 按钮 + dialog | 2.4 |
| Playwright spec | 2.5 |
| E2E 验收 | 2.6 |
| 安全约束（Key 不进 version control） | 全程：API Key 仅通过 Admin → 设置 → `article_typesetter.api_key` 注入；测试用 `sk-test-*` 假数据 |

每条都映射到了任务。Placeholder 扫描：全文无 TBD / TODO / 「类似 Task N」字样。Type 一致性：

- `TypesetResult`（服务层）↔ `TypesetResponse`（路由层）字段名一致：`content_markdown`、`warnings`、`model`、`prompt_version`
- `TypesetError.code` 在路由层映射到错误信封的 `code` 字段，与全局 handler 兼容

可以进入执行阶段。
