import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { api, type JournalCompleteness } from '../../services/api'
import './ArticleList.css'

interface DeleteTarget {
  id: number
  title: string
  articleCount: number
}

export function JournalList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [confirmInput, setConfirmInput] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'journals', { q, page }],
    queryFn: () => api.admin.journals.list({ q: q || undefined, page, per_page: 20 }),
  })

  const { data: completeness } = useQuery({
    queryKey: ['admin', 'journals', 'completeness', data?.items.map((j) => j.id).join(',')],
    queryFn: async () => {
      if (!data?.items) return {} as Record<number, JournalCompleteness>
      const entries = await Promise.all(
        data.items.map(async (j) => [j.id, await api.admin.journals.completeness(j.id)] as const)
      )
      return Object.fromEntries(entries) as Record<number, JournalCompleteness>
    },
    enabled: !!data?.items?.length,
  })

  const onMutateError = (err: unknown, op: string) =>
    alert(`${op}失败: ${err instanceof Error ? err.message : String(err)}`)

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.admin.journals.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'journals'] })
      setDeleteTarget(null)
      setConfirmInput('')
    },
    onError: (err) => onMutateError(err, '删除期刊'),
  })

  const openDeleteConfirm = (id: number, title: string, articleCount: number) => {
    setDeleteTarget({ id, title, articleCount })
    setConfirmInput('')
  }

  const cancelDelete = () => {
    setDeleteTarget(null)
    setConfirmInput('')
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    if (confirmInput.trim() !== deleteTarget.title) return
    deleteMut.mutate(deleteTarget.id)
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>期刊管理</h2>
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
          <button className="article-list__new" onClick={() => navigate('/admin/journals/new')}>
            <Plus size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            新建期刊
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>加载中...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>期号</th>
                <th>文章数</th>
                <th>发布日期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((j) => (
                <tr key={j.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{j.title}</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>/{j.slug}</div>
                  </td>
                  <td>{j.issue_number || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{j.article_count}</span>
                      {completeness?.[j.id] && (
                        <span
                          title={completeness[j.id].complete ? '四类齐全' : `缺：${['战略与政策','技术与产业','方案与思考','动态与文化'].filter(c => completeness[j.id][c as keyof JournalCompleteness] === 0).join('、')}`}
                          style={{
                            fontSize: '0.6875rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: completeness[j.id].complete ? '#16a34a' : '#d97706',
                            color: '#fff',
                          }}
                        >
                          {completeness[j.id].complete ? '完整' : '不完整'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {j.published_at ? new Date(j.published_at).toLocaleDateString('zh-CN') : '—'}
                  </td>
                  <td>
                    <div className="article-list__actions">
                      <button className="article-list__action" onClick={() => navigate(`/admin/journals/${j.id}`)}>
                        查看
                      </button>
                      <button className="article-list__action" onClick={() => navigate(`/admin/journals/${j.id}/edit`)}>
                        编辑元数据
                      </button>
                      <button
                        className="article-list__action article-list__action--danger"
                        onClick={() => openDeleteConfirm(j.id, j.title, j.article_count)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>暂无期刊</td></tr>
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

      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={cancelDelete}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '480px',
              width: '90%',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '12px', color: '#c44' }}>
              ⚠️ 确认删除期刊
            </h3>
            <p style={{ margin: '0 0 12px 0', lineHeight: 1.6 }}>
              确认删除期刊 <strong>《{deleteTarget.title}》</strong> 吗？
            </p>
            <p
              style={{
                margin: '0 0 16px 0',
                padding: '12px',
                background: '#fde4e4',
                border: '1px solid #f5b5b5',
                borderRadius: '4px',
                color: '#c44',
                fontWeight: 600,
                lineHeight: 1.5,
              }}
            >
              ⚠️ 这将一并删除其下的 <strong>{deleteTarget.articleCount}</strong> 篇文章。
              <br />
              此操作不可撤销。
            </p>
            <label
              style={{
                display: 'block',
                fontSize: '0.875rem',
                color: 'var(--color-text-secondary)',
                marginBottom: '6px',
              }}
            >
              请输入期刊名称 <code style={{ background: '#f5f0e8', padding: '1px 6px', borderRadius: '3px' }}>{deleteTarget.title}</code> 以确认删除：
            </label>
            <input
              autoFocus
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmDelete()
                if (e.key === 'Escape') cancelDelete()
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d4d4d4',
                borderRadius: '4px',
                fontSize: '0.9375rem',
                fontFamily: 'inherit',
                marginBottom: '16px',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={cancelDelete}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #d4d4d4',
                  borderRadius: '4px',
                  background: 'white',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.9375rem',
                }}
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                disabled={confirmInput.trim() !== deleteTarget.title || deleteMut.isPending}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #c44',
                  borderRadius: '4px',
                  background:
                    confirmInput.trim() === deleteTarget.title && !deleteMut.isPending
                      ? '#c44'
                      : '#e8b0b0',
                  color: 'white',
                  cursor:
                    confirmInput.trim() === deleteTarget.title && !deleteMut.isPending
                      ? 'pointer'
                      : 'not-allowed',
                  fontSize: '0.9375rem',
                  fontWeight: 600,
                }}
              >
                {deleteMut.isPending ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
