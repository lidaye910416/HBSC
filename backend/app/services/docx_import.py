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
