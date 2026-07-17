"""Migration safety: doctor is read-only, plan never modifies files/DB,
apply is hash-bound + idempotent + transaction-safe.
"""
from __future__ import annotations

import io
import sqlite3
import sys
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.database import _enable_sqlite_foreign_keys  # noqa: E402
from app.models.article_image import ArticleImage  # noqa: E402
from app.models.base import Base  # noqa: E402
from app.models.journal import Article, Journal  # noqa: E402
from app.models.media import MediaAsset, MediaUsage  # noqa: E402
from app.services.media_migration import (  # noqa: E402
    apply_plan,
    build_plan,
    doctor,
    sha256_file,
)
from conftest import make_png_bytes  # noqa: E402


@dataclass
class MigrationEnv:
    db_path: Path
    upload_root: Path
    Session: object

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.db_path}"

    @property
    def all_paths_except_gitkeep(self) -> list[str]:
        return sorted(
            path.relative_to(self.upload_root).as_posix()
            for path in self.upload_root.rglob("*")
            if path.is_file() and path.name != ".gitkeep"
        )

    def db_sha256(self) -> str:
        return sha256(self.db_path.read_bytes()).hexdigest()

    def upload_manifest(self) -> dict[str, str]:
        return {
            path: sha256((self.upload_root / path).read_bytes()).hexdigest()
            for path in self.all_paths_except_gitkeep
        }


@pytest.fixture()
def tmp_env(tmp_path):
    """Heremetic SQLite + uploads tree for migration tests."""
    db_path = tmp_path / "research.db"
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    engine = create_engine(f"sqlite:///{db_path}")
    legacy_tables = [
        t for t in Base.metadata.sorted_tables
        if t.name not in {"media_assets", "media_usages"}
    ]
    Base.metadata.create_all(engine, tables=legacy_tables)
    Session = sessionmaker(bind=engine)
    db = Session()
    journal = Journal(id=1, title="J1", slug="j1", status="published")
    db.add(journal)
    db.add(Article(
        id=1, title="A1", slug="a1", journal_id=1,
        status="draft", content="",
    ))
    db.commit()
    db.close()
    # Plant a few files
    first = upload_root / "2026/06/a.png"
    first.parent.mkdir(parents=True, exist_ok=True)
    first.write_bytes(make_png_bytes("red"))
    second = upload_root / "source-images/x/b.png"
    second.parent.mkdir(parents=True, exist_ok=True)
    second.write_bytes(make_png_bytes("blue"))
    (upload_root / "zero.png").write_bytes(b"")
    (upload_root / ".gitkeep").write_text("")
    return MigrationEnv(db_path, upload_root, Session)


def test_doctor_reports_resolved_paths_and_counts(tmp_env):
    rep = doctor(tmp_env.database_url, tmp_env.upload_root)
    assert rep.article_count == 1
    # Two real PNGs (2026/06/a.png + source-images/x/b.png) plus zero.png
    assert rep.regular_file_count == 3
    assert Path(rep.upload_root).is_absolute()


def test_plan_accounts_for_every_upload_path(tmp_env, tmp_path):
    report_dir = tmp_path / "report"
    plan = build_plan(tmp_env.database_url, tmp_env.upload_root, report_dir)
    skipped = {s["rel"] for s in plan.skipped_paths}
    errored = {e["rel"] for e in plan.error_paths}
    accounted = set(plan.asset_paths) | skipped | errored
    # .gitkeep can appear in skipped bucket — exclude it from the comparison
    # since the helper that decides "all paths" also filters it out.
    accounted_no_keep = {p for p in accounted if Path(p).name != ".gitkeep"}
    expected = {p for p in tmp_env.all_paths_except_gitkeep}
    assert accounted_no_keep == expected


def test_plan_writes_only_report_dir(tmp_env, tmp_path):
    before_db = tmp_env.db_sha256()
    before_uploads = tmp_env.upload_manifest()
    build_plan(tmp_env.database_url, tmp_env.upload_root, tmp_path / "report")
    assert tmp_env.db_sha256() == before_db
    assert tmp_env.upload_manifest() == before_uploads


def test_apply_is_idempotent(tmp_env, tmp_path):
    report_dir = tmp_path / "report"
    build_plan(tmp_env.database_url, tmp_env.upload_root, report_dir)
    plan_path = report_dir / "plan.json"
    digest = sha256_file(plan_path)
    # media tables don't exist yet — apply must create them via Base.metadata.
    apply_plan(
        plan_path=plan_path,
        confirm_sha256=digest,
        database_url=tmp_env.database_url,
        upload_root=tmp_env.upload_root,
        maintenance_mode=True,
        audit_path=report_dir / "apply-audit.jsonl",
        lock_path=tmp_path / "test-apply.lock",
    )
    db = tmp_env.Session()
    first_counts = (
        db.query(MediaAsset).count(),
        db.query(MediaUsage).count(),
    )
    db.close()
    apply_plan(
        plan_path=plan_path,
        confirm_sha256=digest,
        database_url=tmp_env.database_url,
        upload_root=tmp_env.upload_root,
        maintenance_mode=True,
        audit_path=report_dir / "apply-audit.jsonl",
        lock_path=tmp_path / "test-apply.lock",
    )
    db = tmp_env.Session()
    assert (
        db.query(MediaAsset).count(),
        db.query(MediaUsage).count(),
    ) == first_counts
    db.close()


def test_apply_aborts_when_upload_manifest_changes(tmp_env, tmp_path):
    """Gate 4 — re-verified upload-manifest fingerprint.

    After ``plan`` runs, mutate one byte in the uploads tree and ensure
    ``apply`` refuses to run instead of silently writing under drifted
    state.
    """
    report_dir = tmp_path / "report"
    build_plan(tmp_env.database_url, tmp_env.upload_root, report_dir)
    plan_path = report_dir / "plan.json"
    digest = sha256_file(plan_path)
    # Plant a new upload file between plan and apply.
    drift = tmp_env.upload_root / "drift.png"
    drift.parent.mkdir(parents=True, exist_ok=True)
    drift.write_bytes(make_png_bytes("purple"))
    with pytest.raises(RuntimeError, match="upload-manifest"):
        apply_plan(
            plan_path=plan_path,
            confirm_sha256=digest,
            database_url=tmp_env.database_url,
            upload_root=tmp_env.upload_root,
            maintenance_mode=True,
            audit_path=report_dir / "apply-audit.jsonl",
            lock_path=tmp_path / "test-apply.lock",
        )


def test_apply_aborts_when_maintenance_mode_disabled(tmp_env, tmp_path):
    report_dir = tmp_path / "report"
    build_plan(tmp_env.database_url, tmp_env.upload_root, report_dir)
    plan_path = report_dir / "plan.json"
    digest = sha256_file(plan_path)
    with pytest.raises(RuntimeError, match="maintenance_mode"):
        apply_plan(
            plan_path=plan_path,
            confirm_sha256=digest,
            database_url=tmp_env.database_url,
            upload_root=tmp_env.upload_root,
            maintenance_mode=False,
            audit_path=report_dir / "apply-audit.jsonl",
            lock_path=tmp_path / "test-apply.lock",
        )


def test_apply_serializes_with_process_lock(tmp_env, tmp_path):
    """Gate 2 — second apply must refuse while the first holds the lock."""
    import fcntl
    report_dir = tmp_path / "report"
    build_plan(tmp_env.database_url, tmp_env.upload_root, report_dir)
    plan_path = report_dir / "plan.json"
    digest = sha256_file(plan_path)
    lock_path = tmp_path / "apply-serial.lock"
    # Hold the lock ourselves so the second apply fails to acquire.
    holding_fp = open(lock_path, "w+")
    fcntl.flock(holding_fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        with pytest.raises(RuntimeError, match="already running"):
            apply_plan(
                plan_path=plan_path,
                confirm_sha256=digest,
                database_url=tmp_env.database_url,
                upload_root=tmp_env.upload_root,
                maintenance_mode=True,
                audit_path=report_dir / "apply-audit.jsonl",
                lock_path=lock_path,
            )
    finally:
        fcntl.flock(holding_fp.fileno(), fcntl.LOCK_UN)
        holding_fp.close()


def test_plan_records_degraded_markdown_placeholders(tmp_env, tmp_path):
    """Spec §11.4 — plain-text /uploads/... mentions land in the report."""
    db = tmp_env.Session()
    from app.models.journal import Article
    # Replace the seeded article's content with a line that has the
    # historical placeholder form.
    a = db.query(Article).first()
    a.content = "前文\n（图像路径：/uploads/2026/06/a.png）\n后文"
    db.commit(); db.close()
    report_dir = tmp_path / "report"
    plan = build_plan(tmp_env.database_url, tmp_env.upload_root, report_dir)
    placeholders = plan.degraded_markdown_placeholders
    assert any(
        p["candidate_storage_path"] == "2026/06/a.png" and p["article_id"] == 1
        for p in placeholders
    )


def test_apply_overwrites_reference_count_instead_of_max(tmp_env, tmp_path):
    """Spec §11.3(7) — apply upserts ``reference_count`` to the plan's
    value, converging to the plan's authoritative inventory rather than
    keeping a stale higher count (the old ``max(...)`` behavior).
    """
    from datetime import datetime

    db = tmp_env.Session()
    a = db.query(Article).first()
    article_id = a.id
    a.content = "![a](/uploads/2026/06/a.png)"
    db.commit(); db.close()

    report_dir = tmp_path / "report"
    plan = build_plan(tmp_env.database_url, tmp_env.upload_root, report_dir)
    # The plan records exactly one content usage with reference_count == 1.
    assert any(
        u.asset_storage_path == "2026/06/a.png"
        and u.owner_type == "article"
        and u.owner_id == article_id
        and u.field == "content"
        and u.reference_count == 1
        for u in plan.usages_to_create
    )
    plan_path = report_dir / "plan.json"
    digest = sha256_file(plan_path)

    # Pre-seed the media tables with a STALE usage count of 5. Apply must
    # bring it back down to the plan's value of 1.
    media_engine = create_engine(tmp_env.database_url)
    Base.metadata.create_all(
        media_engine,
        tables=[t for t in Base.metadata.sorted_tables
                if t.name in {"media_assets", "media_usages"}],
    )
    media_engine.dispose()
    db = tmp_env.Session()
    content = (tmp_env.upload_root / "2026/06/a.png").read_bytes()
    asset = MediaAsset(
        storage_path="2026/06/a.png", original_name="a.png",
        mime_type="image/png", byte_size=len(content), width=32, height=24,
        sha256=sha256(content).hexdigest(), source="legacy",
        status="active", uploaded_by=None, created_at=datetime.utcnow(),
    )
    db.add(asset); db.flush()
    db.add(MediaUsage(
        asset_id=asset.id, owner_type="article", owner_id=article_id,
        field="content", reference_count=5,
    ))
    db.commit(); db.close()

    apply_plan(
        plan_path=plan_path,
        confirm_sha256=digest,
        database_url=tmp_env.database_url,
        upload_root=tmp_env.upload_root,
        maintenance_mode=True,
        audit_path=report_dir / "apply-audit.jsonl",
        lock_path=tmp_path / "test-apply.lock",
    )

    db = tmp_env.Session()
    usage = db.query(MediaUsage).filter_by(
        owner_type="article", owner_id=article_id, field="content",
    ).one()
    assert usage.reference_count == 1
    db.close()


def test_apply_repair_article_19(tmp_env, tmp_path):
    """Gate 5 + repair_article_19 wiring.

    When the plan contains an ``article_19_repair`` section, apply must
    rewrite article 19's content, create four content usages, and
    produce a backup file in the report dir. A second apply must be a
    no-op (idempotent: the same hash is recorded again, the repair is
    skipped because the rewrite leaves the content unchanged after the
    first apply).
    """
    from app.models.journal import Article
    from app.services.media_migration import ARTICLE_19_REPAIR_RELPATHS
    db = tmp_env.Session()
    # Plant the four canonical images.
    for rel in ARTICLE_19_REPAIR_RELPATHS:
        target = tmp_env.upload_root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(make_png_bytes("blue"))
    # Seed article 19 with the historical placeholder body.
    placeholder_body = (
        "前文\n图1 总体架构\n（图像路径：/uploads/source-images/19-hongan-medical/image1.png）\n"
        "中间\n图2 数据架构\n（图像路径：/uploads/source-images/19-hongan-medical/image2.png）\n"
        "图3 服务架构\n（图像路径：/uploads/source-images/19-hongan-medical/image3.png）\n"
        "图4 安全架构\n（图像路径：/uploads/source-images/19-hongan-medical/image4.png）\n后文"
    )
    db.add(Article(
        id=19, title="Article 19", slug="article-19",
        journal_id=1, status="draft", content=placeholder_body,
    ))
    db.commit(); db.close()

    report_dir = tmp_path / "report"
    plan = build_plan(tmp_env.database_url, tmp_env.upload_root, report_dir)
    assert plan.article_19_repair is not None
    assert plan.article_19_repair["article_id"] == 19
    plan_path = report_dir / "plan.json"
    digest = sha256_file(plan_path)

    result = apply_plan(
        plan_path=plan_path,
        confirm_sha256=digest,
        database_url=tmp_env.database_url,
        upload_root=tmp_env.upload_root,
        maintenance_mode=True,
        audit_path=report_dir / "apply-audit.jsonl",
        report_dir=report_dir,
        lock_path=tmp_path / "test-apply.lock",
    )
    assert result["repair_article_19"] is True

    db = tmp_env.Session()
    a19 = db.query(Article).filter(Article.id == 19).first()
    # Four image tokens present, no leftover placeholder.
    assert a19.content.count("![图") == 4
    assert "图像路径" not in a19.content
    usages = db.query(MediaUsage).filter_by(
        owner_type="article", owner_id=19, field="content",
    ).all()
    assert len(usages) == 4
    db.close()
    # Backup file written by repair_article_19.
    assert (report_dir / "article-19-before.md").exists()


def test_apply_aborts_when_article_19_content_drifts(tmp_env, tmp_path):
    """Gate 5 — content drift between plan and apply aborts the run."""
    from app.models.journal import Article
    from app.services.media_migration import ARTICLE_19_REPAIR_RELPATHS
    db = tmp_env.Session()
    for rel in ARTICLE_19_REPAIR_RELPATHS:
        target = tmp_env.upload_root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(make_png_bytes("blue"))
    placeholder_body = (
        "前文\n图1 总体架构\n（图像路径：/uploads/source-images/19-hongan-medical/image1.png）\n"
        "中间\n图2 数据架构\n（图像路径：/uploads/source-images/19-hongan-medical/image2.png）\n"
        "图3 服务架构\n（图像路径：/uploads/source-images/19-hongan-medical/image3.png）\n"
        "图4 安全架构\n（图像路径：/uploads/source-images/19-hongan-medical/image4.png）\n后文"
    )
    db.add(Article(
        id=19, title="Article 19", slug="article-19",
        journal_id=1, status="draft", content=placeholder_body,
    ))
    db.commit(); db.close()

    report_dir = tmp_path / "report"
    build_plan(tmp_env.database_url, tmp_env.upload_root, report_dir)
    plan_path = report_dir / "plan.json"
    digest = sha256_file(plan_path)
    # Drift the article-19 content AFTER plan.
    db = tmp_env.Session()
    a19 = db.query(Article).filter(Article.id == 19).first()
    a19.content = a19.content + "\nextra edit"
    db.commit(); db.close()
    with pytest.raises(RuntimeError, match="article 19 content drifted"):
        apply_plan(
            plan_path=plan_path,
            confirm_sha256=digest,
            database_url=tmp_env.database_url,
            upload_root=tmp_env.upload_root,
            maintenance_mode=True,
            audit_path=report_dir / "apply-audit.jsonl",
            report_dir=report_dir,
            lock_path=tmp_path / "test-apply.lock",
        )
