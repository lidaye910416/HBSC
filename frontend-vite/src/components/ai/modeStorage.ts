export type AgentMode = 'ask' | 'operate' | 'podcast'

/**
 * Modes that persist chat history in sessionStorage.
 *
 * `podcast` is excluded because the podcast workflow keeps its own
 * state inside the PodcastPanel component (current job, audio element,
 * script text). It has no chat history to persist — the panel
 * re-renders from `idle` on every open.
 *
 * Keeping the list as an exported Set lets callers do membership
 * checks (e.g. `CHAT_HISTORY_MODES.has(mode)`) without re-typing
 * the union every place.
 */
export const CHAT_HISTORY_MODES: ReadonlySet<AgentMode> = new Set(['ask', 'operate'])

export function isChatHistoryMode(mode: AgentMode): boolean {
  return CHAT_HISTORY_MODES.has(mode)
}

const LEGACY_GLOBAL = 'hbsc.page-agent.chat.history'
const KEY_PREFIX = 'hbsc.page-agent.chat.history'

export function getStorageKey(routeKey: string, mode: AgentMode): string {
  return `${KEY_PREFIX}:${routeKey}:${mode}`
}

/**
 * Migrate the v1 single-bucket storage layout to the v2 per-mode layout.
 *
 * v1 keys:
 *   hbsc.page-agent.chat.history            (global fallback)
 *   hbsc.page-agent.chat.history:<routeKey> (per-route)
 *
 * v2 keys:
 *   hbsc.page-agent.chat.history:<routeKey>:ask
 *   hbsc.page-agent.chat.history:<routeKey>:operate
 *
 * Old messages without an explicit `mode` field default to `ask`.
 * Never overwrites an existing v2 bucket.
 */
export function migrateLegacyStorage(routeKey: string): void {
  const candidates = [
    `${KEY_PREFIX}:${routeKey}`,
    LEGACY_GLOBAL,
  ]
  for (const legacy of candidates) {
    const raw = sessionStorage.getItem(legacy)
    if (!raw) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      sessionStorage.removeItem(legacy)
      continue
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      sessionStorage.removeItem(legacy)
      continue
    }
    const askKey = getStorageKey(routeKey, 'ask')
    if (!sessionStorage.getItem(askKey)) {
      const migrated = parsed.map((m: Record<string, unknown>) => ({ ...m, mode: 'ask' as const }))
      sessionStorage.setItem(askKey, JSON.stringify(migrated))
    }
    sessionStorage.removeItem(legacy)
  }
}
