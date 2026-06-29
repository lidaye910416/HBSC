import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, FileText, BookOpen, Image as ImageIcon, ExternalLink, Settings as SettingsIcon, Star } from 'lucide-react'
import { api } from '../../services/api'
import { PageAgentMount } from './PageAgentMount'
import { pageEnterAnimation, sidebarAnimations } from './animations'
import './AdminLayout.css'

export function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const contentRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const handleLogout = async () => {
    try {
      await api.auth.logout()
    } catch {
      // 忽略：登出失败也允许本地跳转
    }
    navigate('/admin/login', { replace: true })
  }

  // Page-enter animation: re-run on every route change. The cleanup function
  // from pageEnterAnimation reverts the context so the previous tween doesn't
  // pile up on rapid navigation.
  useEffect(() => {
    const cleanup = pageEnterAnimation(contentRef.current)
    return cleanup
  }, [location.pathname])

  // Sidebar entrance stagger — runs once on mount.
  useEffect(() => {
    const cleanup = sidebarAnimations(sidebarRef.current)
    return cleanup
  }, [])

  return (
    <div className="admin-layout">
      <PageAgentMount />
      <aside className="admin-sidebar" ref={sidebarRef}>
        <div className="admin-sidebar__sticky">
          <div className="admin-sidebar__brand">
            <h2>湖北数创 CMS</h2>
            <p>内容管理后台</p>
          </div>
          <nav>
            <NavLink to="/admin" end>
              <LayoutDashboard size={18} /> 概览
            </NavLink>
            <NavLink to="/admin/articles">
              <FileText size={18} /> 文章
            </NavLink>
            <NavLink to="/admin/articles/featured" end>
              <Star size={18} /> 精选管理
            </NavLink>
            <NavLink to="/admin/journals">
              <BookOpen size={18} /> 期刊
            </NavLink>
            <NavLink to="/admin/media">
              <ImageIcon size={18} /> 媒体库
            </NavLink>
            <NavLink to="/admin/settings">
              <SettingsIcon size={18} /> 设置
            </NavLink>
            <a href="/" target="_blank" rel="noreferrer">
              <ExternalLink size={18} /> 查看公开站
            </a>
          </nav>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <h1>内容管理后台</h1>
          <div className="admin-header__user">
            <button className="admin-logout" onClick={handleLogout}>退出登录</button>
          </div>
        </header>
        <main className="admin-content" ref={contentRef}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
