import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCommands } from '@uiw/react-md-editor/commands'
import type { ICommand } from '@uiw/react-md-editor'
import { api, type MediaSource } from '../../../services/api'
import {
  UPLOAD_MARKER_PREFIX,
  clampRange,
  finalizeUploadMarker,
  hasUploadMarker,
  imageMarkdown,
  newUploadId,
  replaceRange,
  removeMarker,
  uploadMarker,
  type TextRange,
} from './editorImageInsertion'

interface UseEditorImagesArgs {
  /** Current editor value (controlled). */
  content: string
  /** Functional state setter so concurrent edits are preserved. */
  setContent: React.Dispatch<React.SetStateAction<string>>
  /** Toast helper for failure paths. */
  toastError: (message: string) => void
}

interface PendingUpload {
  id: string
  marker: string
  source: MediaSource
}

/**
 * Single controller for every image insertion path (paste, drop, toolbar
 * upload, media-library selection). The pure functional helpers in
 * ``editorImageInsertion.ts`` do all the string transformation work; this
 * hook only:
 *
 *   • tracks the most recent textarea selection so we can insert at the
 *     last place the user clicked, even after they opened a drawer that
 *     stole focus;
 *   • brokers async ``api.admin.media.upload`` requests and resolves the
 *     marker placeholder when the upload finishes;
 *   • exposes a drawer open/close state plus a frozen selection range,
 *     so the drawer can search and type alt text without losing context;
 *   • exposes toolbar commands that match the new controlled-command API.
 */
export function useEditorImages({ content, setContent, toastError }: UseEditorImagesArgs) {
  // Always-current snapshot of the buffer so async callbacks never
  // overwrite a later edit. Updated in an effect (not during render) so
  // react-hooks/refs doesn't flag the write. Async upload handlers always
  // re-read currentContentRef.current immediately before replaceRange, so
  // being one commit behind is acceptable.
  const currentContentRef = useRef(content)
  useEffect(() => {
    currentContentRef.current = content
  }, [content])

  // The selection the textarea had on the last interaction. Used as a
  // fallback for drops where the event did not carry a selection.
  const lastSelection = useRef<TextRange>({ start: content.length, end: content.length })

  // Drawer-specific: the selection captured the instant the library
  // command was clicked. Subsequent searching and alt-text typing must
  // not move this range — the original cursor position is what we honor.
  const savedDrawerRange = useRef<TextRange | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Number of uploads currently in-flight. Used by the save/publish
  // guard to prevent persisting a document with markers still pending.
  const pendingRef = useRef<Map<string, PendingUpload>>(new Map())
  const [pendingCount, setPendingCount] = useState(0)

  /**
   * Begin an upload: insert the marker synchronously (so the editor
   * shows something), then start the upload asynchronously. When the
   * upload finishes, swap the marker for the finished Markdown image.
   *
   * If the marker has been deleted in the meantime (``replaceMarker``
   * returns the input unchanged), the asset becomes orphaned — the
   * caller does not have to handle that case.
   */
  const beginUpload = useCallback(
    (range: TextRange, file: File, source: MediaSource, altOverride?: string) => {
      const id = newUploadId()
      const marker = uploadMarker(id)
      // Synchronous marker insertion via functional update.
      setContent((current) => replaceRange(current, range, marker))
      const alt = altOverride ?? file.name ?? '粘贴图片'
      pendingRef.current.set(id, { id, marker, source })
      setPendingCount(pendingRef.current.size)

      api.admin.media
        .upload(file, source)
        .then((asset) => {
          if (!pendingRef.current.has(id)) return
          pendingRef.current.delete(id)
          setPendingCount(pendingRef.current.size)
          setContent((current) =>
            finalizeUploadMarker(current, id, asset.url, alt),
          )
        })
        .catch((err: unknown) => {
          if (pendingRef.current.has(id)) {
            pendingRef.current.delete(id)
            setPendingCount(pendingRef.current.size)
          }
          // If the marker is still around, remove it so the editor does
          // not show a stuck upload placeholder.
          setContent((current) => removeMarker(current, marker))
          const message = err instanceof Error ? err.message : String(err)
          toastError(`图片上传失败：${message}`)
        })
    },
    [setContent, toastError],
  )

  /**
   * Insert a Markdown image for a known media asset at the supplied
   * range. Used by the drawer's alt-confirm path. Never touches the
   * textarea directly — only updates the controlled content via the
   * functional setter.
   */
  const insertAssetAtRange = useCallback(
    (range: TextRange, assetUrl: string, alt: string) => {
      const markdown = imageMarkdown(alt, assetUrl)
      setContent((current) => replaceRange(current, range, markdown))
    },
    [setContent],
  )

  // ---- Textarea event handlers -------------------------------------

  const onSelect = useCallback(
    (node: HTMLTextAreaElement | null) => {
      if (!node) return
      const start = node.selectionStart ?? currentContentRef.current.length
      const end = node.selectionEnd ?? start
      lastSelection.current = clampRange(currentContentRef.current, { start, end })
    },
    [],
  )

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // Plain text and URL pastes are passed through untouched.
      const dt = event.clipboardData
      if (!dt) return
      const imageFiles: File[] = []
      // File API path (Linux/Windows)
      if (dt.files && dt.files.length > 0) {
        for (let i = 0; i < dt.files.length; i++) {
          const f = dt.files.item(i)
          if (f && f.type.startsWith('image/')) imageFiles.push(f)
        }
      } else if (dt.items) {
        // Items path (some Chromium versions). Use getAsFile.
        for (let i = 0; i < dt.items.length; i++) {
          const it = dt.items[i]
          if (it.kind === 'file') {
            const f = it.getAsFile()
            if (f && f.type.startsWith('image/')) imageFiles.push(f)
          }
        }
      }
      if (imageFiles.length === 0) return
      event.preventDefault()
      const node = event.currentTarget
      const range: TextRange = node
        ? clampRange(currentContentRef.current, {
            start: node.selectionStart ?? currentContentRef.current.length,
            end: node.selectionEnd ?? currentContentRef.current.length,
          })
        : { start: currentContentRef.current.length, end: currentContentRef.current.length }
      // Only handle the first image — multi-image paste is out of scope.
      beginUpload(range, imageFiles[0], 'paste')
    },
    [beginUpload],
  )

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      const dt = event.dataTransfer
      if (!dt || !dt.files || dt.files.length === 0) return
      // The browser will navigate to the dropped file (e.g. a PDF or a
      // plain text file) unless we call preventDefault here. We always
      // intercept file drops and only insert the ones we know how to
      // handle (images).
      event.preventDefault()
      const imageFiles: File[] = []
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files.item(i)
        if (f && f.type.startsWith('image/')) imageFiles.push(f)
      }
      if (imageFiles.length === 0) return
      const node = event.currentTarget
      let range: TextRange
      if (node) {
        const start = node.selectionStart ?? lastSelection.current.start
        const end = node.selectionEnd ?? lastSelection.current.end
        range = clampRange(currentContentRef.current, { start, end })
      } else {
        range = lastSelection.current
      }
      beginUpload(range, imageFiles[0], 'drop')
    },
    [beginUpload],
  )

  // Programmatic triggered upload (hidden file input change handler).
  const onFileChosen = useCallback(
    (file: File) => {
      const range = lastSelection.current
      beginUpload(range, file, 'upload')
    },
    [beginUpload],
  )

  // ---- Toolbar commands --------------------------------------------

  /**
   * Filter out the built-in URL image command — we replace it with the
   * canonical upload + library commands below.
   */
  const editorCommands = useMemo(
    () => getCommands().filter((command) => command.name !== 'image'),
    [],
  )

  const handleUploadClick = useCallback(
    (range: TextRange) => {
      lastSelection.current = clampRange(currentContentRef.current, range)
      // Bubble up: caller renders a hidden file input. The contract is
      // — the file input's onChange forwards the File to ``onFileChosen``.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hbsc-editor-open-upload'))
      }
    },
    [],
  )

  const handleLibraryClick = useCallback(
    (range: TextRange) => {
      savedDrawerRange.current = clampRange(currentContentRef.current, range)
      setDrawerOpen(true)
    },
    [],
  )

  const uploadCommand: ICommand = useMemo(
    () => ({
      name: 'hbsc-upload-image',
      keyCommand: 'hbsc-upload-image',
      buttonProps: { 'aria-label': '上传并插入图片', title: '上传并插入图片' },
      icon: <span style={{ fontSize: '0.8125rem' }}>🖼 上传图片</span>,
      execute: (state) => handleUploadClick(state.selection as TextRange),
    }),
    [handleUploadClick],
  )

  const libraryCommand: ICommand = useMemo(
    () => ({
      name: 'hbsc-media-library',
      keyCommand: 'hbsc-media-library',
      buttonProps: { 'aria-label': '从媒体库插入图片', title: '从媒体库插入图片' },
      icon: <span style={{ fontSize: '0.8125rem' }}>▦ 媒体库</span>,
      execute: (state) => handleLibraryClick(state.selection as TextRange),
    }),
    [handleLibraryClick],
  )

  // ---- Drawer API --------------------------------------------------

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    // We keep ``savedDrawerRange`` populated so a future re-open with a
    // fresh selection overwrites it; the value is overwritten as soon
    // as the command runs.
  }, [])

  const selectFromDrawer = useCallback(
    (asset: { url: string; original_name: string }, alt: string) => {
      const range =
        savedDrawerRange.current ?? lastSelection.current ?? {
          start: currentContentRef.current.length,
          end: currentContentRef.current.length,
        }
      const effective = clampRange(currentContentRef.current, range)
      const finalAlt = alt.trim() || asset.original_name
      insertAssetAtRange(effective, asset.url, finalAlt)
      setDrawerOpen(false)
    },
    [insertAssetAtRange],
  )

  // Public helpers for the parent component:
  // Derive marker presence from the controlled ``content`` prop directly so
  // we never read the ref during render (the React Hooks lint rule flags
  // ref.current access in render as a render-during-update hazard).
  const hasPendingUploads = pendingCount > 0
  const hasMarkerInContent = hasUploadMarker(content)
  const hasIncompleteMedia = hasPendingUploads || hasMarkerInContent

  return {
    // Editor props
    textareaProps: {
      onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) =>
        onSelect(e.currentTarget),
      onPaste,
      onDrop,
    },
    // Commands array (pass to ``commands`` prop) — drops built-in image
    editorCommands,
    // Custom extra commands (use these via ``extraCommands``)
    uploadCommand,
    libraryCommand,
    // Drawer state
    drawerOpen,
    closeDrawer,
    savedDrawerRange,
    selectFromDrawer,
    // Save guard
    hasIncompleteMedia,
    pendingCount,
    // Imperative path
    onFileChosen,
    insertAssetAtRange,
    // Marker helpers
    UPLOAD_MARKER_PREFIX,
  }
}
