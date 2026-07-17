# -*- coding: utf-8 -*-
"""Disk-freshness test for SLUG_TO_IMAGE_DIR.

Catches the class of bug where someone adds a slug to the dict but
forgets to create the corresponding subdir under uploads/source-images/
(or vice versa). With this test, the failure mode is "test failed" at
build time, not "broken image" at runtime.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.markdown_normalize import SLUG_TO_IMAGE_DIR  # noqa: E402


def _source_images_root() -> Path:
    """Locate uploads/source-images/ robustly — works whether pytest is
    run from backend/ or from the repo root.
    """
    cwd = Path.cwd()
    for candidate in (cwd / "uploads" / "source-images",
                      cwd / "backend" / "uploads" / "source-images",
                      BACKEND_ROOT / "uploads" / "source-images"):
        if candidate.exists():
            return candidate
    # Fallback: return the most likely path so the failure message is
    # useful even if the directory is missing entirely.
    return BACKEND_ROOT / "uploads" / "source-images"


def test_slug_map_is_non_empty():
    """SLUG_TO_IMAGE_DIR should not be empty (it's the single source of
    truth for image routing)."""
    assert SLUG_TO_IMAGE_DIR, "SLUG_TO_IMAGE_DIR is empty"


def test_slug_map_values_are_unique_subdirs():
    """Two slugs pointing to the same subdir would silently alias their
    images — catch this at test time."""
    subdirs = list(SLUG_TO_IMAGE_DIR.values())
    assert len(subdirs) == len(set(subdirs)), (
        f"Duplicate subdirs in SLUG_TO_IMAGE_DIR: {subdirs}"
    )


def test_slug_map_subdirs_exist_on_disk():
    """Every subdir listed in SLUG_TO_IMAGE_DIR must exist under
    uploads/source-images/. This is the disk-freshness assertion that
    prevents a class of bugs where the dict and the filesystem drift.
    """
    root = _source_images_root()
    if not root.exists():
        # Skip rather than fail when the upload dir simply isn't created
        # yet (e.g. fresh CI checkout before any imports). This is not
        # the failure mode this test is trying to catch.
        import pytest
        pytest.skip(f"uploads/source-images/ not found at {root}")
    missing = [
        (slug, sub)
        for slug, sub in SLUG_TO_IMAGE_DIR.items()
        if not (root / sub).is_dir()
    ]
    assert not missing, (
        f"SLUG_TO_IMAGE_DIR points to subdirs that don't exist on disk: {missing}"
    )


def test_slug_map_subdirs_contain_at_least_one_image():
    """Smoke check: each known subdir should hold at least one image.
    This catches the case where a subdir exists but is empty (orphaned
    on-disk state from a previous import).
    """
    root = _source_images_root()
    if not root.exists():
        import pytest
        pytest.skip(f"uploads/source-images/ not found at {root}")
    IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
    empty = []
    for slug, sub in SLUG_TO_IMAGE_DIR.items():
        sub_path = root / sub
        if not sub_path.is_dir():
            continue
        has_image = any(
            child.suffix.lower() in IMAGE_EXTS
            for child in sub_path.iterdir()
            if child.is_file()
        )
        if not has_image:
            empty.append((slug, sub))
    assert not empty, (
        f"Subdirs in SLUG_TO_IMAGE_DIR contain no images: {empty}"
    )
