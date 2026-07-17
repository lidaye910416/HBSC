"""Storage service tests: validation, containment, atomic writes,
compensation cleanup.

The storage service is the single source of truth for writing image
bytes to disk under the uploads root. These tests pin its invariants.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest  # noqa: E402
from PIL import Image  # noqa: E402

from app.services.media_storage import (  # noqa: E402
    InvalidImage,
    cleanup_stored_file,
    resolve_inside_uploads,
    store_image,
)


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), "red").save(buf, "PNG")
    return buf.getvalue()


def test_fake_png_is_rejected(tmp_path):
    with pytest.raises(InvalidImage):
        store_image(tmp_path, "fake.png", b"not an image")


def test_store_uses_detected_format_and_metadata(tmp_path):
    stored = store_image(tmp_path, "wrong.gif", png_bytes())
    assert stored.storage_path.endswith(".png")
    assert stored.mime_type == "image/png"
    assert (stored.width, stored.height) == (32, 24)
    assert (tmp_path / stored.storage_path).exists()


def test_resolve_rejects_traversal(tmp_path):
    with pytest.raises(ValueError):
        resolve_inside_uploads(tmp_path, "../outside.png")


def test_cleanup_is_idempotent(tmp_path):
    stored = store_image(tmp_path, "a.png", png_bytes())
    cleanup_stored_file(tmp_path, stored.storage_path)
    cleanup_stored_file(tmp_path, stored.storage_path)
