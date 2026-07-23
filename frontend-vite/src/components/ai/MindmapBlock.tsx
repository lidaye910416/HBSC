import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Maximize2, X } from 'lucide-react'
import type { IMarkmap, INode } from 'markmap-view'
import { Transformer } from 'markmap-lib/no-plugins'

type ResizeObserverSafe = typeof window extends { ResizeObserver: infer T } ? T : never

// markmap's ~30KB gzip (markmap-view + d3-hierarchy/selection/zoom/shape/
// flextree) is loaded on first use — i.e. only when the model actually
// emits a `markmap` code block. Keeping it dynamic avoids paying the
// cost on pages that never trigger the assistant's mind-map mode.
type MarkmapModule = typeof import('markmap-view')
let markmapModulePromise: Promise<MarkmapModule> | null = null
function loadMarkmap(): Promise<MarkmapModule> {
  if (!markmapModulePromise) {
    markmapModulePromise = import('markmap-view')
  }
  return markmapModulePromise
}

// Single shared Transformer; per-markmap cost is just parsing markdown
// headings, which is microseconds. Keeping one instance avoids re-allocating
// its internal plugins on every render.
const transformer = new Transformer()

type RenderState =
  | { status: 'loading' }
  | { status: 'ok' }
  | { status: 'error'; message: string }



export function MindmapBlock({ code }: { code: string }) {
  const reactId = useId()
  const elementId = `markmap-${reactId.replace(/:/g, '')}`
  const [state, setState] = useState<RenderState>({ status: 'loading' })
  const [zoomed, setZoomed] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogBodyRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Keep references so we can update the same markmap when the user toggles
  // the modal (re-render without re-allocating).
  const markmapRef = useRef<IMarkmap | null>(null)
  const rootDataRef = useRef<INode | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    loadMarkmap()
      .then(({ Markmap }) => {
        if (cancelled) return
        // Parse the markdown into a markmap tree. wrapText gives a sensible
        // character limit per line so long node names wrap instead of
        // overflowing.
        const { root } = transformer.transform(code, {})
        // markmap's `initialExpandLevel` controls how many levels show
        // initially — we set it to 1 in the thumbnail options so the
        // user sees root + 1st-level branches, and to a large number in
        // the modal options for full-detail viewing.
        rootDataRef.current = root as INode
        setState({ status: 'ok' })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setState({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [code])

  // Mount/unmount markmap into the host element. We re-create whenever the
  // active target switches between thumbnail and modal so the SVG sizes
  // correctly to its container.
  useEffect(() => {
    if (state.status !== 'ok') return
    const targetId = zoomed ? `${elementId}-dialog` : elementId
    const target = document.getElementById(targetId)
    if (!target) return

    let disposed = false
    // ResizeObserver is only useful when the modal is open — the
    // thumbnail's host box has a fixed CSS size. We watch the dialog
    // body so the diagram reflows if the user resizes the viewport
    // while zoomed.
    let observer: ResizeObserver | null = null

    loadMarkmap().then(({ Markmap }) => {
      if (disposed) return
      // Tear down the previous instance if any (switching from thumbnail
      // to modal or vice versa).
      markmapRef.current?.destroy()
      const mm = Markmap.create(target, {
        // Brand-aligned palette tuned for high contrast against the white
        // bubble. Levels 0..N cycle so multi-level trees still read.
        color: (node) => {
          const depth = getDepth(node)
          const palette = ['#1f386e', '#c9a84c', '#3a6cb1', '#7a5fc9', '#2f8f6e', '#c25b3a']
          return palette[depth % palette.length]
        },
        paddingX: 16,
        autoFit: true,
        // Same options in both the thumbnail and the dialog so the
        // markmap instance is interchangeable when zoomed toggles —
        // fit() then handles the up-scaling to whichever container
        // happens to be active. Dialog labels are wider because of
        // the larger --markmap-font + --markmap-max-width CSS in the
        // dialog (see global.css); paddingX / spacingHorizontal stay
        // identical so the layout shape is comparable between views.
        fitRatio: zoomed ? 0.92 : 0.95,
        maxWidth: 320,
        nodeMinHeight: 24,
        spacingHorizontal: 80,
        spacingVertical: 6,
        // Thicker connector lines = clearer branches.
        lineWidth: (node) => {
          const depth = getDepth(node)
          return Math.max(1.5, 4 - depth * 0.5)
        },
        duration: 200,
        initialExpandLevel: 99,
      }, rootDataRef.current!)
      markmapRef.current = mm

      // markmap.create() writes explicit width="300" height="150"
      // attributes on the SVG. Without overriding these, the dialog
      // SVG stays at 300×150 regardless of CSS, because on an <svg>
      // element CSS `width: auto` resolves to the attribute value.
      // We override the attributes here so the dialog fills its body
      // and call fit() so d3 re-zooms the inner <g> to the new size.
      if (zoomed) {
        target.setAttribute('width', '100%')
        target.setAttribute('height', '100%')
        // rAF + 200ms safety net: fit() reads the SVG's
        // getBoundingClientRect, so it must run after the attribute
        // change has been laid out. Without the second call, slow
        // first-mounts can fit to the previous 300×150 and render the
        // tree as a squished strip.
        requestAnimationFrame(() => mm.fit())
        setTimeout(() => mm.fit(), 200)
        // Watch the SVG itself so ResizeObserver fires when its width
        // attribute changes (e.g. after font-load reflow or window
        // resize while the dialog is open).
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => mm.fit())
          observer.observe(target)
        }
      }
    })
    return () => {
      disposed = true
      observer?.disconnect()
      // Don't destroy on every effect re-run; only on unmount via the
      // cleanup that fires when (state.status, zoomed) tuple changes.
    }
  }, [state.status, zoomed, elementId])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      markmapRef.current?.destroy()
      markmapRef.current = null
    }
  }, [])

  const closeZoom = useCallback(() => {
    setZoomed(false)
    triggerRef.current?.focus()
  }, [])

  // <dialog> wiring — same pattern as before so ESC / backdrop click work
  // consistently across the assistant panel.
  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    if (zoomed) {
      if (!dlg.open) dlg.showModal()
    } else if (dlg.open) {
      dlg.close()
    }
  }, [zoomed])

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    const onCancel = (e: Event) => {
      e.preventDefault()
      closeZoom()
    }
    dlg.addEventListener('cancel', onCancel)
    return () => dlg.removeEventListener('cancel', onCancel)
  }, [closeZoom])



  if (state.status === 'loading') {
    return (
      <div className="page-agent-mindmap page-agent-mindmap--loading" data-testid="page-agent-mindmap-loading">
        <Loader2 size={14} className="page-agent-spin" aria-hidden="true" />
        <span>正在绘制思维导图…</span>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="page-agent-mindmap page-agent-mindmap--error" role="alert" data-testid="page-agent-mindmap-error">
        <AlertTriangle size={14} aria-hidden="true" />
        <span>思维导图渲染失败：{state.message}</span>
        <details>
          <summary>查看原始代码</summary>
          <pre><code>{code}</code></pre>
        </details>
      </div>
    )
  }

  // Backdrop click detection — same pattern as before; the dialog body is
  // inset so clicks outside it land on the dialog element itself.
  const handleDialogClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const body = dialogBodyRef.current
    if (!body) return
    const rect = body.getBoundingClientRect()
    const { clientX: x, clientY: y } = e
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      closeZoom()
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="page-agent-mindmap"
        onClick={() => setZoomed(true)}
        aria-label="点击放大思维导图"
        title="点击放大"
        data-testid="page-agent-mindmap-svg"
      >
        <svg id={elementId} className="page-agent-mindmap-svg" aria-label="思维导图" />
        <span className="page-agent-mindmap-zoomHint" aria-hidden="true">
          <Maximize2 size={14} />
          点击放大
        </span>
      </button>

      <dialog
        ref={dialogRef}
        className="page-agent-mindmap-dialog"
        onClick={handleDialogClick}
        onClose={() => setZoomed(false)}
        aria-label="思维导图放大视图"
      >
        <button
          type="button"
          className="page-agent-mindmap-close"
          onClick={closeZoom}
          aria-label="关闭"
          data-testid="page-agent-mindmap-close"
        >
          <X size={16} />
        </button>
        <div ref={dialogBodyRef} className="page-agent-mindmap-dialogBody">
          <svg id={`${elementId}-dialog`} className="page-agent-mindmap-svg" aria-label="思维导图放大" />
        </div>
      </dialog>
    </>
  )
}

function getDepth(node: any): number {
  let depth = 0
  while (node?.payload?.parent) {
    depth++
    node = node.payload.parent
  }
  return depth
}
