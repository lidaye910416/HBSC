import type { ReactNode } from 'react'

/**
 * Toolbar group that renders inside an MDEditor preview-toolbar slot.
 * Children are buttons; we wrap them in a flex row with shared styles.
 */
export function MarkdownToolbar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: '4px',
        padding: '0 8px',
        borderLeft: '1px solid var(--color-border, #ddd)',
        marginLeft: '4px',
      }}
      onClick={(e) => e.stopPropagation()}  // prevent editor blur
    >
      {children}
    </div>
  )
}

export function ToolbarButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}  // keep editor focused
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 8px',
        fontSize: '0.8125rem',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: '4px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: 'var(--color-text-secondary)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover, #f3f4f6)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  )
}
