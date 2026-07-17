"""Centralized article publication invariants.

A draft article MAY have ``journal_id IS NULL`` — drafts are placeholders
that don't need a home issue yet. As soon as ``status == "published"``,
however, the article MUST reference a real journal row. We enforce that
single rule here and reuse it from every write path (POST/PUT/dedicated
publish) so a future route can't accidentally bypass it.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.journal import Article, Journal


def validate_journal_id(db: Session, journal_id: Optional[int]) -> Optional[Journal]:
    """Resolve ``journal_id`` to its row, or raise a structured 422.

    - ``None`` is allowed (drafts may be unassigned).
    - A non-null id that doesn't exist raises 422 ``invalid_journal``.
    """
    if journal_id is None:
        return None
    journal = db.get(Journal, journal_id)
    if journal is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_journal",
                "message": "所属期数不存在",
            },
        )
    return journal


def validate_article_publication(db: Session, article: Article) -> None:
    """Validate that a published article has a real journal.

    For drafts the function is a no-op. For published articles it raises
    422 ``unassigned_journal`` if the journal_id is null, and re-checks
    ``validate_journal_id`` so a stale id gets caught here too.

    Side effect: stamps ``published_at`` on the in-memory instance if the
    caller forgot to set it (the article routes used to do this inline;
    moving it here keeps that behaviour with the rest of the invariants).
    """
    if article.status != "published":
        return
    if article.journal_id is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unassigned_journal",
                "message": "发布文章前必须选择所属期数",
            },
        )
    validate_journal_id(db, article.journal_id)
    if article.published_at is None:
        article.published_at = datetime.utcnow()