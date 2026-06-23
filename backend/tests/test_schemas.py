import pytest
from app.schemas.admin import ArticleCreate, ArticleUpdate


def test_article_create_valid_slug():
    a = ArticleCreate(title="测试", slug="my-article-2026")
    assert a.slug == "my-article-2026"


def test_article_create_invalid_slug():
    with pytest.raises(ValueError):
        ArticleCreate(title="测试", slug="My Article!")  # 大写+空格+!


def test_article_update_all_optional():
    u = ArticleUpdate()
    assert u.title is None
    assert u.status is None


def test_article_update_rejects_invalid_status():
    with pytest.raises(ValueError):
        ArticleUpdate(status="archived")  # 不在 Literal 中