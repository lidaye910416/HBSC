import { ArrowUpRight, Bot } from 'lucide-react'
import styles from './PageAgentFab.module.css'

export function PageAgentFab({
  onClick,
  'data-state': dataState,
  showPodcast,
}: {
  onClick: () => void
  /** Animation stage: 'shrinking' (panel opening) or 'expanding' (panel closing). */
  'data-state'?: 'shrinking' | 'expanding'
  /** 是否在 FAB 上提示「播一下」。仅当当前页是期刊文章详情页时为 true，其他页面隐藏文案避免误导。 */
  showPodcast?: boolean
}) {
  const sub = showPodcast ? '读懂 · 操作 · 播一下' : '读懂 · 操作'
  return (
    <button
      type="button"
      className={styles.fab}
      onClick={onClick}
      aria-label={showPodcast
        ? '打开数创智伴 · 读懂本页、协助操作、或生成播客'
        : '打开数创智伴 · 读懂本页或协助操作'}
      title={showPodcast
        ? '数创智伴 · 读懂 · 操作 · 播一下'
        : '数创智伴 · 读懂 · 操作'}
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
        <span className={styles.textSub}>{sub}</span>
      </span>
      <ArrowUpRight size={15} className={styles.arrow} aria-hidden="true" />
    </button>
  )
}
