import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useMatch } from 'react-router-dom'
import {
  LayoutDashboard, FileText, BookOpen, Image as ImageIcon,
  ExternalLink, Settings as SettingsIcon, Star, Search, Bell, LogOut,
} from 'lucide-react'
import { api } from '../../services/api'
import { pageEnterAnimation, sidebarAnimations } from './animations'
import { IconButton } from '../ui/IconButton'
import { Breadcrumb, type BreadcrumbItem } from '../ui'
import './AdminLayout.css'

type NavItem = {
  to: string
  end?: boolean
  label: string
  icon: React.ReactNode
}

const NAV: NavItem[] = [
  { to: '/admin', end: true, label: '概览', icon: <LayoutDashboard size={18} /> },
  { to: '/admin/articles', label: '文章', icon: <FileText size={18} /> },
  { to: '/admin/articles/featured', end: true, label: '精选管理', icon: <Star size={18} /> },
  { to: '/admin/journals', label: '期刊', icon: <BookOpen size={18} /> },
  { to: '/admin/media', label: '媒体库', icon: <ImageIcon size={18} /> },
  { to: '/admin/settings', label: '设置', icon: <SettingsIcon size={18} /> },
]

function useBreadcrumbFromPath(): BreadcrumbItem[] {
  const match = useMatch('/admin/*')
  const items: BreadcrumbItem[] = [{ label: '后台', to: '/admin' }]
  if (match?.pathname.includes('/articles/featured')) {
    items.push({ label: '文章', to: '/admin/articles' })
    items.push({ label: '精选管理' })
  } else if (match?.pathname.includes('/articles/new')) {
    items.push({ label: '文章', to: '/admin/articles' })
    items.push({ label: '新建' })
  } else if (match?.pathname.match(/\/articles\/\d+/)) {
    items.push({ label: '文章', to: '/admin/articles' })
    items.push({ label: '编辑' })
  } else if (match?.pathname.includes('/articles')) {
    items.push({ label: '文章' })
  } else if (match?.pathname.match(/\/journals\/new/)) {
    items.push({ label: '期刊', to: '/admin/journals' })
    items.push({ label: '新建' })
  } else if (match?.pathname.match(/\/journals\/\d+/)) {
    items.push({ label: '期刊', to: '/admin/journals' })
    items.push({ label: '详情' })
  } else if (match?.pathname.includes('/journals')) {
    items.push({ label: '期刊' })
  } else if (match?.pathname.includes('/media')) {
    items.push({ label: '媒体库' })
  } else if (match?.pathname.includes('/settings')) {
    items.push({ label: '设置' })
  }
  return items
}

export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const contentRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const crumbs = useBreadcrumbFromPath()

  const handleLogout = async () => {
    try { await api.auth.logout() } catch { /* noop */ }
    navigate('/admin/login', { replace: true })
  }

  useEffect(() => {
    return pageEnterAnimation(contentRef.current)
  }, [location.pathname])

  useEffect(() => {
    return sidebarAnimations(sidebarRef.current)
  }, [])

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar" ref={sidebarRef}>
        <div className="admin-sidebar__sticky">
          <div className="admin-sidebar__brand">
            <span className="admin-sidebar__mark" aria-hidden />
            <span className="admin-sidebar__title">湖北数创 CMS</span>
            <span className="admin-sidebar__sub">内容管理后台</span>
          </div>
          <nav className="admin-sidebar__nav">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `admin-sidebar__link${isActive ? ' is-active' : ''}`
                }
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="admin-sidebar__link admin-sidebar__external"
            >
              <ExternalLink size={18} />
              <span>查看公开站</span>
            </a>
          </nav>
          <div className="admin-sidebar__foot">
            <button
              type="button"
              className="admin-sidebar__logout"
              onClick={handleLogout}
            >
              <LogOut size={16} />
              <span>退出</span>
            </button>
          </div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <div className="admin-header__left">
            <Breadcrumb items={crumbs} variant="light" />
          </div>
          <div className="admin-header__right">
            <div className="admin-header__search">
              <Search size={14} aria-hidden />
              <input placeholder="搜索 (⌘K)…" aria-label="搜索" />
            </div>
            <IconButton label="通知" icon={<Bell size={18} />} variant="ghost" />
          </div>
        </header>
        <main className="admin-content" ref={contentRef}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}