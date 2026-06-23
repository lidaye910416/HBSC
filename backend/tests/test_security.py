from app.security import hash_password, verify_password, create_access_token, decode_access_token
import time


def test_hash_and_verify_password_roundtrip():
    h = hash_password("hello-world-123")
    assert h.startswith("$2b$") or h.startswith("$2a$")
    assert verify_password("hello-world-123", h) is True
    assert verify_password("wrong", h) is False


def test_create_and_decode_access_token():
    token = create_access_token(sub="admin", expires_hours=1)
    payload = decode_access_token(token)
    assert payload["sub"] == "admin"
    assert "exp" in payload


def test_decode_expired_token_raises():
    token = create_access_token(sub="admin", expires_hours=-1)
    try:
        decode_access_token(token)
        assert False, "expected exception"
    except Exception:
        pass