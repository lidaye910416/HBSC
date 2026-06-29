import { useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'

export function Dashboard() {
  // Use stable object-shaped query keys (with a `count` marker) instead of
  // arbitrary string suffixes so the keys don't collide with list-view keys
  // and so React Query's default prefix-match invalidation works correctly.
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

  const stats = [
    { label: '文章总数', value: articles?.total ?? '—' },
    { label: '期刊总数', value: journals?.total ?? '—' },
    { label: '已上传图片', value: media?.total ?? '—' },
  ]

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>概览</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        {stats.map((s) => (
          <div key={s.label} style={{
            background: 'white',
            padding: '24px',
            borderRadius: '8px',
            border: '1px solid #e8e8e0',
          }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>{s.label}</div>
            <div style={{ fontSize: '2rem', fontWeight: 600, color: '#1A1A2E', marginTop: '8px' }}>{s.value}</div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: '32px', color: 'var(--color-text-secondary)' }}>
        下一里程碑（M4）将实现文章/期刊的完整 CRUD 编辑界面。
      </p>
    </div>
  )
}
