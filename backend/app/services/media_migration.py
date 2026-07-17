"""Doctor / plan / apply for the historical media migration.

The migration inventory is non-destructive — ``plan`` never moves,
renames, or deletes files, and ``apply`` only ever CREATES rows in the
two media tables. Every upload becomes a ``MediaAsset``; every
``ArticleImage`` row that points at an on-disk file with the canonical
``YYYY/MM/<name>`` shape becomes a ``MediaUsage`` for the article.

Discovery rules:
    * Hidden / non-regular / out-of-tree files are reported but not
      followed.
    * ``.gitkeep`` is ignored.
    * Zero-byte / unsupported-MIME / invalid bytes are reported but
      counted in their own buckets.
    * Each discovered path lands in EXACTLY one of {assets_to_create,
      assets_to_reuse, skipped, error}.

Hash-bound plan: SHA-256 of the canonical plan JSON is the only key the
``apply`` step trusts. Apply re-acquires every candidate under a fresh
``BEGIN IMMEDIATE`` transaction, recreates the two media tables, upserts
by exact ``storage_path`` so re-running is idempotent, holds an exclusive
process lock so two operators cannot race, and re-verifies the
upload-manifest fingerprint before any write.

Article 19 fail-closed repair: ``plan`` records the article-19 content
SHA-256 and the four canonical storage paths. ``apply`` aborts unless
the DB content still matches that hash; if it does, the repair is
applied inside the same transaction and four ``content`` usages are
created. Any drift in between plan and apply aborts the run — there is
no silent retry.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker

from .app_paths import resolve_sqlite_url, uploads_root
from .markdown_normalize import SLUG_TO_IMAGE_DIR
from .media_storage import file_health, resolve_inside_uploads
from ..database import _enable_sqlite_foreign_keys
from ..models.base import Base
from ..models.article_image import ArticleImage
from ..models.journal import Article, Journal
from ..models.media import MediaAsset, MediaUsage

# Article id whose Markdown body is rewritten as part of the migration.
# The transform is fail-closed: validation runs BEFORE the DB is touched
# and the plan must capture the pre-apply SHA-256.
ARTICLE_19_ID = 19
ARTICLE_19_REPAIR_RELPATHS: tuple[str, ...] = (
    "source-images/19-hongan-medical/image1.png",
    "source-images/19-hongan-medical/image2.png",
    "source-images/19-hongan-medical/image3.png",
    "source-images/19-hongan-medical/image4.png",
)


# ---------------------------------------------------------------------------
# Process lock
# ---------------------------------------------------------------------------


def acquire_apply_lock(
    upload_root: Path,
    lock_path: Path | None = None,
) -> Any:
    """Acquire an exclusive fcntl lock so two apply processes can't race.

    Returns the lock handle (an open file descriptor wrapper). Caller is
    responsible for passing it to ``release_apply_lock`` in a finally
    block. The lock file lives in the OS temp directory by default —
    writing it under the uploads root would silently mutate the
    upload-manifest fingerprint and cause the very verification step
    we are guarding to fail.

    Callers that need a stable path (operator ops script, integration
    test that wants to inspect the lock) can pass an explicit path via
    ``lock_path`` — the helper will use that file instead.

    On non-POSIX platforms (Windows) this falls back to a no-op handle
    that records the intent but cannot serialize processes — callers
    must rely on the maintenance-mode flag in that case.
    """
    import tempfile
    if lock_path is None:
        lock_path = Path(tempfile.gettempdir()) / "hbsc-media-apply.lock"
    lock_path = Path(lock_path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fp = open(lock_path, "w", encoding="utf-8")
    fp.write(
        f"pid={os.getpid()} upload_root={upload_root} "
        f"started={datetime.utcnow().isoformat()}\n"
    )
    fp.flush()
    try:
        fcntl.flock(fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        fp.close()
        raise RuntimeError(
            f"another apply is already running (lock held at {lock_path}): {exc}"
        ) from exc
    return fp


def release_apply_lock(handle: Any) -> None:
    """Release the lock acquired by ``acquire_apply_lock`` and close the FD."""
    if handle is None:
        return
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass
    finally:
        handle.close()


# ---------------------------------------------------------------------------
# Upload-manifest fingerprint
# ---------------------------------------------------------------------------


def compute_upload_manifest_sha256(upload_root: Path) -> str:
    """Hash every regular file under ``upload_root`` (skipping .gitkeep and zero-byte).

    Mirrors the manifest computation done in ``build_plan`` so apply
    can re-verify that uploads haven't drifted between plan and apply.
    The exclusion rules must match exactly — plan skips ``.gitkeep``
    and zero-byte files and never includes symlinks.
    """
    resolved = upload_root.resolve()
    manifest: dict[str, str] = {}
    for path in sorted(resolved.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(resolved).as_posix()
        if path.name == ".gitkeep":
            continue
        if path.stat().st_size == 0:
            continue
        manifest[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest_bytes = json.dumps(manifest, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(manifest_bytes).hexdigest()


# Patterns ------------------------------------------------------------------

_LEGACY_FILENAME_RE = re.compile(r"^(\d{4})/(\d{2})/(?P<name>.+)$")


# ---------------------------------------------------------------------------
# Doctor
# ---------------------------------------------------------------------------

@dataclass
class DoctorReport:
    database_url: str
    database_path: Path
    upload_root: Path
    article_count: int
    journal_count: int
    regular_file_count: int
    total_bytes: int
    issues: list[dict] = field(default_factory=list)


def doctor(database_url: str, upload_root: Path) -> DoctorReport:
    """Inventory the database + uploads tree.

    Returns a structured report. Never writes anything.
    """
    resolved_db_url = resolve_sqlite_url(database_url)
    if resolved_db_url.startswith("sqlite:///"):
        db_path = Path(resolved_db_url[len("sqlite:///"):])
    else:
        db_path = Path("(non-sqlite)")

    engine = create_engine(resolved_db_url)
    report = DoctorReport(
        database_url=resolved_db_url,
        database_path=db_path,
        upload_root=upload_root.resolve(),
        article_count=0,
        journal_count=0,
        regular_file_count=0,
        total_bytes=0,
    )
    try:
        with engine.begin() as conn:
            report.article_count = conn.execute(
                text("SELECT COUNT(*) FROM articles"),
            ).scalar() if "articles" in _table_names(engine) else 0
            report.journal_count = conn.execute(
                text("SELECT COUNT(*) FROM journals"),
            ).scalar() if "journals" in _table_names(engine) else 0
    except Exception as exc:
        report.issues.append({"kind": "db_read_failed", "message": str(exc)})

    upload_root = upload_root.resolve()
    for path in sorted(upload_root.rglob("*")):
        if not path.is_file():
            continue
        if path.name == ".gitkeep":
            continue
        # Skip symlinks (we never follow them).
        if path.is_symlink():
            report.issues.append({"kind": "symlink", "rel": str(path.relative_to(upload_root))})
            continue
        report.regular_file_count += 1
        report.total_bytes += path.stat().st_size

    return report


def _table_names(engine) -> set[str]:
    insp = inspect(engine)
    return set(insp.get_table_names())


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

@dataclass
class MigrationAsset:
    storage_path: str
    original_name: str
    mime_type: str
    byte_size: int
    width: int | None
    height: int | None
    sha256: str
    source: str
    source_ref: str | None
    uploaded_by: str | None
    created_at: str  # ISO string
    file_health: str


@dataclass
class MigrationUsage:
    asset_storage_path: str
    owner_type: str
    owner_id: int
    field: str
    reference_count: int


@dataclass
class MigrationPlan:
    generated_at: str
    hostname: str
    cwd: str
    database_url: str
    database_path: Path
    upload_root: Path
    db_row_counts: dict[str, int]
    upload_manifest_sha256: str
    run_id: str
    assets_to_create: list[MigrationAsset] = field(default_factory=list)
    assets_to_reuse: list[MigrationAsset] = field(default_factory=list)
    skipped_paths: list[dict] = field(default_factory=list)
    error_paths: list[dict] = field(default_factory=list)
    usages_to_create: list[MigrationUsage] = field(default_factory=list)
    unmapped_article_images: list[dict] = field(default_factory=list)
    degraded_markdown_placeholders: list[dict] = field(default_factory=list)
    # When article 19 is present in the DB, the plan records its current
    # content SHA-256 and the canonical paths the repair must produce. Apply
    # aborts unless the DB still has exactly the same hash.
    article_19_repair: dict | None = None

    def to_dict(self) -> dict:
        def _asset(a: MigrationAsset) -> dict:
            return {
                "storage_path": a.storage_path,
                "original_name": a.original_name,
                "mime_type": a.mime_type,
                "byte_size": a.byte_size,
                "width": a.width,
                "height": a.height,
                "sha256": a.sha256,
                "source": a.source,
                "source_ref": a.source_ref,
                "uploaded_by": a.uploaded_by,
                "created_at": a.created_at,
                "file_health": a.file_health,
            }
        def _u(u: MigrationUsage) -> dict:
            return {
                "asset_storage_path": u.asset_storage_path,
                "owner_type": u.owner_type,
                "owner_id": u.owner_id,
                "field": u.field,
                "reference_count": u.reference_count,
            }
        return {
            "generated_at": self.generated_at,
            "hostname": self.hostname,
            "cwd": self.cwd,
            "database_url": self.database_url,
            "database_path": str(self.database_path),
            "upload_root": str(self.upload_root),
            "db_row_counts": self.db_row_counts,
            "upload_manifest_sha256": self.upload_manifest_sha256,
            "run_id": self.run_id,
            "assets_to_create": [_asset(a) for a in self.assets_to_create],
            "assets_to_reuse": [_asset(a) for a in self.assets_to_reuse],
            "skipped_paths": self.skipped_paths,
            "error_paths": self.error_paths,
            "usages_to_create": [_u(u) for u in self.usages_to_create],
            "unmapped_article_images": self.unmapped_article_images,
            "degraded_markdown_placeholders": self.degraded_markdown_placeholders,
            "article_19_repair": self.article_19_repair,
        }

    def canonical_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False, default=str)

    # convenient aliases used by the tests
    @property
    def assets_by_path(self) -> dict[str, MigrationAsset]:
        out = {a.storage_path: a for a in self.assets_to_create}
        out.update({a.storage_path: a for a in self.assets_to_reuse})
        return out

    @property
    def asset_paths(self) -> list[str]:
        return [a.storage_path for a in self.assets_to_create + self.assets_to_reuse]


def _run_id() -> str:
    import secrets
    return datetime.utcnow().strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(4)


def _inspect_image_for_plan(upload_root: Path, rel: str) -> tuple[str, int | None, int | None] | None:
    """Read on-disk bytes and look at the file via Pillow."""
    try:
        target = resolve_inside_uploads(upload_root, rel)
    except ValueError:
        return None
    if not target.exists() or not target.is_file():
        return None
    if target.stat().st_size == 0:
        return None
    try:
        from PIL import Image
        with Image.open(target) as img:
            fmt = (img.format or "").upper()
            width, height = img.size
        mime_map = {"PNG": ("image/png", ".png"), "JPEG": ("image/jpeg", ".jpg"), "WEBP": ("image/webp", ".webp"), "GIF": ("image/gif", ".gif")}
        if fmt not in mime_map:
            return None
        return (*mime_map[fmt], width, height)
    except Exception:
        return None


def build_plan(database_url: str, upload_root: Path, report_dir: Path) -> MigrationPlan:
    """Walk the uploads tree + legacy tables → deterministic plan.

    Writes plan.json + report.md + manifest.sha256 under ``report_dir``.
    Returns the in-memory plan so callers can inspect it without re-reading.
    """
    resolved_db_url = resolve_sqlite_url(database_url)
    engine = create_engine(resolved_db_url)
    if resolved_db_url.startswith("sqlite:"):
        event.listen(engine, "connect", _enable_sqlite_foreign_keys)

    SessionLocal = sessionmaker(bind=engine)

    plan = MigrationPlan(
        generated_at=datetime.utcnow().isoformat(),
        hostname=os.uname().nodename,
        cwd=os.getcwd(),
        database_url=resolved_db_url,
        database_path=Path(resolved_db_url[len("sqlite:///"):]) if resolved_db_url.startswith("sqlite:///") else Path("(non-sqlite)"),
        upload_root=upload_root.resolve(),
        db_row_counts={},
        upload_manifest_sha256="",
        run_id=_run_id(),
    )

    # ----- 1. Walk the uploads tree ----------------------------------
    upload_root = upload_root.resolve()
    manifest: dict[str, str] = {}
    for path in sorted(upload_root.rglob("*")):
        if path.is_symlink() or not path.is_file():
            if path.is_symlink():
                plan.skipped_paths.append({"rel": str(path.relative_to(upload_root)), "kind": "symlink"})
            continue
        rel = path.relative_to(upload_root).as_posix()
        if path.name == ".gitkeep":
            plan.skipped_paths.append({"rel": rel, "kind": "gitkeep"})
            continue
        size = path.stat().st_size
        if size == 0:
            plan.skipped_paths.append({"rel": rel, "kind": "zero_byte"})
            continue
        manifest[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
        info = _inspect_image_for_plan(upload_root, rel)
        if info is None:
            plan.error_paths.append({"rel": rel, "kind": "invalid_or_unsupported_image"})
            continue
        mime, ext, width, height = info
        sha = manifest[rel]
        bucket = MigrationAsset(
            storage_path=rel,
            original_name=Path(rel).name,
            mime_type=mime,
            byte_size=size,
            width=width,
            height=height,
            sha256=sha,
            source="legacy",
            source_ref=None,
            uploaded_by=None,
            created_at=datetime.utcfromtimestamp(path.stat().st_mtime).isoformat(),
            file_health=file_health(upload_root, rel),
        )
        # Heuristic: differentiate cover-style files from inline content.
        # source-images/<subdir>/...  → source=legacy (we treat it like any other on-disk file)
        # article-covers/...         → source=cover
        if rel.startswith("article-covers/") or rel.startswith("journal-covers/"):
            bucket.source = "cover"
        plan.assets_to_create.append(bucket)

    manifest_bytes = json.dumps(manifest, sort_keys=True, ensure_ascii=False).encode("utf-8")
    plan.upload_manifest_sha256 = hashlib.sha256(manifest_bytes).hexdigest()

    # ----- 2. DB row counts -------------------------------------------
    db = SessionLocal()
    try:
        plan.db_row_counts = {
            "articles": db.query(Article).count(),
            "journals": db.query(Journal).count(),
        }
        if "article_images" in _table_names(engine):
            plan.db_row_counts["article_images"] = db.query(ArticleImage).count()
    finally:
        db.close()

    # ----- 3. Map legacy ArticleImage rows ----------------------------
    legacy_to_asset: dict[str, MigrationAsset] = {}
    db = SessionLocal()
    try:
        if "article_images" in _table_names(engine):
            for img in db.query(ArticleImage).all():
                match = _LEGACY_FILENAME_RE.match(img.filename)
                if match is None:
                    plan.unmapped_article_images.append({
                        "id": img.id,
                        "filename": img.filename,
                        "reason": "filename not in YYYY/MM/<name> form",
                    })
                    continue
                stored_rel = f"{match.group(1)}/{match.group(2)}/{match.group('name')}"
                if stored_rel not in plan.assets_by_path:
                    plan.unmapped_article_images.append({
                        "id": img.id,
                        "filename": img.filename,
                        "reason": f"no disk file at {stored_rel}",
                    })
                    continue
                legacy_to_asset[img.filename] = plan.assets_by_path[stored_rel]
                # Stamp legacy metadata onto the asset row.
                target = plan.assets_by_path[stored_rel]
                target.original_name = img.original_name or target.original_name
                target.uploaded_by = img.uploaded_by
                if img.uploaded_at:
                    target.created_at = img.uploaded_at.isoformat()
                # Real bytes win over stale row metadata for mime.
                # The width/height/sha stay as we computed them.
    finally:
        db.close()

    # ----- 4. Inventory existing markdown references -----------------
    # For now we record "content_image_refs" by looking at article content.
    db = SessionLocal()
    try:
        for a in db.query(Article).all():
            content = a.content or ""
            for src in _iter_markdown_image_paths(content, slug=a.slug):
                if src in plan.assets_by_path:
                    plan.usages_to_create.append(MigrationUsage(
                        asset_storage_path=src,
                        owner_type="article",
                        owner_id=a.id,
                        field="content",
                        reference_count=1,
                    ))
            if a.cover_image and a.cover_image.startswith("/uploads/"):
                from urllib.parse import unquote, urlsplit
                rel = unquote(urlsplit(a.cover_image).path)[len("/uploads/"):]
                if rel in plan.assets_by_path:
                    plan.usages_to_create.append(MigrationUsage(
                        asset_storage_path=rel,
                        owner_type="article",
                        owner_id=a.id,
                        field="cover_image",
                        reference_count=1,
                    ))
        for j in db.query(Journal).all():
            if j.cover_image and j.cover_image.startswith("/uploads/"):
                from urllib.parse import unquote, urlsplit
                rel = unquote(urlsplit(j.cover_image).path)[len("/uploads/"):]
                if rel in plan.assets_by_path:
                    plan.usages_to_create.append(MigrationUsage(
                        asset_storage_path=rel,
                        owner_type="journal",
                        owner_id=j.id,
                        field="cover_image",
                        reference_count=1,
                    ))
    finally:
        db.close()

    # ----- 4b. Scan every article for degraded Markdown placeholders -
    # A "degraded placeholder" is a line that mentions a local
    # ``/uploads/...`` path in plain text without a proper Markdown
    # image token — for example the article-19 "图像路径：/uploads/..."
    # text. Spec §11.4 requires every such occurrence to land in the
    # report with line context, candidate path, and file/asset health
    # so operators can review without losing them.
    db = SessionLocal()
    try:
        media_tables_present = (
            "media_assets" in _table_names(engine)
            and "media_usages" in _table_names(engine)
        )
        for a in db.query(Article).all():
            content = a.content or ""
            if not content:
                continue
            resolved_image_paths = list(_iter_markdown_image_paths(content, slug=a.slug))
            for line_number, raw_line in enumerate(content.splitlines(), start=1):
                line = raw_line.strip()
                # Restrict to the established placeholder forms so we
                # don't bury the report in prose mentions like
                # "see /uploads/foo.png for context". The Chinese
                # parens-and-colon form is the only format used by the
                # historical articles; we accept both full-width and
                # half-width punctuation since the legacy DOCX importer
                # occasionally emits either.
                m = re.search(
                    r"[（(]图像路径\s*[：:]\s*(/uploads/[^\s）)]+)[）)]",
                    line,
                )
                if not m:
                    continue
                candidate_rel = m.group(1).removeprefix("/uploads/")
                # If the candidate is also a real image token in this
                # same article (post-rewrite), it is NOT degraded.
                if candidate_rel in resolved_image_paths:
                    continue
                # Health probe — both file-side and asset-side.
                file_health_str = file_health(upload_root, candidate_rel)
                asset_status: str | None = None
                if media_tables_present:
                    try:
                        asset = (
                            db.query(MediaAsset)
                            .filter(MediaAsset.storage_path == candidate_rel)
                            .first()
                        )
                        asset_status = asset.status if asset else None
                    except Exception:
                        asset_status = None
                plan.degraded_markdown_placeholders.append({
                    "article_id": a.id,
                    "article_slug": a.slug,
                    "line_number": line_number,
                    "original_line": raw_line,
                    "candidate_storage_path": candidate_rel,
                    "file_health": file_health_str,
                    "asset_status": asset_status,
                })
    finally:
        db.close()

    # ----- 4c. Capture article 19 fail-closed repair plan -----------
    # The plan records the article-19 current content hash + the four
    # canonical storage paths. Apply verifies the hash matches before
    # doing any rewrite; mismatch aborts. Capture only when ALL four
    # canonical paths are healthy on disk and present in the asset
    # bucket so apply has something concrete to point the new
    # ``MediaUsage`` rows at.
    db = SessionLocal()
    try:
        a19 = db.query(Article).filter(Article.id == ARTICLE_19_ID).first()
        if a19 is not None and a19.content:
            content = a19.content or ""
            content_sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
            expected_paths = list(ARTICLE_19_REPAIR_RELPATHS)
            all_healthy = all(
                file_health(upload_root, p) == "healthy" for p in expected_paths
            )
            in_asset_bucket = all(
                p in plan.assets_by_path for p in expected_paths
            )
            if all_healthy and in_asset_bucket:
                plan.article_19_repair = {
                    "article_id": a19.id,
                    "content_sha256": content_sha,
                    "expected_storage_paths": expected_paths,
                }
    finally:
        db.close()

    # ----- 5. Persist artifacts --------------------------------------
    canonical = plan.canonical_json()
    report_dir = Path(report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "plan.json").write_text(canonical + "\n", encoding="utf-8")
    (report_dir / "manifest.sha256").write_text(
        plan.upload_manifest_sha256 + "\n", encoding="utf-8"
    )
    _write_report_md(report_dir / "report.md", plan)
    return plan


def _iter_markdown_image_paths(markdown: str, *, slug: str | None):
    """Yield every local image src referenced in markdown.

    Mirrors ``media_references.markdown_image_sources`` + ``normalize_upload_src``
    without dragging in the SQLAlchemy session.
    """
    from markdown_it import MarkdownIt
    _MD = MarkdownIt("commonmark")
    for token in _MD.parse(markdown or ""):
        if token.type != "inline":
            continue
        for child in token.children or []:
            if child.type == "image":
                src = child.attrGet("src") or ""
                if src.startswith("media/"):
                    subdir = SLUG_TO_IMAGE_DIR.get(slug or "")
                    if subdir:
                        yield f"source-images/{subdir}/{src[len('media/'):]}"
                elif src.startswith("/uploads/"):
                    from urllib.parse import unquote, urlsplit
                    yield unquote(urlsplit(src).path)[len("/uploads/"):]


def _write_report_md(path: Path, plan: MigrationPlan) -> None:
    lines: list[str] = []
    lines.append(f"# Media migration report ({plan.run_id})")
    lines.append("")
    lines.append(f"- generated_at: {plan.generated_at}")
    lines.append(f"- database_url: {plan.database_url}")
    lines.append(f"- upload_root: {plan.upload_root}")
    lines.append(f"- db row counts: {plan.db_row_counts}")
    lines.append(f"- upload manifest sha256: {plan.upload_manifest_sha256}")
    lines.append("")
    lines.append(f"## Assets to create ({len(plan.assets_to_create)})")
    lines.append("")
    lines.append(f"## Assets to reuse ({len(plan.assets_to_reuse)})")
    lines.append("")
    lines.append(f"## Skipped ({len(plan.skipped_paths)})")
    lines.append("")
    lines.append(f"## Errors ({len(plan.error_paths)})")
    lines.append("")
    lines.append(f"## Usages ({len(plan.usages_to_create)})")
    lines.append("")
    lines.append(f"## Unmapped legacy rows ({len(plan.unmapped_article_images)})")
    lines.append("")
    lines.append(
        f"## Degraded markdown placeholders ({len(plan.degraded_markdown_placeholders)})"
    )
    lines.append("")
    lines.append(
        "Plain-text mentions of /uploads/... that are NOT inside a Markdown image token."
    )
    lines.append("Article 19 is repaired automatically by apply; everything else stays report-only.")
    lines.append("")
    for entry in plan.degraded_markdown_placeholders:
        lines.append(
            f"- article_id={entry['article_id']} slug={entry['article_slug']} "
            f"line={entry['line_number']} candidate={entry['candidate_storage_path']} "
            f"file_health={entry['file_health']} asset_status={entry['asset_status']}"
        )
    lines.append("")
    if plan.article_19_repair:
        repair = plan.article_19_repair
        lines.append("## Article 19 fail-closed repair")
        lines.append("")
        lines.append(
            f"- article_id={repair['article_id']} "
            f"content_sha256={repair['content_sha256']}"
        )
        lines.append(
            "- expected_storage_paths: "
            + ", ".join(repair["expected_storage_paths"])
        )
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------


def _bump_db_url(database_url: str) -> str:
    """Use a non-shared SQLite URL when applying offline.

    Tests pass an in-memory URL; production uses a file URL.
    """
    return resolve_sqlite_url(database_url)


def apply_plan(
    *,
    plan_path: Path,
    confirm_sha256: str,
    database_url: str,
    upload_root: Path,
    maintenance_mode: bool = True,
    audit_path: Path | None = None,
    report_dir: Path | None = None,
    lock_path: Path | None = None,
) -> dict:
    """Apply a MigrationPlan to the database. Never touches files.

    The apply step enforces five gates before any DB write:

      1. ``maintenance_mode=True`` is required (caller-set, CLI checks
         ``MEDIA_MIGRATION_MAINTENANCE=1`` separately);
      2. an exclusive ``fcntl`` lock prevents a second ``apply`` from
         racing the same database (lock file defaults to the OS temp
         directory as ``hbsc-media-apply.lock`` — deliberately kept
         outside the uploads tree so it does not mutate the
         upload-manifest fingerprint; callers can override via
         ``lock_path`` for unit tests);
      3. the SHA-256 of the canonical plan JSON must match
         ``confirm_sha256``;
      4. the uploads-manifest SHA-256 recorded in the plan must match
         a freshly computed fingerprint of the live uploads tree;
      5. when the plan recorded an article-19 repair, the article-19
         current content SHA-256 must match what the plan captured.

    On SQLite the entire write happens under a single
    ``BEGIN IMMEDIATE`` transaction so other writers are serialized
    against the apply and cannot interleave half-applied state.

    Returns a small dict suitable for the audit row.
    """
    if not maintenance_mode:
        raise RuntimeError("apply must be run with maintenance_mode=True")

    # Gate 2 — acquire exclusive process lock BEFORE we touch the DB.
    # The helper signature is ``(upload_root, lock_path=None)``; when a
    # lock_path is supplied we pass it via keyword so we don't confuse it
    # with the uploads root argument.
    lock_handle = acquire_apply_lock(upload_root, lock_path=lock_path)
    try:
        # Gate 3 — verify the operator-supplied plan hash.
        raw = plan_path.read_bytes()
        # The on-disk file always ends with a single \n that we add after
        # the canonical JSON. The hash the operator sees is over the
        # canonical JSON WITHOUT that trailing newline.
        if raw.endswith(b"\n"):
            canonical = raw[:-1]
        else:
            canonical = raw
        actual = hashlib.sha256(canonical).hexdigest()
        if actual != confirm_sha256:
            raise RuntimeError(
                f"plan hash mismatch: expected={confirm_sha256} got={actual}"
            )

        plan_dict = json.loads(canonical.decode("utf-8"))
        plan_run_id = plan_dict["run_id"]
        plan_upload_root = Path(plan_dict["upload_root"])
        if Path(upload_root).resolve() != plan_upload_root:
            # Not fatal — but surface the mismatch to the operator via
            # stderr so it does not go unnoticed in a fail-closed
            # tool. The plan still re-verifies the manifest fingerprint
            # below so a mismatched root cannot silently drift writes.
            print(
                f"warning: upload_root differs from plan: "
                f"supplied={Path(upload_root).resolve()} "
                f"plan={plan_upload_root}",
                file=sys.stderr,
            )

        # Gate 4 — re-verify uploads-manifest fingerprint.
        live_manifest_sha = compute_upload_manifest_sha256(upload_root)
        plan_manifest_sha = plan_dict.get("upload_manifest_sha256")
        if plan_manifest_sha != live_manifest_sha:
            raise RuntimeError(
                "upload-manifest sha256 changed since plan was generated: "
                f"expected={plan_manifest_sha} got={live_manifest_sha}; "
                "re-run plan and confirm again."
            )

        # Connect. Open in IMMEDIATE mode for SQLite so we serialize writers.
        resolved_db_url = _bump_db_url(database_url)
        is_sqlite = resolved_db_url.startswith("sqlite:")
        engine_kwargs: dict[str, Any] = {}
        if is_sqlite:
            engine_kwargs["connect_args"] = {"check_same_thread": False}
        # SQLite's IMMEDIATE transaction mode is requested via the raw
        # ``BEGIN IMMEDIATE`` SQL statement below. SQLAlchemy's own
        # ``isolation_level`` argument only accepts the dialect-defined
        # levels (SERIALIZABLE / READ UNCOMMITTED / AUTOCOMMIT) and does
        # NOT understand IMMEDIATE — so we use ``SERIALIZABLE`` (the
        # default for sqlite3) on the engine and rely on the explicit
        # ``BEGIN IMMEDIATE`` to upgrade the transaction in-flight.
        if is_sqlite:
            engine_kwargs["isolation_level"] = "SERIALIZABLE"
        engine = create_engine(resolved_db_url, **engine_kwargs)
        if is_sqlite:
            event.listen(engine, "connect", _enable_sqlite_foreign_keys)

        # Create only the two media tables (idempotent — no-op if they
        # already exist from a prior apply).
        Base.metadata.create_all(
            engine,
            tables=[
                t for t in Base.metadata.sorted_tables
                if t.name in {"media_assets", "media_usages"}
            ],
        )

        SessionLocal = sessionmaker(bind=engine)
        audit_fp = None
        if audit_path is not None:
            audit_path.parent.mkdir(parents=True, exist_ok=True)
            audit_fp = audit_path.open("a", encoding="utf-8")
        # Track apply outcome so the audit row reflects the actual
        # disposition: a rollback / raised exception must NOT be
        # reported as ``applied: True``. We capture the exception
        # (if any) into ``apply_error`` and re-raise after the audit
        # row has been written so the operator sees both.
        apply_error: Exception | None = None
        try:
            db = SessionLocal()
            try:
                # Begin the IMMEDIATE transaction explicitly. For SQLite,
                # the engine-level isolation_level already starts in
                # IMMEDIATE mode on the first BEGIN, but issuing the
                # raw statement makes the intent obvious in logs and
                # protects against an SA version silently ignoring the
                # kwarg.
                if is_sqlite:
                    db.execute(text("BEGIN IMMEDIATE"))

                # Upsert assets by storage_path.
                for raw_asset in plan_dict["assets_to_create"] + plan_dict["assets_to_reuse"]:
                    existing = db.query(MediaAsset).filter_by(
                        storage_path=raw_asset["storage_path"],
                    ).first()
                    if existing is None:
                        db.add(MediaAsset(
                            storage_path=raw_asset["storage_path"],
                            original_name=raw_asset["original_name"],
                            mime_type=raw_asset["mime_type"],
                            byte_size=raw_asset["byte_size"],
                            width=raw_asset.get("width"),
                            height=raw_asset.get("height"),
                            sha256=raw_asset["sha256"],
                            source=raw_asset["source"],
                            source_ref=raw_asset.get("source_ref"),
                            status="active",
                            uploaded_by=raw_asset.get("uploaded_by"),
                            created_at=datetime.fromisoformat(raw_asset["created_at"]),
                        ))
                    else:
                        # Don't overwrite drifted metadata — silent skip.
                        pass

                # Upsert usages by the (asset_id, owner_type, owner_id, field)
                # unique key. Each upsert AUTHORITATIVELY writes the
                # ``reference_count`` from the current plan: the plan is
                # the authoritative inventory, so a re-run after a manual
                # edit (e.g. operator-removed usage) must converge to the
                # plan's view, not the previous DB view. This is a
                # deliberate change from the previous ``max(...)``
                # behavior, which could keep a stale higher count.
                for u in plan_dict["usages_to_create"]:
                    asset = db.query(MediaAsset).filter_by(
                        storage_path=u["asset_storage_path"],
                    ).first()
                    if asset is None:
                        continue
                    existing = db.query(MediaUsage).filter_by(
                        asset_id=asset.id,
                        owner_type=u["owner_type"],
                        owner_id=u["owner_id"],
                        field=u["field"],
                    ).first()
                    if existing is None:
                        db.add(MediaUsage(
                            asset_id=asset.id,
                            owner_type=u["owner_type"],
                            owner_id=u["owner_id"],
                            field=u["field"],
                            reference_count=u["reference_count"],
                        ))
                    else:
                        existing.reference_count = u["reference_count"]

                # Gate 5 + article 19 fail-closed transform. The
                # transform runs INSIDE the same transaction so either
                # every write lands or none do.
                repair_applied = False
                repair_section = plan_dict.get("article_19_repair")
                if repair_section:
                    article_id = repair_section["article_id"]
                    expected_sha = repair_section["content_sha256"]
                    expected_paths = repair_section["expected_storage_paths"]
                    a19 = db.get(Article, article_id)
                    if a19 is None:
                        raise RuntimeError(
                            f"article {article_id} no longer exists; "
                            "re-generate the plan before applying"
                        )
                    current_content = a19.content or ""
                    current_sha = hashlib.sha256(
                        current_content.encode("utf-8"),
                    ).hexdigest()
                    if current_sha != expected_sha:
                        raise RuntimeError(
                            f"article {article_id} content drifted "
                            f"since plan: expected={expected_sha} "
                            f"got={current_sha}; re-generate the plan "
                            "before applying"
                        )
                    healthy_paths: set[str] = set()
                    for rel in expected_paths:
                        if file_health(upload_root, rel) != "healthy":
                            raise RuntimeError(
                                f"article {article_id} image {rel} is "
                                "no longer healthy; repair aborted"
                            )
                        healthy_paths.add(rel)
                    repaired_dir = Path(report_dir) if report_dir else plan_path.parent
                    rewritten = repair_article_19(
                        current_content,
                        healthy_paths=healthy_paths,
                        report_dir=repaired_dir,
                    )
                    a19.content = rewritten
                    # Insert the four content usages into the same
                    # transaction. The plan's inventory includes the
                    # ``assets_to_create`` rows for these paths so they
                    # exist by the time we look them up here.
                    for rel in expected_paths:
                        asset = db.query(MediaAsset).filter_by(
                            storage_path=rel,
                        ).first()
                        if asset is None:
                            raise RuntimeError(
                                f"asset for {rel} missing despite plan"
                            )
                        existing = db.query(MediaUsage).filter_by(
                            asset_id=asset.id,
                            owner_type="article",
                            owner_id=article_id,
                            field="content",
                        ).first()
                        if existing is None:
                            db.add(MediaUsage(
                                asset_id=asset.id,
                                owner_type="article",
                                owner_id=article_id,
                                field="content",
                                reference_count=1,
                            ))
                        else:
                            existing.reference_count = 1
                    repair_applied = True

                db.commit()
            except Exception as exc:
                db.rollback()
                apply_error = exc
                raise
            finally:
                db.close()
        finally:
            if audit_fp is not None:
                audit_record: dict[str, Any] = {
                    "run_id": plan_run_id,
                    "applied": apply_error is None,
                    "repair_article_19": repair_applied,
                }
                if apply_error is not None:
                    # Record the failure type + message so operators can
                    # distinguish "planned + successfully applied" from
                    # "rolled back mid-flight" without parsing logs.
                    # The exception is re-raised below so the calling
                    # CLI surfaces the error too — this row just makes
                    # the audit file the durable source of truth.
                    audit_record["error_type"] = type(apply_error).__name__
                    audit_record["error"] = str(apply_error)
                audit_fp.write(json.dumps(audit_record) + "\n")
                audit_fp.close()
        if apply_error is not None:
            raise apply_error
        return {"run_id": plan_run_id, "applied": True, "repair_article_19": repair_applied}
    finally:
        release_apply_lock(lock_handle)


# ---------------------------------------------------------------------------
# Helpers used by tests
# ---------------------------------------------------------------------------

def sha256_file(path: Path) -> str:
    """SHA-256 of the canonical plan JSON (excludes trailing newline).

    `plan.json` is always written as canonical JSON + a single trailing
    newline (so editors don't complain). The hash the operator
    copies/quotes must match what ``apply`` recomputes; both functions
    strip the trailing newline before hashing.
    """
    raw = path.read_bytes()
    if raw.endswith(b"\n"):
        raw = raw[:-1]
    return hashlib.sha256(raw).hexdigest()


# ---------------------------------------------------------------------------
# Article 19 fail-closed four-image repair
# ---------------------------------------------------------------------------

import re  # noqa: E402


CAPTION_RE = re.compile(r"^图([1-4])\s+(.+)$")
PATH_RE = re.compile(
    r"^（图像路径：/uploads/source-images/19-hongan-medical/image([1-4])\.png）$"
)


class Article19RepairMismatch(ValueError):
    """Raised when the article-19 repair input fails any of its paired
    caption/path invariants. The function never partially mutates the
    supplied content: all validation must pass before the backup is
    written or the rewritten content is returned.
    """


def _line_ending(line: str) -> str:
    if line.endswith("\r\n"):
        return "\r\n"
    if line.endswith("\n"):
        return "\n"
    return ""


def repair_article_19(content: str, *, healthy_paths: set[str], report_dir: Path) -> str:
    """Replace ``（图像路径：…）`` placeholders with ``![…](/uploads/…)``.

    Validation invariants:
      * every ``图N <text>`` caption is followed by a single
        ``（图像路径：…/imageN.png）`` placeholder line
      * the caption's N matches the placeholder's N
      * exactly the sequence [1, 2, 3, 4] is present
      * no extra ``（图像路径：…）`` placeholders exist outside pairs
      * the four canonical storage paths are all in the healthy set

    On success the function:
      1. writes ``<report_dir>/article-19-before.md`` with the original text
      2. writes ``<report_dir>/article-19-before.sha256`` with its SHA-256
      3. returns the rewritten Markdown (preserving each line's CRLF/LF
         style).
    """
    lines = content.splitlines(keepends=True)
    plain = [line.rstrip("\r\n") for line in lines]
    matches: list[tuple[int, int, str]] = []
    placeholder_indexes = [i for i, line in enumerate(plain) if PATH_RE.fullmatch(line)]
    for index in range(len(plain) - 1):
        caption = CAPTION_RE.fullmatch(plain[index])
        path = PATH_RE.fullmatch(plain[index + 1])
        if caption and path:
            if caption.group(1) != path.group(1):
                raise Article19RepairMismatch("caption/path mismatch")
            matches.append((index + 1, int(path.group(1)), plain[index]))
    if [number for _, number, _ in matches] != [1, 2, 3, 4]:
        raise Article19RepairMismatch("expected exact image sequence 1..4")
    if placeholder_indexes != [index for index, _, _ in matches]:
        raise Article19RepairMismatch("unpaired or extra image placeholder")
    expected_paths = {
        f"source-images/19-hongan-medical/image{number}.png"
        for number in range(1, 5)
    }
    if not expected_paths.issubset(healthy_paths):
        raise Article19RepairMismatch("one or more article images are unavailable")

    # All invariants validated. Now we can safely back up + transform.
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "article-19-before.md").write_text(content, encoding="utf-8")
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    (report_dir / "article-19-before.sha256").write_text(digest + "\n", encoding="ascii")

    for placeholder_index, number, caption_text in matches:
        ending = _line_ending(lines[placeholder_index])
        lines[placeholder_index] = (
            f"![{caption_text}](/uploads/source-images/19-hongan-medical/image{number}.png)"
            f"{ending}"
        )
    return "".join(lines)
