import type { ICommand } from '@uiw/react-md-editor'
import { api } from '../../../services/api'

/**
 * Insert a GFM pipe grid table — asks for rows/cols up front via `window.prompt`.
 */
export const tableCommand: ICommand = {
  name: 'insert-table-grid',
  keyCommand: 'insert-table-grid',
  buttonProps: {
    'aria-label': '插入表格',
    title: '插入表格',
  },
  icon: (
    <span style={{ fontSize: '0.8125rem' }}>⊞ 插入表格</span>
  ),
  execute: () => {
    const rowsStr = window.prompt('行数（含表头）:', '3')
    const colsStr = window.prompt('列数:', '3')
    if (!rowsStr || !colsStr) return
    const rows = Math.max(2, Math.min(50, parseInt(rowsStr, 10) || 3))
    const cols = Math.max(1, Math.min(10, parseInt(colsStr, 10) || 3))
    const header = Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(' | ')
    const sep = Array.from({ length: cols }, () => '---').join(' | ')
    const body = Array.from({ length: rows - 1 }, () =>
      `| ${Array.from({ length: cols }, () => ' ').join(' | ')} |`,
    ).join('\n')
    insertAtTextareaCursor(`\n| ${header} |\n| ${sep} |\n${body}\n`)
  },
}

/**
 * Insert a GFM pipe table parsed from a CSV file the user picks.
 */
export const csvCommand: ICommand = {
  name: 'insert-table-csv',
  keyCommand: 'insert-table-csv',
  buttonProps: {
    'aria-label': '从 CSV 插入',
    title: '从 CSV 插入',
  },
  icon: (
    <span style={{ fontSize: '0.8125rem' }}>⊞ 从 CSV 插入</span>
  ),
  execute: () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,text/csv'
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
        const text = await file.text()
        const lines = text.split(/\r?\n/).filter((l) => l.length)
        if (lines.length < 1) {
          alert('CSV 为空')
          return
        }
        const parseCsv = (l: string) =>
          l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ''))
        const header = parseCsv(lines[0])
        const sep = header.map(() => '---').join(' | ')
        const body = lines.slice(1)
          .map((l) => `| ${parseCsv(l).join(' | ')} |`)
          .join('\n')
        insertAtTextareaCursor(`\n| ${header.join(' | ')} |\n| ${sep} |\n${body}\n`)
      } catch (e) {
        alert(e instanceof Error ? e.message : 'CSV 解析失败')
      }
    })
    setTimeout(() => { cancelled = true; cleanup() }, 60_000)
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
  ta.value = next
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  const pos = start + text.length
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(pos, pos)
  })
}
