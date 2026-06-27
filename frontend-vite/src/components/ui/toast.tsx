import * as React from "react"
import { X, CheckCircle, AlertCircle, Info } from "lucide-react"
import { cn } from "@/lib/utils"

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  title?: string
  description?: string
  type: ToastType
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return context
}

interface ToastProviderProps {
  children: React.ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const addToast = React.useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts(prev => [...prev, { ...toast, id }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }, [])

  const removeToast = React.useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertCircle,
}

function ToastContainer({ 
  toasts, 
  removeToast 
}: { 
  toasts: Toast[] 
  removeToast: (id: string) => void 
}) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map(toast => {
        const Icon = icons[toast.type]
        return (
          <div
            key={toast.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border bg-surface p-4 shadow-lg animate-slide-up max-w-sm",
              toast.type === 'success' && "border-accent/30",
              toast.type === 'error' && "border-destructive/30",
              toast.type === 'warning' && "border-amber-500/30",
              toast.type === 'info' && "border-blue-500/30"
            )}
          >
            <Icon className={cn(
              "h-5 w-5 flex-shrink-0 mt-0.5",
              toast.type === 'success' && "text-green-600",
              toast.type === 'error' && "text-destructive",
              toast.type === 'warning' && "text-amber-500",
              toast.type === 'info' && "text-blue-500"
            )} />
            <div className="flex-1">
              {toast.title && <p className="font-medium text-sm">{toast.title}</p>}
              {toast.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{toast.description}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
