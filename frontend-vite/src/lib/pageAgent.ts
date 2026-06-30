/**
 * Front-end helpers used by both the public page-agent mount and the dual-mode
 * panel. These are intentionally framework-agnostic (no React) so they're
 * easy to unit-test and reuse from both the FAB and the panel.
 */

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

/**
 * customFetch replacement for `LLMConfig.customFetch`. Forwards every
 * page-agent tool-calling call through our backend `POST /api/public/agent/llm`
 * so that:
 *  - the upstream URL never appears in the browser address bar
 *  - the api key never leaves the server (Fernet-decrypted server-side)
 *  - the server can enforce URL-prefix / Referer / payload / rate-limit guards
 */
export async function customFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const r = await fetch('/api/public/agent/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ url: String(input), init: init ?? {} }),
  })
  // The server returns the raw upstream OpenAI response (JSON). We use
  // the global Response so headers / status pass through verbatim.
  return new Response(await r.text(), {
    status: r.status,
    headers: r.headers,
  })
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b1[3-9]\d{9}\b/g, '***'],                                                         // CN phone
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***'],                          // email
  [/\b(sk-[A-Za-z0-9_\-]{16,}|ghp_[A-Za-z0-9]{16,}|sk-ant-[A-Za-z0-9_\-]{16,})\b/g, '***'],  // common api key prefixes
  [/\bBearer\s+[A-Za-z0-9._\-]{16,}\b/g, '***'],                                       // Authorization literal
  [/\b\d{16,19}\b/g, '***'],                                                            // 16-19 digits = card-shaped
]

/**
 * Redact anything that resembles a phone, email, api key, or auth token
 * before page-agent ships the DOM-text representation to the LLM.
 * Defensive (not exhaustive) — page-agent users retain their trust.
 */
export function maskSecrets(content: string): string {
  let out = content
  for (const [pattern, repl] of SECRET_PATTERNS) {
    out = out.replace(pattern, repl)
  }
  return out
}

/**
 * Per-URL hint injected by page-agent's `getPageInstructions(url)` before each
 * step. Strongly nudges the agent to call `done` early on admin pages and
 * reminds it that the site is published research, not a free-form app.
 */
export function getPageHint(url: string): string {
  const u = url.toLowerCase()
  if (u.includes('/admin') || u.includes('/login') || u.includes('/account')) {
    return '【getPageInstructions】当前 URL 在 admin/login/account 路由——立即调用 done 工具并告诉用户"此页面不在我可操作范围"，不要点击任何元素。'
  }
  const PUBLIC_PREFIXES = ['/', '/articles', '/issues', '/about', '/search', '/domains', '/insights', '/cases']
  if (!PUBLIC_PREFIXES.some((p) => u === p || u.startsWith(p + '/') || u.startsWith(p + '?'))) {
    return '【getPageInstructions】未知页面，请勿执行任何写入性操作（仅允许点击导航链接读取）。'
  }
  return '【getPageInstructions】你正在公开页面。可在导航栏链接、搜索表单、文章阅读视图之间操作。注意：1) 不要触碰任何 data-ai-blocked 元素；2) 不要 submit <form>，但可以填字段；3) 不要 DELETE/PUT/POST（仅允许 GET 跳转）；4) 输入敏感词后立即停止并提示。'
}