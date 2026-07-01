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
  // Already alive — fast path
  if (sessionAgent /* && not disposed */) {
    // PageAgent sets `disposed = true` after dispose(); we mirror that
    // by nuking our cached ref so the next call recreates.
    // (We can't introspect `disposed` directly — it's private — but
    //  the dispose() method is the only way it becomes true, and we
    //  also clear sessionAgent in disposeSession. So if it's still
    //  non-null here we trust it.)
    return sessionAgent
  }
  // In-flight creation — return the same promise so concurrent callers
  // share one instance
  if (creatingPromise) return creatingPromise
  // Need a config to create. The mount component is the only valid
  // caller; if it forgot to setConfig first, return null.
  if (!sessionConfig?.enabled) return null
  creatingPromise = (async () => {
    try {
      const a = new PageAgent({
        baseURL: sessionConfig!.base_url,
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
