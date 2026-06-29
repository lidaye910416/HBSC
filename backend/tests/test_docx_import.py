import io
import zipfile

import pytest

from app.services.docx_import import (
    extract_docx_images,
    ImportResult,
    PandocUnavailable,
)


def _make_fake_docx_with_images(images: dict[str, bytes]) -> bytes:
    """Build a minimal .docx-like zip containing only the image entries."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in images.items():
            zf.writestr(f"word/media/{name}", data)
    return buf.getvalue()


def test_extract_docx_images_returns_mapping(tmp_path):
    payload = _make_fake_docx_with_images({"a.png": b"\x89PNG_FAKE", "b.jpg": b"\xff\xd8FAKE"})
    result = extract_docx_images(payload, dest_root=tmp_path)
    assert isinstance(result, dict)
    assert set(result.keys()) == {"a.png", "b.jpg"}
    for fname, info in result.items():
        assert info["filename"] == fname
        assert info["size"] > 0
        # Files written
        on_disk = tmp_path / info["rel_path"]
        assert on_disk.exists()


def test_extract_docx_images_rejects_non_zip(tmp_path):
    with pytest.raises(ValueError):
        extract_docx_images(b"not a zip", dest_root=tmp_path)
