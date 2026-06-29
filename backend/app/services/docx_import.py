"""Pandoc-backed .docx → Markdown importer.

Phase 2 ships image extraction here. Pandoc conversion lands in Task 4.
"""
from __future__ import annotations

import io
import re
import shutil
import subprocess
import tempfile
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
