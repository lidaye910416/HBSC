"""DOCX import: extracted images become MediaAssets before Markdown returns.

The legacy flow had the import endpoint write extracted image bytes
directly under ``/uploads/imports/``. The unified flow funnels those
bytes through ``media_storage.store_image`` so each image is a
``MediaAsset(source='docx')`` row that the asset library sees.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.routers import admin_articles_import as import_router  # noqa: E402
from app.services.docx_import import ExtractedDocxImage, ImportResult  # noqa: E402
from conftest import make_png_bytes  # noqa: E402


def fake_result_with_png_bytes(_content: bytes, *, media_dir=None) -> ImportResult:
    """Stand-in for ``convert_docx_to_markdown`` returning one extracted PNG.

    The router signature passes ``media_dir`` through the legacy kwargs,
    so we accept and ignore it.
    """
    _ = media_dir
    return ImportResult(
        title="Imported",
        content_markdown="![](media/image1.png)",
        suggested_slug="imported",
        warnings=[],
        images=[ExtractedDocxImage(original_name="image1.png", content=make_png_bytes())],
    )


def test_import_creates_docx_assets_before_returning_markdown(admin_client, monkeypatch):
    monkeypatch.setattr(import_router, "convert_docx_to_markdown", fake_result_with_png_bytes)
    valid_docx_file = (
        "fixture.docx",
        io.BytesIO(b"PK\x03\x04"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    response = admin_client.post("/api/admin/articles/import-docx", files={"file": valid_docx_file})
    assert response.status_code == 200, response.text
    body = response.json()
    image = body["images"][0]
    assert image["url"].startswith("/uploads/")
    # The Markdown returned by the endpoint references the canonical URL,
    # not the original media/image1.png placeholder.
    assert f"![]({image['url']})" in body["content_markdown"]
    # The asset should be findable in the media library (it has source='docx').
    media = admin_client.get("/api/admin/media").json()
    assert any(item["source"] == "docx" and item["url"] == image["url"] for item in media["items"])


def test_import_stamps_source_ref_with_request_id(admin_client, media_test_env, monkeypatch):
    """Spec §5.1 — every DOCX-derived asset gets ``source_ref=request_id``.

    The endpoint returns the per-request id; the persisted ``MediaAsset``
    row must carry the same value in ``source_ref`` so audit reports can
    correlate the row back to the exact import call.
    """
    from app.models.media import MediaAsset

    monkeypatch.setattr(import_router, "convert_docx_to_markdown", fake_result_with_png_bytes)
    valid_docx_file = (
        "fixture.docx",
        io.BytesIO(b"PK\x03\x04"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    response = admin_client.post("/api/admin/articles/import-docx", files={"file": valid_docx_file})
    assert response.status_code == 200, response.text
    request_id = response.json()["request_id"]
    assert request_id

    db = media_test_env["Session"]()
    try:
        docx_assets = db.query(MediaAsset).filter(MediaAsset.source == "docx").all()
        assert docx_assets, "expected at least one docx MediaAsset"
        assert all(a.source_ref == request_id for a in docx_assets)
    finally:
        db.close()
