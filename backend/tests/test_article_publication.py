"""Tests for article publication invariants.

A draft may be unassigned; a published article MUST have a valid
(non-null, existing) journal_id. Applies to POST /articles, PUT
/articles/{id}, and the dedicated POST /articles/{id}/publish route.
A non-null journal_id that doesn't exist must also be rejected at the
write boundary.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest


@pytest.fixture()
def unassigned_draft(admin_client):
    response = admin_client.post(
        "/api/admin/articles",
        json={"title": "Unassigned", "slug": "unassigned", "status": "draft"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return SimpleNamespace(id=body["id"])


def test_draft_may_be_unassigned(admin_client):
    response = admin_client.post(
        "/api/admin/articles",
        json={"title": "Draft", "slug": "draft", "status": "draft"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["journal_id"] is None


def test_create_published_requires_journal(admin_client):
    response = admin_client.post(
        "/api/admin/articles",
        json={"title": "P", "slug": "p", "status": "published"},
    )
    assert response.status_code == 422, response.text
    code = response.json().get("error", {}).get("code")
    assert code == "unassigned_journal"


def test_put_transition_to_published_requires_journal(admin_client, unassigned_draft):
    response = admin_client.put(
        f"/api/admin/articles/{unassigned_draft.id}",
        json={"status": "published"},
    )
    assert response.status_code == 422, response.text
    code = response.json().get("error", {}).get("code")
    assert code == "unassigned_journal"


def test_dedicated_publish_requires_journal(admin_client, unassigned_draft):
    response = admin_client.post(
        f"/api/admin/articles/{unassigned_draft.id}/publish",
    )
    assert response.status_code == 422, response.text
    code = response.json().get("error", {}).get("code")
    assert code == "unassigned_journal"


def test_any_non_null_journal_id_must_exist(admin_client):
    response = admin_client.post(
        "/api/admin/articles",
        json={
            "title": "D",
            "slug": "d",
            "status": "draft",
            "journal_id": 999,
        },
    )
    assert response.status_code == 422, response.text
    code = response.json().get("error", {}).get("code")
    assert code == "invalid_journal"


def test_published_article_with_existing_journal_accepted(admin_client):
    """Seed a journal via the admin endpoint, then publish with that id."""
    j = admin_client.post(
        "/api/admin/journals",
        json={"title": "Test issue", "slug": "test-issue", "status": "published"},
    )
    assert j.status_code == 200, j.text
    jid = j.json()["id"]
    response = admin_client.post(
        "/api/admin/articles",
        json={
            "title": "OK",
            "slug": "ok",
            "status": "published",
            "journal_id": jid,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["journal_id"] == jid