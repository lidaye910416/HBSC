# -*- coding: utf-8 -*-
"""Shared Markdown normalization pipeline (Word → Editor → Display).

This module is the single source of truth for cleaning pandoc-converted
.docx article bodies. It is used by:

* `scripts/normalize_markdown.py` — the offline one-shot DB migration script
* `app.services.docx_import.convert_docx_to_markdown` — the live .docx
  import endpoint, so the editor preview matches the public detail page
* `app.routers.articles_router._sanitize_markdown` — the public read path,
  as a defensive normalization for any article that was inserted via the
  admin UI (e.g. paste from Word) and bypassed the offline pipeline

The pipeline runs in the same order as `scripts/normalize_markdown.py`:

    1. rewrite image paths (media/imageN.ext → /uploads/source-images/<subdir>/imageN.ext)
    2. strip pandoc residue ([…]{.mark}, {#id}, {=html}, \\[1\\], etc.)
    3. convert pandoc PLAIN tables (whitespace-aligned) → GFM pipe tables
    4. convert pandoc EXTENDED tables (+---+ / |…|) → GFM pipe tables
    5. normalize CJK punctuation (half-width period, parens, em-dash, CJK+space+letter)

Idempotency: the function is intentionally designed so running it twice
on already-normalized content is a no-op (no further changes).
"""
from __future__ import annotations

import re
from typing import Optional


# Slug → on-disk image subdir under uploads/source-images/.
# Source: audit report 2026-06-26 (34 in-body image refs across 6 articles).
# IMPORTANT: this is the single source of truth — both the offline script
# and the live .docx import path read from this dict. Tests assert that
# every value points to a real on-disk subdir.
SLUG_TO_IMAGE_DIR: dict[str, str] = {
    "openclaw-agent-framework": "03-openclaw",
    "jiayu-county-governance-platform": "06-jiayuxian",
    "esb-architecture-liantou": "07-liantouESB",
    "q1-2026-news-summary": "08-xinwenhuizong",
    "xia-junchao-youth-pioneer": "09-xiajunchao",
    "autonomous-driving-wuhan-newcity": "11-zidongjiashijiebo",
}


# CJK Unified Ideographs + Extension A
CJK = "一-鿿㐀-䶿"


# Public source root for source-images — must match the UPLOAD_DIR setting
# of the running app so /uploads/... URLs resolve on disk.
def _default_source_root() -> str:
    """Locate uploads/source-images relative to repo root.

    Importing settings at module level would force a config import on every
    test, so we resolve lazily and fall back to a relative path. Tests can
    override by monkeypatching the returned value (or by changing cwd).
    """
    from pathlib import Path
    cwd = Path.cwd()
    # Walk up a couple of levels — when called from backend/ the dir is
    # ./uploads/source-images. When called from repo root it's
    # backend/uploads/source-images. We try the closest hit first.
    for candidate in (cwd / "uploads" / "source-images",
                      cwd / "backend" / "uploads" / "source-images"):
        if candidate.exists():
            return str(candidate)
    return str(cwd / "uploads" / "source-images")


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

    # 11. Strip stray code-fence blocks left behind by pandoc — these are
    #     empty ```` ``` ... ``` ```` blocks wrapping `{=html}` placeholders
    #     or comments. Without this, the fences render as <pre><code> in the
    #     public reader. Only remove fences whose contents have already been
    #     stripped to whitespace (i.e., are now empty).
    text = re.sub(r"```\s*\n\s*\n```\s*\n?", "\n", text)
    text = re.sub(r"\n```\s*\n", "\n", text)

    # 12. Strip hr-like lines that are 4+ consecutive dashes (or em-dashes
    #     not used as table separators). Without this, react-markdown renders
    #     them as <hr>. Only act when the line is purely dashes/em-dashes;
    #     lines with surrounding Chinese text are intentional (kept as-is).
    text = re.sub(r"(?m)^[\s]*(?:-{4,}|——{2,})[\s]*$\n?", "", text)

    # 13. Strip a leading single # (h1) on its own line if it precedes a
    #     paragraph that already has Chinese numbering — pandoc sometimes
    #     emits a redundant H1 wrapper. We only target lines whose next
    #     non-blank line is prose (no other # prefix).
    text = re.sub(
        r"(?m)^#\s+([^\n]+)\n+(?=[^\n#])",
        r"\1\n\n",
        text,
    )

    # 14. Strip pandoc-introduced bold spans. The pandoc import emits
    #     multi-line `**...**` runs when a docx paragraph carries Word
    #     "strong" style across line breaks, e.g.
    #     `**党建翼联聚合力\n数智赋能启新程——...**`. Those are noise — keep
    #     the inner text but drop the wrapping `**`. Single-line
    #     `**...**` pairs are preserved: they may be user-authored
    #     emphasis (e.g. `**摘要：**`) or editor-applied labels, and the
    #     public reader renders them as <strong>.
    text = re.sub(r"\*\*([\s\S]*?\n[\s\S]*?)\*\*", r"\1", text)

    return text


def _normalize_punctuation(text: str) -> str:
    """Convert English half-width punctuation inside Chinese text to full-width.

    Conservative: only matches when both adjacent characters are CJK, so URLs,
    numbers, English terms, and code fragments are NOT touched.
    """

    # 1. Half-width period in CJK context: 汉字.汉字 → 汉字。汉字
    text = re.sub(
        rf"([{CJK}])\.([{CJK}])",
        r"\1。\2",
        text,
    )

    # 1b. Half-width period after a Chinese ordinal/affiliation digit, e.g.
    #     "1.开启", "2.湖北省", "(1.湖北省" — promote to full-width so the
    #     display reads as "1．开启" instead of "1.开启" (consistent with
    #     Chinese publishing style). Conservative: only when the right side
    #     is CJK, and the left side is digit or `(` (digit-prefix context).
    text = re.sub(
        rf"(\d|\()\.([{CJK}])",
        r"\1．\2",
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

    # 4. Collapse CJK + space + (digit/letter) when the other side is CJK.
    #    IMPORTANT: only match HORIZONTAL whitespace (`[ \t]+`) — \s would
    #    also match newlines and incorrectly merge paragraphs like
    #    "二、 Token 的来源与含义\n\n**2.1 概念溯源...**" into a single line.
    text = re.sub(
        rf"([{CJK}])[ \t]+(\d)",  # CJK + horizontal-ws + digit
        r"\1\2",
        text,
    )
    text = re.sub(
        rf"([{CJK}])[ \t]+([A-Za-z0-9])[ \t]+([{CJK}])",
        r"\1\2\3",
        text,
    )

    return text


def _convert_plain_tables(text: str) -> tuple[str, int]:
    """Convert pandoc plain tables (whitespace-aligned, no `|`) to GFM pipe tables.

    Real pandoc emits a top separator, header, an inner separator (which
    we must skip — it precedes the data rows), the data rows themselves,
    and a closing separator. The previous version of this function
    treated the inner separator as the closing one and exited early,
    leaving the data rows un-converted. This version walks past any
    inner separators and only treats a separator as the closing one
    when it is followed by non-table content (or EOF).

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

            # Data rows: skip any inner separator (real pandoc output has
            # one right after the header), then collect non-blank
            # non-separator lines until we hit the CLOSING separator.
            # A separator is the closing one when the line AFTER it is
            # not another non-blank, non-separator line of table-like
            # content (i.e. the next non-blank line is either EOF or
            # a separator itself or a heading or plain prose).
            data_rows: list[int] = []
            closing_idx: int | None = None
            j = header_idx + 1
            # First, skip past an inner separator if present.
            while j < len(lines) and sep_re.match(lines[j]):
                j += 1
            # Then collect data rows.
            while j < len(lines):
                if not lines[j].strip():
                    # Blank: peek ahead. If the next non-blank is a
                    # separator followed by non-table content, this is
                    # our closing separator. Otherwise continue.
                    k = j + 1
                    while k < len(lines) and not lines[k].strip():
                        k += 1
                    if k >= len(lines):
                        # EOF after blank — treat as end of table
                        break
                    if sep_re.match(lines[k]):
                        # Peek past the candidate separator. If the
                        # line after IT is also non-blank, non-sep
                        # prose, this is our closing sep. If the line
                        # after is a separator too, keep walking.
                        m = k + 1
                        while m < len(lines) and not lines[m].strip():
                            m += 1
                        if m >= len(lines) or not sep_re.match(lines[m]):
                            closing_idx = k
                            break
                    j += 1
                    continue
                if sep_re.match(lines[j]):
                    # A separator inside the data block. Look ahead to
                    # decide if it's the closing one. If the line after
                    # (skipping blanks) is a non-separator line, this
                    # is the closing separator.
                    k = j + 1
                    while k < len(lines) and not lines[k].strip():
                        k += 1
                    if k >= len(lines) or not sep_re.match(lines[k]):
                        closing_idx = j
                        break
                    # Otherwise skip this inner separator and continue
                    j = k
                    continue
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
    """Convert pandoc EXTENDED tables (`+---+` separators, `|...|...|` rows) to GFM."""
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    converted = 0

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

        def _split_row(ln: str) -> list[str]:
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

        # Collect all data rows
        raw_rows: list[list[str]] = []
        closing_idx: int | None = None
        j = header_idx + 1
        while j < len(lines):
            ln = lines[j]
            ls = ln.lstrip()
            if ls.startswith("+") and sep_re.match(ln):
                k = j + 1
                while k < len(lines) and not lines[k].strip():
                    k += 1
                if k >= len(lines) or not lines[k].lstrip().startswith("|"):
                    closing_idx = j
                    break
                j = k
                continue
            if not ls.startswith("|"):
                break
            cells = _split_row(ln)
            while len(cells) < n_cols:
                cells.append("")
            cells = cells[:n_cols]
            raw_rows.append(cells)
            j += 1

        if not raw_rows:
            out.append(line)
            i += 1
            continue

        # Merge wrapped rows
        merged: list[list[str]] = [list(raw_rows[0])]
        for cells in raw_rows[1:]:
            non_empty = [(k, c) for k, c in enumerate(cells) if c]
            if len(non_empty) <= 1 and any(merged[-1]):
                for k, c in non_empty:
                    prev_cell = merged[-1][k]
                    merged[-1][k] = (prev_cell + c).strip() if prev_cell else c
            else:
                merged.append(list(cells))

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


def resolve_legacy_image_src(src: str, slug: Optional[str]) -> Optional[str]:
    """Resolve a legacy ``media/<name>`` reference to its canonical URL.

    Returns the absolute ``/uploads/source-images/<subdir>/<name>`` URL
    when the slug has a known source-images subdir; ``None`` when the
    slug is unknown (caller decides whether to skip or surface).
    """
    if not src.startswith("media/"):
        return None
    subdir = SLUG_TO_IMAGE_DIR.get(slug or "")
    if not subdir:
        return None
    return f"/uploads/source-images/{subdir}/{src[len('media/'):]}"


def rewrite_image_paths(text: str, slug: Optional[str]) -> str:
    """Rewrite `media/imageN.ext` references to absolute `/uploads/source-images/...`.

    Only rewrites when the slug is in SLUG_TO_IMAGE_DIR — otherwise the
    caller is working with content for an article that doesn't have a known
    source-images subdir (e.g. a freshly created article), and we leave the
    original `media/...` refs alone for the caller to resolve.
    """
    if not slug:
        return text

    def _repl(match: re.Match) -> str:
        alt = match.group(1)
        resolved = resolve_legacy_image_src(
            f"media/{match.group(2)}", slug,
        )
        if not resolved:
            return match.group(0)
        return f"![{alt}]({resolved})"

    return re.sub(
        r"!\[([^\]]*)\]\(media/([^)]+)\)",
        _repl,
        text,
    )


def normalize_markdown_text(
    text: Optional[str],
    *,
    slug: Optional[str] = None,
    rewrite_images: bool = True,
) -> Optional[str]:
    """Apply all normalizations to a piece of markdown text.

    Order is identical to the offline `scripts/normalize_markdown.py`
    pipeline:

        1. image path rewrite (only if `rewrite_images` and slug is known)
        2. pandoc residue strip
        3. plain table conversion
        4. extended table conversion
        5. CJK punctuation normalization

    Args:
        text: raw markdown. Falsy input returns the input as-is.
        slug: article slug, used by step 1 to look up the source-image
            subdir. May be None, in which case step 1 is a no-op.
        rewrite_images: when False, skip step 1 entirely. The public read
            path passes False because the article content has ALREADY been
            normalized once and lives in the DB as absolute URLs. The
            .docx import path passes True.

    Returns:
        The normalized text. Falsy input returns the input unchanged.
    """
    if not text:
        return text
    out = text
    if rewrite_images:
        out = rewrite_image_paths(out, slug)
    out = _normalize_pandoc(out)
    out, _ = _convert_plain_tables(out)
    out, _ = _convert_extended_tables(out)
    out = _normalize_punctuation(out)
    return out


# Re-export the private phase functions under their canonical names so
# callers (tests, scripts) can target specific phases if needed.
normalize_pandoc = _normalize_pandoc
normalize_punctuation = _normalize_punctuation
convert_plain_tables = _convert_plain_tables
convert_extended_tables = _convert_extended_tables


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

# Regexes used by pandoc_residue_summary — kept as module constants so tests
# and the script can assert the same counts.
_PANDOC_ATTR_RE = re.compile(r"\{[#.=][^\n\}]*\}")
_PANDOC_BRACKET_MARK_RE = re.compile(r"\[[^\]\n]+?\]\{[#.][^\n\}]*\}")
_PANDOC_ESCAPED_BRACKETS_RE = re.compile(r"\\\[\d+\\\]")
_PANDOC_IMAGE_ATTR_RE = re.compile(r"!\[[^\]]*\]\([^)]+\)\s*\{[wh][^}]*\}")
_EXTENDED_TABLE_SEP_RE = re.compile(r"^\s*\+(?:[-\s]+\+)+\s*$", re.MULTILINE)
_PLAIN_TABLE_SEP_RE = re.compile(
    r"(?ms)^\s*(?:-{3,}|——+)(?:\s+(?:-{3,}|——+))+\s*$"
)
_CJK_HALF_WIDTH_PERIOD_RE = re.compile(rf"[{CJK}]\.[{CJK}]")
_CJK_HALF_WIDTH_PAREN_RE = re.compile(rf"[{CJK}]\([{CJK}]")


def pandoc_residue_summary(text: str) -> dict:
    """Count how much pandoc residue / non-GFM artifacts a piece of text has.

    Useful for the editor preview and as a regression signal in tests.
    Returns:
        {
            "pandoc_attributes": int,    # {...} blocks
            "bracket_marks": int,        # [...]{.mark} wrappers
            "escaped_brackets": int,     # \\[1\\]
            "image_width_attrs": int,    # ![](...){width=...}
            "extended_table_seps": int,  # +---+ lines
            "plain_table_seps": int,     # whitespace-aligned table separators
            "cjk_half_width_period": int,# 汉字.汉字
            "cjk_half_width_paren": int, # 汉字(汉字)
        }
    """
    if not text:
        return {
            "pandoc_attributes": 0,
            "bracket_marks": 0,
            "escaped_brackets": 0,
            "image_width_attrs": 0,
            "extended_table_seps": 0,
            "plain_table_seps": 0,
            "cjk_half_width_period": 0,
            "cjk_half_width_paren": 0,
        }
    return {
        "pandoc_attributes": len(_PANDOC_ATTR_RE.findall(text)),
        "bracket_marks": len(_PANDOC_BRACKET_MARK_RE.findall(text)),
        "escaped_brackets": len(_PANDOC_ESCAPED_BRACKETS_RE.findall(text)),
        "image_width_attrs": len(_PANDOC_IMAGE_ATTR_RE.findall(text)),
        "extended_table_seps": len(_EXTENDED_TABLE_SEP_RE.findall(text)),
        "plain_table_seps": len(_PLAIN_TABLE_SEP_RE.findall(text)),
        "cjk_half_width_period": len(_CJK_HALF_WIDTH_PERIOD_RE.findall(text)),
        "cjk_half_width_paren": len(_CJK_HALF_WIDTH_PAREN_RE.findall(text)),
    }
