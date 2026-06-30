import type { ICommand } from '@uiw/react-md-editor'
import { api } from '../../../services/api'

/**
 * v4-correct path for an MDEditor custom button: an `ICommand` passed via
 * `extraCommands` (NOT `components.toolbar`). `components.toolbar` is the
 * per-slot renderer and would render our wrapper inside every default item's
 * `<li>` — that was the recursion bug.
 *
 * `execute` is invoked synchronously, but file picking is async; we click
 * a hidden `<input type="file">` on first execute and re-run on change.
 */
export const imageCommand: ICommand = {
  name: 'insert-image',
  keyCommand: 'insert-image',
  buttonProps: {
    'aria-label': '上传并插入图片',
    title: '上传并插入图片',
  },
  icon: (
    <span style={{ fontSize: '0.8125rem' }}>🖼 插入图片</span>
  ),
  execute: () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.style.display = 'none'
    document.body.appendChild(input)
    let cancelled = false
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input)
    }
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      cleanup()
      if (cancelled || !file) return
      try {
        const out = await api.admin.media.upload(file, 'image') as { url: string }
        const alt = window.prompt('图片描述（alt 文本）：', file.name) || file.name
        const md = `\n![${alt}](${out.url})\n`
        insertAtTextareaCursor(md)
      } catch (e) {
        alert(e instanceof Error ? e.message : '上传失败')
      }
    })
    // If user closes the picker without picking, the input is removed by
    // the change handler only after a selection. Guard a 60s timeout.
    setTimeout(() => {
      cancelled = true
      cleanup()
    }, 60_000)
    input.click()
  },
}

function insertAtTextareaCursor(text: string) {
  const ta = document.querySelector<HTMLTextAreaElement>(
    '.article-editor__md textarea',
  )
  if (!ta) return
  const start = ta.selectionStart ?? 0
  const end = ta.selectionEnd ?? 0
  const value = ta.value
  const next = value.slice(0, start) + text + value.slice(end)
  // MDEditor listens for `input` events; dispatch one to keep its controlled
  // value in sync with the textarea.
  ta.value = next
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  const pos = start + text.length
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(pos, pos)
  })
}
