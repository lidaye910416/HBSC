import { useRef, useState } from 'react'
import { api } from '../../../services/api'
import { ToolbarButton } from '../MarkdownToolbar'

/**
 * Toolbar button: pick an image (or upload) and insert Markdown at the
 * current cursor in the editor. Caller wires the actual text insertion
 * via the `onInsert` callback (because MDEditor's selection API isn't
 * exposed globally).
 */
export function InsertImageButton({ onInsert }: { onInsert: (md: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onUpload = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const out = await api.admin.media.upload(file, 'image')
      const alt = window.prompt('图片描述（alt 文本）：', file.name) || file.name
      onInsert(`\n![${alt}](${out.url})\n`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ToolbarButton
        label={busy ? '上传中…' : '🖼 插入图片'}
        onClick={() => fileRef.current?.click()}
        disabled={busy}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = ''
        }}
      />
      {error && <span style={{ color: 'red', fontSize: '0.75rem', marginLeft: '8px' }}>{error}</span>}
    </>
  )
}
