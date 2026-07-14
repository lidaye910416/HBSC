// frontend-vite/src/labs/MiniCastLab.tsx
//
// Iframe wrapper for the MiniCast lab. Resolves iframeSrc from the shared
// registry, surfacing a fallback (retry + service start instructions) when
// cross-origin or network failure leaves the frame empty. The hbsc nav
// remains above the iframe — no double header.
import { useState } from 'react'
import registry from './registry.json'
import type { LabRegistry } from './types'

const typedRegistry = registry as LabRegistry
const minicast = typedRegistry.labs.find((l) => l.id === 'minicast')!

export function MiniCastLab() {
  const src = import.meta.env.DEV ? minicast.iframeSrc.dev : minicast.iframeSrc.prod
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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
        onLoad={(e) => {
          // Detect failure: if iframe loaded but contents are blank (cross-origin
          // unreachable), surface a fallback. Same-origin dev loads succeed silently.
          const iframe = e.currentTarget
          try {
            const doc = iframe.contentDocument
            if (doc && doc.body && doc.body.innerHTML === '') {
              setLoadError(true)
            }
          } catch {
            // Cross-origin — cannot inspect, assume OK
          }
        }}
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
