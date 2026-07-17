"""Unified admin media API: pagination shape, compatibility aliases,
usage-safe delete, search/usage/health filters.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from hashlib import sha256  # noqa: E402
from PIL import Image  # noqa: E402


def png_bytes(color: str = "red") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), color).save(buf, "PNG")
    return buf.getvalue()


def test_upload_returns_new_fields_and_compatibility_aliases(admin_client, png_file):
    response = admin_client.post("/api/admin/media?kind=image&source=upload", files={"file": png_file})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["url"] == f"/uploads/{body['storage_path']}"
    assert body["filename"] == body["storage_path"].split("/")[-1]
    assert body["mime"] == body["mime_type"] == "image/png"
    assert body["size"] == body["byte_size"]
    assert body["uploaded_at"] == body["created_at"]
    assert body["kind"] == "image"


def test_media_list_has_project_pagination_shape(admin_client):
    body = admin_client.get("/api/admin/media?page=1&per_page=24").json()
    assert set(body) == {"items", "total", "page", "per_page"}


def test_delete_referenced_asset_returns_usage_details(admin_client, referenced_asset):
    response = admin_client.delete(f"/api/admin/media/{referenced_asset.id}")
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "asset_in_use"
    assert body["error"]["usages"][0]["owner_id"] == 19


def test_get_usages_returns_owner_field_count(admin_client, referenced_asset):
    response = admin_client.get(f"/api/admin/media/{referenced_asset.id}/usages")
    assert response.status_code == 200
    usages = response.json()
    assert {u["owner_type"] for u in usages} == {"article"}
    assert usages[0]["owner_id"] == 19
    assert usages[0]["field"] == "content"


def test_restore_round_trip_changes_status(admin_client, referenced_asset):
    # referenced asset cannot be trashed while it has usages
    trash_resp = admin_client.delete(f"/api/admin/media/{referenced_asset.id}")
    assert trash_resp.status_code == 409
    # An unreferenced asset can be trashed + restored.
    admin_client.headers  # ensure header set
    other = admin_client.post(
        "/api/admin/media?kind=image&source=upload",
        files={"file": ("other.png", io.BytesIO(png_bytes("blue")), "image/png")},
    )
    assert other.status_code == 200, other.text
    other_id = other.json()["id"]
    trash = admin_client.delete(f"/api/admin/media/{other_id}")
    assert trash.status_code == 200
    listed = admin_client.get(f"/api/admin/media/{other_id}").json()
    assert listed["status"] == "trashed"
    assert listed["trashed_at"] is not None
    restored = admin_client.post(f"/api/admin/media/{other_id}/restore")
    assert restored.status_code == 200
    listed = admin_client.get(f"/api/admin/media/{other_id}").json()
    assert listed["status"] == "active"
    assert listed["trashed_at"] is None


def test_table_upload_returns_csv_row_without_creating_image_asset(admin_client):
    csv_bytes = b"col1,col2\na,b\n"
    response = admin_client.post(
        "/api/admin/media?kind=table",
        files={"file": ("sheet.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "table"
    assert body["url"].endswith(".csv")


def test_generate_route_still_returns_compatible_envelope(admin_client, monkeypatch):
    """The AI image generator still works through the new admin_media router.

    Patches ``generate_image_assets`` at the call site (admin_media) so
    the test doesn't have to mock the upstream ``image_gen`` module
    before the router import-time lookup runs.
    """
    from dataclasses import dataclass
    from app.routers import admin_media as media_router

    class _FakeGenerate:
        async def __call__(self, prompt: str, aspect_ratio: str = "16:9"):
            @dataclass
            class R:
                content: bytes
                prompt: str
                model: str
                generation_status: str
            return R(
                content=png_bytes("purple"),
                prompt=prompt,
                model="test-model",
                generation_status="placeholder",
            )

    monkeypatch.setattr(media_router, "generate_image_assets", _FakeGenerate())
    response = admin_client.post(
        "/api/admin/media/generate",
        json={"prompt": "logo", "aspect_ratio": "1:1"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "image"
    assert body["prompt"] == "logo"
    assert body["model"] == "test-model"
    assert body["status"] == "placeholder"


def test_search_filter_finds_assets_by_original_name(admin_client):
    admin_client.post(
        "/api/admin/media?kind=image&source=upload",
        files={"file": ("unique-name.png", io.BytesIO(png_bytes()), "image/png")},
    )
    listed = admin_client.get("/api/admin/media?q=unique-name").json()
    assert listed["total"] >= 1
    assert any("unique-name" in item["original_name"] for item in listed["items"])


def test_q_too_long_returns_422(admin_client):
    response = admin_client.get("/api/admin/media", params={"q": "x" * 200})
    assert response.status_code == 422


def test_usage_filter_uses_used_unused_contract(admin_client, referenced_asset):
    """Spec §7.2 — the media list ``usage`` filter is ``used`` / ``unused``.

    ``referenced_asset`` seeds one asset with a ``content`` usage (used);
    a freshly uploaded asset has no usages (unused). The legacy
    ``referenced`` / ``orphan`` alias must be rejected with 422.
    """
    used_id = referenced_asset.id
    unused = admin_client.post(
        "/api/admin/media?kind=image&source=upload",
        files={"file": ("unused.png", io.BytesIO(png_bytes("green")), "image/png")},
    )
    assert unused.status_code == 200, unused.text
    unused_id = unused.json()["id"]

    used = admin_client.get("/api/admin/media?usage=used").json()
    used_ids = {item["id"] for item in used["items"]}
    assert used_id in used_ids
    assert unused_id not in used_ids

    unused_list = admin_client.get("/api/admin/media?usage=unused").json()
    unused_ids = {item["id"] for item in unused_list["items"]}
    assert unused_id in unused_ids
    assert used_id not in unused_ids

    # Legacy alias no longer accepted.
    assert admin_client.get("/api/admin/media?usage=referenced").status_code == 422


def test_health_filter_reports_missing_file(admin_client, media_test_env):
    # media_asset fixture places a real file + asset; write a stale row on top.
    Session = media_test_env["Session"]
    db = Session()
    storage_path = "stale/missing.png"
    target = media_test_env["upload_root"] / storage_path
    target.parent.mkdir(parents=True, exist_ok=True)
    # Don't write the file → asset has storage_path but no bytes on disk.
    content = png_bytes()
    from app.models.media import MediaAsset
    asset = MediaAsset(
        storage_path=storage_path, original_name="missing.png",
        mime_type="image/png", byte_size=len(content), width=32, height=24,
        sha256=sha256(content).hexdigest(),
        source="upload", status="active", uploaded_by="admin",
    )
    db.add(asset); db.commit(); db.refresh(asset)
    db.close()
    response = admin_client.get("/api/admin/media?health=missing_file").json()
    assert any(item["storage_path"] == storage_path for item in response["items"])
