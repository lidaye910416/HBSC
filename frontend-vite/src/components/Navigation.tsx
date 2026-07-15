import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Menu, X, ChevronDown, BookOpen } from 'lucide-react'
import { api } from '../services/api'
import './Navigation.css'

const navLinks = [
  { label: '首页', path: '/' },
  { label: '关于我们', path: '/about' },
]

export function Navigation() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [issuesClosing, setIssuesClosing] = useState(false)
  const location = useLocation()
  const issuesRef = useRef<HTMLDivElement | null>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  const openIssues = () => {
    clearCloseTimeout()
    setIssuesClosing(false)
    setIssuesOpen(true)
  }

  const scheduleCloseIssues = () => {
    clearCloseTimeout()
    setIssuesClosing(true)
    closeTimeoutRef.current = setTimeout(() => {
      setIssuesOpen(false)
      setIssuesClosing(false)
      closeTimeoutRef.current = null
    }, 150)
  }

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

  useEffect(() => {
    setMobileOpen(false)
    setIssuesOpen(false)
    setIssuesClosing(false)
    clearCloseTimeout()
  }, [location])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!issuesRef.current) return
      if (!issuesRef.current.contains(e.target as Node)) setIssuesOpen(false)
    }
    if (issuesOpen) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [issuesOpen])

  useEffect(() => {
    return () => clearCloseTimeout()
  }, [])

  const isIssuesActive = location.pathname.startsWith('/issues')
  const isArticlesActive = location.pathname.startsWith('/articles')
  const isLabsActive = location.pathname.startsWith('/labs')

  return (
    <nav className="nav">
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
            onMouseEnter={openIssues}
            onMouseLeave={scheduleCloseIssues}
          >
            <button
              type="button"
              className={`nav__link nav__dropdown-trigger ${isIssuesActive ? 'nav__link--active' : ''}`}
              aria-expanded={issuesOpen}
              aria-haspopup="true"
              onClick={() => (issuesOpen ? scheduleCloseIssues() : openIssues())}
            >
              期刊 <ChevronDown size={14} strokeWidth={1.75} className={`nav__caret ${issuesOpen ? 'is-open' : ''}`} />
            </button>

            {issuesOpen && (
              <div
                className={`nav__dropdown-menu ${issuesClosing ? 'nav__dropdown-menu--closing' : ''}`}
                role="menu"
              >
                <Link to="/issues" className="nav__dropdown-head" role="menuitem">
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
                        className={`nav__dropdown-item ${location.pathname === `/issues/${issue.slug}` ? 'is-active' : ''}`}
                        role="menuitem"
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
            )}
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
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? '关闭菜单' : '打开菜单'}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="nav__mobile">
          {navLinks.map(link => (
            <Link
              key={link.path}
              to={link.path}
              className={`nav__mobile-link ${location.pathname === link.path ? 'active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
          <Link to="/issues" className={`nav__mobile-link ${isIssuesActive ? 'active' : ''}`}>
            期刊
          </Link>
          {sortedIssues.slice(0, 4).map(issue => (
            <Link
              key={issue.id}
              to={`/issues/${issue.slug}`}
              className="nav__mobile-link nav__mobile-sublink"
            >
              · {issue.title}
            </Link>
          ))}
          <Link
            to="/articles"
            className={`nav__mobile-link ${isArticlesActive ? 'active' : ''}`}
          >
            所有文章
          </Link>
          <Link
            to="/labs"
            className={`nav__mobile-link ${isLabsActive ? 'active' : ''}`}
          >
            数创实验室
          </Link>
        </div>
      )}
    </nav>
  )
}
