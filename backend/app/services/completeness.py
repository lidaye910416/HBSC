"""Per-journal 4-category completeness rules."""
from typing import Iterable, TypedDict


REQUIRED_CATEGORIES = ["战略与政策", "技术与产业", "方案与思考", "动态与文化"]


class CompletenessReport(TypedDict):
    战略与政策: int
    技术与产业: int
    方案与思考: int
    动态与文化: int
    complete: bool


def is_journal_complete(journal) -> CompletenessReport:
    """Count published articles per REQUIRED_CATEGORY and report completeness.

    Drafts don't count — an admin may save articles as drafts while preparing
    a new issue. A journal is complete when each category has >= 1 published
    article.
    """
    counts: dict[str, int] = {c: 0 for c in REQUIRED_CATEGORIES}
    for a in (journal.articles or []):
        cat = getattr(a, "category", None)
        status = getattr(a, "status", "published")
        if cat in counts and status == "published":
            counts[cat] += 1
    counts["complete"] = all(counts[c] >= 1 for c in REQUIRED_CATEGORIES)
    return counts  # type: ignore[return-value]
