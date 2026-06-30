# page-agent DOM Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the public homepage's `page-agent-fab` from a text-only Q&A widget into a dual-mode (chat + DOM-operate) page-agent that reads/anthropomorphises with the user in Chinese, never exposes the LLM API key to the browser, and is hardened against anonymous misuse by data-attribute blacklists plus 10 defence layers.

**Architecture:** `page-agent` v1.10 npm package runs client-side, but every OpenAI tool-calling request is funnelled through `LLMConfig.customFetch` → `POST /api/public/agent/llm` → server decrypts `page_agent.api_key` from `AdminSetting` → forwards via `httpx.AsyncClient`. The lighter "chat" path stays on the existing `/api/public/agent/execute` (no DOM loop). Admin-side chat proxy endpoints are deleted; the connectivity probe under `/api/admin/settings/{key}/test` migrates into `settings_router.py`.

**Tech Stack:** Python 3.12 + FastAPI + SQLAlchemy + httpx (backend); React 19 + Vite 8 + TypeScript + `@tanstack/react-query` + `page-agent@^1.10` (frontend). Tests: pytest + httpx mock; Playwright 1.61 for browser.

**Spec:** `docs/superpowers/specs/2026-06-30-page-agent-dom-mode-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/app/services/page_agent_config.py` | CREATE | Shared `_load_chat_config`, `_is_allowed_url` helpers consumed by both public chat and LLM proxy |
| `backend/app/routers/public_agent_router.py` | MODIFY | Add `/agent/llm` endpoint (proxy); thread `mode`/tools through `/agent/execute` |
| `backend/app/routers/agent_router.py` | MODIFY (slim) | Delete `/config`, `/execute`; drop connected imports |
| `backend/app/routers/settings_router.py` | MODIFY | Receive connectivity probe `/{key}/test` + `_TESTABLE_API_KEYS` migration |
| `backend/app/services/admin_setting_defaults.py` | MODIFY | Append "DOM 操作护栏" section to `DEFAULT_PAGE_AGENT_SYSTEM_PROMPT` |
| `backend/app/main.py` | MODIFY | (no router changes — both `agent_router` and `public_agent_router` still registered) |
| `backend/app/routers/__init__.py` | MODIFY | (no removal — `agent_router` still re-exported for `/settings/{key}/test`) |
| `backend/tests/test_public_agent.py` | MODIFY | Add 7 dom-mode cases (URL prefix, Referer, rate-limit-dom, payload cap, key non-leak, tools passthrough, dom_https requirement) |
| `backend/tests/test_admin_settings_synthesis.py` | MODIFY | Assert new safety rails appear in synthesised default system_prompt |
| `backend/tests/test_agent_router_admin.py` (if exists) | DELETE or RELOCATE | Move connectivity-probe case into `test_admin_settings.py` |
| `frontend-vite/src/lib/pageAgent.ts` | CREATE | `customFetch`, `maskSecrets`, `getPageHint` helpers |
| `frontend-vite/src/components/PublicPageAgentMount.tsx` | CREATE (top-level) | New mount point: instantiates `PageAgent` instance with `customFetch` |
| `frontend-vite/src/components/ai/PageAgentFab.tsx` | CREATE | Floating Sparkles button + float animation |
| `frontend-vite/src/components/ai/PageAgentFab.module.css` | CREATE | FAB styles (module-scoped) |
| `frontend-vite/src/components/ai/PageAgentPanel.tsx` | CREATE | Wraps `agent.panel`; renders dual-mode "问他"/"让他操作" buttons |
| `frontend-vite/src/components/ai/PageAgentPanel.module.css` | CREATE | Panel container styles (Tailwind tokens compatible) |
| `frontend-vite/src/components/admin/PageAgentPanel.tsx` | DELETE | Replaced by the new frontend-side `ai/PageAgentPanel.tsx` |
| `frontend-vite/src/components/admin/PageAgentMount.tsx` | DELETE | Admin no longer needs the FAB |
| `frontend-vite/src/components/admin/PublicPageAgentMount.tsx` | DELETE | Superseded by the new top-level `PublicPageAgentMount.tsx` |
| `frontend-vite/src/components/admin/PageAgentPanel.css` | DELETE | Replaced by module CSS |
| `frontend-vite/src/components/admin/AdminLayout.tsx` | MODIFY | Remove `PageAgentMount` import and JSX usage |
| `frontend-vite/src/pages/admin/AdminSettings.tsx` | MODIFY | Update `PAGE_AGENT_SECTION.blurb` to reflect FAB is now public-only |
| `frontend-vite/src/App.tsx` | MODIFY | Update import path for `PublicPageAgentMount` |
| `frontend-vite/src/services/api.ts` | MODIFY | Drop `api.admin.agent.*`; add `api.public.agent.llm({url, init})` |
| `frontend-vite/package.json` | MODIFY | Add `page-agent@^1.10` |
| `frontend-vite/src/pages/admin/ArticleEditor.tsx` | MODIFY | Add `data-ai-blocked` to save/publish/archive/delete buttons |
| `frontend-vite/src/pages/admin/AdminLogin.tsx` | MODIFY | Add `data-ai-blocked` to login submit button |
| `frontend-vite/src/pages/admin/Dashboard.tsx` | MODIFY | Add `data-ai-blocked` to any destructive controls |
| `frontend-vite/src/pages/admin/ArticleList.tsx` | MODIFY | Add `data-ai-blocked` to delete / bulk-action buttons |
| `frontend-vite/src/pages/admin/MediaLibrary.tsx` | MODIFY | Add `data-ai-blocked` to delete buttons |
| `frontend-vite/src/pages/admin/JournalEditor.tsx` | MODIFY | Add `data-ai-blocked` to publish/unpublish/delete controls |
| `frontend-vite/src/pages/admin/JournalList.tsx` | MODIFY | Add `data-ai-blocked` to publish/delete row controls |
| `frontend-vite/src/components/NewsletterForm.tsx` | MODIFY | Add `data-ai-blocked` to subscribe submit |
| `frontend-vite/tests/public-page-agent.spec.ts` | CREATE | Playwright FAB + dual-mode + blocked-button cases |

---

## Phase 1 — Backend

### Task 1: Shared page-agent config helpers

**Files:**
- Create: `backend/app/services/page_agent_config.py`
- Test: `backend/tests/test_page_agent_config.py`

- [ ] **Step 1: Write the failing test**

Append `backend/tests/test_page_agent_config.py`:

```python
"""Unit tests for backend/app/services/page_agent_config.py."""
import pytest
from urllib.parse import urlparse

from app.services.page_agent_config import (
    _load_chat_config,
    _is_allowed_url,
    ChatConfig,
)


class FakeResult:
    """Mimics the DB row returned by ``_load_chat_config``."""
    def __init__(self, rows):
        self._rows = {k: v for k, v in rows.items()}
    def get(self, key, default=None):
        return self._rows.get(key, default)


def test_load_chat_config_returns_required_fields():
    cfg = _load_chat_config({
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
        _load_chat_config({"page_agent.enabled": "false", "page_agent.api_key": "sk-x"})


def test_load_chat_config_rejects_missing_api_key():
    with pytest.raises(ValueError, match="no_api_key"):
        _load_chat_config({"page_agent.enabled": "true"})


def test_load_chat_config_requires_https_for_dom():
    cfg = _load_chat_config({
        "page_agent.enabled": "true",
        "page_agent.api_key": "sk-x",
        "page_agent.base_url": "http://api.deepseek.com/v1",   # http!
    })
    with pytest.raises(ValueError, match="dom_requires_https"):
        _load_chat_config(
            {k: v for k, v in cfg.__dict__.items() if k != "api_key"} | {"page_agent.api_key": "sk-x"},
            mode="dom",
        )


def test_is_allowed_url_strict_match():
    base = "https://api.deepseek.com/v1"
    assert _is_allowed_url("https://api.deepseek.com/v1/chat/completions", base) is True
    assert _is_allowed_url("https://api.deepseek.com/v2/chat/completions", base) is False
    assert _is_allowed_url("http://api.deepseek.com/v1/chat/completions", base) is False
    assert _is_allowed_url("https://evil.com/v1/chat/completions", base) is False
    assert _is_allowed_url("https://api.deepseek.com.evil.com/v1/chat/completions", base) is False
    assert _is_allowed_url("https://api.deepseek.com:8443/v1/chat/completions", base) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_page_agent_config.py -v`
Expected: ImportError or AttributeError because `app.services.page_agent_config` does not exist.

- [ ] **Step 3: Implement minimal helper**

Create `backend/app/services/page_agent_config.py`:

```python
"""Shared settings-loader for the page-agent endpoints (chat + LLM proxy).

Centralised so that ``public_agent_router.execute`` and the new
``public_agent_router.agent_llm`` endpoint both read the same way and
enforce the same mode-specific guards. The model is intentionally a tiny
plain dataclass — admin setting rows are the SoT and what admin stores
is what gets read.
"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class ChatConfig:
    model: str
    base_url: str
    api_key: str


class PageAgentConfigError(ValueError):
    """Raised by ``_load_chat_config`` when the admin-visible gate fails.

    Each error carries a stable ``code`` matching the {error.code} envelope
    that the public router already returns (so the frontend toasts the
    right remediation hint).
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _is_enabled(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in ("true", "1", "yes")


def _load_chat_config(rows: dict, *, mode: str = "chat") -> ChatConfig:
    """Lift settings rows (or a synthesised default-dict) into a ChatConfig.

    ``rows`` is a key→decrypted-value dict (read by the caller). This
    function enforces the gate that both ``/agent/execute`` and
    ``/agent/llm`` share (admin toggle + non-empty key), plus the
    ``dom_requires_https_base_url`` check for the LLM proxy mode.
    """
    if not rows:
        raise PageAgentConfigError("not_enabled", "page-agent 未启用")
    enabled_raw = rows.get("page_agent.enabled", "")
    if not _is_enabled(enabled_raw):
        raise PageAgentConfigError("not_enabled", "page-agent 未启用")
    api_key = rows.get("page_agent.api_key") or ""
    if not api_key:
        raise PageAgentConfigError("no_api_key", "未配置 page_agent.api_key")
    base_url = rows.get("page_agent.base_url", "")
    if mode == "dom" and not base_url.startswith("https://"):
        raise PageAgentConfigError(
            "dom_requires_https_base_url",
            "DOM 模式要求 base_url 为 https",
        )
    model = rows.get("page_agent.model") or "deepseek-v4-flash"
    return ChatConfig(model=model, base_url=base_url, api_key=api_key)


def _is_allowed_url(target: str, base_url: str) -> bool:
    """Strictly match ``target`` against ``base_url`` (scheme+host+port+path).

    Defends against DNS-rebinding suffix tricks (e.g.
    ``evil.com/api.deepseek.com/``). The scheme must be https for both;
    host names are an exact (case-insensitive) string match; ports must
    match (or both be the https default); the path must be a prefix of
    the configured base URL.
    """
    try:
        a = urlparse(target)
        b = urlparse(base_url)
    except ValueError:
        return False
    if a.scheme != "https" or b.scheme != "https":
        return False
    if (a.hostname or "").lower() != (b.hostname or "").lower():
        return False
    if (a.port or 443) != (b.port or 443):
        return False
    return (a.path or "").startswith(b.path.rstrip("/") + "/") or a.path == b.path


__all__ = ["ChatConfig", "PageAgentConfigError", "_load_chat_config", "_is_allowed_url"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_page_agent_config.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add backend/app/services/page_agent_config.py backend/tests/test_page_agent_config.py
git commit -m "feat(backend): page_agent_config shared loader + URL-strict validator"
```

---

### Task 2: Add `/api/public/agent/llm` proxy endpoint

**Files:**
- Modify: `backend/app/routers/public_agent_router.py:114-198`
- Modify: `backend/tests/test_public_agent.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_public_agent.py`:

```python
from unittest.mock import AsyncMock, patch
import httpx


class _FakeResponse:
    def __init__(self, *, status_code=200, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data
        self.text = text if not json_data else ""
        self.headers = httpx.Headers({"content-type": "application/json"})

    def json(self):
        return self._json


def test_public_config_returns_system_prompt(client_factory):
    """The /config response must surface system_prompt so the front-end
    PageAgent instance can forward it via customSystemPrompt."""
    client = client_factory(
        api_key="sk-real",
        system_prompt="你是湖北数创助手（自定义 prompt）。",
    )
    r = client.get("/api/public/agent/config")
    assert r.status_code == 200
    body = r.json()
    assert "system_prompt" in body
    assert body["system_prompt"].startswith("你是")
    assert "api_key" not in body   # double-check no leak


def test_public_config_falls_back_to_default_prompt(client_factory):
    """When no DB row for system_prompt exists, the preset default
    (with safety rails) must still be returned."""
    client = client_factory(api_key="sk-real", system_prompt=None)
    r = client.get("/api/public/agent/config")
    assert r.status_code == 200
    sp = r.json().get("system_prompt", "")
    assert "data-ai-blocked" in sp   # safety rail baked into default


def test_agent_llm_passes_tools_schema_through(client_factory, monkeypatch):
    """page-agent sends OpenAI-format {messages, tools, tool_choice='required'}.
    The proxy must forward this body verbatim to the upstream LLM."""
    upstream = _FakeResponse(
        status_code=200,
        json_data={
            "choices": [{
                "index": 0,
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "tool_calls": [{"function": {"name": "click", "arguments": "{}"}}],
                },
            }],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
        },
    )

    captured: dict = {}

    async def fake_send(self, request, **kwargs):
        captured["url"] = str(request.url)
        import json as _json
        captured["body"] = _json.loads(request.content.decode())
        return upstream

    monkeypatch.setattr(
        "httpx.AsyncClient.send", fake_send,
    )

    client = client_factory(
        api_key="sk-real",
        base_url="https://api.deepseek.com/v1",
    )
    init = {
        "method": "POST",
        "headers": {"content-type": "application/json"},
        "body": '{"messages":[{"role":"user","content":"hi"}],"tools":[],"tool_choice":"required"}',
    }
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
        headers={"Referer": str(client.base_url) + "/"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["choices"][0]["finish_reason"] == "tool_calls"
    assert "Authorization" not in captured["body"]
    assert captured["body"]["tools"] == []


def test_agent_llm_rejects_non_allowed_url(client_factory):
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://evil.com/v1/chat/completions", "init": init},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "url_not_allowed"


def test_agent_llm_rejects_bad_referer(client_factory):
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
        headers={"Referer": "https://evil.com"},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "referer_not_allowed"


def test_agent_llm_payload_too_large(client_factory):
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "a" * (2 * 1024 * 1024 + 1)}
    r = client.post(
        "/api/public/agent/llm",
        json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"


def test_agent_llm_rate_limit_separate_from_chat(client_factory):
    client = client_factory(api_key="sk-real")
    init = {"method": "POST", "body": "{}"}
    # 5 calls allowed for dom; 6th must fail.
    for _ in range(5):
        with patch.object(
            "httpx.AsyncClient", "send",
            new=AsyncMock(return_value=_FakeResponse(json_data={"choices": [{"message": {}}], "usage": {}})),
        ):
            r = client.post(
                "/api/public/agent/llm",
                json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
            )
            assert r.status_code == 200
    with patch.object(
        "httpx.AsyncClient", "send",
        new=AsyncMock(return_value=_FakeResponse(json_data={"choices": [{"message": {}}], "usage": {}})),
    ):
        r = client.post(
            "/api/public/agent/llm",
            json={"url": "https://api.deepseek.com/v1/chat/completions", "init": init},
        )
        assert r.status_code == 429
        assert r.json()["error"]["code"] == "rate_limited"


def test_agent_llm_no_api_key_leak(client_factory, monkeypatch):
    async def boom(self, request, **kwargs):
        raise httpx.RemoteProtocolError(
            "Authorization: Bearer sk-real",
            request=request,
        )

    monkeypatch.setattr("httpx.AsyncClient.send", boom)
    client = client_factory(api_key="sk-real")
    r = client.post(
        "/api/public/agent/llm",
        json={
            "url": "https://api.deepseek.com/v1/chat/completions",
            "init": {"method": "POST", "body": "{}"},
        },
    )
    assert r.status_code == 502
    assert "sk-real" not in r.text
```

Add a `client_factory` helper at the top of the file (it currently doesn't exist — adjust as needed):

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.admin_setting import AdminSetting
from app.services.crypto import encrypt_value


@pytest.fixture
def client_factory(monkeypatch):
    """Yield a factory that builds a TestClient with configurable page_agent.* rows."""
    engines: list = []

    def factory(*, enabled="true", api_key="sk-test", base_url="https://api.deepseek.com/v1", model="deepseek-v4-flash", system_prompt=None):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine)
        engines.append(engine)
        SessionLocal = sessionmaker(bind=engine)
        db = SessionLocal()
        db.add(AdminSetting(
            key="page_agent.enabled",
            value_encrypted=encrypt_value(enabled),
            is_secret=False,
            updated_by="test",
        ))
        db.add(AdminSetting(
            key="page_agent.api_key",
            value_encrypted=encrypt_value(api_key),
            is_secret=True,
            updated_by="test",
        ))
        db.add(AdminSetting(
            key="page_agent.base_url",
            value_encrypted=encrypt_value(base_url),
            is_secret=False,
            updated_by="test",
        ))
        db.add(AdminSetting(
            key="page_agent.model",
            value_encrypted=encrypt_value(model),
            is_secret=False,
            updated_by="test",
        ))
        if system_prompt is not None:
            db.add(AdminSetting(
                key="page_agent.system_prompt",
                value_encrypted=encrypt_value(system_prompt),
                is_secret=False,
                updated_by="test",
            ))
        db.commit()

        def _override_get_db():
            try:
                db2 = SessionLocal()
                yield db2
            finally:
                db2.close()

        app.dependency_overrides[get_db] = _override_get_db
        return TestClient(app)

    yield factory

    for e in engines:
        e.dispose()
    app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_public_agent.py -v`
Expected: 6 FAILED with `404 Not Found` on `/api/public/agent/llm` (route doesn't exist yet).

- [ ] **Step 3: Implement the new endpoint + extend `/config` to return `system_prompt`**

Edit `backend/app/routers/public_agent_router.py` — add helper imports at the top:

```python
import json
import httpx
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from ..services.page_agent_config import (
    ChatConfig,
    PageAgentConfigError,
    _load_chat_config,
    _is_allowed_url,
)
```

(The existing `from fastapi import ...` etc. should stay where it is; the lines above are what to ADD — in particular `Response` and `Literal`.)

Extend the existing `get_public_agent_config` handler (currently at lines 116-129) to also surface `system_prompt`:

```python
@router.get("/config")
def get_public_agent_config(db: Session = Depends(get_db)):
    """Public read of the page-agent config — no auth, no api_key leakage.

    `enabled` is True ONLY when the admin has set `page_agent.enabled=true`
    AND configured a non-empty api_key. Without a key, the FAB does not
    render — we don't want to confuse visitors with a non-functional widget.

    `system_prompt` is exposed so the front-end PageAgent instance can
    forward it via `customSystemPrompt` — without it the safety rails
    appended in admin_setting_defaults never reach the LLM.
    """
    cfg = _resolve_config(db)
    return {
        "enabled": _is_fab_visible(cfg),
        "model": cfg["model"],
        "base_url": cfg["base_url"],
        "system_prompt": _get_or_default(db, "page_agent.system_prompt") or "",
    }
```

Keep the existing `router = APIRouter(...)` declaration. Append the new constant under the existing `MAX_PUBLIC_AGENT_BYTES`:

```python
# Mirror agent_router's guard-rails; deliberately slightly stricter since this
# endpoint is anonymous.
MAX_PUBLIC_AGENT_MESSAGES = 50
MAX_PUBLIC_AGENT_BYTES = 1 * 1024 * 1024  # 1 MB
MAX_PUBLIC_AGENT_LLM_BYTES = 2 * 1024 * 1024  # 2 MB (dom — tools schema makes bodies larger)
```

Replace the trailing `__all__ = ...` with new content. Insert the new endpoint AFTER `@router.post("/execute")` block:

```python
class AgentLLMRequest(BaseModel):
    url: str
    init: dict


def _is_same_origin_referer(referer: str | None, expected_host: str) -> bool:
    """Accept empty Referer (curl, native fetch); reject cross-origin Referer."""
    if not referer:
        return True
    try:
        from urllib.parse import urlparse
        return urlparse(referer).hostname == expected_host
    except ValueError:
        return False


@router.post("/llm")
@rate_limit(max_calls=5, window_seconds=60)
async def agent_llm(
    request: Request,
    body: AgentLLMRequest,
    db: Session = Depends(get_db),
):
    """Proxy a page-agent OpenAI /chat/completions call to the configured LLM.

    Schema for the body:
        {
          "url": "<absolute upstream URL — must match page_agent.base_url>",
          "init": {
            "method": "POST",
            "headers": { ... non-Authorization headers ... },
            "body": "<raw JSON or other string>"
          }
        }

    Security guards (see spec §数据流):
      409 not_enabled / no_api_key — driven by page_agent.* settings
      409 dom_requires_https_base_url — base_url must be https
      403 url_not_allowed             — URL strict match fails
      403 referer_not_allowed         — cross-origin Referer
      413 payload_too_large           — body init.body > 2 MB
      429 rate_limited                — 6th call within 60s
      502 upstream_llm_failed         — generic, no header / api_key leak
    """
    raw = await request.body()
    if len(raw) > MAX_PUBLIC_AGENT_LLM_BYTES:
        _send("payload_too_large", "请求体超过 2MB 限制", 413)

    # Load settings rows; consumer uses the shared helper to enforce gates.
    rows = {
        "page_agent.enabled":  _get_or_default(db, "page_agent.enabled") or "",
        "page_agent.api_key":  _get_setting(db, "page_agent.api_key") or "",
        "page_agent.base_url": _get_or_default(db, "page_agent.base_url") or "",
        "page_agent.model":    _get_or_default(db, "page_agent.model") or "",
    }
    try:
        cfg = _load_chat_config(rows, mode="dom")
    except PageAgentConfigError as e:
        _send(e.code, e.message, 409)

    if not _is_allowed_url(body.url, cfg.base_url):
        _send("url_not_allowed", "上游 URL 不在 base_url 白名单内", 403)

    base_host = urlparse(cfg.base_url).hostname or ""
    referer = request.headers.get("referer")
    if not _is_same_origin_referer(referer, base_host):
        _send("referer_not_allowed", "Referer 不匹配同源", 403)

    upstream_init = dict(body.init or {})
    upstream_init.setdefault("method", "POST")
    # Strip any Authorization the client tried to smuggle; we inject our own.
    headers = {k: v for k, v in (upstream_init.get("headers") or {}).items()
               if k.lower() != "authorization"}
    headers["Authorization"] = f"Bearer {cfg.api_key}"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            upstream_req = client.build_request(
                upstream_init["method"], body.url, headers=headers, content=upstream_init.get("body"),
            )
            resp = await client.send(upstream_req, stream=False)
            content = resp.content
            upstream_status = resp.status_code
            # Only forward content-type / content-length; drop hop-by-hop.
            response_headers = {
                k: v for k, v in resp.headers.items()
                if k.lower() not in {"connection", "keep-alive", "proxy-authenticate",
                                     "proxy-authorization", "te", "trailers",
                                     "transfer-encoding", "upgrade"}
            }
    except httpx.HTTPError as e:
        _log.warning("agent_llm upstream failed: %s", e, exc_info=True)
        _send("upstream_llm_failed", "上游 LLM 调用失败，请检查网络或稍后重试", 502)

    return Response(
        content=content,
        status_code=upstream_status,
        headers=response_headers,
        media_type=response_headers.get("content-type"),
    )
```

Add `from fastapi import Response` import and adjust imports as needed.

Update the bottom `__all__`:

```python
__all__ = [
    "router",
    "MAX_PUBLIC_AGENT_MESSAGES",
    "MAX_PUBLIC_AGENT_BYTES",
    "MAX_PUBLIC_AGENT_LLM_BYTES",
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_public_agent.py -v`
Expected: 6 PASSED (the new tests), existing tests still green.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add backend/app/routers/public_agent_router.py backend/tests/test_public_agent.py
git commit -m "feat(backend): /api/public/agent/llm OpenAI proxy — URL-strict + Referer + 5/min + key never leaks"
```

---

### Task 3: Thread `mode='dom'` through existing `/api/public/agent/execute`

**Files:**
- Modify: `backend/app/routers/public_agent_router.py:148-195` (`execute`)
- Modify: `backend/tests/test_public_agent.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_public_agent.py`:

```python
def test_execute_rejects_invalid_mode(client_factory):
    """mode must be 'chat' or 'dom' (Literal type); anything else → pydantic 422.

    Pydantic-driven 422 responses use the FastAPI default ``{"detail": [...]}``
    envelope (NOT the project's ``{error: {code, message}}`` envelope, which is
    only produced for explicit ``HTTPException`` raises). We only assert the
    status code so this test is robust against future envelope changes.
    """
    client = client_factory(api_key="sk-real")
    r = client.post(
        "/api/public/agent/execute",
        json={"mode": "hacker", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert r.status_code == 422


def test_execute_chat_mode_still_works(client_factory):
    """Backward-compat: default mode is 'chat', old request shape still works."""
    with patch(
        "app.routers.public_agent_router.chat_complete",
        new=AsyncMock(return_value="hello back"),
    ):
        client = client_factory(api_key="sk-real")
        r = client.post(
            "/api/public/agent/execute",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
    assert r.status_code == 200
    assert r.json() == {"content": "hello back"}


def test_execute_dom_mode_rejects_missing_tools(client_factory):
    """dom path through /execute must reject (use /llm instead).

    This hits our explicit HTTPException(422) → project envelope, so we can
    assert the semantic code:
    """
    client = client_factory(api_key="sk-real")
    r = client.post(
        "/api/public/agent/execute",
        json={
            "mode": "dom",
            "messages": [{"role": "user", "content": "click submit"}],
        },
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "tools_required_for_dom"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_public_agent.py::test_execute_rejects_invalid_mode tests/test_public_agent.py::test_execute_chat_mode_still_works tests/test_public_agent.py::test_execute_dom_mode_rejects_missing_tools -v`
Expected: 3 FAILED — `mode` field not accepted (validation error → 422 with code 'validation_error' is expected, but the **specific** `tools_required_for_dom` and `invalid_mode` are not implemented).

- [ ] **Step 3: Implement the mode-aware execute**

Replace `ExecuteRequest` and the existing `@router.post("/execute")` decorator/handler with the mode-aware version:

```python
class ExecuteRequest(BaseModel):
    mode: Literal["chat", "dom"] = "chat"
    messages: list[dict] = []

    @field_validator("messages")
    @classmethod
    def _cap_messages(cls, v: list[dict]) -> list[dict]:
        if len(v) > MAX_PUBLIC_AGENT_MESSAGES:
            raise ValueError(f"messages 长度超过最大限制 {MAX_PUBLIC_AGENT_MESSAGES}")
        return v


@router.post("/execute")
@rate_limit(max_calls=10, window_seconds=60)
async def execute_public_llm(
    request: Request,
    body: ExecuteRequest,
    db: Session = Depends(get_db),
):
    """Anonymous visitor triggers a chat turn (mode='chat' default).

    When mode='dom' the client SHOULD bypass this endpoint and call
    /api/public/agent/llm directly through the page-agent customFetch hook.
    Accepting mode='dom' here is only kept for compatibility — it must
    carry a non-empty tools array; otherwise 422.
    """
    raw = await request.body()
    if len(raw) > MAX_PUBLIC_AGENT_BYTES:
        _send("payload_too_large", "请求体超过 1MB 限制", 413)

    if body.mode == "dom":
        tools = []  # currently unused — dom path uses /llm directly
        # Defensive: refuse dom without tools schema even via this route.
        # Source of tools in the current routing is /llm, so any dom call here
        # is a malformed client; respond with a clear 422.
        raise HTTPException(
            status_code=422,
            detail={"code": "tools_required_for_dom", "message": "dom 模式必须通过 /api/public/agent/llm 调用并提供 tools schema"},
        )

    cfg = _resolve_config(db)
    if not cfg["enabled_toggle"]:
        _send("not_enabled", "page-agent 未启用", 409)
    if not cfg["api_key"]:
        _send("no_api_key", "未配置 page_agent.api_key", 409)

    system_prompt = _get_or_default(db, "page_agent.system_prompt")
    messages: list[dict] = list(body.messages)
    if system_prompt and not any(m.get("role") == "system" for m in messages):
        messages = [{"role": "system", "content": system_prompt}] + messages

    try:
        content = await chat_complete(
            base_url=str(cfg["base_url"]),
            api_key=cfg["api_key"],  # type: ignore[arg-type]
            model=str(cfg["model"]),
            messages=messages,
        )
    except LLMUnavailable as e:
        _log.warning("public page-agent LLM call failed: %s", e, exc_info=True)
        _send("upstream_llm_failed", "上游 LLM 调用失败，请检查网络或稍后重试", 502)

    return {"content": content}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_public_agent.py -v`
Expected: All tests pass — old chat-mode tests, the new mode tests, and the previous Task 2 llm tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add backend/app/routers/public_agent_router.py backend/tests/test_public_agent.py
git commit -m "feat(backend): mode='chat'|'dom' on /execute; dom rejected here (use /llm)"
```

---

### Task 4: Migrate connectivity probe out of `agent_router.py`

**Files:**
- Modify: `backend/app/routers/agent_router.py` (delete `/config`, `/execute`; keep `_TESTABLE_API_KEYS` shape)
- Modify: `backend/app/routers/settings_router.py` (add `/settings/{key}/test`)
- Modify: `backend/tests/test_agent_router_admin.py` (if present) OR `backend/tests/test_admin_settings.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_admin_settings.py` (adjust to match existing file conventions):

```python
def test_settings_test_endpoint_rejects_unknown_key(admin_client_factory):
    client = admin_client_factory()
    r = client.post("/api/admin/settings/foobar.api_key/test")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "bad_request"


def test_settings_test_endpoint_runs_for_page_agent(admin_client_factory):
    from unittest.mock import AsyncMock, patch
    with patch(
        "app.routers.settings_router.chat_complete",
        new=AsyncMock(return_value="pong"),
    ):
        client = admin_client_factory(api_key="sk-test")
        r = client.post("/api/admin/settings/page_agent.api_key/test")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_settings_test_endpoint_runs_for_article_typesetter(admin_client_factory):
    from unittest.mock import AsyncMock, patch
    with patch(
        "app.routers.settings_router.chat_complete",
        new=AsyncMock(return_value="pong"),
    ):
        client = admin_client_factory(api_key="sk-test", prefix="article_typesetter")
        r = client.post("/api/admin/settings/article_typesetter.api_key/test")
    assert r.status_code == 200
    assert r.json()["ok"] is True
```

(Add `admin_client_factory` if it does not exist — it mirrors `client_factory` in Task 2 but seeds values under both `article_typesetter` and `page_agent` prefixes.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_admin_settings.py -v -k test_settings_test_endpoint_rejects_unknown_key`
Expected: ImportError (the path `/api/admin/settings/page_agent.api_key/test` still resolves through `agent_router`, but the test imports `settings_router.chat_complete` which doesn't exist).

- [ ] **Step 3: Move the handler to settings_router.py**

Edit `backend/app/routers/agent_router.py` — delete:
- Imports of `chat_complete`, `LLMUnavailable`, `get_current_admin` (only keep what's still needed)
- `_TESTABLE_API_KEYS` constant
- `get_agent_config` function
- `ExecuteRequest` class
- `execute_llm` function
- `test_setting` function

The file becomes essentially empty. To keep `agent_router` re-export stable, leave a stub:

```python
"""Admin: page-agent admin-side chat proxy has been removed (2026-06-30).

The connectivity probe under /api/admin/settings/{key}/test moved to
``settings_router``. This module is kept as a re-export shim so that
``app.routers.__init__`` need not change.
"""
from __future__ import annotations

# Re-export the connectivity probe by re-mounting the settings_router under
# the same prefix as before, so any legacy client hitting /api/admin/agent/*
# via the moved path resolves through settings_router instead.
__all__: list[str] = []
```

But since `settings_router` has its own prefix `/api/admin/settings`, the existing URL `/api/admin/settings/{key}/test` is now served from `settings_router`. The frontend `api.admin.settings.test(key)` already targets that path — no migration needed at the URL level.

Edit `backend/app/routers/settings_router.py` — add at the bottom:

```python
# Migrated from agent_router.py on 2026-06-30. Page-agent admin-side chat
# endpoints were removed; this connectivity probe stays useful for both
# page_agent.api_key and article_typesetter.api_key.

import logging as _logging
_log = _logging.getLogger(__name__)

# API keys that have a connectivity probe. Add new entries here rather than
# branching the body so each new key reuses the same ping logic below.
_TESTABLE_API_KEYS: dict[str, tuple[str, str]] = {
    # setting key → (default_base_url, default_model)
    "page_agent.api_key": (
        "https://api.deepseek.com/v1",
        "deepseek-v4-flash",
    ),
    "article_typesetter.api_key": (
        "https://api.minimaxi.com/v1",
        "MiniMax-M3",
    ),
}


@router.post("/{key:path}/test")
async def test_setting(
    key: str,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Connectivity probe for an LLM-style api_key setting.

    Lives in settings_router because the URL /api/admin/settings/{key}/test
    has always been administered via the settings UI; the only reason it
    lived in agent_router was incidental (it was the only place with
    `_load_chat_config`-like helpers). Now those helpers live in
    admin_setting_defaults.py and llm_client.py which we already import.
    """
    if key not in _TESTABLE_API_KEYS:
        raise HTTPException(status_code=400, detail="该 key 暂不支持连通性测试")
    default_base_url, default_model = _TESTABLE_API_KEYS[key]
    prefix = key.split(".", 1)[0]  # "page_agent" or "article_typesetter"

    row = db.query(AdminSetting).filter_by(key=key).first()
    if not row:
        raise HTTPException(status_code=409, detail="未配置该 key")
    try:
        from ..services.crypto import decrypt_value
        api_key = decrypt_value(row.value_encrypted)
    except Exception:
        raise HTTPException(status_code=409, detail="该 key 解密失败")
    if not api_key:
        raise HTTPException(status_code=409, detail="未配置该 key")

    base_url = (_get_or_default(db, f"{prefix}.base_url")) or default_base_url
    model = (_get_or_default(db, f"{prefix}.model")) or default_model

    try:
        sample = await chat_complete(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": "ping"}],
        )
    except LLMUnavailable as e:
        _log.warning("%s connectivity test failed: %s", key, e, exc_info=True)
        raise HTTPException(status_code=502, detail="连通性测试失败，请检查网络或 API Key")
    return {"ok": True, "sample": sample[:200]}
```

Add these imports at the top of `settings_router.py`:

```python
from ..services.llm_client import chat_complete, LLMUnavailable
from ..services.admin_setting_defaults import default_for
```

Define a small `_get_or_default` helper inside `settings_router.py` (same shape as in `public_agent_router.py`):

```python
def _get_setting(db: Session, key: str) -> Optional[str]:
    row = db.query(AdminSetting).filter_by(key=key).first()
    if not row:
        return None
    try:
        from ..services.crypto import decrypt_value
        return decrypt_value(row.value_encrypted)
    except Exception:
        return None


def _get_or_default(db: Session, key: str) -> Optional[str]:
    val = _get_setting(db, key)
    if val is not None and val != "":
        return val
    d = default_for(key)
    if d is None or d == "":
        return None
    return d
```

(Place these just above the new `/settings/{key:path}/test` endpoint block.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_admin_settings.py -v`
Expected: All tests pass — old tests still green, new `test_settings_test_endpoint_*` cases pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add backend/app/routers/agent_router.py backend/app/routers/settings_router.py backend/tests/test_admin_settings.py
git commit -m "refactor(backend): move /api/admin/settings/{key}/test probe into settings_router; trim agent_router"
```

---

### Task 5: Append DOM-safety-rails to `DEFAULT_PAGE_AGENT_SYSTEM_PROMPT`

**Files:**
- Modify: `backend/app/services/admin_setting_defaults.py:55-74`
- Modify: `backend/tests/test_admin_settings_synthesis.py`

- [ ] **Step 1: Write the failing test**

Modify `backend/tests/test_admin_settings_synthesis.py` — change `test_page_agent_defaults_synthesis`:

```python
def test_page_agent_defaults_synthesis():
    """page_agent defaults synthesised from empty DB.

    Asserts:
      - default model/base_url/enabled
      - api_key is secret-only (no default_value exposed)
      - system_prompt includes new safety rails for DOM Agent
    """
    # ... existing assertions for model/base_url/enabled/api_key/masked
    # ... ADD the new assertions below:

    sys_prompt = default_for("page_agent.system_prompt")
    assert "data-ai-blocked" in sys_prompt
    assert "<form>" in sys_prompt or "form" in sys_prompt.lower()
    assert "DELETE" in sys_prompt or "POST" in sys_prompt
    assert "/admin" in sys_prompt
    assert "11 位" in sys_prompt or "手机号" in sys_prompt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_admin_settings_synthesis.py -v -k test_page_agent_defaults_synthesis`
Expected: 1 FAILED with `AssertionError` for at least one of the new safety-rail substrings.

- [ ] **Step 3: Append the safety-rail block**

Edit `backend/app/services/admin_setting_defaults.py` — replace `DEFAULT_PAGE_AGENT_SYSTEM_PROMPT` with:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_admin_settings_synthesis.py -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add backend/app/services/admin_setting_defaults.py backend/tests/test_admin_settings_synthesis.py
git commit -m "feat(backend): DOM 操作护栏 appended to default page_agent.system_prompt"
```

---

### Task 6: Make existing admin chat tests reference the new path (or delete)

**Files:**
- Possibly delete: `backend/tests/test_agent_router_admin.py` (if it exists and only covers the now-removed endpoints)

- [ ] **Step 1: Search for residual references**

Run: `cd backend && grep -rn "from app.routers.agent_router" .`
Expected: shows who still imports agent_router; usually only `main.py` and `routers/__init__.py`. After Task 4, `agent_router.py` is a thin shim, so these references still work.

Run: `cd backend && grep -rn "test_agent_router_admin" .`
Expected: lists existing test files. Determine which tests must move/delete.

- [ ] **Step 2: If a `test_agent_router_admin.py` exists AND only references `/api/admin/agent/config` or `/api/admin/agent/execute` (both removed)**

Delete the file:

```bash
cd /Users/jasonlee/hubei-shuchuang
git rm backend/tests/test_agent_router_admin.py
```

- [ ] **Step 3: Re-run the full backend test suite**

Run: `cd backend && python -m pytest -v`
Expected: All tests pass.

- [ ] **Step 4: Commit (if a delete occurred)**

```bash
cd /Users/jasonlee/hubei-shuchuang
git commit -m "test(backend): drop obsolete agent_router tests (chat endpoints removed)"
```

Otherwise skip this step — there's nothing to commit.

---

## Phase 2 — Frontend setup

### Task 7: Install `page-agent` npm package

**Files:**
- Modify: `frontend-vite/package.json`
- Create: `frontend-vite/node_modules/page-agent` (via npm)

- [ ] **Step 1: Confirm package availability**

Run: `cd frontend-vite && npm view page-agent version`
Expected: prints the latest published version (e.g. `1.10.0`).

- [ ] **Step 2: Install and capture exact version**

Run: `cd frontend-vite && npm install page-agent@^1.10`
Expected: `package.json` now contains `"page-agent": "^1.10.x"` in dependencies, and `node_modules/page-agent/` exists.

- [ ] **Step 3: Verify the public API imports cleanly**

Create a temp scratch file `frontend-vite/__verify.ts`:

```ts
import { PageAgent } from 'page-agent'
console.log('PageAgent keys:', Object.keys(PageAgent.prototype))
```

Run: `cd frontend-vite && npx tsc --noEmit __verify.ts --jsx react-jsx --esModuleInterop --moduleResolution bundler --target ES2022 --skipLibCheck`
Expected: TypeScript reports no error (no missing exports). If the import resolves, PageAgent is wired correctly.

- [ ] **Step 4: Clean up the scratch file**

```bash
cd /Users/jasonlee/hubei-shuchuang
rm frontend-vite/__verify.ts
git add frontend-vite/package.json frontend-vite/package-lock.json
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git commit -m "chore(frontend): add page-agent@^1.10 dependency"
```

---

### Task 8: Create `frontend-vite/src/lib/pageAgent.ts` helpers

**Files:**
- Create: `frontend-vite/src/lib/pageAgent.ts`

- [ ] **Step 1: Create the helpers file**

Write `frontend-vite/src/lib/pageAgent.ts`:

```ts
/**
 * Front-end helpers used by both the public page-agent mount and the dual-mode
 * panel. These are intentionally framework-agnostic (no React) so they're
 * easy to unit-test and reuse from both the FAB and the panel.
 */

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

/**
 * customFetch replacement for `LLMConfig.customFetch`. Forwards every
 * page-agent tool-calling call through our backend `POST /api/public/agent/llm`
 * so that:
 *  - the upstream URL never appears in the browser address bar
 *  - the api key never leaves the server (Fernet-decrypted server-side)
 *  - the server can enforce URL-prefix / Referer / payload / rate-limit guards
 */
export async function customFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const r = await fetch('/api/public/agent/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ url: String(input), init: init ?? {} }),
  })
  // The server returns the raw upstream OpenAI response (JSON). We use
  // the global Response so headers / status pass through verbatim.
  return new Response(await r.text(), {
    status: r.status,
    headers: r.headers,
  })
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b1[3-9]\d{9}\b/g, '***'],                                                         // CN phone
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***'],                          // email
  [/\b(sk-[A-Za-z0-9_\-]{16,}|ghp_[A-Za-z0-9]{16,}|sk-ant-[A-Za-z0-9_\-]{16,})\b/g, '***'],  // common api key prefixes
  [/\bBearer\s+[A-Za-z0-9._\-]{16,}\b/g, '***'],                                       // Authorization literal
  [/\b\d{16,19}\b/g, '***'],                                                            // 16-19 digits = card-shaped
]

/**
 * Redact anything that resembles a phone, email, api key, or auth token
 * before page-agent ships the DOM-text representation to the LLM.
 * Defensive (not exhaustive) — page-agent users retain their trust.
 */
export function maskSecrets(content: string): string {
  let out = content
  for (const [pattern, repl] of SECRET_PATTERNS) {
    out = out.replace(pattern, repl)
  }
  return out
}

/**
 * Per-URL hint injected by page-agent's `getPageInstructions(url)` before each
 * step. Strongly nudges the agent to call `done` early on admin pages and
 * reminds it that the site is published research, not a free-form app.
 */
export function getPageHint(url: string): string {
  const u = url.toLowerCase()
  if (u.includes('/admin') || u.includes('/login') || u.includes('/account')) {
    return '【getPageInstructions】当前 URL 在 admin/login/account 路由——立即调用 done 工具并告诉用户"此页面不在我可操作范围"，不要点击任何元素。'
  }
  const PUBLIC_PREFIXES = ['/', '/articles', '/issues', '/about', '/search', '/domains', '/insights', '/cases']
  if (!PUBLIC_PREFIXES.some((p) => u === p || u.startsWith(p + '/') || u.startsWith(p + '?'))) {
    return '【getPageInstructions】未知页面，请勿执行任何写入性操作（仅允许点击导航链接读取）。'
  }
  return '【getPageInstructions】你正在公开页面。可在导航栏链接、搜索表单、文章阅读视图之间操作。注意：1) 不要触碰任何 data-ai-blocked 元素；2) 不要 submit <form>，但可以填字段；3) 不要 DELETE/PUT/POST（仅允许 GET 跳转）；4) 输入敏感词后立即停止并提示。'
}
```

- [ ] **Step 2: Type-check the file**

Run: `cd frontend-vite && npx tsc --noEmit src/lib/pageAgent.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/lib/pageAgent.ts
git commit -m "feat(frontend): pageAgent helpers — customFetch, maskSecrets, getPageHint"
```

---

### Task 9: Create `PageAgentFab` component + module CSS

**Files:**
- Create: `frontend-vite/src/components/ai/PageAgentFab.tsx`
- Create: `frontend-vite/src/components/ai/PageAgentFab.module.css`

- [ ] **Step 1: Create the CSS module**

Write `frontend-vite/src/components/ai/PageAgentFab.module.css`:

```css
.fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(135deg, #1A1A2E 0%, #16213E 100%);
  color: #C9A84C;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 9000;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 8px 24px rgba(26, 26, 46, 0.28);
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
  animation: fab-float 4s ease-in-out infinite, fab-enter 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.8s backwards;
}

.fab:hover {
  transform: scale(1.04);
  border-color: #C9A84C;
  box-shadow: 0 12px 30px rgba(201, 168, 76, 0.30), 0 6px 16px rgba(26, 26, 46, 0.28);
}

.fab:focus-visible {
  outline: none;
  border-color: #C9A84C;
  box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.4);
}

.label {
  display: none;
}

.tooltip {
  position: absolute;
  right: calc(100% + 12px);
  top: 50%;
  transform: translateY(-50%);
  background: #1A1A2E;
  color: #FAFAF7;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  border: 1px solid #C9A84C;
}

.fab:hover .tooltip {
  opacity: 1;
}

@keyframes fab-float {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-4px) scale(1); }
}

@keyframes fab-enter {
  from { transform: scale(0.6); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.fab:hover {
  animation: none;          /* override float so hover scale wins */
  transform: scale(1.04);
}

@media (max-width: 480px) {
  .fab {
    width: 48px;
    height: 48px;
    bottom: 16px;
    right: 16px;
  }
  .tooltip { display: none; }
}
```

- [ ] **Step 2: Create the component**

Write `frontend-vite/src/components/ai/PageAgentFab.tsx`:

```tsx
import { Sparkles } from 'lucide-react'
import styles from './PageAgentFab.module.css'

export function PageAgentFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.fab}
      onClick={onClick}
      aria-label="打开 page-agent AI 助手"
      data-testid="page-agent-fab"
    >
      <Sparkles size={22} aria-hidden="true" />
      <span className={styles.tooltip} role="tooltip">AI 助手 · 湖北数创</span>
      <span className={styles.label}>打开 AI 助手</span>
    </button>
  )
}
```

Note: keep the `fab:hover { animation: none; }` carefully — re-check visually. (The float animation creates a `transform`; we null it on hover so the scale wins. See CSS.)

- [ ] **Step 3: Type-check**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/ai/PageAgentFab.tsx frontend-vite/src/components/ai/PageAgentFab.module.css
git commit -m "feat(frontend): Sparkles FAB + float animation (gold-on-ink, AI-friendly)"
```

---

### Task 10: Create `PageAgentPanel` dual-mode wrapper

**Files:**
- Create: `frontend-vite/src/components/ai/PageAgentPanel.tsx`
- Create: `frontend-vite/src/components/ai/PageAgentPanel.module.css`

- [ ] **Step 1: Create the panel CSS module**

Write `frontend-vite/src/components/ai/PageAgentPanel.module.css`:

```css
.root {
  position: fixed;
  bottom: 96px;
  right: 24px;
  width: 380px;
  height: 540px;
  background: #FFFFFF;
  color: #1A1A2E;
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(26, 26, 46, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 9001;
  font-size: 14px;
  line-height: 1.55;
  border: 1px solid #E8E5DC;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: linear-gradient(135deg, #1A1A2E 0%, #16213E 100%);
  color: #FAFAF7;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.brandDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #C9A84C;
  box-shadow: 0 0 8px #C9A84C;
}

.close {
  background: none;
  border: 0;
  color: #FAFAF7;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}

.close:hover { background: rgba(255, 255, 255, 0.08); }

.body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  background: #FAFAF7;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bubble {
  padding: 10px 12px;
  border-radius: 12px;
  max-width: 80%;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.bubbleUser {
  align-self: flex-end;
  background: #C9A84C;
  color: #1A1A2E;
  border-bottom-right-radius: 4px;
}

.bubbleAssistant {
  align-self: flex-start;
  background: #FFFFFF;
  color: #1A1A2E;
  border: 1px solid #E8E5DC;
  border-bottom-left-radius: 4px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #6b6b6b;
  text-align: center;
  padding: 32px 20px;
}

.emptyPrompts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  justify-content: center;
}

.emptyPrompt {
  background: #FFFFFF;
  color: #1A1A2E;
  border: 1px solid #E8E5DC;
  border-radius: 18px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.emptyPrompt:hover {
  border-color: #C9A84C;
  color: #C9A84C;
}

.footer {
  border-top: 1px solid #E8E5DC;
  background: #FFFFFF;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.textarea {
  width: 100%;
  border: 1px solid #E8E5DC;
  border-radius: 8px;
  resize: none;
  padding: 8px 10px;
  font: inherit;
  min-height: 56px;
  color: #1A1A2E;
  background: #FAFAF7;
  outline: none;
}

.textarea:focus {
  border-color: #C9A84C;
  box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.18);
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 12px;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btnPrimary {
  background: #C9A84C;
  color: #1A1A2E;
  border-color: #C9A84C;
}
.btnPrimary:hover:not(:disabled) {
  background: #b89843;
  border-color: #b89843;
}

.btnSecondary {
  background: #FFFFFF;
  color: #1A1A2E;
  border-color: #E8E5DC;
}
.btnSecondary:hover:not(:disabled) {
  border-color: #C9A84C;
  color: #1A1A2E;
}

.error {
  background: #fdecec;
  color: #B04040;
  border: 1px solid #f4c8c8;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
}

@media (max-width: 480px) {
  .root {
    bottom: 76px;
    right: 12px;
    left: 12px;
    width: auto;
    height: 70vh;
  }
}
```

- [ ] **Step 2: Create the panel TSX**

Write `frontend-vite/src/components/ai/PageAgentPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquare, Sparkles, X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../../services/api'
import { PageAgent } from 'page-agent'
import styles from './PageAgentPanel.module.css'

type UiMessage = { id: number; role: 'user' | 'assistant'; content: string }

const STORAGE_KEY = 'hbsc.page-agent.chat.history'

const EMPTY_PROMPTS: string[] = [
  '介绍一下湖北数创期刊',
  '帮我跳到最新一期的文章列表',
  '搜索关键词 "复杂系统"',
]

export function PageAgentPanel({
  agent,
  onClose,
}: {
  agent: PageAgent
  onClose: () => void
}) {
  const [history, setHistory] = useState<UiMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw) as UiMessage[]
    } catch {
      /* fall through */
    }
    return []
  })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [operating, setOperating] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const nextIdRef = useRef(1)

  // Persist chat history.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history))
    } catch {
      /* quota / disabled */
    }
  }, [history])

  // Auto-scroll on new message.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [history, operating])

  // Chat-mode mutation: hits /api/public/agent/execute.
  const chatMut = useMutation({
    mutationFn: async (userText: string): Promise<string> => {
      const priorMessages = history
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }))
      const r = await api.public.agent.execute([
        ...priorMessages,
        { role: 'user', content: userText },
      ])
      return r.content
    },
  })

  async function sendAsk() {
    const userText = text.trim()
    if (!userText || chatMut.isPending || operating) return
    setError(null)
    setText('')
    const userId = nextIdRef.current++
    setHistory((h) => [...h, { id: userId, role: 'user', content: userText }])
    try {
      const reply = await chatMut.mutateAsync(userText)
      setHistory((h) => [...h, { id: nextIdRef.current++, role: 'assistant', content: reply }])
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '调用失败，请稍后重试'
      setError(msg)
      setHistory((h) => [
        ...h,
        { id: nextIdRef.current++, role: 'assistant', content: '⚠️ ' + msg },
      ])
    }
  }

  async function sendOperate() {
    const userText = text.trim()
    if (!userText || chatMut.isPending || operating) return
    setError(null)
    setText('')
    setOperating(true)
    const userId = nextIdRef.current++
    setHistory((h) => [...h, { id: userId, role: 'user', content: userText }])
    try {
      const result = await agent.execute(userText)
      const reply = result.success
        ? `✅ 已完成：${result.data || '(无详细描述)'}`
        : `⚠️ 未能完成：${result.data || '任务中断'}`
      setHistory((h) => [...h, { id: nextIdRef.current++, role: 'assistant', content: reply }])
    } catch (e) {
      const msg = e instanceof Error ? e.message : '调用失败'
      setError(msg)
      setHistory((h) => [
        ...h,
        { id: nextIdRef.current++, role: 'assistant', content: '⚠️ ' + msg },
      ])
    } finally {
      setOperating(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendAsk()
    }
  }

  return (
    <div className={styles.root} role="dialog" aria-label="AI 助手" data-testid="page-agent-panel">
      <div className={styles.header}>
        <div className={styles.brand}>
          <Sparkles size={16} color="#C9A84C" aria-hidden="true" />
          <span className={styles.brandDot} aria-hidden="true" />
          AI 助手 · 湖北数创
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="关闭 AI 助手面板"
        >
          <X size={16} />
        </button>
      </div>

      <div className={styles.body} ref={bodyRef} data-testid="page-agent-body">
        {history.length === 0 && !operating && (
          <div className={styles.empty}>
            <Sparkles size={28} color="#C9A84C" aria-hidden="true" />
            <div>你好，我是 Hubei Guide。可以直接问我问题，或让我帮你操作页面。</div>
            <div className={styles.emptyPrompts}>
              {EMPTY_PROMPTS.map((p) => (
                <button
                  type="button"
                  key={p}
                  className={styles.emptyPrompt}
                  onClick={() => setText(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((m) => (
          <div
            key={m.id}
            className={`${styles.bubble} ${m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}
          >
            {m.content}
          </div>
        ))}

        {(chatMut.isPending || operating) && (
          <div
            className={`${styles.bubble} ${styles.bubbleAssistant}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Loader2 size={14} className="page-agent-spin" aria-hidden="true" />
            思考中…
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}
      </div>

      <div className={styles.footer}>
        <textarea
          className={styles.textarea}
          placeholder="问我一个问题，或描述你想在页面上做的事……"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          aria-label="提问输入框"
          data-testid="page-agent-input"
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={() => void sendAsk()}
            disabled={!text.trim() || chatMut.isPending || operating}
            data-testid="page-agent-ask-btn"
          >
            <MessageSquare size={14} />
            问他
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void sendOperate()}
            disabled={!text.trim() || chatMut.isPending || operating}
            data-testid="page-agent-operate-btn"
          >
            <Sparkles size={14} />
            让他操作
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add the page-agent spin keyframe to `global.css`**

Append to `frontend-vite/src/styles/global.css` (at the bottom):

```css
@keyframes page-agent-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.page-agent-spin {
  animation: page-agent-spin 1s linear infinite;
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/ai/PageAgentPanel.tsx frontend-vite/src/components/ai/PageAgentPanel.module.css frontend-vite/src/styles/global.css
git commit -m "feat(frontend): PageAgentPanel — dual-mode (ask | operate) + Chinese UX"
```

---

### Task 11: Rewrite `PublicPageAgentMount.tsx` to instantiate the new agent

**Files:**
- Create: `frontend-vite/src/components/PublicPageAgentMount.tsx`
- Modify: `frontend-vite/src/App.tsx:14,63`

- [ ] **Step 1: Verify Task 2 added `system_prompt` to `/api/public/agent/config` response**

The `PageAgent` instance MUST receive the configured `system_prompt` from backend, otherwise the safety rails appended in Task 5 (data-ai-blocked, no-form-submit, etc.) won't reach the LLM. Task 2's implementation already returns:

```json
{ "enabled": true, "model": "...", "base_url": "...", "system_prompt": "..." }
```

Confirm by reading `backend/app/routers/public_agent_router.py` line 116-129 (the `get_public_agent_config` handler) — it must include a `system_prompt` field reading from `_get_or_default(db, "page_agent.system_prompt")`. If absent, patch the handler in Task 2's commit before proceeding.

- [ ] **Step 2: Create the new mount component**

Write `frontend-vite/src/components/PublicPageAgentMount.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageAgent } from 'page-agent'

import { api } from '../services/api'
import { customFetch, maskSecrets, getPageHint } from '../lib/pageAgent'
import { PageAgentFab } from './ai/PageAgentFab'
import { PageAgentPanel } from './ai/PageAgentPanel'

export function PublicPageAgentMount() {
  const configQ = useQuery({
    queryKey: ['public', 'agent', 'config'],
    queryFn: () => api.public.agent.config(),
    staleTime: 60_000,
  })

  const [agent, setAgent] = useState<PageAgent | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => {
    const cfg = configQ.data
    if (!cfg?.enabled) return
    const a = new PageAgent({
      baseURL: 'http://placeholder.invalid/v1',
      apiKey: 'placeholder',
      model: cfg.model,
      language: 'zh-CN',
      // Backend-supplied safety rails live here. If admin has not customized
      // the prompt, this falls back to DEFAULT_PAGE_AGENT_SYSTEM_PROMPT which
      // already includes all 10 protections appended in admin_setting_defaults.
      customSystemPrompt: cfg.system_prompt,
      getPageInstructions: getPageHint,
      transformPageContent: maskSecrets,
      maxSteps: 20,
      stepDelay: 0.4,
      experimentalScriptExecutionTool: false,
      customFetch,
    })
    setAgent(a)
    return () => {
      a.dispose?.()
    }
  }, [configQ.data])

  if (!configQ.data?.enabled || !agent) return null

  return (
    <>
      {!panelOpen && <PageAgentFab onClick={() => setPanelOpen(true)} />}
      {panelOpen && (
        <PageAgentPanel
          agent={agent}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 3: Update the App.tsx import path and JSX usage**

Edit `frontend-vite/src/App.tsx`:

Replace `import { PublicPageAgentMount } from './components/admin/PublicPageAgentMount'` (line 14) with:

```ts
import { PublicPageAgentMount } from './components/PublicPageAgentMount'
```

Confirm the JSX usage (`<PublicPageAgentMount />` line 63) stays unchanged.

- [ ] **Step 4: Type-check**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/PublicPageAgentMount.tsx frontend-vite/src/App.tsx
git commit -m "feat(frontend): PublicPageAgentMount — instantiate page-agent with customFetch proxy"
```

- [ ] **Step 2: Update the App.tsx import path and JSX usage**

Edit `frontend-vite/src/App.tsx`:

Replace `import { PublicPageAgentMount } from './components/admin/PublicPageAgentMount'` (line 14) with:

```ts
import { PublicPageAgentMount } from './components/PublicPageAgentMount'
```

Confirm the JSX usage (`<PublicPageAgentMount />` line 63) stays unchanged.

- [ ] **Step 3: Type-check**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/PublicPageAgentMount.tsx frontend-vite/src/App.tsx
git commit -m "feat(frontend): PublicPageAgentMount — instantiate page-agent with customFetch proxy"
```

---

## Phase 3 — Cleanup

### Task 12: Delete obsolete admin/public PageAgent components

**Files:**
- Delete: `frontend-vite/src/components/admin/PageAgentPanel.tsx`
- Delete: `frontend-vite/src/components/admin/PageAgentMount.tsx`
- Delete: `frontend-vite/src/components/admin/PublicPageAgentMount.tsx`
- Delete: `frontend-vite/src/components/admin/PageAgentPanel.css`
- Modify: `frontend-vite/src/components/admin/AdminLayout.tsx:8,85`

- [ ] **Step 1: Remove the obsolete files**

```bash
cd /Users/jasonlee/hubei-shuchuang
git rm frontend-vite/src/components/admin/PageAgentPanel.tsx \
        frontend-vite/src/components/admin/PageAgentMount.tsx \
        frontend-vite/src/components/admin/PublicPageAgentMount.tsx \
        frontend-vite/src/components/admin/PageAgentPanel.css
```

- [ ] **Step 2: Update AdminLayout.tsx**

Remove `import { PageAgentMount } from './PageAgentMount'` (line 8 of AdminLayout.tsx) and `<PageAgentMount />` (line 85). The `Login` and `admin` UI portions remain unchanged.

- [ ] **Step 3: Type-check & lint**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: no errors (all imports resolve).

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/admin/AdminLayout.tsx
git commit -m "refactor(frontend): drop admin page-agent components (admin no longer uses page-agent)"
```

---

### Task 13: Update `api.ts` — remove admin agent, add public.agent.llm

**Files:**
- Modify: `frontend-vite/src/services/api.ts:228-236, 355-363`

- [ ] **Step 1: Add `api.public.agent.llm` and extend `config` return type**

In `api.public.agent` block (line 228-236):

```ts
public: {
  agent: {
    config: (): Promise<{
      enabled: boolean
      model: string
      base_url: string
      system_prompt: string    // surfaced by /api/public/agent/config
                                // since Task 2 so the front-end can pass
                                // it to PageAgent.customSystemPrompt
    }> =>
      request('/api/public/agent/config'),
    execute: (messages: Array<{ role: string; content: string }>) =>
      request('/api/public/agent/execute', {
        method: 'POST',
        body: JSON.stringify({ messages }),
      }),
    llm: ({ url, init }: { url: string; init: RequestInit }) =>
      request<unknown>('/api/public/agent/llm', {
        method: 'POST',
        body: JSON.stringify({ url, init }),
        // critical: we want the raw Response, but api.ts strips headers and
        // re-parses JSON. For the page-agent customFetch path we don't go
        // through api.ts — instead lib/pageAgent.ts customFetch calls
        // fetch() directly. So this wrapper stays unused for now.
      }),
  },
},
```

> The `api.public.agent.llm` wrapper is kept for symmetry / future programmatic use. The hot path is `lib/pageAgent.ts`'s `customFetch` which uses `fetch()` directly to preserve the upstream response headers verbatim.

- [ ] **Step 2: Delete `api.admin.agent`**

Delete the `admin.agent` block (lines 355-363 in api.ts).

- [ ] **Step 3: Type-check**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/services/api.ts
git commit -m "refactor(frontend): drop api.admin.agent; add api.public.agent.llm (proxy helper)"
```

---

### Task 14: Rephrase AdminSettings PAGE_AGENT_SECTION blurb

**Files:**
- Modify: `frontend-vite/src/pages/admin/AdminSettings.tsx` (PAGE_AGENT_SECTION block)

- [ ] **Step 1: Update the section blurb and title**

Replace the existing `PAGE_AGENT_SECTION` definition:

```ts
const PAGE_AGENT_SECTION: SettingSection = {
  title: 'page-agent — 公开页面 AI 助手',
  icon: <Zap size={16} />,
  blurb:
    '用于配置首页右下角 AI 助手 FAB。支持聊天（问他）与页面操作（让他操作）两种模式。',
  defaults: { model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1' },
  rows: [
    { key: 'page_agent.enabled',       label: '启用',                   kind: 'bool' },
    { key: 'page_agent.model',         label: '模型',                   kind: 'string' },
    { key: 'page_agent.base_url',      label: 'API Base URL',           kind: 'string', hint: '聊天 / 页面操作共用。DOM 模式仅允许 https。' },
    { key: 'page_agent.api_key',       label: 'API Key',                kind: 'secret' },
    { key: 'page_agent.system_prompt', label: '系统 Prompt（可覆盖）',   kind: 'textarea' },
  ],
}
```

- [ ] **Step 2: Confirm the build still passes**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/pages/admin/AdminSettings.tsx
git commit -m "docs(frontend): rephrase PAGE_AGENT_SECTION — reflect dual-mode + public-only"
```

---

## Phase 4 — data-ai-blocked audit

### Task 15: Add `data-ai-blocked` to admin destructive controls

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`
- Modify: `frontend-vite/src/pages/admin/AdminLogin.tsx`
- Modify: `frontend-vite/src/pages/admin/Dashboard.tsx`
- Modify: `frontend-vite/src/pages/admin/ArticleList.tsx`
- Modify: `frontend-vite/src/pages/admin/MediaLibrary.tsx`
- Modify: `frontend-vite/src/pages/admin/JournalEditor.tsx`
- Modify: `frontend-vite/src/pages/admin/JournalList.tsx`

- [ ] **Step 1: ArticleEditor.tsx — block save/publish/archive/delete buttons**

Run: `cd frontend-vite && grep -n "保存草稿\|发布\|下线\|删除" src/pages/admin/ArticleEditor.tsx`
Expected: a small set of button labels. Open the file and add `data-ai-blocked="delete"` (or any string) to each:

```tsx
<button data-ai-blocked="save"   onClick={...}>保存草稿</button>
<button data-ai-blocked="publish" onClick={...}>发布</button>
<button data-ai-blocked="archive" onClick={...}>下线</button>
<button data-ai-blocked="delete"  onClick={...}>删除</button>
```

If a row uses `<Button variant="danger" ...>`, pass `data-ai-blocked` via props onto the underlying `<button>`.

- [ ] **Step 2: AdminLogin.tsx — block login submit**

```tsx
<button data-ai-blocked="login" type="submit">登 录</button>
```

- [ ] **Step 3: Dashboard.tsx — block any delete buttons (often sidebar nav only)**

Run: `cd frontend-vite && grep -rn "删除\|删除草稿" src/pages/admin/Dashboard.tsx`
For each button found, add `data-ai-blocked="delete"`.

- [ ] **Step 4: ArticleList.tsx — block delete + bulk ops**

Run: `cd frontend-vite && grep -n "删除\|批量" src/pages/admin/ArticleList.tsx`
Add `data-ai-blocked` to each.

- [ ] **Step 5: MediaLibrary.tsx — block delete + bulk delete**

```bash
cd frontend-vite && grep -n "删除\|批量" src/pages/admin/MediaLibrary.tsx
```

Add `data-ai-blocked="delete"` to every delete button.

- [ ] **Step 6: JournalEditor.tsx — block publish/unpublish/delete**

Same pattern.

- [ ] **Step 7: JournalList.tsx — block row-level publish/delete**

Same pattern.

- [ ] **Step 8: Type-check**

Run: `cd frontend-vite && npx tsc --noEmit`
Expected: no errors (data attributes are string-pass-through on `<button>` in React 19's HTML types).

- [ ] **Step 9: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/pages/admin/
git commit -m "feat(frontend): data-ai-blocked on admin destructive controls (save/publish/delete/archive)"
```

---

### Task 16: Add `data-ai-blocked` to public-sensitive controls

**Files:**
- Modify: `frontend-vite/src/components/NewsletterForm.tsx`

- [ ] **Step 1: Block newsletter subscribe submit**

```tsx
<button data-ai-blocked="newsletter" type="submit">订阅</button>
```

- [ ] **Step 2: Confirm no other public form-submit should be blocked**

Run: `cd frontend-vite && grep -rn "type=\"submit\"\|type='submit'" src/components src/pages | grep -v test | grep -v admin`
Expected: only the newsletter. (If you find a share/save button that's intentional, leave it.)

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/NewsletterForm.tsx
git commit -m "feat(frontend): data-ai-blocked on NewsletterForm subscribe submit"
```

---

## Phase 5 — Tests + integration

### Task 17: Add Playwright spec for public page-agent

**Files:**
- Create: `frontend-vite/tests/public-page-agent.spec.ts`

- [ ] **Step 1: Write the spec**

Write `frontend-vite/tests/public-page-agent.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.describe('public page-agent FAB', () => {
  test('FAB appears on homepage after admin enables + key is set', async ({ page }) => {
    // Intercept /api/public/agent/config to simulate enabled=true.
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    await page.goto('/')
    const fab = page.getByTestId('page-agent-fab')
    await expect(fab).toBeVisible({ timeout: 5_000 })
  })

  test('clicking FAB shows dual-mode panel with two buttons', async ({ page }) => {
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    await page.goto('/')
    await page.getByTestId('page-agent-fab').click()
    await expect(page.getByTestId('page-agent-panel')).toBeVisible()
    await expect(page.getByTestId('page-agent-ask-btn')).toBeVisible()
    await expect(page.getByTestId('page-agent-operate-btn')).toBeVisible()
  })

  test('chat-mode submit posts to /api/public/agent/execute', async ({ page }) => {
    let executeCalled = 0
    let llmCalled = 0

    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    await page.route('**/api/public/agent/execute', (route) => {
      executeCalled++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: '你好，这里是湖北数创期刊。' }),
      })
    })
    await page.route('**/api/public/agent/llm', (route) => {
      llmCalled++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [
            { message: { tool_calls: [{ function: { name: 'done', arguments: '{}' } } }, finish_reason: 'tool_calls' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      })
    })

    await page.goto('/')
    await page.getByTestId('page-agent-fab').click()
    await page.getByTestId('page-agent-input').fill('期刊是关于什么的')
    await page.getByTestId('page-agent-ask-btn').click()

    await expect(page.getByText('你好，这里是湖北数创期刊。')).toBeVisible({ timeout: 5_000 })
    expect(executeCalled).toBe(1)
    expect(llmCalled).toBe(0)   // chat path must NOT call /agent/llm
  })

  test('chat-mode failure surfaces inline error toast', async ({ page }) => {
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    await page.route('**/api/public/agent/execute', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'rate_limited', message: '请求过于频繁，请稍后重试' },
        }),
      }),
    )
    await page.goto('/')
    await page.getByTestId('page-agent-fab').click()
    await page.getByTestId('page-agent-input').fill('hi')
    await page.getByTestId('page-agent-ask-btn').click()
    await expect(page.getByText(/请求过于频繁/)).toBeVisible({ timeout: 5_000 })
  })

  test('FAB does NOT contain Authorization header in any network call', async ({ page }) => {
    let foundKeyLeak = false
    await page.route('**/api/public/agent/config', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          model: 'deepseek-v4-flash',
          base_url: 'https://api.deepseek.com/v1',
        }),
      }),
    )
    page.on('request', (req) => {
      const auth = req.headers()['authorization'] || ''
      if (auth && auth.startsWith('Bearer sk-')) foundKeyLeak = true
    })
    await page.goto('/')
    await page.getByTestId('page-agent-fab').click()
    await page.getByTestId('page-agent-input').fill('hi')
    await page.getByTestId('page-agent-ask-btn').click()
    await page.waitForTimeout(2_000)
    expect(foundKeyLeak).toBe(false)
  })

  test('Admin dashboard does NOT render page-agent FAB', async ({ page }) => {
    // (Admin no longer mounts page-agent — verify by absence of the testid.)
    // Use a separate admin login is out of scope; assert the homepage absence
    // mirrors the /admin path under ProtectedRoute:
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('page-agent-fab')).toHaveCount(0)
  })
})
```

- [ ] **Step 2: Run the spec**

Run: `cd frontend-vite && npx playwright test tests/public-page-agent.spec.ts`
Expected: 6 PASSED. If any fails, fix the component / spec mismatches.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/tests/public-page-agent.spec.ts
git commit -m "test(frontend): public-page-agent.spec — FAB + dual-mode + key-not-leak + admin-absent"
```

---

### Task 18: Full integration verification + manual smoke checklist

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Backend full test suite green**

Run: `cd backend && python -m pytest -v`
Expected: every test passes, including the new dom-mode tests from Tasks 2-5.

- [ ] **Step 2: Frontend full Playwright suite green**

Run: `cd frontend-vite && npx playwright test`
Expected: all specs (existing `ai-typesetter-dialog.spec.ts` and `admin-snapshots.spec.ts`, plus the new `public-page-agent.spec.ts`) pass.

- [ ] **Step 3: Manual smoke test (record results in commit)**

Open the dev server and exercise:

1. Visit `/` → FAB appears with Sparkles icon, floats gently.
2. Click FAB → panel opens; input box + ✿ 问他 / ✿ 让他操作 buttons.
3. Type "你好" → click ✿ 问他 → DeepSeek should respond in ~2-5 sec.
4. Type "帮我打开导航栏的文章列表" → click ✿ 让他操作 → page navigates to `/articles` after a few thinking steps.
5. While the agent is operating, open DevTools → Network → confirm **no** request carries an `Authorization: Bearer sk-*` header.
6. Try asking the agent to "go to /admin and click delete on the first article" → the panel should stop with a friendly refusal within 1-3 steps.

- [ ] **Step 4: Commit (no code changes; verification log only)**

If everything passes, write a short note in `docs/superpowers/release-notes/2026-06-30-page-agent-dom.md` and commit:

```bash
cd /Users/jasonlee/hubei-shuchuang
mkdir -p docs/superpowers/release-notes
cat > docs/superpowers/release-notes/2026-06-30-page-agent-dom.md <<'EOF'
# page-agent DOM Mode — Release Notes (2026-06-30)

## What ships

- Public homepage `page-agent` FAB now supports dual modes:
  - ✿ 问他 — text-only chat via existing `/api/public/agent/execute` (no DOM loop).
  - ✿ 让他操作 — DOM multi-step agent via new `/api/public/agent/llm` (customFetch).
- All OpenAI tool-calling requests are proxied; api_key never leaves the server.
- 10-layer safety: data-ai-blocked audit, prompt safety rails, URL-strict match,
  Referer same-origin, dom 5/min IP rate-limit, 2MB payload cap, secret masking,
  JS injection disabled, maxSteps=20, single-step 30s timeout.
- Admin-side chat endpoints removed; connectivity probe now under settings_router.

## Operator notes

- Existing `page_agent.api_key` continues to drive both modes — no new key required.
- Admin → Settings → page-agent row: new blurb hints at the dual-mode + public-only use.
- If you want to disable DOM mode for a window, temporarily point
  `page_agent.base_url` to `http://...` (anything non-https): the dom endpoint
  rejects with 409 `dom_requires_https_base_url`, so the panel's
  ✿ 让他操作 button will surface that error.
EOF

git add docs/superpowers/release-notes/2026-06-30-page-agent-dom.md
git commit -m "docs(release): 2026-06-30 — page-agent DOM mode release notes"
```

---

## Acceptance Criteria (cross-check)

After all tasks complete, this checklist (from the spec §验收标准) must all be true:

- [ ] **AC1** Home `/` shows Sparkles FAB (4-second float).
- [ ] **AC2** Click FAB → page-agent panel opens with the two buttons.
- [ ] **AC3** ✿ 问他 + "你好" → answer bubble from DeepSeek in 1-5s.
- [ ] **AC4** ✿ 让他操作 + "帮我打开导航栏的文章列表" → navigates to `/articles`.
- [ ] **AC5** ✿ 让他操作 + "帮我搜索 react" → multi-step search workflow in panel.
- [ ] **AC6** `/admin/dashboard` does NOT show the FAB.
- [ ] **AC7** DevTools Network panel: zero `Authorization: Bearer sk-*` headers in browser-originated requests.
- [ ] **AC8** Asking agent to "delete draft" or "publish article" → refused with friendly message.
- [ ] **AC9** 6 consecutive DOM-mode calls → 6th returns 429 (toast: 频率过高).
- [ ] **AC10** `cd backend && pytest -v` all green.
- [ ] **AC11** `cd frontend-vite && npx playwright test` all green.
- [ ] **AC12** AdminSettings → page_agent.api_key → "测试连通" still works after migration.
