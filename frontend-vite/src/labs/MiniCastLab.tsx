// frontend-vite/src/labs/MiniCastLab.tsx
//
// MiniCast lab: resolves the MiniCast iframe src from the shared registry and
// delegates iframe hosting (sandbox, reload, reachability check, fallback) to
// BaseLabIframe. The hbsc nav remains above the iframe — no double header.
import registry from './registry.json'
import type { LabRegistry } from './types'
import { BaseLabIframe } from './BaseLabIframe'
import { LabToolbar } from './LabToolbar'

const typedRegistry = registry as LabRegistry
const minicast = typedRegistry.labs.find((l) => l.id === 'minicast')!

export function MiniCastLab() {
  // In prod the iframe must point at a real, separately-deployed MiniCast
  // origin — NOT a same-origin /labs/minicast path (that URL is this very
  // React Router route, so a same-origin src would recursively re-render
  // MiniCastLab → infinite iframe nesting). Deployment injects the real URL
  // via VITE_MINICAST_URL at build time; registry.prod is the fallback.
  const src = import.meta.env.DEV
    ? minicast.iframeSrc.dev
    : (import.meta.env.VITE_MINICAST_URL ?? minicast.iframeSrc.prod)

  // Open-in-new-window: strip the ?embed=1 marker so the standalone minicast
  // shows its full Header. In dev, point at the dev server origin (no
  // ?embed=1); in prod, point at the deployed origin.
  const standaloneUrl = src.replace(/[?&]embed=1\b/, '').replace(/[?&]$/, '')

  return (
    <BaseLabIframe
      src={src}
      title="MiniCast"
      baseClass="minicast-lab"
      header={
        <LabToolbar
          backHref="/labs"
          backLabel="← 返回数创实验室"
          externalHref={standaloneUrl}
          externalLabel="↗ 在新窗口打开"
        />
      }
      renderFallback={(retry) => (
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
          <button type="button" className="lab-cta" onClick={retry}>
            重试
          </button>
        </div>
      )}
    >
      <noscript>
        <div className="minicast-lab__error">
          <p>
            MiniCast 需要启用 JavaScript。请
            <a href={standaloneUrl} target="_blank" rel="noopener noreferrer">
              在新窗口打开
            </a>
            。
          </p>
        </div>
      </noscript>
    </BaseLabIframe>
  )
}
