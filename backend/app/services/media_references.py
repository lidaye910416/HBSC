"""Markdown image reference extraction + usage synchronization.

``sync_article_content`` and ``sync_cover`` translate a piece of markdown
(or a single cover URL) into the canonical ``MediaUsage`` rows that the
admin endpoints and editor expect. They DO NOT call ``db.commit()`` —
the caller owns the transaction so a failure in article save can roll
back the usage changes along with the article row.

The flow per sync call is:
  1. extract every distinct local image reference from the markdown
     (markdown-it-py inline token walk; absolute ``/uploads/<path>``
     and legacy ``media/<name>`` only; external URLs skipped);
  2. resolve each path against the slug using
     ``media_normalize.resolve_legacy_image_src``;
  3. count the occurrences of each path;
  4. look up the matching ``MediaAsset`` rows in bulk;
  5. fast-fail with ``UnknownMediaAsset`` / ``UnavailableMediaAsset``
     if the saved DB state has drifted (trashed or unhealthy);
  6. reconcile the previous usage rows for the owner/field against the
     new expected set: insert new rows, update counts, delete stale
     rows.

Neither helper modifies filesystem state.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Iterable
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt
from sqlalchemy.orm import Session

from ..models.media import MediaAsset, MediaUsage
from .markdown_normalize import resolve_legacy_image_src
from .media_storage import file_health, resolve_inside_uploads


_MD = MarkdownIt("commonmark")


class UnknownMediaAsset(ValueError):
    """Raised when a referenced path has no matching MediaAsset row."""


class UnavailableMediaAsset(ValueError):
    """Raised when a referenced asset is trashed or its file is unhealthy."""


def markdown_image_sources(markdown: str) -> Iterable[str]:
    """Yield every image src in ``markdown`` (any kind — local or remote).

    Pure AST walk; the caller is responsible for filtering by URL.
    """
    for token in _MD.parse(markdown or ""):
        if token.type != "inline":
            continue
        for child in token.children or []:
            if child.type == "image":
                src = child.attrGet("src")
                if src:
                    yield src


def normalize_upload_src(src: str, slug: str | None, upload_root: Path) -> str | None:
    """Map an image src to a canonical POS storage_path, or None.

    External URLs (``http:`` / ``https:`` / ``data:`` / protocol-relative
    ``//cdn/...``) return None — they are intentionally ignored for usage
    tracking. Legacy ``media/...`` references are rewritten through the
    slug lookup in ``resolve_legacy_image_src``.

    Containment is enforced: any path that escapes ``upload_root`` (or
    contains ``..`` / backslashes / empty segments) raises ``ValueError``
    so a malformed DB row cannot smuggle bytes off the disk.
    """
    lowered = src.lower()
    if lowered.startswith("data:"):
        return None
    if src.startswith("//"):
        return None
    if lowered.startswith(("http://", "https://")):
        return None

    if src.startswith("media/"):
        rewritten = resolve_legacy_image_src(src, slug)
        if rewritten is None:
            return None
        src = rewritten

    if not src.startswith("/uploads/"):
        return None

    path = unquote(urlsplit(src).path)[len("/uploads/"):]
    if "\\" in path:
        raise ValueError("invalid media path")
    pure = PurePosixPath(path)
    if any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError("invalid media path")
    resolve_inside_uploads(upload_root, pure.as_posix())
    return pure.as_posix()


def extract_local_image_counts(
    markdown: str, *, slug: str | None, upload_root: Path,
) -> Counter[str]:
    """Count local image references per storage_path.

    External URLs and protocol-relative URLs are excluded; legacy
    ``media/...`` references resolve through the slug lookup. Traversal
    attempts raise ValueError, propagating the smell to the caller so
    the editor save can surface a 422 instead of silently ignoring it.
    """
    counts: Counter[str] = Counter()
    for src in markdown_image_sources(markdown or ""):
        path = normalize_upload_src(src, slug, upload_root)
        if path is None:
            continue
        counts[path] += 1
    return counts


def _load_assets(db: Session, paths: Iterable[str]) -> dict[str, MediaAsset]:
    paths = list(set(paths))
    if not paths:
        return {}
    rows = db.query(MediaAsset).filter(MediaAsset.storage_path.in_(paths)).all()
    return {a.storage_path: a for a in rows}


def sync_owner_usages(
    db: Session,
    *,
    owner_type: str,
    owner_id: int,
    field: str,
    expected: Counter[str],
    upload_root: Path,
) -> None:
    """Reconcile ``MediaUsage`` rows for an owner/field to ``expected``.

    The caller owns the transaction; this function add/updates/deletes
    rows in-place but never calls ``commit()``.

    Raises:
      UnknownMediaAsset: one of the expected paths has no asset row.
      UnavailableMediaAsset: an asset is trashed or its file is unhealthy.
    """
    assets = _load_assets(db, expected.keys())
    for path in expected:
        asset = assets.get(path)
        if asset is None:
            raise UnknownMediaAsset(path)
        if asset.status != "active":
            raise UnavailableMediaAsset(path)
        if file_health(upload_root, path) != "healthy":
            raise UnavailableMediaAsset(path)

    current = {
        u.asset_id: u for u in db.query(MediaUsage).filter_by(
            owner_type=owner_type, owner_id=owner_id, field=field,
        ).all()
    }
    desired_ids: set[int] = set()
    for path, count in expected.items():
        asset = assets[path]
        desired_ids.add(asset.id)
        usage = current.get(asset.id)
        if usage is not None:
            usage.reference_count = count
        else:
            db.add(MediaUsage(
                asset_id=asset.id,
                owner_type=owner_type,
                owner_id=owner_id,
                field=field,
                reference_count=count,
            ))
    for asset_id, usage in current.items():
        if asset_id not in desired_ids:
            db.delete(usage)


def sync_article_content(
    db: Session,
    *,
    article_id: int,
    markdown: str | None,
    slug: str | None,
    upload_root: Path,
) -> None:
    counts = extract_local_image_counts(markdown or "", slug=slug, upload_root=upload_root)
    sync_owner_usages(
        db,
        owner_type="article",
        owner_id=article_id,
        field="content",
        expected=counts,
        upload_root=upload_root,
    )


def sync_cover(
    db: Session,
    *,
    owner_type: str,
    owner_id: int,
    url: str | None,
    upload_root: Path,
) -> None:
    """Reconcile cover_image references for an article or journal owner.

    When ``url`` is None or not an absolute ``/uploads/<path>``, the
    function clears every existing cover usage for the owner. When it
    points at an absolute /uploads path, the matching usage row is set
    to ``reference_count=1``.
    """
    expected: Counter[str] = Counter()
    if url:
        path = normalize_upload_src(url, slug=None, upload_root=upload_root)
        if path is not None:
            expected[path] = 1
    sync_owner_usages(
        db,
        owner_type=owner_type,
        owner_id=owner_id,
        field="cover_image",
        expected=expected,
        upload_root=upload_root,
    )


def delete_owner_usages(db: Session, *, owner_type: str, owner_ids: list[int]) -> None:
    """Delete every MediaUsage row for a set of owners (used on owner delete)."""
    if not owner_ids:
        return
    db.query(MediaUsage).filter(
        MediaUsage.owner_type == owner_type,
        MediaUsage.owner_id.in_(owner_ids),
    ).delete(synchronize_session=False)
