import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Copy, Check } from 'lucide-react'
import { api } from '../../services/api'
import { CoverImage } from '../../components/CoverImage'

export function MediaLibrary() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'media', page],
    queryFn: () => api.admin.media.list(page, 24),
  })

  const onMutateError = (err: unknown, op: string) =>
    alert(`${op}失败: ${err instanceof Error ? err.message : String(err)}`)

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.admin.media.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'media'] }),
    onError: (err) => onMutateError(err, '删除媒体'),
  })

  const handleCopy = async (url: string, id: number) => {
    const fullUrl = `${window.location.origin}${url}`
    await navigator.clipboard.writeText(fullUrl)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>媒体库</h2>
      {isLoading ? (
        <div>加载中...</div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '16px',
          }}>
            {data?.items.map((m) => (
              <div key={m.id} style={{
                background: 'white',
                borderRadius: '6px',
                overflow: 'hidden',
                border: '1px solid #e8e8e0',
              }}>
                <div style={{
                  background: '#f0f0e8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '120px',
                }}>
                  <CoverImage
                    src={m.url}
                    alt={m.original_name}
                    category={m.original_name.split('.').pop()?.toUpperCase() ?? 'IMG'}
                    aspectRatio="auto"
                    className="media-library-thumb"
                  />
                </div>
                <div style={{ padding: '8px', fontSize: '0.8125rem' }}>
                  <div style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--color-text-secondary)',
                  }}>
                    {m.original_name}
                  </div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
                    {(m.size / 1024).toFixed(1)} KB · {new Date(m.uploaded_at).toLocaleDateString('zh-CN')}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                    <button
                      onClick={() => handleCopy(m.url, m.id)}
                      style={{
                        flex: 1,
                        padding: '4px',
                        border: '1px solid #d4d4d4',
                        borderRadius: '3px',
                        background: copiedId === m.id ? '#e6f4e6' : 'white',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                      }}
                    >
                      {copiedId === m.id ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> URL</>}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`删除图片"${m.original_name}"？`)) {
                          deleteMut.mutate(m.id)
                        }
                      }}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #d4d4d4',
                        borderRadius: '3px',
                        background: 'white',
                        cursor: 'pointer',
                        color: '#c44',
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {data && data.pages > 1 && (
            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '8px' }}>
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
        </>
      )}
    </div>
  )
}
