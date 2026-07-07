import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ExternalLink, ArrowLeft, ImageOff, ImagePlus, CheckCircle2 } from 'lucide-react'
import { api, type JournalCompleteness } from '../../services/api'
import { PageHeader, Button, IconButton, Card, StatusBadge, Empty } from '../../components/ui'
import { useToast } from '../../components/admin/Toast'
import './JournalDetail.css'

const TABS = [
  { key: 'strategy',  label: '战略与政策', category: '战略与政策' },
  { key: 'technology', label: '技术与产业', category: '技术与产业' },
  { key: 'solution',  label: '方案与思考', category: '方案与思考' },
  { key: 'dynamics',  label: '动态与文化', category: '动态与文化' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function JournalDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const journalId = parseInt(id!, 10)
  const toast = useToast()
  const [tab, setTab] = useState<TabKey>('strategy')
  const [error, setError] = useState('')
  const articleFileRef = useRef<HTMLInputElement>(null)
  const [pendingArticleId, setPendingArticleId] = useState<number | null>(null)

  const journalQ = useQuery({
    queryKey: ['admin', 'journal', journalId],
    queryFn: () => api.admin.journals.get(journalId),
  })

  const groupedQ = useQuery({
    queryKey: ['admin', 'journal', journalId, 'grouped'],
    queryFn: () => api.admin.journals.articlesByCategory(journalId),
  })

  // 期刊封面健康：missing_file 时提示用户去编辑器里重新上传
  const { data: coversStatus } = useQuery({
    queryKey: ['admin', 'covers', 'status'],
    queryFn: () => api.admin.covers.status(),
  })
  const journalCover = coversStatus?.journals.find((j) => j.id === journalId)
  const articleCoverById = new Map<number, { status: string; cover_image: string | null }>()
  for (const a of coversStatus?.articles ?? []) {
    if (a.journal_id === journalId) {
      articleCoverById.set(a.id, { status: a.status, cover_image: a.cover_image })
    }
  }

  const publishMut = useMutation({
    mutationFn: () => api.admin.journals.publish(journalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'journals'] })
      qc.invalidateQueries({ queryKey: ['admin', 'journal', journalId] })
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : '发布失败'),
  })

  const uploadArticleCoverMut = useMutation({
    mutationFn: ({ articleId, file }: { articleId: number; file: File }) =>
      api.admin.articles.uploadCover(articleId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'covers', 'status'] })
      qc.invalidateQueries({ queryKey: ['admin', 'journal', journalId, 'grouped'] })
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
      toast.success('文章封面已更新')
    },
    onError: (err) => toast.error(`上传失败: ${err instanceof Error ? err.message : String(err)}`),
  })

  const handleArticleCoverPick = (articleId: number) => {
    setPendingArticleId(articleId)
    articleFileRef.current?.click()
  }

  const handleArticleCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || pendingArticleId == null) return
    uploadArticleCoverMut.mutate({ articleId: pendingArticleId, file: f })
    setPendingArticleId(null)
  }

  const completeness: JournalCompleteness | undefined = groupedQ.data?.completeness
  const canPublish = completeness?.complete && journalQ.data?.status !== 'published'

  const gotoNew = (category: string) => {
    const q = new URLSearchParams({ journal_id: String(journalId), category })
    navigate(`/admin/articles/new?${q.toString()}`)
  }

  if (journalQ.isLoading || groupedQ.isLoading) {
    return <div style={{ padding: '24px' }}>加载中…</div>
  }
  if (!journalQ.data) {
    return <div style={{ padding: '24px' }}>期刊不存在</div>
  }

  const j = journalQ.data
  const articles = groupedQ.data?.[tab] ?? []

  return (
    <div className="journal-detail">
      <PageHeader
        title={j.title}
        description={`/${j.slug}${j.issue_number ? ` · ${j.issue_number}` : ''}`}
        breadcrumb={[
          { label: '期刊', to: '/admin/journals' },
          { label: j.title },
        ]}
        actions={
          <>
            <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={() => navigate('/admin/journals')}>
              返回列表
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/admin/journals/${journalId}/edit`)}>
              编辑元数据
            </Button>
            <Button
              onClick={() => publishMut.mutate()}
              loading={publishMut.isPending}
              disabled={!canPublish || j.status === 'published'}
              title={
                !completeness?.complete
                  ? '四类文章齐全后才能发布'
                  : j.status === 'published'
                  ? '期刊已是发布状态'
                  : ''
              }
            >
              {j.status === 'published' ? '已发布' : publishMut.isPending ? '发布中…' : '发布期刊'}
            </Button>
          </>
        }
      />

      {error && <div className="journal-detail__error">{error}</div>}

      {/* 期刊封面健康横幅：DB 有 URL 但文件丢失时提示去编辑页重传 */}
      {journalCover?.status === 'missing_file' && (
        <div className="journal-detail__cover-warn" role="alert">
          <ImageOff size={16} />
          <span>
            期刊封面文件已丢失（DB 引用 <code>{journalQ.data?.cover_image}</code>），请到
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/admin/journals/${journalId}/edit`)}
              style={{ marginLeft: 8, marginRight: 8 }}
            >
              编辑元数据
            </Button>
            重新上传。
          </span>
        </div>
      )}

      <input
        ref={articleFileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleArticleCoverFile}
      />

      <div className="journal-detail__completeness">
        {(['战略与政策', '技术与产业', '方案与思考', '动态与文化'] as const).map((c) => {
          const n = completeness?.[c] ?? 0
          return (
            <div
              key={c}
              className={`journal-detail__pill ${n >= 1 ? 'journal-detail__pill--ok' : 'journal-detail__pill--missing'}`}
            >
              {c}: {n} 篇
            </div>
          )
        })}
      </div>

      <div className="journal-detail__tabs" role="tablist">
        {TABS.map((t) => {
          const count = groupedQ.data?.[t.key]?.length ?? 0
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`journal-detail__tab ${tab === t.key ? 'journal-detail__tab--active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label} <span className="journal-detail__tab-count">{count}</span>
            </button>
          )
        })}
      </div>

      <Card>
        <div className="journal-detail__panel-head">
          <Button icon={<Plus size={16} />} onClick={() => gotoNew(TABS.find((t) => t.key === tab)!.category)}>
            新建 {TABS.find((t) => t.key === tab)!.label}
          </Button>
        </div>
        {articles.length === 0 ? (
          <Empty title="此分类暂无文章" description="点上面按钮新建一篇。" />
        ) : (
          <table className="admin-table">
            <thead>
              <tr><th>标题</th><th>封面</th><th>状态</th><th>更新时间</th><th>操作</th></tr>
            </thead>
            <tbody>
              {articles.map((a) => {
                const cover = articleCoverById.get(a.id)
                return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-1)' }}>{a.title}</td>
                    <td>
                      {cover?.status === 'ok' ? (
                        <span title={cover.cover_image || ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--status-published-fg)', fontSize: 'var(--type-xs)' }}>
                          <CheckCircle2 size={14} /> 正常
                        </span>
                      ) : cover?.status === 'missing_file' ? (
                        <button
                          className="journal-detail__cover-fix-btn"
                          title={`文件已丢失：${cover.cover_image}`}
                          onClick={() => handleArticleCoverPick(a.id)}
                          disabled={uploadArticleCoverMut.isPending}
                        >
                          <ImageOff size={14} /> 补封面
                        </button>
                      ) : (
                        <button
                          className="journal-detail__cover-fix-btn"
                          title="尚未设置封面"
                          onClick={() => handleArticleCoverPick(a.id)}
                          disabled={uploadArticleCoverMut.isPending}
                        >
                          <ImagePlus size={14} /> 上传
                        </button>
                      )}
                    </td>
                    <td><StatusBadge status={a.status === 'published' ? 'published' : 'draft'} /></td>
                    <td style={{ fontSize: 'var(--type-sm)', color: 'var(--admin-text-2)' }}>{a.updated_at ? new Date(a.updated_at).toLocaleString('zh-CN') : '—'}</td>
                    <td>
                      <IconButton
                        label="编辑"
                        variant="ghost"
                        size="sm"
                        icon={<ExternalLink size={14} />}
                        onClick={() => navigate(`/admin/articles/${a.id}`)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}