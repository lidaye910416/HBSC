import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, FileText, BookOpen, Image as ImageIcon, ExternalLink, Settings as SettingsIcon } from 'lucide-react'
import { api } from '../../services/api'
import './AdminLayout.css'

export function AdminLayout() {
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      await api.auth.logout()
    } catch {
      // 忽略：登出失败也允许本地跳转
    }
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
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
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <h1>内容管理后台</h1>
          <div className="admin-header__user">
            <button className="admin-logout" onClick={handleLogout}>退出登录</button>
          </div>
        </header>
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
