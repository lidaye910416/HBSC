import { Sparkles } from 'lucide-react'
import styles from './PageAgentFab.module.css'

export function PageAgentFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.fab}
      onClick={onClick}
      aria-label="打开 page-agent AI 助手"
      data-testid="page-agent-fab"
    >
      <Sparkles size={22} aria-hidden="true" />
      <span className={styles.tooltip} role="tooltip">AI 助手 · 湖北数创</span>
      <span className={styles.label}>打开 AI 助手</span>
    </button>
  )
}