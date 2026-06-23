from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import pytest

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.models.journal import Article, Journal


@pytest.fixture
def client(tmp_path):
    test_db = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{test_db}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    # 种 2 篇 published + 1 篇 draft
    db = TestingSessionLocal()
    db.add_all([
        Article(title="A1", slug="a1", content="x", status="published", published_at=datetime(2026, 1, 1)),
        Article(title="A2", slug="a2", content="x", status="published", published_at=datetime(2026, 1, 2)),
        Article(title="D1", slug="d1", content="x", status="draft", published_at=datetime(2026, 1, 3)),
    ])
    db.commit()
    db.close()

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def test_articles_list_excludes_drafts(client):
    res = client.get("/api/articles")
    assert res.status_code == 200
    data = res.json()
    slugs = {a["slug"] for a in data["items"]}
    assert "a1" in slugs and "a2" in slugs
    assert "d1" not in slugs


def test_article_detail_404_for_draft(client):
    res = client.get("/api/articles/d1")
    assert res.status_code == 404


def test_featured_excludes_drafts(client):
    res = client.get("/api/articles/featured")
    assert res.status_code == 200
    slugs = {a["slug"] for a in res.json()}
    assert "d1" not in slugs