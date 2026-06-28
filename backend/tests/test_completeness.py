from types import SimpleNamespace
from app.services.completeness import REQUIRED_CATEGORIES, is_journal_complete


def _article(category: str, status: str = "published"):
    return SimpleNamespace(category=category, status=status)


def _journal(articles):
    return SimpleNamespace(articles=articles)


def test_required_categories_constant():
    assert REQUIRED_CATEGORIES == [
        "战略与政策", "技术与产业", "方案与思考", "动态与文化"
    ]


def test_empty_journal_incomplete():
    result = is_journal_complete(_journal([]))
    assert result["complete"] is False
    assert all(result[c] == 0 for c in REQUIRED_CATEGORIES)


def test_one_category_present_incomplete():
    a = _article("战略与政策")
    result = is_journal_complete(_journal([a]))
    assert result["战略与政策"] == 1
    assert result["技术与产业"] == 0
    assert result["complete"] is False


def test_all_four_categories_complete():
    arts = [_article(c) for c in REQUIRED_CATEGORIES]
    result = is_journal_complete(_journal(arts))
    assert result["complete"] is True


def test_draft_articles_do_not_count():
    arts = [_article(c, status="draft") for c in REQUIRED_CATEGORIES]
    result = is_journal_complete(_journal(arts))
    assert result["complete"] is False


def test_multiple_per_category_still_complete():
    arts = [_article(c) for c in REQUIRED_CATEGORIES] + [_article("战略与政策")]
    result = is_journal_complete(_journal(arts))
    assert result["complete"] is True
    assert result["战略与政策"] == 2
