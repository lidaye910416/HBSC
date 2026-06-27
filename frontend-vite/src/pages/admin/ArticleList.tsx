import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { api } from '../../services/api'
import './ArticleList.css'

export function ArticleList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'articles', { status, q, page }],
    queryFn: () => api.admin.articles.list({
      status: status || undefined,
      q: q || undefined,
      page,
      per_page: 20,
    }),
  })

  const onMutateError = (err: unknown, op: string) =>
    alert(`${op}失败: ${err instanceof Error ? err.message : String(err)}`)

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.admin.articles.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'articles'] }),
    onError: (err) => onMutateError(err, '删除文章'),
  })

  const handleDelete = (id: number, title: string) => {
    if (confirm(`确认删除文章"${title}"？此操作不可撤销。`)) {
      deleteMut.mutate(id)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>文章管理</h2>
      </div>

      <div className="article-list">
        <div className="article-list__toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Search size={16} />
            <input
              placeholder="搜索标题..."
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1) }}
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
          </select>
          <button className="article-list__new" onClick={() => navigate('/admin/articles/new')}>
            <Plus size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            新建文章
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>加载中...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>分类</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{a.title}</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>/{a.slug}</div>
                  </td>
                  <td>{a.category || '—'}</td>
                  <td>
                    <span className={`article-list__status article-list__status--${a.status}`}>
                      {a.status === 'published' ? '已发布' : '草稿'}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {a.published_at ? new Date(a.published_at).toLocaleDateString('zh-CN') : '—'}
                  </td>
                  <td>
                    <div className="article-list__actions">
                      <button className="article-list__action" onClick={() => navigate(`/admin/articles/${a.id}`)}>
                        编辑
                      </button>
                      <button
                        className="article-list__action article-list__action--danger"
                        onClick={() => handleDelete(a.id, a.title)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>暂无文章</td></tr>
              )}
            </tbody>
          </table>
        )}

        {data && data.pages > 1 && (
          <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', gap: '8px' }}>
            {Array.from({ length: data.pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #d4d4d4',
                  borderRadius: '4px',
                  background: p === page ? '#2563eb' : 'white',
                  color: p === page ? '#ffffff' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
