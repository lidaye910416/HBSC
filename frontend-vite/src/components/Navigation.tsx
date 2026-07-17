import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Menu, X, ChevronDown, BookOpen } from 'lucide-react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { api } from '../services/api'
import { motionAllowed } from '../animations/reducedMotion'
import './Navigation.css'

const navLinks = [
  { label: '首页', path: '/' },
  { label: '关于我们', path: '/about' },
]

export function Navigation() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const location = useLocation()
  const containerRef = useRef<HTMLElement | null>(null)
  const issuesRef = useRef<HTMLDivElement | null>(null)

  const { data: issues } = useQuery({
    queryKey: ['issues'],
    queryFn: api.issues.list,
    staleTime: 5 * 60 * 1000,
  })

  const sortedIssues = (issues ?? [])
    .slice()
    .sort((a, b) => {
      const ad = a.published_at ? new Date(a.published_at).getTime() : 0
      const bd = b.published_at ? new Date(b.published_at).getTime() : 0
      return bd - ad
    })

  // Single paused timeline per panel: play() opens, reverse() closes.
  // The same timeline is reused for every enter/exit so rapid hover/click
  // never leaves a stuck half-state. Both panels stay mounted (visibility
  // toggled by GSAP autoAlpha) so reverse() always has a target to animate.
  const dropdownTlRef = useRef<gsap.core.Timeline | null>(null)
  const mobileTlRef = useRef<gsap.core.Timeline | null>(null)
  const dropdownMenuRef = useRef<HTMLDivElement | null>(null)
  const mobileMenuRef = useRef<HTMLDivElement | null>(null)

  useGSAP(
    () => {
      const motion = motionAllowed()
      const dropdownMenu = dropdownMenuRef.current
      const mobileMenu = mobileMenuRef.current

      // Reduced motion: skip the timeline entirely. We still keep the panels
      // mounted and just snap visibility via gsap.set on every state change.
      if (!motion) {
        if (dropdownMenu) gsap.set(dropdownMenu, { autoAlpha: issuesOpen ? 1 : 0, y: 0 })
        if (mobileMenu) gsap.set(mobileMenu, { autoAlpha: mobileOpen ? 1 : 0, y: 0 })
        return
      }

      // The dropdown panels are always mounted; we only animate the panel's
      // own autoAlpha + y. Items inside rely on the parent's visibility/opacity
      // (CSS rule: child opacity contributes through parent's effective
      // opacity rendering) and inherit the open/close naturally. We
      // deliberately do NOT use `.from(items, { autoAlpha: 0 })` here — that
      // pattern pins an inline opacity:0 on each item at timeline build time
      // and, because the timeline is paused then played later (after a state
      // flip), GSAP can leave items stuck at the start frame if any prior
      // from() instance hasn't fully unwound (e.g. StrictMode double-mount,
      // dependency-driven re-runs).
      if (dropdownMenu) {
        gsap.set(dropdownMenu, { autoAlpha: 0, y: -8 })
        const tl = gsap
          .timeline({ paused: true, defaults: { ease: 'power2.out' } })
          .to(dropdownMenu, { autoAlpha: 1, y: 0, duration: 0.22, overwrite: 'auto' }, 0)
        dropdownTlRef.current = tl
      }

      if (mobileMenu) {
        gsap.set(mobileMenu, { autoAlpha: 0, y: -12 })
        const tl = gsap
          .timeline({ paused: true, defaults: { ease: 'power2.out' } })
          .to(mobileMenu, { autoAlpha: 1, y: 0, duration: 0.25, overwrite: 'auto' }, 0)
        mobileTlRef.current = tl
      }
    },
    { scope: containerRef, dependencies: [sortedIssues] },
  )

  // Drive timelines from state. contextSafe keeps handlers valid after the
  // gsap.context reverts in StrictMode.
  useEffect(() => {
    if (!motionAllowed()) {
      if (dropdownMenuRef.current)
        gsap.set(dropdownMenuRef.current, { autoAlpha: issuesOpen ? 1 : 0, y: 0 })
      return
    }
    if (issuesOpen) dropdownTlRef.current?.play()
    else dropdownTlRef.current?.reverse()
  }, [issuesOpen])

  useEffect(() => {
    if (!motionAllowed()) {
      if (mobileMenuRef.current)
        gsap.set(mobileMenuRef.current, { autoAlpha: mobileOpen ? 1 : 0, y: 0 })
      return
    }
    if (mobileOpen) mobileTlRef.current?.play()
    else mobileTlRef.current?.reverse()
  }, [mobileOpen])

  // Close menus on route change so we never carry a half-open panel across
  // navigation. Reverse runs naturally; no setTimeout involved.
  useEffect(() => {
    setMobileOpen(false)
    setIssuesOpen(false)
  }, [location.pathname])

  // Outside click + Escape close. Both panels share the same logic.
  useEffect(() => {
    if (!issuesOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (!issuesRef.current) return
      if (!issuesRef.current.contains(e.target as Node)) setIssuesOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIssuesOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [issuesOpen])

  const isIssuesActive = location.pathname.startsWith('/issues')
  const isArticlesActive = location.pathname.startsWith('/articles')
  const isLabsActive = location.pathname.startsWith('/labs')

  // Click toggles the dropdown so users can see the latest 2 issues at a
  // glance and jump directly to either. Hover still opens the same panel
  // for trackpad / mouse-only users.
  const formatIssueDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) : ''

  return (
    <nav className="nav" ref={containerRef}>
      <div className="nav__inner container">
        <Link to="/" className="nav__logo" aria-label="返回首页">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="28" height="28" rx="6" fill="rgba(37, 99, 235, 0.12)" stroke="#2563eb" strokeWidth="1.5"/>
            <circle cx="16" cy="16" r="6" stroke="#2563eb" strokeWidth="1.5"/>
            <circle cx="16" cy="16" r="2" fill="#2563eb"/>
          </svg>
          <span>湖北数创</span>
        </Link>

        <div className="nav__links">
          {navLinks.map(link => (
            <Link
              key={link.path}
              to={link.path}
              className={`nav__link ${location.pathname === link.path ? 'nav__link--active' : ''}`}
            >
              {link.label}
            </Link>
          ))}

          <div
            ref={issuesRef}
            className={`nav__dropdown ${isIssuesActive || issuesOpen ? 'nav__dropdown--open' : ''}`}
            onMouseEnter={() => setIssuesOpen(true)}
            onMouseLeave={() => setIssuesOpen(false)}
          >
            <button
              type="button"
              className={`nav__link nav__dropdown-trigger ${isIssuesActive ? 'nav__link--active' : ''}`}
              aria-expanded={issuesOpen}
              aria-haspopup="true"
              aria-controls="nav-issues-menu"
              aria-label="期刊 — 显示最新两期可跳转"
              onClick={() => setIssuesOpen(v => !v)}
            >
              期刊 <ChevronDown size={14} strokeWidth={1.75} className={`nav__caret ${issuesOpen ? 'is-open' : ''}`} />
            </button>

            <div
              id="nav-issues-menu"
              ref={dropdownMenuRef}
              data-nav-dropdown
              className="nav__dropdown-menu"
              role="menu"
              aria-hidden={!issuesOpen}
              inert={!issuesOpen}
            >
              <div className="nav__dropdown-section-label">
                最新两期 · 快速跳转
              </div>
              <div className="nav__dropdown-latest">
                {sortedIssues.length === 0 ? (
                  <div className="nav__dropdown-empty">暂无期刊</div>
                ) : (
                  sortedIssues.slice(0, 2).map((issue, i) => (
                    <Link
                      key={issue.id}
                      to={`/issues/${issue.slug}`}
                      data-nav-dropdown-item
                      data-issue-index={i}
                      className={`nav__dropdown-card ${i === 0 ? 'is-latest' : ''} ${location.pathname === `/issues/${issue.slug}` ? 'is-active' : ''}`}
                      role="menuitem"
                      tabIndex={issuesOpen ? 0 : -1}
                      onClick={() => setIssuesOpen(false)}
                    >
                      {issue.cover_image ? (
                        <img
                          src={issue.cover_image}
                          alt=""
                          className="nav__dropdown-card__cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="nav__dropdown-card__cover nav__dropdown-card__cover--placeholder" aria-hidden="true">
                          <BookOpen size={20} strokeWidth={1.5} />
                        </div>
                      )}
                      <div className="nav__dropdown-card__body">
                        {issue.issue_number && (
                          <span className="nav__dropdown-card__number">第 {issue.issue_number} 期</span>
                        )}
                        <span className="nav__dropdown-card__title">{issue.title}</span>
                        {issue.published_at && (
                          <span className="nav__dropdown-card__date">
                            {formatIssueDate(issue.published_at)}
                          </span>
                        )}
                      </div>
                    </Link>
                  ))
                )}
              </div>
              <Link
                to="/issues"
                className="nav__dropdown-foot"
                role="menuitem"
                tabIndex={issuesOpen ? 0 : -1}
                onClick={() => setIssuesOpen(false)}
              >
                <BookOpen size={14} strokeWidth={1.75} />
                查看全部期刊档案
              </Link>
            </div>
          </div>

          <Link
            to="/articles"
            className={`nav__link ${isArticlesActive ? 'nav__link--active' : ''}`}
          >
            所有文章
          </Link>

          <Link
            to="/labs"
            className={`nav__link ${isLabsActive ? 'nav__link--active' : ''}`}
          >
            数创实验室
          </Link>
        </div>

        <div className="nav__actions">
          <Link to="/search" className="nav__icon-btn" aria-label="搜索">
            <Search size={18} strokeWidth={1.5} />
          </Link>
          <button
            className="nav__mobile-toggle"
            onClick={() => setMobileOpen(v => !v)}
            aria-label={mobileOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={mobileOpen}
            aria-controls="nav-mobile-menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      <div
        id="nav-mobile-menu"
        ref={mobileMenuRef}
        data-nav-mobile
        className="nav__mobile"
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
      >
        {navLinks.map(link => (
          <Link
            key={link.path}
            to={link.path}
            data-nav-mobile-item
            className={`nav__mobile-link ${location.pathname === link.path ? 'active' : ''}`}
            tabIndex={mobileOpen ? 0 : -1}
          >
            {link.label}
          </Link>
        ))}
        <Link
          to="/issues"
          data-nav-mobile-item
          className={`nav__mobile-link ${isIssuesActive ? 'active' : ''}`}
          tabIndex={mobileOpen ? 0 : -1}
        >
          期刊
        </Link>
        {sortedIssues.slice(0, 4).map(issue => (
          <Link
            key={issue.id}
            to={`/issues/${issue.slug}`}
            data-nav-mobile-item
            className="nav__mobile-link nav__mobile-sublink"
            tabIndex={mobileOpen ? 0 : -1}
          >
            · {issue.title}
          </Link>
        ))}
        <Link
          to="/articles"
          data-nav-mobile-item
          className={`nav__mobile-link ${isArticlesActive ? 'active' : ''}`}
          tabIndex={mobileOpen ? 0 : -1}
        >
          所有文章
        </Link>
        <Link
          to="/labs"
          data-nav-mobile-item
          className={`nav__mobile-link ${isLabsActive ? 'active' : ''}`}
          tabIndex={mobileOpen ? 0 : -1}
        >
          数创实验室
        </Link>
      </div>
    </nav>
  )
}