import type { ReactNode } from 'react'
import { Code, Loader2 } from 'lucide-react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MindmapBlock } from './MindmapBlock'

type Props = {
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  className?: string // composed onto the wrapper; lets the host panel keep
                     // existing visual variants (padding/border/colors)
}

// react-markdown lets us swap individual tag renderers. We only override
// the ones that need non-trivial behavior (code blocks for mindmaps, tables
// so they fit in the panel, links that should not navigate away from the
// underlying app).
function buildComponents(): Components {
  return {
    a({ href, children, ...rest }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
          {children}
        </a>
      )
    },
    table({ children }) {
      return (
        <div className="page-agent-tableWrap">
          <table className="page-agent-table">{children}</table>
        </div>
      )
    },
    code({ className, children, ...rest }) {
      // Inline code (no language class) renders as a normal <code>. Fenced
      // blocks arrive with className="language-xxx" from remark-gfm.
      const isInline = !className
      if (isInline) {
        return (
          <code className="page-agent-inlineCode" {...rest}>
            {children}
          </code>
        )
      }
      const lang = (className ?? '').replace(/^language-/, '')
      const text = String(children ?? '').replace(/\n$/, '')
      if (lang === 'markmap') {
        // System prompt teaches the model to emit ```` ```markmap ```` code
        // blocks for mindmap requests. If a model ever slips and uses
        // ```` ```mermaid ```` the syntax is incompatible, so it falls
        // through to the default fenced-code renderer below — better to
        // show source than a broken mindmap.
        return <MindmapBlock code={text} />
      }
      return (
        <div className="page-agent-codeBlock" data-testid="page-agent-codeblock">
          <div className="page-agent-codeBlockHeader">
            <Code size={12} aria-hidden="true" />
            <span>{lang || 'code'}</span>
          </div>
          <pre><code className={className} {...rest}>{text}</code></pre>
        </div>
      )
    },
    pre({ children }) {
      // The fenced-code renderer above already emits its own <pre>; pass
      // through untouched so we don't double-wrap.
      return <>{children}</>
    },
    ul({ children }) {
      return <ul className="page-agent-list">{children}</ul>
    },
    ol({ children }) {
      return <ol className="page-agent-list">{children}</ol>
    },
    blockquote({ children }) {
      return <blockquote className="page-agent-quote">{children}</blockquote>
    },
    h1({ children }) {
      return <h3 className="page-agent-heading">{children}</h3>
    },
    h2({ children }) {
      return <h4 className="page-agent-heading">{children}</h4>
    },
    h3({ children }) {
      return <h5 className="page-agent-heading">{children}</h5>
    },
  }
}

export function MessageBubble({ role, content, pending = false, className }: Props): ReactNode {
  if (pending) {
    return (
      <div className={className} data-testid="page-agent-bubble-loading">
        <Loader2 size={14} className="page-agent-spin" aria-hidden="true" />
        思考中…
      </div>
    )
  }

  if (role === 'user') {
    // User input already carries formatting (newlines) and is short. Keep it
    // as preformatted text — running it through the markdown pipeline would
    // only add re-flow cost without improving fidelity.
    return (
      <div className={className} data-testid="page-agent-bubble-user">
        {content}
      </div>
    )
  }

  return (
    <div
      className={`${className ?? ''} page-agent-markdown`.trim()}
      data-testid="page-agent-bubble-assistant"
    >
      <Markdown remarkPlugins={[remarkGfm]} components={buildComponents()}>
        {content}
      </Markdown>
    </div>
  )
}
