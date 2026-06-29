import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import './ArticleList.css'

interface FormState {
  title: string
  slug: string
  description: string
  issue_number: string
  status: 'draft' | 'published'
  published_at: string
}

const emptyForm = (): FormState => ({
  title: '',
  slug: '',
  description: '',
  issue_number: '',
  status: 'draft',
  published_at: new Date().toISOString().slice(0, 10),
})

export function JournalEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = !id || id === 'new'

  const [form, setForm] = useState<FormState>(emptyForm())
  const [error, setError] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

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
      })
      setSlugTouched(true)
    }
  }, [existing])

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

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
      <h2>{isNew ? '新建期刊' : `编辑：${existing?.title || ''}`}</h2>
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

        <div className="article-editor__actions">
          <button
            className="article-editor__btn article-editor__btn--primary"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? '保存中...' : '保存'}
          </button>
          <button
            className="article-editor__btn article-editor__btn--secondary"
            onClick={() => navigate('/admin/journals')}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
