// frontend-vite/src/labs/BaseLabIframe.tsx
//
// Shared iframe host for embedded labs. Owns the parts every lab iframe needs
// — sandbox, reload-on-retry, and cross-origin-safe reachability check — so
// each lab component only supplies its src and fallback content instead of
// re-implementing all of it.
//
// Reachability check is a fetch(no-cors) HEAD against the iframe origin. On
// success we render the iframe; on network failure (lab dev server down,
// wrong port, CORS-blocked) we show the fallback immediately. This avoids
// the silent-blank-iframe problem and the bogus 8s wait that the previous
// postMessage-based approach had (miniCast never posted minicast:ready).
import { useEffect, useState, type ReactNode } from 'react'

// Allow scripts + same-origin (so embedded apps can use localStorage) + forms
// + downloads + popups (lab apps may want to open external links or download
// generated files like audio).
const DEFAULT_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox'
const DEFAULT_REACH_TIMEOUT_MS = 3000

interface BaseLabIframeProps {
  /** iframe src, already resolved for the current environment */
  src: string
  /** iframe title / accessible name */
  title: string
  /** base BEM class; the iframe uses `${baseClass}__frame` */
  baseClass: string
  /** fallback content shown when the embed fails to signal readiness */
  renderFallback: (retry: () => void) => ReactNode
  /** iframe sandbox attribute; defaults to scripts + same-origin + forms + downloads + popups */
  sandbox?: string
  /** ms to wait for the reachability probe before giving up */
  reachTimeoutMs?: number
  /** extra content (e.g. <noscript>) rendered inside the wrapper */
  children?: ReactNode
}

export function BaseLabIframe({
  src,
  title,
  baseClass,
  renderFallback,
  sandbox = DEFAULT_SANDBOX,
  reachTimeoutMs = DEFAULT_REACH_TIMEOUT_MS,
  children,
}: BaseLabIframeProps) {
  type Phase = 'probing' | 'reachable' | 'unreachable'
  const [phase, setPhase] = useState<Phase>('probing')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPhase('probing')

    // Derive a probe URL from the iframe src — try the iframe origin's root
    // so we don't depend on a specific API path existing in the lab app.
    let probeUrl: string
    try {
      const u = new URL(src, window.location.origin)
      probeUrl = u.origin
    } catch {
      // Unparseable src — fail closed
      setPhase('unreachable')
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), reachTimeoutMs)

    fetch(probeUrl, {
      method: 'GET', // many dev servers reject HEAD with 405; GET with no-cors is opaque but reachable detection works
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(() => {
        if (cancelled) return
        clearTimeout(timer)
        setPhase('reachable')
      })
      .catch(() => {
        if (cancelled) return
        clearTimeout(timer)
        setPhase('unreachable')
      })

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [reloadKey, src, reachTimeoutMs])

  const retry = () => {
    setReloadKey((k) => k + 1)
  }

  if (phase === 'unreachable') {
    return <div className={baseClass}>{renderFallback(retry)}</div>
  }

  return (
    <div className={baseClass}>
      {phase === 'probing' ? (
        // While probing, render the iframe anyway — most lab apps load fast
        // and the probe is just a fast-fail guard for unreachable targets.
        // The iframe starts blank during probe; this is brief.
        <iframe
          key={reloadKey}
          className={`${baseClass}__frame`}
          src={src}
          title={title}
          sandbox={sandbox}
          aria-busy="true"
        />
      ) : (
        <iframe
          key={reloadKey}
          className={`${baseClass}__frame`}
          src={src}
          title={title}
          sandbox={sandbox}
        />
      )}
      {children}
    </div>
  )
}
