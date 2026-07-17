/**
 * Pure functional helpers that drive the Markdown editor's image insertion
 * flow. These helpers never touch the DOM — they only manipulate strings.
 * The editor hook (useEditorImages) wraps them in React state updates.
 *
 * Two important contracts:
 *
 * 1. Markers are unique HTML comments of the form
 *    ``<!--hbsc-upload:<uuid>-->``. Marker replacement is identifier-based
 *    so concurrent edits elsewhere in the document are not overwritten
 *    when an upload finishes.
 *
 * 2. ``replaceMarker`` is *idempotent and non-destructive*: if the marker
 *    is no longer present (e.g. the user deleted the line, or another
 *    operation rewrote the buffer), the helper returns the original
 *    string unchanged and the caller leaves the asset orphaned — the
 *    common path for in-flight uploads whose content was edited out.
 */

export type TextRange = { start: number; end: number }

export const UPLOAD_MARKER_PREFIX = '<!--hbsc-upload:'
export const UPLOAD_MARKER_SUFFIX = '-->'

/**
 * Clamp a text range to the bounds of the supplied string. The end is
 * forced to be at least the start so call sites can treat an "empty"
 * insertion point as ``start === end``.
 */
export function clampRange(text: string, range: TextRange): TextRange {
  const len = text.length
  const start = Math.max(0, Math.min(range.start, len))
  const end = Math.max(start, Math.min(range.end, len))
  return { start, end }
}

/**
 * Replace a slice of ``text`` with ``replacement`` safely. The range is
 * clamped first so the caller does not have to validate.
 */
export function replaceRange(text: string, range: TextRange, replacement: string): string {
  const safe = clampRange(text, range)
  return text.slice(0, safe.start) + replacement + text.slice(safe.end)
}

/**
 * Build the marker HTML comment representing an in-flight image upload.
 * The marker is unique per upload so multiple concurrent uploads can be
 * in-flight without colliding.
 */
export function uploadMarker(id: string): string {
  return `${UPLOAD_MARKER_PREFIX}${id}${UPLOAD_MARKER_SUFFIX}`
}

/**
 * Randomly generate a stable upload marker id. We don't depend on
 * ``crypto.randomUUID`` being present (older test browsers may lack it),
 * but prefer it when available.
 */
export function newUploadId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Fallback: time-prefixed random hex.
  return `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Build the public Markdown for an image. The alt text is sanitized so
 * it never breaks the syntax — brackets and line breaks are replaced
 * with spaces.
 */
export function imageMarkdown(alt: string, url: string): string {
  const safeAlt = alt.replace(/[\[\]\n\r]/g, ' ').trim() || 'image'
  return `![${safeAlt}](${url})`
}

/**
 * Replace the first occurrence of an exact marker substring with a
 * replacement string. Returns the input unchanged when the marker is
 * absent — this is the property that lets us safely complete an upload
 * after the user has edited the surrounding text.
 */
export function replaceMarker(text: string, marker: string, replacement: string): string {
  const index = text.indexOf(marker)
  if (index < 0) return text
  return text.slice(0, index) + replacement + text.slice(index + marker.length)
}

/**
 * Remove an exact marker substring if present, otherwise return text
 * unchanged. Used when a user deletes the marker line before the upload
 * resolves — the upload result must not be silently re-inserted.
 */
export function removeMarker(text: string, marker: string): string {
  const index = text.indexOf(marker)
  if (index < 0) return text
  return text.slice(0, index) + text.slice(index + marker.length)
}

/**
 * Whether the buffer currently contains any in-flight upload marker.
 * Used by the editor save-guard — saving while a marker is still in
 * the document would persist a broken image.
 */
export function hasUploadMarker(text: string): boolean {
  return text.includes(UPLOAD_MARKER_PREFIX)
}

export interface ImageReplacement {
  assetUrl: string
  alt: string
  /** When true, the marker remains in place if not found. */
  keepIfMissing?: boolean
}

/**
 * High-level convenience: replace a marker with a finished Markdown
 * image tag. Returns the (possibly unchanged) document.
 */
export function finalizeUploadMarker(
  text: string,
  markerId: string,
  assetUrl: string,
  alt: string,
): string {
  const marker = uploadMarker(markerId)
  const replacement = imageMarkdown(alt, assetUrl)
  return replaceMarker(text, marker, replacement)
}
