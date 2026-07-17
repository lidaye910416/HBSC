import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, RotateCcw, AlertCircle, ImageOff, Upload, Copy, Check } from 'lucide-react'
import { PageHeader } from '../../ui/PageHeader'
import { Button, IconButton } from '../../ui'
import { Modal } from '../../ui/Modal'
import { Empty } from '../../ui/Empty'
import { useToast } from '../Toast'
import { CoverImage } from '../../CoverImage'
import {
  api,
  pageCount,
  ApiError,
  type MediaAsset,
  type MediaHealth,
  type MediaListParams,
  type MediaSource,
  type MediaStatus,
  type MediaUsage,
} from '../../../services/api'
import './MediaBrowser.css'

const STATUS_OPTIONS: Array<{ value: MediaStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '正常' },
  { value: 'trashed', label: '回收站' },
]

const SOURCE_OPTIONS: Array<{ value: MediaSource | ''; label: string }> = [
  { value: '', label: '全部来源' },
  { value: 'paste', label: '粘贴' },
  { value: 'drop', label: '拖放' },
  { value: 'upload', label: '上传' },
  { value: 'docx', label: 'Word 导入' },
  { value: 'cover', label: '封面' },
  { value: 'legacy', label: '历史' },
  { value: 'generated', label: 'AI 生成' },
]

const USAGE_OPTIONS: Array<{ value: 'all' | 'used' | 'unused'; label: string }> = [
  { value: 'all', label: '全部使用' },
  { value: 'used', label: '已引用' },
  { value: 'unused', label: '未引用' },
]

const HEALTH_OPTIONS: Array<{ value: MediaHealth | ''; label: string }> = [
  { value: '', label: '全部健康状态' },
  { value: 'healthy', label: '可用' },
  { value: 'missing_file', label: '文件缺失' },
  { value: 'invalid_image', label: '图片损坏' },
]

interface MediaBrowserProps {
  mode: 'page' | 'select'
  /** Called when the user confirms a selection (drawer mode). */
  onSelect?: (asset: MediaAsset) => void
  /** Highlight a particular asset as currently selected. */
  selectedId?: number | null
  /** Initial source filter. */
  defaultSource?: MediaSource
}

/**
 * Shared media browser used by:
 *
 * - The admin `/admin/media` page (`mode="page"`)
 * - The article editor's side drawer (`mode="select"`)
 *
 * Both modes share the same query, grid, and usage-detail UX. Lifecycle
 * actions (trash, restore, purge) are wired only in page mode.
 */
export function MediaBrowser({
  mode,
  onSelect,
  selectedId,
  defaultSource,
}: MediaBrowserProps) {
  const qc = useQueryClient()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [source, setSource] = useState<MediaSource | ''>(defaultSource ?? '')
  const [status, setStatus] = useState<MediaStatus | ''>(mode === 'page' ? 'active' : '')
  const [usage, setUsage] = useState<'all' | 'used' | 'unused'>('all')
  const [health, setHealth] = useState<MediaHealth | ''>('')
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null)
  const [confirmTrash, setConfirmTrash] = useState<MediaAsset | null>(null)
  const [confirmPurge, setConfirmPurge] = useState<MediaAsset | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q), 250)
    return () => window.clearTimeout(t)
  }, [q])

  // Use a derived effect: when filters change, drop the page number to 1.
  // We track the previous filter signature and reset via setPage only when
  // a change is detected (avoids the React lint warning about cascading
  // renders — the setState is conditional on a real transition).
  const prevFiltersRef = useRef('')
  useEffect(() => {
    const signature = `${debouncedQ}|${source}|${status}|${usage}|${health}`
    if (prevFiltersRef.current !== signature) {
      prevFiltersRef.current = signature
      if (page !== 1) setPage(1)
    }
    // Intentionally exclude `page` to avoid loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, source, status, usage, health])

  const params: MediaListParams = useMemo(() => {
    const p: MediaListParams = { page, per_page: 24 }
    if (debouncedQ) p.q = debouncedQ
    if (source) p.source = source
    if (status) p.status = status
    if (usage !== 'all') p.usage = usage
    if (health) p.health = health
    return p
  }, [page, debouncedQ, source, status, usage, health])

  const list = useQuery({
    queryKey: ['admin', 'media', params, mode],
    queryFn: () => api.admin.media.list(params),
  })

  const usagesQ = useQuery({
    queryKey: ['admin', 'media', selectedAsset?.id, 'usages'],
    queryFn: () => api.admin.media.usages(selectedAsset!.id),
    enabled: !!selectedAsset,
  })

  const uploadMut = useMutation({
    mutationFn: (file: File) => api.admin.media.upload(file, 'upload'),
    onSuccess: (asset) => {
      qc.invalidateQueries({ queryKey: ['admin', 'media'] })
      if (mode === 'select' && onSelect && asset.status === 'active' && asset.health === 'healthy') {
        onSelect(asset)
      } else {
        toast.success('上传成功')
      }
    },
    onError: (e) => toast.error(`上传失败: ${e instanceof Error ? e.message : String(e)}`),
  })

  const trashMut = useMutation({
    mutationFn: (id: number) => api.admin.media.trash(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'media'] })
      setConfirmTrash(null)
      toast.success('已放入回收站')
    },
    onError: (e: unknown) => {
      const apiErr = e instanceof ApiError ? e : null
      const code = apiErr?.code
      const body = apiErr?.body as { error?: { usages?: MediaUsage[] } } | null
      if (code === 'asset_in_use' && body?.error?.usages) {
        const usages: MediaUsage[] = body.error.usages
        toast.error(
          `图片仍被引用：${usages.map((u) => `${u.title} (×${u.reference_count})`).join('、')}`,
        )
      } else {
        toast.error(`放入回收站失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  })

  const restoreMut = useMutation({
    mutationFn: (id: number) => api.admin.media.restore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'media'] })
      toast.success('已恢复')
    },
    onError: (e) => toast.error(`恢复失败: ${e instanceof Error ? e.message : String(e)}`),
  })

  const purgeMut = useMutation({
    mutationFn: (id: number) => api.admin.media.purge(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'media'] })
      setConfirmPurge(null)
      toast.success('已永久删除')
    },
    onError: (e) => toast.error(`永久删除失败: ${e instanceof Error ? e.message : String(e)}`),
  })

  const handleCopy = async (url: string, id: number) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${url}`)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch {
      toast.error('复制失败')
    }
  }

  const handleFilePick = (file: File) => {
    uploadMut.mutate(file)
  }

  const items = useMemo(() => list.data?.items ?? [], [list.data])
  const pages = list.data ? pageCount(list.data) : 1

  // If the currently selected asset is no longer in the visible list
  // (filter change, trashed/purged, refreshed after restore), clear the
  // detail panel so it doesn't show a stale row. Only meaningful in page
  // mode where the detail panel renders.
  useEffect(() => {
    if (mode !== 'page' || !selectedAsset) return
    if (!items.some((a) => a.id === selectedAsset.id)) {
      setSelectedAsset(null)
    }
  }, [mode, selectedAsset, items])

  // Select-mode selectable predicate.
  const isSelectable = (a: MediaAsset) => mode === 'select' && a.status === 'active' && a.health === 'healthy'

  return (
    <div className="media-browser" data-mode={mode}>
      {mode === 'page' && (
        <PageHeader title="媒体库" description={`共 ${list.data?.total ?? '…'} 项`} />
      )}

      <div className="media-browser__filters">
        <input
          type="search"
          placeholder="搜索文件名或路径"
          aria-label="搜索文件名或路径"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 220 }}
        />
        {mode === 'page' && (
          <select
            aria-label="来源"
            value={source}
            onChange={(e) => setSource(e.target.value as MediaSource | '')}
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
        <select
          aria-label="使用状态"
          value={usage}
          onChange={(e) => setUsage(e.target.value as 'all' | 'used' | 'unused')}
        >
          {USAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {mode === 'page' && (
          <>
            <select
              aria-label="状态"
              value={status}
              onChange={(e) => setStatus(e.target.value as MediaStatus | '')}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              aria-label="健康状态"
              value={health}
              onChange={(e) => setHealth(e.target.value as MediaHealth | '')}
            >
              {HEALTH_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))}
            </select>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          data-testid="media-library-upload-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFilePick(f)
            e.target.value = ''
          }}
        />
        <Button
          variant="secondary"
          icon={<Upload size={14} />}
          loading={uploadMut.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          上传图片
        </Button>
        <div className="media-browser__counts">
          {list.isLoading
            ? '加载中…'
            : list.data
              ? `当前 ${items.length} / ${list.data.total} 项`
              : ''}
        </div>
      </div>

      {list.isLoading ? (
        <p style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--admin-text-2)' }}>
          加载中…
        </p>
      ) : items.length === 0 ? (
        <Empty title="尚无图片" description="上传图片或调整筛选条件。" />
      ) : (
        <>
          <div className="media-browser__grid">
            {items.map((asset) => {
              const selectable = isSelectable(asset)
              return (
                <div
                  key={asset.id}
                  className={`media-browser__card${selectedId === asset.id ? ' is-selected' : ''}${
                    !selectable && mode === 'select' ? ' is-disabled' : ''
                  }`}
                  onClick={() => {
                    if (mode === 'select') {
                      if (!selectable) return
                      onSelect?.(asset)
                      return
                    }
                    setSelectedAsset(asset)
                  }}
                  role={mode === 'select' ? 'button' : undefined}
                  tabIndex={mode === 'select' ? 0 : undefined}
                  onKeyDown={
                    mode === 'select'
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            if (selectable) onSelect?.(asset)
                          }
                        }
                      : undefined
                  }
                  aria-disabled={mode === 'select' && !selectable ? true : undefined}
                >
                  <div className="media-browser__thumb">
                    {asset.health === 'missing_file' ? (
                      <ImageOff size={32} color="var(--danger)" />
                    ) : (
                      <CoverImage
                        src={asset.url}
                        alt={asset.original_name}
                        category={asset.original_name.split('.').pop()?.toUpperCase() ?? 'IMG'}
                        aspectRatio="auto"
                      />
                    )}
                  </div>
                  <div className="media-browser__body">
                    <div className="media-browser__name">{asset.original_name}</div>
                    <div className="media-browser__path">{asset.storage_path}</div>
                    <div className="media-browser__meta">
                      <span>{asset.width && asset.height ? `${asset.width}×${asset.height}` : '—'}</span>
                      <span>{(asset.byte_size / 1024).toFixed(1)} KB</span>
                      <span>{asset.source}</span>
                      <span>{new Date(asset.created_at).toLocaleDateString('zh-CN')}</span>
                    </div>
                    <div className="media-browser__chips">
                      <span className={`media-browser__chip media-browser__chip--${asset.health}`}>
                        {asset.health === 'healthy' ? '可用' : asset.health === 'missing_file' ? '文件缺失' : '图片损坏'}
                      </span>
                      {asset.status === 'trashed' && (
                        <span className="media-browser__chip media-browser__chip--trashed">回收站</span>
                      )}
                      {asset.uploaded_by && (
                        <span className="media-browser__chip">{asset.uploaded_by}</span>
                      )}
                    </div>
                  </div>
                  {mode === 'page' && (
                    <div className="media-browser__actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        label={copiedId === asset.id ? '已复制' : '复制 URL'}
                        variant={copiedId === asset.id ? 'solid' : 'ghost'}
                        size="sm"
                        icon={copiedId === asset.id ? <Check size={14} /> : <Copy size={14} />}
                        onClick={() => handleCopy(asset.url, asset.id)}
                      />
                      {asset.status === 'active' && (
                        <IconButton
                          label="放入回收站"
                          variant="danger"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          data-ai-blocked="delete"
                          onClick={() => setConfirmTrash(asset)}
                        />
                      )}
                      {asset.status === 'trashed' && (
                        <IconButton
                          label="恢复"
                          variant="ghost"
                          size="sm"
                          icon={<RotateCcw size={14} />}
                          onClick={() => restoreMut.mutate(asset.id)}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {pages > 1 && (
            <nav className="media-browser__pagination" aria-label="媒体分页">
              <button
                className="admin-pager__btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="上一页"
              >‹</button>
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  className={`admin-pager__btn${p === page ? ' is-active' : ''}`}
                  onClick={() => setPage(p)}
                  aria-current={p === page ? 'page' : undefined}
                >{p}</button>
              ))}
              <button
                className="admin-pager__btn"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                aria-label="下一页"
              >›</button>
            </nav>
          )}

          {mode === 'page' && selectedAsset && (
            <div className="media-browser__detail" data-testid="media-detail">
              <h4>{selectedAsset.original_name}</h4>
              <div className="media-browser__detail-row"><strong>路径：</strong>{selectedAsset.storage_path}</div>
              <div className="media-browser__detail-row"><strong>URL：</strong>{selectedAsset.url}</div>
              <div className="media-browser__detail-row">
                <strong>引用：</strong>
                {usagesQ.isLoading
                  ? '加载中…'
                  : (usagesQ.data ?? []).length === 0
                    ? '未被引用'
                    : (
                      <div className="media-browser__usages">
                        {(usagesQ.data ?? []).map((u, i) => (
                          <div key={`${u.owner_type}-${u.owner_id}-${u.field}-${i}`} className="media-browser__usage">
                            {u.owner_type === 'article' ? '文章' : u.owner_type === 'journal' ? '期刊' : u.owner_type}：
                            {u.title} <span style={{ color: 'var(--admin-text-muted)' }}>({u.field === 'content' ? '正文' : '封面'}, ×{u.reference_count})</span>
                          </div>
                        ))}
                      </div>
                    )}
              </div>
              {selectedAsset.status === 'trashed' && selectedAsset.trashed_at && (
                <div className="media-browser__detail-row">
                  <AlertCircle size={14} color="var(--admin-text-muted)" />
                  <span>已进入回收站：{new Date(selectedAsset.trashed_at).toLocaleString('zh-CN')}</span>
                </div>
              )}
              {selectedAsset.health !== 'healthy' && (
                <Button
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  data-ai-blocked="delete"
                  onClick={() => setConfirmPurge(selectedAsset)}
                >
                  永久删除
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <Modal
        open={confirmTrash !== null}
        onClose={() => setConfirmTrash(null)}
        title="放入回收站"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmTrash(null)}>取消</Button>
            <Button
              variant="danger"
              data-ai-blocked="delete"
              loading={trashMut.isPending}
              onClick={() => confirmTrash && trashMut.mutate(confirmTrash.id)}
            >确认</Button>
          </>
        }
      >
        <p>确认将图片「{confirmTrash?.original_name}」放入回收站？被引用的图片无法回收。</p>
      </Modal>

      <Modal
        open={confirmPurge !== null}
        onClose={() => setConfirmPurge(null)}
        title="永久删除"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmPurge(null)}>取消</Button>
            <Button
              variant="danger"
              data-ai-blocked="delete"
              loading={purgeMut.isPending}
              onClick={() => confirmPurge && purgeMut.mutate(confirmPurge.id)}
            >永久删除</Button>
          </>
        }
      >
        <p>
          此操作不可撤销：将从存储与数据库中同时移除「{confirmPurge?.original_name}」。
          仅当图片已超过保留期且无任何引用时才能成功执行。
        </p>
      </Modal>
    </div>
  )
}
