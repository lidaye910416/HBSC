import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Copy, Check } from 'lucide-react'
import { api } from '../../services/api'
import { CoverImage } from '../../components/CoverImage'
import { useToast } from '../../components/admin/Toast'
import {
  PageHeader, IconButton, Empty, Modal, Button,
} from '../../components/ui'

export function MediaLibrary() {
  const qc = useQueryClient()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'media', page],
    queryFn: () => api.admin.media.list(page, 24),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.admin.media.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'media'] })
      toast.success('已删除')
    },
    onError: (err) =>
      toast.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`),
  })

  const handleCopy = async (url: string, id: number) => {
    await navigator.clipboard.writeText(`${window.location.origin}${url}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div>
      <PageHeader title="媒体库" description={`${data?.total ?? '…'} 张图片`} />
      {isLoading ? (
        <p style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--admin-text-2)' }}>加载中…</p>
      ) : data?.items.length === 0 ? (
        <Empty title="尚无图片" description="上传图片以在文章中使用。" />
      ) : (
        <div className="ui-card ui-card--outlined" style={{ padding: 'var(--space-5)' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--space-4)',
          }}>
            {data?.items.map((m) => (
              <div key={m.id} className="media-card">
                <div className="media-card__thumb">
                  <CoverImage
                    src={m.url}
                    alt={m.original_name}
                    category={m.original_name.split('.').pop()?.toUpperCase() ?? 'IMG'}
                    aspectRatio="auto"
                    className="media-library-thumb"
                  />
                </div>
                <div className="media-card__body">
                  <div className="media-card__name">{m.original_name}</div>
                  <div className="media-card__meta">
                    {(m.size / 1024).toFixed(1)} KB · {new Date(m.uploaded_at).toLocaleDateString('zh-CN')}
                  </div>
                  <div className="media-card__actions">
                    <IconButton
                      label={copiedId === m.id ? '已复制' : '复制 URL'}
                      variant={copiedId === m.id ? 'solid' : 'ghost'}
                      size="sm"
                      icon={copiedId === m.id ? <Check size={14} /> : <Copy size={14} />}
                      onClick={() => handleCopy(m.url, m.id)}
                    />
                    <IconButton
                      label="删除"
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      data-ai-blocked="delete"
                      onClick={() => setConfirmDelete({ id: m.id, name: m.original_name })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {data && data.pages > 1 && (
            <div style={{ marginTop: 'var(--space-5)', display: 'flex', justifyContent: 'center', gap: 'var(--space-2)' }}>
              {Array.from({ length: data.pages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`admin-pager__btn${p === page ? ' is-active' : ''}`}
                >{p}</button>
              ))}
            </div>
          )}
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
        <p>确认删除图片「{confirmDelete?.name}」？此操作不可撤销。</p>
      </Modal>
    </div>
  )
}