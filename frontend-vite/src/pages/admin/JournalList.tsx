import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit, Trash2, ExternalLink, AlertTriangle } from 'lucide-react'
import { api, type JournalCompleteness } from '../../services/api'
import { useToast } from '../../components/admin/Toast'
import {
  PageHeader, Button, Toolbar, ToolbarGroup, SearchInput, Empty, IconButton, Modal,
} from '../../components/ui'

interface DeleteTarget {
  id: number
  title: string
  articleCount: number
}

export function JournalList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
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
      if (!data?.items || data.items.length === 0) return {} as Record<number, JournalCompleteness>
      // Single batch call instead of one request per row
      const map = await api.admin.journals.completenessBatch(data.items.map((j) => j.id))
      const out: Record<number, JournalCompleteness> = {}
      for (const j of data.items) {
        const v = map[String(j.id)]
        if (v) out[j.id] = v
      }
      return out
    },
    enabled: !!data?.items?.length,
  })

  const onMutateError = (err: unknown, op: string) =>
    toast.error(`${op}失败: ${err instanceof Error ? err.message : String(err)}`)

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.admin.journals.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'journals'] })
      setDeleteTarget(null)
      setConfirmInput('')
      toast.success('已删除')
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
      <PageHeader
        title="期刊管理"
        description={`共 ${data?.total ?? '…'} 本`}
        actions={
          <Button icon={<Plus size={16} />} onClick={() => navigate('/admin/journals/new')}>
            新建期刊
          </Button>
        }
      />

      <Toolbar>
        <ToolbarGroup>
          <SearchInput
            placeholder="搜索标题..."
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
          />
        </ToolbarGroup>
      </Toolbar>

      {isLoading ? (
        <p style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--admin-text-2)' }}>加载中…</p>
      ) : (
        <div className="ui-card ui-card--outlined" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>期号</th>
                <th>文章数</th>
                <th>发布日期</th>
                <th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((j) => (
                <tr key={j.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{j.title}</div>
                    <div style={{ fontSize: 'var(--type-xs)', color: 'var(--admin-text-muted)' }}>/{j.slug}</div>
                  </td>
                  <td>{j.issue_number || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span>{j.article_count}</span>
                      {completeness?.[j.id] && (
                        <span
                          title={
                            completeness[j.id].complete
                              ? '四类齐全'
                              : `缺：${['战略与政策', '技术与产业', '方案与思考', '动态与文化']
                                  .filter((c) => completeness[j.id][c as keyof JournalCompleteness] === 0)
                                  .join('、')}`
                          }
                          style={{
                            fontSize: 'var(--type-xs)',
                            padding: '1px 8px',
                            borderRadius: 999,
                            background: completeness[j.id].complete
                              ? 'var(--status-published-bg)'
                              : 'var(--status-draft-bg)',
                            color: completeness[j.id].complete
                              ? 'var(--status-published-fg)'
                              : 'var(--status-draft-fg)',
                            fontWeight: 500,
                          }}
                        >
                          {completeness[j.id].complete ? '完整' : '不完整'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: 'var(--type-sm)', color: 'var(--admin-text-2)' }}>
                    {j.published_at ? new Date(j.published_at).toLocaleDateString('zh-CN') : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <IconButton
                        label="查看"
                        variant="ghost"
                        size="sm"
                        icon={<ExternalLink size={14} />}
                        onClick={() => navigate(`/admin/journals/${j.id}`)}
                      />
                      <IconButton
                        label="编辑元数据"
                        variant="ghost"
                        size="sm"
                        icon={<Edit size={14} />}
                        onClick={() => navigate(`/admin/journals/${j.id}/edit`)}
                      />
                      <IconButton
                        label="删除"
                        variant="danger"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        data-ai-blocked="delete"
                        onClick={() => openDeleteConfirm(j.id, j.title, j.article_count)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <Empty title="暂无期刊" description="点击右上角『新建期刊』开始。" />
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
        open={deleteTarget !== null}
        onClose={cancelDelete}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--danger)' }}>
            <AlertTriangle size={16} /> 确认删除期刊
          </span>
        }
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={cancelDelete}>取消</Button>
            <Button
              variant="danger"
              data-ai-blocked="delete"
              loading={deleteMut.isPending}
              disabled={confirmInput.trim() !== deleteTarget?.title || deleteMut.isPending}
              onClick={confirmDelete}
            >确认删除</Button>
          </>
        }
      >
        <p style={{ margin: '0 0 var(--space-3) 0', lineHeight: 1.6 }}>
          确认删除期刊 <strong>《{deleteTarget?.title}》</strong> 吗？
        </p>
        <div
          style={{
            margin: '0 0 var(--space-4) 0',
            padding: 'var(--space-3)',
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-2)',
            color: 'var(--danger)',
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          这将一并删除其下的 <strong>{deleteTarget?.articleCount}</strong> 篇文章。此操作不可撤销。
        </div>
        <label
          style={{
            display: 'block',
            fontSize: 'var(--type-sm)',
            color: 'var(--admin-text-2)',
            marginBottom: 'var(--space-2)',
          }}
        >
          请输入期刊名称 <code style={{ background: 'var(--admin-surface-2)', padding: '1px 6px', borderRadius: 'var(--radius-1)' }}>{deleteTarget?.title}</code> 以确认删除：
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
            border: '1px solid var(--admin-border-strong)',
            borderRadius: 'var(--radius-2)',
            fontSize: 'var(--type-base)',
            fontFamily: 'inherit',
            background: 'var(--admin-surface)',
            color: 'var(--admin-text)',
            boxSizing: 'border-box',
          }}
        />
      </Modal>
    </div>
  )
}