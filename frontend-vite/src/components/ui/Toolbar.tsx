import { type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { Search } from 'lucide-react'

export function Toolbar({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-toolbar ${className}`} {...rest}>{children}</div>
}

export function ToolbarGroup({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-toolbar__group ${className}`} {...rest}>{children}</div>
}

export function ToolbarInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="ui-toolbar__input" {...props} />
}

export function ToolbarSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="ui-toolbar__select" {...props} />
}

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="ui-toolbar__search">
      <Search size={14} aria-hidden />
      <input className="ui-toolbar__search-input" placeholder="搜索…" {...props} />
    </div>
  )
}