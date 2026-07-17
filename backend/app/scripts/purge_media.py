"""Operator-facing manual purge workflow.

``python -m app.scripts.purge_media plan``  — list every asset that is
trashed AND older than ``MEDIA_TRASH_RETENTION_DAYS``. Writes a JSON
plan + a SHA-256 of its canonical JSON. Never touches the filesystem.

``python -m app.scripts.purge_media apply --plan plan.json --confirm-sha256 HASH``

re-checks the plan hash, re-acquires each candidate under a fresh
transaction, and runs ``media_lifecycle.purge_asset`` for every row
that's still eligible. Writes an append-only JSONL audit log.

The CLI is intentionally hash-bound: production operators must review
the plan output, write down its hash, and pass the hash back to ``apply``
on a different machine if necessary. Without an explicit hash match
``apply`` exits non-zero without touching anything.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ..config import settings
from ..database import _enable_sqlite_foreign_keys
from ..models.media import MediaAsset, MediaUsage
from ..services.app_paths import resolve_sqlite_url, uploads_root
from ..services.media_lifecycle import eligible_for_purge, purge_asset
from ..services.media_storage import file_health


@dataclass
class PurgePlan:
    generated_at: str
    retention_days: int
    eligible: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "generated_at": self.generated_at,
            "retention_days": self.retention_days,
            "eligible": self.eligible,
        }

    def canonical_json(self) -> str:
        """Stable JSON for hashing (sorted keys, no whitespace)."""
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def _resolve_upload_root() -> Path:
    return uploads_root(settings.UPLOAD_DIR)


def _resolve_session_factory():
    database_url = resolve_sqlite_url(settings.DATABASE_URL)
    engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False} if database_url.startswith("sqlite:") else {},
    )
    if database_url.startswith("sqlite:"):
        from sqlalchemy import event
        event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    return sessionmaker(bind=engine)


def _build_plan(session_factory, upload_root: Path, now: datetime, retention_days: int) -> PurgePlan:
    plan = PurgePlan(
        generated_at=now.isoformat(),
        retention_days=retention_days,
    )
    Session = session_factory
    db = Session()
    try:
        for asset in db.query(MediaAsset).filter(MediaAsset.status == "trashed").all():
            if not eligible_for_purge(asset, now=now, retention_days=retention_days):
                continue
            plan.eligible.append({
                "asset_id": asset.id,
                "storage_path": asset.storage_path,
                "sha256": asset.sha256,
                "trashed_at": asset.trashed_at.isoformat() if asset.trashed_at else None,
                "retention_cutoff": (now - (now - asset.trashed_at)).isoformat()
                    if asset.trashed_at else None,
                "file_health": file_health(upload_root, asset.storage_path),
            })
    finally:
        db.close()
    return plan


def _apply_plan(
    session_factory, upload_root: Path, plan: PurgePlan,
    audit_path: Path | None,
) -> dict:
    Session = session_factory
    results: list[dict] = []
    audit_fp = None
    if audit_path is not None:
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        audit_fp = audit_path.open("a", encoding="utf-8")
    try:
        db = Session()
        try:
            for entry in plan.eligible:
                asset = db.get(MediaAsset, entry["asset_id"])
                if asset is None:
                    results.append({**entry, "outcome": "missing"})
                    continue
                if not eligible_for_purge(asset, now=datetime.utcnow(), retention_days=plan.retention_days):
                    results.append({**entry, "outcome": "skipped_ineligible"})
                    continue
                if db.query(MediaUsage).filter_by(asset_id=asset.id).count() > 0:
                    results.append({**entry, "outcome": "skipped_in_use"})
                    continue
                ok, note = purge_asset(db, asset, upload_root)
                outcome = "deleted" if ok and note == "deleted" else note
                results.append({**entry, "outcome": outcome})
            db.commit()
        finally:
            db.close()
    finally:
        if audit_fp is not None:
            for r in results:
                audit_fp.write(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n")
            audit_fp.close()
    return {"results": results}


def run_purge(args: list[str], *, session_factory=None, upload_root: Path | None = None) -> dict:
    parser = argparse.ArgumentParser(prog="app.scripts.purge_media")
    sub = parser.add_subparsers(dest="cmd", required=True)

    plan_p = sub.add_parser("plan")
    plan_p.add_argument("--now", required=True, help="ISO timestamp; plan is computed at this instant")
    plan_p.add_argument("--output", required=True, help="Plan JSON output path")
    plan_p.add_argument("--retention-days", type=int, default=None)

    apply_p = sub.add_parser("apply")
    apply_p.add_argument("--plan", required=True, help="Plan JSON path")
    apply_p.add_argument("--confirm-sha256", required=True, help="SHA-256 of canonical plan JSON")
    apply_p.add_argument("--audit", required=False, help="Append-only JSONL audit log path")
    apply_p.add_argument("--now", required=False, help="Override the current 'now' value for testing")

    ns = parser.parse_args(args)
    SessionLocal = session_factory or _resolve_session_factory()
    root = upload_root if upload_root is not None else _resolve_upload_root()
    retention = getattr(ns, "retention_days", None)
    if retention is None:
        retention = settings.MEDIA_TRASH_RETENTION_DAYS

    if ns.cmd == "plan":
        now = datetime.fromisoformat(ns.now)
        plan = _build_plan(SessionLocal, root, now, retention)
        out = Path(ns.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(plan.canonical_json() + "\n", encoding="utf-8")
        return {"eligible_ids": [e["asset_id"] for e in plan.eligible], "path": str(out)}

    # apply
    plan_path = Path(ns.plan)
    plan_dict = json.loads(plan_path.read_text(encoding="utf-8"))
    plan = PurgePlan(
        generated_at=plan_dict["generated_at"],
        retention_days=plan_dict["retention_days"],
        eligible=plan_dict["eligible"],
    )
    actual_digest = hashlib.sha256(plan.canonical_json().encode("utf-8")).hexdigest()
    if actual_digest != ns.confirm_sha256:
        print(
            f"plan hash mismatch: expected={ns.confirm_sha256} got={actual_digest}",
            file=sys.stderr,
        )
        sys.exit(2)
    audit = Path(ns.audit) if ns.audit else None
    return _apply_plan(SessionLocal, root, plan, audit)


def main(argv: list[str] | None = None) -> int:
    run_purge(sys.argv[1:] if argv is None else argv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
