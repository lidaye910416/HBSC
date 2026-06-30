import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCopy, Sparkles, Wand2 } from 'lucide-react'
import MDEditor from '@uiw/react-md-editor'
import { api } from '../../services/api'
import { PageHeader, Button, Card } from '../../components/ui'
import { TypesetPreviewDialog } from '../../components/admin/TypesetPreviewDialog'
import './AdminTypeset.css'

/**
 * Standalone AI 排版 page at /admin/typeset.
 *
 * Reuses the existing `/api/admin/articles/typeset` endpoint — the same one
 * the ArticleEditor "AI 排版" button calls. The only difference is the
 * source of the markdown: here, the admin pastes arbitrary markdown into a
 * dedicated editor and reviews the cleaned output in the standard
 * `TypesetPreviewDialog`. No draft is created, no article row touched.
 *
 * Read config the same way ArticleEditor does — so the disabled-state copy
 * stays in sync: "请先在 设置 → AI 排版 中启用".
 */
export function AdminTypeset() {
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<{
    before: string
    after: string
    warnings: string[]
    model: string
    promptVersion: string
  } | null>(null)

  const configQ = useQuery({
    queryKey: ['admin', 'article-typesetter', 'config', 'standalone'],
    queryFn: async () => {
      const items = (await api.admin.settings.list()).items
      const get = (k: string) => items.find((i) => i.key === k)
      const enabled = get('article_typesetter.enabled')?.value === 'true'
      const hasKey = !!get('article_typesetter.api_key')?.masked
      const model = get('article_typesetter.model')?.value
        ?? get('article_typesetter.model')?.default_value
        ?? 'MiniMax-M3'
      return { enabled, hasKey, model }
    },
    staleTime: 30_000,
  })
  const ready = !!configQ.data?.enabled && !!configQ.data?.hasKey
  const blockedReason = configQ.isLoading
    ? '正在检查 AI 排版配置…'
    : !configQ.data?.enabled
      ? '请先在 设置 → AI 排版 中启用'
      : !configQ.data?.hasKey
        ? '请先在 设置 → AI 排版 中配置 API Key'
        : ''

  const charCount = useMemo(() => content.length, [content])
  const truncated = charCount > 32_000

  const onTypeset = async () => {
    if (!content.trim()) {
      setError('请先粘贴 markdown 内容')
      return
    }
    setBusy(true)
    setError('')
    const before = content
    try {
      const res = await api.admin.articles.typeset(before)
      setDialog({
        before,
        after: res.content_markdown,
        warnings: res.warnings || [],
        model: res.model,
        promptVersion: res.prompt_version,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 排版失败')
    } finally {
      setBusy(false)
    }
  }

  const onCopyAfter = async () => {
    if (!dialog?.after) return
    try {
      await navigator.clipboard.writeText(dialog.after)
    } catch {
      // Fallback: ignored — dialog already shows full text in a read-only
      // textarea so admin can select-and-copy manually.
    }
  }

  return (
    <div className="admin-typeset" data-color-mode="light">
      <PageHeader
        title="AI 排版（独立）"
        description="粘贴任意 markdown，用配置的 LLM 清洗成可直接发布的稿件。不动元数据、不写数据库 — 仅作为 ArticleEditor 内 AI 排版按钮之外的工作流入口。"
        breadcrumb={[]}
        actions={
          <>
            <Button variant="secondary" onClick={() => setContent('')} disabled={busy}>
              清空
            </Button>
            <Button
              icon={<Sparkles size={14} />}
              onClick={onTypeset}
              disabled={busy || !ready || !content.trim()}
              loading={busy}
              title={ready ? '使用配置的 LLM 清洗当前 markdown' : blockedReason}
            >
              AI 排版
            </Button>
          </>
        }
      />

      {!configQ.isLoading && !ready && (
        <Card variant="outlined" className="admin-typeset__notice">
          <Wand2 size={16} />
          <span>{blockedReason}</span>
          <a href="/admin/settings#article_typesetter" className="admin-typeset__notice-link">
            前往设置 →
          </a>
        </Card>
      )}

      {error && <div className="admin-typeset__error">{error}</div>}

      <Card className="admin-typeset__editor">
        <div className="admin-typeset__toolbar">
          <span className="admin-typeset__toolbar-label">源 markdown</span>
          <span
            className={`admin-typeset__count${truncated ? ' admin-typeset__count--warn' : ''}`}
            aria-label="字符数"
          >
            {charCount.toLocaleString()} 字符{truncated && ' · 超 32k 将在服务端截断'}
          </span>
        </div>
        <MDEditor
          value={content}
          onChange={(v) => setContent(v || '')}
          height={520}
          preview="live"
        />
      </Card>

      <div className="admin-typeset__hints">
        <span>• 不会自动写入任何文章 — 仅当你在弹窗中点「复制结果」后，手动粘贴到 ArticleEditor</span>
        <span>• 系统 prompt 在 设置 → AI 排版 → 系统 Prompt 中可改</span>
        {configQ.data?.model && <span>• 当前模型：<code>{configQ.data.model}</code></span>}
      </div>

      {dialog && (
        <TypesetPreviewDialog
          open={true}
          onClose={() => setDialog(null)}
          onApply={(cleaned) => {
            setContent(cleaned)
            setDialog(null)
          }}
          before={dialog.before}
          after={dialog.after}
          warnings={dialog.warnings}
          model={dialog.model}
          promptVersion={dialog.promptVersion}
        />
      )}

      {dialog && (
        <div className="admin-typeset__float-actions">
          <Button
            variant="secondary"
            icon={<ClipboardCopy size={14} />}
            onClick={onCopyAfter}
          >
            复制结果到剪贴板
          </Button>
        </div>
      )}
    </div>
  )
}
