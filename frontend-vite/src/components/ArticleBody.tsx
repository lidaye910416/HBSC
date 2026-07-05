import { useMemo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Map an article slug to the on-disk source-image subdirectory under
 * /uploads/source-images/. Mirrors `SLUG_TO_IMAGE_DIR` in
 * `backend/app/services/markdown_normalize.py`.
 *
 * The backend should now own this map (see Section 4 of the
 * Word→Editor→Display plan). When the public `/api/articles/image-map`
 * endpoint lands, replace this local copy with a useQuery hook.
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
    // Fallback: serve from backend `/uploads/` root.
    return `/uploads/source-images/${src.slice('media/'.length)}`
  }
  return src
}

/** Slugify a heading text for use as an id (matches the ArticleDetail rule). */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}\-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export type Heading = { id: string; text: string; level: 2 | 3 }

/**
 * Extract h2/h3 headings from a markdown string. Used by the public
 * article page to build the TOC sidebar. Exported here so consumers
 * don't have to re-implement the parser.
 */
export function extractHeadings(markdown: string): Heading[] {
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

/**
 * Build the react-markdown `components` map used by every renderer of
 * the article body. Centralized so the public page and the admin
 * preview stay byte-identical.
 */
function buildComponents(slug?: string) {
  return {
    h2: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
      const text = String(Array.isArray(children) ? children.join('') : children)
      const id = slugifyHeading(text) || text
      return (
        <h2 id={id} {...(props as object)}>
          {children}
        </h2>
      )
    },
    h3: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
      const text = String(Array.isArray(children) ? children.join('') : children)
      const id = slugifyHeading(text) || text
      return (
        <h3 id={id} {...(props as object)}>
          {children}
        </h3>
      )
    },
    a: ({ href = '', children, ...props }: { href?: string; children?: ReactNode } & Record<string, unknown>) => {
      const isExternal = /^https?:\/\//i.test(href)
      return (
        <a
          href={href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          {...(props as object)}
        >
          {children}
        </a>
      )
    },
    img: ({ src = '', alt = '', ...props }: { src?: string; alt?: string } & Record<string, unknown>) => {
      const resolved = resolveImageSrc(src, slug)
      return (
        <img
          src={resolved}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="prose-figure-img"
          {...(props as object)}
        />
      )
    },
    table: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
      <div className="prose-table-wrap">
        <table {...(props as object)}>{children}</table>
      </div>
    ),
    thead: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
      <thead {...(props as object)}>{children}</thead>
    ),
    tbody: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
      <tbody {...(props as object)}>{children}</tbody>
    ),
  }
}

export interface ArticleBodyProps {
  content: string
  slug?: string
  className?: string
  fallback?: ReactNode
}

/**
 * Render markdown article content with the project's standard
 * typography classes and component overrides.
 *
 * Used by:
 *  - `pages/ArticleDetail.tsx` (public article page)
 *  - `pages/admin/ArticleEditor.tsx` (preview tab)
 */
export function ArticleBody({
  content,
  slug,
  className = 'prose prose-lg',
  fallback,
}: ArticleBodyProps) {
  const cm = useMemo(() => buildComponents(slug), [slug])

  if (!content) {
    if (fallback !== undefined) return <>{fallback}</>
    return <p className="article-detail__empty-content">暂无正文内容</p>
  }

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={cm as never}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
