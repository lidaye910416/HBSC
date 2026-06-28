import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Clock,
  Eye,
  ArrowLeft,
  Calendar,
  User,
  Share2,
  Link as LinkIcon,
  Check,
  BookOpen,
  MessageCircle,
} from 'lucide-react'
import { api } from '../services/api'
import { ArticleCard } from '../components/ArticleCard'
import { Breadcrumb } from '../components/Breadcrumb'

/**
 * Map an article slug to the on-disk source-image subdirectory under
 * /uploads/source-images/. Mirrors `SLUG_TO_IMAGE_DIR` in
 * `backend/scripts/normalize_markdown.py` — both must stay in sync.
 *
 * Used by `resolveImageSrc` to rewrite legacy `media/imageN.ext`
 * references (left over from pandoc .docx → markdown conversion) into
 * absolute `/uploads/source-images/<subdir>/imageN.ext` paths that the
 * backend StaticFiles mount can serve.
 */
const SLUG_TO_IMAGE_DIR: Record<string, string> = {
  'openclaw-agent-framework': '03-openclaw',
  'jiayu-county-governance-platform': '06-jiayuxian',
  'esb-architecture-liantou': '07-liantouESB',
  'q1-2026-news-summary': '08-xinwenhuizong',
  'xia-junchao-youth-pioneer': '09-xiajunchao',
  'autonomous-driving-wuhan-newcity': '11-zidongjiashijiebo',
}

/**
 * Resolve an image `src` from article markdown to a URL the browser can fetch.
 *
 * - Absolute paths (`/uploads/...`, `https://...`) are returned as-is.
 * - Legacy `media/imageN.ext` paths are rewritten to
 *   `/uploads/source-images/<slug-subdir>/imageN.ext` so they resolve.
 * - Anything else is returned unchanged (defensive default).
 */
function resolveImageSrc(src: string, slug?: string): string {
  if (!src) return src
  // Already absolute or data: URL
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src
  if (src.startsWith('/')) return src
  // Legacy pandoc `media/...` reference
  if (src.startsWith('media/')) {
    const subdir = slug ? SLUG_TO_IMAGE_DIR[slug] : undefined
    if (subdir) {
      return `/uploads/source-images/${subdir}/${src.slice('media/'.length)}`
    }
    // Fallback: serve from backend `/uploads/` root, which is where some
    // uploads end up if the slug-to-subdir map hasn't been updated yet.
    return `/uploads/source-images/${src.slice('media/'.length)}`
  }
  return src
}
import './ArticleDetail.css'

type Heading = { id: string; text: string; level: 2 | 3 }

function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}\-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function extractHeadings(markdown: string): Heading[] {
  if (!markdown) return []
  const lines = markdown.split('\n')
  const headings: Heading[] = []
  const seen = new Set<string>()
  let inCode = false
  for (const line of lines) {
    if (line.startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!m) continue
    const level = (m[1].length === 2 ? 2 : 3) as 2 | 3
    const text = m[2].replace(/[*_`]/g, '').trim()
    let id = slugifyHeading(text) || `h-${headings.length}`
    let n = 2
    while (seen.has(id)) {
      id = `${slugifyHeading(text) || 'h'}-${n++}`
    }
    seen.add(id)
    headings.push({ id, text, level })
  }
  return headings
}

export function ArticleDetail() {
  const { slug } = useParams()
  const { data: article, isLoading } = useQuery({
    queryKey: ['article', slug],
    queryFn: () => api.articles.detail(slug!),
    enabled: !!slug,
  })

  const { data: featured } = useQuery({
    queryKey: ['featured'],
    queryFn: api.articles.featured,
  })

  // 后端 /api/articles/{slug} 返回的 related 形状较简（无 cover_image/author/views），
  // 这里复用 featured 列表来展示带封面和元数据的"相关阅读"。
  const related = featured?.filter(a => a.slug !== slug).slice(0, 3) ?? []

  // Increment view count once per slug (separate POST endpoint — GET is now
  // side-effect-free). useRef guards against React 18 StrictMode double-mount
  // and re-renders that would otherwise fire multiple view counts per visit.
  const viewedSlugRef = useRef<string | null>(null)
  useEffect(() => {
    if (!article || viewedSlugRef.current === article.slug) return
    viewedSlugRef.current = article.slug
    api.articles.view(article.slug).catch(() => {
      // Fire-and-forget: view tracking must never break the page.
    })
  }, [article])

  const headings = useMemo(
    () => extractHeadings(article?.content ?? ''),
    [article?.content],
  )

  const [activeId, setActiveId] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (headings.length === 0) {
      setActiveId('')
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: [0, 1] },
    )
    headings.forEach(h => {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [headings])

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* noop */
    }
  }

  const handleShareTwitter = () => {
    const url = encodeURIComponent(window.location.href)
    const text = encodeURIComponent(article?.title ?? '')
    window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank', 'noopener,noreferrer')
  }

  const handleShareWeibo = () => {
    const url = encodeURIComponent(window.location.href)
    const text = encodeURIComponent(article?.title ?? '')
    window.open(`https://service.weibo.com/share/share.php?url=${url}&title=${text}`, '_blank', 'noopener,noreferrer')
  }

  if (isLoading) {
    return (
      <main className="article-detail">
        <div className="container">
          <div className="article-detail__skeleton">
            <div className="skeleton-cover" />
            <div className="skeleton-line skeleton-line--lg" />
            <div className="skeleton-line skeleton-line--md" />
            <div className="skeleton-line skeleton-line--sm" />
            <div className="skeleton-body">
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-line--80" />
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (!article) {
    return (
      <main className="article-detail">
        <div className="container">
          <div className="article-detail__empty">
            <BookOpen size={48} strokeWidth={1.25} />
            <h2>文章未找到</h2>
            <p>该文章可能已被移除或链接已失效。</p>
            <Link to="/articles" className="btn btn-primary">
              <ArrowLeft size={16} /> 返回文章列表
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : ''

  const tags: string[] = Array.isArray(article.tags)
    ? article.tags
    : String(article.tags ?? '').split(',').map(t => t.trim()).filter(Boolean)

  return (
    <main className="article-detail">
      {/* Hero / Cover */}
      <header className="article-detail__hero">
        {article.cover_image && (
          <div className="article-detail__cover">
            <img src={article.cover_image} alt={article.title} />
            <div className="article-detail__cover-overlay" />
          </div>
        )}

        <div className="container">
          <div className="article-detail__hero-inner">
            <Breadcrumb
              variant="dark"
              items={[
                { label: '首页', to: '/' },
                { label: '文章', to: '/articles' },
                {
                  label: article.category || '未分类',
                  to: `/articles?category=${encodeURIComponent(article.category || '')}`,
                },
                { label: article.title },
              ]}
            />

            {(article as any).issue?.title ? (
              <span className="article-detail__eyebrow">{(article as any).issue.title}</span>
            ) : date ? (
              <span className="article-detail__eyebrow">{date}</span>
            ) : null}
            <h1 className="article-detail__title">{article.title}</h1>

            {article.summary && (
              <p className="article-detail__lede">{article.summary}</p>
            )}

            <div className="article-detail__meta">
              {article.author_avatar && (
                <img
                  src={article.author_avatar}
                  alt={article.author_name ?? ''}
                  className="article-detail__avatar"
                />
              )}
              <div className="article-detail__meta-text">
                {article.author_name && (
                  <span className="article-detail__author">
                    <User size={14} strokeWidth={1.5} /> {article.author_name}
                  </span>
                )}
                <div className="article-detail__stats">
                  {date && (
                    <span>
                      <Calendar size={13} strokeWidth={1.5} /> {date}
                    </span>
                  )}
                  <span>
                    <Clock size={13} strokeWidth={1.5} /> {article.reading_time} 分钟阅读
                  </span>
                  <span>
                    <Eye size={13} strokeWidth={1.5} /> {article.views} 次阅读
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="container">
        <div className="article-detail__layout">
          <article className="article-detail__main">
            <Link to="/articles" className="article-detail__back" aria-label="返回文章列表">
              <ArrowLeft size={16} strokeWidth={1.5} /> 返回文章列表
            </Link>

            {tags.length > 0 && (
              <div className="article-detail__tags">
                {tags.map(tag => (
                  <span key={tag} className="tag tag-dark">
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            <div className="prose prose-lg article-detail__content">
              {article.content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h2: ({ children, ...props }) => {
                      const text = String(Array.isArray(children) ? children.join('') : children)
                      const id = slugifyHeading(text) || text
                      return (
                        <h2 id={id} {...props}>
                          {children}
                        </h2>
                      )
                    },
                    h3: ({ children, ...props }) => {
                      const text = String(Array.isArray(children) ? children.join('') : children)
                      const id = slugifyHeading(text) || text
                      return (
                        <h3 id={id} {...props}>
                          {children}
                        </h3>
                      )
                    },
                    a: ({ href = '', children, ...props }) => {
                      const isExternal = /^https?:\/\//i.test(href)
                      return (
                        <a
                          href={href}
                          target={isExternal ? '_blank' : undefined}
                          rel={isExternal ? 'noopener noreferrer' : undefined}
                          {...props}
                        >
                          {children}
                        </a>
                      )
                    },
                    // Image rendering: supports both absolute `/uploads/...`
                    // paths and legacy `media/...` relative paths (used during
                    // the pandoc → markdown import). Legacy paths are
                    // rewritten against `import.meta.env.BASE_URL` so they
                    // resolve via the Vite dev proxy / static mount.
                    img: ({ src = '', alt = '', ...props }) => {
                      const resolved = resolveImageSrc(src, article.slug)
                      return (
                        <img
                          src={resolved}
                          alt={alt}
                          loading="lazy"
                          decoding="async"
                          className="prose-figure-img"
                          {...props}
                        />
                      )
                    },
                    table: ({ children, ...props }) => (
                      <div className="prose-table-wrap">
                        <table {...props}>{children}</table>
                      </div>
                    ),
                    // GFM table components need id-less variants
                    thead: ({ children, ...props }) => (
                      <thead {...props}>{children}</thead>
                    ),
                    tbody: ({ children, ...props }) => (
                      <tbody {...props}>{children}</tbody>
                    ),
                  }}
                >
                  {article.content}
                </ReactMarkdown>
              ) : (
                <p className="article-detail__empty-content">暂无正文内容</p>
              )}
            </div>

            {/* Share row */}
            <div className="article-detail__share" role="group" aria-label="分享文章">
              <span className="article-detail__share-label">
                <Share2 size={14} strokeWidth={1.5} /> 分享
              </span>
              <button
                type="button"
                className="article-detail__share-btn"
                onClick={handleCopyLink}
                aria-label="复制链接"
              >
                {copied ? <Check size={14} strokeWidth={1.75} /> : <LinkIcon size={14} strokeWidth={1.5} />}
                {copied ? '已复制' : '复制链接'}
              </button>
              <button
                type="button"
                className="article-detail__share-btn"
                onClick={handleShareTwitter}
                aria-label="分享到 Twitter"
              >
                <MessageCircle size={14} strokeWidth={1.5} /> Twitter
              </button>
              <button
                type="button"
                className="article-detail__share-btn"
                onClick={handleShareWeibo}
                aria-label="分享到微博"
              >
                微博
              </button>
            </div>
          </article>

          {/* Sidebar */}
          <aside className="article-detail__sidebar" aria-label="文章侧栏">
            {article.author_name && (
              <div className="sidebar-card">
                <h4 className="sidebar-card__title">关于作者</h4>
                {article.author_avatar && (
                  <img
                    src={article.author_avatar}
                    alt=""
                    className="sidebar-author__avatar"
                  />
                )}
                <p className="sidebar-author__name">{article.author_name}</p>
                {article.category && (
                  <p className="sidebar-author__area">{article.category} 研究员</p>
                )}
              </div>
            )}

            {headings.length > 0 && (
              <div className="sidebar-card">
                <h4 className="sidebar-card__title">目录</h4>
                <nav className="sidebar-toc" aria-label="文章目录">
                  <ul>
                    {headings.map(h => (
                      <li
                        key={h.id}
                        className={`sidebar-toc__item sidebar-toc__item--l${h.level}${
                          activeId === h.id ? ' is-active' : ''
                        }`}
                      >
                        <a href={`#${h.id}`}>{h.text}</a>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>
            )}
          </aside>
        </div>

        {/* Related */}
        {related.length > 0 && (
          <section className="article-detail__related" aria-labelledby="related-title">
            <h3 id="related-title" className="article-detail__related-title">
              相关推荐
            </h3>
            <div className="grid grid-3">
              {related.map(a => (
                <ArticleCard key={a.id} article={a} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
