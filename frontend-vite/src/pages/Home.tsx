import { useEffect, useRef } from 'react'
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
import { HeroImmersive } from '../components/hero/HeroImmersive'
import { HeroParticles } from '../components/HeroParticles'
import { HeroShader } from '../components/HeroShader'
import { mountCountUp } from '../animations/countUp'
import { batchReveal } from '../animations/batchReveal'
import { motionAllowed } from '../animations/reducedMotion'
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
  const heroSectionRef = useRef<HTMLElement | null>(null)

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

  // Per-element pointer parallax on the hero text. Each layer drifts with its
  // own magnitude so the title moves most and the label least, producing a
  // sense of depth. Also feeds the cursor position into CSS custom properties
  // for the radial halo under the content. Bounded to ~8px so nothing reflows.
  useEffect(() => {
    const hero = heroSectionRef.current
    if (!hero) return
    if (!motionAllowed()) return

    // Each layer has different magnitude
    const layers = [
      { selector: '.hero__label',    maxX: 4, maxY: 3 },
      { selector: '.hero__title',    maxX: 8, maxY: 5 },
      { selector: '.hero__subtitle', maxX: 5, maxY: 4 },
      { selector: '.hero__actions',  maxX: 6, maxY: 6 },
    ]
    const elements = layers.map(l => ({
      el: hero.querySelector<HTMLElement>(l.selector),
      maxX: l.maxX,
      maxY: l.maxY,
      curX: 0,
      curY: 0,
      targetX: 0,
      targetY: 0,
    })).filter(x => x.el !== null)

    let raf = 0
    const onMove = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect()
      const px = ((e.clientX - r.left) / r.width) * 100
      const py = ((e.clientY - r.top) / r.height) * 100
      hero.style.setProperty('--cursor-x', `${px.toFixed(2)}%`)
      hero.style.setProperty('--cursor-y', `${py.toFixed(2)}%`)
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1
      for (const layer of elements) {
        layer.targetX = Math.max(-1, Math.min(1, nx)) * layer.maxX
        layer.targetY = Math.max(-1, Math.min(1, ny)) * layer.maxY
      }
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const tick = () => {
      raf = 0
      let stillMoving = false
      for (const layer of elements) {
        layer.curX += (layer.targetX - layer.curX) * 0.12
        layer.curY += (layer.targetY - layer.curY) * 0.12
        if (layer.el) {
          layer.el.style.transform = `translate3d(${layer.curX.toFixed(2)}px, ${layer.curY.toFixed(2)}px, 0)`
        }
        if (Math.abs(layer.targetX - layer.curX) > 0.05 || Math.abs(layer.targetY - layer.curY) > 0.05) {
          stillMoving = true
        }
      }
      if (stillMoving) raf = requestAnimationFrame(tick)
    }

    hero.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      hero.removeEventListener('pointermove', onMove)
      if (raf) cancelAnimationFrame(raf)
      for (const layer of elements) {
        if (layer.el) layer.el.style.transform = ''
      }
    }
  }, [])

  // Button magnetic pull: when the cursor enters a button's ~80px zone, the
  // button eases toward the pointer (weaker on Y than X) then springs back.
  useEffect(() => {
    const hero = heroSectionRef.current
    if (!hero) return
    if (!motionAllowed()) return
    const buttons = Array.from(hero.querySelectorAll<HTMLElement>('.btn'))
    let raf = 0
    const states = new Map<HTMLElement, { tx: number; ty: number; cx: number; cy: number; inZone: boolean }>()

    const onMove = (e: PointerEvent) => {
      for (const btn of buttons) {
        const br = btn.getBoundingClientRect()
        const cx = br.left + br.width / 2
        const cy = br.top + br.height / 2
        const dx = e.clientX - cx
        const dy = e.clientY - cy
        // Magnetic zone: within ~80px of button center
        const dist = Math.sqrt(dx * dx + dy * dy)
        const inZone = dist < 80
        let state = states.get(btn)
        if (!state) {
          state = { tx: 0, ty: 0, cx: 0, cy: 0, inZone: false }
          states.set(btn, state)
        }
        state.inZone = inZone
        if (inZone) {
          // Pull toward cursor (weaker than full snap, ~30% strength)
          state.tx = dx * 0.3
          state.ty = dy * 0.2
        } else {
          state.tx = 0
          state.ty = 0
        }
      }
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const tick = () => {
      raf = 0
      for (const [btn, s] of states) {
        s.cx += (s.tx - s.cx) * 0.18
        s.cy += (s.ty - s.cy) * 0.18
        btn.style.transform = `translate3d(${s.cx.toFixed(2)}px, ${s.cy.toFixed(2)}px, 0)`
      }
      // Keep ticking as long as any button is moving or in zone
      raf = requestAnimationFrame(tick)
    }

    const onLeave = () => {
      for (const [, s] of states) {
        s.inZone = false
        s.tx = 0
        s.ty = 0
      }
    }

    hero.addEventListener('pointermove', onMove, { passive: true })
    hero.addEventListener('pointerleave', onLeave, { passive: true })
    return () => {
      hero.removeEventListener('pointermove', onMove)
      hero.removeEventListener('pointerleave', onLeave)
      if (raf) cancelAnimationFrame(raf)
      for (const btn of buttons) {
        btn.style.transform = ''
      }
    }
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
      <section className="hero" id="hero" aria-labelledby="hero-title" ref={heroSectionRef}>
        {/* B3 fix: restore HeroShader + HeroParticles as the multiply-blend noise
            base layer; HeroImmersive overlays the gold cluster on top. Without
            these, the WebGL path loses the original "editorial" texture and the
            page feels flatter. They remain in HeroFallback for reduced-motion
            users too. */}
        <HeroShader />
        <HeroParticles />
        <HeroImmersive heroRef={heroSectionRef} />
        <div className="hero__pattern" aria-hidden="true" />
        <div className="container hero__content">
          {/* Note: animate-fade-up is intentionally omitted here. That class uses
              animation-fill-mode: both, which persists a `transform: translateY(0)`
              at cascade level 5 (animation declarations) and overrides inline
              transforms at level 9, so per-element mouse parallax can't take
              effect. The data-reveal gsap batch reveal (Home.tsx useEffect below)
              still drives the entrance fade-up — it sets inline transform during
              the tween and clears it afterwards, leaving these elements free to
              receive parallax transforms on pointermove. */}
          <p className="hero__label" data-reveal>
            <span className="text-en">Hubei Digital Innovation</span>
          </p>
          <h1 id="hero-title" className="hero__title" data-reveal>
            智领AI荆楚新程<br />
            <span className="hero__title-accent">数绘产业发展新篇</span>
          </h1>
          <p className="hero__subtitle" data-reveal>
            湖北数创是湖北数字产业创新研究的内部期刊<br />
            记录数字变革、传播前沿理念、赋能产业升级
          </p>
          <div className="hero__actions" data-reveal>
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
