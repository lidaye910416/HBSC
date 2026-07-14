// frontend-vite/src/labs/LabCard.tsx
import { Link } from 'react-router-dom'
import type { LabEntry } from './types'

interface LabCardProps {
  lab: LabEntry
}

export function LabCard({ lab }: LabCardProps) {
  const isActive = lab.status === 'active'
  const cardClass = [
    'lab-card',
    isActive ? 'lab-card--featured' : 'lab-card--disabled',
  ].join(' ')

  return (
    <article
      className={cardClass}
      data-testid="lab-card"
      data-lab-id={lab.id}
    >
      {isActive ? null : (
        <span className="lab-status">COMING SOON</span>
      )}
      <div className="lab-icon" aria-hidden="true">{lab.icon}</div>
      <h3 className="lab-title">{lab.title}</h3>
      <div className="lab-subtitle">{lab.subtitle}</div>

      {isActive && lab.id === 'minicast' ? (
        <div className="lab-preview" aria-hidden="true">
          <div className="lab-waveform">
            <span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>
      ) : null}

      <p className="lab-desc">{lab.description}</p>

      <div className="lab-tags">
        {lab.tags.map((tag) => (
          <span key={tag} className="lab-tag">{tag}</span>
        ))}
      </div>

      {isActive ? (
        <Link to="/labs/minicast" className="lab-cta">
          开始使用 →
        </Link>
      ) : (
        <span className="lab-cta" role="status">敬请期待</span>
      )}
    </article>
  )
}