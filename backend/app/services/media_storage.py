"""Containment-checked, Pillow-validated image storage.

This service is the single entry point for writing user-provided image
bytes under the upload root. Every call:

1. validates the bytes with Pillow (``InvalidImage`` on garbage),
2. resolves the destination path with a containment check
   (``ValueError`` on any traversal/escape),
3. writes atomically via same-filesystem mkstemp → fsync → os.replace,
4. fingerprints the bytes (SHA-256, format, width, height) for the
   `MediaAsset` row.

Filesystem layout:
    ``<uploads_root>/YYYY/MM/<uuid>.<ext>``

The UUID is generated per write — never reused — so concurrent uploads
cannot collide, and the original filename is preserved only as metadata
on the asset row.
"""
from __future__ import annotations

import os
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Literal

from PIL import Image, UnidentifiedImageError


# Format mapping Pillow -> (mime, extension). Pillow's `format` field is
# uppercase ("PNG", "JPEG"); the keys here MUST match exactly. Any image
# whose detected format is outside this map is rejected — we do NOT trust
# the upload filename, since it can be tampered with freely.
FORMAT_MAP: dict[str, tuple[str, str]] = {
    "PNG": ("image/png", ".png"),
    "JPEG": ("image/jpeg", ".jpg"),
    "WEBP": ("image/webp", ".webp"),
    "GIF": ("image/gif", ".gif"),
}


class InvalidImage(ValueError):
    """Raised when the bytes are not a decodable image in an allowed format."""


@dataclass(frozen=True)
class StoredImage:
    storage_path: str
    mime_type: str
    byte_size: int
    width: int
    height: int
    sha256: str


def resolve_inside_uploads(root: Path, storage_path: str) -> Path:
    """Validate ``storage_path`` and return the absolute resolved target.

    Refuses:
      - any absolute path
      - any backslash (Windows separators / smuggling)
      - any empty / ``.`` / ``..`` segment
      - any final path that escapes ``root``
    """
    root = root.resolve()
    pure = PurePosixPath(storage_path)
    if pure.is_absolute():
        raise ValueError("invalid media path")
    if "\\" in storage_path:
        raise ValueError("invalid media path")
    if any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError("invalid media path")
    target = (root / Path(*pure.parts)).resolve()
    # `relative_to` raises ValueError if target is outside root. Use the
    # exception form rather than is_relative_to() for portability with
    # the Python 3.11 baseline.
    target.relative_to(root)
    return target


def _inspect(content: bytes) -> tuple[str, str, int, int]:
    """Return (mime, ext, width, height) for the given image bytes.

    Two Pillow opens are needed: ``verify()`` is destructive (it
    consumes the stream state), so the second ``Image.open`` re-decodes
    to read ``format`` and ``size``. This matches the upstream
    Pillow-documented idiom for safely validating user-uploaded bytes.
    """
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            fmt = (image.format or "").upper()
            width, height = image.size
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImage("invalid image bytes") from exc
    if fmt not in FORMAT_MAP:
        raise InvalidImage("unsupported image format")
    mime, ext = FORMAT_MAP[fmt]
    return mime, ext, width, height


def store_image(
    root: Path,
    original_name: str,
    content: bytes,
    now: datetime | None = None,
) -> StoredImage:
    """Validate + write image bytes under ``root`` atomically.

    Returns the metadata needed to build a ``MediaAsset`` row. The file
    is fsync'd before ``os.replace`` so a crash between the two never
    leaves a torn or truncated file at the final path; on any
    exception the temp file is unlinked.
    """
    mime, ext, width, height = _inspect(content)
    now = now or datetime.utcnow()
    rel_dir = PurePosixPath(f"{now.year:04d}/{now.month:02d}")
    target_dir = resolve_inside_uploads(root, rel_dir.as_posix())
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    target = resolve_inside_uploads(root, (rel_dir / filename).as_posix())
    fd, temp_name = tempfile.mkstemp(prefix=".media-", suffix=".tmp", dir=target_dir)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, target)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise
    return StoredImage(
        storage_path=(rel_dir / filename).as_posix(),
        mime_type=mime,
        byte_size=len(content),
        width=width,
        height=height,
        sha256=sha256(content).hexdigest(),
    )


def public_url(storage_path: str) -> str:
    """Return the public URL prefix for a stored path."""
    return f"/uploads/{storage_path.lstrip('/')}"


def file_health(root: Path, storage_path: str) -> Literal["healthy", "missing_file", "invalid_image"]:
    """Inspect a file by its storage_path.

    - "missing_file": no file at the resolved path (or path escapes root)
    - "invalid_image": file present but Pillow cannot decode it
    - "healthy": file present and valid
    """
    try:
        target = resolve_inside_uploads(root, storage_path)
    except ValueError:
        return "missing_file"
    if not target.exists() or not target.is_file():
        return "missing_file"
    try:
        with Image.open(target) as image:
            image.verify()
    except Exception:
        return "invalid_image"
    return "healthy"


def cleanup_stored_file(root: Path, storage_path: str) -> bool:
    """Best-effort delete.

    Idempotent — when the file is already gone (or the path escapes the
    root) we silently return ``False`` rather than raising, so callers
    in compensation paths can fire-and-forget.
    """
    try:
        target = resolve_inside_uploads(root, storage_path)
    except ValueError:
        return False
    try:
        target.unlink()
        return True
    except FileNotFoundError:
        return False
