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
      const dropdownItems = containerRef.current?.querySelectorAll<HTMLElement>(
        '[data-nav-dropdown-item]',
      )
      const mobileItems = containerRef.current?.querySelectorAll<HTMLElement>(
        '[data-nav-mobile-item]',
      )

      // Reduced motion: skip the timeline entirely. We still keep the panels
      // mounted and just snap visibility via gsap.set on every state change.
      if (!motion) {
        if (dropdownMenu) gsap.set(dropdownMenu, { autoAlpha: issuesOpen ? 1 : 0, y: 0 })
        if (mobileMenu) gsap.set(mobileMenu, { autoAlpha: mobileOpen ? 1 : 0, y: 0 })
        return
      }

      if (dropdownMenu && dropdownItems) {
        gsap.set(dropdownMenu, { autoAlpha: 0, y: -8 })
        const tl = gsap
          .timeline({ paused: true, defaults: { ease: 'power2.out' } })
          .to(dropdownMenu, { autoAlpha: 1, y: 0, duration: 0.22, overwrite: 'auto' }, 0)
          .from(
            dropdownItems,
            { y: -5, autoAlpha: 0, stagger: 0.035, duration: 0.28, overwrite: 'auto' },
            '<0.05',
          )
        dropdownTlRef.current = tl
      }

      if (mobileMenu && mobileItems && mobileItems.length) {
        gsap.set(mobileMenu, { autoAlpha: 0, y: -12 })
        const tl = gsap
          .timeline({ paused: true, defaults: { ease: 'power2.out' } })
          .to(mobileMenu, { autoAlpha: 1, y: 0, duration: 0.25, overwrite: 'auto' }, 0)
          .from(
            mobileItems,
            { y: -6, autoAlpha: 0, stagger: 0.04, duration: 0.3, overwrite: 'auto' },
            '<0.06',
          )
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
              <Link to="/issues" className="nav__dropdown-head" role="menuitem" tabIndex={issuesOpen ? 0 : -1}>
                <div className="nav__dropdown-head-icon"><BookOpen size={14} strokeWidth={1.75} /></div>
                <div className="nav__dropdown-head-text">
                  <strong>全部期刊</strong>
                  <span>查看完整期刊档案</span>
                </div>
              </Link>

              <div className="nav__dropdown-list">
                {sortedIssues.length === 0 ? (
                  <div className="nav__dropdown-empty">暂无期刊</div>
                ) : (
                  sortedIssues.slice(0, 6).map(issue => (
                    <Link
                      key={issue.id}
                      to={`/issues/${issue.slug}`}
                      data-nav-dropdown-item
                      className={`nav__dropdown-item ${location.pathname === `/issues/${issue.slug}` ? 'is-active' : ''}`}
                      role="menuitem"
                      tabIndex={issuesOpen ? 0 : -1}
                    >
                      <span className="nav__dropdown-item-title">{issue.title}</span>
                      {issue.issue_number && (
                        <span className="nav__dropdown-item-meta">{issue.issue_number}</span>
                      )}
                    </Link>
                  ))
                )}
              </div>
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