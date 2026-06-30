import { type ReactNode } from 'react'
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  breadcrumb?: BreadcrumbItem[]
  actions?: ReactNode
}

export function PageHeader({ title, description, breadcrumb, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__left">
        {breadcrumb && <Breadcrumb items={breadcrumb} variant="light" />}
        <h1 className="ui-page-header__title">{title}</h1>
        {description && <p className="ui-page-header__desc">{description}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  )
}