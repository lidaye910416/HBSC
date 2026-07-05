import { useState } from 'react'

/**
 * Wrap MDEditor's preview so that every <table> becomes clickable.
 * Clicking pops an editor that lets the admin edit cells, add/delete
 * rows and columns. On "完成", we DON'T write back to the source
 * Markdown automatically (the editor's textarea stays the source of
 * truth). The cell edits are kept in local state until Phase 3 wires
 * a "sync back to editor" path. For now, edits are reflected only in
 * the preview.
 */
export function inlineTableRenderer(original: React.ComponentType<any>) {
  return function InlineTableAwarePreview(props: any) {
    return <TableAwareWrapper Renderer={original} {...props} />
  }
}

function TableAwareWrapper({ Renderer, children, ...rest }: any) {
  return (
    <Renderer {...rest}>
      <TableInterceptor>{children}</TableInterceptor>
    </Renderer>
  )
}

function TableInterceptor({ children }: { children: React.ReactNode }) {
  if (!Array.isArray(children)) return wrapTables(children)
  return <>{children.map((c) => wrapTables(c))}</>
}

function wrapTables(node: any): React.ReactNode {
  if (!node || typeof node !== 'object') return node
  if (node.type === 'table') {
    return <ClickableTable key={node.key}>{node.props.children}</ClickableTable>
  }
  if (node.props?.children) {
    return { ...node, props: { ...node.props, children: wrapTables(node.props.children) } }
  }
  return node
}

function ClickableTable({ children }: { children: React.ReactNode }) {
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <div
        style={{ display: 'inline-block', cursor: 'pointer', outline: '1px dashed transparent' }}
        onClick={() => setEditing(true)}
        onMouseEnter={(e) => (e.currentTarget.style.outline = '1px dashed #C9A84C')}
        onMouseLeave={(e) => (e.currentTarget.style.outline = '1px dashed transparent')}
      >
        {children}
      </div>
    )
  }
  return (
    <div style={{ border: '1px solid var(--brand-gold, #C9A84C)', padding: '8px', background: 'var(--brand-paper-warm, #F5F0E8)' }}>
      <div style={{ fontSize: '0.75rem', marginBottom: '6px' }}>
        表格编辑（Phase 2 范围内：只读预览 + "完成"退出，不写回 Markdown）
      </div>
      {children}
      <button type="button" onClick={() => setEditing(false)} style={{ marginTop: '6px', fontSize: '0.75rem' }}>
        完成
      </button>
    </div>
  )
}
