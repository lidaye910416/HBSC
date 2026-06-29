import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'

const PAGE_AGENT_CDN = 'https://cdn.jsdelivr.net/npm/page-agent@1.10.0/dist/iife/page-agent.demo.js'

declare global {
  interface Window {
    PageAgent?: any
  }
}

/**
 * Mounts the page-agent demo script and configures it to call our server-side
 * /api/admin/agent/execute proxy (so the API key never leaves the backend).
 *
 * Only renders in /admin/* routes — AdminLayout owns this component.
 */
export function PageAgentMount() {
  const initialized = useRef(false)

  const configQ = useQuery({
    queryKey: ['admin', 'agent', 'config'],
    queryFn: () => api.admin.agent.config(),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!configQ.data?.enabled) return
    if (initialized.current) return
    if (window.PageAgent) {
      init(window.PageAgent)
      initialized.current = true
      return
    }
    const s = document.createElement('script')
    s.src = PAGE_AGENT_CDN
    s.async = true
    s.crossOrigin = 'anonymous'
    s.onload = () => {
      if (window.PageAgent) {
        init(window.PageAgent)
        initialized.current = true
      }
    }
    document.head.appendChild(s)
    return () => {
      // Don't remove the script on unmount — page-agent keeps state.
    }
  }, [configQ.data?.enabled])

  return null
}

function init(PageAgent: any) {
  // page-agent's demo build expects direct LLM access. We don't want to
  // expose the API key, so for Phase 4 we ship a *config-only* mount:
  // the widget renders, but LLM calls are intentionally disabled at this
  // layer. The server-side /api/admin/agent/execute proxy is reserved for
  // future use (e.g. a custom in-house UI that calls the same endpoint).
  //
  // To prevent accidental calls leaking the API key to a third-party proxy,
  // we instantiate PageAgent with `model: '__disabled__'` which causes its
  // internal execute() to fail fast.
  try {
    new PageAgent({
      model: '__disabled__',
      baseURL: location.origin,
      apiKey: 'placeholder',
      language: 'zh-CN',
    })
  } catch {
    // Ignore — page-agent may throw if the DOM isn't fully ready.
  }
}
