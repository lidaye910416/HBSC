# TipTap vs MDEditor Decision

**Date:** 2026-06-29
**Status:** Proposed

## Context

Phase 2 shipped inline image/table click-to-edit via custom MDEditor preview
wrappers (`Mde/inlineImageEdit.tsx` and `Mde/inlineTableEdit.tsx`). The
MDEditor preview slot exposes the rendered children as already-instantiated
React element trees (not raw markdown), and MDEditor doesn't provide a
documented "preview component override" hook in `@uiw/react-md-editor@4`.

In manual verification we found:

- `inlineImageRenderer` and `inlineTableRenderer` were created and tested
  for type-correctness, but **the toolbar insertion (InsertImage /
  InsertTable) is the only path actually wired into `ArticleEditor` in
  Task 13**, per the plan note that explicitly defers preview-slot override.
- Image/table cells in the live editor still render as plain `<img>` /
  `<table>` elements; clicking them does not open an editor.
- The implementation is a starting point for a future direct preview
  override; it is not silently fallback to TipTap.

## Options

1. **Keep MDEditor + tighten preview wrapper** — extend the renderer
   walkers to reach into the preview DOM via portal/ref injection.
2. **Migrate to TipTap with markdown extension** — full WYSIWYG node
   schema for image/table with native click-to-edit affordances.

## Decision

Defer. Phase 2 ships with the MDEditor toolbar path; the inline preview
editor is a starting point for a follow-up. TipTap migration is a
separate, larger decision and out of scope for Phase 2.

## Consequences

- Toolbar buttons (`🖼 插入图片`, `⊞ 插入表格`) are the supported Phase 2 UX.
- A "提示" line in the editor tells admins that image/table inline click
  editing is preview-only / not wired in this phase.
- Future phase may decide to migrate to TipTap if inline editing becomes
  a Phase 4 requirement; the spec's reserved decision is preserved.
