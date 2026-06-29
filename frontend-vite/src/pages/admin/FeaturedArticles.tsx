import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Star, ArrowLeft, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import './ArticleList.css'

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
      alert(`切换精选失败: ${err instanceof Error ? err.message : String(err)}`)
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button
          type="button"
          className="article-list__action"
          onClick={() => navigate('/admin/articles')}
        >
          <ArrowLeft size={14} /> 返回列表
        </button>
        <h2 style={{ margin: 0 }}>精选文章管理</h2>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
          公开站首页「精选文章」区域从下方列表中按发布时间倒序展示前 3 篇。
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px',
      }}>
        {/* LEFT: currently featured */}
        <section className="article-list">
          <div className="article-list__toolbar" style={{ borderBottom: 'none' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#1A1A2E' }}>
              <Star size={16} fill="#C9A84C" color="#C9A84C" style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              精选中 <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>（{featuredItems.length}）</span>
            </h3>
          </div>
          {featLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>加载中…</div>
          ) : featuredItems.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              尚未设置精选文章。从右侧选择。
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th>标题</th>
                  <th style={{ width: '100px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {featuredItems.map((a, i) => (
                  <tr key={a.id}>
                    <td style={{ color: 'var(--color-text-secondary)' }}>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{a.title}</div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>/{a.slug}</div>
                    </td>
                    <td>
                      <div className="article-list__actions">
                        <button
                          className="article-list__action"
                          title="编辑文章"
                          onClick={() => navigate(`/admin/articles/${a.id}`)}
                        >
                          <ExternalLink size={12} />
                        </button>
                        <button
                          className="article-list__action article-list__action--danger"
                          title="取消精选"
                          onClick={() => toggleMut.mutate(a.id)}
                          disabled={toggleMut.isPending}
                        >
                          <Star size={12} fill="currentColor" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* RIGHT: candidates */}
        <section className="article-list">
          <div className="article-list__toolbar" style={{ borderBottom: 'none' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#1A1A2E' }}>
              <Star size={16} color="var(--color-text-muted)" style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              候选文章 <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>（已发布 · {otherItems.length}）</span>
            </h3>
          </div>
          {othersLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>加载中…</div>
          ) : otherItems.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              暂无可精选的文章。请先发布更多文章。
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>分类</th>
                  <th style={{ width: '80px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {otherItems.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{a.title}</div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>/{a.slug}</div>
                    </td>
                    <td style={{ fontSize: '0.8125rem' }}>{a.category || '—'}</td>
                    <td>
                      <button
                        className="article-list__action"
                        title="加入精选"
                        onClick={() => toggleMut.mutate(a.id)}
                        disabled={toggleMut.isPending}
                      >
                        <Star size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <p style={{ marginTop: '24px', color: 'var(--color-text-secondary)', fontSize: '0.8125rem' }}>
        <ArrowUp size={12} /> <ArrowDown size={12} />{' '}
        说明：精选区域按「发布时间倒序」自动排序，无需手动拖拽。
      </p>
    </div>
  )
}