import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import MDEditor from '@uiw/react-md-editor'
import { api } from '../../services/api'
import { ImageUploader } from '../../components/admin/ImageUploader'
import { MarkdownToolbar } from '../../components/admin/MarkdownToolbar'
import { InsertImageButton } from '../../components/admin/Mde/insertImagePlugin'
import { InsertTableButton } from '../../components/admin/Mde/insertTablePlugin'
import './ArticleList.css'

interface FormState {
  title: string
  slug: string
  summary: string
  content: string
  cover_image: string
  cover_image_alt: string
  category: string
  author_name: string
  reading_time: number
  featured: boolean
  status: 'draft' | 'published'
  tags: string
}

const CATEGORIES = ['战略与政策', '技术与产业', '方案与思考', '动态与文化']

const emptyForm = (): FormState => ({
  title: '',
  slug: '',
  summary: '',
  content: '',
  cover_image: '',
  cover_image_alt: '',
  category: '战略与政策',
  author_name: '',
  reading_time: 5,
  featured: false,
  status: 'draft',
  tags: '',
})

const slugify = (s: string) =>
  s.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

export function ArticleEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = !id || id === 'new'

  const [form, setForm] = useState<FormState>(emptyForm())
  const [error, setError] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')

  const handleImportDocx = async (file: File) => {
    setImportBusy(true)
    setImportError('')
    try {
      const result = await api.admin.articles.importDocx(file)
      update('title', result.title || form.title)
      update('content', result.content_markdown || form.content)
      if (!form.slug && result.suggested_slug) {
        update('slug', result.suggested_slug)
      }
      if (result.warnings?.length) {
        setImportError(`提示：${result.warnings.join('；')}`)
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setImportBusy(false)
    }
  }

  // Prefill from query params (used by JournalDetail's "新建" button)
  const [searchParams] = useSearchParams()
  const presetJournalId = searchParams.get('journal_id')
  const presetCategory = searchParams.get('category')
  const presetJournalIdNum = presetJournalId ? parseInt(presetJournalId, 10) : null

  useEffect(() => {
    if (isNew && presetCategory && CATEGORIES.includes(presetCategory)) {
      setForm((f) => ({ ...f, category: presetCategory }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: existing, isLoading } = useQuery({
    queryKey: ['admin', 'articles', id],
    queryFn: () => api.admin.articles.get(parseInt(id!, 10)),
    enabled: !isNew,
  })

  useEffect(() => {
    if (existing) {
      setForm({
        title: existing.title,
        slug: existing.slug,
        summary: existing.summary || '',
        content: existing.content || '',
        cover_image: existing.cover_image || '',
        cover_image_alt: existing.cover_image_alt || '',
        category: existing.category || '战略与政策',
        author_name: existing.author_name || '',
        reading_time: existing.reading_time,
        featured: existing.featured,
        status: (existing.status as 'draft' | 'published') || 'draft',
        tags: (existing.tags || []).join(', '),
      })
      setSlugTouched(true)
    }
  }, [existing])

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const saveMut = useMutation({
    mutationFn: async (status: 'draft' | 'published') => {
      const tagsArr = form.tags.split(',').map((t) => t.trim()).filter(Boolean)
      const body: Record<string, unknown> = {
        ...form,
        tags: tagsArr,
        status,
        reading_time: Number(form.reading_time),
      }
      if (presetJournalIdNum) {
        body.journal_id = presetJournalIdNum
      }
      if (isNew) {
        return api.admin.articles.create(body)
      } else {
        // 不允许更新 slug
        const { slug, ...rest } = body
        return api.admin.articles.update(parseInt(id!, 10), rest)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'articles'] })
      qc.invalidateQueries({ queryKey: ['admin', 'articles', id] })
      navigate('/admin/articles')
    },
    onError: (err) => setError(err instanceof Error ? err.message : '保存失败'),
  })

  if (!isNew && isLoading) {
    return <div>加载中...</div>
  }

  return (
    <div>
      <h2>{isNew ? '新建文章' : `编辑：${existing?.title || ''}`}</h2>
      <div className="article-editor">
        {error && <div className="article-editor__error">{error}</div>}

        <div className="article-editor__field">
          <label>标题 *</label>
          <input
            value={form.title}
            onChange={(e) => {
              update('title', e.target.value)
              if (!slugTouched && isNew) {
                update('slug', slugify(e.target.value))
              }
            }}
            required
          />
        </div>

        <div className="article-editor__grid-2">
          <div className="article-editor__field">
            <label>
              Slug * <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>（小写字母、数字、连字符，发布后不可改）</span>
            </label>
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
            <label>分类</label>
            <select value={form.category} onChange={(e) => update('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="article-editor__field">
          <label>摘要</label>
          <textarea
            value={form.summary}
            onChange={(e) => update('summary', e.target.value)}
            placeholder="一句话描述这篇文章"
          />
        </div>

        <div className="article-editor__field">
          <label>从 .docx 导入（自动转 Markdown）</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={importBusy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleImportDocx(f)
                e.target.value = ''
              }}
            />
            {importBusy && <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>转换中…</span>}
          </div>
          {importError && <div style={{ fontSize: '0.8125rem', color: '#d97706', marginTop: '4px' }}>{importError}</div>}
        </div>

        <div className="article-editor__field">
          <label>封面图</label>
          <ImageUploader value={form.cover_image} onChange={(url) => update('cover_image', url)} />
        </div>

        {form.cover_image && (
          <div className="article-editor__field">
            <label>封面图描述（无障碍 alt）</label>
            <input
              value={form.cover_image_alt}
              onChange={(e) => update('cover_image_alt', e.target.value)}
              placeholder="如：研究员在白板前讨论"
            />
          </div>
        )}

        <div className="article-editor__field">
          <label>正文（Markdown）</label>
          <div className="article-editor__md" data-color-mode="light">
            <MDEditor
              value={form.content}
              onChange={(v) => update('content', v || '')}
              height={500}
              preview="live"
              components={{
                toolbar: (props: any) => (
                  <>
                    {props.children}
                    <MarkdownToolbar>
                      <InsertImageButton onInsert={(md) => update('content', (form.content || '') + md)} />
                      <InsertTableButton onInsert={(md) => update('content', (form.content || '') + md)} />
                    </MarkdownToolbar>
                  </>
                ),
              }}
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              提示：点击预览中的图片/表格可 inline 编辑（图片可改 URL/alt；表格暂为只读）。
            </div>
          </div>
        </div>

        <div className="article-editor__grid-2">
          <div className="article-editor__field">
            <label>作者</label>
            <input
              value={form.author_name}
              onChange={(e) => update('author_name', e.target.value)}
            />
          </div>
          <div className="article-editor__field">
            <label>预计阅读时间（分钟）</label>
            <input
              type="number"
              min={1}
              max={999}
              value={form.reading_time}
              onChange={(e) => update('reading_time', parseInt(e.target.value, 10) || 5)}
            />
          </div>
        </div>

        <div className="article-editor__field">
          <label>标签（逗号分隔）</label>
          <input
            value={form.tags}
            onChange={(e) => update('tags', e.target.value)}
            placeholder="如：AI Agent, 数字化转型, 案例研究"
          />
        </div>

        <div className="article-editor__field">
          <label>
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => update('featured', e.target.checked)}
              style={{ width: 'auto', marginRight: '8px', verticalAlign: 'middle' }}
            />
            标记为精选
          </label>
        </div>

        <div className="article-editor__actions">
          <button
            className="article-editor__btn article-editor__btn--primary"
            onClick={() => saveMut.mutate('published')}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? '保存中...' : '保存并发布'}
          </button>
          <button
            className="article-editor__btn article-editor__btn--secondary"
            onClick={() => saveMut.mutate('draft')}
            disabled={saveMut.isPending}
          >
            保存草稿
          </button>
          <button
            className="article-editor__btn article-editor__btn--secondary"
            onClick={() => navigate('/admin/articles')}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
