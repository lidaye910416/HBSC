import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Calendar, FileText, Library, ArrowUpRight, BookOpen } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { api } from '../services/api'
import { Breadcrumb } from '../components/Breadcrumb'
import { CoverImage } from '../components/CoverImage'
import { motionAllowed } from '../animations/reducedMotion'
import './Issues.css'

function formatDate(d?: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function Issues() {
  const { data: issues, isLoading } = useQuery({
    queryKey: ['issues'],
    queryFn: api.issues.list,
  })

  const sorted = useMemo(() => {
    return (issues ?? [])
      .slice()
      .sort((a, b) => {
        const ad = a.published_at ? new Date(a.published_at).getTime() : 0
        const bd = b.published_at ? new Date(b.published_at).getTime() : 0
        return bd - ad
      })
  }, [issues])

  const totalArticles = sorted.reduce((sum, i) => sum + (i.article_count ?? 0), 0)

  // P1-04 — desktop horizontal pinned gallery.
  // Mobile / tablet keep the native vertical grid; we only engage on
  // ≥1024px AND when motion is allowed (no reduced-motion, no Save-Data).
  // The track and viewport refs are populated after the grid mounts;
  // matchMedia handles live resize + breakpoint transitions.
  const trackRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!motionAllowed()) return
    const track = trackRef.current
    const viewport = viewportRef.current
    if (!track || !viewport) return

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia()
      mm.add('(min-width: 1024px)', () => {
        // Skip pin when track already fits (e.g. 1–2 issues) — the spec
        // says "1 issue = no pin", and 2 small cards shouldn't trap the
        // user in a pinned scroll with no horizontal travel either.
        // `distance` stays as a thunk so GSAP re-measures on every refresh
        // (cover images decode async and may grow the track after mount).
        const distance = () => {
          const trackWidth = track.scrollWidth
          const viewportWidth = viewport.clientWidth
          return Math.max(0, trackWidth - viewportWidth)
        }

        // Defer to next frame so the initial layout is committed before
        // we measure (covers async cover-image decode that may grow the track).
        const raf = requestAnimationFrame(() => {
          if (distance() <= 0) return
          gsap.to(track, {
            x: () => -distance(),
            ease: 'none',
            scrollTrigger: {
              trigger: viewport,
              start: 'top top',
              pin: true,
              scrub: 0.8,
              end: () => '+=' + distance(),
              invalidateOnRefresh: true,
              anticipatePin: 1,
            },
          })
        })

        return () => cancelAnimationFrame(raf)
      })
      // Explicit empty branch for <1024px — keeps matchMedia aware of both
      // breakpoints so the tween gets reverted on resize, even though we
      // never installed anything below 1024px.
      mm.add('(max-width: 1023px)', () => undefined)
      return () => mm.revert()
    }, viewport)

    return () => {
      ctx.revert()
      // Belt-and-braces: kill any stray ScrollTriggers we may have created
      // against this viewport (e.g. if the page unmounts mid-animation).
      ScrollTrigger.getAll()
        .filter((t) => t.trigger === viewport)
        .forEach((t) => t.kill())
    }
  }, [])

  return (
    <main className="issues-page">
      {/* Hero */}
      <section className="issues-hero">
        <div className="issues-hero__bg" aria-hidden="true">
          <div className="issues-hero__orb issues-hero__orb--1" />
          <div className="issues-hero__orb issues-hero__orb--2" />
          <div className="issues-hero__grid" />
        </div>
        <div className="container issues-hero__inner">
          <Breadcrumb
            variant="dark"
            items={[
              { label: '首页', to: '/' },
              { label: '期刊档案' },
            ]}
          />
          <p className="section-label issues-hero__eyebrow">
            <Library size={14} strokeWidth={2} /> ARCHIVE · 期刊档案
          </p>
          <h1 className="issues-hero__title">期刊矩阵</h1>
          <p className="issues-hero__desc">
            完整收录历期《湖北数创》期刊 ——
            从政策洞察到产业实践，跨越季度的时间维度，记录数字产业创新轨迹
          </p>
          <div className="issues-hero__stats">
            <div className="issues-hero__stat">
              <span className="issues-hero__stat-num">{sorted.length || '—'}</span>
              <span className="issues-hero__stat-label">期刊期数</span>
            </div>
            <div className="issues-hero__stat-divider" />
            <div className="issues-hero__stat">
              <span className="issues-hero__stat-num">{totalArticles || '—'}</span>
              <span className="issues-hero__stat-label">收录文章</span>
            </div>
            <div className="issues-hero__stat-divider" />
            <div className="issues-hero__stat">
              <span className="issues-hero__stat-num">季度</span>
              <span className="issues-hero__stat-label">持续更新</span>
            </div>
          </div>
        </div>
      </section>

      {/* Archive list */}
      <div className="section">
        <div className="container">
          <div className="section-header">
            <p className="section-label">ALL ISSUES</p>
            <h2 className="section-title">全部期刊</h2>
            <div className="divider" />
            <p className="section-subtitle">按发布时间倒序排列，最新期刊置顶</p>
          </div>

          {isLoading ? (
            <div className="issues-loading">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="issues-skeleton" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">
              <BookOpen size={36} strokeWidth={1.5} />
              <p>暂无期刊 — 期刊正在筹备中，敬请期待</p>
            </div>
          ) : (
            <div ref={viewportRef} className="issues-archive-viewport">
              <div ref={trackRef} className="grid grid-3 issues-archive-grid issues-archive-track">
                {sorted.map((issue) => {
                  const isLatest = sorted[0]?.id === issue.id
                  return (
                    <Link
                      key={issue.id}
                      to={`/issues/${issue.slug}`}
                      className={`issue-archive-card card ${isLatest ? 'is-latest' : ''}`}
                      aria-label={`查看期刊 ${issue.title}`}
                    >
                      <div className="card__cover issue-archive-card__cover">
                        <CoverImage src={issue.cover_image} alt={issue.title} aspectRatio="16 / 10" />
                        {isLatest && (
                          <span className="issue-archive-card__badge">最新</span>
                        )}
                      </div>

                      <div className="card__body issue-archive-card__body">
                        {issue.issue_number && (
                          <p className="issue-archive-card__number">
                            <span className="text-en">ISSUE {issue.issue_number}</span>
                          </p>
                        )}
                        <h3 className="card__title issue-archive-card__title">{issue.title}</h3>

                        {issue.description && (
                          <p className="issue-archive-card__desc">{issue.description}</p>
                        )}

                        <div className="issue-archive-card__meta">
                          {issue.published_at && (
                            <span>
                              <Calendar size={13} strokeWidth={1.5} />
                              {formatDate(issue.published_at)}
                            </span>
                          )}
                          <span>
                            <FileText size={13} strokeWidth={1.5} />
                            {issue.article_count} 篇文章
                          </span>
                        </div>

                        <span className="issue-archive-card__cta">
                          阅读本期 <ArrowUpRight size={14} strokeWidth={2} />
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
