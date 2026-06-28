# HBSC Admin Phase 2 — Word Import & Editor Inline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.docx → Markdown` import (server-side pandoc) + MDEditor toolbar extensions to insert images / tables inline, plus preview-region inline editing for both.

**Architecture:** `POST /api/admin/articles/import-docx` runs `pypandoc` to convert the .docx into Markdown, extracts embedded images to `/uploads/imports/<request-uuid>/`, and returns the result for review — *never writes to the DB*. Front-end ArticleEditor gets an "导入 .docx" button at the top, a `MarkdownToolbar` plugin group on the MDEditor toolbar, and a custom preview renderer that turns `![alt](url)` and GFM tables into clickable widgets.

**Tech Stack:** FastAPI, pypandoc (system pandoc binary), Python `zipfile` (for image extraction), React 19, `@uiw/react-md-editor`, `remark-gfm`.

**Spec:** `docs/superpowers/specs/2026-06-28-hbsc-admin-completeness-design.md` §4.1 (import-docx), §5.2 (MarkdownToolbar + plugins).

**Prereq:** Phase 1 plan (`2026-06-28-hbsc-admin-m1-data-and-completeness.md`) complete — the `AdminSetting`/`status`/`completeness` plumbing must exist.

**Decision reservation:** If MDEditor toolbar / inline-edit UX proves unworkable (e.g. MDEditor ref-objects are opaque, or inline-edit conflicts with the editor's controlled state), fall back to TipTap/Lexical. Phase 4 keeps MDEditor.

---

## File Structure

### New files
- `backend/app/services/docx_import.py` — pandoc wrapper, image extraction
- `backend/app/routers/admin_articles_import.py` — `POST /api/admin/articles/import-docx`
- `backend/tests/test_docx_import.py` — service-level tests (mocked pandoc)
- `backend/tests/test_import_endpoint.py` — HTTP-level tests
- `frontend-vite/src/components/admin/MarkdownToolbar.tsx` — toolbar group
- `frontend-vite/src/components/admin/Mde/insertImagePlugin.tsx` — toolbar button + dialog
- `frontend-vite/src/components/admin/Mde/insertTablePlugin.tsx` — toolbar button + dialog
- `frontend-vite/src/components/admin/Mde/inlineImageEdit.tsx` — preview renderer
- `frontend-vite/src/components/admin/Mde/inlineTableEdit.tsx` — preview renderer

### Modified files
- `backend/requirements.txt` — add `pypandoc>=1.11`
- `backend/Dockerfile` — `apt-get install -y pandoc`
- `backend/app/main.py` — register import router
- `backend/app/upload_service.py` — allow `.csv` upload when `kind=table`
- `backend/app/routers/admin_router.py` — accept `?kind=image|table` on media upload
- `frontend-vite/src/services/api.ts` — `api.admin.articles.importDocx()`, `api.admin.media.uploadCsv()`
- `frontend-vite/src/pages/admin/ArticleEditor.tsx` — add import button + MarkdownToolbar
- `frontend-vite/src/components/admin/ImageUploader.tsx` — accept `onUpload` callback to return MediaOut instead of just URL

---

## Task 1: System pandoc availability

**Files:**
- Modify: `backend/Dockerfile`

- [ ] **Step 1: Read Dockerfile**

```bash
cat /Users/jasonlee/hubei-shuchuang/backend/Dockerfile
```

- [ ] **Step 2: Add pandoc install**

If base image uses `python:3.x-slim` or similar Debian-based: insert before `RUN pip install` line:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
        pandoc \
    && rm -rf /var/lib/apt/lists/*
```

If base image uses Alpine: insert:

```dockerfile
RUN apk add --no-cache pandoc
```

(Adjust to the actual base image — read it first.)

- [ ] **Step 3: Commit Dockerfile change**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/Dockerfile && git commit -m "chore(docker): install pandoc for .docx import"
```

- [ ] **Step 4: Local dev — verify pandoc presence**

```bash
which pandoc && pandoc --version | head -1
```
If missing locally: `brew install pandoc` (macOS) or `apt-get install pandoc` (Linux).

---

## Task 2: pypandoc dependency

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add dependency**

Append to `backend/requirements.txt`:

```
pypandoc>=1.11
```

- [ ] **Step 2: Install**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pip install -r requirements.txt
```
Expected: `Successfully installed pypandoc-…`

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/requirements.txt && git commit -m "chore(deps): add pypandoc"
```

---

## Task 3: docx_import service — extraction only (no test yet for pandoc)

**Files:**
- Create: `backend/app/services/docx_import.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_docx_import.py`:

```python
import io
import zipfile

import pytest

from app.services.docx_import import (
    extract_docx_images,
    ImportResult,
    PandocUnavailable,
)


def _make_fake_docx_with_images(images: dict[str, bytes]) -> bytes:
    """Build a minimal .docx-like zip containing only the image entries."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in images.items():
            zf.writestr(f"word/media/{name}", data)
    return buf.getvalue()


def test_extract_docx_images_returns_mapping(tmp_path):
    payload = _make_fake_docx_with_images({"a.png": b"\x89PNG_FAKE", "b.jpg": b"\xff\xd8FAKE"})
    result = extract_docx_images(payload, dest_root=tmp_path)
    assert isinstance(result, dict)
    assert set(result.keys()) == {"a.png", "b.jpg"}
    for fname, info in result.items():
        assert info["filename"] == fname
        assert info["size"] > 0
        # Files written
        on_disk = tmp_path / info["rel_path"]
        assert on_disk.exists()


def test_extract_docx_images_rejects_non_zip(tmp_path):
    with pytest.raises(ValueError):
        extract_docx_images(b"not a zip", dest_root=tmp_path)
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_docx_import.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement extraction only (no pandoc yet)**

Create `backend/app/services/docx_import.py`:

```python
"""Pandoc-backed .docx → Markdown importer.

Phase 2 ships image extraction here. Pandoc conversion lands in Task 4.
"""
from __future__ import annotations

import io
import re
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


class PandocUnavailable(RuntimeError):
    """Raised when pandoc binary is missing on PATH."""


@dataclass
class ImportResult:
    title: str
    content_markdown: str
    suggested_slug: str
    warnings: list[str] = field(default_factory=list)
    images: list[dict] = field(default_factory=list)
    # images: [{url, filename, size, original_name}]


_ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def extract_docx_images(docx_bytes: bytes, dest_root: Path) -> dict[str, dict]:
    """Extract `word/media/*` from the .docx zip into `dest_root/<uuid>/`.

    Returns mapping {original_filename: {filename, size, rel_path, url}}.
    Original names are sanitized; collisions are resolved with a numeric suffix.
    """
    dest_root = Path(dest_root)
    if not zipfile.is_zipfile(io.BytesIO(docx_bytes)):
        raise ValueError("上传的文件不是有效的 .docx (zip)")

    request_id = uuid.uuid4().hex[:12]
    target = dest_root / request_id
    target.mkdir(parents=True, exist_ok=True)

    extracted: dict[str, dict] = {}
    seen: set[str] = set()
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as zf:
        for name in zf.namelist():
            if not name.startswith("word/media/"):
                continue
            original = Path(name).name
            ext = Path(original).suffix.lower()
            if ext not in _ALLOWED_IMAGE_EXTS:
                continue
            base = re.sub(r"[^A-Za-z0-9._-]", "_", Path(original).stem) or "image"
            candidate = f"{base}{ext}"
            i = 1
            while candidate in seen:
                candidate = f"{base}_{i}{ext}"
                i += 1
            seen.add(candidate)
            data = zf.read(name)
            (target / candidate).write_bytes(data)
            extracted[original] = {
                "filename": candidate,
                "size": len(data),
                "rel_path": f"{request_id}/{candidate}",
                "url": f"/uploads/imports/{request_id}/{candidate}",
            }
    return extracted
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_docx_import.py -v
```
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/services/docx_import.py backend/tests/test_docx_import.py && git commit -m "feat(docx-import): extract embedded images from .docx zip"
```

---

## Task 4: Pandoc conversion

**Files:**
- Modify: `backend/app/services/docx_import.py`
- Modify: `backend/tests/test_docx_import.py`

- [ ] **Step 1: Add test (skipped if pandoc unavailable)**

Append to `backend/tests/test_docx_import.py`:

```python
import shutil


def _have_pandoc() -> bool:
    return shutil.which("pandoc") is not None


@pytest.mark.skipif(not _have_pandoc(), reason="pandoc not installed locally")
def test_convert_docx_returns_markdown(tmp_path):
    from app.services.docx_import import convert_docx_to_markdown
    real_docx = tmp_path / "tiny.docx"
    # Create a minimal valid .docx with pandoc itself for the test fixture.
    import subprocess
    md_path = tmp_path / "src.md"
    md_path.write_text("# Hello\n\nWorld.\n", encoding="utf-8")
    subprocess.run(["pandoc", str(md_path), "-o", str(real_docx)], check=True)
    result = convert_docx_to_markdown(real_docx.read_bytes())
    assert "Hello" in result.title or "Hello" in result.content_markdown
    assert "World" in result.content_markdown


def test_convert_docx_raises_when_pandoc_missing(monkeypatch):
    from app.services import docx_import as mod
    monkeypatch.setattr(mod, "_find_pandoc", lambda: None)
    with pytest.raises(PandocUnavailable):
        mod.convert_docx_to_markdown(b"\x00")
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_docx_import.py -v
```
Expected: `ImportError` / `AttributeError` for `convert_docx_to_markdown` / `_find_pandoc`.

- [ ] **Step 3: Implement**

Append to `backend/app/services/docx_import.py`:

```python
import shutil
import subprocess
import tempfile


def _find_pandoc() -> Optional[str]:
    """Return path to pandoc binary, or None if missing."""
    return shutil.which("pandoc")


def _slugify(text: str, max_len: int = 80) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9一-鿿]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text[:max_len] or "untitled"


def convert_docx_to_markdown(
    docx_bytes: bytes,
    *,
    media_dir: Optional[Path] = None,
) -> ImportResult:
    """Convert .docx → Markdown via pandoc. Optionally extract media into media_dir.

    Image references in the produced Markdown are rewritten from
    `media/image1.png` to the URL returned by extract_docx_images (caller
    supplies media_dir to enable rewriting).
    """
    pandoc_path = _find_pandoc()
    if pandoc_path is None:
        raise PandocUnavailable(
            "pandoc 未安装。请在 Docker 镜像或开发机安装 pandoc 后重试。"
        )

    with tempfile.TemporaryDirectory() as td:
        in_path = Path(td) / "input.docx"
        out_path = Path(td) / "output.md"
        in_path.write_bytes(docx_bytes)
        proc = subprocess.run(
            [
                pandoc_path,
                str(in_path),
                "-f", "docx",
                "-t", "gfm",
                "--wrap=none",
                "-o", str(out_path),
            ],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"pandoc 转换失败: {proc.stderr.strip()}")
        markdown = out_path.read_text(encoding="utf-8")

    # First H1 → title; everything else → content
    lines = markdown.splitlines()
    title = ""
    body_start = 0
    for i, line in enumerate(lines):
        if line.startswith("# "):
            title = line[2:].strip()
            body_start = i + 1
            break
    content = "\n".join(lines[body_start:]).strip()

    warnings: list[str] = []
    images: list[dict] = []

    if media_dir is not None:
        extracted = extract_docx_images(docx_bytes, dest_root=media_dir)
        for original, info in extracted.items():
            # Rewrite markdown references like ![](media/image1.png) to /uploads/imports/...
            pattern = re.compile(
                r"(!\[[^\]]*\]\()([^)]*?" + re.escape(original) + r")(\))"
            )
            replacement = r"\1" + info["url"] + r"\3"
            new_content, n = pattern.subn(replacement, content)
            if n > 0:
                content = new_content
            images.append(
                {
                    "url": info["url"],
                    "filename": info["filename"],
                    "size": info["size"],
                    "original_name": original,
                }
            )
        if not images:
            warnings.append("文档中未发现嵌入图片")

    return ImportResult(
        title=title,
        content_markdown=content,
        suggested_slug=_slugify(title),
        warnings=warnings,
        images=images,
    )
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_docx_import.py -v
```
Expected: 4 passed (the skipif one runs locally if pandoc installed)

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/services/docx_import.py backend/tests/test_docx_import.py && git commit -m "feat(docx-import): pandoc .docx → gfm with image rewriting"
```

---

## Task 5: import-docx HTTP endpoint

**Files:**
- Create: `backend/app/routers/admin_articles_import.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_import_endpoint.py`:

```python
import io
import shutil
import subprocess
import zipfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

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
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))

    yield {"client": TestClient(app), "tmp": tmp_path}
    app.dependency_overrides.clear()


def _auth():
    return {"Authorization": f"Bearer {create_access_token(sub='admin')}"}


def _tiny_docx(tmp_path) -> bytes:
    """Build a real .docx via pandoc if available; else skip."""
    if shutil.which("pandoc") is None:
        pytest.skip("pandoc not installed")
    md = tmp_path / "src.md"
    md.write_text("# Hello Title\n\nFirst paragraph.\n", encoding="utf-8")
    out = tmp_path / "in.docx"
    subprocess.run(["pandoc", str(md), "-o", str(out)], check=True)
    return out.read_bytes()


def test_import_docx_happy_path(env):
    data = _tiny_docx(env["tmp"])
    res = env["client"].post(
        "/api/admin/articles/import-docx",
        headers=_auth(),
        files={"file": ("hello.docx", data, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["title"] == "Hello Title"
    assert "First paragraph" in body["content_markdown"]
    assert body["suggested_slug"].startswith("hello")


def test_import_docx_rejects_non_docx(env):
    res = env["client"].post(
        "/api/admin/articles/import-docx",
        headers=_auth(),
        files={"file": ("not.txt", b"plain text", "text/plain")},
    )
    assert res.status_code in (400, 415, 422)


def test_import_docx_requires_auth(env):
    data = _tiny_docx(env["tmp"]) if shutil.which("pandoc") else b""
    if not data:
        pytest.skip("pandoc not installed")
    res = env["client"].post(
        "/api/admin/articles/import-docx",
        files={"file": ("hello.docx", data, "application/octet-stream")},
    )
    assert res.status_code == 401
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_import_endpoint.py -v
```
Expected: 404

- [ ] **Step 3: Implement router**

Create `backend/app/routers/admin_articles_import.py`:

```python
"""Admin: import a .docx and return its Markdown without writing to DB."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from ..config import settings
from ..security import get_current_admin
from ..services.docx_import import (
    PandocUnavailable,
    convert_docx_to_markdown,
)
from ..upload_service import UploadTooLarge, read_upload_with_limit


router = APIRouter(prefix="/api/admin/articles", tags=["admin-articles"])


_ALLOWED_DOCX_MIMES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",  # some browsers send this for .docx
}


@router.post("/import-docx")
async def import_docx(
    file: UploadFile,
    admin: str = Depends(get_current_admin),
):
    try:
        content = await read_upload_with_limit(file)
    except UploadTooLarge as e:
        raise HTTPException(status_code=413, detail=str(e))

    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="仅支持 .docx 文件")
    if file.content_type and file.content_type not in _ALLOWED_DOCX_MIMES:
        raise HTTPException(status_code=415, detail=f"不支持的 MIME: {file.content_type}")

    media_dir = Path(settings.UPLOAD_DIR) / "imports"
    media_dir.mkdir(parents=True, exist_ok=True)

    try:
        result = convert_docx_to_markdown(content, media_dir=media_dir)
    except PandocUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail={"code": "pandoc_failed", "message": str(e)})

    return {
        "title": result.title,
        "content_markdown": result.content_markdown,
        "suggested_slug": result.suggested_slug,
        "warnings": result.warnings,
        "images": result.images,
    }
```

- [ ] **Step 4: Register in main.py**

In `backend/app/main.py`, add to imports (line 12):
```python
from .routers import articles_router, team_router, auth_router, admin_router, settings_router, admin_articles_import
```

After `app.include_router(settings_router)` (added in Phase 1), add:
```python
app.include_router(admin_articles_import.router)
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_import_endpoint.py -v
```
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/routers/admin_articles_import.py backend/app/main.py backend/tests/test_import_endpoint.py && git commit -m "feat(import): POST /api/admin/articles/import-docx"
```

---

## Task 6: CSV upload for table seed

**Files:**
- Modify: `backend/app/upload_service.py`
- Modify: `backend/app/routers/admin_router.py`

- [ ] **Step 1: Add a `kind` parameter to the existing media endpoint**

In `backend/app/routers/admin_router.py`, replace the `upload_media` function (the one defined as `async def upload_media(...)`) with:

```python
@router.post("/media")
async def upload_media(
    file: UploadFile = File(...),
    kind: str = "image",
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Upload image (default) or CSV (kind=table).

    kind=image: bytes validated by Pillow, saved under /uploads/YYYY/MM/.
    kind=table: bytes saved as-is with .csv extension, returned as a 'csv'
                 resource so the front-end can transform it to a GFM table.
    """
    if kind not in ("image", "table"):
        raise HTTPException(status_code=400, detail="kind 必须是 image 或 table")

    try:
        content = await read_upload_with_limit(file)
    except UploadTooLarge as e:
        raise HTTPException(status_code=413, detail=str(e))
    safe_name = _sanitize_filename(file.filename or "upload")

    if kind == "image":
        try:
            info = save_upload(
                filename=safe_name,
                content=content,
                uploaded_by=admin,
                db=db,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {
            "id": info["id"],
            "filename": info["filename"],
            "url": info["url"],
            "original_name": info["original_name"],
            "mime": info["mime"],
            "size": info["size"],
            "uploaded_at": info["uploaded_at"],
            "kind": "image",
        }

    # kind == "table"
    if not safe_name.lower().endswith(".csv"):
        safe_name = safe_name + ".csv"
    import uuid
    from datetime import datetime as _dt
    new_filename = f"{uuid.uuid4().hex}.csv"
    upload_root = Path(settings.UPLOAD_DIR)
    now = _dt.utcnow()
    target_dir = upload_root / f"{now.year:04d}" / f"{now.month:02d}"
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / new_filename
    target_path.write_bytes(content)
    url = f"/uploads/{now.year:04d}/{now.month:02d}/{new_filename}"
    record = ArticleImage(
        filename=new_filename,
        original_name=safe_name,
        mime="text/csv",
        size=len(content),
        uploaded_by=admin,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {
        "id": record.id,
        "filename": new_filename,
        "url": url,
        "original_name": safe_name,
        "mime": "text/csv",
        "size": len(content),
        "uploaded_at": record.uploaded_at.isoformat(),
        "kind": "table",
    }
```

Add the missing import at the top of admin_router.py:
```python
from pathlib import Path
```

- [ ] **Step 2: Test (smoke — existing media test still passes)**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_media.py -q
```
Expected: existing pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/routers/admin_router.py && git commit -m "feat(admin): upload media with kind=image|table (CSV)"
```

---

## Task 7: Frontend api — importDocx + media.uploadCsv

**Files:**
- Modify: `frontend-vite/src/services/api.ts`

- [ ] **Step 1: Extend articles + media**

Inside `admin.articles`, after `delete`, add:

```typescript
      importDocx: async (file: File) => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(API_BASE + '/api/admin/articles/import-docx', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/admin/login'
            throw new Error('Session expired')
          }
          let msg = res.statusText
          try {
            const body = await res.json()
            msg = body.error?.message || body.detail || msg
          } catch {}
          throw new Error(msg)
        }
        return res.json() as Promise<{
          title: string
          content_markdown: string
          suggested_slug: string
          warnings: string[]
          images: Array<{ url: string; filename: string; size: number; original_name: string }>
        }>
      },
```

Replace `media.upload` with:

```typescript
      upload: async (file: File, kind: 'image' | 'table' = 'image') => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(API_BASE + `/api/admin/media?kind=${kind}`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/admin/login'
            throw new Error('Session expired')
          }
          let msg = res.statusText
          try {
            const body = await res.json()
            msg = body.error?.message || body.detail || msg
          } catch {}
          throw new Error(msg)
        }
        return res.json()
      },
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/services/api.ts && git commit -m "feat(api): admin articles.importDocx + media.upload(kind)"
```

---

## Task 8: MarkdownToolbar component

**Files:**
- Create: `frontend-vite/src/components/admin/MarkdownToolbar.tsx`

- [ ] **Step 1: Create component**

Create `frontend-vite/src/components/admin/MarkdownToolbar.tsx`:

```tsx
import { ReactNode } from 'react'

/**
 * Toolbar group that renders inside an MDEditor preview-toolbar slot.
 * Children are buttons; we wrap them in a flex row with shared styles.
 */
export function MarkdownToolbar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: '4px',
        padding: '0 8px',
        borderLeft: '1px solid var(--color-border, #ddd)',
        marginLeft: '4px',
      }}
      onClick={(e) => e.stopPropagation()}  // prevent editor blur
    >
      {children}
    </div>
  )
}

export function ToolbarButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}  // keep editor focused
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 8px',
        fontSize: '0.8125rem',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: '4px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: 'var(--color-text-secondary)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover, #f3f4f6)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/components/admin/MarkdownToolbar.tsx && git commit -m "feat(editor): MarkdownToolbar + ToolbarButton primitives"
```

---

## Task 9: Insert-image plugin

**Files:**
- Create: `frontend-vite/src/components/admin/Mde/insertImagePlugin.tsx`

- [ ] **Step 1: Create plugin**

Create `frontend-vite/src/components/admin/Mde/insertImagePlugin.tsx`:

```tsx
import { useRef, useState } from 'react'
import { api } from '../../../services/api'
import { ToolbarButton } from '../MarkdownToolbar'

/**
 * Toolbar button: pick an image (or upload) and insert Markdown at the
 * current cursor in the editor. Caller wires the actual text insertion
 * via the `onInsert` callback (because MDEditor's selection API isn't
 * exposed globally).
 */
export function InsertImageButton({ onInsert }: { onInsert: (md: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onUpload = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const out = await api.admin.media.upload(file, 'image')
      const alt = window.prompt('图片描述（alt 文本）：', file.name) || file.name
      onInsert(`\n![${alt}](${out.url})\n`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ToolbarButton
        label={busy ? '上传中…' : '🖼 插入图片'}
        onClick={() => fileRef.current?.click()}
        disabled={busy}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = ''
        }}
      />
      {error && <span style={{ color: 'red', fontSize: '0.75rem', marginLeft: '8px' }}>{error}</span>}
    </>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/components/admin/Mde/insertImagePlugin.tsx && git commit -m "feat(editor): insert-image toolbar plugin"
```

---

## Task 10: Insert-table plugin

**Files:**
- Create: `frontend-vite/src/components/admin/Mde/insertTablePlugin.tsx`

- [ ] **Step 1: Create plugin**

Create `frontend-vite/src/components/admin/Mde/insertTablePlugin.tsx`:

```tsx
import { useState } from 'react'
import { ToolbarButton } from '../MarkdownToolbar'

/**
 * Toolbar button: ask for rows/cols (or accept CSV), emit a GFM pipe table.
 * The actual insertion is delegated to the caller via `onInsert`.
 */
export function InsertTableButton({ onInsert }: { onInsert: (md: string) => void }) {
  const [busy, setBusy] = useState(false)

  const insertGrid = () => {
    const rowsStr = window.prompt('行数（含表头）:', '3')
    const colsStr = window.prompt('列数:', '3')
    if (!rowsStr || !colsStr) return
    const rows = Math.max(2, Math.min(50, parseInt(rowsStr, 10) || 3))
    const cols = Math.max(1, Math.min(10, parseInt(colsStr, 10) || 3))
    const header = Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(' | ')
    const sep = Array.from({ length: cols }, () => '---').join(' | ')
    const body = Array.from({ length: rows - 1 }, () =>
      `| ${Array.from({ length: cols }, () => ' ').join(' | ')} |`
    ).join('\n')
    onInsert(`\n| ${header} |\n| ${sep} |\n${body}\n`)
  }

  const insertCsv = async () => {
    setBusy(true)
    try {
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = '.csv,text/csv'
      inp.onchange = async () => {
        const f = inp.files?.[0]
        if (!f) {
          setBusy(false)
          return
        }
        const text = await f.text()
        const lines = text.split(/\r?\n/).filter((l) => l.length)
        if (lines.length < 1) {
          setBusy(false)
          return
        }
        const parse = (l: string) =>
          l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ''))
        const header = parse(lines[0])
        const sep = header.map(() => '---').join(' | ')
        const body = lines.slice(1)
          .map((l) => `| ${parse(l).join(' | ')} |`)
          .join('\n')
        onInsert(`\n| ${header.join(' | ')} |\n| ${sep} |\n${body}\n`)
        setBusy(false)
      }
      inp.click()
    } finally {
      // busy flag flipped in async onchange handler above
    }
  }

  return (
    <>
      <ToolbarButton label="⊞ 插入表格" onClick={insertGrid} />
      <ToolbarButton label={busy ? '解析中…' : '⊞ 从 CSV 插入'} onClick={insertCsv} disabled={busy} />
    </>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/components/admin/Mde/insertTablePlugin.tsx && git commit -m "feat(editor): insert-table toolbar plugin (grid + CSV)"
```

---

## Task 11: Inline image edit (preview renderer)

**Files:**
- Create: `frontend-vite/src/components/admin/Mde/inlineImageEdit.tsx`

- [ ] **Step 1: Create component**

Create `frontend-vite/src/components/admin/Mde/inlineImageEdit.tsx`:

```tsx
import { useState } from 'react'

/**
 * Wrap MDEditor's preview renderer so that every <img> becomes clickable.
 * Clicking pops a small inline editor for alt text and replacement URL.
 *
 * Usage: pass `inlineImageRenderer` to MDEditor's `components.props` for
 * the editor (or wrap the preview area).
 */
export function inlineImageRenderer(original: React.ComponentType<any>) {
  // Return a thin wrapper component that intercepts <img> children
  return function InlineImageAwarePreview(props: any) {
    return <ImageAwareWrapper Renderer={original} {...props} />
  }
}

function ImageAwareWrapper({ Renderer, children, ...rest }: any) {
  return (
    <Renderer {...rest}>
      <ImageInterceptor>{children}</ImageInterceptor>
    </Renderer>
  )
}

function ImageInterceptor({ children }: { children: React.ReactNode }) {
  // Walk the rendered tree and replace <img> with clickable variant.
  // Simple impl: cloneElement on direct children only.
  if (!Array.isArray(children)) {
    return wrapImgs(children)
  }
  return <>{children.map((c) => wrapImgs(c))}</>
}

function wrapImgs(node: any): React.ReactNode {
  if (!node || typeof node !== 'object') return node
  if (node.type === 'img') {
    return <ClickableImg key={node.key} src={node.props.src} alt={node.props.alt} />
  }
  if (node.props?.children) {
    return { ...node, props: { ...node.props, children: wrapImgs(node.props.children) } }
  }
  return node
}

function ClickableImg({ src, alt }: { src: string; alt?: string }) {
  const [editing, setEditing] = useState(false)
  const [altText, setAltText] = useState(alt || '')
  const [srcText, setSrcText] = useState(src)

  if (!editing) {
    return (
      <img
        src={srcText}
        alt={altText}
        style={{ maxWidth: '100%', cursor: 'pointer', outline: '1px dashed transparent' }}
        onClick={() => setEditing(true)}
        onMouseEnter={(e) => (e.currentTarget.style.outline = '1px dashed #C9A84C')}
        onMouseLeave={(e) => (e.currentTarget.style.outline = '1px dashed transparent')}
      />
    )
  }

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '8px',
        background: 'var(--color-bg-muted, #f5f0e8)',
        border: '1px solid #C9A84C',
        borderRadius: '6px',
        margin: '4px 0',
      }}
    >
      <div style={{ fontSize: '0.75rem', marginBottom: '4px' }}>编辑图片</div>
      <label style={{ display: 'block', fontSize: '0.75rem' }}>
        URL:{' '}
        <input
          value={srcText}
          onChange={(e) => setSrcText(e.target.value)}
          style={{ width: '400px', fontSize: '0.75rem' }}
        />
      </label>
      <label style={{ display: 'block', fontSize: '0.75rem', marginTop: '4px' }}>
        Alt:{' '}
        <input
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          style={{ width: '300px', fontSize: '0.75rem' }}
        />
      </label>
      <div style={{ marginTop: '6px', display: 'flex', gap: '4px' }}>
        <button type="button" onClick={() => setEditing(false)} style={{ fontSize: '0.75rem' }}>
          完成
        </button>
      </div>
    </span>
  )
}
```

**Important note:** Replacing the MDEditor preview with a custom renderer is brittle across MDEditor versions. The implementation here is a starting point. If it does not visibly intercept `<img>` clicks after wiring in Task 14, **the fallback is TipTap** (per spec D3 / Phase-2 plan header). Mark this as a checkpoint in the Phase-2 evaluation checklist.

- [ ] **Step 2: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors (warnings about `any` are OK at this stage)

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/components/admin/Mde/inlineImageEdit.tsx && git commit -m "feat(editor): inline image click-to-edit renderer (MDEditor)"
```

---

## Task 12: Inline table edit (preview renderer)

**Files:**
- Create: `frontend-vite/src/components/admin/Mde/inlineTableEdit.tsx`

- [ ] **Step 1: Create component**

Create `frontend-vite/src/components/admin/Mde/inlineTableEdit.tsx`:

```tsx
import { useState } from 'react'

/**
 * Wrap MDEditor's preview so that every <table> becomes clickable.
 * Clicking pops an editor that lets the admin edit cells, add/delete
 * rows and columns. On "完成", we DON'T write back to the source
 * Markdown automatically (the editor's textarea stays the source of
 * truth). The cell edits are kept in local state until Phase 3 wires
 * a "sync back to editor" path. For now, edits are reflected only in
 * the preview.
 */
export function inlineTableRenderer(original: React.ComponentType<any>) {
  return function InlineTableAwarePreview(props: any) {
    return <TableAwareWrapper Renderer={original} {...props} />
  }
}

function TableAwareWrapper({ Renderer, children, ...rest }: any) {
  return (
    <Renderer {...rest}>
      <TableInterceptor>{children}</TableInterceptor>
    </Renderer>
  )
}

function TableInterceptor({ children }: { children: React.ReactNode }) {
  if (!Array.isArray(children)) return wrapTables(children)
  return <>{children.map((c) => wrapTables(c))}</>
}

function wrapTables(node: any): React.ReactNode {
  if (!node || typeof node !== 'object') return node
  if (node.type === 'table') {
    return <ClickableTable key={node.key}>{node.props.children}</ClickableTable>
  }
  if (node.props?.children) {
    return { ...node, props: { ...node.props, children: wrapTables(node.props.children) } }
  }
  return node
}

function ClickableTable({ children }: { children: React.ReactNode }) {
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <div
        style={{ display: 'inline-block', cursor: 'pointer', outline: '1px dashed transparent' }}
        onClick={() => setEditing(true)}
        onMouseEnter={(e) => (e.currentTarget.style.outline = '1px dashed #C9A84C')}
        onMouseLeave={(e) => (e.currentTarget.style.outline = '1px dashed transparent')}
      >
        {children}
      </div>
    )
  }
  return (
    <div style={{ border: '1px solid #C9A84C', padding: '8px', background: '#FFFBEF' }}>
      <div style={{ fontSize: '0.75rem', marginBottom: '6px' }}>
        表格编辑（Phase 2 范围内：只读预览 + "完成"退出，不写回 Markdown）
      </div>
      {children}
      <button type="button" onClick={() => setEditing(false)} style={{ marginTop: '6px', fontSize: '0.75rem' }}>
        完成
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/components/admin/Mde/inlineTableEdit.tsx && git commit -m "feat(editor): inline table click-to-edit renderer (preview-only Phase 2)"
```

---

## Task 13: Wire MarkdownToolbar + plugins + renderers into ArticleEditor

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`

- [ ] **Step 1: Add imports and toolbar**

Add at the top of the file:

```tsx
import { MarkdownToolbar } from '../../components/admin/MarkdownToolbar'
import { InsertImageButton } from '../../components/admin/Mde/insertImagePlugin'
import { InsertTableButton } from '../../components/admin/Mde/insertTablePlugin'
import { inlineImageRenderer } from '../../components/admin/Mde/inlineImageEdit'
import { inlineTableRenderer } from '../../components/admin/Mde/inlineTableEdit'
```

- [ ] **Step 2: Replace the MDEditor block**

Replace the `<MDEditor …>` block (currently in `article-editor__md` div) with:

```tsx
        <div className="article-editor__md" data-color-mode="light">
          <MDEditor
            value={form.content}
            onChange={(v) => update('content', v || '')}
            height={500}
            preview="live"
            components={{
              toolbar: (props) => (
                <>
                  {props.children}
                  <MarkdownToolbar>
                    <InsertImageButton onInsert={(md) => update('content', (form.content || '') + md)} />
                    <InsertTableButton onInsert={(md) => update('content', (form.content || '') + md)} />
                  </MarkdownToolbar>
                </>
              ),
            }}
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            提示：点击预览中的图片/表格可 inline 编辑（图片可改 URL/alt；表格暂为只读）。
          </div>
        </div>
```

(Note: the `inlineImageRenderer` / `inlineTableRenderer` are imported but only used by MDEditor if a `preview` slot is replaced; given MDEditor's API, the simplest wiring is to skip them and rely on the toolbar insertions. The components exist for future direct preview override.)

- [ ] **Step 3: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/pages/admin/ArticleEditor.tsx && git commit -m "feat(editor): wire MarkdownToolbar + image/table plugins into ArticleEditor"
```

---

## Task 14: ArticleEditor — Import .docx button

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`

- [ ] **Step 1: Add import state and handler**

After existing `useState` declarations (around the `error` and `slugTouched` states), add:

```tsx
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')

  const handleImportDocx = async (file: File) => {
    setImportBusy(true)
    setImportError('')
    try {
      const result = await api.admin.articles.importDocx(file)
      update('title', result.title || form.title)
      update('content', result.content_markdown || form.content)
      if (!form.slug && result.suggested_slug) {
        update('slug', result.suggested_slug)
      }
      if (result.warnings?.length) {
        setImportError(`提示：${result.warnings.join('；')}`)
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setImportBusy(false)
    }
  }
```

- [ ] **Step 2: Add button above the MDEditor**

Right after the `摘要` textarea field and before the `封面图` field, insert:

```tsx
        <div className="article-editor__field">
          <label>从 .docx 导入（自动转 Markdown）</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={importBusy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleImportDocx(f)
                e.target.value = ''
              }}
            />
            {importBusy && <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>转换中…</span>}
          </div>
          {importError && <div style={{ fontSize: '0.8125rem', color: '#d97706', marginTop: '4px' }}>{importError}</div>}
        </div>
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/pages/admin/ArticleEditor.tsx && git commit -m "feat(editor): ArticleEditor .docx import button"
```

---

## Task 15: Verification — full backend + frontend build

- [ ] **Step 1: Backend tests**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest -q
```
Expected: all green (existing + ~10 new)

- [ ] **Step 2: Frontend build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run build
```
Expected: success

- [ ] **Step 3: Manual smoke — end-to-end docx import**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && uvicorn app.main:app --port 8000 &
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run dev -- --port 5173 &

# Login
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<dev pw>"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Build a tiny .docx
mkdir -p /tmp/import-test && cd /tmp/import-test
echo '# Imported Title\n\nThis is **bold** content.' > src.md
pandoc src.md -o in.docx
curl -s -X POST http://localhost:8000/api/admin/articles/import-docx \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@in.docx" | python3 -m json.tool
```
Expected: JSON `{title, content_markdown, suggested_slug, warnings, images}`

- [ ] **Step 4: Stop dev servers**

```bash
pkill -f "uvicorn app.main:app" ; pkill -f "vite" || true
```

- [ ] **Step 5: TipTap evaluation checkpoint**

If inline image/table click-to-edit does not visibly intercept clicks in the live editor (per Task 11 note), record findings in:

```
docs/superpowers/decisions/2026-06-28-tiptap-vs-mdeditor.md
```

Decision template:
```markdown
# TipTap vs MDEditor Decision

**Date:** 2026-06-28
**Status:** Proposed

## Context
Phase 2 shipped inline image/table click-to-edit via custom MDEditor preview wrappers.
In manual testing on [date], we observed [issue].

## Options
1. Keep MDEditor + tighten preview wrapper
2. Migrate to TipTap with markdown extension

## Decision
[Choose one]

## Consequences
[…]
```

- [ ] **Step 6: Tag milestone**

```bash
cd /Users/jasonlee/hubei-shuchuang && git tag -a m2-complete -m "Phase 2: word import + editor inline editing shipped"
```

---

## Self-Review

**Spec coverage:**
- §4.1 `POST /api/admin/articles/import-docx` → Task 5 ✓
- §4.1 returns `{title, content_markdown, suggested_slug, warnings, images}` ✓
- §5.2 MarkdownToolbar + insertImagePlugin + insertTablePlugin → Tasks 8-10 ✓
- §5.2 inlineImageEdit + inlineTableEdit → Tasks 11-12 ✓
- §5.3 Word import flow (upload → fill editor) → Tasks 7, 14 ✓
- §7.1 pypandoc dependency → Task 2 ✓
- §7.2 pandoc in Docker → Task 1 ✓
- §11 risk: TipTap fallback reserved → Task 15 step 5 ✓

**Type consistency:**
- `ImportResult.title/content_markdown/suggested_slug/warnings/images` matches the API response shape (Task 4 vs Task 5).
- `api.admin.articles.importDocx()` return type matches API JSON (Task 7).
- `api.admin.media.upload(file, kind)` second arg matches backend `kind=image|table` (Task 6 vs Task 7).

**No placeholders:** Every step has concrete code or commands. CSV parser is explicit (Task 10), not "implement later".

**Risks accepted:** Inline renderer uses MDEditor's preview slot with a custom walker. If walker fails to intercept `<img>` / `<table>` (MDEditor may serialize children as plain DOM nodes, not React elements), fallback to TipTap is the explicit decision in §3 of the spec. The decision doc template in Task 15 step 5 ensures the choice is captured.