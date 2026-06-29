import { useState } from 'react'
import { ToolbarButton } from '../MarkdownToolbar'

/**
 * Toolbar button: ask for rows/cols (or accept CSV), emit a GFM pipe table.
 * The actual insertion is delegated to the caller via `onInsert`.
 */
export function InsertTableButton({ onInsert }: { onInsert: (md: string) => void }) {
  const [busy, setBusy] = useState(false)

  const insertGrid = () => {
    const rowsStr = window.prompt('行数（含表头）:', '3')
    const colsStr = window.prompt('列数:', '3')
    if (!rowsStr || !colsStr) return
    const rows = Math.max(2, Math.min(50, parseInt(rowsStr, 10) || 3))
    const cols = Math.max(1, Math.min(10, parseInt(colsStr, 10) || 3))
    const header = Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(' | ')
    const sep = Array.from({ length: cols }, () => '---').join(' | ')
    const body = Array.from({ length: rows - 1 }, () =>
      `| ${Array.from({ length: cols }, () => ' ').join(' | ')} |`
    ).join('\n')
    onInsert(`\n| ${header} |\n| ${sep} |\n${body}\n`)
  }

  const insertCsv = async () => {
    setBusy(true)
    try {
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = '.csv,text/csv'
      inp.onchange = async () => {
        const f = inp.files?.[0]
        if (!f) {
          setBusy(false)
          return
        }
        const text = await f.text()
        const lines = text.split(/\r?\n/).filter((l) => l.length)
        if (lines.length < 1) {
          setBusy(false)
          return
        }
        const parse = (l: string) =>
          l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ''))
        const header = parse(lines[0])
        const sep = header.map(() => '---').join(' | ')
        const body = lines.slice(1)
          .map((l) => `| ${parse(l).join(' | ')} |`)
          .join('\n')
        onInsert(`\n| ${header.join(' | ')} |\n| ${sep} |\n${body}\n`)
        setBusy(false)
      }
      inp.click()
    } finally {
      // busy flag flipped in async onchange handler above
    }
  }

  return (
    <>
      <ToolbarButton label="⊞ 插入表格" onClick={insertGrid} />
      <ToolbarButton label={busy ? '解析中…' : '⊞ 从 CSV 插入'} onClick={insertCsv} disabled={busy} />
    </>
  )
}
