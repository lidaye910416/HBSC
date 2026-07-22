import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Star, Trash2, Edit, RefreshCw, Headphones } from 'lucide-react'
import { api } from '../../services/api'
import { listRowStagger } from '../../components/admin/animations'
import { useToast } from '../../components/admin/Toast'
import {
  PageHeader, Button, IconButton, Toolbar, ToolbarGroup,
  SearchInput, StatusBadge, Empty, Modal,
} from '../../components/ui'
import './ArticleList.css'

const CATEGORIES = ['战略与政策', '技术与产业', '方案与思考', '动态与文化']

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'updated_at_desc', label: '更新时间 ↓' },
  { value: 'updated_at_asc', label: '更新时间 ↑' },
  { value: 'published_at_desc', label: '发布时间 ↓' },
  { value: 'published_at_asc', label: '发布时间 ↑' },
  { value: 'title_asc', label: '标题 A→Z' },
]

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return debounced
}


function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export function ArticleList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const podcastMut = useMutation({
    mutationFn: (id: number) => api.admin.articles.podcast.regenerate(id),
    onSuccess: () => {
      toast.success('已开始生成对谈语音')
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '语音生成失败'),
  })
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [sortBy, setSortBy] = useState<'updated_at' | 'published_at' | 'title'>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [featuredFilter, setFeaturedFilter] = useState<'' | 'true' | 'false'>('')
  const [page, setPage] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; title: string } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  // Debounce search input: keep typing visually instant by binding to `q`,
  // but only fire the backend query with `debouncedQ` so we don't slam the
  // server on every keystroke.
  const debouncedQ = useDebouncedValue(q, 250)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'articles', { status, q: debouncedQ, category, featuredFilter, sortBy, sortDir, page }],
    queryFn: () => api.admin.articles.list({
      status: status || undefined,
      q: debouncedQ || undefined,
      category: category || undefined,
      featured: featuredFilter === '' ? undefined : featuredFilter === 'true',
      sort_by: sortBy,
      sort_dir: sortDir,
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
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1) }}
          >
            <option value="">全部分类</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
          <select
            className="ui-toolbar__select"
            value={`${sortBy}_${sortDir}`}
            onChange={(e) => {
              const [b, d] = e.target.value.split('_') as ['updated_at' | 'published_at' | 'title', 'asc' | 'desc']
              setSortBy(b)
              setSortDir(d)
              setPage(1)
            }}
            aria-label="排序方式"
          >
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                <th>对谈语音</th>
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
                    <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{a.title}</div>
                    <div style={{ fontSize: 'var(--type-xs)', color: 'var(--admin-text-muted)' }}>/{a.slug}</div>
                  </td>
                  <td>{a.category || '—'}</td>
                  <td><StatusBadge status={(a.status === 'published' ? 'published' : 'draft')} /></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Headphones size={14} aria-hidden="true" />
                      <span style={{
                        color: a.podcast_status === 'ready' ? '#7FD49A'
                          : a.podcast_status === 'generating' ? '#F0C168'
                          : a.podcast_status === 'failed' ? '#F2A6A6'
                          : 'var(--admin-text-2)',
                        fontWeight: 600,
                      }}>
                        {a.podcast_status === 'ready'
                          ? `已完成${a.podcast_duration_seconds ? ` · ${formatDuration(a.podcast_duration_seconds)}` : ''}`
                          : a.podcast_status === 'generating' ? '生成中…'
                          : a.podcast_status === 'failed' ? '失败'
                          : '待生成'}
                      </span>
                      {a.podcast_status === 'failed' && a.podcast_error ? (
                        <span
                          title={a.podcast_error}
                          style={{ fontSize: 11, color: 'var(--admin-text-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >{a.podcast_error}</span>
                      ) : null}
                      <IconButton
                        label="重新生成对谈语音"
                        variant="ghost"
                        size="sm"
                        icon={<RefreshCw size={14} />}
                        onClick={() => podcastMut.mutate(a.id)}
                        disabled={podcastMut.isPending || a.podcast_status === 'generating'}
                      />
                    </div>
                  </td>
                  <td style={{ fontSize: 'var(--type-sm)', color: 'var(--admin-text-2)' }}>
                    {a.updated_at || a.published_at
                      ? new Date(a.updated_at || a.published_at!).toLocaleDateString('zh-CN')
                      : '—'}
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
                  <td colSpan={7}>
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
