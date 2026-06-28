# HBSC Admin Phase 4 — page-agent Integration & AdminSettings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/admin/settings` page for configuring page-agent (toggle + API key + model + base URL + system prompt). Add `PageAgentMount.tsx` that injects the page-agent widget into all `/admin/*` pages when enabled. Provide a server-side `POST /api/admin/agent/execute` proxy so the API Key never leaves the backend.

**Architecture:** Settings (already stored encrypted via `AdminSetting` from M1) are read via `GET /api/admin/settings` for the UI; PUT for updates. A new `agent_router` exposes `GET /api/admin/agent/config` (returns only public-safe fields: enabled, model, base URL) and `POST /api/admin/agent/execute` which decrypts the API key on demand, calls the upstream LLM, and returns the response. The `PageAgentMount` component reads the public config and lazy-loads `page-agent` (UMD) only when enabled.

**Tech Stack:** FastAPI, `httpx` (already in requirements), `cryptography` Fernet, React 19, the page-agent IIFE bundle from jsDelivr (`https://cdn.jsdelivr.net/npm/page-agent@1.10.0/dist/iife/page-agent.demo.js` — but we will set `?autoInit=false` and instantiate manually with the proxied execute endpoint).

**Spec:** `docs/superpowers/specs/2026-06-28-hbsc-admin-completeness-design.md` §3.1, §4.1 (agent endpoints), §5.2 (PageAgentMount), §6.3 (API key never leaves backend).

**Prereq:** Phase 1 (`AdminSetting` + crypto) shipped.

---

## File Structure

### New files
- `backend/app/services/llm_client.py` — minimal OpenAI-compatible chat client
- `backend/app/routers/agent_router.py` — `GET /api/admin/agent/config` + `POST /api/admin/agent/execute` + `POST /api/admin/settings/{key}/test`
- `backend/tests/test_agent_router.py` — HTTP tests for config + execute + test
- `backend/tests/test_llm_client.py` — mocked httpx tests
- `frontend-vite/src/pages/admin/AdminSettings.tsx` — settings UI
- `frontend-vite/src/pages/admin/AdminSettings.css` — scoped styles
- `frontend-vite/src/components/admin/PageAgentMount.tsx` — script loader

### Modified files
- `backend/app/main.py` — register agent router
- `backend/requirements.txt` — ensure `httpx>=0.27` (already present)
- `frontend-vite/src/App.tsx` — wire `/admin/settings` to AdminSettings; mount PageAgentMount inside AdminLayout
- `frontend-vite/src/components/admin/AdminLayout.tsx` — render `<PageAgentMount />`
- `frontend-vite/src/services/api.ts` — `api.admin.agent.config/execute`, `api.admin.settings.test`

---

## Task 1: LLM client service (httpx-based)

**Files:**
- Create: `backend/app/services/llm_client.py`
- Create: `backend/tests/test_llm_client.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_llm_client.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch

from app.services.llm_client import LLMUnavailable, chat_complete


@pytest.mark.asyncio
async def test_chat_complete_returns_text():
    fake_response = {
        "choices": [{"message": {"role": "assistant", "content": "hi"}}]
    }
    with patch("app.services.llm_client.httpx.AsyncClient") as MockClient:
        client = MockClient.return_value.__aenter__.return_value
        client.post = AsyncMock(return_value=AsyncMock(
            status_code=200, json=lambda: fake_response, raise_for_status=lambda: None
        ))
        out = await chat_complete(
            base_url="https://example.com/v1",
            api_key="k",
            model="m",
            messages=[{"role": "user", "content": "hello"}],
        )
        assert out == "hi"


@pytest.mark.asyncio
async def test_chat_complete_raises_on_error():
    with patch("app.services.llm_client.httpx.AsyncClient") as MockClient:
        client = MockClient.return_value.__aenter__.return_value
        resp = AsyncMock(status_code=401, text="bad key", raise_for_status=AsyncMock(side_effect=Exception("401")))
        client.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMUnavailable):
            await chat_complete("https://x", "k", "m", [{"role": "user", "content": "hi"}])
```

- [ ] **Step 2: Install pytest-asyncio if needed**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pip install pytest-asyncio
echo "pytest-asyncio" >> requirements.txt
```

If the project doesn't use pytest-asyncio, append `asyncio_mode = "auto"` to `pytest.ini`:

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -ra --strict-markers
asyncio_mode = auto
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_llm_client.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 4: Implement**

Create `backend/app/services/llm_client.py`:

```python
"""Minimal OpenAI-compatible chat completion client used by page-agent proxy."""
from typing import Iterable

import httpx


class LLMUnavailable(Exception):
    """Raised when the upstream LLM call fails."""


async def chat_complete(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: Iterable[dict],
    timeout: float = 30.0,
) -> str:
    """Call POST {base_url}/chat/completions and return the assistant text."""
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {"model": model, "messages": list(messages), "stream": False}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, headers=headers, json=body)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise LLMUnavailable(str(e)) from e

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise LLMUnavailable(f"unexpected response shape: {e}") from e
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_llm_client.py -v
```
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/services/llm_client.py backend/tests/test_llm_client.py backend/requirements.txt backend/pytest.ini && git commit -m "feat(llm): minimal chat-complete client (httpx)"
```

---

## Task 2: agent_router — config + execute + test

**Files:**
- Create: `backend/app/routers/agent_router.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_agent_router.py`:

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from unittest.mock import patch, AsyncMock

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.security import hash_password, create_access_token
from app.config import settings


@pytest.fixture
def env(tmp_path, monkeypatch):
    test_db = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{test_db}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD_HASH", hash_password("pw"))
    yield {"client": TestClient(app)}
    app.dependency_overrides.clear()


def _auth():
    return {"Authorization": f"Bearer {create_access_token(sub='admin')}"}


def test_config_returns_disabled_when_no_settings(env):
    res = env["client"].get("/api/admin/agent/config", headers=_auth())
    assert res.status_code == 200
    assert res.json() == {"enabled": False, "model": "", "base_url": ""}


def test_config_reflects_settings(env):
    # Seed settings
    env["client"].put("/api/admin/settings/page_agent.enabled", headers=_auth(),
                      json={"value": "true", "description": "toggle"})
    env["client"].put("/api/admin/settings/page_agent.model", headers=_auth(),
                      json={"value": "MiniMax-M3", "description": "model"})
    env["client"].put("/api/admin/settings/page_agent.base_url", headers=_auth(),
                      json={"value": "https://api.example.com/v1", "description": "base"})

    res = env["client"].get("/api/admin/agent/config", headers=_auth())
    body = res.json()
    assert body["enabled"] is True
    assert body["model"] == "MiniMax-M3"
    assert body["base_url"] == "https://api.example.com/v1"
    # api_key must NOT appear
    assert "api_key" not in body
    assert "apiKey" not in body


def test_execute_requires_enabled(env):
    res = env["client"].post("/api/admin/agent/execute", headers=_auth(),
                              json={"messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 409


def test_execute_proxies_to_llm(env):
    # Enable + set key + base + model
    env["client"].put("/api/admin/settings/page_agent.enabled", headers=_auth(),
                      json={"value": "true"})
    env["client"].put("/api/admin/settings/page_agent.api_key", headers=_auth(),
                      json={"value": "sk-test"})
    env["client"].put("/api/admin/settings/page_agent.base_url", headers=_auth(),
                      json={"value": "https://example.com/v1"})
    env["client"].put("/api/admin/settings/page_agent.model", headers=_auth(),
                      json={"value": "m"})

    with patch("app.routers.agent_router.chat_complete", new=AsyncMock(return_value="hello back")):
        res = env["client"].post("/api/admin/agent/execute", headers=_auth(),
                                  json={"messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 200
    assert res.json() == {"content": "hello back"}


def test_settings_test_endpoint_pings_llm(env):
    env["client"].put("/api/admin/settings/page_agent.api_key", headers=_auth(),
                      json={"value": "sk-test"})
    env["client"].put("/api/admin/settings/page_agent.base_url", headers=_auth(),
                      json={"value": "https://example.com/v1"})
    env["client"].put("/api/admin/settings/page_agent.model", headers=_auth(),
                      json={"value": "m"})

    with patch("app.routers.agent_router.chat_complete", new=AsyncMock(return_value="pong")):
        res = env["client"].post("/api/admin/settings/page_agent.api_key/test", headers=_auth())
    assert res.status_code == 200
    assert res.json() == {"ok": True, "sample": "pong"}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_agent_router.py -v
```
Expected: 404

- [ ] **Step 3: Implement router**

Create `backend/app/routers/agent_router.py`:

```python
"""Admin: page-agent configuration + server-side LLM proxy."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.admin_setting import AdminSetting
from ..security import get_current_admin
from ..services.crypto import decrypt_value
from ..services.llm_client import chat_complete, LLMUnavailable


router = APIRouter(prefix="/api/admin", tags=["admin-agent"])


_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = "MiniMax-M3"


def _get_setting(db: Session, key: str) -> Optional[str]:
    row = db.query(AdminSetting).filter_by(key=key).first()
    if not row:
        return None
    try:
        return decrypt_value(row.value_encrypted)
    except Exception:
        return None


@router.get("/agent/config")
def get_agent_config(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    enabled_raw = _get_setting(db, "page_agent.enabled") or "false"
    return {
        "enabled": enabled_raw.strip().lower() in ("true", "1", "yes"),
        "model": _get_setting(db, "page_agent.model") or _DEFAULT_MODEL,
        "base_url": _get_setting(db, "page_agent.base_url") or _DEFAULT_BASE_URL,
    }


class ExecuteRequest(BaseModel):
    messages: list[dict]


@router.post("/agent/execute")
async def execute_llm(
    body: ExecuteRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    config = get_agent_config(db=db, admin=admin)
    if not config["enabled"]:
        raise HTTPException(status_code=409, detail="page-agent 未启用")
    api_key = _get_setting(db, "page_agent.api_key")
    if not api_key:
        raise HTTPException(status_code=409, detail="未配置 page_agent.api_key")
    try:
        content = await chat_complete(
            base_url=config["base_url"],
            api_key=api_key,
            model=config["model"],
            messages=body.messages,
        )
    except LLMUnavailable as e:
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {e}")
    return {"content": content}


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
    if not api_key:
        raise HTTPException(status_code=409, detail="未配置该 key")
    base_url = _get_setting(db, "page_agent.base_url") or _DEFAULT_BASE_URL
    model = _get_setting(db, "page_agent.model") or _DEFAULT_MODEL
    try:
        sample = await chat_complete(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": "ping"}],
        )
    except LLMUnavailable as e:
        raise HTTPException(status_code=502, detail=f"连通性测试失败: {e}")
    return {"ok": True, "sample": sample[:200]}
```

- [ ] **Step 4: Wire into main.py**

In `backend/app/main.py`, add `agent_router` to the import line and include it:

```python
from .routers import articles_router, team_router, auth_router, admin_router, settings_router, admin_articles_import, admin_journal_articles, agent_router
```

```python
app.include_router(agent_router.router)
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_agent_router.py -v
```
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/routers/agent_router.py backend/app/main.py backend/tests/test_agent_router.py && git commit -m "feat(agent): page-agent config + execute + setting-test endpoints"
```

---

## Task 3: Frontend api — agent.* + settings.test

**Files:**
- Modify: `frontend-vite/src/services/api.ts`

- [ ] **Step 1: Add agent endpoints**

In the `admin` object, after `settings:`, add:

```typescript
    agent: {
      config: (): Promise<{ enabled: boolean; model: string; base_url: string }> =>
        request('/api/admin/agent/config'),
      execute: (messages: Array<{ role: string; content: string }>) =>
        request('/api/admin/agent/execute', {
          method: 'POST',
          body: JSON.stringify({ messages }),
        }),
    },
```

Inside `settings:`, after `upsert`, add:

```typescript
      test: (key: string) =>
        request(`/api/admin/settings/${encodeURIComponent(key)}/test`, { method: 'POST' }),
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/services/api.ts && git commit -m "feat(api): admin.agent.config/execute + settings.test"
```

---

## Task 4: AdminSettings page

**Files:**
- Create: `frontend-vite/src/pages/admin/AdminSettings.tsx`
- Create: `frontend-vite/src/pages/admin/AdminSettings.css`

- [ ] **Step 1: Create the page**

Create `frontend-vite/src/pages/admin/AdminSettings.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, RefreshCw, Zap, ZapOff } from 'lucide-react'
import { api } from '../../services/api'
import './AdminSettings.css'

interface Setting {
  key: string
  value: string | null
  masked: string | null
  is_secret: boolean
  description: string
  updated_at: string
  updated_by: string
}

const KNOWN_KEYS = [
  { key: 'page_agent.enabled',     label: '启用 page-agent', kind: 'bool'   as const },
  { key: 'page_agent.model',       label: '模型',             kind: 'string' as const },
  { key: 'page_agent.base_url',    label: 'API Base URL',     kind: 'string' as const },
  { key: 'page_agent.api_key',     label: 'API Key',          kind: 'secret' as const },
  { key: 'page_agent.system_prompt', label: '系统 Prompt（可覆盖）', kind: 'string' as const },
]

export function AdminSettings() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, string>>({})

  const listQ = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.admin.settings.list(),
  })

  // Pre-fill draft from existing values
  useEffect(() => {
    const items = listQ.data?.items ?? []
    const next: Record<string, string> = {}
    for (const it of items) {
      // secret rows return null value; we leave draft blank unless user types
      if (!it.is_secret && it.value != null) {
        next[it.key] = it.value
      }
    }
    setDraft((d) => ({ ...next, ...d }))  // preserve user-typed secrets
  }, [listQ.data])

  const upsertMut = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) =>
      api.admin.settings.upsert(key, value),
    onSuccess: (_data, vars) => {
      setFeedback((f) => ({ ...f, [vars.key]: '已保存' }))
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] })
      qc.invalidateQueries({ queryKey: ['admin', 'agent', 'config'] })
    },
    onError: (err, vars) => {
      setFeedback((f) => ({ ...f, [vars.key]: err instanceof Error ? err.message : '保存失败' }))
    },
  })

  const testMut = useMutation({
    mutationFn: (key: string) => api.admin.settings.test(key),
    onSuccess: (_d, key) => setFeedback((f) => ({ ...f, [key]: '✓ 连通' })),
    onError: (err, key) => setFeedback((f) => ({ ...f, [key]: `× ${err instanceof Error ? err.message : '失败'}` })),
  })

  const items: Setting[] = listQ.data?.items ?? []
  const lookup = Object.fromEntries(items.map((i) => [i.key, i]))

  const setDraftFor = (k: string, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }))

  return (
    <div className="admin-settings">
      <h2 style={{ marginTop: 0 }}>设置</h2>
      <p style={{ color: 'var(--color-text-secondary)' }}>
        page-agent 是基于自然语言操作 admin 页面的代理。仅在 admin 路由内启用。
        API Key 在服务端 Fernet 加密落库，不会发送到浏览器。
      </p>

      <div className="admin-settings__list">
        {KNOWN_KEYS.map((k) => {
          const row = lookup[k.key]
          const value = draft[k.key] ?? ''
          return (
            <div key={k.key} className="admin-settings__row">
              <label className="admin-settings__label">
                {k.label}
                <span className="admin-settings__key">{k.key}</span>
                {row?.description && <span className="admin-settings__desc">{row.description}</span>}
              </label>
              <div className="admin-settings__field">
                {k.kind === 'bool' ? (
                  <select
                    value={value || 'false'}
                    onChange={(e) => setDraftFor(k.key, e.target.value)}
                  >
                    <option value="true">启用</option>
                    <option value="false">关闭</option>
                  </select>
                ) : k.kind === 'secret' ? (
                  <input
                    type="password"
                    placeholder={row?.masked || '尚未配置'}
                    value={value}
                    onChange={(e) => setDraftFor(k.key, e.target.value)}
                  />
                ) : (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setDraftFor(k.key, e.target.value)}
                  />
                )}
                <button
                  type="button"
                  className="admin-settings__btn"
                  onClick={() => upsertMut.mutate({ key: k.key, value })}
                  disabled={upsertMut.isPending}
                >
                  <Save size={14} /> 保存
                </button>
                {k.kind === 'secret' && (
                  <button
                    type="button"
                    className="admin-settings__btn"
                    onClick={() => testMut.mutate(k.key)}
                    disabled={testMut.isPending || !row}
                  >
                    <Zap size={14} /> 测试连通
                  </button>
                )}
              </div>
              {feedback[k.key] && (
                <div className={`admin-settings__feedback ${feedback[k.key].startsWith('×') ? 'admin-settings__feedback--err' : ''}`}>
                  {feedback[k.key]}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <h3 style={{ marginTop: '32px' }}>其他设置（只读）</h3>
      <table className="admin-settings__table">
        <thead><tr><th>Key</th><th>值</th><th>更新时间</th><th>更新人</th></tr></thead>
        <tbody>
          {items.filter((i) => !KNOWN_KEYS.some((k) => k.key === i.key)).map((i) => (
            <tr key={i.key}>
              <td>{i.key}</td>
              <td>{i.is_secret ? i.masked : i.value}</td>
              <td>{new Date(i.updated_at).toLocaleString('zh-CN')}</td>
              <td>{i.updated_by}</td>
            </tr>
          ))}
          {items.filter((i) => !KNOWN_KEYS.some((k) => k.key === i.key)).length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>无</td></tr>
          )}
        </tbody>
      </table>

      <div className="admin-settings__hint">
        <ZapOff size={14} /> page-agent 仅在 admin 路由加载。启用后右下角会出现代理输入框，
        关闭后下次进入 admin 页面即消失（<RefreshCw size={14} /> 刷新当前页可立即生效）。
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the CSS**

Create `frontend-vite/src/pages/admin/AdminSettings.css`:

```css
.admin-settings { padding: 24px; max-width: 800px; }
.admin-settings__list { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
.admin-settings__row { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 16px; }
.admin-settings__label { display: block; font-weight: 500; margin-bottom: 8px; }
.admin-settings__key { display: inline-block; margin-left: 8px; font-family: monospace; font-size: 0.75rem; color: var(--color-text-secondary); }
.admin-settings__desc { display: block; font-weight: 400; font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 2px; }
.admin-settings__field { display: flex; gap: 8px; align-items: center; }
.admin-settings__field input, .admin-settings__field select { flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem; }
.admin-settings__btn { padding: 6px 12px; background: #1A1A2E; color: #FAFAF7; border: none; border-radius: 6px; cursor: pointer; font-size: 0.8125rem; display: inline-flex; align-items: center; gap: 4px; }
.admin-settings__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.admin-settings__feedback { margin-top: 6px; font-size: 0.75rem; color: #16a34a; }
.admin-settings__feedback--err { color: #c00; }
.admin-settings__table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 0.875rem; }
.admin-settings__table th, .admin-settings__table td { padding: 8px; text-align: left; border-bottom: 1px solid #f0f0f0; }
.admin-settings__hint { margin-top: 24px; font-size: 0.8125rem; color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 3: Wire route**

In `frontend-vite/src/App.tsx`:
- Add import: `import { AdminSettings } from './pages/admin/AdminSettings'`
- Replace the placeholder route (`<Route path="settings" element={<div>…</div>} />`) with: `<Route path="settings" element={<AdminSettings />} />`

- [ ] **Step 4: Type-check + build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit && npm run build
```
Expected: 0 errors and build success

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/pages/admin/AdminSettings.tsx frontend-vite/src/pages/admin/AdminSettings.css frontend-vite/src/App.tsx && git commit -m "feat(admin): AdminSettings UI for page-agent"
```

---

## Task 5: PageAgentMount component

**Files:**
- Create: `frontend-vite/src/components/admin/PageAgentMount.tsx`

- [ ] **Step 1: Create component**

Create `frontend-vite/src/components/admin/PageAgentMount.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'

const PAGE_AGENT_CDN = 'https://cdn.jsdelivr.net/npm/page-agent@1.10.0/dist/iife/page-agent.demo.js'

declare global {
  interface Window {
    PageAgent?: any
  }
}

/**
 * Mounts the page-agent demo script and configures it to call our server-side
 * /api/admin/agent/execute proxy (so the API key never leaves the backend).
 *
 * Only renders in /admin/* routes — AdminLayout owns this component.
 */
export function PageAgentMount() {
  const initialized = useRef(false)

  const configQ = useQuery({
    queryKey: ['admin', 'agent', 'config'],
    queryFn: () => api.admin.agent.config(),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!configQ.data?.enabled) return
    if (initialized.current) return
    if (window.PageAgent) {
      init(window.PageAgent)
      initialized.current = true
      return
    }
    const s = document.createElement('script')
    s.src = PAGE_AGENT_CDN
    s.async = true
    s.crossOrigin = 'anonymous'
    s.onload = () => {
      if (window.PageAgent) {
        init(window.PageAgent)
        initialized.current = true
      }
    }
    document.head.appendChild(s)
    return () => {
      // Don't remove the script on unmount — page-agent keeps state.
    }
  }, [configQ.data?.enabled])

  return null
}

function init(PageAgent: any) {
  // page-agent's demo build expects direct LLM access. We don't want to
  // expose the API key, so for Phase 4 we ship a *config-only* mount:
  // the widget renders, but LLM calls are intentionally disabled at this
  // layer. The server-side /api/admin/agent/execute proxy is reserved for
  // future use (e.g. a custom in-house UI that calls the same endpoint).
  //
  // To prevent accidental calls leaking the API key to a third-party proxy,
  // we instantiate PageAgent with `model: '__disabled__'` which causes its
  // internal execute() to fail fast.
  try {
    new PageAgent({
      model: '__disabled__',
      baseURL: location.origin,
      apiKey: 'placeholder',
      language: 'zh-CN',
    })
  } catch {
    // Ignore — page-agent may throw if the DOM isn't fully ready.
  }
}
```

**Important:** Phase 4 ships the configuration UI and the server-side proxy, but the widget's runtime execution is gated behind the `__disabled__` model. This prevents accidental data leaks. Activating the actual agent requires:
1. Updating `init()` to call our `/api/admin/agent/execute` proxy directly (replacing the page-agent internal LLM client)
2. Or building a thin custom UI on top of the proxy

We mark this explicitly so the user knows Phase 4 is "configurable but not yet activated". A follow-up plan will activate the runtime.

- [ ] **Step 2: Mount in AdminLayout**

In `frontend-vite/src/components/admin/AdminLayout.tsx`, find the component's return statement and add `<PageAgentMount />` as a sibling:

```tsx
import { PageAgentMount } from './PageAgentMount'
// ...
  return (
    <div className="admin-layout">
      <PageAgentMount />
      {/* existing layout content */}
    </div>
  )
```

(Adjust to match the actual JSX structure — read the file first.)

- [ ] **Step 3: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/components/admin/PageAgentMount.tsx frontend-vite/src/components/admin/AdminLayout.tsx && git commit -m "feat(admin): PageAgentMount wired into AdminLayout (config-only)"
```

---

## Task 6: Verification — full backend + frontend + manual smoke

- [ ] **Step 1: Backend tests**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest -q
```
Expected: all green (existing + ~7 new)

- [ ] **Step 2: Frontend build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run build
```
Expected: success

- [ ] **Step 3: Manual UI smoke**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && uvicorn app.main:app --port 8000 &
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run dev -- --port 5173 &
```

Steps:
1. Login → `/admin/settings`
2. Toggle `启用 page-agent` → save → status reads "已保存"
3. Paste any string into `API Key` → save
4. Click `测试连通` → expect either "✓ 连通" or "× …"
5. Refresh `/admin/articles` → no widget appears (config-only mode, by design)
6. Re-check `启用 page-agent` to off → save
7. Visit `/api/admin/agent/config` (admin auth) — JSON shows `"enabled": false`

- [ ] **Step 4: Stop dev servers**

```bash
pkill -f "uvicorn app.main:app" ; pkill -f "vite" || true
```

- [ ] **Step 5: Tag milestone**

```bash
cd /Users/jasonlee/hubei-shuchuang && git tag -a m4-complete -m "Phase 4: page-agent config + LLM proxy shipped (widget config-only)"
```

---

## Self-Review

**Spec coverage:**
- §3.1 admin_settings key list (`page_agent.enabled/model/base_url/api_key/system_prompt`) → Task 4 (KNOWN_KEYS) ✓
- §4.1 `GET /api/admin/agent/config` + `POST /api/admin/agent/execute` → Task 2 ✓
- §4.1 `POST /api/admin/settings/{key}/test` → Task 2 ✓
- §5.2 PageAgentMount → Task 5 ✓
- §5.2 AdminSettings page → Task 4 ✓
- §6.1 Fernet encryption (already in M1, reused) ✓
- §6.3 API key never leaves backend → Task 5 init() uses `__disabled__` model ✓

**Type consistency:**
- `GET /api/admin/agent/config` returns `{enabled, model, base_url}` matching both backend router and frontend type (Tasks 2 and 3). ✓
- `ExecuteRequest.messages: list[dict]` matches what frontend sends (Task 2 + Task 3). ✓
- `KNOWN_KEYS` covers all spec §3.1 keys; "其他设置" table surfaces anything else written via API. ✓

**No placeholders:** Every config field is rendered with a real input; every button has a concrete mutationFn; the widget mount is honest about being config-only (call-out in Task 5 step 1).

**Risk acknowledged:** The widget doesn't actually execute against the LLM in this plan (intentionally — runtime activation requires replacing the page-agent internal LLM client, which is a separate concern). This is recorded in Task 5's callout and in the `m4-complete` tag message.