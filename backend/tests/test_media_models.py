from __future__ import annotations

import sys
from pathlib import Path

# Make `app.*` importable when pytest is run from the backend root or
# from anywhere else — pytest.ini's testpaths only controls discovery,
# not the import path.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest  # noqa: E402
from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.models.base import Base  # noqa: E402
from app.models.media import MediaAsset, MediaUsage  # noqa: E402


def _session():
    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)
    from app.database import _enable_sqlite_foreign_keys
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_sqlite_foreign_keys_are_enabled():
    from app.database import _enable_sqlite_foreign_keys
    engine = create_engine("sqlite:///:memory:")
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA foreign_keys")).scalar_one() == 1


def test_usage_rejects_invalid_owner_field_pair():
    db = _session()
    asset = MediaAsset(
        storage_path="2026/07/a.png", original_name="a.png",
        mime_type="image/png", byte_size=3, sha256="a" * 64,
        source="upload", status="active", uploaded_by="admin",
    )
    db.add(asset); db.flush()
    db.add(MediaUsage(asset_id=asset.id, owner_type="journal", owner_id=1, field="content"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_asset_delete_is_restricted_while_usage_exists():
    db = _session()
    asset = MediaAsset(
        storage_path="2026/07/a.png", original_name="a.png",
        mime_type="image/png", byte_size=3, sha256="a" * 64,
        source="upload", status="active", uploaded_by="admin",
    )
    db.add(asset); db.flush()
    db.add(MediaUsage(asset_id=asset.id, owner_type="article", owner_id=7, field="content"))
    db.commit()
    db.delete(asset)
    with pytest.raises(IntegrityError):
        db.commit()
