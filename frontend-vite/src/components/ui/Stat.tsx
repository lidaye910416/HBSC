import { type ReactNode } from 'react'

type Trend = 'up' | 'down' | 'flat'

export interface StatProps {
  label: string
  value: ReactNode
  trend?: Trend
  trendValue?: string
  helpText?: string
}

export function Stat({ label, value, trend, trendValue, helpText }: StatProps) {
  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : trend === 'flat' ? '·' : null
  return (
    <div className="ui-stat">
      <div className="ui-stat__label">{label}</div>
      <div className="ui-stat__value">{value}</div>
      {(trend && trendSymbol) && (
        <div className={`ui-stat__trend ui-stat__trend--${trend}`}>
          <span aria-hidden>{trendSymbol}</span>
          {trendValue && <span>{trendValue}</span>}
        </div>
      )}
      {helpText && <div className="ui-stat__help">{helpText}</div>}
    </div>
  )
}