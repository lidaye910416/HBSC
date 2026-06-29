import { useState } from 'react'

/**
 * Wrap MDEditor's preview renderer so that every <img> becomes clickable.
 * Clicking pops a small inline editor for alt text and replacement URL.
 *
 * Usage: pass `inlineImageRenderer` to MDEditor's `components.props` for
 * the editor (or wrap the preview area).
 */
export function inlineImageRenderer(original: React.ComponentType<any>) {
  // Return a thin wrapper component that intercepts <img> children
  return function InlineImageAwarePreview(props: any) {
    return <ImageAwareWrapper Renderer={original} {...props} />
  }
}

function ImageAwareWrapper({ Renderer, children, ...rest }: any) {
  return (
    <Renderer {...rest}>
      <ImageInterceptor>{children}</ImageInterceptor>
    </Renderer>
  )
}

function ImageInterceptor({ children }: { children: React.ReactNode }) {
  // Walk the rendered tree and replace <img> with clickable variant.
  // Simple impl: cloneElement on direct children only.
  if (!Array.isArray(children)) {
    return wrapImgs(children)
  }
  return <>{children.map((c) => wrapImgs(c))}</>
}

function wrapImgs(node: any): React.ReactNode {
  if (!node || typeof node !== 'object') return node
  if (node.type === 'img') {
    return <ClickableImg key={node.key} src={node.props.src} alt={node.props.alt} />
  }
  if (node.props?.children) {
    return { ...node, props: { ...node.props, children: wrapImgs(node.props.children) } }
  }
  return node
}

function ClickableImg({ src, alt }: { src: string; alt?: string }) {
  const [editing, setEditing] = useState(false)
  const [altText, setAltText] = useState(alt || '')
  const [srcText, setSrcText] = useState(src)

  if (!editing) {
    return (
      <img
        src={srcText}
        alt={altText}
        style={{ maxWidth: '100%', cursor: 'pointer', outline: '1px dashed transparent' }}
        onClick={() => setEditing(true)}
        onMouseEnter={(e) => (e.currentTarget.style.outline = '1px dashed #C9A84C')}
        onMouseLeave={(e) => (e.currentTarget.style.outline = '1px dashed transparent')}
      />
    )
  }

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '8px',
        background: 'var(--color-bg-muted, #f5f0e8)',
        border: '1px solid #C9A84C',
        borderRadius: '6px',
        margin: '4px 0',
      }}
    >
      <div style={{ fontSize: '0.75rem', marginBottom: '4px' }}>编辑图片</div>
      <label style={{ display: 'block', fontSize: '0.75rem' }}>
        URL:{' '}
        <input
          value={srcText}
          onChange={(e) => setSrcText(e.target.value)}
          style={{ width: '400px', fontSize: '0.75rem' }}
        />
      </label>
      <label style={{ display: 'block', fontSize: '0.75rem', marginTop: '4px' }}>
        Alt:{' '}
        <input
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          style={{ width: '300px', fontSize: '0.75rem' }}
        />
      </label>
      <div style={{ marginTop: '6px', display: 'flex', gap: '4px' }}>
        <button type="button" onClick={() => setEditing(false)} style={{ fontSize: '0.75rem' }}>
          完成
        </button>
      </div>
    </span>
  )
}
