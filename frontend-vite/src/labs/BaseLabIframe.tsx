// frontend-vite/src/labs/BaseLabIframe.tsx
//
// Shared iframe host for embedded labs. Owns the parts every lab iframe needs
// — sandbox, reload-on-retry, and cross-origin-safe readiness detection — so
// each lab component only supplies its src and fallback content instead of
// re-implementing all of it.
//
// Readiness detection is cross-origin-safe: the embedded app posts
// { type: readyMessageType } once mounted. If no such message arrives before
// readyTimeoutMs, the fallback is shown. (iframe.contentDocument inspection is
// not usable here — it throws SecurityError on cross-origin frames.)
import { useEffect, useState, type ReactNode } from 'react'

// Allow scripts + same-origin (so embedded apps can use localStorage) + forms.
const DEFAULT_SANDBOX = 'allow-scripts allow-same-origin allow-forms'
const DEFAULT_READY_TIMEOUT_MS = 8000

interface BaseLabIframeProps {
  /** iframe src, already resolved for the current environment */
  src: string
  /** iframe title / accessible name */
  title: string
  /** base BEM class; the iframe uses `${baseClass}__frame` */
  baseClass: string
  /** postMessage `type` the embedded app posts when it is ready */
  readyMessageType: string
  /** fallback content shown when the embed fails to signal readiness */
  renderFallback: (retry: () => void) => ReactNode
  /** iframe sandbox attribute; defaults to scripts + same-origin + forms */
  sandbox?: string
  /** ms to wait for the ready message before showing the fallback */
  readyTimeoutMs?: number
  /** extra content (e.g. <noscript>) rendered inside the wrapper */
  children?: ReactNode
}

export function BaseLabIframe({
  src,
  title,
  baseClass,
  readyMessageType,
  renderFallback,
  sandbox = DEFAULT_SANDBOX,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  children,
}: BaseLabIframeProps) {
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let ready = false
    const timer = setTimeout(() => {
      if (!ready) setLoadError(true)
    }, readyTimeoutMs)
    const onMessage = (e: MessageEvent) => {
      if (
        e.data &&
        typeof e.data === 'object' &&
        (e.data as { type?: unknown }).type === readyMessageType
      ) {
        ready = true
        clearTimeout(timer)
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }
  }, [reloadKey, readyMessageType, readyTimeoutMs])

  const retry = () => {
    setLoadError(false)
    setReloadKey((k) => k + 1)
  }

  if (loadError) {
    return <div className={baseClass}>{renderFallback(retry)}</div>
  }

  return (
    <div className={baseClass}>
      <iframe
        key={reloadKey}
        className={`${baseClass}__frame`}
        src={src}
        title={title}
        sandbox={sandbox}
        onError={() => setLoadError(true)}
      />
      {children}
    </div>
  )
}
