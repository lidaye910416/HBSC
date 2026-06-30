import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Star, Trash2, Edit } from 'lucide-react'
import { api } from '../../services/api'
import { listRowStagger } from '../../components/admin/animations'
import { useToast } from '../../components/admin/Toast'
import {
  PageHeader, Button, IconButton, Toolbar, ToolbarGroup,
  SearchInput, StatusBadge, Empty, Modal,
} from '../../components/ui'
import './ArticleList.css'

export function ArticleList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [featuredFilter, setFeaturedFilter] = useState<'' | 'true' | 'false'>('')
  const [page, setPage] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; title: string } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'articles', { status, q, featuredFilter, page }],
    queryFn: () => api.admin.articles.list({
      status: status || undefined,
      q: q || undefined,
      featured: featuredFilter === '' ? undefined : featuredFilter === 'true',
      page,
      per_page: 20,
    }),
  })

  const onMutateError = (err: unknown, op: string) =>
    toast.error(`${op}失败: ${err instanceof Error ? err.message : String(err)}`)

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.admin.articles.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
      toast.success('已删除')
    },
    onError: (err) => onMutateError(err, '删除文章'),
  })

  const featuredMut = useMutation({
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
      if (ctx?.previous) ctx.previous.forEach(([key, value]) => qc.setQueryData(key, value))
      onMutateError(err, '切换精选')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
      qc.invalidateQueries({ queryKey: ['featured'] })
    },
  })

  useEffect(() => {
    return listRowStagger(tableRef.current?.parentElement ?? null)
  }, [data])

  return (
    <div>
      <PageHeader
        title="文章管理"
        description={`共 ${data?.total ?? '…'} 篇`}
        actions={
          <>
            <Button variant="secondary" icon={<Star size={16} />} onClick={() => navigate('/admin/articles/featured')}>
              管理精选
            </Button>
            <Button icon={<Plus size={16} />} onClick={() => navigate('/admin/articles/new')}>
              新建文章
            </Button>
          </>
        }
      />

      <Toolbar>
        <ToolbarGroup>
          <SearchInput
            placeholder="搜索标题..."
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
          />
          <select
            className="ui-toolbar__select"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1) }}
          >
            <option value="">全部状态</option>
            <option value="published">已发布</option>
            <option value="draft">草稿</option>
          </select>
          <select
            className="ui-toolbar__select"
            value={featuredFilter}
            onChange={(e) => { setFeaturedFilter(e.target.value as '' | 'true' | 'false'); setPage(1) }}
          >
            <option value="">全部精选</option>
            <option value="true">仅精选</option>
            <option value="false">非精选</option>
          </select>
        </ToolbarGroup>
      </Toolbar>

      {isLoading ? (
        <p style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--admin-text-2)' }}>加载中…</p>
      ) : (
        <div className="ui-card ui-card--outlined" style={{ padding: 0 }}>
          <table ref={tableRef} className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>精选</th>
                <th>标题</th>
                <th>分类</th>
                <th>状态</th>
                <th>更新时间</th>
                <th style={{ width: 120 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => (
                <tr key={a.id}>
                  <td style={{ textAlign: 'center' }}>
                    <IconButton
                      label={a.featured ? '取消精选' : '设为精选'}
                      variant="ghost"
                      size="sm"
                      icon={
                        <Star
                          size={16}
                          fill={a.featured ? 'var(--brand-gold)' : 'none'}
                          stroke={a.featured ? 'var(--brand-gold)' : 'currentColor'}
                        />
                      }
                      onClick={() => featuredMut.mutate(a.id)}
                      disabled={featuredMut.isPending}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{a.title}</div>
                    <div style={{ fontSize: 'var(--type-xs)', color: 'var(--admin-text-muted)' }}>/{a.slug}</div>
                  </td>
                  <td>{a.category || '—'}</td>
                  <td><StatusBadge status={(a.status === 'published' ? 'published' : 'draft')} /></td>
                  <td style={{ fontSize: 'var(--type-sm)', color: 'var(--admin-text-2)' }}>
                    {a.published_at ? new Date(a.published_at).toLocaleDateString('zh-CN') : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <IconButton
                        label="编辑"
                        variant="ghost"
                        size="sm"
                        icon={<Edit size={16} />}
                        onClick={() => navigate(`/admin/articles/${a.id}`)}
                      />
                      <IconButton
                        label="删除"
                        variant="danger"
                        size="sm"
                        icon={<Trash2 size={16} />}
                        data-ai-blocked="delete"
                        onClick={() => setConfirmDelete({ id: a.id, title: a.title })}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Empty title="暂无文章" description="点击右上角『新建文章』开始你的第一篇。" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pages > 1 && (
        <div style={{ padding: 'var(--space-4)', display: 'flex', justifyContent: 'center', gap: 'var(--space-2)' }}>
          {Array.from({ length: data.pages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`admin-pager__btn${p === page ? ' is-active' : ''}`}
            >{p}</button>
          ))}
        </div>
      )}

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button
              variant="danger"
              data-ai-blocked="delete"
              loading={deleteMut.isPending}
              onClick={() => {
                if (confirmDelete) deleteMut.mutate(confirmDelete.id)
                setConfirmDelete(null)
              }}
            >删除</Button>
          </>
        }
      >
        <p>确认删除文章「{confirmDelete?.title}」？此操作不可撤销。</p>
      </Modal>
    </div>
  )
}