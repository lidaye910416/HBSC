import { useEffect, useState, useSyncExternalStore } from 'react'
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
  const [panelOpen, setPanelOpen] = useState(false)
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
      {!panelOpen && <PageAgentFab onClick={() => setPanelOpen(true)} />}
      {panelOpen && (
        <PageAgentPanel
          agent={renderAgent}
          routeKey={`${location.pathname}${location.search}`}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  )
}

// Re-export disposeSession for any future "close FAB for good" UI.
// (Not currently wired; the FAB stays available until beforeunload.)
void disposeSession