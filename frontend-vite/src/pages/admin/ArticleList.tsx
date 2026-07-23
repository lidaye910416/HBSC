import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Star, Trash2, Edit, RefreshCw, Headphones, Square, SquareCheck, XCircle, Pause } from 'lucide-react'
import { api } from '../../services/api'
import { listRowStagger } from '../../components/admin/animations'
import { useToast } from '../../components/admin/Toast'
import { PodcastProgress } from '../../components/admin/PodcastProgress'
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
    onError: (e) => {
      // 409 = job already running; tell the user to cancel first instead
      // of a generic "语音生成失败".
      const msg = e instanceof Error ? e.message : '语音生成失败'
      toast.error(msg.includes('生成中') ? msg : '语音生成失败: ' + msg)
    },
  })
  const cancelMut = useMutation({
    mutationFn: (id: number) => api.admin.articles.podcast.cancel(id),
    onSuccess: (res, id) => {
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
      if (res.was_running) {
        toast.success(`已停止 #${id} 的生成`)
      } else if (res.reconciled) {
        toast.success(`已重置 #${id} 卡住的任务,请重新生成`)
      } else {
        toast.info(`#${id} 当前没有正在运行的任务`)
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '停止失败'),
  })
  const batchMut = useMutation({
    mutationFn: (ids: number[]) => api.admin.articles.batchPodcast(ids),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
      const skippedReasons = res.skipped.reduce<Record<string, number>>((acc, s) => {
        acc[s.reason] = (acc[s.reason] ?? 0) + 1
        return acc
      }, {})
      const skipMsg = Object.entries(skippedReasons)
        .map(([reason, n]) => `${reason}×${n}`).join(', ')
      if (res.queued.length === 0) {
        toast.error(`未生成任何语音(跳过: ${skipMsg || '无'})`)
      } else if (res.skipped.length > 0) {
        toast.success(`已排队 ${res.queued.length} 篇,跳过 ${res.skipped.length} 篇(${skipMsg})`)
      } else {
        toast.success(`已为 ${res.queued.length} 篇文章排队生成`)
      }
      setSelected(new Set())
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '批量生成失败'),
  })
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [sortBy, setSortBy] = useState<'updated_at' | 'published_at' | 'title'>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [featuredFilter, setFeaturedFilter] = useState<'' | 'true' | 'false'>('')
  // 「按期刊」下拉的值: '' = 全部; 数字 = 期刊 id; 'none' = 未归期。
  const [journalFilter, setJournalFilter] = useState<'' | number | 'none'>('')
  const [page, setPage] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; title: string } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  // Debounce search input: keep typing visually instant by binding to `q`,
  // but only fire the backend query with `debouncedQ` so we don't slam the
  // server on every keystroke.
  const debouncedQ = useDebouncedValue(q, 250)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'articles', { status, q: debouncedQ, category, featuredFilter, journalFilter, sortBy, sortDir, page }],
    queryFn: () => api.admin.articles.list({
      status: status || undefined,
      q: debouncedQ || undefined,
      category: category || undefined,
      featured: featuredFilter === '' ? undefined : featuredFilter === 'true',
      journal_id: journalFilter === '' ? undefined : journalFilter,
      sort_by: sortBy,
      sort_dir: sortDir,
      page,
      per_page: 20,
    }),
  })

  // Pull the journal catalog once for the toolbar dropdown. We don't
  // paginate because hbsc only has a few issues at a time; if that
  // changes, swap this for a search-as-you-type combobox.
  const journalsQuery = useQuery({
    queryKey: ['admin', 'journals', 'list', { per_page: 100 }],
    queryFn: () => api.admin.journals.list({ per_page: 100 }),
  })

  // Selection / batch — derived from the current page's articles. We
  // compute these on every render (not in useMemo) because they're
  // trivially cheap and putting them inline keeps the toggle callbacks
  // below close to the state they read.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const pageIds = useMemo(() => (data?.items ?? []).map((a) => a.id), [data])
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const togglePage = () => {
    setSelected((prev) => {
      if (allOnPageSelected) {
        const next = new Set(prev)
        pageIds.forEach((id) => next.delete(id))
        return next
      }
      const next = new Set(prev)
      pageIds.forEach((id) => next.add(id))
      return next
    })
  }
  const selectedGenerating = (data?.items ?? [])
    .filter((a) => selected.has(a.id) && a.podcast_status === 'generating')
    .map((a) => a.id)
  const selectedBatchable = (data?.items ?? [])
    .filter((a) => selected.has(a.id) && a.podcast_status !== 'generating')
    .map((a) => a.id)

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
            value={journalFilter === '' ? '' : String(journalFilter)}
            onChange={(e) => {
              const v = e.target.value
              setJournalFilter(v === '' ? '' : v === 'none' ? 'none' : Number(v))
              setPage(1)
            }}
            data-testid="journal-filter"
            aria-label="按期刊筛选"
            disabled={journalsQuery.isLoading}
          >
            <option value="">全部期刊</option>
            {(journalsQuery.data?.items ?? []).map((j) => (
              <option key={j.id} value={String(j.id)}>
                {j.issue_number || j.title}
              </option>
            ))}
            <option value="none">未归期</option>
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

      {selected.size > 0 && (
        <div
          data-testid="batch-action-bar"
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            margin: '0 0 var(--space-3) 0',
            borderRadius: 'var(--radius-md)',
            background: 'var(--admin-surface-2)',
            border: '1px solid var(--admin-border)',
          }}
        >
          <span style={{ fontWeight: 600 }}>已选 {selected.size} 篇</span>
          <span style={{ color: 'var(--admin-text-2)', fontSize: 'var(--type-sm)' }}>
            可生成 {selectedBatchable.length} · 生成中 {selectedGenerating.length}
          </span>
          <div style={{ flex: 1 }} />
          {selectedGenerating.length > 0 && (
            <Button
              variant="danger"
              icon={<XCircle size={14} />}
              data-testid="batch-cancel"
              loading={cancelMut.isPending}
              onClick={() => {
                selectedGenerating.forEach((id) => cancelMut.mutate(id))
              }}
            >
              停止选中 ({selectedGenerating.length})
            </Button>
          )}
          <Button
            variant="primary"
            icon={<Headphones size={14} />}
            data-testid="batch-generate"
            disabled={selectedBatchable.length === 0 || batchMut.isPending}
            loading={batchMut.isPending}
            onClick={() => batchMut.mutate(selectedBatchable)}
          >
            批量生成 ({selectedBatchable.length})
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>清除选择</Button>
        </div>
      )}

      {isLoading ? (
        <p style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--admin-text-2)' }}>加载中…</p>
      ) : (
        <div className="ui-card ui-card--outlined" style={{ padding: 0 }}>
          <table ref={tableRef} className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <button
                    type="button"
                    onClick={togglePage}
                    aria-label={allOnPageSelected ? '取消全选' : '全选当前页'}
                    aria-pressed={allOnPageSelected}
                    data-testid="select-all"
                    style={{
                      background: 'none', border: 0, padding: 4, cursor: 'pointer',
                      color: 'var(--admin-text-2)',
                    }}
                  >
                    {allOnPageSelected ? <SquareCheck size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th style={{ width: 48 }}>精选</th>
                <th>标题</th>
                <th>分类</th>
                <th style={{ width: 110 }}>期刊</th>
                <th>状态</th>
                <th>对谈语音</th>
                <th>更新时间</th>
                <th style={{ width: 120 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => (
                <tr key={a.id} data-row-id={a.id}>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label={`选择文章 ${a.title}`}
                      data-testid={`row-select-${a.id}`}
                      checked={selected.has(a.id)}
                      onChange={() => toggleOne(a.id)}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
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
                  <td style={{ fontSize: 'var(--type-sm)' }}>
                    {a.journal ? (
                      <span
                        title={a.journal.title}
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--admin-surface-2)',
                          color: 'var(--admin-text-1)',
                          fontWeight: 500,
                        }}
                      >{a.journal.issue_number || a.journal.title}</span>
                    ) : (
                      <span style={{ color: 'var(--admin-text-muted)' }}>未归期</span>
                    )}
                  </td>
                  <td><StatusBadge status={(a.status === 'published' ? 'published' : 'draft')} /></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Headphones size={14} aria-hidden="true" />
                      <span style={{
                        color: a.podcast_status === 'ready' ? '#7FD49A'
                          : a.podcast_status === 'generating' ? '#F0C168'
                          : a.podcast_status === 'failed' ? '#F2A6A6'
                          : a.podcast_status === 'cancelled' ? 'var(--admin-text-2)'
                          : 'var(--admin-text-2)',
                        fontWeight: 600,
                      }}>
                        {a.podcast_status === 'ready'
                          ? `已完成${a.podcast_duration_seconds ? ` · ${formatDuration(a.podcast_duration_seconds)}` : ''}`
                          : a.podcast_status === 'generating' ? '生成中…'
                          : a.podcast_status === 'failed' ? '失败'
                          : a.podcast_status === 'cancelled' ? '已停止'
                          : '待生成'}
                      </span>
                      {(a.podcast_status === 'failed' || a.podcast_status === 'cancelled')
                        && a.podcast_error ? (
                        <span
                          title={a.podcast_error}
                          style={{ fontSize: 11, color: 'var(--admin-text-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >{a.podcast_error}</span>
                      ) : null}
                      {a.podcast_status === 'generating' ? (
                        <IconButton
                          label="停止生成"
                          variant="danger"
                          size="sm"
                          data-testid={`row-cancel-${a.id}`}
                          icon={<Pause size={14} />}
                          onClick={() => cancelMut.mutate(a.id)}
                          disabled={cancelMut.isPending}
                        />
                      ) : (
                        <IconButton
                          label="重新生成对谈语音"
                          variant="ghost"
                          size="sm"
                          icon={<RefreshCw size={14} />}
                          onClick={() => podcastMut.mutate(a.id)}
                          disabled={podcastMut.isPending}
                        />
                      )}
                    </div>
                    {a.podcast_status === 'generating' ? (
                      <div style={{ marginTop: 6, minWidth: 220, maxWidth: 320 }}>
                        <PodcastProgress
                          stage={a.podcast_stage ?? 'pending'}
                          progress={a.podcast_progress ?? 0}
                          startedAt={a.podcast_started_at ?? null}
                          lastDuration={a.podcast_last_duration_seconds ?? 0}
                          variant="inline"
                        />
                      </div>
                    ) : null}
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
                  <td colSpan={9}>
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
