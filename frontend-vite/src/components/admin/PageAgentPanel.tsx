import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare, X, Send, Loader2, Sparkles } from 'lucide-react'
import { api } from '../../services/api'
import './PageAgentPanel.css'

/**
 * In-house admin chat panel.
 *
 * Why a custom UI instead of the page-agent v1.10 IIFE bundle?
 * ----------------------------------------------------------------
 * page-agent v1.10's `OpenAIClient` (packages/llms/src/OpenAIClient.ts)
 * requires the upstream LLM to respond in OpenAI tool-calling format —
 * it throws `InvokeError(NO_TOOL_CALL)` whenever the response lacks
 * `choices[0].message.tool_calls`. Our `/api/admin/agent/execute` proxy
 * returns a flat `{ content: string }` payload (model-agnostic, no
 * tool-calling protocol). page-agent v1.10 also keeps its LLM instance
 * private (`#llm` in PageAgentCore), so an external override is
 * impossible without forking. The cleanest path is therefore a thin
 * in-house chat UI that calls the same backend endpoint, and reserves
 * the page-agent v1.10 upgrade for when we adopt a tool-calling model.
 *
 * Public variant: see ./PublicPageAgentMount.tsx — same UI, different
 * data source (`/api/public/agent/*` instead of `/api/admin/agent/*`).
 */

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
}

interface AgentConfig {
  enabled: boolean
  model: string
  base_url: string
}

interface AgentSource {
  /** useQuery for the agent config — must NOT auto-fetch when auth is missing. */
  useConfig: () => { data?: AgentConfig }
  /** POST messages and return { content: string }. */
  execute: (messages: Array<{ role: string; content: string }>) => Promise<{ content: string }>
  /** Identifier used for sessionStorage key separation. */
  storageId: string
}

const ADMIN_SOURCE: AgentSource = {
  useConfig: () =>
    useQuery({ queryKey: ['admin', 'agent', 'config'], queryFn: () => api.admin.agent.config(), staleTime: 60_000 }),
  execute: (messages) => api.admin.agent.execute(messages) as Promise<{ content: string }>,
  storageId: 'admin',
}

export const ADMIN_AGENT_STORAGE_KEY = 'hbsc.page-agent.messages.admin'

export function PageAgentPanel() {
  return <ChatPanel source={ADMIN_SOURCE} storageKey={ADMIN_AGENT_STORAGE_KEY} />
}

// ---------------------------------------------------------------------------
// Shared render layer. Both admin and public mounts go through this so any
// visual / behavioral change applies to both.
// ---------------------------------------------------------------------------
interface ChatPanelProps {
  source: AgentSource
  storageKey: string
}

export function ChatPanel({ source, storageKey }: ChatPanelProps) {
  const configQ = source.useConfig()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Hydrate history from sessionStorage (ephemeral)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[]
        if (Array.isArray(parsed)) setMessages(parsed)
      }
    } catch {
      // ignore corrupt storage
    }
  }, [storageKey])

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages))
    } catch {
      // ignore quota
    }
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, storageKey])

  if (!configQ.data?.enabled) return null

  const send = async () => {
    const text = input.trim()
    if (!text || pending) return
    setError(null)
    setInput('')
    const next: ChatMessage[] = [
      ...messages,
      { role: 'user', content: text, ts: Date.now() },
    ]
    setMessages(next)
    setPending(true)
    try {
      const apiMessages = next
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }))
      const res = await source.execute(apiMessages)
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.content, ts: Date.now() },
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : '调用失败'
      setError(msg)
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠️ ${msg}`, ts: Date.now() },
      ])
    } finally {
      setPending(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const clear = () => {
    setMessages([])
    setError(null)
  }

  return (
    <>
      {open ? (
        <div className="page-agent-panel" role="dialog" aria-label="page-agent 助手">
          <header className="page-agent-panel__header">
            <div className="page-agent-panel__title">
              <Sparkles size={16} />
              <span>page-agent</span>
              <code className="page-agent-panel__model">{configQ.data.model}</code>
            </div>
            <div className="page-agent-panel__actions">
              <button
                type="button"
                className="page-agent-panel__btn"
                onClick={clear}
                title="清空对话"
                aria-label="清空对话"
              >
                清空
              </button>
              <button
                type="button"
                className="page-agent-panel__btn"
                onClick={() => setOpen(false)}
                title="关闭"
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </div>
          </header>

          <div className="page-agent-panel__body" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="page-agent-panel__empty">
                <Sparkles size={20} />
                <p>试试问我：</p>
                <ul>
                  <li>"当前已发布多少篇文章？"</li>
                  <li>"最近一篇未发布文章的标题是什么？"</li>
                  <li>"给我推荐 3 个可写的研究方向"</li>
                </ul>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`page-agent-panel__msg page-agent-panel__msg--${m.role}`}
              >
                <div className="page-agent-panel__msg-role">
                  {m.role === 'user' ? '我' : m.role === 'assistant' ? 'AI' : '系统'}
                </div>
                <div className="page-agent-panel__msg-content">{m.content}</div>
              </div>
            ))}
            {pending && (
              <div className="page-agent-panel__msg page-agent-panel__msg--assistant page-agent-panel__msg--pending">
                <Loader2 size={14} className="page-agent-panel__spin" />
                <span>思考中…</span>
              </div>
            )}
          </div>

          {error && <div className="page-agent-panel__error">{error}</div>}

          <footer className="page-agent-panel__footer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="输入问题，Enter 发送，Shift+Enter 换行"
              rows={2}
              disabled={pending}
              aria-label="输入"
            />
            <button
              type="button"
              className="page-agent-panel__send"
              onClick={() => void send()}
              disabled={pending || !input.trim()}
              aria-label="发送"
            >
              <Send size={16} />
            </button>
          </footer>
        </div>
      ) : (
        <button
          type="button"
          className="page-agent-fab"
          onClick={() => setOpen(true)}
          aria-label="打开 page-agent"
        >
          <MessageSquare size={20} />
        </button>
      )}
    </>
  )
}
