import { type ReactNode } from 'react'

export type Status = 'published' | 'draft' | 'archived' | 'featured'

const LABEL: Record<Status, string> = {
  published: '已发布',
  draft: '草稿',
  archived: '已归档',
  featured: '精选',
}

export interface StatusBadgeProps {
  status: Status
  children?: ReactNode  // 覆盖默认 label
}

export function StatusBadge({ status, children }: StatusBadgeProps) {
  return (
    <span className={`ui-status-badge ui-status-badge--${status}`}>
      {children ?? LABEL[status]}
    </span>
  )
}