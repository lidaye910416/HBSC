from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

from app.main import app
from app.database import Base, get_db
from app.security import hash_password
from app.config import settings


@pytest.fixture
def client(monkeypatch, tmp_path):
    """临时 SQLite + 设置管理员凭据。"""
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
    monkeypatch.setattr(settings, "ADMIN_USERNAME", "testadmin")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD_HASH", hash_password("correctpw"))

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def test_login_success_returns_token(client):
    res = client.post("/api/auth/login", json={"username": "testadmin", "password": "correctpw"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_wrong_password_401(client):
    res = client.post("/api/auth/login", json={"username": "testadmin", "password": "wrong"})
    assert res.status_code == 401


def test_login_unknown_user_401(client):
    res = client.post("/api/auth/login", json={"username": "nobody", "password": "x"})
    assert res.status_code == 401


def test_me_requires_token(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401


def test_me_returns_username(client):
    token_res = client.post("/api/auth/login", json={"username": "testadmin", "password": "correctpw"})
    token = token_res.json()["access_token"]
    res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["username"] == "testadmin"


def test_me_rejects_invalid_token(client):
    res = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"})
    assert res.status_code == 401
