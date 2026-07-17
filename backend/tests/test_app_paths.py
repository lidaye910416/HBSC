from __future__ import annotations

import sys
from pathlib import Path

# Make `app.*` importable when pytest is run from the backend root or
# from anywhere else — pytest.ini's testpaths only controls discovery,
# not the import path.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.app_paths import backend_root, resolve_sqlite_url, uploads_root  # noqa: E402


def test_relative_sqlite_url_is_anchored_to_backend():
    url = resolve_sqlite_url("sqlite:///./research.db")
    assert url == f"sqlite:///{(backend_root() / 'research.db').as_posix()}"


def test_absolute_sqlite_url_is_unchanged(tmp_path):
    db = tmp_path / "test.db"
    assert resolve_sqlite_url(f"sqlite:///{db}") == f"sqlite:///{db}"


def test_relative_upload_dir_is_anchored_to_backend():
    assert uploads_root("./uploads") == (backend_root() / "uploads").resolve()
