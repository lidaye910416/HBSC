import { type ReactNode } from 'react'
import { X } from 'lucide-react'

export interface PillProps {
  children: ReactNode
  onRemove?: () => void
}

export function Pill({ children, onRemove }: PillProps) {
  return (
    <span className="ui-pill">
      <span>{children}</span>
      {onRemove && (
        <button
          type="button"
          className="ui-pill__remove"
          onClick={onRemove}
          aria-label={`移除 ${typeof children === 'string' ? children : '标签'}`}
        >
          <X size={12} />
        </button>
      )}
    </span>
  )
}