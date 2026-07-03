import { Sparkles } from 'lucide-react'
import styles from './PageAgentFab.module.css'

export function PageAgentFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.fab}
      onClick={onClick}
      aria-label="打开 page-agent AI 助手"
      title="AI 导航 · 问我或让他操作页面"
      data-testid="page-agent-fab"
    >
      <span className={styles.iconWrap} aria-hidden="true">
        <Sparkles size={18} />
      </span>
      <span className={styles.text}>
        <span className={styles.textMain}>AI 导航</span>
        <span className={styles.textSub}>问我 · 让他操作</span>
      </span>
    </button>
  )
}
