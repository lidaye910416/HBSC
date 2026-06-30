import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api } from '../../services/api'
import { Card, CardHeader, CardTitle, Stat, StatusBadge, Empty, PageHeader } from '../../components/ui'
import './Dashboard.css'

function formatDate(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function Dashboard() {
  // Count queries — stable object-shaped keys so they don't collide with list-view keys.
  const { data: articles } = useQuery({
    queryKey: ['admin', 'articles', { count: true }],
    queryFn: () => api.admin.articles.list({ per_page: 1 }),
  })
  const { data: journals } = useQuery({
    queryKey: ['admin', 'journals', { count: true }],
    queryFn: () => api.admin.journals.list({ per_page: 1 }),
  })
  const { data: media } = useQuery({
    queryKey: ['admin', 'media', { count: true }],
    queryFn: () => api.admin.media.list(1, 1),
  })

  // Dashboard sub-views — separate query keys so refetches/invalidations stay scoped.
  const { data: drafts } = useQuery({
    queryKey: ['admin', 'articles', { dashboardDrafts: true }],
    queryFn: () => api.admin.articles.list({ status: 'draft', per_page: 5 }),
  })
  const { data: recentArticles } = useQuery({
    queryKey: ['admin', 'articles', { dashboardRecent: true }],
    queryFn: () => api.admin.articles.list({ per_page: 5, status: 'published' }),
  })
  const { data: recentMedia } = useQuery({
    queryKey: ['admin', 'media', { dashboardRecent: 8 }],
    queryFn: () => api.admin.media.list(1, 8),
  })

  const publishedCount = recentArticles?.total ?? '—'
  const draftsCount = drafts?.total ?? '—'

  return (
    <div className="dashboard">
      <PageHeader title="概览" description="欢迎回来。下面是你站点最近的内容动向。" />

      <div className="dashboard__stats">
        <Stat label="文章总数" value={articles?.total ?? '—'} />
        <Stat label="已发布" value={publishedCount} />
        <Stat label="草稿" value={draftsCount} />
        <Stat label="期刊" value={journals?.total ?? '—'} />
      </div>

      <div className="dashboard__row">
        <Card>
          <CardHeader>
            <CardTitle>最近发布的文章</CardTitle>
            <Link
              to="/admin/articles"
              className="ui-status-badge"
              style={{ background: 'var(--brand-gold-50)', color: '#8C6F1F' }}
            >
              查看全部 <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <div className="dashboard__list">
            {recentArticles?.items.length ? (
              recentArticles.items.map((a) => (
                <Link key={a.id} to={`/admin/articles/${a.id}`} className="dashboard__list-item">
                  <span className="dashboard__list-title">{a.title}</span>
                  <span className="dashboard__list-meta">
                    <StatusBadge status="published" />
                    <span>{formatDate(a.published_at)}</span>
                  </span>
                </Link>
              ))
            ) : (
              <Empty title="还没有发布的文章" description="上传一个 .docx 或新建一篇开始。" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>草稿 / 待处理</CardTitle>
            <Link
              to="/admin/articles"
              className="ui-status-badge"
              style={{ background: 'var(--brand-gold-50)', color: '#8C6F1F' }}
            >
              管理 <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <div className="dashboard__list">
            {drafts?.items.length ? (
              drafts.items.map((a) => (
                <Link key={a.id} to={`/admin/articles/${a.id}`} className="dashboard__list-item">
                  <span className="dashboard__list-title">{a.title || '（未命名）'}</span>
                  <span className="dashboard__list-meta">
                    <StatusBadge status="draft" />
                    <span>{formatDate(a.published_at)}</span>
                  </span>
                </Link>
              ))
            ) : (
              <Empty title="没有草稿" description="所有文章都已发布，恭喜。" />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近上传的媒体</CardTitle>
          <Link
            to="/admin/media"
            className="ui-status-badge"
            style={{ background: 'var(--brand-gold-50)', color: '#8C6F1F' }}
          >
            打开媒体库 <ArrowRight size={12} />
          </Link>
        </CardHeader>
        <div className="dashboard__media-grid">
          {recentMedia?.items.map((m) => (
            <div key={m.id} className="dashboard__media-item">
              <img src={m.url} alt={m.original_name} loading="lazy" />
              <div className="dashboard__media-item__name">{m.original_name}</div>
            </div>
          ))}
          {!recentMedia?.items.length && (
            <p
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                color: 'var(--admin-text-muted)',
                padding: 'var(--space-5)',
              }}
            >
              尚无上传图片 (总计 {media?.total ?? 0} 张)
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}