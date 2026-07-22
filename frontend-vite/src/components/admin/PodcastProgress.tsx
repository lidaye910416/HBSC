import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import styles from './PodcastProgress.module.css'

export type PodcastStage =
  | 'pending'
  | 'scripting'
  | 'synthesizing'
  | 'muxing'
  | 'ready'
  | 'failed'

export interface PodcastProgressProps {
  /** Backend-reported sub-stage. */
  stage?: PodcastStage | string
  /** Backend-reported integer 0–100. */
  progress?: number
  /** ISO timestamp of the current run start. */
  startedAt?: string | null
  /** Last successful run's wall-clock duration (seconds). */
  lastDuration?: number
  /** Status text overrides per stage. */
  variant?: 'inline' | 'card'
}

const STAGE_LABEL: Record<PodcastStage, string> = {
  pending: '等待开始',
  scripting: '正在撰写对谈脚本',
  synthesizing: '正在合成语音',
  muxing: '正在合成音频文件',
  ready: '已就绪',
  failed: '生成失败',
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${Math.max(0, Math.floor(secs))}s`
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}m${s.toString().padStart(2, '0')}s`
}

export function PodcastProgress({
  stage,
  progress,
  startedAt,
  lastDuration,
  variant = 'inline',
}: PodcastProgressProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt || stage === 'ready' || stage === 'failed') return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [startedAt, stage])

  const safeStage = (stage as PodcastStage) || 'pending'
  const isTerminal = safeStage === 'ready' || safeStage === 'failed'
  const indeterminate = safeStage === 'scripting' || safeStage === 'muxing' || safeStage === 'pending'

  let elapsedSecs = 0
  let etaSecs: number | null = null
  if (startedAt) {
    const start = Date.parse(startedAt)
    if (!Number.isNaN(start)) {
      elapsedSecs = Math.max(0, (now - start) / 1000)
    }
  }
  // ETA: only meaningful during synthesizing where we have a real
  // progress fraction; baseline from the last successful run's duration.
  if (
    safeStage === 'synthesizing'
    && typeof progress === 'number'
    && progress >= 15
    && progress < 90
    && lastDuration
    && lastDuration > 0
  ) {
    // Map "current progress" (15–90 range) to "share of the synthesizing
    // slice" of the prior run. We assume synthesizing eats ~75% of the
    // prior duration (scripting ≈ 15% pre-roll, muxing ≈ 10% post).
    const synthSlice = lastDuration * 0.75
    const fractionDone = (progress - 15) / 75
    if (fractionDone > 0.05) {
      const totalEstimate = synthSlice / fractionDone
      etaSecs = Math.max(0, totalEstimate - elapsedSecs)
    }
  }

  const pct = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0
  const rootClass = `${styles.root} ${variant === 'card' ? styles.card : styles.inline}`

  return (
    <div className={rootClass} role="status" aria-live="polite" data-testid="podcast-progress">
      <div className={styles.header}>
        <span className={styles.label}>
          {!isTerminal && <Loader2 size={12} className={styles.spinner} aria-hidden="true" />}
          {STAGE_LABEL[safeStage] || STAGE_LABEL.pending}
        </span>
        <span className={styles.meta}>
          {!isTerminal && startedAt && <span>已耗时 {formatElapsed(elapsedSecs)}</span>}
          {!isTerminal && etaSecs != null && etaSecs > 1 && (
            <span className={styles.eta}>· 预计还需 {formatElapsed(etaSecs)}</span>
          )}
          {!isTerminal && (
            <span className={styles.percent}>{indeterminate ? '…' : `${pct}%`}</span>
          )}
        </span>
      </div>
      <div className={styles.barTrack} aria-hidden="true">
        <div
          className={`${styles.barFill} ${indeterminate ? styles.indeterminate : ''}`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
