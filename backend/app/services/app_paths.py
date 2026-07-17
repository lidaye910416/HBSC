"""Backend-rooted path helpers for SQLite URLs and the uploads directory.

These helpers make the configured locations independent of the current
working directory. ``./research.db`` is anchored against the backend
package root, never the shell's CWD, so running tests or scripts from
unrelated directories does not silently create or read a stray file.
"""
from __future__ import annotations

from pathlib import Path


_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def backend_root() -> Path:
    """Return the backend package root as an absolute path.

    ``app.services.app_paths`` lives at ``backend/app/services/app_paths.py``;
    parents[2] is ``backend/``.
    """
    return _BACKEND_ROOT


def uploads_root(configured: str) -> Path:
    """Resolve the upload directory.

    Relative paths are anchored to the backend root (not the shell CWD) so
    running the API from anywhere consistently uses the same folder.
    """
    path = Path(configured).expanduser()
    return (path if path.is_absolute() else _BACKEND_ROOT / path).resolve()


def resolve_sqlite_url(url: str) -> str:
    """Resolve a SQLite URL against the backend root when it is relative.

    - ``sqlite:///:memory:`` is returned unchanged.
    - ``sqlite:///<absolute-path>`` is returned unchanged.
    - ``sqlite:///./<rel-path>`` becomes ``sqlite:///<backend-root>/<rel-path>``.
    - Non-SQLite URLs are returned unchanged so other dialects remain selectable.
    """
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return url
    raw = url[len(prefix):]
    if raw == ":memory:":
        return url
    path = Path(raw).expanduser()
    resolved = (path if path.is_absolute() else _BACKEND_ROOT / path).resolve()
    return f"{prefix}{resolved.as_posix()}"
