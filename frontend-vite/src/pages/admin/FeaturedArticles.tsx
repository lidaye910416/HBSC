import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Star, ArrowLeft, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { useToast } from '../../components/admin/Toast'
import {
  PageHeader, Card, CardHeader, CardTitle, Button, IconButton, Empty,
} from '../../components/ui'

/**
 * Bulk featured-article management.
 *
 * Two columns:
 *   - LEFT: currently featured (ordered by created_at asc so the "first
 *     starred" stays on top — the public featured endpoint just takes the
 *     first 3 published anyway, but this lets the admin eyeball the order).
 *   - RIGHT: other published articles, click ★ to add to featured.
 *
 * Reordering is done via simple ↑ / ↓ buttons that swap the `featured` flag
 * — the public endpoint doesn't preserve a manual order, so true reorder is
 * not exposed here. The position numbers below show the implicit ordering
 * based on insertion time.
 */
export function FeaturedArticles() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: featured, isLoading: featLoading } = useQuery({
    queryKey: ['admin', 'articles', { featured: true, per_page: 50 }],
    queryFn: () => api.admin.articles.list({ featured: true, per_page: 50 }),
  })

  const { data: others, isLoading: othersLoading } = useQuery({
    queryKey: ['admin', 'articles', { featured: false, status: 'published', per_page: 50 }],
    queryFn: () => api.admin.articles.list({ featured: false, status: 'published', per_page: 50 }),
  })

  const toggleMut = useMutation({
    mutationFn: (id: number) => api.admin.articles.toggleFeatured(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['admin', 'articles'] })
      const previous = qc.getQueriesData({ queryKey: ['admin', 'articles'] })
      qc.setQueriesData<{ items: Array<{ id: number; featured?: boolean }> }>(
        { queryKey: ['admin', 'articles'] },
        (old) => old ? {
          ...old,
          items: old.items.map((it) => it.id === id ? { ...it, featured: !it.featured } : it),
        } : old,
      )
      return { previous }
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) {
        ctx.previous.forEach(([key, value]) => qc.setQueryData(key, value))
      }
      toast.error(`切换精选失败: ${err instanceof Error ? err.message : String(err)}`)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
      qc.invalidateQueries({ queryKey: ['featured'] })
    },
  })

  const featuredItems = useMemo(() => featured?.items ?? [], [featured])
  const otherItems = useMemo(() => others?.items ?? [], [others])

  return (
    <div>
      <PageHeader
        title="精选文章管理"
        description="公开站首页「精选文章」区域从下方列表中按发布时间倒序展示前 3 篇。"
        breadcrumb={[
          { label: '文章', to: '/admin/articles' },
          { label: '精选管理' },
        ]}
        actions={
          <Button
            variant="secondary"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate('/admin/articles')}
          >
            返回列表
          </Button>
        }
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--space-5)',
      }}>
        {/* LEFT: currently featured */}
        <Card padding="none">
          <CardHeader>
            <CardTitle>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Star size={16} fill="var(--brand-gold)" stroke="var(--brand-gold)" />
                精选中
                <span style={{ color: 'var(--admin-text-2)', fontWeight: 400 }}>（{featuredItems.length}）</span>
              </span>
            </CardTitle>
          </CardHeader>
          {featLoading ? (
            <p style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--admin-text-2)' }}>加载中…</p>
          ) : featuredItems.length === 0 ? (
            <Empty title="尚未设置精选文章" description="从右侧候选中选择。" />
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>标题</th>
                  <th style={{ width: 100 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {featuredItems.map((a, i) => (
                  <tr key={a.id}>
                    <td style={{ color: 'var(--admin-text-2)' }}>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{a.title}</div>
                      <div style={{ fontSize: 'var(--type-xs)', color: 'var(--admin-text-muted)' }}>/{a.slug}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <IconButton
                          label="编辑文章"
                          variant="ghost"
                          size="sm"
                          icon={<ExternalLink size={14} />}
                          onClick={() => navigate(`/admin/articles/${a.id}`)}
                        />
                        <IconButton
                          label="取消精选"
                          variant="danger"
                          size="sm"
                          icon={<Star size={14} fill="currentColor" />}
                          onClick={() => toggleMut.mutate(a.id)}
                          disabled={toggleMut.isPending}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* RIGHT: candidates */}
        <Card padding="none">
          <CardHeader>
            <CardTitle>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Star size={16} stroke="var(--admin-text-muted)" />
                候选文章
                <span style={{ color: 'var(--admin-text-2)', fontWeight: 400 }}>（已发布 · {otherItems.length}）</span>
              </span>
            </CardTitle>
          </CardHeader>
          {othersLoading ? (
            <p style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--admin-text-2)' }}>加载中…</p>
          ) : otherItems.length === 0 ? (
            <Empty title="暂无可精选的文章" description="请先发布更多文章。" />
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>分类</th>
                  <th style={{ width: 80 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {otherItems.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{a.title}</div>
                      <div style={{ fontSize: 'var(--type-xs)', color: 'var(--admin-text-muted)' }}>/{a.slug}</div>
                    </td>
                    <td style={{ fontSize: 'var(--type-sm)', color: 'var(--admin-text-2)' }}>{a.category || '—'}</td>
                    <td>
                      <IconButton
                        label="加入精选"
                        variant="ghost"
                        size="sm"
                        icon={<Star size={14} />}
                        onClick={() => toggleMut.mutate(a.id)}
                        disabled={toggleMut.isPending}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <p style={{ marginTop: 'var(--space-5)', color: 'var(--admin-text-2)', fontSize: 'var(--type-xs)' }}>
        <ArrowUp size={12} /> <ArrowDown size={12} /> 说明：精选区域按「发布时间倒序」自动排序，无需手动拖拽。
      </p>
    </div>
  )
}