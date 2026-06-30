import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'ghost' | 'solid' | 'danger'
type Size = 'sm' | 'md'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  label: string  // required for a11y
  icon: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', label, icon, className = '', ...rest },
  ref,
) {
  const cls = ['ui-icon-btn', `ui-icon-btn--${variant}`, `ui-icon-btn--${size}`, className]
    .filter(Boolean)
    .join(' ')
  return (
    <button ref={ref} className={cls} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  )
})