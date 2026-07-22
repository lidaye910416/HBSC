import { ArrowUpRight, Bot } from 'lucide-react'
import styles from './PageAgentFab.module.css'

export function PageAgentFab({
  onClick,
  'data-state': dataState,
}: {
  onClick: () => void
  /** Animation stage: 'shrinking' (panel opening) or 'expanding' (panel closing). */
  'data-state'?: 'shrinking' | 'expanding'
}) {
  return (
    <button
      type="button"
      className={styles.fab}
      onClick={onClick}
      aria-label="打开数创智伴 · 读懂本页、协助操作、或生成播客"
      title="数创智伴 · 读懂 · 操作 · 播一下"
      data-testid="page-agent-fab"
      data-state={dataState}
      // When the FAB is mid-morph into / out of the panel it has no
      // pointer affordance and shouldn't be reachable by Tab focus.
      inert={Boolean(dataState)}
    >
      <span className={styles.iconWrap} aria-hidden="true">
        <Bot size={18} />
        <span className={styles.statusDot} />
      </span>
      <span className={styles.text}>
        <span className={styles.textMain}>数创智伴</span>
        <span className={styles.textSub}>读懂 · 操作 · 播一下</span>
      </span>
      <ArrowUpRight size={15} className={styles.arrow} aria-hidden="true" />
    </button>
  )
}
