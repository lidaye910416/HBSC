"""Article CRUD end-to-end usage sync: create / save / delete.

These tests verify that the article CRUD endpoints (not the media API)
keep ``MediaUsage`` rows in sync with the article content/cover, and
that the upload-marker guard rejects incomplete saves.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest  # noqa: E402

from app.models.journal import Article, Journal  # noqa: E402
from app.models.media import MediaUsage  # noqa: E402


@pytest.fixture()
def article_with_asset(media_test_env, media_asset):
    db = media_test_env["Session"]()
    journal = Journal(id=7, title="J7", slug="j7", status="published")
    article = Article(
        id=70, title="Delete me", slug="delete-me",
        journal=journal, status="draft",
    )
    db.add(article); db.flush()
    db.add(MediaUsage(
        asset_id=media_asset.asset.id,
        owner_type="article", owner_id=article.id,
        field="content",
    ))
    db.commit()
    asset_id = media_asset.asset.id
    article_id = article.id
    db.close()
    return {"id": article_id, "asset_id": asset_id}


def test_create_article_syncs_body_and_cover_usages(admin_client, media_asset):
    body = {
        "title": "A", "slug": "a", "status": "draft",
        "content": f"![x]({media_asset.url})",
        "cover_image": media_asset.url,
    }
    response = admin_client.post("/api/admin/articles", json=body)
    assert response.status_code == 200, response.text
    article_id = response.json()["id"]
    usages = admin_client.get(
        f"/api/admin/media/{media_asset.asset.id}/usages",
    ).json()
    fields = {(u["field"], u["reference_count"]) for u in usages}
    assert fields == {("content", 1), ("cover_image", 1)}


def test_save_rejects_residual_upload_marker(admin_client):
    response = admin_client.post("/api/admin/articles", json={
        "title": "A", "slug": "upload-marker-test", "status": "draft",
        "content": "x<!--hbsc-upload:123-->y",
    })
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "upload_incomplete"


def test_article_delete_removes_usages_but_keeps_asset(admin_client, article_with_asset):
    response = admin_client.delete(
        f"/api/admin/articles/{article_with_asset['id']}",
    )
    assert response.status_code == 200
    assert admin_client.get(
        f"/api/admin/media/{article_with_asset['asset_id']}",
    ).status_code == 200
