"""Regression tests for the /api/auth/login rate-limit bug.

Bug (2026-07-05): the @rate_limit decorator wrapped the entire login
endpoint, so every POST — successful or not — consumed a token from the
bucket. After 5 attempts the bucket was empty and even the *correct*
password returned 429 "Too Many Requests". Users saw this as a
"password is wrong" error and entered a retry spiral.

Fix: rate-limit only failed verifications. Successful logins must never
be blocked by prior failures, and prior failures within the window
must still lock out further attempts (attack protection preserved).
"""
from __future__ import annotations

import bcrypt
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.middleware.rate_limit import reset_buckets


REAL_PASSWORD = "test-admin-pass-12345"


@pytest.fixture()
def real_password(monkeypatch):
    """Pin a known admin password on the live settings singleton."""
    hashed = bcrypt.hashpw(
        REAL_PASSWORD.encode("utf-8"),
        bcrypt.gensalt(rounds=4),  # low cost — tests just need a valid hash
    ).decode("utf-8")
    monkeypatch.setattr(settings, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD_HASH", hashed)
    return REAL_PASSWORD


@pytest.fixture()
def client(real_password):
    """TestClient with rate-limit buckets cleared between tests."""
    reset_buckets()
    with TestClient(app) as c:
        yield c
    reset_buckets()


# ── RED: the bug we're fixing ───────────────────────────────────────────

def test_six_successful_logins_all_return_200(client, real_password):
    """The headline bug: 6 consecutive CORRECT logins must all return 200.

    Before the fix, the @rate_limit decorator consumed a token on every
    call, so the 6th attempt returned 429 even with the right password.
    """
    for i in range(6):
        r = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": real_password},
        )
        assert r.status_code == 200, (
            f"correct password try #{i + 1} returned {r.status_code}, "
            f"expected 200 — success consumed a rate-limit token (regression)"
        )


# ── Preserve attack protection ─────────────────────────────────────────

def test_six_failed_logins_lock_at_sixth(client):
    """5 wrong-password attempts return 401; the 6th must return 429.

    We must not weaken brute-force protection while fixing the success-path
    bug. Failed verifications still consume tokens and lock the bucket.
    """
    for i in range(5):
        r = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "definitely-wrong"},
        )
        assert r.status_code == 401, (
            f"wrong password try #{i + 1} returned {r.status_code}, expected 401"
        )
    r = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "definitely-wrong"},
    )
    assert r.status_code == 429, (
        f"6th wrong-password attempt returned {r.status_code}, expected 429 "
        f"— failed logins must still trip the lockout"
    )


# ── Mixed: prior failures don't block subsequent successes ─────────────

def test_three_failures_then_three_successes_all_pass(client, real_password):
    """3 failed attempts leave 2 tokens; 3 correct logins must all return 200.

    With the bug, every login consumed a token, so this combination was
    impossible to express. With the fix, only the 3 failures consume
    tokens; the 3 successes verify against an open bucket.
    """
    for _ in range(3):
        r = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong-1"},
        )
        assert r.status_code == 401

    for i in range(3):
        r = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": real_password},
        )
        assert r.status_code == 200, (
            f"success #{i + 1} after 3 failures returned {r.status_code}, "
            f"expected 200 — prior failures shouldn't block legitimate logins"
        )