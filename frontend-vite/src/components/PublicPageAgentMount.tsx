import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PageAgent } from 'page-agent'
import { useLocation } from 'react-router-dom'

import { api } from '../services/api'
import {
  acquire,
  disposeSession,
  getCurrent,
  installUnloadHandler,
  setConfig,
  subscribe,
} from '../lib/pageAgentSession'
import { PageAgentFab } from './ai/PageAgentFab'
import { PageAgentPanel } from './ai/PageAgentPanel'
import { useIsJournalArticle } from './ai/useIsJournalArticle'

// ─── Magic morph ─────────────────────────────────────────────────────────
// The FAB and the panel share `position: fixed; right; bottom;` and
// `transform-origin: 100% 100%`. The two elements stay mounted through
// each open / close transition (instead of unmounting instantly when
// `panelOpen` flips) so CSS transitions can morph the FAB into the
// panel from the same bottom-right anchor — the macOS "genie" feel.
type Stage = 'closed' | 'opening' | 'open' | 'closing'
// Tuned to feel snappy but not abrupt; the panel animation runs a
// bit longer than the FAB transition so the panel "settles" after
// the FAB has already disappeared into the corner.
//
// Close sequence: panel settles (240ms CSS transition) while the FAB
// re-enters (100ms delay + 220ms animation = 320ms total) using the
// same gentle keyframe as first paint. We hold `closing` for the full
// 320ms so the FAB animation finishes *exactly* when the stage
// flips to `closed` — no mid-animation snap when data-state clears.
const OPEN_MS = 540
const CLOSE_MS = 320

export function PublicPageAgentMount() {
  const location = useLocation()
  const configQ = useQuery({
    queryKey: ['public', 'agent', 'config'],
    queryFn: () => api.public.agent.config(),
    staleTime: 60_000,
  })

  // Install the beforeunload handler exactly once at module-level on
  // first mount (idempotent — see pageAgentSession.ts).
  useEffect(() => installUnloadHandler(), [])

  // Push config into the session whenever it changes. setConfig is a
  // NO-OP if the config content is unchanged, so this is safe to call
  // on every refetch.
  useEffect(() => {
    setConfig(configQ.data ?? null)
  }, [configQ.data])

  // Drive lazy creation: as soon as the config says enabled, kick off
  // the one-time agent construction. The session owns dedup.
  useEffect(() => {
    if (configQ.data?.enabled) void acquire()
  }, [configQ.data?.enabled])

  // Re-render when the session changes (e.g., dispose + recreate).
  const liveAgent = useSyncExternalStore(subscribe, getCurrent, () => null)
  // 4-stage state machine: closed → opening → open → closing → closed.
  // Both FAB and panel mount during the transitions so CSS can morph
  // them; otherwise we'd see a snap unmount at the moment of toggle.
  const [stage, setStage] = useState<Stage>('closed')
  // Reset the stage timer whenever the stage changes so an in-flight
  // timeout from a previous stage doesn't fire after we already moved
  // on (e.g. user clicks close mid-open).
  const stageTimer = useRef<number | null>(null)
  const clearStageTimer = useCallback(() => {
    if (stageTimer.current !== null) {
      window.clearTimeout(stageTimer.current)
      stageTimer.current = null
    }
  }, [])
  useEffect(() => () => clearStageTimer(), [clearStageTimer])

  const advance = useCallback(
    (target: Stage, ms: number) => {
      clearStageTimer()
      stageTimer.current = window.setTimeout(() => {
        setStage(target)
        stageTimer.current = null
      }, ms)
    },
    [clearStageTimer],
  )

  const openPanel = useCallback(() => {
    setStage((prev) => {
      // If the user clicks the FAB while it's still mid-close, snap
      // straight to the open phase; CSS transitions will reverse
      // smoothly from whatever scale they're currently at.
      if (prev === 'closed' || prev === 'closing') {
        advance('open', OPEN_MS)
        return 'opening'
      }
      return prev
    })
  }, [advance])
  const closePanel = useCallback(() => {
    setStage((prev) => {
      if (prev === 'open' || prev === 'opening') {
        advance('closed', CLOSE_MS)
        return 'closing'
      }
      return prev
    })
  }, [advance])

  // The FAB lives only when the panel isn't fully open; the panel
  // lives only when it isn't fully closed. Both mount during the
  // transitions so the morph is visible (e.g. panel grows in while
  // FAB shrinks out, anchored at the same bottom-right corner).
  const showFab = stage !== 'open'
  const showPanel = stage !== 'closed'
  const fabDataState: 'shrinking' | 'expanding' | undefined =
    stage === 'opening' ? 'shrinking' : stage === 'closing' ? 'expanding' : undefined
  const panelDataState: 'expanding' | 'shrinking' | undefined =
    stage === 'opening' ? 'expanding' : stage === 'closing' ? 'shrinking' : undefined

  // Keep the last-known live agent in state so the panel can keep
  // rendering across the brief window where the session was disposed
  // and a new one is being constructed. The panel's own sendOperate
  // catch-block handles the "disposed" error and requests a fresh
  // agent via acquire() if the held prop is stale.
  const [lastAgent, setLastAgent] = useState<PageAgent | null>(null)
  useEffect(() => {
    if (liveAgent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastAgent(liveAgent)
    }
  }, [liveAgent])
  const renderAgent = liveAgent ?? lastAgent

  // 「播一下」tab 仅在期刊文章页开放；其他页面隐藏入口和 FAB 文案。
  const isJournalArticle = useIsJournalArticle()

  // Auto-recover: if the session was disposed while the FAB/panel is
  // still mounted (HMR reload, dev hot update, explicit reset), kick
  // off a fresh acquire() so the user doesn't have to close+reopen the
  // panel. The session singleton dedups via the in-flight creation
  // promise, so concurrent calls are safe.
  useEffect(() => {
    if (configQ.data?.enabled && !liveAgent) void acquire()
  }, [configQ.data?.enabled, liveAgent])

  if (!configQ.data?.enabled || !renderAgent) return null

  return (
    <>
      {showFab && (
        <PageAgentFab
          onClick={openPanel}
          data-state={fabDataState}
          showPodcast={isJournalArticle}
        />
      )}
      {showPanel && (
        <PageAgentPanel
          agent={renderAgent}
          routeKey={`${location.pathname}${location.search}`}
          onClose={closePanel}
          data-state={panelDataState}
          isJournalArticle={isJournalArticle}
        />
      )}
    </>
  )
}

// Re-export disposeSession for any future "close FAB for good" UI.
// (Not currently wired; the FAB stays available until beforeunload.)
void disposeSession
