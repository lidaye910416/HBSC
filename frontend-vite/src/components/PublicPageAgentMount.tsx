import { useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'

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
  const agent = useSyncExternalStore(subscribe, getCurrent, () => null)
  const [panelOpen, setPanelOpen] = useState(false)

  if (!configQ.data?.enabled || !agent) return null

  return (
    <>
      {!panelOpen && <PageAgentFab onClick={() => setPanelOpen(true)} />}
      {panelOpen && (
        <PageAgentPanel
          agent={agent}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  )
}

// Re-export disposeSession for any future "close FAB for good" UI
// (not currently wired; the FAB stays available until beforeunload).
export { disposeSession }