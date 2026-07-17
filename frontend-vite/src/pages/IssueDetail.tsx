import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  FileText,
  Library,
} from 'lucide-react'
import { gsap } from 'gsap'
import { api } from '../services/api'
import { ArticleCard } from '../components/ArticleCard'
import { Breadcrumb } from '../components/Breadcrumb'
import { CoverImage } from '../components/CoverImage'
import { ReadingProgress } from '../components/ReadingProgress'
import { motionAllowed } from '../animations/reducedMotion'
import './IssueDetail.css'

function formatDate(d?: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function IssueDetail() {
  const { slug } = useParams()

  const { data: issue, isLoading } = useQuery({
    queryKey: ['issue', slug],
    queryFn: () => api.issues.detail(slug!),
    enabled: !!slug,
  })

  // Hero timeline choreography (P0-03 mirror). Rebuilds when the issue
  // slug changes; skipped entirely under prefers-reduced-motion / Save-Data
  // so the hero is visible immediately and never depends on JS.
  // Declared above the early returns so hooks order stays stable across
  // loading / empty / loaded renders.
  const heroRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!motionAllowed() || !issue) return
    const ctx = gsap.context(() => {
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from('[data-detail-cover]', { y: 32, autoAlpha: 0, duration: 0.8 })
        .from('[data-detail-eyebrow]', { y: 12, autoAlpha: 0, duration: 0.4 }, '<0.1')
        .from('[data-detail-number]', { y: 18, autoAlpha: 0, duration: 0.5 }, '<0.05')
        .from('[data-detail-title]', { y: 24, autoAlpha: 0, duration: 0.6 }, '<0.05')
        .from('[data-detail-meta]', { y: 10, autoAlpha: 0, duration: 0.4 }, '<0.1')
    }, heroRef)
    return () => ctx.revert()
  }, [issue?.slug])

  if (isLoading) {
    return (
      <main className="issue-detail">
        <div className="issue-detail__skeleton container">
          <div className="issue-detail__skeleton-cover" />
          <div className="issue-detail__skeleton-line issue-detail__skeleton-line--lg" />
          <div className="issue-detail__skeleton-line issue-detail__skeleton-line--md" />
        </div>
      </main>
    )
  }

  if (!issue) {
    return (
      <main className="issue-detail">
        <div className="container">
          <div className="empty-state">
            <BookOpen size={48} strokeWidth={1.25} />
            <h2>期刊未找到</h2>
            <p>该期刊可能已归档或链接失效</p>
            <Link to="/issues" className="btn btn-primary">
              <ArrowLeft size={16} /> 返回期刊档案
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="issue-detail">
      <ReadingProgress targetSelector=".issue-detail" />
      {/* Hero */}
      <header ref={heroRef} className="issue-detail__hero">
        {issue.cover_image && (
          <div className="issue-detail__cover" data-detail-cover>
            <CoverImage src={issue.cover_image} alt={issue.title} aspectRatio="21 / 9" />
            <div className="issue-detail__cover-overlay" aria-hidden="true" />
          </div>
        )}

        <div className="container">
          <div className="issue-detail__hero-inner">
            <Breadcrumb
              variant="dark"
              items={[
                { label: '首页', to: '/' },
                { label: '期刊', to: '/issues' },
                { label: issue.title },
              ]}
            />

            <p className="section-label issue-detail__eyebrow" data-detail-eyebrow>
              <Library size={14} strokeWidth={2} /> ISSUE · 期刊
            </p>

            {issue.issue_number && (
              <p className="issue-detail__number" data-detail-number>
                <span className="text-en">ISSUE {issue.issue_number}</span>
              </p>
            )}
            <h1 className="issue-detail__title" data-detail-title>{issue.title}</h1>

            <div className="issue-detail__meta" data-detail-meta>
              {issue.published_at && (
                <span>
                  <Calendar size={14} strokeWidth={1.5} /> {formatDate(issue.published_at)}
                </span>
              )}
              <span>
                <FileText size={14} strokeWidth={1.5} /> 收录 {issue.article_count} 篇文章
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="section">
        <div className="container">
          <Link to="/issues" className="issue-detail__back" aria-label="返回期刊档案">
            <ArrowLeft size={16} strokeWidth={1.5} /> 返回期刊档案
          </Link>

          {/* Editor's note */}
          {issue.description && (
            <section className="issue-detail__description" aria-label="期刊简介">
              <div className="section-header">
                <p className="section-label">EDITOR'S NOTE</p>
                <h2 className="section-title">编者按</h2>
                <div className="divider" />
              </div>
              <div className="issue-detail__description-body prose prose-lg">
                {issue.description.split(/\n+/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </section>
          )}

          {/* Articles list */}
          <section className="issue-detail__articles" aria-label="本期文章">
            <div className="section-header">
              <p className="section-label">CONTENTS</p>
              <h2 className="section-title">本期目录</h2>
              <div className="divider" />
              <p className="section-subtitle">本期精选文章，按编辑推荐顺序呈现</p>
            </div>

            {issue.articles && issue.articles.length > 0 ? (
              <div className="grid grid-3 issue-detail__articles-grid">
                {issue.articles.map(article => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <FileText size={36} strokeWidth={1.5} />
                <p>本期文章正在编排中，敬请期待</p>
              </div>
            )}

            <div className="issue-detail__articles-cta">
              <Link
                to={`/articles?issue=${encodeURIComponent(issue.slug)}`}
                className="btn btn-primary"
              >
                查看全部文章 <ArrowRight size={16} />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
