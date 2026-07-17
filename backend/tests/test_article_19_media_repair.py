"""Article 19 four-image repair: exact pair validation, zero-write failures.

The repair function is fail-closed. ANY mismatch (caption number, path
number, missing pair, extra placeholder, missing healthy file) raises
``Article19RepairMismatch`` BEFORE writing the backup file or returning
the transformed content.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest  # noqa: E402

from app.services.media_migration import (  # noqa: E402
    Article19RepairMismatch,
    repair_article_19,
)


_HEALTHY = {f"source-images/19-hongan-medical/image{i}.png" for i in range(1, 5)}


def _content(template: str = "前文\n图1 总体架构\n（图像路径：/uploads/source-images/19-hongan-medical/image1.png）\n中间\n图2 数据架构\n（图像路径：/uploads/source-images/19-hongan-medical/image2.png）\n图3 服务架构\n（图像路径：/uploads/source-images/19-hongan-medical/image3.png）\n图4 安全架构\n（图像路径：/uploads/source-images/19-hongan-medical/image4.png）\n后文") -> str:  # noqa: E501
    return template


def test_repair_replaces_exact_four_pairs_and_preserves_other_content(tmp_path):
    before = _content()
    after = repair_article_19(before, healthy_paths=_HEALTHY, report_dir=tmp_path)
    assert after.count("![图") == 4
    assert "图像路径" not in after
    assert after.startswith("前文") and after.endswith("后文")
    assert (tmp_path / "article-19-before.md").read_text() == before


def test_repair_writes_sha256_sidecar(tmp_path):
    before = _content()
    repair_article_19(before, healthy_paths=_HEALTHY, report_dir=tmp_path)
    sidecar = (tmp_path / "article-19-before.sha256").read_text().strip()
    assert len(sidecar) == 64


def test_repair_missing_pair_raises_and_writes_nothing(tmp_path):
    before = _content().replace(
        "图3 服务架构\n（图像路径：/uploads/source-images/19-hongan-medical/image3.png）\n",
        "",
    )
    with pytest.raises(Article19RepairMismatch):
        repair_article_19(before, healthy_paths=_HEALTHY, report_dir=tmp_path)
    assert not (tmp_path / "article-19-before.md").exists()


def test_repair_unhealthy_file_raises(tmp_path):
    before = _content()
    with pytest.raises(Article19RepairMismatch):
        repair_article_19(
            before,
            healthy_paths=_HEALTHY - {"source-images/19-hongan-medical/image4.png"},
            report_dir=tmp_path,
        )
    assert not (tmp_path / "article-19-before.md").exists()


def test_repair_caption_number_mismatch_raises(tmp_path):
    # Caption claims image2 but placeholder points at image1.
    before = _content().replace(
        "图1 总体架构\n（图像路径：/uploads/source-images/19-hongan-medical/image1.png）",
        "图1 总体架构\n（图像路径：/uploads/source-images/19-hongan-medical/image2.png）",
    )
    with pytest.raises(Article19RepairMismatch):
        repair_article_19(before, healthy_paths=_HEALTHY, report_dir=tmp_path)
    assert not (tmp_path / "article-19-before.md").exists()


def test_repair_duplicate_number_raises(tmp_path):
    # Two captions both say figure 1 — gives duplicates rather than 1..4.
    before = _content().replace(
        "图2 数据架构",
        "图1 数据架构",
    )
    with pytest.raises(Article19RepairMismatch):
        repair_article_19(before, healthy_paths=_HEALTHY, report_dir=tmp_path)
    assert not (tmp_path / "article-19-before.md").exists()


def test_repair_changed_punctuation_raises(tmp_path):
    # Fullwidth comma replaced with half-width — the placeholder regex
    # only matches the exact form, so it should never match.
    before = _content().replace(
        "（图像路径：/uploads/source-images/19-hongan-medical/image1.png）",
        "(图像路径:/uploads/source-images/19-hongan-medical/image1.png)",
    )
    with pytest.raises(Article19RepairMismatch):
        repair_article_19(before, healthy_paths=_HEALTHY, report_dir=tmp_path)
    assert not (tmp_path / "article-19-before.md").exists()
