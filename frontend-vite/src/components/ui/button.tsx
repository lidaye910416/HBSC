import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Admin pages historically pass `icon`, `loading`, and the legacy variant
// names (`primary`, `danger`) that are not part of the base shadcn-style set.
// We accept those plus arbitrary `variant` strings and render them through
// the existing `.ui-btn--*` classes that already exist in global.css.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent-hover shadow-sm hover:-translate-y-0.5",
        secondary: "bg-primary text-white hover:bg-opacity-90",
        accent: "bg-accent-light text-accent hover:bg-accent hover:text-white",
        ghost: "bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900",
        outline: "border border-gray-300 bg-transparent text-gray-700 hover:bg-gray-50",
        destructive: "bg-red-500 text-white hover:bg-red-600",
        link: "text-accent underline-offset-4 hover:underline",
        // Admin-legacy variants; mapped to existing CSS classes
        primary: "ui-btn--primary",
        danger: "ui-btn--danger",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-lg px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Lucide icon element rendered before the children. */
    icon?: React.ReactNode
    /** When true, renders the button as busy and disables it. */
    loading?: boolean
  }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, icon, loading, children, disabled, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {icon}
        {children}
        {loading && (
          <span
            aria-hidden
            style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', display: 'inline-block', animation: 'ui-spin 0.8s linear infinite' }}
          />
        )}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
