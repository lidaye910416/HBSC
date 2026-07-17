import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, BookOpen, Users, FileText, TrendingUp,
  ClipboardList, Zap, Lightbulb, Sparkles, Calendar, Library, ArrowUpRight,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { ArticleCard } from '../components/ArticleCard'
import { CoverImage } from '../components/CoverImage'
import { EditorialCommittee } from '../components/EditorialCommittee'
import { HeroParticles } from '../components/HeroParticles'
import { HeroShader } from '../components/HeroShader'
import { mountCountUp } from '../animations/countUp'
import { batchReveal } from '../animations/batchReveal'
import './Home.css'

const formatIssueDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) : ''

const STATS = [
  { icon: <BookOpen size={22} strokeWidth={1.5} />, value: 9, label: '期刊文章' },
  { icon: <FileText size={22} strokeWidth={1.5} />, value: 4, label: '内容板块' },
  { icon: <TrendingUp size={22} strokeWidth={1.5} />, value: 6, label: '研究领域' },
  { icon: <Users size={22} strokeWidth={1.5} />, value: 37, label: '编委成员' },
]

const CATEGORIES = [
  { label: '战略与政策', desc: '政策解读与发展趋势', icon: <ClipboardList size={24} strokeWidth={1.5} />, count: 2 },
  { label: '技术与产业', desc: '技术创新与产业动态', icon: <Zap size={24} strokeWidth={1.5} />, count: 2 },
  { label: '方案与思考', desc: '实践案例与经验总结', icon: <Lightbulb size={24} strokeWidth={1.5} />, count: 3 },
  { label: '动态与文化', desc: '团队动态与人物风采', icon: <Sparkles size={24} strokeWidth={1.5} />, count: 2 },
]

export function Home() {
  const { data: issues } = useQuery({ queryKey: ['issues'], queryFn: api.issues.list })
  const { data: featured } = useQuery({ queryKey: ['featured'], queryFn: api.articles.featured })

  const sorted = (issues ?? []).slice().sort((a, b) => {
    const ad = a.published_at ? new Date(a.published_at).getTime() : 0
    const bd = b.published_at ? new Date(b.published_at).getTime() : 0
    return bd - ad
  })
  const latestIssue = sorted[0]
  const otherIssues = sorted.slice(1, 3)

  // Mount count-up tweens on every [data-count-up] element.
  useEffect(() => {
    const stats = Array.from(document.querySelectorAll<HTMLElement>('[data-count-up]'))
    const cleanups = stats.map(el =>
      mountCountUp(el, { to: Number(el.dataset.countUp ?? '0'), duration: 1.2 }),
    )
    return () => cleanups.forEach(c => c())
  }, [])

  // Batch reveal [data-reveal] entries on scroll.
  useEffect(() => {
    const cleanup = batchReveal({ root: document, selector: '[data-reveal]', stagger: 0.08, y: 32 })
    return cleanup
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in-view') }),
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    )
    const attach = () => document.querySelectorAll('.observe:not(.in-view)').forEach(el => observer.observe(el))
    attach()
    const id = window.setTimeout(attach, 50)
    return () => { window.clearTimeout(id); observer.disconnect() }
  }, [featured, issues])

  return (
    <main className="home">
      {/* Hero */}
      <section className="hero">
        <HeroShader />
        <HeroParticles />
        <div className="hero__pattern" aria-hidden="true" />
        <div className="container hero__content">
          <p className="hero__label animate-fade-up" data-reveal>
            <span className="text-en">Hubei Digital Innovation</span>
          </p>
          <h1 className="hero__title animate-fade-up animate-delay-1" data-reveal>
            智领AI荆楚新程<br />
            <span className="hero__title-accent">数绘产业发展新篇</span>
          </h1>
          <p className="hero__subtitle animate-fade-up animate-delay-2" data-reveal>
            湖北数创是湖北数字产业创新研究的内部期刊<br />
            记录数字变革、传播前沿理念、赋能产业升级
          </p>
          <div className="hero__actions animate-fade-up animate-delay-3" data-reveal>
            <Link to="/articles" className="btn btn-primary">阅读期刊 <ArrowRight size={16} /></Link>
            <Link to="/about" className="btn btn-outline">关于我们</Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="section section--secondary">
        <div className="container">
          <div className="stats__grid">
            {STATS.map((s, i) => (
              <div key={i} className="stats__item">
                <div className="stats__icon">{s.icon}</div>
                <div className="stats__value" data-count-up={s.value}>0</div>
                <div className="stats__label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Issues showcase */}
      <section className="section">
        <div className="container">
          <div className="section-header observe">
            <p className="section-label">ISSUES · 期刊系列</p>
            <h2 className="section-title">期刊矩阵</h2>
            <div className="divider" />
            <p className="section-subtitle">每一期记录当下最值得关注的产业话题，构建可持续的产业知识高地</p>
          </div>

          {latestIssue ? (
            <div className="issues-showcase">
              <Link to={`/issues/${latestIssue.slug}`} className="issue-feature card observe animate-fade-up">
                <div className="card__cover issue-feature__cover">
                  <CoverImage src={latestIssue.cover_image} alt={latestIssue.title} aspectRatio="16 / 9" />
                  <span className="issue-feature__badge">最新期刊</span>
                </div>
                <div className="card__body issue-feature__body">
                  {latestIssue.issue_number && (
                    <p className="issue-feature__number"><span className="text-en">ISSUE {latestIssue.issue_number}</span></p>
                  )}
                  <h3 className="card__title">{latestIssue.title}</h3>
                  {latestIssue.description && <p className="issue-feature__desc">{latestIssue.description}</p>}
                  <div className="issue-feature__meta">
                    <span className="issue-feature__meta-item">
                      <Calendar size={14} strokeWidth={1.5} /> {formatIssueDate(latestIssue.published_at)}
                    </span>
                    <span className="issue-feature__meta-item">
                      <FileText size={14} strokeWidth={1.5} /> {latestIssue.article_count} 篇文章
                    </span>
                  </div>
                  <span className="issue-feature__cta">进入期刊 <ArrowUpRight size={16} strokeWidth={2} /></span>
                </div>
              </Link>

              <div className="issues-grid">
                {otherIssues.map((issue, i) => (
                  <Link key={issue.id} to={`/issues/${issue.slug}`}
                    className={`issue-card card observe animate-fade-up animate-delay-${i + 1}`}>
                    <div className="card__cover issue-card__cover">
                      <CoverImage src={issue.cover_image} alt={issue.title} aspectRatio="4 / 3" />
                    </div>
                    <div className="card__body issue-card__body">
                      {issue.issue_number && (
                        <p className="issue-card__number"><span className="text-en">ISSUE {issue.issue_number}</span></p>
                      )}
                      <h4 className="card__title issue-card__title">{issue.title}</h4>
                      <div className="issue-card__meta">
                        <span><Calendar size={12} strokeWidth={1.5} /> {formatIssueDate(issue.published_at)}</span>
                        <span><FileText size={12} strokeWidth={1.5} /> {issue.article_count}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state"><Library size={36} strokeWidth={1.5} /><p>期刊正在筹备中，敬请期待</p></div>
          )}

          <div className="issues-showcase__cta">
            <Link to="/issues" className="btn btn-primary">查看全部期刊 <ArrowRight size={16} /></Link>
          </div>
        </div>
      </section>

      {/* Content Categories */}
      <section className="section section--secondary">
        <div className="container">
          <div className="section-header observe">
            <p className="section-label">CONTENT</p>
            <h2 className="section-title">本期内容</h2>
            <div className="divider" />
            <p className="section-subtitle">按主题分类浏览，构建系统化的产业认知</p>
          </div>
          <div className="grid grid-2 categories-grid">
            {CATEGORIES.map((cat, i) => (
              <Link key={cat.label} to={`/articles?category=${encodeURIComponent(cat.label)}`}
                className={`category-card card observe animate-fade-up animate-delay-${i + 1}`}>
                <div className="category-card__icon">{cat.icon}</div>
                <div className="card__body category-card__body">
                  <h3 className="card__title category-card__title">{cat.label}</h3>
                  <p className="category-card__desc">{cat.desc}</p>
                </div>
                <span className="category-card__count">{cat.count} 篇</span>
              </Link>
            ))}
          </div>
          <div className="categories-cta">
            <Link to="/articles" className="btn btn-primary">查看全部文章 <ArrowRight size={16} /></Link>
          </div>
        </div>
      </section>

      {/* Featured Articles */}
      <section className="section">
        <div className="container">
          <div className="section-header observe">
            <p className="section-label">FEATURED</p>
            <h2 className="section-title">精选文章</h2>
            <div className="divider" />
            <p className="section-subtitle">编辑部精选 · 来自团队内部的深度思考</p>
          </div>
          {(featured ?? []).length === 0 ? (
            <div className="empty-state"><BookOpen size={36} strokeWidth={1.5} /><p>精选文章正在编排中</p></div>
          ) : (
            <div className="grid grid-3 featured-grid">
              {(featured ?? []).map((a, i) => (
                <div key={a.id} className={`observe animate-fade-up animate-delay-${(i % 3) + 1}`}>
                  <ArticleCard article={a} featured />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Editorial Committee — 湖北数创 · 2026 年第 1 期 */}
      <EditorialCommittee />
    </main>
  )
}
