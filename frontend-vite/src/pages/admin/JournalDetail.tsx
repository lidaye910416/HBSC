import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ExternalLink, ArrowLeft } from 'lucide-react'
import { api, type JournalCompleteness } from '../../services/api'
import { PageHeader, Button, IconButton, Card, StatusBadge, Empty } from '../../components/ui'
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
  const [tab, setTab] = useState<TabKey>('strategy')
  const [error, setError] = useState('')

  const journalQ = useQuery({
    queryKey: ['admin', 'journal', journalId],
    queryFn: () => api.admin.journals.get(journalId),
  })

  const groupedQ = useQuery({
    queryKey: ['admin', 'journal', journalId, 'grouped'],
    queryFn: () => api.admin.journals.articlesByCategory(journalId),
  })

  const publishMut = useMutation({
    mutationFn: () => api.admin.journals.publish(journalId),
    onSuccess: () => {
      // Prefix-match invalidation: covers both ['admin', 'journal', id]
      // and ['admin', 'journal', id, 'grouped'] in one call.
      qc.invalidateQueries({ queryKey: ['admin', 'journals'] })
      qc.invalidateQueries({ queryKey: ['admin', 'journal', journalId] })
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : '发布失败'),
  })

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
              <tr><th>标题</th><th>状态</th><th>更新时间</th><th>操作</th></tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-1)' }}>{a.title}</td>
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
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}