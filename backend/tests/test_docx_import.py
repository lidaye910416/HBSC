import io
import shutil
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


def _have_pandoc() -> bool:
    return shutil.which("pandoc") is not None


@pytest.mark.skipif(not _have_pandoc(), reason="pandoc not installed locally")
def test_convert_docx_returns_markdown(tmp_path):
    from app.services.docx_import import convert_docx_to_markdown
    real_docx = tmp_path / "tiny.docx"
    # Create a minimal valid .docx with pandoc itself for the test fixture.
    import subprocess
    md_path = tmp_path / "src.md"
    md_path.write_text("# Hello\n\nWorld.\n", encoding="utf-8")
    subprocess.run(["pandoc", str(md_path), "-o", str(real_docx)], check=True)
    result = convert_docx_to_markdown(real_docx.read_bytes())
    assert "Hello" in result.title or "Hello" in result.content_markdown
    assert "World" in result.content_markdown


def test_convert_docx_raises_when_pandoc_missing(monkeypatch):
    from app.services import docx_import as mod
    monkeypatch.setattr(mod, "_find_pandoc", lambda: None)
    with pytest.raises(PandocUnavailable):
        mod.convert_docx_to_markdown(b"\x00")
