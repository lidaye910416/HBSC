import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageAgent } from 'page-agent'

import { api } from '../services/api'
import { customFetch, maskSecrets, getPageHint } from '../lib/pageAgent'
import { PageAgentFab } from './ai/PageAgentFab'
import { PageAgentPanel } from './ai/PageAgentPanel'

export function PublicPageAgentMount() {
  const configQ = useQuery({
    queryKey: ['public', 'agent', 'config'],
    queryFn: () => api.public.agent.config(),
    staleTime: 60_000,
  })

  const [agent, setAgent] = useState<PageAgent | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => {
    const cfg = configQ.data
    if (!cfg?.enabled) return
    const a = new PageAgent({
      baseURL: 'http://placeholder.invalid/v1',
      apiKey: 'placeholder',
      model: cfg.model,
      language: 'zh-CN',
      // Backend-supplied safety rails live here. If admin has not customized
      // the prompt, this falls back to DEFAULT_PAGE_AGENT_SYSTEM_PROMPT which
      // already includes all 10 protections appended in admin_setting_defaults.
      customSystemPrompt: cfg.system_prompt,
      getPageInstructions: getPageHint,
      transformPageContent: maskSecrets,
      maxSteps: 20,
      stepDelay: 0.4,
      experimentalScriptExecutionTool: false,
      customFetch,
    })
    setAgent(a)
    return () => {
      a.dispose?.()
    }
  }, [configQ.data])

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
