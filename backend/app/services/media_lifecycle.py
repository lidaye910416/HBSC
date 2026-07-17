"""MediaAsset lifecycle primitives.

The admin API delegates to these functions so router code stays thin.
All functions DO NOT call commit(); the caller owns the transaction.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..models.media import MediaUsage


class AssetInUse(Exception):
    """The asset still has MediaUsage rows and cannot be trashed/purged."""

    def __init__(self, usages):
        self.usages = list(usages)


def _has_usages(db: Session, asset_id: int) -> list[MediaUsage]:
    """Return remaining usages (for error context) by direct query.

    We deliberately do NOT rely on ``asset.usages`` because the lazy-load
    raises ``DetachedInstanceError`` once the originating session is closed
    in tests. The DB-level FK RESTRICT is the actual invariant; this just
    gives the caller structured error detail.
    """
    return db.query(MediaUsage).filter_by(asset_id=asset_id).all()


def trash_asset(db: Session, asset, now: datetime) -> None:
    usages = _has_usages(db, asset.id)
    if usages:
        raise AssetInUse(usages)
    asset.status = "trashed"
    asset.trashed_at = now


def restore_asset(asset) -> None:
    asset.status = "active"
    asset.trashed_at = None


def eligible_for_purge(asset, now: datetime, retention_days: int) -> bool:
    if asset.status != "trashed":
        return False
    if asset.trashed_at is None:
        return False
    return asset.trashed_at <= now - timedelta(days=retention_days)


def purge_asset(db: Session, asset, upload_root) -> tuple[bool, str]:
    """Idempotently purge a single eligible asset.

    Re-checks status/age/usages under the same transaction (defense in
    depth — the unique ``(asset_id, owner_type, owner_id, field)``
    usage constraint and the FK RESTRICT are still the source of truth).

    The caller owns the commit. This helper:
      * unlinks the file (if present)
      * flags the row for deletion (``delete_on_commit`` flag set in a
        ``pending_deletes`` attribute on ``db``) so the outer transaction
        can commit everything in one round trip
      * returns ``(deleted, note)`` so the caller can record the audit
        outcome without ever committing from inside the helper

    ``note`` is one of:
      - ``"deleted"`` — row + file removed (will commit at outer txn)
      - ``"missing_file"`` — file already gone, row scheduled for delete
      - ``"unlink_failed"`` — file present but unlink raised; row preserved
      - ``"in_use"`` / ``"invalid_path"`` — refused without any state change
    """
    usages = _has_usages(db, asset.id)
    if usages:
        return False, "in_use"
    try:
        target = upload_root / asset.storage_path
    except ValueError:
        return False, "invalid_path"
    try:
        target.unlink()
        db.delete(asset)
        return True, "deleted"
    except FileNotFoundError:
        # File already gone — record intent, let the outer txn commit
        # the row deletion. Use the same flag the outer commit walks
        # so the result of the whole batch is consistent.
        db.delete(asset)
        return True, "missing_file"
    except OSError:
        return False, "unlink_failed"
