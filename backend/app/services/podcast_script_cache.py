"""Persistent, article-keyed cache for pre-generated podcast scripts."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .app_paths import backend_root


def _cache_dir() -> Path:
    return backend_root() / "data" / "podcasts" / "scripts"


def _path(slug: str) -> Path:
    # Slugs are validated by the article API; this extra guard keeps the
    # cache from ever interpreting a caller-controlled path.
    safe = "".join(ch for ch in slug if ch.isalnum() or ch in "-_ ").strip().replace(" ", "-")
    return _cache_dir() / f"{safe}.json"


def read_script(slug: str) -> tuple[list[dict[str, Any]], str] | None:
    path = _path(slug)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    segments = payload.get("segments")
    if not isinstance(segments, list) or not segments:
        return None
    return segments, str(payload.get("script_text") or "")


def write_script(slug: str, segments: list[dict[str, Any]], script_text: str) -> None:
    directory = _cache_dir()
    directory.mkdir(parents=True, exist_ok=True)
    target = _path(slug)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps({"segments": segments, "script_text": script_text}, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, target)


def delete_script(slug: str) -> None:
    try:
        _path(slug).unlink()
    except FileNotFoundError:
        pass
