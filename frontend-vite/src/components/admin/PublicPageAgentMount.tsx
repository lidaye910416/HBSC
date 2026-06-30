import { useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'
import { ChatPanel } from './PageAgentPanel'

/**
 * Public page-agent FAB — mounted on the public Layout so it appears on every
 * public route (homepage, articles, issues, about, search). Uses the same
 * UI as the admin PageAgentPanel via the shared ChatPanel render layer.
 *
 * The same backend `page_agent.*` AdminSetting rows control whether the FAB
 * appears: when the admin flips `page_agent.enabled` to true via the
 * AdminSettings UI, the next visitor refetch (staleTime 60s) starts showing
 * the FAB. No redeploy needed.
 */
const PUBLIC_AGENT_STORAGE_KEY = 'hbsc.page-agent.messages.public'

const PUBLIC_SOURCE = {
  useConfig: () =>
    useQuery({
      queryKey: ['public', 'agent', 'config'],
      queryFn: () => api.public.agent.config(),
      staleTime: 60_000,
    }),
  execute: (messages: Array<{ role: string; content: string }>) =>
    api.public.agent.execute(messages) as Promise<{ content: string }>,
  storageId: 'public',
}

export function PublicPageAgentMount() {
  return <ChatPanel source={PUBLIC_SOURCE} storageKey={PUBLIC_AGENT_STORAGE_KEY} />
}
