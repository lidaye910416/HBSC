import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquare, Sparkles, Trash2, X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../../services/api'
import { PageAgent } from 'page-agent'
import { acquire, disposeSession, isRecoverableDisposedError } from '../../lib/pageAgentSession'
import { Modal } from '../ui/Modal'
import styles from './PageAgentPanel.module.css'

type UiMessage = { id: number; role: 'user' | 'assistant'; content: string }

const STORAGE_KEY = 'hbsc.page-agent.chat.history'

const EMPTY_PROMPTS: string[] = [
  '介绍一下湖北数创期刊',
  '帮我跳到最新一期的文章列表',
  '搜索关键词 "复杂系统"',
]

export function PageAgentPanel({
  agent,
  onClose,
}: {
  agent: PageAgent
  onClose: () => void
}) {
  const [history, setHistory] = useState<UiMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw) as UiMessage[]
    } catch {
      /* fall through */
    }
    return []
  })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [operating, setOperating] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Seed nextId from the restored history. Without this, a fresh mount
  // (page reload / new tab) would restart the counter at 1 even when
  // sessionStorage already contains messages with ids 1..N, causing
  // React's "Encountered two children with the same key" warning.
  // `useRef` only consumes the initial value on the first render, so this
  // expression runs exactly once per mount.
  const nextIdRef = useRef<number>(
    history.length > 0
      ? history.reduce((max, m) => Math.max(max, m.id), 0) + 1
      : 1
  )

  // Persist chat history.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history))
    } catch {
      /* quota / disabled */
    }
  }, [history])

  // Auto-scroll on new message.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [history, operating])

  // Clear-context confirmation modal.
  const [clearOpen, setClearOpen] = useState(false)

  function handleClearConfirm() {
    setHistory([])
    setText('')
    setError(null)
    setOperating(false)
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* quota / disabled */
    }
    disposeSession()
    // PublicPageAgentMount's auto-recover effect re-creates a fresh agent on
    // the next operate, so the singleton is already self-healing.
    setClearOpen(false)
  }

  // Chat-mode mutation: hits /api/public/agent/execute.
  const chatMut = useMutation({
    mutationFn: async (userText: string): Promise<string> => {
      const priorMessages = history.map((m) => ({ role: m.role, content: m.content }))
      const r = await api.public.agent.execute([
        ...priorMessages,
        { role: 'user', content: userText },
      ])
      return r.content
    },
  })

  async function sendAsk() {
    const userText = text.trim()
    if (!userText || chatMut.isPending || operating) return
    setError(null)
    setText('')
    const userId = nextIdRef.current++
    setHistory((h) => [...h, { id: userId, role: 'user', content: userText }])
    try {
      const reply = await chatMut.mutateAsync(userText)
      setHistory((h) => [...h, { id: nextIdRef.current++, role: 'assistant', content: reply }])
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '调用失败，请稍后重试'
      setError(msg)
      setHistory((h) => [
        ...h,
        { id: nextIdRef.current++, role: 'assistant', content: '⚠️ ' + msg },
      ])
    }
  }

  async function sendOperate() {
    const userText = text.trim()
    if (!userText || chatMut.isPending || operating) return
    setError(null)
    setText('')
    setOperating(true)
    const userId = nextIdRef.current++
    setHistory((h) => [...h, { id: userId, role: 'user', content: userText }])
    let reply: string | null = null
    try {
      let result
      try {
        result = await agent.execute(userText)
      } catch (e) {
        // Defensive recovery: if the session was disposed (HMR reload,
        // dev hot update, explicit reset), the session singleton can
        // give us a fresh agent on the same try. We poll acquire() a
        // few times to ride out transient races — most notably the
        // dispose-during-create window where the in-flight IIFE is
        // cancelled and returns null. Without the retry, the user sees
        // a misleading "页面助手刚被刷新" toast even though the
        // singleton self-heals a moment later.
        if (isRecoverableDisposedError(e)) {
          let fresh: PageAgent | null = null
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              fresh = await acquire()
            } catch {
              /* swallow — try again */
            }
            if (fresh) break
            await new Promise<void>((r) => setTimeout(r, 120))
          }
          if (fresh) {
            try {
              result = await fresh.execute(userText)
            } catch (e2) {
              reply = '⚠️ ' + (e2 instanceof Error ? e2.message : '调用失败')
            }
          } else {
            reply = '⚠️ 页面助手刚被刷新，请重试一次'
          }
        } else {
          // The page-agent library occasionally fails to parse the LLM's
          // tool_call response ("No tool_call and the message content does
          // not contain valid JSON"). The library's internal LLM retry also
          // fails, so we just translate the cryptic raw error into a
          // user-friendly Chinese hint. (Real fix is upstream: switch to a
          // model with better tool-call support or upgrade the library.)
          const rawMsg = e instanceof Error ? e.message : '调用失败'
          if (rawMsg.includes('No tool_call') && rawMsg.includes('valid JSON')) {
            reply = '⚠️ 页面助手暂时无法理解当前任务，请换种描述重试'
          } else {
            reply = '⚠️ ' + rawMsg
          }
        }
      }
      if (reply === null && result) {
        reply = result.success
          ? `✅ 已完成：${result.data || '(无详细描述)'}`
          : `⚠️ 未能完成：${result.data || '任务中断'}`
      }
      if (reply) {
        setError(reply.startsWith('⚠️') ? reply.slice(2) : null)
        setHistory((h) => [
          ...h,
          { id: nextIdRef.current++, role: 'assistant', content: reply! },
        ])
      }
    } finally {
      setOperating(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendAsk()
    }
  }

  return (
    <div className={styles.root} role="dialog" aria-label="AI 助手" data-testid="page-agent-panel">
      <div className={styles.header}>
        <div className={styles.brand}>
          <Sparkles size={16} color="#C9A84C" aria-hidden="true" />
          <span className={styles.brandDot} aria-hidden="true" />
          AI 助手 · 湖北数创
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="关闭 AI 助手面板"
        >
          <X size={16} />
        </button>
      </div>

      <div className={styles.body} ref={bodyRef} data-testid="page-agent-body">
        {history.length === 0 && !operating && (
          <div className={styles.empty}>
            <Sparkles size={28} color="#C9A84C" aria-hidden="true" />
            <div>你好，我是 Hubei Guide。可以直接问我问题，或让我帮你操作页面。</div>
            <div className={styles.emptyPrompts}>
              {EMPTY_PROMPTS.map((p) => (
                <button
                  type="button"
                  key={p}
                  className={styles.emptyPrompt}
                  onClick={() => setText(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((m) => (
          <div
            key={m.id}
            className={`${styles.bubble} ${m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}
          >
            {m.content}
          </div>
        ))}

        {(chatMut.isPending || operating) && (
          <div
            className={`${styles.bubble} ${styles.bubbleAssistant}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Loader2 size={14} className="page-agent-spin" aria-hidden="true" />
            思考中…
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}
      </div>

      <div className={styles.footer}>
        <textarea
          className={styles.textarea}
          placeholder="问我一个问题，或描述你想在页面上做的事……"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          aria-label="提问输入框"
          data-testid="page-agent-input"
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={() => void sendAsk()}
            disabled={!text.trim() || chatMut.isPending || operating}
            data-testid="page-agent-ask-btn"
          >
            <MessageSquare size={14} />
            问他
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void sendOperate()}
            disabled={!text.trim() || chatMut.isPending || operating}
            data-testid="page-agent-operate-btn"
          >
            <Sparkles size={14} />
            让他操作
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => setClearOpen(true)}
            disabled={operating || chatMut.isPending}
            aria-label="清空上下文"
            data-testid="page-agent-clear-btn"
          >
            <Trash2 size={14} />
            清空
          </button>
        </div>
      </div>

      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="清空上下文"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => setClearOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleClearConfirm}
              data-testid="page-agent-clear-confirm"
            >
              确认清空
            </button>
          </>
        }
      >
        <p>确定要清空上下文吗？这将清除当前对话和 LLM 的记忆，无法撤销。</p>
      </Modal>
    </div>
  )
}
