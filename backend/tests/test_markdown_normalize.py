# -*- coding: utf-8 -*-
"""Regression tests for app.services.markdown_normalize.

Each test pairs a representative input with the expected output for ONE
phase of the pipeline. Together they cover the five phases listed in
the module docstring:

    1. pandoc residue strip
    2. plain table conversion
    3. extended table conversion
    4. CJK punctuation
    5. image path rewrite
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make `app.*` importable when pytest is run from the backend root or
# from anywhere else — pytest.ini's testpaths only controls discovery,
# not the import path.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.markdown_normalize import (  # noqa: E402
    SLUG_TO_IMAGE_DIR,
    convert_extended_tables,
    convert_plain_tables,
    normalize_markdown_text,
    normalize_pandoc,
    normalize_punctuation,
    pandoc_residue_summary,
    resolve_legacy_image_src,
    rewrite_image_paths,
)


# ---------------------------------------------------------------------------
# 1. Pandoc residue
# ---------------------------------------------------------------------------

def test_pandoc_unwraps_bracket_mark():
    """[段落]{.mark} → 段落 (inner text only)."""
    before = "[自动驾驶接驳实践研究]{.mark}"
    after = normalize_pandoc(before)
    assert after == "自动驾驶接驳实践研究"


def test_pandoc_drops_standalone_attribute_blocks():
    """{#id .unnumbered} and {.unnumbered} → empty."""
    before = "## 引言 {#sec:intro .unnumbered}\n\n正文 {.unnumbered}"
    after = normalize_pandoc(before)
    assert "{#sec:intro" not in after
    assert "{.unnumbered}" not in after
    assert "## 引言" in after
    assert "正文" in after


def test_pandoc_unwraps_escaped_citation_brackets():
    """\\[1\\] → [1] (two literal backslashes in the source)."""
    # In a normal Python string, "\\[" is two chars: backslash, [.
    # That's what pandoc emits in the .md output.
    before = "见引用\\[1\\]以及\\[2\\]的内容"
    after = normalize_pandoc(before)
    assert "\\[1\\]" not in after
    assert "[1]" in after
    assert "[2]" in after


def test_pandoc_strips_image_width_attributes():
    """![](media/x.png){width="6.5in" height="1.4in"} → ![](media/x.png)."""
    before = '![](media/image1.png){width="6.59375in" height="1.429861111111111in"}'
    after = normalize_pandoc(before)
    assert 'width="6.5' not in after
    assert 'media/image1.png)' in after
    # No dangling "{...}"
    assert "{" not in after


def test_pandoc_unwraps_emphasis_around_brackets():
    """**[Title]** → Title; [**摘要：** foo] → **摘要：** foo."""
    before = "**[自动驾驶接驳实践研究]**\n\n[**摘要：** 研究方法]"
    after = normalize_pandoc(before)
    assert "自动驾驶接驳实践研究" in after
    # The 「**摘要：**」 emphasis is preserved (the wrapper is the
    # double-bracketed label, not the whole span)
    assert "**摘要：**" in after
    # No leftover **[ or ]** artifacts
    assert "**[" not in after
    assert "]**" not in after


def test_pandoc_collapses_blank_lines():
    """3+ blank lines → 2."""
    before = "para1\n\n\n\n\npara2"
    after = normalize_pandoc(before)
    assert "\n\n\n" not in after
    assert "para1\n\npara2" in after


# ---------------------------------------------------------------------------
# 2. Plain tables → GFM
# ---------------------------------------------------------------------------

def test_plain_table_converted_to_gfm():
    """Whitespace-aligned plain table → GFM pipe table.

    Pandoc emits a top separator, header, ANOTHER separator, data rows,
    then a closing separator. The function walks: top-sep, header,
    skip inner separators, collect data rows until closing-sep.
    """
    before = (
        "------  -------------------  ------\n"
        "行业    核心痛点             数字化水平\n"
        "------  -------------------  ------\n"
        "高端装备  关键零部件依赖进口  L1-L2\n"
        "汽车制造  工艺协同            L2-L3\n"
        "------  -------------------  ------\n"
    )
    new_text, count = convert_plain_tables(before)
    assert count == 1
    lines = new_text.splitlines()
    assert lines[0] == "| 行业 | 核心痛点 | 数字化水平 |"
    assert lines[1] == "| --- | --- | --- |"
    assert lines[2] == "| 高端装备 | 关键零部件依赖进口 | L1-L2 |"
    assert lines[3] == "| 汽车制造 | 工艺协同 | L2-L3 |"


def test_plain_table_with_separator_above_and_below():
    """Top + bottom separator lines (whitespace-aligned) wrapping data."""
    before = (
        "------  -------------------  ------\n"
        "维度    描述                 等级\n"
        "------  -------------------  ------\n"
        "A        高端                L1\n"
        "------  -------------------  ------\n"
    )
    new_text, count = convert_plain_tables(before)
    assert count == 1
    assert new_text.startswith("| 维度 | 描述 | 等级 |")
    assert "| A | 高端 | L1 |" in new_text


# ---------------------------------------------------------------------------
# 3. Extended tables (+---+ / |…|) → GFM
# ---------------------------------------------------------------------------

def test_extended_table_converted_to_gfm():
    before = (
        "+----+----+\n"
        "| a  | b  |\n"
        "+----+----+\n"
        "| 1  | 2  |\n"
        "+----+----+\n"
    )
    new_text, count = convert_extended_tables(before)
    assert count == 1
    lines = new_text.splitlines()
    assert lines[0] == "| a | b |"
    assert lines[1] == "| --- | --- |"
    assert lines[2] == "| 1 | 2 |"


def test_extended_table_merges_wrapped_rows():
    """A wrapped row (one cell empty) gets concatenated to the previous row.

    Real pandoc extended tables use `+---+` for ALL separators (top,
    between rows, and bottom). The function only recognizes `+` followed
    by dash/whitespace runs, so a `+====+` row would not be matched.
    """
    before = (
        "+----+------+\n"
        "| a  | b    |\n"
        "+----+------+\n"
        "| long cell | next |\n"
        "|           | cont |\n"
        "+----+------+\n"
    )
    new_text, count = convert_extended_tables(before)
    assert count == 1
    # The wrapped row should produce a single data row
    data_rows = [
        ln for ln in new_text.splitlines()
        if ln.startswith("|") and not ln.startswith("| ---")
    ]
    # header + 1 merged data row = 2 table-body lines (excluding separator)
    assert len(data_rows) == 2
    assert "long cell" in data_rows[1]
    assert "cont" in data_rows[1]


# ---------------------------------------------------------------------------
# 4. CJK punctuation
# ---------------------------------------------------------------------------

def test_cjk_half_width_period_to_full_width():
    """汉字.汉字 → 汉字。汉字."""
    before = "据某研究.结果显示"
    after = normalize_punctuation(before)
    assert "。" in after
    assert "据某研究。结果显示" == after


def test_cjk_half_width_parens_to_full_width():
    """汉字(汉字) → 汉字（汉字）."""
    before = "测试(内容)继续"
    after = normalize_punctuation(before)
    assert "（" in after and "）" in after
    assert "测试（内容）继续" == after


def test_prose_dashes_become_em_dash():
    """6+ dashes in prose → —— (em-dash)."""
    before = "策略A------策略B"
    after = normalize_punctuation(before)
    assert "——" in after
    assert "---" not in after


def test_table_separator_lines_untouched():
    """GFM and pandoc extended separators are NOT touched."""
    gfm_sep = "| --- | --- | --- |"
    ext_sep = "+----+----+"
    assert normalize_punctuation(gfm_sep) == gfm_sep
    assert normalize_punctuation(ext_sep) == ext_sep


def test_cjk_letter_collapse():
    """CJK + space + letter/digit + space + CJK → no space."""
    # 汉 A 字 — letter sandwiched between CJK chars
    before = "汉 A 字"
    after = normalize_punctuation(before)
    assert "汉A字" in after


# ---------------------------------------------------------------------------
# 5. Image path rewrite
# ---------------------------------------------------------------------------

def test_image_rewrite_for_known_slug():
    """media/foo.png with known slug → /uploads/source-images/<subdir>/foo.png."""
    before = "![alt](media/image1.png)"
    after = rewrite_image_paths(before, slug="openclaw-agent-framework")
    assert after == f"![alt](/uploads/source-images/{SLUG_TO_IMAGE_DIR['openclaw-agent-framework']}/image1.png)"


def test_image_rewrite_no_op_for_unknown_slug():
    """Unknown slug leaves the text alone."""
    before = "![alt](media/image1.png)"
    after = rewrite_image_paths(before, slug="some-unknown-slug")
    assert after == before


def test_image_rewrite_no_op_for_none_slug():
    """None slug leaves the text alone."""
    before = "![alt](media/image1.png)"
    assert rewrite_image_paths(before, slug=None) == before


def test_resolve_legacy_image_src_known_slug():
    src = resolve_legacy_image_src("media/image1.png", "openclaw-agent-framework")
    expected = f"/uploads/source-images/{SLUG_TO_IMAGE_DIR['openclaw-agent-framework']}/image1.png"
    assert src == expected


def test_resolve_legacy_image_src_unknown_slug():
    # Unknown slug returns None — the caller decides whether to skip or
    # surface the unresolved reference.
    assert resolve_legacy_image_src("media/x.png", "not-in-map") is None


def test_resolve_legacy_image_src_non_media_prefix():
    # Anything that doesn't start with media/ is a no-op.
    assert resolve_legacy_image_src("/uploads/foo.png", "openclaw-agent-framework") is None


# ---------------------------------------------------------------------------
# End-to-end: full pipeline
# ---------------------------------------------------------------------------

def test_full_pipeline_is_idempotent():
    """normalize_markdown_text applied twice is a no-op the second time."""
    sample = (
        "# 标题\n\n"
        "这是正文.还有更多.内容\n"
        "[段落]{.mark}\n"
        "\\[1\\] 引用\n"
        "![](media/image1.png){width=\"6.5in\" height=\"1.4in\"}\n"
    )
    once = normalize_markdown_text(sample, slug="openclaw-agent-framework")
    twice = normalize_markdown_text(once, slug="openclaw-agent-framework")
    assert once == twice


def test_full_pipeline_drops_all_known_residue():
    """All four categories of residue should be 0 after a full pass."""
    sample = (
        "见引用. 还有更多\n"
        "[段落]{.mark}\n"
        "\\[1\\]\n"
        "![](media/x.png){width=\"6in\"}\n"
    )
    after = normalize_markdown_text(sample, slug="openclaw-agent-framework")
    summary = pandoc_residue_summary(after)
    assert summary["bracket_marks"] == 0
    assert summary["escaped_brackets"] == 0
    assert summary["image_width_attrs"] == 0
    assert summary["cjk_half_width_period"] == 0
    # image was rewritten to absolute URL
    assert "/uploads/source-images/03-openclaw/x.png" in after


def test_pandoc_residue_summary_counts():
    """The diagnostics function returns the right counts on a known sample."""
    sample = (
        "[A]{.mark}\n"
        "\\[1\\] \\[2\\]\n"
        "![](m/x.png){width=\"6in\"}\n"
        "汉.字 汉.字\n"
        "汉字(汉)\n"
    )
    s = pandoc_residue_summary(sample)
    assert s["bracket_marks"] == 1
    assert s["escaped_brackets"] == 2
    assert s["image_width_attrs"] == 1
    assert s["cjk_half_width_period"] == 2
    assert s["cjk_half_width_paren"] == 1
    # No tables in this sample
    assert s["plain_table_seps"] == 0
    assert s["extended_table_seps"] == 0
