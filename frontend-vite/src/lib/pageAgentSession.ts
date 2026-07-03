import { PageAgent } from 'page-agent'
import { customFetch, getPageHint, maskSecrets } from './pageAgent'

type PublicAgentConfig = {
  enabled: boolean
  model: string
  base_url: string
  system_prompt: string
}

type Listener = () => void

/**
 * Module-level singleton owner for the public page-agent.
 *
 * Lifetime: the entire browser-tab session. Created lazily on first
 * `acquire()` (driven by `PublicPageAgentMount` once config is loaded),
 * disposed only on `beforeunload` or explicit `disposeSession()`.
 *
 * Survives:
 *   - React StrictMode double-invoke (no useRef to clobber)
 *   - Component remounts (HMR, Vite Fast Refresh, route-boundary swaps)
 *   - React Query refetches of the config (we cache config here too)
 *
 * Recovery: if a previous instance was disposed (HMR reload, dev hot
 * update, manual dispose), the next `acquire()` creates a fresh one
 * automatically. The `PageAgentPanel` catch-block on
 * "PageAgent has been disposed" calls `acquire()` to trigger recovery.
 */

let sessionAgent: PageAgent | null = null
let sessionConfig: PublicAgentConfig | null = null
let creatingPromise: Promise<PageAgent | null> | null = null
let createCancelled = false
const listeners = new Set<Listener>()

function notify(): void {
  for (const l of listeners) l()
}

function isRecoverableDisposedError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes('PageAgent has been disposed')
  )
}

/**
 * Idempotent: returns the live agent if alive, otherwise creates one.
 * Safe to call from React render or effects — concurrent calls share
 * the same in-flight creation promise.
 */
export async function acquire(): Promise<PageAgent | null> {
  // Fast path: live agent, not disposed. `disposed` is a public boolean
  // on PageAgentCore (see node_modules/@page-agent/core/dist/esm/
  // PageAgentCore.d.ts:305), so we can self-heal if some external
  // code called dispose() without going through disposeSession().
  if (sessionAgent && !sessionAgent.disposed) {
    return sessionAgent
  }
  // Stale ref (external dispose, or never set) — clear and fall through.
  sessionAgent = null
  // In-flight creation — return the same promise so concurrent callers
  // share one instance
  if (creatingPromise) return creatingPromise
  // Need a config to create. The mount component is the only valid
  // caller; if it forgot to setConfig first, return null.
  if (!sessionConfig?.enabled) return null
  // Reset cancellation flag for this create cycle — `disposeSession()`
  // may have set it during a previous create that was racing.
  createCancelled = false
  creatingPromise = (async () => {
    try {
      // Yield to the microtask queue BEFORE constructing the agent.
      // Reason: a concurrent disposeSession() that lands between this
      // `createCancelled = false` reset and the `if (createCancelled)`
      // check below would otherwise force us to construct an agent only
      // to immediately dispose() it. Yielding lets disposeSession run
      // first and re-set the flag, so we can short-circuit cleanly.
      await Promise.resolve()
      if (createCancelled) {
        return null
      }
      const a = new PageAgent({
        baseURL: sessionConfig!.base_url,
        // Placeholder only — the backend /api/public/agent/llm proxy
        // injects the real key; the real key never leaves the server.
        apiKey: 'placeholder',
        model: sessionConfig!.model,
        language: 'zh-CN',
        customSystemPrompt: sessionConfig!.system_prompt,
        getPageInstructions: getPageHint,
        transformPageContent: maskSecrets,
        maxSteps: 20,
        stepDelay: 0.4,
        experimentalScriptExecutionTool: false,
        customFetch,
      })
      if (createCancelled) {
        // disposeSession() ran while we were constructing; don't resurrect.
        try { a.dispose() } catch { /* swallow */ }
        return null
      }
      sessionAgent = a
      notify()
      return a
    } finally {
      creatingPromise = null
    }
  })()
  return creatingPromise
}

/**
 * Set the config used by `acquire()`. If the config changed (model,
 * base_url, system_prompt) AND we have a live agent, dispose the old
 * one so the next `acquire()` picks up the new settings. Config-only
 * changes (the JSON object's identity, e.g., after a refetch with the
 * same content) are NO-OPs.
 */
export function setConfig(cfg: PublicAgentConfig | null): void {
  const prev = sessionConfig
  const next = cfg
  // No-op if same content (ignoring object identity, comparing fields)
  if (
    prev &&
    next &&
    prev.enabled === next.enabled &&
    prev.model === next.model &&
    prev.base_url === next.base_url &&
    prev.system_prompt === next.system_prompt
  ) {
    return
  }
  sessionConfig = next
  // If config materially changed and we have a live agent, dispose it
  // so the next acquire() rebuilds with new settings.
  // Invariant: dispose-on-material-change is the ONLY path (besides
  // disposeSession) that mutates the existing agent — it stays
  // symmetric with disposeSession's createCancelled + nulling pattern.
  if (sessionAgent && prev && next && (
    prev.model !== next.model ||
    prev.base_url !== next.base_url ||
    prev.system_prompt !== next.system_prompt
  )) {
    try {
      sessionAgent.dispose()
    } catch {
      /* swallow */
    }
    sessionAgent = null
  }
  notify()
}

/**
 * Explicit disposal — used by `beforeunload` and tests.
 */
export function disposeSession(): void {
  // Mark any in-flight create() so its IIFE can detect the cancellation
  // and avoid resurrecting sessionAgent after we return.
  createCancelled = true
  if (sessionAgent) {
    try {
      sessionAgent.dispose()
    } catch {
      /* swallow */
    }
    sessionAgent = null
  }
  notify()
}

/**
 * Subscribe to session changes. Returns an unsubscribe function.
 * Used by `useSyncExternalStore` in `PublicPageAgentMount`.
 */
export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * Read the current agent synchronously. Returns null if not yet
 * created (i.e., `acquire()` hasn't been called or it's still in flight).
 */
export function getCurrent(): PageAgent | null {
  return sessionAgent
}

export { isRecoverableDisposedError }

/**
 * Install `beforeunload` listener ONCE on module load. Idempotent via
 * module-level guard.
 */
let unloadInstalled = false
export function installUnloadHandler(): void {
  if (unloadInstalled) return
  if (typeof window === 'undefined') return
  unloadInstalled = true
  window.addEventListener('beforeunload', () => disposeSession())
}

/**
 * Dev-only: expose the session handles on `window` so Playwright tests
 * (and ad-hoc DevTools poking) can call dispose / acquire / getCurrent
 * against the *same* module instance the app uses.
 *
 * Why not just `await import('/src/lib/pageAgentSession.ts')` from the
 * test? In Vite dev mode, dynamic imports of a source URL can land on
 * a fresh module instance distinct from the one the app's static
 * imports resolved to — so a test calling `disposeSession()` on the
 * dynamic import would dispose a phantom agent while the app's real
 * singleton stayed untouched. Hanging the singleton off window
 * guarantees a single shared instance.
 *
 * Stripped from production builds by the import.meta.env.DEV guard.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as {
    __hbsc_pageAgentSession: {
      acquire: typeof acquire
      disposeSession: typeof disposeSession
      getCurrent: typeof getCurrent
      isRecoverableDisposedError: typeof isRecoverableDisposedError
    }
  }).__hbsc_pageAgentSession = {
    acquire,
    disposeSession,
    getCurrent,
    isRecoverableDisposedError,
  }
}
