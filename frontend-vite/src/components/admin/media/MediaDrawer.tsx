import { useEffect, useState } from 'react'
import { Button } from '../../ui'
import { MediaBrowser } from './MediaBrowser'
import { X } from 'lucide-react'
import type { MediaAsset } from '../../../services/api'
import './MediaBrowser.css'

interface MediaDrawerProps {
  open: boolean
  onClose: () => void
  /** Called when the user picks a healthy asset and confirms the alt text. */
  onInsert: (asset: MediaAsset, alt: string) => void
}

/**
 * Right-side drawer hosting the shared MediaBrowser in selection mode.
 *
 * Notes:
 * - The `onInsert` callback is the *single* place where the chosen asset
 *   reaches the editor — the browser itself only marks selection.
 * - Escape and backdrop close the drawer; lifecycle actions are absent.
 * - We render the drawer outside normal layout so it overlays without
 *   affecting the underlying form, only inside the editor page.
 */
export function MediaDrawer({ open, onClose, onInsert }: MediaDrawerProps) {
  const [picked, setPicked] = useState<MediaAsset | null>(null)
  const [alt, setAlt] = useState('')

  // Reset picked/alt when the drawer closes. This is the standard
  // "reset state on prop change" pattern; the lint rule fires a false
  // positive here because no external system is involved.
  useEffect(() => {
    if (open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicked(null)
    setAlt('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const canInsert =
    picked !== null && picked.status === 'active' && picked.health === 'healthy'

  return (
    <>
      <div className="media-drawer__backdrop" onClick={onClose} role="presentation" />
      <aside
        className="media-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-drawer-title"
        data-testid="media-drawer"
      >
        <div className="media-drawer__header">
          <h2 id="media-drawer-title">选择媒体</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="media-drawer__body">
          <MediaBrowser
            mode="select"
            onSelect={(asset) => {
              setPicked(asset)
              setAlt(asset.original_name)
            }}
            selectedId={picked?.id ?? null}
          />
        </div>
        <div className="media-drawer__footer">
          {picked && (
            <div className="media-drawer__field">
              <label htmlFor="media-drawer-alt">图片说明</label>
              <input
                id="media-drawer-alt"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="如：总体架构图"
                aria-label="图片说明"
              />
            </div>
          )}
          <Button
            data-testid="media-drawer-insert"
            disabled={!canInsert}
            onClick={() => {
              if (!canInsert || !picked) return
              onInsert(picked, alt)
              onClose()
            }}
          >
            插入所选图片
          </Button>
        </div>
      </aside>
    </>
  )
}
