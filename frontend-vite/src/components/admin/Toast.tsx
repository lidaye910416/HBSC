/**
 * Tiny Toast helper used by the admin pages.
 *
 * Usage:
 *   const toast = useToast()
 *   toast.success('保存成功')
 *   toast.error(err instanceof Error ? err.message : '保存失败')
 *
 * Renders a single stacked list of toasts anchored bottom-right. Each toast
 * slides in from the right with a slight overshoot, sits for 3.5s, then
 * slides out. prefers-reduced-motion is honored — toasts appear instantly
 * and disappear instantly when reduced motion is preferred.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react'
import gsap from 'gsap'
import './Toast.css'

type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastContextValue {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    const node = document.querySelector<HTMLElement>(`[data-toast-id="${id}"]`)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!node || reduceMotion) {
      setItems((prev) => prev.filter((t) => t.id !== id))
      return
    }

    gsap.to(node, {
      opacity: 0,
      x: 24,
      duration: 0.22,
      ease: 'power2.in',
      onComplete: () => setItems((prev) => prev.filter((t) => t.id !== id)),
    })
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId++
      setItems((prev) => [...prev, { id, kind, message }])
      const t = setTimeout(() => dismiss(id), 3500)
      timers.current.set(id, t)
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((t) => clearTimeout(t))
      map.clear()
    }
  }, [])

  const value: ToastContextValue = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="admin-toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (reduceMotion.current) {
      gsap.set(node, { opacity: 1, x: 0 })
      return
    }
    gsap.fromTo(
      node,
      { opacity: 0, x: 40 },
      { opacity: 1, x: 0, duration: 0.32, ease: 'back.out(1.4)' },
    )
  }, [])

  const Icon = item.kind === 'success' ? CheckCircle2 : item.kind === 'error' ? AlertCircle : Info

  return (
    <div
      ref={ref}
      data-toast-id={item.id}
      className={`admin-toast admin-toast--${item.kind}`}
      onClick={onDismiss}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Escape' || e.key === 'Enter') && onDismiss()}
    >
      <Icon size={18} />
      <span className="admin-toast__msg">{item.message}</span>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Fallback so existing code doesn't crash if ToastProvider isn't mounted:
    // log to console instead of throwing.
    return {
      success: (m) => console.info('[toast]', m),
      error: (m) => console.error('[toast]', m),
      info: (m) => console.info('[toast]', m),
    }
  }
  return ctx
}