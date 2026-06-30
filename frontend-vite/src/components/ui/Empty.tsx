import { type ReactNode } from 'react'
import { Inbox } from 'lucide-react'

export interface EmptyProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function Empty({ icon, title, description, action }: EmptyProps) {
  return (
    <div className="ui-empty" role="status">
      <div className="ui-empty__icon">{icon ?? <Inbox size={40} strokeWidth={1.25} />}</div>
      <h3 className="ui-empty__title">{title}</h3>
      {description && <p className="ui-empty__desc">{description}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  )
}