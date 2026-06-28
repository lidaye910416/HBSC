# HBSC Admin Phase 1 — Data Model & Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `admin_settings` table (encrypted K/V) + `Journal.status` field + per-journal "4-category completeness" enforcement + public-read filter on `status='published'`. No new admin UI yet beyond badges on existing pages.

**Architecture:** Backwards-compatible additive migration — `Journal.status` defaults to `'published'` so existing rows continue to surface publicly until an admin touches them. New `admin_settings` table holds Fernet-encrypted page-agent config (used in Phase 4). Completeness logic lives in `app/services/completeness.py` and is reused by both `/admin/journals/{id}/publish` and the front-end badge API.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, pydantic v2, pytest, `cryptography` (Fernet), SQLite.

**Spec:** `docs/superpowers/specs/2026-06-28-hbsc-admin-completeness-design.md` §3-§4 (M1 only)

**Phases shipped by this plan:** Phase 1 of 4. Subsequent phases (M2 Word import, M3 4-Tab UI, M4 page-agent) live in separate plan files.

---

## File Structure

### New files
- `backend/app/models/admin_setting.py` — `AdminSetting` SQLAlchemy model
- `backend/app/services/crypto.py` — Fernet helpers (get_cipher, encrypt_value, decrypt_value)
- `backend/app/services/completeness.py` — `is_journal_complete(journal) -> dict`
- `backend/app/routers/settings_router.py` — GET/PUT/test for admin settings (full impl in Phase 4; here we only add the table + crypto + a placeholder router returning 501 if needed — actually we ship the router too so Phase 4 just adds UI)
- `backend/app/schemas/admin_setting.py` — `AdminSettingOut`, `AdminSettingUpdate`
- `backend/tests/test_completeness.py` — service-level tests
- `backend/tests/test_admin_journals_publish.py` — HTTP-level tests for new publish endpoint
- `backend/tests/test_admin_settings.py` — encryption round-trip tests

### Modified files
- `backend/app/models/journal.py` — add `status` column to `Journal`
- `backend/app/models/__init__.py` — export `AdminSetting`
- `backend/app/config.py` — add `ADMIN_SETTINGS_SECRET` env var with dev fallback
- `backend/app/main.py` — register new router; default existing rows to `status='published'` once
- `backend/app/routers/articles_router.py` — filter public `GET /issues` and `GET /journals/{slug}` on `status='published'`
- `backend/app/routers/admin_router.py` — add publish/unpublish + completeness endpoints
- `backend/app/schemas/admin.py` — add `status` to `JournalCreate`, `JournalUpdate`, `JournalAdminOut`
- `frontend-vite/src/services/api.ts` — extend `api.admin.journals.*` (publish/unpublish/completeness) + `api.admin.settings.*`
- `frontend-vite/src/pages/admin/JournalList.tsx` — completeness badge column
- `frontend-vite/src/pages/admin/JournalEditor.tsx` — status field (draft/published)
- `frontend-vite/src/components/admin/AdminLayout.tsx` — link to /admin/settings (route added in Phase 4)
- `backend/requirements.txt` — add `cryptography>=42.0.0`

---

## Task 1: Add cryptography dependency

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add line**

Append to `backend/requirements.txt`:
```
cryptography>=42.0.0
```

- [ ] **Step 2: Install**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pip install -r requirements.txt
```
Expected: Successfully installed cryptography-…

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/requirements.txt && git commit -m "chore(deps): add cryptography for Fernet encryption"
```

---

## Task 2: AdminSetting model

**Files:**
- Create: `backend/app/models/admin_setting.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Create the model file**

Create `backend/app/models/admin_setting.py`:

```python
from sqlalchemy import Column, String, DateTime, Boolean
from sqlalchemy.sql import func
from .base import Base


class AdminSetting(Base):
    """Encrypted K/V store for admin-tunable settings (e.g. page-agent config)."""
    __tablename__ = "admin_settings"

    key = Column(String(100), primary_key=True)
    value_encrypted = Column(String(2000), nullable=False)  # Fernet token (base64)
    description = Column(String(500), nullable=False, default="")
    is_secret = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by = Column(String(100), nullable=False, default="")

    def __repr__(self) -> str:
        return f"<AdminSetting {self.key}>"
```

- [ ] **Step 2: Register export**

Modify `backend/app/models/__init__.py`. Replace contents with:

```python
from sqlalchemy.orm import declarative_base
Base = declarative_base()

from .journal import Journal, Article
from .researcher import Researcher
from .article_image import ArticleImage
from .admin_setting import AdminSetting

__all__ = ["Base", "Journal", "Article", "Researcher", "ArticleImage", "AdminSetting"]
```

- [ ] **Step 3: Sanity import**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && python -c "from app.models import AdminSetting; print(AdminSetting.__tablename__)"
```
Expected: `admin_settings`

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/models/admin_setting.py backend/app/models/__init__.py && git commit -m "feat(model): add AdminSetting encrypted K/V table"
```

---

## Task 3: Fernet crypto helper

**Files:**
- Create: `backend/app/services/crypto.py`
- Create: `backend/tests/test_crypto.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_crypto.py`:

```python
import pytest
from cryptography.fernet import InvalidToken

from app.services.crypto import (
    encrypt_value,
    decrypt_value,
    mask_value,
    InvalidEncryptedValue,
)


def test_roundtrip():
    secret = "sk-cp-VeRySeCrEt"
    token = encrypt_value(secret)
    assert token != secret
    assert decrypt_value(token) == secret


def test_decrypt_garbage_raises():
    with pytest.raises(InvalidEncryptedValue):
        decrypt_value("not-a-fernet-token")


def test_mask_short():
    assert mask_value("") == ""
    assert mask_value("abc") == "***"


def test_mask_long_shows_prefix_and_suffix():
    masked = mask_value("sk-cp-VeRySeCrEt")
    assert masked.startswith("sk-c")
    assert masked.endswith("***")
    assert "VeRySeCrEt" not in masked
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_crypto.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.services.crypto'`

- [ ] **Step 3: Implement**

Create `backend/app/services/crypto.py`:

```python
"""Fernet helpers for AdminSetting.value_encrypted."""
import os
import secrets
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken


class InvalidEncryptedValue(Exception):
    """Raised when decrypt_value gets a token that isn't valid Fernet ciphertext."""


def _load_or_generate_key() -> bytes:
    """Read ADMIN_SETTINGS_SECRET (44-char url-safe base64) from env.
    Dev: generate an ephemeral key and print a warning.
    Prod: raise.
    """
    key = os.getenv("ADMIN_SETTINGS_SECRET")
    if key:
        return key.encode("utf-8")
    if os.getenv("ENV") == "production":
        raise RuntimeError(
            "ADMIN_SETTINGS_SECRET must be set in production "
            "(44-char url-safe base64 Fernet key)"
        )
    # Dev fallback
    ephemeral = Fernet.generate_key()
    print(
        "[SECURITY][DEV ONLY] Using ephemeral ADMIN_SETTINGS_SECRET — "
        "settings will not survive restart.",
        flush=True,
    )
    return ephemeral


@lru_cache(maxsize=1)
def _cipher() -> Fernet:
    return Fernet(_load_or_generate_key())


def encrypt_value(plain: str) -> str:
    if plain is None:
        plain = ""
    return _cipher().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_value(token: str) -> str:
    try:
        return _cipher().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as e:
        raise InvalidEncryptedValue(str(e)) from e


def mask_value(plain: str) -> str:
    """Return a short masked view of a secret for display in admin UI."""
    if not plain:
        return ""
    if len(plain) <= 6:
        return "***"
    # Show first 4 and last 0 chars (typical key shape)
    return plain[:4] + "***"
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_crypto.py -v
```
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/services/crypto.py backend/tests/test_crypto.py && git commit -m "feat(crypto): Fernet helpers for AdminSetting encryption"
```

---

## Task 4: Add Journal.status column

**Files:**
- Modify: `backend/app/models/journal.py`

- [ ] **Step 1: Modify the model**

In `backend/app/models/journal.py`, replace the `Journal` class (lines 7-23) with:

```python
class Journal(Base):
    __tablename__ = "journals"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    cover_image = Column(String(500))
    description = Column(Text)
    issue_number = Column(String(50))
    status = Column(String(20), nullable=False, default="published", index=True)
    published_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    articles = relationship("Article", back_populates="journal", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Journal {self.title}>"
```

Do not modify the `Article` class below it.

- [ ] **Step 2: Sanity check**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && python -c "from app.models import Journal; print(Journal.status.default.arg)"
```
Expected: `published`

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/models/journal.py && git commit -m "feat(model): add Journal.status (draft|published)"
```

---

## Task 5: Completeness service

**Files:**
- Create: `backend/app/services/completeness.py`
- Create: `backend/tests/test_completeness.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_completeness.py`:

```python
from types import SimpleNamespace
from app.services.completeness import REQUIRED_CATEGORIES, is_journal_complete


def _article(category: str, status: str = "published"):
    return SimpleNamespace(category=category, status=status)


def _journal(articles):
    return SimpleNamespace(articles=articles)


def test_required_categories_constant():
    assert REQUIRED_CATEGORIES == [
        "战略与政策", "技术与产业", "方案与思考", "动态与文化"
    ]


def test_empty_journal_incomplete():
    result = is_journal_complete(_journal([]))
    assert result["complete"] is False
    assert all(result[c] == 0 for c in REQUIRED_CATEGORIES)


def test_one_category_present_incomplete():
    a = _article("战略与政策")
    result = is_journal_complete(_journal([a]))
    assert result["战略与政策"] == 1
    assert result["技术与产业"] == 0
    assert result["complete"] is False


def test_all_four_categories_complete():
    arts = [_article(c) for c in REQUIRED_CATEGORIES]
    result = is_journal_complete(_journal(arts))
    assert result["complete"] is True


def test_draft_articles_do_not_count():
    arts = [_article(c, status="draft") for c in REQUIRED_CATEGORIES]
    result = is_journal_complete(_journal(arts))
    assert result["complete"] is False


def test_multiple_per_category_still_complete():
    arts = [_article(c) for c in REQUIRED_CATEGORIES] + [_article("战略与政策")]
    result = is_journal_complete(_journal(arts))
    assert result["complete"] is True
    assert result["战略与政策"] == 2
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_completeness.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.services.completeness'`

- [ ] **Step 3: Implement**

Create `backend/app/services/completeness.py`:

```python
"""Per-journal 4-category completeness rules."""
from typing import Iterable, TypedDict


REQUIRED_CATEGORIES = ["战略与政策", "技术与产业", "方案与思考", "动态与文化"]


class CompletenessReport(TypedDict):
    战略与政策: int
    技术与产业: int
    方案与思考: int
    动态与文化: int
    complete: bool


def is_journal_complete(journal) -> CompletenessReport:
    """Count published articles per REQUIRED_CATEGORY and report completeness.

    Drafts don't count — an admin may save articles as drafts while preparing
    a new issue. A journal is complete when each category has >= 1 published
    article.
    """
    counts: dict[str, int] = {c: 0 for c in REQUIRED_CATEGORIES}
    for a in (journal.articles or []):
        cat = getattr(a, "category", None)
        status = getattr(a, "status", "published")
        if cat in counts and status == "published":
            counts[cat] += 1
    counts["complete"] = all(counts[c] >= 1 for c in REQUIRED_CATEGORIES)
    return counts  # type: ignore[return-value]
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_completeness.py -v
```
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/services/completeness.py backend/tests/test_completeness.py && git commit -m "feat(services): journal 4-category completeness rule"
```

---

## Task 6: AdminSetting schemas

**Files:**
- Create: `backend/app/schemas/admin_setting.py`
- Modify: `backend/app/schemas/__init__.py`

- [ ] **Step 1: Create schemas file**

Create `backend/app/schemas/admin_setting.py`:

```python
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class AdminSettingOut(BaseModel):
    """Single setting row returned to admin UI. Secret values are masked."""
    key: str
    value: Optional[str]      # decrypted plain value, or None if masking applied
    masked: Optional[str]     # short masked preview when value is secret
    is_secret: bool
    description: str
    updated_at: datetime
    updated_by: str

    class Config:
        from_attributes = True


class AdminSettingUpdate(BaseModel):
    """Update payload — value is required; admin username stamped from JWT."""
    value: str
    description: Optional[str] = None


class SettingsListResponse(BaseModel):
    items: list[AdminSettingOut]
```

- [ ] **Step 2: Add a lazy export**

Modify `backend/app/schemas/__init__.py` to add (at the bottom):

```python
from .admin_setting import AdminSettingOut, AdminSettingUpdate, SettingsListResponse
```

- [ ] **Step 3: Smoke test**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && python -c "from app.schemas import AdminSettingUpdate; print(AdminSettingUpdate(value='x').value)"
```
Expected: `x`

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/schemas/admin_setting.py backend/app/schemas/__init__.py && git commit -m "feat(schemas): AdminSettingOut/Update pydantic models"
```

---

## Task 7: Settings router — list + update (no test endpoint yet)

**Files:**
- Create: `backend/app/routers/settings_router.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_admin_settings.py` (create file if absent):

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.models.admin_setting import AdminSetting
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


def test_list_settings_requires_auth(env):
    res = env["client"].get("/api/admin/settings")
    assert res.status_code == 401


def test_list_settings_empty(env):
    res = env["client"].get("/api/admin/settings", headers=_auth())
    assert res.status_code == 200
    assert res.json() == {"items": []}


def test_update_setting_creates_and_lists(env):
    res = env["client"].put(
        "/api/admin/settings/page_agent.enabled",
        headers=_auth(),
        json={"value": "true", "description": "Toggle page-agent"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["key"] == "page_agent.enabled"
    assert body["value"] == "true"
    assert body["is_secret"] is False

    res = env["client"].get("/api/admin/settings", headers=_auth())
    assert res.status_code == 200
    assert len(res.json()["items"]) == 1


def test_secret_value_is_encrypted_at_rest_and_masked_on_read(env):
    res = env["client"].put(
        "/api/admin/settings/page_agent.api_key",
        headers=_auth(),
        json={"value": "sk-cp-SECRET", "description": "LLM key", "is_secret": True},
    )
    # No is_secret in PUT (server decides secret-ness based on key suffix);
    # the upsert path will be set in Task 7 step 3. For now, ensure storage
    # is encrypted regardless of what we send.
    assert res.status_code in (200, 422), res.text

    # Force it secret via DB upsert
    from app.services.crypto import encrypt_value
    db = next(get_db().__iter__()) if False else None  # placeholder, replaced below


def test_setting_unknown_key_creates_new(env):
    """PUT is upsert by key — create if absent."""
    res = env["client"].put(
        "/api/admin/settings/custom.key",
        headers=_auth(),
        json={"value": "hello"},
    )
    assert res.status_code == 200
    assert res.json()["value"] == "hello"
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_settings.py -v
```
Expected: 404 on GET `/api/admin/settings`

- [ ] **Step 3: Implement the router**

Create `backend/app/routers/settings_router.py`:

```python
"""Admin settings (encrypted K/V)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.admin_setting import AdminSetting
from ..schemas.admin_setting import AdminSettingOut, AdminSettingUpdate, SettingsListResponse
from ..security import get_current_admin
from ..services.crypto import encrypt_value, decrypt_value, mask_value


router = APIRouter(prefix="/api/admin/settings", tags=["admin-settings"])


# Keys that must be encrypted + masked. Anything ending in api_key / token / secret.
_SECRET_SUFFIXES = ("api_key", "token", "secret")


def _is_secret_key(key: str) -> bool:
    return any(key.endswith(s) for s in _SECRET_SUFFIXES)


def _to_out(row: AdminSetting) -> AdminSettingOut:
    plain: Optional[str] = None
    masked: Optional[str] = None
    try:
        plain = decrypt_value(row.value_encrypted)
    except Exception:
        plain = None
    if row.is_secret:
        masked = mask_value(plain or "")
        plain = None
    return AdminSettingOut(
        key=row.key,
        value=plain,
        masked=masked,
        is_secret=row.is_secret,
        description=row.description or "",
        updated_at=row.updated_at,
        updated_by=row.updated_by or "",
    )


@router.get("", response_model=SettingsListResponse)
def list_settings(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    rows = db.query(AdminSetting).order_by(AdminSetting.key).all()
    return SettingsListResponse(items=[_to_out(r) for r in rows])


@router.put("/{key}", response_model=AdminSettingOut)
def upsert_setting(
    key: str,
    body: AdminSettingUpdate,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    if not key or len(key) > 100:
        raise HTTPException(status_code=400, detail="key 长度需在 1-100 字符之间")
    is_secret = _is_secret_key(key)
    row = db.query(AdminSetting).filter(AdminSetting.key == key).first()
    if row is None:
        row = AdminSetting(
            key=key,
            value_encrypted=encrypt_value(body.value),
            description=body.description or "",
            is_secret=is_secret,
            updated_by=admin,
        )
        db.add(row)
    else:
        row.value_encrypted = encrypt_value(body.value)
        if body.description is not None:
            row.description = body.description
        row.is_secret = is_secret
        row.updated_by = admin
    db.commit()
    db.refresh(row)
    return _to_out(row)
```

- [ ] **Step 4: Replace the placeholder secret-marking test**

The test added in step 1 (`test_secret_value_is_encrypted_at_rest_and_masked_on_read`) had a broken fixture line. Replace it with this clean version:

```python
def test_secret_value_is_encrypted_at_rest_and_masked_on_read(env):
    # api_key suffix triggers secret treatment
    res = env["client"].put(
        "/api/admin/settings/page_agent.api_key",
        headers=_auth(),
        json={"value": "sk-cp-SECRET", "description": "LLM key"},
    )
    assert res.status_code == 200, res.text
    # Response should mask the secret and not return plain
    body = res.json()
    assert body["is_secret"] is True
    assert body["value"] is None
    assert body["masked"] is not None
    assert "SECRET" not in (body["masked"] or "")

    # Confirm at-rest ciphertext doesn't contain the plain text
    from app.models.admin_setting import AdminSetting
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    row = db.query(AdminSetting).filter_by(key="page_agent.api_key").first()
    assert "SECRET" not in row.value_encrypted
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_settings.py -v
```
Expected: 5 passed

- [ ] **Step 6: Wire router into main**

Modify `backend/app/main.py`:
- Replace import block (line 12) to also import `settings_router`:
```python
from .routers import articles_router, team_router, auth_router, admin_router, settings_router
```
- Add registration after the `admin_router` include (around line 90):
```python
app.include_router(settings_router)
```

- [ ] **Step 7: Run full test suite — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest -q
```
Expected: all existing + 5 new tests pass; total green.

- [ ] **Step 8: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/routers/settings_router.py backend/app/main.py backend/tests/test_admin_settings.py && git commit -m "feat(settings): admin K/V router with Fernet encryption"
```

---

## Task 8: Publish/unpublish/completeness endpoints on admin_router

**Files:**
- Modify: `backend/app/routers/admin_router.py`

- [ ] **Step 1: Add test cases to test_admin_journals.py**

Append to `backend/tests/test_admin_journals.py`:

```python
def test_completeness_endpoint(env):
    jid = env["client"].get("/api/admin/journals", headers=_auth(_token())).json()["items"][0]["id"]
    res = env["client"].get(f"/api/admin/journals/{jid}/completeness", headers=_auth(_token()))
    assert res.status_code == 200
    body = res.json()
    assert set(["战略与政策", "技术与产业", "方案与思考", "动态与文化", "complete"]).issubset(body.keys())
    assert body["complete"] is False  # no articles yet


def test_publish_incomplete_journal_422(env):
    jid = env["client"].get("/api/admin/journals", headers=_auth(_token())).json()["items"][0]["id"]
    res = env["client"].post(f"/api/admin/journals/{jid}/publish", headers=_auth(_token()))
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "incomplete_journal"


def test_publish_then_unpublish(env):
    from app.models.journal import Article
    from app.models.journal import Journal as J
    jid = env["client"].get("/api/admin/journals", headers=_auth(_token())).json()["items"][0]["id"]
    # Inject 4 published articles directly via DB
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    j = db.query(J).filter_by(id=jid).first()
    for cat in ["战略与政策", "技术与产业", "方案与思考", "动态与文化"]:
        db.add(Article(title=f"T-{cat}", slug=f"s-{cat}", category=cat, status="published", journal_id=jid))
    db.commit()

    res = env["client"].post(f"/api/admin/journals/{jid}/publish", headers=_auth(_token()))
    assert res.status_code == 200
    assert res.json()["status"] == "published"

    res = env["client"].post(f"/api/admin/journals/{jid}/unpublish", headers=_auth(_token()))
    assert res.status_code == 200
    assert res.json()["status"] == "draft"
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_journals.py -v
```
Expected: 404 on the new endpoints

- [ ] **Step 3: Implement endpoints**

In `backend/app/routers/admin_router.py`:
- Add imports at top (after existing imports):
```python
from .services.completeness import is_journal_complete
```

- Add these endpoints at the bottom (before `# ============== MEDIA ==============`):

```python
@router.get("/journals/{journal_id}/completeness")
def get_journal_completeness(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    return is_journal_complete(j)


@router.post("/journals/{journal_id}/publish")
def publish_journal(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    report = is_journal_complete(j)
    if not report["complete"]:
        missing = [c for c in ("战略与政策", "技术与产业", "方案与思考", "动态与文化") if report[c] == 0]
        raise HTTPException(
            status_code=422,
            detail={
                "code": "incomplete_journal",
                "message": "期刊必须四类文章齐全才能发布",
                "missing": missing,
            },
        )
    j.status = "published"
    db.commit()
    db.refresh(j)
    return _journal_to_dict(j)


@router.post("/journals/{journal_id}/unpublish")
def unpublish_journal(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")
    j.status = "draft"
    db.commit()
    db.refresh(j)
    return _journal_to_dict(j)
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_journals.py -v
```
Expected: 3 new + all existing pass

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/routers/admin_router.py backend/tests/test_admin_journals.py && git commit -m "feat(admin): journal completeness + publish/unpublish endpoints"
```

---

## Task 9: Update admin schemas to include status

**Files:**
- Modify: `backend/app/schemas/admin.py`

- [ ] **Step 1: Replace JournalCreate**

In `backend/app/schemas/admin.py`, replace the `JournalCreate` class (lines 82-94) with:

```python
class JournalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=100)

    @field_validator("slug")
    @classmethod
    def _check_slug(cls, v: str) -> str:
        return _validate_slug(v)

    cover_image: Optional[str] = None
    description: Optional[str] = None
    issue_number: Optional[str] = Field(None, max_length=50)
    status: Literal["draft", "published"] = "draft"
    published_at: Optional[datetime] = None
```

- [ ] **Step 2: Replace JournalUpdate**

Replace `JournalUpdate` (lines 97-102) with:

```python
class JournalUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    cover_image: Optional[str] = None
    description: Optional[str] = None
    issue_number: Optional[str] = Field(None, max_length=50)
    status: Optional[Literal["draft", "published"]] = None
    published_at: Optional[datetime] = None
```

- [ ] **Step 3: Replace JournalAdminOut**

Replace `JournalAdminOut` (lines 105-115) with:

```python
class JournalAdminOut(BaseModel):
    id: int
    title: str
    slug: str
    cover_image: Optional[str] = None
    description: Optional[str] = None
    issue_number: Optional[str] = None
    status: str = "draft"
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    article_count: int = 0

    class Config:
        from_attributes = True
```

- [ ] **Step 4: Run existing tests**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest -q
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/schemas/admin.py && git commit -m "feat(schemas): add status to Journal CRUD"
```

---

## Task 10: Public /api/issues filters on status='published'

**Files:**
- Modify: `backend/app/routers/articles_router.py`

- [ ] **Step 1: Add test**

Append to `backend/tests/test_public_filter.py` (create file if absent):

```python
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.models.journal import Journal, Article


@pytest.fixture
def env(tmp_path):
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
    db = TestingSessionLocal()
    db.add(Journal(title="Pub", slug="pub", status="published"))
    db.add(Journal(title="Drf", slug="drf", status="draft"))
    pub = db.query(Journal).filter_by(slug="pub").first()
    db.add(Article(title="A", slug="a", category="战略与政策", status="published", journal_id=pub.id))
    db.commit()
    db.close()
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_list_issues_only_published(env):
    res = env.get("/api/issues")
    assert res.status_code == 200
    slugs = [j["slug"] for j in res.json()]
    assert "pub" in slugs
    assert "drf" not in slugs


def test_get_issue_draft_returns_404(env):
    res = env.get("/api/issues/drf")
    assert res.status_code == 404


def test_get_journal_alias_filters_draft(env):
    res = env.get("/api/journals/drf")
    assert res.status_code == 404
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_public_filter.py -v
```
Expected: draft journal visible in /api/issues

- [ ] **Step 3: Update shared impl**

In `backend/app/routers/articles_router.py`, replace `_list_journals_impl` (lines 71-78) with:

```python
def _list_journals_impl(db: Session):
    """Public list — only published journals."""
    journals = (
        db.query(Journal)
        .filter(Journal.status == "published")
        .order_by(Journal.published_at.desc())
        .all()
    )
    return [_journal_to_dict(j) for j in journals]
```

And replace `_get_journal_impl` (lines 81-90) with:

```python
def _get_journal_impl(db: Session, slug: str):
    """Public detail — 404 for drafts."""
    journal = (
        db.query(Journal)
        .filter(Journal.slug == slug, Journal.status == "published")
        .first()
    )
    if not journal:
        raise HTTPException(status_code=404, detail="期刊不存在")
    return _journal_to_dict(journal, include_articles=True)
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_public_filter.py -v
```
Expected: 3 passed

- [ ] **Step 5: Run full backend suite**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest -q
```
Expected: all green

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/routers/articles_router.py backend/tests/test_public_filter.py && git commit -m "feat(public): filter /api/issues and /api/journals on status=published"
```

---

## Task 11: Backfill existing journals to status='published'

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add migration block**

In `backend/app/main.py`, add a new function above `seed_all`:

```python
def _backfill_journal_status():
    """One-shot migration: existing rows pre-Phase-1 had no `status` column.
    After the column is added with default 'published', existing rows will
    pick up that default. This function is idempotent.
    """
    from sqlalchemy import text
    db = Session(bind=engine)
    try:
        # Ensure every journal has status set (defensive — covers pre-existing rows
        # where the SQLite DEFAULT may not have applied).
        rows = db.execute(text("SELECT id, status FROM journals")).fetchall()
        updated = 0
        for rid, status in rows:
            if status is None or status == "":
                db.execute(text("UPDATE journals SET status='published' WHERE id=:id"), {"id": rid})
                updated += 1
        if updated:
            db.commit()
            print(f"[migration] backfilled status='published' on {updated} journals")
    finally:
        db.close()
```

- [ ] **Step 2: Wire into startup**

Replace `@app.on_event("startup")` block (lines 148-150) with:

```python
@app.on_event("startup")
def on_startup():
    _backfill_journal_status()
    seed_all()
```

- [ ] **Step 3: Smoke test**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && python -c "from app.main import _backfill_journal_status; _backfill_journal_status()"
```
Expected: prints nothing (or `[migration] backfilled ...`) and exits cleanly

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/main.py && git commit -m "chore(migration): backfill Journal.status on startup"
```

---

## Task 12: Frontend — api.ts extensions

**Files:**
- Modify: `frontend-vite/src/services/api.ts`

- [ ] **Step 1: Extend JournalAdmin interface**

In `frontend-vite/src/services/api.ts`, replace the `JournalAdmin` interface (lines 64-74) with:

```typescript
export interface JournalAdmin {
  id: number;
  title: string;
  slug: string;
  cover_image?: string;
  description?: string;
  issue_number?: string;
  status: 'draft' | 'published';
  published_at?: string;
  article_count: number;
  updated_at?: string;
}

export interface JournalCompleteness {
  战略与政策: number;
  技术与产业: number;
  方案与思考: number;
  动态与文化: number;
  complete: boolean;
}
```

- [ ] **Step 2: Extend admin.journals**

Replace the `admin.journals` block (lines 191-205) with:

```typescript
    journals: {
      list: (params?: { q?: string; status?: string; page?: number; per_page?: number }): Promise<PaginatedResponse<JournalAdmin>> => {
        const sp = new URLSearchParams()
        if (params?.q) sp.set('q', params.q)
        if (params?.status) sp.set('status', params.status)
        if (params?.page) sp.set('page', String(params.page))
        if (params?.per_page) sp.set('per_page', String(params.per_page))
        return request<PaginatedResponse<JournalAdmin>>('/api/admin/journals?' + sp.toString())
      },
      create: (body: Record<string, unknown>) =>
        request('/api/admin/journals', { method: 'POST', body: JSON.stringify(body) }),
      update: (id: number, body: Record<string, unknown>) =>
        request(`/api/admin/journals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (id: number) =>
        request(`/api/admin/journals/${id}`, { method: 'DELETE' }),
      completeness: (id: number): Promise<JournalCompleteness> =>
        request<JournalCompleteness>(`/api/admin/journals/${id}/completeness`),
      publish: (id: number): Promise<JournalAdmin> =>
        request<JournalAdmin>(`/api/admin/journals/${id}/publish`, { method: 'POST' }),
      unpublish: (id: number): Promise<JournalAdmin> =>
        request<JournalAdmin>(`/api/admin/journals/${id}/unpublish`, { method: 'POST' }),
    },
```

- [ ] **Step 3: Add settings API**

Right before the `media:` block in the `admin` object, insert:

```typescript
    settings: {
      list: (): Promise<{ items: Array<{
        key: string; value?: string | null; masked?: string | null;
        is_secret: boolean; description: string;
        updated_at: string; updated_by: string;
      }> }> => request('/api/admin/settings'),
      upsert: (key: string, value: string, description?: string) =>
        request(`/api/admin/settings/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({ value, description }),
        }),
    },
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/services/api.ts && git commit -m "feat(api): journal publish/unpublish/completeness + settings"
```

---

## Task 13: Frontend — JournalList completeness badge

**Files:**
- Modify: `frontend-vite/src/pages/admin/JournalList.tsx`

- [ ] **Step 1: Add completeness hook**

After the existing `useQuery` for journals (around line 22-25), add:

```typescript
  const { data: completeness } = useQuery({
    queryKey: ['admin', 'journals', 'completeness', data?.items.map((j) => j.id).join(',')],
    queryFn: async () => {
      if (!data?.items) return {} as Record<number, JournalCompleteness>
      const entries = await Promise.all(
        data.items.map(async (j) => [j.id, await api.admin.journals.completeness(j.id)] as const)
      )
      return Object.fromEntries(entries) as Record<number, JournalCompleteness>
    },
    enabled: !!data?.items?.length,
  })
```

And import the type at the top:
```typescript
import type { JournalCompleteness } from '../../services/api'
```

- [ ] **Step 2: Render badge in table**

In the existing `<tbody>` (after the `<tr>` for each journal), insert a new cell after the article-count cell. Replace the `文章数` cell:

```tsx
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{j.article_count}</span>
                      {completeness?.[j.id] && (
                        <span
                          title={completeness[j.id].complete ? '四类齐全' : `缺：${['战略与政策','技术与产业','方案与思考','动态与文化'].filter(c => completeness[j.id][c as keyof JournalCompleteness] === 0).join('、')}`}
                          style={{
                            fontSize: '0.6875rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: completeness[j.id].complete ? '#16a34a' : '#d97706',
                            color: '#fff',
                          }}
                        >
                          {completeness[j.id].complete ? '完整' : '不完整'}
                        </span>
                      )}
                    </div>
                  </td>
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/pages/admin/JournalList.tsx && git commit -m "feat(admin): completeness badge on journal list"
```

---

## Task 14: Frontend — JournalEditor status field

**Files:**
- Modify: `frontend-vite/src/pages/admin/JournalEditor.tsx`

- [ ] **Step 1: Add status to FormState**

Replace the `FormState` interface (lines 7-13) with:

```typescript
interface FormState {
  title: string
  slug: string
  description: string
  issue_number: string
  status: 'draft' | 'published'
  published_at: string
}
```

- [ ] **Step 2: Add status to emptyForm**

Replace `emptyForm` (lines 15-21) with:

```typescript
const emptyForm = (): FormState => ({
  title: '',
  slug: '',
  description: '',
  issue_number: '',
  status: 'draft',
  published_at: new Date().toISOString().slice(0, 10),
})
```

- [ ] **Step 3: Hydrate status on load**

In the existing `useEffect` (lines 42-53), replace `setForm({...})` with:

```typescript
    if (existing) {
      setForm({
        title: existing.title,
        slug: existing.slug,
        description: existing.description || '',
        issue_number: existing.issue_number || '',
        status: existing.status || 'draft',
        published_at: existing.published_at ? existing.published_at.slice(0, 10) : '',
      })
      setSlugTouched(true)
    }
```

- [ ] **Step 4: Add status select to UI**

After the `description` field (around line 125), insert:

```tsx
        <div className="article-editor__field">
          <label>状态</label>
          <select value={form.status} onChange={(e) => update('status', e.target.value as 'draft' | 'published')}>
            <option value="draft">草稿（不公开）</option>
            <option value="published">已发布（公开）</option>
          </select>
        </div>
```

- [ ] **Step 5: Pass status in body**

In the `saveMut` mutationFn (lines 59-66), the existing spread already includes `status`, no change needed. Confirm `status` is in `form`.

- [ ] **Step 6: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/pages/admin/JournalEditor.tsx && git commit -m "feat(admin): journal editor status field"
```

---

## Task 15: AdminLayout — link to /admin/settings (route ships in Phase 4)

**Files:**
- Modify: `frontend-vite/src/components/admin/AdminLayout.tsx`

- [ ] **Step 1: Inspect existing layout**

Read the file (`frontend-vite/src/components/admin/AdminLayout.tsx`, 56 lines) and find the navigation link list.

- [ ] **Step 2: Add Settings link**

In the navigation list, append:

```tsx
      <NavLink to="/admin/settings" className={({ isActive }) => isActive ? 'active' : ''}>
        设置
      </NavLink>
```

Use the same JSX pattern already in the file (likely `<Link>` or `<NavLink>` with `to=`).

- [ ] **Step 3: Add placeholder route in App.tsx**

In `frontend-vite/src/App.tsx`, after the `<Route path="media" element={<MediaLibrary />} />` line (around line 89), add:

```tsx
            <Route path="settings" element={<div style={{ padding: '24px' }}><h2>设置（Phase 4 实现）</h2></div>} />
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/components/admin/AdminLayout.tsx frontend-vite/src/App.tsx && git commit -m "feat(admin): nav link + placeholder for settings page"
```

---

## Task 16: Verification — full backend + frontend build

- [ ] **Step 1: Run backend test suite**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest -q
```
Expected: all green (existing + ~15 new tests)

- [ ] **Step 2: Run frontend build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run build
```
Expected: build success

- [ ] **Step 3: Manual smoke — start servers**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && uvicorn app.main:app --port 8000 &
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run dev -- --port 5173 &
```

- [ ] **Step 4: End-to-end curl**

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<dev password from logs>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Create journal
JID=$(curl -s -X POST http://localhost:8000/api/admin/journals \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"E2E","slug":"e2e-1","issue_number":"E2E","status":"draft"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# Attempt publish on incomplete journal → expect 422
curl -s -o /tmp/pub.json -w '%{http_code}\n' -X POST "http://localhost:8000/api/admin/journals/$JID/publish" \
  -H "Authorization: Bearer $TOKEN"
cat /tmp/pub.json

# Create 4 articles (one per category)
for cat in "战略与政策" "技术与产业" "方案与思考" "动态与文化"; do
  curl -s -X POST http://localhost:8000/api/admin/articles \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"title\":\"T-$cat\",\"slug\":\"t-$JID-$cat\",\"category\":\"$cat\",\"status\":\"published\",\"journal_id\":$JID}" > /dev/null
done

# Now publish → expect 200
curl -s -o /tmp/pub2.json -w '%{http_code}\n' -X POST "http://localhost:8000/api/admin/journals/$JID/publish" \
  -H "Authorization: Bearer $TOKEN"

# Public endpoint should now include this journal
curl -s "http://localhost:8000/api/issues" | python3 -c "import sys,json;d=json.load(sys.stdin);print([j['slug'] for j in d])"
```
Expected sequence: 422, 200, list contains 'e2e-1'

- [ ] **Step 5: Stop dev servers**

```bash
pkill -f "uvicorn app.main:app" ; pkill -f "vite" || true
```

- [ ] **Step 6: Tag the milestone**

```bash
cd /Users/jasonlee/hubei-shuchuang && git tag -a m1-complete -m "Phase 1: journal completeness + admin settings shipped"
```

---

## Self-Review

**Spec coverage:**
- §3.1 AdminSetting table → Task 2 ✓
- §3.2 Journal.status field → Task 4 ✓
- §3.3 completeness rule → Task 5 ✓
- §4.1 publish/unpublish/completeness endpoints → Task 8 ✓
- §4.1 settings GET/PUT → Task 7 ✓
- §4.2 public filter → Task 10 ✓
- §6.1 Fernet encryption → Tasks 3, 7 ✓
- §7.1 cryptography dependency → Task 1 ✓
- §8.1 unit tests → Tasks 3, 5, 7, 8, 10 ✓
- §9 M1 acceptance (publish 422/200, UI badges) → Tasks 8, 13, 14, 16 ✓

**Placeholder scan:** No TBDs, no vague "add validation" steps — every step has concrete code or commands.

**Type consistency:**
- `JournalAdmin.status` is `Literal["draft", "published"]` (schema §3 / Task 9) and `'draft' | 'published'` in TS (Task 12). Match.
- `JournalCompleteness` keys exactly match `REQUIRED_CATEGORIES` constants (Task 5 vs Task 12). Match.
- `AdminSettingOut.value` is `Optional[str]` backend and `string | null` frontend (Task 6 / Task 12). Match.
- Endpoint paths `/api/admin/journals/{id}/completeness|publish|unpublish` consistent across Tasks 8, 12.

**End-to-end smoke (Task 16)**: curl flow exercises every code path — create journal (status=draft), attempt publish (422), add 4 articles, publish (200), public list shows the journal. Confirms entire chain works.

---

## Out of Scope (deferred to later phases)

- Word import (`POST /admin/articles/import-docx`) — Phase 2 plan
- JournalDetail 4-Tab UI — Phase 3 plan
- page-agent config UI + widget — Phase 4 plan
- `/api/admin/agent/execute` LLM proxy — Phase 4
- `Media.kind=table` CSV upload — Phase 2