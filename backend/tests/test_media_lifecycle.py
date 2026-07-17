"""Lifecycle unit tests: trash/restore/eligibility/purge semantics.

These tests exercise the lifecycle primitives directly so the router
surface area stays covered by test_admin_media.
"""
from __future__ import annotations

import io
import sys
from datetime import datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from datetime import datetime, timedelta  # noqa: E402,E501
from hashlib import sha256  # noqa: E402
from PIL import Image  # noqa: E402

from app.services.media_lifecycle import (  # noqa: E402
    AssetInUse,
    eligible_for_purge,
    restore_asset,
    trash_asset,
)


def png_bytes(color: str = "red") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), color).save(buf, "PNG")
    return buf.getvalue()


def test_trash_then_restore_round_trip(media_test_env, media_asset):
    db = media_test_env["Session"]()
    fixed = datetime(2026, 7, 13, 0, 0, 0)
    trash_asset(db, media_asset.asset, now=fixed)
    assert media_asset.asset.status == "trashed"
    assert media_asset.asset.trashed_at == fixed
    restore_asset(media_asset.asset)
    assert media_asset.asset.status == "active"
    assert media_asset.asset.trashed_at is None
    db.close()


def test_trash_with_usages_raises(media_test_env, referenced_asset):
    db = media_test_env["Session"]()
    fixed = datetime(2026, 7, 13, 0, 0, 0)
    with _raises(AssetInUse):
        trash_asset(db, referenced_asset, now=fixed)
    db.close()


def test_retrash_resets_trashed_at(media_test_env, media_asset):
    db = media_test_env["Session"]()
    first = datetime(2026, 7, 1, 0, 0, 0)
    trash_asset(db, media_asset.asset, now=first)
    second = datetime(2026, 8, 1, 0, 0, 0)
    trash_asset(db, media_asset.asset, now=second)
    assert media_asset.asset.status == "trashed"
    assert media_asset.asset.trashed_at == second
    db.close()


def test_eligible_for_purge_only_after_retention(media_test_env, media_asset):
    fixed = datetime(2026, 7, 13, 0, 0, 0)
    media_asset.asset.status = "active"
    assert not eligible_for_purge(media_asset.asset, now=fixed, retention_days=30)

    media_asset.asset.status = "trashed"
    media_asset.asset.trashed_at = fixed - timedelta(days=29)
    assert not eligible_for_purge(media_asset.asset, now=fixed, retention_days=30)

    media_asset.asset.trashed_at = fixed - timedelta(days=30)
    assert eligible_for_purge(media_asset.asset, now=fixed, retention_days=30)


# Lightweight context-manager helper so we can keep test expectations on
# one line each without importing pytest at module scope.
import contextlib  # noqa: E402


@contextlib.contextmanager
def _raises(exc_type):
    try:
        yield
    except exc_type:
        return
    raise AssertionError(f"expected {exc_type.__name__}")


# ----- purge CLI ----------------------------------------------------------

from app.models.media import MediaAsset  # noqa: E402
from app.scripts.purge_media import PurgePlan, run_purge  # noqa: E402
from conftest import make_png_bytes  # noqa: E402


def seed_old_trashed_asset(media_test_env):
    """Plant a trashed asset whose trashed_at is older than the retention."""
    path = "2026/06/old.png"
    file_path = media_test_env["upload_root"] / path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    content = make_png_bytes()
    file_path.write_bytes(content)
    db = media_test_env["Session"]()
    asset = MediaAsset(
        storage_path=path, original_name="old.png", mime_type="image/png",
        byte_size=len(content), width=32, height=24,
        sha256=sha256(content).hexdigest(),
        source="upload", status="trashed", uploaded_by="admin",
        trashed_at=datetime.fromisoformat("2026-07-01T00:00:00"),
    )
    db.add(asset); db.commit(); db.refresh(asset)
    asset_id = asset.id
    db.close()
    return asset_id, file_path


def test_purge_plan_never_unlinks(media_test_env, tmp_path):
    asset_id, old_file = seed_old_trashed_asset(media_test_env)
    plan_path = tmp_path / "purge-plan.json"
    result = run_purge(
        ["plan", "--now", "2026-08-31T00:00:00", "--output", str(plan_path)],
        session_factory=media_test_env["Session"],
        upload_root=media_test_env["upload_root"],
    )
    assert result["eligible_ids"] == [asset_id]
    assert old_file.exists()
    assert plan_path.exists()


def test_purge_apply_requires_exact_plan_hash(media_test_env, tmp_path):
    seed_old_trashed_asset(media_test_env)
    plan_path = tmp_path / "purge-plan.json"
    run_purge(
        ["plan", "--now", "2026-08-31T00:00:00", "--output", str(plan_path)],
        session_factory=media_test_env["Session"],
        upload_root=media_test_env["upload_root"],
    )
    import pytest
    with pytest.raises(SystemExit):
        run_purge(
            ["apply", "--plan", str(plan_path), "--confirm-sha256", "wrong"],
            session_factory=media_test_env["Session"],
            upload_root=media_test_env["upload_root"],
        )


def test_purge_apply_unlinks_and_deletes_in_single_commit(media_test_env, tmp_path):
    """#117 — a successful apply commits the row deletion together with the
    file unlink, leaving no partially-applied state.

    ``purge_asset`` never commits on its own; ``_apply_plan`` commits once
    after the loop. This end-to-end test asserts the committed result: the
    file is unlinked AND the row is gone in a fresh session.
    """
    import hashlib
    import json

    # Seed an asset whose trashed_at is far enough in the past to remain
    # eligible against the real ``now`` that apply re-checks (the plan step
    # takes an explicit --now, but _apply_plan re-verifies with utcnow()).
    storage_path = "2020/01/purgeme.png"
    old_file = media_test_env["upload_root"] / storage_path
    old_file.parent.mkdir(parents=True, exist_ok=True)
    content = make_png_bytes()
    old_file.write_bytes(content)
    db = media_test_env["Session"]()
    asset = MediaAsset(
        storage_path=storage_path, original_name="purgeme.png",
        mime_type="image/png", byte_size=len(content), width=32, height=24,
        sha256=sha256(content).hexdigest(), source="upload",
        status="trashed", uploaded_by="admin",
        trashed_at=datetime.fromisoformat("2020-01-01T00:00:00"),
    )
    db.add(asset); db.commit(); db.refresh(asset)
    asset_id = asset.id
    db.close()
    assert old_file.exists()

    plan_path = tmp_path / "purge-plan.json"
    run_purge(
        ["plan", "--now", "2026-08-31T00:00:00", "--output", str(plan_path)],
        session_factory=media_test_env["Session"],
        upload_root=media_test_env["upload_root"],
    )
    plan_dict = json.loads(plan_path.read_text(encoding="utf-8"))
    plan = PurgePlan(
        generated_at=plan_dict["generated_at"],
        retention_days=plan_dict["retention_days"],
        eligible=plan_dict["eligible"],
    )
    digest = hashlib.sha256(plan.canonical_json().encode("utf-8")).hexdigest()

    result = run_purge(
        [
            "apply", "--plan", str(plan_path), "--confirm-sha256", digest,
            "--audit", str(tmp_path / "purge-audit.jsonl"),
        ],
        session_factory=media_test_env["Session"],
        upload_root=media_test_env["upload_root"],
    )
    assert result["results"][0]["outcome"] == "deleted"
    # File unlinked and row committed-deleted (fresh session sees no row).
    assert not old_file.exists()
    db = media_test_env["Session"]()
    try:
        assert db.get(MediaAsset, asset_id) is None
    finally:
        db.close()
