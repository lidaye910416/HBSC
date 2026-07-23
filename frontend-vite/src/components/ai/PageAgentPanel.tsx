import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Bot, BrainCircuit, Headphones, MousePointerClick, Trash2, X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../../services/api'
import { PageAgent } from 'page-agent'
import { acquire, disposeSession, isRecoverableDisposedError } from '../../lib/pageAgentSession'
import { buildPageContextMessage, collectPageContext } from './pageContext'
import { getStorageKey, isChatHistoryMode, migrateLegacyStorage, type AgentMode } from './modeStorage'
import type { PageContext } from './pageContext'
import { MessageBubble } from './MessageBubble'
import { PodcastPanel } from './PodcastPanel'
import styles from './PageAgentPanel.module.css'

type UiMessage = { id: number; role: 'user' | 'assistant'; content: string; mode: AgentMode; routeKey?: string }


export function PageAgentPanel({
  agent,
  routeKey,
  onClose,
  'data-state': dataState,
  isJournalArticle,
}: {
  agent: PageAgent
  routeKey: string
  onClose: () => void
  /** Animation stage: 'expanding' (panel opening) or 'shrinking' (panel closing). */
  'data-state'?: 'expanding' | 'shrinking'
  /** 当前文章是否隶属某一期期刊；外部 useIsJournalArticle() 解析后传入。 */
  isJournalArticle?: boolean
}) {
  const [mode, setMode] = useState<AgentMode>('ask')
  const askKey = getStorageKey(routeKey, 'ask')
  const operateKey = getStorageKey(routeKey, 'operate')
  // Podcast mode does NOT have its own sessionStorage bucket — its state
  // lives entirely in the PodcastPanel component (current job, audio
  // element, script text). Loading the operate bucket under podcast mode
  // would leak unrelated history into the wrong tab.
  const storageKey = isChatHistoryMode(mode)
    ? (mode === 'ask' ? askKey : operateKey)
    : null
  const [history, setHistory] = useState<UiMessage[]>(() => {
    migrateLegacyStorage(routeKey)
    if (!storageKey) return []
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) return JSON.parse(raw) as UiMessage[]
    } catch {
      /* fall through */
    }
    return []
  })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [operating, setOperating] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearAsk, setClearAsk] = useState(true)
  const [clearOperate, setClearOperate] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)
  const clearCancelRef = useRef<HTMLButtonElement>(null)
  const clearTriggerRef = useRef<HTMLButtonElement>(null)
  // Used to refocus the textarea after a send completes so users can
  // immediately ask a follow-up without a manual click.
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Default to 1 row on phones so the footer stays compact; the user
  // can still type multi-line input — the textarea grows with content.
  const [textareaRows, setTextareaRows] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth <= 600 ? 1 : 2
  )
  const [pageContext, setPageContext] = useState<PageContext>(() =>
    collectPageContext(document, window.location),
  )
  // Re-evaluate the textarea row count on viewport resize so a phone
  // user who rotates the device gets the compact layout.
  useEffect(() => {
    const updateRows = () => setTextareaRows(window.innerWidth <= 600 ? 1 : 2)
    updateRows()
    window.addEventListener('resize', updateRows)
    return () => window.removeEventListener('resize', updateRows)
  }, [])
  // Empty-state prompts are split by mode: ask gives comprehension
  // prompts; operate gives action prompts. Both still respect the
  // page type (technical article gets a mind-map hint, etc.).
  const askPromptsByType = pageContext.type === 'technical-article'
    ? ['概括这篇文章的核心观点', '解释文章中的关键技术', '为这篇文章整理思维导图']
    : pageContext.type === 'article'
      ? ['概括这篇文章', '提炼文章的主要观点', '解释本页的重要内容']
      : ['这个页面主要提供什么内容？', '帮我找到本页的重点', '带我浏览当前页面']
  const operatePromptsByType = pageContext.type === 'technical-article'
    ? ['跳到下一篇文章', '帮我搜索相关技术资料', '滚动到下一篇推荐']
    : pageContext.type === 'article'
      ? ['回到文章列表', '打开这篇文章的下一篇', '搜索类似主题']
      : ['跳到首页', '打开搜索页', '带我浏览最新一期的文章列表']
  const emptyPrompts = mode === 'ask' ? askPromptsByType : operatePromptsByType
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

  const closeClearConfirm = useCallback(() => {
    setClearOpen(false)
    clearTriggerRef.current?.focus()
  }, [])

  // In-flight request guard. A slow chat/operate response must never appear
  // on a route the user has since navigated away from. routeKey acts as a
  // generation counter; the latest in-flight captures it and the completion
  // callbacks ignore updates that no longer match.
  const requestSeqRef = useRef(0)

  useEffect(() => {
    // Bump the request generation so any in-flight chat/operate response
    // from a previous route is dropped. We do this here, in the same effect
    // that re-keys history, so route changes and re-key happen together.
    requestSeqRef.current++
    let observer: MutationObserver | null = null
    let frame = 0
    const refreshContext = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // 保留 isJournalArticle：它由父组件 useIsJournalArticle() 异步解析后
        // 通过 prop 推入，再由下面的镜像 effect 写入 state。collectPageContext
        // 同步版本拿不到 journal_id，若不保留会让 400ms 后被覆盖成 false，
        // 导致「播一下」tab 在已经 fetch 到 journal_id 后突然消失。
        setPageContext((prev) => ({
          ...collectPageContext(document, window.location),
          isJournalArticle: prev.isJournalArticle,
        }))
      })
    }
    observer = new MutationObserver(refreshContext)
    const appContent = document.querySelector<HTMLElement>('main') ?? document.body
    observer.observe(appContent, { childList: true, subtree: true })
    refreshContext()
    const fallback = window.setTimeout(refreshContext, 400)
    migrateLegacyStorage(routeKey)
    let nextHistory: UiMessage[] = []
    if (storageKey) {
      try {
        const raw = sessionStorage.getItem(storageKey)
        if (raw) nextHistory = JSON.parse(raw) as UiMessage[]
      } catch {
        /* fall through */
      }
    }
    setHistory(nextHistory)
    nextIdRef.current = nextHistory.length > 0
      ? nextHistory.reduce((max, message) => Math.max(max, message.id), 0) + 1
      : 1
    setText('')
    setError(null)
    setClearOpen(false)
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      window.clearTimeout(fallback)
    }
    // Re-key on routeKey, not on storageKey. Mode switches should preserve
    // the user's draft input (otherwise typing in ask then switching tabs
    // wipes the textarea mid-flow). See "operate-mode forwards a URL" e2e.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey])

  // 期刊归属由父组件的 useIsJournalArticle() 解析后通过 prop 传入；
  // 这里把它同步到 pageContext，便于 buildPageContextMessage（系统提示）
  // 和渲染层共享同一份事实，避免在两处分别判断。
  useEffect(() => {
    const next = Boolean(isJournalArticle)
    setPageContext((prev) => (prev.isJournalArticle === next ? prev : { ...prev, isJournalArticle: next }))
  }, [isJournalArticle])

  // 当离开期刊文章进入非期刊页面时，若面板当前还停留在「播一下」模式，
  // 立即回退到「读懂本页」，否则会把已隐藏的 tab 仍然显示在 body 里。
  useEffect(() => {
    if (!isJournalArticle && mode === 'podcast') {
      setMode('ask')
    }
  }, [isJournalArticle, mode])

  // Persist chat history to the bucket matching the current mode.
  // Podcast mode intentionally skips persistence — its state lives in
  // PodcastPanel and re-renders from idle on every open.
  useEffect(() => {
    if (!isChatHistoryMode(mode)) return
    try {
      if (mode === 'ask') {
        sessionStorage.setItem(askKey, JSON.stringify(history))
      } else {
        sessionStorage.setItem(operateKey, JSON.stringify(history))
      }
    } catch {
      /* quota / disabled */
    }
  }, [history, mode, askKey, operateKey])

  // Auto-scroll on new message.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [history, operating])

  // Keep the compact in-panel confirmation keyboard-accessible.
  useEffect(() => {
    if (!clearOpen) return
    clearCancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeClearConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [clearOpen, closeClearConfirm])

  function handleClearConfirm() {
    const cleared: AgentMode[] = []
    if (clearAsk) cleared.push('ask')
    if (clearOperate) cleared.push('operate')
    if (cleared.length === 0) return
    try {
      for (const m of cleared) sessionStorage.removeItem(getStorageKey(routeKey, m))
    } catch {
      /* quota / disabled */
    }
    // If current view's bucket was cleared, drop in-memory history too.
    if (cleared.includes(mode)) {
      setHistory([])
      setText('')
      setError(null)
      setOperating(false)
    }
    disposeSession()
    // PublicPageAgentMount's auto-recover effect re-creates a fresh agent on
    // the next operate, so the singleton is already self-healing.
    setClearOpen(false)
  }

  // Chat-mode mutation: hits /api/public/agent/execute.
  const chatMut = useMutation({
    mutationFn: async (userText: string): Promise<string> => {
      const priorMessages = history
        .filter((message) => !message.routeKey || message.routeKey === routeKey)
        .map((message) => ({ role: message.role, content: message.content }))
      const r = await api.public.agent.execute([
        { role: 'system', content: buildPageContextMessage(pageContext) },
        ...priorMessages,
        { role: 'user', content: userText },
      ])
      return r.content
    },
  })

  async function send() {
    if (mode === 'ask') return sendAsk()
    return sendOperate()
  }

  async function sendAsk() {
    const userText = text.trim()
    if (!userText || chatMut.isPending || operating) return
    setError(null)
    setText('')
    const userId = nextIdRef.current++
    const mySeq = ++requestSeqRef.current
    setHistory((h) => [...h, { id: userId, role: 'user', content: userText, mode: 'ask', routeKey }])
    try {
      const reply = await chatMut.mutateAsync(userText)
      if (mySeq !== requestSeqRef.current) return
      setHistory((h) => [...h, { id: nextIdRef.current++, role: 'assistant', content: reply, mode: 'ask', routeKey }])
    } catch (e) {
      if (mySeq !== requestSeqRef.current) return
      const msg = e instanceof ApiError ? e.message : '调用失败，请稍后重试'
      setError(msg)
      setHistory((h) => [
        ...h,
        { id: nextIdRef.current++, role: 'assistant', content: '⚠️ ' + msg, mode: 'ask', routeKey },
      ])
    } finally {
      // refocus so users can type the next question immediately
      textareaRef.current?.focus()
    }
  }

  async function sendOperate() {
    const userText = text.trim()
    if (!userText || chatMut.isPending || operating) return
    setError(null)
    setText('')
    setOperating(true)
    const userId = nextIdRef.current++
    const mySeq = ++requestSeqRef.current
    setHistory((h) => [...h, { id: userId, role: 'user', content: userText, mode: 'operate', routeKey }])
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
        if (result.success) {
          reply = `✅ 已完成：${result.data || '(无详细描述)'}`
        } else {
          // Translate common upstream library errors into user-friendly
          // Chinese hints. page-agent's `execute()` does NOT throw on
          // LLM tool_call parse failures — it returns { success: false,
          // data: <error message> }, so the catch path never fires for
          // these. We must intercept here.
          const dataMsg = String(result.data ?? '')
          if (dataMsg.includes('No tool_call') && dataMsg.includes('valid JSON')) {
            reply = '⚠️ 页面助手暂时无法理解当前任务，请换种描述重试'
          } else if (dataMsg.includes('Step count exceeded')) {
            reply = '⚠️ 页面助手操作步骤过多，已自动中止。请简化任务或分步执行'
          } else {
            reply = `⚠️ 未能完成：${result.data || '任务中断'}`
          }
        }
      }
      if (reply) {
        if (mySeq !== requestSeqRef.current) {
          setOperating(false)
          textareaRef.current?.focus()
          return
        }
        setError(reply.startsWith('⚠️') ? reply.slice(2) : null)
        setHistory((h) => [
          ...h,
          { id: nextIdRef.current++, role: 'assistant', content: reply!, mode: 'operate', routeKey },
        ])
      }
    } finally {
      setOperating(false)
      textareaRef.current?.focus()
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className={styles.root} role="dialog" aria-label="AI 助手" data-testid="page-agent-panel" data-state={dataState} inert={dataState === "shrinking"}>
      <div className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandIcon} aria-hidden="true"><Bot size={17} /></span>
          <span>
            <strong>数创智伴</strong>
            <small>读懂本页 · 协助操作</small>
          </span>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="关闭 AI 助手面板"
          data-testid="page-agent-panel-close"
        >
          <X size={16} />
        </button>
      </div>

      <div className={styles.contextBar} data-testid="page-agent-context">
        <span className={styles.contextPulse} aria-hidden="true" />
        <span><small>正在理解</small><strong>{pageContext.title}</strong></span>
        <span className={styles.contextType}>{pageContext.typeLabel}</span>
      </div>

      <div className={styles.modeTabs} role="tablist" aria-label="选择模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'ask'}
          className={`${styles.modeTab} ${mode === 'ask' ? styles.modeTabActive : ''}`}
          onClick={() => setMode('ask')}
          data-testid="page-agent-mode-ask"
        >
          <BookOpen size={14} /> 读懂本页
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'operate'}
          className={`${styles.modeTab} ${mode === 'operate' ? styles.modeTabActive : ''}`}
          onClick={() => setMode('operate')}
          data-testid="page-agent-mode-operate"
        >
          <MousePointerClick size={14} /> 协助操作
        </button>
        {pageContext.isJournalArticle && (
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'podcast'}
            className={`${styles.modeTab} ${mode === 'podcast' ? styles.modeTabActive : ''}`}
            onClick={() => setMode('podcast')}
            data-testid="page-agent-mode-podcast"
          >
            <Headphones size={14} /> 播一下
          </button>
        )}
      </div>

      {mode === 'podcast' && (
        <div className={styles.body} data-testid="page-agent-podcast-body">
          <PodcastPanel pageContext={pageContext} />
        </div>
      )}

      {mode !== 'podcast' && (
      <div className={styles.body} ref={bodyRef} data-testid="page-agent-body">
        {history.length === 0 && !operating && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true"><BrainCircuit size={26} /></span>
            <strong>我是数创智伴，已读完当前页面</strong>
            <div>你可以直接询问本页内容，也可以让我点击、搜索或跳转页面。</div>
            {pageContext.isTechnicalArticle && (
              <div className={styles.mindmapHint} data-testid="page-agent-mindmap-hint">
                <BrainCircuit size={15} aria-hidden="true" />
                技术内容较多，我也可以为你绘制思维导图，帮助梳理结构。
              </div>
            )}
            <div className={styles.emptyPrompts}>
              {emptyPrompts.map((p) => (
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
          <MessageBubble
            key={m.id}
            role={m.role}
            content={m.content}
            className={`${styles.bubble} ${m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}
          />
        ))}

        {(chatMut.isPending || operating) && (
          <MessageBubble
            role="assistant"
            content=""
            pending
            className={`${styles.bubble} ${styles.bubbleAssistant}`}
          />
        )}

        {error && <div className={styles.error}>{error}</div>}
      </div>
      )}


      {mode !== 'podcast' && (
      <div className={styles.footer}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder={mode === 'ask' ? '问一个关于本页的问题…' : '描述想让我做的事，如「跳到搜索页」…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          rows={textareaRows}
          aria-label="提问输入框"
          data-testid="page-agent-input"
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGrow} ${mode === 'operate' ? styles.btnPrimary : styles.btnSecondary}`}
            onClick={() => void send()}
            disabled={!text.trim() || chatMut.isPending || operating}
            data-testid="page-agent-submit-btn"
          >
            {mode === 'ask'
              ? <><BookOpen size={15} /> 提问</>
              : <><MousePointerClick size={15} /> 执行</>}
          </button>
          <button
            ref={clearTriggerRef}
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => setClearOpen(true)}
            disabled={operating || chatMut.isPending}
            aria-label="清空上下文"
            title="清空本次对话"
            data-testid="page-agent-clear-btn"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      )}

      {clearOpen && (
        <div className={styles.clearLayer} onClick={closeClearConfirm}>
          <section
            className={styles.clearCard}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="page-agent-clear-title"
            aria-describedby="page-agent-clear-description"
            data-testid="page-agent-clear-confirm-card"
            onClick={(event) => event.stopPropagation()}
          >
            <span className={styles.clearIcon} aria-hidden="true"><Trash2 size={17} /></span>
            <div className={styles.clearCopy}>
              <strong id="page-agent-clear-title">清空本次对话？</strong>
              <p id="page-agent-clear-description">选择要清空的桶；当前模式下的桶被清空时会重置页面助手会话。</p>
              <label className={styles.clearOption}>
                <input
                  type="checkbox"
                  checked={clearAsk}
                  onChange={e => setClearAsk(e.target.checked)}
                  data-testid="page-agent-clear-ask"
                />
                清空问答（{history.filter(m => m.mode === 'ask').length} 条）
              </label>
              <label className={styles.clearOption}>
                <input
                  type="checkbox"
                  checked={clearOperate}
                  onChange={e => setClearOperate(e.target.checked)}
                  data-testid="page-agent-clear-operate"
                />
                清空操作（{history.filter(m => m.mode === 'operate').length} 条）
              </label>
            </div>
            <div className={styles.clearActions}>
              <button ref={clearCancelRef} type="button" className={styles.clearCancel} onClick={closeClearConfirm}>
                取消
              </button>
              <button
                type="button"
                className={styles.clearConfirm}
                onClick={handleClearConfirm}
                disabled={!clearAsk && !clearOperate}
                data-testid="page-agent-clear-confirm"
              >
                清空
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
