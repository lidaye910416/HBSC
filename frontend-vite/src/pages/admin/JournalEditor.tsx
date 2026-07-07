import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, ImagePlus } from 'lucide-react'
import { api } from '../../services/api'
import { PageHeader, Button, Card } from '../../components/ui'
import { useToast } from '../../components/admin/Toast'
import './ArticleList.css'

interface FormState {
  title: string
  slug: string
  description: string
  issue_number: string
  status: 'draft' | 'published'
  published_at: string
  cover_image: string
}

const emptyForm = (): FormState => ({
  title: '',
  slug: '',
  description: '',
  issue_number: '',
  status: 'draft',
  published_at: new Date().toISOString().slice(0, 10),
  cover_image: '',
})

export function JournalEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = !id || id === 'new'
  const toast = useToast()

  const [form, setForm] = useState<FormState>(emptyForm())
  const [error, setError] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)
  const [coverError, setCoverError] = useState('')

  const { data: existing, isLoading } = useQuery({
    queryKey: ['admin', 'journals', id],
    queryFn: () => api.admin.journals.get(parseInt(id!, 10)),
    enabled: !isNew,
  })

  useEffect(() => {
    if (existing) {
      setForm({
        title: existing.title,
        slug: existing.slug,
        description: existing.description || '',
        issue_number: existing.issue_number || '',
        status: existing.status || 'draft',
        published_at: existing.published_at ? existing.published_at.slice(0, 10) : '',
        cover_image: existing.cover_image || '',
      })
      setSlugTouched(true)
    }
  }, [existing])

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handleCoverUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setCoverError('请选择图片文件')
      return
    }
    setCoverError('')
    setCoverUploading(true)
    try {
      // 新建期刊时还没 id：先保存成草稿，再用返回的 id 上传封面
      let journalId: number = id && id !== 'new' ? parseInt(id, 10) : NaN
      if (!journalId) {
        const created = await api.admin.journals.create({
          title: form.title || '未命名期刊',
          slug: form.slug || `draft-${Date.now()}`,
          cover_image: null,
          description: form.description || null,
          issue_number: form.issue_number || null,
          status: 'draft',
          published_at: form.published_at ? new Date(form.published_at).toISOString() : null,
        })
        journalId = created.id
        // 跳转到 /admin/journals/:id/edit，让用户继续编辑
        navigate(`/admin/journals/${journalId}/edit`, { replace: true })
      }
      const updated = await api.admin.journals.uploadCover(journalId, file)
      update('cover_image', updated.cover_image || '')
      qc.invalidateQueries({ queryKey: ['admin', 'journals'] })
      toast.success('封面已上传')
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setCoverUploading(false)
    }
  }

  const handleCoverClear = async () => {
    if (!id || id === 'new') {
      update('cover_image', '')
      return
    }
    try {
      await api.admin.journals.clearCover(parseInt(id, 10))
      update('cover_image', '')
      qc.invalidateQueries({ queryKey: ['admin', 'journals'] })
      toast.success('已清除封面')
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : '清除失败')
    }
  }

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        published_at: form.published_at ? new Date(form.published_at).toISOString() : null,
      }
      if (isNew) return api.admin.journals.create(body)
      return api.admin.journals.update(parseInt(id!, 10), body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'journals'] })
      navigate('/admin/journals')
    },
    onError: (err) => setError(err instanceof Error ? err.message : '保存失败'),
  })

  if (!isNew && isLoading) return <div>加载中...</div>

  return (
    <div>
      <PageHeader
        title={isNew ? '新建期刊' : (existing?.title || '编辑期刊')}
        description={isNew ? '创建一本期刊集合，用于组织同一期号的多篇文章' : `编辑期刊 · /${existing?.slug || ''}`}
        breadcrumb={[
          { label: '期刊', to: '/admin/journals' },
          { label: isNew ? '新建' : '编辑' },
        ]}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/admin/journals')}>取消</Button>
            <Button data-ai-blocked="publish" onClick={() => saveMut.mutate()} loading={saveMut.isPending}>
              {saveMut.isPending ? '保存中...' : '保存'}
            </Button>
          </>
        }
      />
      <div className="article-editor">
        {error && <div className="article-editor__error">{error}</div>}

        <div className="article-editor__field">
          <label>标题 *</label>
          <input
            value={form.title}
            onChange={(e) => {
              update('title', e.target.value)
              if (!slugTouched && isNew) {
                update('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'))
              }
            }}
            required
          />
        </div>

        {/* 封面图 — 与文章编辑对齐：宽 21:9 预览，点击 / 拖拽替换 */}
        <div className="article-editor__field">
          <label>封面图（推荐 21:9，≤5MB）</label>
          {form.cover_image ? (
            <div className="journal-cover-editor">
              <div className="journal-cover-editor__preview">
                <img
                  src={form.cover_image}
                  alt={form.title}
                  style={{ aspectRatio: '21 / 9', width: '100%', objectFit: 'cover', borderRadius: 'var(--radius-2)', display: 'block' }}
                />
              </div>
              <div className="journal-cover-editor__actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ImagePlus size={14} />}
                  loading={coverUploading}
                  onClick={() => document.getElementById('journal-cover-input')?.click()}
                >
                  替换封面
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<X size={14} />}
                  onClick={handleCoverClear}
                >
                  清除
                </Button>
                <span className="journal-cover-editor__url">{form.cover_image}</span>
              </div>
              <input
                id="journal-cover-input"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleCoverUpload(f)
                  e.target.value = ''
                }}
              />
            </div>
          ) : (
            <div
              className="journal-cover-editor journal-cover-editor--empty"
              onClick={() => document.getElementById('journal-cover-input')?.click()}
            >
              <input
                id="journal-cover-input"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleCoverUpload(f)
                  e.target.value = ''
                }}
              />
              <ImagePlus size={28} />
              <div className="journal-cover-editor__hint">
                {coverUploading ? '上传中…' : '点击上传期刊封面（≤5MB，支持 PNG/JPG/WebP/GIF）'}
              </div>
              <small style={{ display: 'block', marginTop: 4, color: 'var(--admin-text-muted)' }}>
                上传时会自动保存为草稿（首次新建时）。
              </small>
            </div>
          )}
          {coverError && (
            <div style={{ marginTop: 8, fontSize: '0.8125rem', color: 'var(--status-draft-fg)' }}>
              {coverError}
            </div>
          )}
        </div>

        <div className="article-editor__grid-2">
          <div className="article-editor__field">
            <label>Slug *</label>
            <input
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true)
                update('slug', e.target.value)
              }}
              disabled={!isNew}
              required
            />
          </div>
          <div className="article-editor__field">
            <label>期号</label>
            <input
              value={form.issue_number}
              onChange={(e) => update('issue_number', e.target.value)}
              placeholder="如：2026-Q2"
            />
          </div>
        </div>

        <div className="article-editor__field">
          <label>描述</label>
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
          />
        </div>

        <div className="article-editor__field">
          <label>状态</label>
          <select value={form.status} onChange={(e) => update('status', e.target.value as 'draft' | 'published')}>
            <option value="draft">草稿（不公开）</option>
            <option value="published">已发布（公开）</option>
          </select>
        </div>

        <div className="article-editor__field">
          <label>发布日期</label>
          <input
            type="date"
            value={form.published_at}
            onChange={(e) => update('published_at', e.target.value)}
          />
        </div>

        <Card>
          <div className="article-editor__actions">
            <Button data-ai-blocked="publish" onClick={() => saveMut.mutate()} loading={saveMut.isPending}>
              {saveMut.isPending ? '保存中...' : '保存'}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/admin/journals')}>
              取消
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
