"""CLI entry point for the historical media migration.

Three subcommands:

    python -m app.scripts.migrate_media doctor [--report FILE]
        Print one-screen report. Exits non-zero on DB integrity or
        unreadable uploads.

    python -m app.scripts.migrate_media plan --report-dir DIR
        Walk uploads + DB rows, write plan.json + report.md +
        manifest.sha256 under DIR. Never touches files. Never inserts
        rows. Prints the SHA-256 hash at the end so an operator can
        paste it into the apply command.

    python -m app.scripts.migrate_media apply --plan DIR/plan.json --confirm-sha256 HASH
        Re-validates the hash, acquires an exclusive fcntl process lock,
        re-verifies the uploads-manifest fingerprint, opens
        ``BEGIN IMMEDIATE``, runs ``media_migration.apply_plan``. Writes
        append-only ``apply-audit.jsonl`` next to the plan. Articles
        targeted by the fail-closed repair (article 19) are rewritten
        inside the same transaction.

The maintenance_mode flag is required: ``apply`` refuses to run when
``MEDIA_MIGRATION_MAINTENANCE != "1"``.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

from ..config import settings
from ..database import engine
from ..services.app_paths import resolve_sqlite_url, uploads_root
from ..services.media_migration import (
    apply_plan,
    build_plan,
    doctor,
    sha256_file,
)


def _print_doctor(db_url: str, upload_root: Path, report_path: Path | None) -> int:
    rep = doctor(db_url, upload_root)
    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            "\n".join([
                f"hostname={os.uname().nodename}",
                f"cwd={os.getcwd()}",
                f"db_url={rep.database_url}",
                f"upload_root={rep.upload_root}",
                f"article_count={rep.article_count}",
                f"journal_count={rep.journal_count}",
                f"regular_file_count={rep.regular_file_count}",
                f"total_bytes={rep.total_bytes}",
                f"issues={rep.issues}",
            ]) + "\n",
            encoding="utf-8",
        )
    print(f"hostname={os.uname().nodename}")
    print(f"cwd={os.getcwd()}")
    print(f"db={rep.database_url}")
    print(f"upload_root={rep.upload_root}")
    print(f"article_count={rep.article_count}")
    print(f"journal_count={rep.journal_count}")
    print(f"regular_file_count={rep.regular_file_count}")
    print(f"total_bytes={rep.total_bytes}")
    if rep.issues:
        print(f"issues={rep.issues}", file=sys.stderr)
        return 2
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.scripts.migrate_media")
    sub = parser.add_subparsers(dest="cmd", required=True)

    doc_p = sub.add_parser("doctor")
    doc_p.add_argument("--report", default=None)

    plan_p = sub.add_parser("plan")
    plan_p.add_argument("--report-dir", required=True)

    apply_p = sub.add_parser("apply")
    apply_p.add_argument("--plan", required=True)
    apply_p.add_argument("--confirm-sha256", required=True)
    apply_p.add_argument("--audit", required=False, default=None)
    apply_p.add_argument(
        "--report-dir", required=False, default=None,
        help="Directory used to write article-19 before/after audit files "
        "(defaults to the directory containing --plan).",
    )
    apply_p.add_argument(
        "--lock-path", required=False, default=None,
        help="Override the path used for the exclusive process lock. "
        "Defaults to the OS temp directory as hbsc-media-apply.lock so "
        "the lock file stays outside the uploads tree and does not "
        "mutate the upload-manifest fingerprint. Tests inject a tmp "
        "path.",
    )

    ns = parser.parse_args(argv if argv is not None else sys.argv[1:])

    db_url = resolve_sqlite_url(settings.DATABASE_URL)
    upload_root = uploads_root(settings.UPLOAD_DIR)

    if ns.cmd == "doctor":
        return _print_doctor(
            db_url, upload_root,
            Path(ns.report) if ns.report else None,
        )

    if ns.cmd == "plan":
        report_dir = Path(ns.report_dir)
        plan = build_plan(db_url, upload_root, report_dir)
        digest = sha256_file(report_dir / "plan.json")
        print(f"plan run_id={plan.run_id}")
        print(f"report_dir={report_dir}")
        print(f"plan_sha256={digest}")
        return 0

    if ns.cmd == "apply":
        if os.getenv("MEDIA_MIGRATION_MAINTENANCE") != "1":
            print(
                "Refusing to apply without MEDIA_MIGRATION_MAINTENANCE=1",
                file=sys.stderr,
            )
            return 2
        plan_path = Path(ns.plan)
        audit_path = Path(ns.audit) if ns.audit else plan_path.parent / "apply-audit.jsonl"
        report_dir = Path(ns.report_dir) if ns.report_dir else plan_path.parent
        lock_path = Path(ns.lock_path) if ns.lock_path else None
        apply_plan(
            plan_path=plan_path,
            confirm_sha256=ns.confirm_sha256,
            database_url=db_url,
            upload_root=upload_root,
            maintenance_mode=True,
            audit_path=audit_path,
            report_dir=report_dir,
            lock_path=lock_path,
        )
        return 0

    parser.error(f"unknown command: {ns.cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
