from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

from app.main import app
from app.database import get_db
from app.models.base import Base
from app.models.journal import Journal
from app.security import hash_password, create_access_token
from app.config import settings


@pytest.fixture
def env(tmp_path, monkeypatch):
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
    monkeypatch.setattr(settings, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD_HASH", hash_password("pw"))
    db = TestingSessionLocal()
    db.add(Journal(title="Existing", slug="2026-q1", issue_number="2026-Q1"))
    db.commit()
    db.close()
    return {"client": TestClient(app)}


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _token():
    return create_access_token(sub="admin")


def test_list_journals(env):
    res = env["client"].get("/api/admin/journals", headers=_auth(_token()))
    assert res.status_code == 200
    assert res.json()["total"] >= 1


def test_create_journal(env):
    res = env["client"].post(
        "/api/admin/journals",
        headers=_auth(_token()),
        json={"title": "Q2", "slug": "2026-q2", "issue_number": "2026-Q2"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["slug"] == "2026-q2"


def test_create_journal_slug_conflict_409(env):
    res = env["client"].post(
        "/api/admin/journals",
        headers=_auth(_token()),
        json={"title": "Dup", "slug": "2026-q1"},
    )
    assert res.status_code == 409


def test_update_journal(env):
    res = env["client"].get("/api/admin/journals", headers=_auth(_token()))
    jid = res.json()["items"][0]["id"]
    res = env["client"].put(
        f"/api/admin/journals/{jid}",
        headers=_auth(_token()),
        json={"title": "Updated Title"},
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Updated Title"


def test_delete_journal(env):
    res = env["client"].get("/api/admin/journals", headers=_auth(_token()))
    jid = next(j["id"] for j in res.json()["items"] if j["slug"] == "2026-q1")
    res = env["client"].delete(f"/api/admin/journals/{jid}", headers=_auth(_token()))
    assert res.status_code == 200


def test_completeness_endpoint(env):
    jid = env["client"].get("/api/admin/journals", headers=_auth(_token())).json()["items"][0]["id"]
    res = env["client"].get(f"/api/admin/journals/{jid}/completeness", headers=_auth(_token()))
    assert res.status_code == 200
    body = res.json()
    assert set(["战略与政策", "技术与产业", "方案与思考", "动态与文化", "complete"]).issubset(body.keys())
    assert body["complete"] is False  # no articles yet


def test_publish_incomplete_journal_422(env):
    jid = env["client"].get("/api/admin/journals", headers=_auth(_token())).json()["items"][0]["id"]
    res = env["client"].post(f"/api/admin/journals/{jid}/publish", headers=_auth(_token()))
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "incomplete_journal"


def test_publish_then_unpublish(env):
    from app.models.journal import Article
    from app.models.journal import Journal as J
    jid = env["client"].get("/api/admin/journals", headers=_auth(_token())).json()["items"][0]["id"]
    # Inject 4 published articles directly via DB
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    j = db.query(J).filter_by(id=jid).first()
    for cat in ["战略与政策", "技术与产业", "方案与思考", "动态与文化"]:
        db.add(Article(title=f"T-{cat}", slug=f"s-{cat}-{jid}", category=cat, status="published", journal_id=jid))
    db.commit()

    res = env["client"].post(f"/api/admin/journals/{jid}/publish", headers=_auth(_token()))
    assert res.status_code == 200
    assert res.json()["status"] == "published"

    res = env["client"].post(f"/api/admin/journals/{jid}/unpublish", headers=_auth(_token()))
    assert res.status_code == 200
    assert res.json()["status"] == "draft"


def test_articles_by_category_groups_correctly(env):
    from app.models.journal import Article, Journal as J
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    jid = db.query(J).filter_by(slug="2026-q1").first().id
    db.add_all([
        Article(title="S1", slug="s1", category="战略与政策", status="published", journal_id=jid),
        Article(title="S2", slug="s2", category="战略与政策", status="draft", journal_id=jid),
        Article(title="T1", slug="t1", category="技术与产业", status="published", journal_id=jid),
        Article(title="O1", slug="o1", category="方案与思考", status="draft", journal_id=jid),
    ])
    db.commit()

    res = env["client"].get(f"/api/admin/journals/{jid}/articles-by-category", headers=_auth(_token()))
    assert res.status_code == 200
    body = res.json()
    assert len(body["strategy"]) == 2
    assert len(body["technology"]) == 1
    assert len(body["solution"]) == 1
    assert len(body["dynamics"]) == 0
    assert body["completeness"]["complete"] is False


def test_articles_by_category_404(env):
    res = env["client"].get("/api/admin/journals/99999/articles-by-category", headers=_auth(_token()))
    assert res.status_code == 404
