// frontend-vite/src/labs/MiniCastLab.tsx
//
// Iframe wrapper for the MiniCast lab. Resolves iframeSrc from the shared
// registry, surfacing a fallback (retry + service start instructions) when
// MiniCast does not signal readiness in time. The hbsc nav remains above the
// iframe — no double header.
import { useEffect, useState } from 'react'
import registry from './registry.json'
import type { LabRegistry } from './types'

const typedRegistry = registry as LabRegistry
const minicast = typedRegistry.labs.find((l) => l.id === 'minicast')!

// If MiniCast has not signalled readiness within this window, assume the
// service is unreachable and show the fallback. This is the common failure
// (dev service down, cross-origin unreachable) that contentDocument probing
// silently swallowed for cross-origin frames.
const READY_TIMEOUT_MS = 8000

export function MiniCastLab() {
  // In prod the iframe must point at a real, separately-deployed MiniCast
  // origin — NOT a same-origin /labs/minicast path (that URL is this very
  // React Router route, so a same-origin src would recursively re-render
  // MiniCastLab → infinite iframe nesting). Deployment injects the real URL
  // via VITE_MINICAST_URL at build time; registry.prod is the fallback.
  const src = import.meta.env.DEV
    ? minicast.iframeSrc.dev
    : (import.meta.env.VITE_MINICAST_URL ?? minicast.iframeSrc.prod)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Cross-origin-safe readiness detection: MiniCast's embed mode posts
  // { type: 'minicast:ready' } once mounted. If no such message arrives
  // before READY_TIMEOUT_MS, surface the fallback. Works across origins
  // (unlike iframe.contentDocument inspection, which throws SecurityError
  // on cross-origin frames and was silently caught).
  useEffect(() => {
    let ready = false
    const timer = setTimeout(() => {
      if (!ready) setLoadError(true)
    }, READY_TIMEOUT_MS)
    const onMessage = (e: MessageEvent) => {
      if (
        e.data &&
        typeof e.data === 'object' &&
        (e.data as { type?: unknown }).type === 'minicast:ready'
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
  }, [reloadKey])

  if (loadError) {
    return (
      <div className="minicast-lab">
        <div className="minicast-lab__error" role="alert">
          <h3>MiniCast 服务暂不可用</h3>
          <p>请确认 MiniCast 已启动：</p>
          <ul>
            <li>
              前端 dev 服务：<code>cd /Users/jasonlee/Projects/MiniCast/web &amp;&amp; npm run dev</code>
            </li>
            <li>
              后端：<code>cd /Users/jasonlee/Projects/MiniCast &amp;&amp; python -m minicast server</code>
            </li>
          </ul>
          <button
            type="button"
            className="lab-cta"
            onClick={() => {
              setLoadError(false)
              setReloadKey((k) => k + 1)
            }}
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="minicast-lab">
      <iframe
        key={reloadKey}
        className="minicast-lab__frame"
        src={src}
        title="MiniCast"
        // Sandbox: allow scripts + same-origin (so localStorage works for API key)
        sandbox="allow-scripts allow-same-origin allow-forms"
        onError={() => setLoadError(true)}
      />
      <noscript>
        <div className="minicast-lab__error">
          <p>
            MiniCast 需要启用 JavaScript。请
            <a href={minicast.iframeSrc.dev} target="_blank" rel="noopener noreferrer">
              在新窗口打开
            </a>
            。
          </p>
        </div>
      </noscript>
    </div>
  )
}
