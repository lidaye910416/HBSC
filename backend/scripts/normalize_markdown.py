#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Normalize article markdown content for proper rendering.

This script fixes two classes of issues that came from pandoc-converted .docx
sources:

1. **Pandoc residue** that leaks into the rendered HTML:
   - `[段落文字]{.mark}` → unwrap, keep inner text
   - `{#id .unnumbered}` / `{.unnumbered}` / `{#id}` → drop
   - `{=html}` blocks and `<!-- -->` HTML comments → drop
   - `\\\[N\\\]` (escaped reference brackets) → `[N]`
   - `**\[...\]` emphasis wrappers around bracket labels → unwrap
   - Backslash line continuation `\` at EOL → join lines

2. **Punctuation / typography** that drifts from Chinese full-width convention:
   - `------` (6+ dashes) in body text → `——` (em-dash); keep table separators
   - Half-width period `.` between CJK characters → `。` (full-width)
   - Half-width parentheses between CJK → `（）`
   - Collapse CJK + space + digit/letter + space + CJK → CJK + digit + CJK

3. **Image references** that don't resolve to disk paths:
   - `media/imageN.ext` → `/uploads/source-images/{slug-subdir}/imageN.ext`
     (slug → subdir mapping below)

The script supports `--dry-run` (default) and `--apply`. Diff is printed per
article before any write.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# Ensure backend root is on sys.path so `app.*` imports resolve
BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal  # noqa: E402
from app.models import Article  # noqa: E402


# Slug → on-disk image subdir under uploads/source-images/
# Source: audit report 2026-06-26 (34 in-body image refs across 6 articles)
SLUG_TO_IMAGE_DIR: dict[str, str] = {
    "openclaw-agent-framework": "03-openclaw",
    "jiayu-county-governance-platform": "06-jiayuxian",
    "esb-architecture-liantou": "07-liantouESB",
    "q1-2026-news-summary": "08-xinwenhuizong",
    "xia-junchao-youth-pioneer": "09-xiajunchao",
    "autonomous-driving-wuhan-newcity": "11-zidongjiashijiebo",
}


CJK = "一-鿿㐀-䶿"  # CJK Unified Ideographs + Extension A


def _normalize_pandoc(text: str) -> str:
    """Strip pandoc residue that react-markdown would render literally.

    Order matters: unwrap [...]{.mark} BEFORE stripping standalone {...}
    blocks, otherwise the {.mark} is gone before the bracket-pair regex can
    match it.
    """

    # 1. Unwrap [...]{.mark} and similar bracket-class wrappers FIRST.
    #    Example: "[自动驾驶接驳实践研究]{.mark}" → "自动驾驶接驳实践研究"
    text = re.sub(
        r"\[([^\]\n]+?)\]\{[#.][^\n}]*\}",
        r"\1",
        text,
    )

    # 2. Drop remaining standalone pandoc attribute blocks (now without
    #    their preceding [...] pair): {#id}, {.class}, {=html}
    text = re.sub(r"\{[#.=][^\n}]*\}", "", text)

    # 3. Drop HTML comments and {=html}<!-- --> blocks
    text = re.sub(r"\{=html\}\s*", "", text)
    text = re.sub(r"<!--\s*-->", "", text)

    # 4. Unwrap **\[...\]** emphasis around bracket labels:
    #    [**摘要：** foo] → **摘要：** foo
    #    **[Title]** → Title
    # IMPORTANT: `[ \t]*` (horizontal whitespace only) — `\s*` would match
    # across newlines and incorrectly merge a heading's trailing `**` with
    # the next paragraph's leading `[`.
    text = re.sub(r"\*\*[ \t]*\[", "[", text)
    text = re.sub(r"\][ \t]*\*\*", "]", text)
    # also **[Label]**: drop wrapping ** when there's no trailing emphasis close
    text = re.sub(r"\*\*\[([^\]\n]+?)\]\*\*", r"\1", text)

    # 5. Drop pandoc-escaped reference brackets: \[1\] → [1]
    text = re.sub(r"\\\[(\d+)\\\]", r"[\1]", text)
    text = re.sub(r"\\\[", "[", text)
    text = re.sub(r"\\\]", "]", text)

    # 6. Drop pandoc-escaped parentheses (rare, but safe)
    text = re.sub(r"\\\(", "（", text)
    text = re.sub(r"\\\)", "）", text)

    # 7. Drop pandoc backslash-escaped asterisk inside table cells: \* → *
    text = re.sub(r"\\\*", "*", text)

    # 8. Backslash line continuation: a single `\` at end of line joins the
    #    next line. Pattern: \<newline>
    text = re.sub(r"\\\r?\n", "", text)

    # 8b. Strip pandoc image attributes: ![alt](path){width="..." height="..."}.
    #     Without this, the {width=... height=...} ends up after the markdown
    #     image and either shows as literal text or is interpreted by the
    #     browser as inches (e.g. width="6.5in" → image is 6.5 inches wide).
    text = re.sub(
        r"!\[[^\]]*\]\([^)]+\)\s*\{[wh][^}]*\}",
        lambda m: m.group(0).split("{")[0].rstrip(),
        text,
    )

    # 9. Drop single-line pandoc bracket wrappers around entire lines.
    #    pandoc sometimes wraps a whole paragraph in [...] for inline
    #    attribute styling. After step 1 strips the trailing {...}, the
    #    brackets remain. Use a balanced-bracket regex so inner citations
    #    like [1] don't break the match, then handle heading/two-bracket
    #    cases with a second pass.
    def _strip_outer(line: str) -> str:
        s = line.lstrip()
        prefix = line[: len(line) - len(s)]
        s = s.rstrip()
        if not s.startswith("[") or not s.endswith("]"):
            return line
        # Walk brackets to find matching close for first open
        depth = 0
        for i, ch in enumerate(s):
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    if i != len(s) - 1:
                        return line  # outer ] is not at end → not a wrap
                    inner = s[1:i].strip()
                    return prefix + inner
        return line

    text = "\n".join(_strip_outer(ln) for ln in text.split("\n"))

    # 9b. For heading lines like "# [引言]" or "## [2.1 标题]" — strip the
    #     single trailing bracket span if it wraps the entire heading text.
    text = re.sub(
        r"^(#{1,6})\s+\[([^\]\n]+)\]\s*$",
        r"\1 \2",
        text,
        flags=re.MULTILINE,
    )

    # 9c. For adjacent bracket pairs on a single line, e.g.
    #     `[title][authors]`, join them with a space.
    text = re.sub(
        r"\[([^\]\n]+)\]\[([^\]\n]+)\]",
        r"\1 \2",
        text,
    )

    # 9d. Repair a heading that got merged with the following paragraph.
    # This pattern shows up after older normalization passes incorrectly
    # joined them via `\s*` regexes that matched across newlines:
    #     ### **2.1.1认知挑战[中小企业...]
    # We split at the first `[` and restore the closing `**`.
    text = re.sub(
        r"^(#{1,6}\s+\*\*[^*\n\[]+)\[",
        r"\1**\n\n[",
        text,
        flags=re.MULTILINE,
    )

    # 9e. Also repair headings merged without `**`:
    #     ## 2.1 数字化转型主要挑战[中小企业...]
    text = re.sub(
        r"^(#{1,6}\s+[^*\n\[]+)\[",
        r"\1\n\n[",
        text,
        flags=re.MULTILINE,
    )

    # 10. Collapse 3+ blank lines to 2
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text


def _normalize_punctuation(text: str) -> str:
    """Convert English half-width punctuation inside Chinese text to full-width.

    Conservative: only matches when both adjacent characters are CJK, so URLs,
    numbers, English terms, and code fragments are NOT touched.
    """

    # 1. Half-width period in CJK context: 汉字.汉字 → 汉字。汉字
    #    The audit found 32 of these (mostly in citations and references).
    text = re.sub(
        rf"([{CJK}])\.([{CJK}])",
        r"\1。\2",
        text,
    )

    # 2. Half-width parens in CJK context: 汉字(汉字) → 汉字（汉字）
    text = re.sub(
        rf"([{CJK}])\(([{CJK}])",
        r"\1（\2",
        text,
    )
    text = re.sub(
        rf"([{CJK}])\)([{CJK}\s])",
        r"\1）\2",
        text,
    )

    # 3. Em-dash normalization in body text. Table separator lines are
    #    recognized by their character composition (only +, -, |, spaces)
    #    and are left alone. 2+ dashes inside prose become `——`.
    def _is_table_separator(line: str) -> bool:
        s = line.strip()
        if not s:
            return False
        # pandoc extended table separator: starts/ends with +, only +-space
        if s.startswith("+") and s.endswith("+") and re.fullmatch(r"[\+\- ]+", s):
            return True
        # GFM separator: starts/ends with |, only |-: space
        if s.startswith("|") and s.endswith("|") and re.fullmatch(r"[\|\-: ]+", s):
            return True
        return False

    def _fix_dashes(line: str) -> str:
        if _is_table_separator(line):
            return line
        # leave horizontal rule lines alone
        if re.fullmatch(r"-{3,}", line.strip()):
            return line
        # in prose, collapse 2+ dashes to `——` (Chinese em-dash)
        return re.sub(r"-{2,}", "——", line)

    text = "\n".join(_fix_dashes(line) for line in text.split("\n"))

    # 4. Collapse CJK + space + (digit/letter) when the other side is CJK:
    #    汉 4 → 汉4 ; 城镇化率突破 66% 的 → 城镇化率突破 66%的
    #    Heuristic: only when space is between two CJK-adjacent tokens.
    text = re.sub(
        rf"([{CJK}])\s+(\d)",  # CJK + space + digit (next char is CJK or punct)
        r"\1\2",
        text,
    )
    # CJK + space + (letter/digit) + space + CJK (likely a stray split)
    text = re.sub(
        rf"([{CJK}])\s+([A-Za-z0-9])\s+([{CJK}])",
        r"\1\2\3",
        text,
    )

    return text


def _convert_plain_tables(text: str) -> tuple[str, int]:
    """Convert pandoc plain tables (whitespace-aligned, no `|`) to GFM pipe tables.

    Pandoc's plain table format looks like:
        ------------ ------------------- ----------------
        行业         核心痛点             数字化水平
        高端装备     关键零部件依赖进口    L1-L2
        ------------ ------------------- ----------------

    react-markdown + remark-gfm cannot render this — it needs `|` pipe tables.
    This function finds each plain-table block and rewrites it as:
        | 行业 | 核心痛点 | 数字化水平 |
        | --- | --- | --- |
        | 高端装备 | 关键零部件依赖进口 | L1-L2 |

    Strategy: detect the table by its top + bottom separator lines (runs of
    dashes or em-dashes). The number of columns comes from the separator.
    Cell content is then extracted by splitting each row on 2+ whitespace
    runs (NOT by character-position slicing — CJK characters are wider than
    the dash column and would be truncated by fixed slicing).

    Returns (new_text, count_converted).
    """
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    converted = 0

    sep_re = re.compile(
        r"^\s*(?:-{3,}|——+)(?:\s+(?:-{3,}|——+))+\s*$"
    )

    def _split_row(ln: str) -> list[str]:
        """Split a row into cells on runs of 2+ whitespace characters."""
        s = ln.lstrip().rstrip()
        parts = re.split(r"[ \t]{2,}", s)
        return [p.strip() for p in parts if p.strip()]

    while i < len(lines):
        line = lines[i]
        if sep_re.match(line) and len(line.strip()) >= 8:
            # Column count from the separator
            n_cols = len(re.findall(r"-+|——+", line))

            # Header is the first non-blank line BELOW the top separator.
            header_idx = i + 1
            while header_idx < len(lines) and not lines[header_idx].strip():
                header_idx += 1
            if header_idx >= len(lines):
                out.append(line)
                i += 1
                continue

            # Data rows: collect non-blank non-separator lines until the
            # closing separator (or EOF). Blank lines inside the table are
            # skipped (they're spacing between rows in pandoc output).
            data_rows: list[int] = []
            closing_idx: int | None = None
            j = header_idx + 1
            while j < len(lines):
                if not lines[j].strip():
                    # Blank: check whether the next non-blank is the closing sep
                    k = j + 1
                    while k < len(lines) and not lines[k].strip():
                        k += 1
                    if k < len(lines) and sep_re.match(lines[k]):
                        closing_idx = k
                        break
                    j += 1
                    continue
                if sep_re.match(lines[j]):
                    closing_idx = j
                    break
                data_rows.append(j)
                j += 1

            # Build GFM
            header_cells = _split_row(lines[header_idx])
            if len(header_cells) < 2:
                out.append(line)
                i += 1
                continue

            # If the separator suggests more columns than the header has
            # (header text is short), pad header.
            while len(header_cells) < n_cols:
                header_cells.append("")

            def _row_cells(idx: int) -> list[str]:
                cells = _split_row(lines[idx])
                while len(cells) < len(header_cells):
                    cells.append("")
                return cells[: len(header_cells)]

            gfm_header = "| " + " | ".join(header_cells) + " |"
            gfm_sep = "| " + " | ".join(["---"] * len(header_cells)) + " |"
            gfm_rows = [
                "| " + " | ".join(_row_cells(ridx)) + " |"
                for ridx in data_rows
            ]

            out.append(gfm_header)
            out.append(gfm_sep)
            out.extend(gfm_rows)
            converted += 1
            i = (closing_idx + 1) if closing_idx is not None else j
        else:
            out.append(line)
            i += 1

    return "\n".join(out), converted


def _convert_extended_tables(text: str) -> tuple[str, int]:
    """Convert pandoc EXTENDED tables (`+---+` separators, `|...|...|` rows) to GFM.

    Pandoc has two table flavors:
      - **plain** (whitespace-aligned, no `|`) — handled by `_convert_plain_tables`
      - **extended** (`+---+---+` separator, `|`-delimited cells) — handled here

    react-markdown + remark-gfm cannot render extended tables. They expect
    GFM pipe tables (`|---|` separator, `|`-delimited cells). This function
    rewrites the separator and normalizes each row to a single line by
    concatenating wrapped cells (a multi-line cell appears as one `|`-row
    per source line, with the content only in the columns that have data).

    Example:
        +----+----+
        | a  | b  |
        +----+----+
        | long cell | next |
        |           | cont |
        +----+----+

    Becomes:
        | a | b |
        | --- | --- |
        | long cell | next cont |
    """
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    converted = 0

    # Extended-table separator: line starts/ends with + and contains only
    # +, -, and whitespace. Must have at least 2 + (i.e. >= 1 column).
    sep_re = re.compile(r"^\s*\+(?:[-\s]+\+)+\s*$")

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not (sep_re.match(line) and stripped.count("+") >= 2):
            out.append(line)
            i += 1
            continue

        # Header is the FIRST `|`-delimited row below the separator.
        header_idx = i + 1
        while header_idx < len(lines) and not lines[header_idx].strip():
            header_idx += 1
        if header_idx >= len(lines) or not lines[header_idx].lstrip().startswith("|"):
            out.append(line)
            i += 1
            continue

        # Determine the number of columns from the header by counting `|`.
        # The data rows may have VARIABLE widths (pandoc truncates trailing
        # spaces), so we use the header's own `|` count to fix the column
        # count. Each cell is the content between two `|`s.
        def _split_row(ln: str) -> list[str]:
            """Split a `|`-delimited row into cells.

            Strips the leading and trailing `|`, splits on `|`, trims each
            cell. Empty cells (created by `||`) become empty strings.
            """
            s = ln.lstrip()
            if s.startswith("|"):
                s = s[1:]
            if s.endswith("|"):
                s = s[:-1]
            return [c.strip() for c in s.split("|")]

        header_cells = _split_row(lines[header_idx])
        if len(header_cells) < 2:
            out.append(line)
            i += 1
            continue

        n_cols = len(header_cells)

        # Collect all data rows: each `|`-delimited line until a non-`|` line
        # or another separator. Inner `+---+` separators (between rows in
        # pandoc extended format) are SKIPPED — they're row separators, not
        # table terminators. Each row is split into N columns. Wrapped rows
        # (where ALL cells are empty except possibly one column) are
        # concatenated to the previous row's matching column.
        raw_rows: list[list[str]] = []
        closing_idx: int | None = None
        j = header_idx + 1
        while j < len(lines):
            ln = lines[j]
            ls = ln.lstrip()
            # Inner `+---+` separator — skip; remember position if it's the
            # LAST separator (next non-blank line is not a `|`-line).
            if ls.startswith("+") and sep_re.match(ln):
                k = j + 1
                while k < len(lines) and not lines[k].strip():
                    k += 1
                if k >= len(lines) or not lines[k].lstrip().startswith("|"):
                    closing_idx = j
                    break
                j = k
                continue
            # Non-`|` line (other than inner separator) ends the table.
            if not ls.startswith("|"):
                break
            cells = _split_row(ln)
            # Pad to N columns (some rows might be truncated)
            while len(cells) < n_cols:
                cells.append("")
            cells = cells[:n_cols]
            raw_rows.append(cells)
            j += 1

        if not raw_rows:
            out.append(line)
            i += 1
            continue

        # Merge wrapped rows: a row is "wrapped" if it has only 1 non-empty
        # cell (i.e. content continues from the previous row in that column).
        # Concat non-empty cells to the previous row at the matching position.
        merged: list[list[str]] = [list(raw_rows[0])]
        for cells in raw_rows[1:]:
            non_empty = [(k, c) for k, c in enumerate(cells) if c]
            # Wrapped continuation: at most 1 non-empty cell, and at least
            # one of the previous row's columns has content
            if len(non_empty) <= 1 and any(merged[-1]):
                for k, c in non_empty:
                    prev_cell = merged[-1][k]
                    merged[-1][k] = (prev_cell + c).strip() if prev_cell else c
            else:
                merged.append(list(cells))

        # Build GFM. The header is `header_cells` (from lines[header_idx]);
        # the data rows are the merged list.
        gfm_header = "| " + " | ".join(header_cells) + " |"
        gfm_sep = "| " + " | ".join(["---"] * n_cols) + " |"
        gfm_rows = [
            "| " + " | ".join(row) + " |" for row in merged
        ]

        out.append(gfm_header)
        out.append(gfm_sep)
        out.extend(gfm_rows)
        converted += 1
        i = (closing_idx + 1) if closing_idx is not None else j

    return "\n".join(out), converted


def _rewrite_image_paths(text: str, slug: str) -> str:
    """Rewrite `media/imageN.ext` references to absolute `/uploads/source-images/...`."""
    subdir = SLUG_TO_IMAGE_DIR.get(slug)
    if not subdir:
        return text

    # Match ![alt](media/imageN.ext) — preserve case of extension
    def _repl(match: re.Match) -> str:
        alt = match.group(1)
        fname = match.group(2)
        return f"![{alt}](/uploads/source-images/{subdir}/{fname})"

    return re.sub(
        r"!\[([^\]]*)\]\(media/([^)]+)\)",
        _repl,
        text,
    )


def normalize_article(article: Article) -> tuple[str, list[str]]:
    """Apply all normalizations to one article; return (new_content, log_lines)."""
    original = article.content or ""
    if not original:
        return original, []

    log: list[str] = []
    text = original

    # Phase 1: rewrite image paths first (so subsequent punctuation passes
    # don't munge URL fragments)
    new_text = _rewrite_image_paths(text, article.slug)
    if new_text != text:
        diff = sum(1 for _ in re.finditer(r"!\[[^\]]*\]\(media/", text))
        log.append(f"  images: rewrote {diff} media/ refs to /uploads/source-images/{SLUG_TO_IMAGE_DIR.get(article.slug, '?')}/")
        text = new_text

    # Phase 2: pandoc residue
    new_text = _normalize_pandoc(text)
    if new_text != text:
        # count approximate removals by line-length delta
        delta = len(text) - len(new_text)
        log.append(f"  pandoc: stripped ~{delta} chars of residue")
        text = new_text

    # Phase 2b: convert pandoc plain tables to GFM pipe tables.
    # MUST run before dash normalization, because the separator line still
    # has `---` (dash runs) that we use to detect column boundaries.
    new_text, table_count = _convert_plain_tables(text)
    if table_count:
        log.append(f"  tables: converted {table_count} plain tables to GFM pipe tables")
        text = new_text

    # Phase 2c: convert pandoc EXTENDED tables (`+---+` separators, `|...|...|`
    # rows) to GFM pipe tables. react-markdown + remark-gfm cannot render the
    # extended flavor. We do this AFTER pandoc residue stripping so any
    # surrounding `{.mark}` wrappers around the separator lines are already gone.
    new_text, ext_count = _convert_extended_tables(text)
    if ext_count:
        log.append(f"  extended-tables: converted {ext_count} to GFM pipe tables")
        text = new_text

    # Phase 3: punctuation / typography
    new_text = _normalize_punctuation(text)
    if new_text != text:
        delta = len(new_text) - len(text)
        log.append(f"  punctuation: {delta:+d} chars (full-width normalization)")
        text = new_text

    return text, log


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Write changes to DB (default is dry-run)")
    args = parser.parse_args()

    dry = not args.apply

    db = SessionLocal()
    try:
        # === Content normalization ===
        articles = db.query(Article).filter(Article.content.isnot(None)).all()
        print(f"\n[{'DRY' if dry else 'APPLY'}] normalizing {len(articles)} articles...")

        changed_count = 0
        for a in articles:
            new_content, log = normalize_article(a)
            if not log:
                continue
            changed_count += 1
            print(f"\n  • id={a.id} slug={a.slug}")
            for line in log:
                print(line)
            if not dry:
                a.content = new_content

        if changed_count == 0:
            print("  no content changes needed.")
        elif not dry:
            db.commit()
            print(f"\n  committed {changed_count} article changes.")
        else:
            print(f"\n  [DRY] would update {changed_count} articles — re-run with --apply to commit.")
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())