from app.models.journal import Article, Journal
from app.models.article_image import ArticleImage


def test_article_has_status_and_updated_at():
    fields = {c.name for c in Article.__table__.columns}
    assert "status" in fields
    assert "updated_at" in fields
    assert "cover_image_alt" in fields


def test_journal_has_updated_at():
    fields = {c.name for c in Journal.__table__.columns}
    assert "updated_at" in fields


def test_article_image_fields():
    fields = {c.name for c in ArticleImage.__table__.columns}
    assert "filename" in fields
    assert "mime" in fields
    assert "size" in fields
    assert "uploaded_by" in fields


def test_article_status_default_is_published():
    col = Article.__table__.columns["status"]
    assert col.default.arg == "published"