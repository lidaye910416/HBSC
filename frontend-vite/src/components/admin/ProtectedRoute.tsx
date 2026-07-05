import { Navigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { api } from '../../services/api'

/**
 * @deprecated 改用基于 Cookie 的会话（/api/auth/me）。保留导出仅为兼容旧调用方，
 * 实际不再读写 localStorage。
 */
export const TOKEN_KEY = 'admin_token'

/**
 * @deprecated 不再使用 localStorage token。
 */
export function getAdminToken(): string | null {
  return null
}

/**
 * @deprecated 不再使用 localStorage token。
 */
export function setAdminToken(_token: string): void {
  // no-op
}

/**
 * @deprecated 不再使用 localStorage token。
 */
export function clearAdminToken(): void {
  // no-op
}

interface Props {
  children: ReactNode
}

export function ProtectedRoute({ children }: Props) {
  const location = useLocation()
  const { isLoading, isError } = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: api.auth.me,
    retry: false,
    staleTime: 0,
  })

  if (isLoading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--admin-text-2)' }}>正在验证登录状态…</div>
  }

  if (isError) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
