import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, Download, Headphones, Loader2, Mic } from 'lucide-react'
import { api, ApiError, type PodcastConfig, type PodcastGenerateResult, type PodcastAudioStatus } from '../../services/api'
import type { PageContext } from './pageContext'
import styles from './PodcastPanel.module.css'

/**
 * 数创智伴 「播一下」 tab body.
 *
 * Replaces the chat-history body when the user switches to `mode === 'podcast'`.
 * Owns its own state machine — no chat history is persisted, so the panel
 * always re-renders from `idle` on every fresh open.
 *
 * State machine:
 *   idle  ──[生成]──►  extracting ──► scripting ──► synthesizing ──► ready
 *                                  └─ on error ──► error
 *   ready ──[× 关闭]──► idle
 *
 * Backend contract: /api/public/podcast/* — see
 *   backend/app/routers/public_podcast_router.py
 *   docs/superpowers/specs/2026-07-20-fab-podcast-mode-design.md
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'extracting' }
  | { kind: 'scripting' }
  | { kind: 'synthesizing' }
  | { kind: 'ready'; data: PodcastGenerateResult }
  | { kind: 'error'; code: string; message: string; fallbackUrl?: string }

const STEP_KEYS = ['extracting', 'scripting', 'synthesizing', 'ready'] as const
type StepKey = (typeof STEP_KEYS)[number]

function stepStateFor(status: Status, step: StepKey): 'pending' | 'active' | 'done' | 'error' {
  if (status.kind === 'error') {
    const erroredAt: StepKey =
      // Best guess: the failure happened on whichever step was running.
      // `error.code` hints which MiniCast call broke; default to extracting
      // since that's the most common cause (upstream empty / unreachable).
      status.code === 'minicast_upstream_error' && status.message.includes('脚本')
        ? 'scripting'
        : status.code === 'minicast_upstream_error' && status.message.includes('job_id')
          ? 'synthesizing'
          : 'extracting'
    if (step === erroredAt) return 'error'
    const order = STEP_KEYS.indexOf(erroredAt)
    const myIdx = STEP_KEYS.indexOf(step)
    return myIdx < order ? 'done' : 'pending'
  }
  const idx = STEP_KEYS.indexOf(step)
  const currentIdx = STEP_KEYS.indexOf(status.kind as StepKey)
  if (currentIdx === -1) return 'pending'
  if (idx < currentIdx) return 'done'
  if (idx === currentIdx) return status.kind === 'ready' ? 'done' : 'active'
  return 'pending'
}

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatHumanDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (s === 60) return `${m + 1} 分 0 秒`
  if (m <= 0) return `${s} 秒`
  return `${m} 分 ${s} 秒`
}

function estimateDuration(content: string): string {
  // Very rough: TTS reads ~3 Chinese chars/sec at speed=1.0; pad with
  // inter-speaker silence (~0.5s × segments). Cap content length so a
  // huge pasted article doesn't produce a 60-minute estimate that
  // contradicts the actual ~8-12 min backend output. We render the
  // estimate as `约 X 分 Y 秒` so the format matches the ready-state
  // readout once the job completes.
  if (!content) return '约 1 分钟'
  const CAPPED_CHARS = 4_000
  const chars = Math.min(content.length, CAPPED_CHARS)
  const ttsSecs = chars / 3.0
  const segments = Math.max(8, Math.round(chars / 120))
  const pauseSecs = segments * 0.5
  const total = ttsSecs + pauseSecs
  return `约 ${formatHumanDuration(total)}`
}

function articleSlugFromUrl(url: string): string | null {
  const match = new URL(url, window.location.origin).pathname.match(/^\/articles\/([^/]+)\/?$/)
  return match?.[1] ?? null
}

export function PodcastPanel({
  pageContext,
}: {
  pageContext: PageContext
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const articleSlug = articleSlugFromUrl(pageContext.url)
  const backendAudioQuery = useQuery<PodcastAudioStatus>({
    queryKey: ['public', 'podcast', 'article', articleSlug],
    queryFn: () => api.public.podcast.article(articleSlug!),
    enabled: Boolean(articleSlug),
    refetchInterval: (query) => {
      const state = query.state.data?.status
      return state === 'pending' || state === 'generating' ? 2500 : false
    },
  })

  // Read the public config to learn the voice catalog and the FAB gate.
  // If disabled, the FAB shouldn't have surfaced this tab — but we still
  // defensively show an empty state so a misconfigured deployment doesn't
  // crash the panel.
  const configQuery = useQuery<PodcastConfig>({
    queryKey: ['public', 'podcast', 'config'],
    queryFn: () => api.public.podcast.config(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  // Reset status when the user navigates between pages — the previous job's
  // MP3 references the old page, so it must not bleed into the new one.
  useEffect(() => {
    setStatus({ kind: 'idle' })
  }, [pageContext.url])

  useEffect(() => {
    const data = backendAudioQuery.data
    if (!data) return
    // If the backend has finished preparing audio for the article we're
    // viewing, surface it directly — overriding any in-flight ad-hoc
    // generation since the persisted asset is always fresher.
    if (data.status === 'ready' && data.job_id) {
      if (status.kind === 'ready' && status.data.job_id === data.job_id) return
      setStatus({ kind: 'ready', data: {
        job_id: data.job_id,
        mp3_url: data.mp3_url || '',
        srt_url: data.srt_url || '',
        duration_seconds: data.duration_seconds || 0,
        total_chars: data.total_chars || 0,
        segment_count: data.segment_count || 0,
        script_text: data.script_text || '',
        fallback_url: '',
        mode: 'backend-prebuilt',
      } })
    }
  }, [backendAudioQuery.data, status.kind, status])

  async function handleStart() {
    if (status.kind === 'extracting' || status.kind === 'scripting' || status.kind === 'synthesizing') {
      return
    }
    setStatus({ kind: 'extracting' })
    try {
      setStatus({ kind: 'scripting' })
      const data = await api.public.podcast.generate({
        url: pageContext.url,
        title_hint: pageContext.title,
      })
      setStatus({ kind: 'synthesizing' })
      // Synthesize already happened inside /generate (chained). Treat
      // the data as ready immediately; the synthesizing step's UI moment
      // is brief but keeps the 4-stage progress honest.
      setStatus({ kind: 'ready', data })
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e), 'unknown', 0, null)
      const detail = (err.body as { detail?: { code?: string; message?: string; hint?: string } } | null)?.detail
      const code = detail?.code ?? err.code ?? 'unknown'
      const message = detail?.message ?? err.message
      // Always offer the manual workbench link — the user benefits from
      // a hand-off path even when the error fires mid-flow (extracting /
      // scripting / synthesizing). The status.kind guard used to gate this
      // on 'idle', but by the time we reach the catch the status is
      // already past 'idle', so the link was silently dropped.
      const fallbackUrl = `/labs/minicast/?embed=1&source=${encodeURIComponent(pageContext.url)}`
      setStatus({ kind: 'error', code, message, fallbackUrl })
    }
  }

  const config = configQuery.data
  const voiceA = config?.voices?.[config.default_voice_a]
  const voiceB = config?.voices?.[config.default_voice_b]
  const backendData = backendAudioQuery.data
  const backendGenerating = backendData?.status === 'pending' || backendData?.status === 'generating'
  const backendFailed = backendData?.status === 'failed'
  const disabled = !configQuery.isSuccess || config?.enabled === false || backendGenerating

  return (
    <div className={styles.root} data-testid="podcast-panel">
      <div className={styles.title}>
        <span className={styles.titleIcon}><Headphones size={14} aria-hidden="true" /></span>
        本期嘉宾
        <span className={styles.durationHint}>
          时长预估：{status.kind === 'ready'
            ? fmtDuration(status.data.duration_seconds)
            : estimateDuration(pageContext.content)}
        </span>
      </div>

      <div className={styles.voiceRow}>
        {voiceA && (
          <div className={styles.voiceCard} data-gender={voiceA.gender} data-testid="podcast-voice-a">
            <span className={styles.voiceAvatar} aria-hidden="true">{voiceA.emoji}</span>
            <div className={styles.voiceMeta}>
              <span className={styles.voiceLabel}>{voiceA.label}</span>
              <span className={styles.voiceSubtitle}>{voiceA.subtitle}</span>
            </div>
          </div>
        )}
        {voiceB && (
          <div className={styles.voiceCard} data-gender={voiceB.gender} data-testid="podcast-voice-b">
            <span className={styles.voiceAvatar} aria-hidden="true">{voiceB.emoji}</span>
            <div className={styles.voiceMeta}>
              <span className={styles.voiceLabel}>{voiceB.label}</span>
              <span className={styles.voiceSubtitle}>{voiceB.subtitle}</span>
            </div>
          </div>
        )}
      </div>

      <div className={styles.steps} data-testid="podcast-steps">
        {STEP_KEYS.map((step) => {
          const state = stepStateFor(status, step)
          const label =
            step === 'extracting' ? '提取正文'
            : step === 'scripting' ? '编写对谈脚本'
            : step === 'synthesizing' ? '合成音频'
            : '准备播放器'
          return (
            <div
              key={step}
              className={styles.step}
              data-state={state}
              data-step={step}
            >
              <span className={styles.stepDot} aria-hidden="true">
                {state === 'done' ? <Check size={11} /> :
                  state === 'active' ? <Loader2 size={11} className="page-agent-spin" /> :
                  state === 'error' ? <AlertTriangle size={11} /> :
                  (STEP_KEYS.indexOf(step) + 1)}
              </span>
              <span className={styles.stepLabel}>{label}</span>
            </div>
          )
        })}
      </div>

      {status.kind === 'idle' && (
        <button
          type="button"
          className={styles.startBtn}
          onClick={() => void handleStart()}
          disabled={disabled}
          data-testid="podcast-start-btn"
          aria-label="开始生成当前页播客"
        >
          <span className={styles.startBtnIcon}><Mic size={14} /></span>
          {backendGenerating
            ? '后台正在准备语音…'
            : '开始生成'}
        </button>
      )}

      {backendGenerating && (
        <div className={styles.notice} role="status" data-testid="podcast-backend-generating">
          <Loader2 size={14} className={styles.noticeIcon} aria-hidden="true" />
          <span>后台正在为这篇文章生成对谈语音，完成后会自动切到播放界面…</span>
        </div>
      )}

      {backendFailed && status.kind === 'idle' && (
        <div className={styles.error} role="alert" data-testid="podcast-backend-failed">
          <AlertTriangle size={14} aria-hidden="true" />
          <div>
            <div>后台预生成失败：{backendData?.error_message || '未知错误'}</div>
            <div style={{ marginTop: 4 }}>可以点击上方按钮实时重试一次。</div>
          </div>
        </div>
      )}

      {status.kind === 'ready' && (
        <div className={styles.audioBox} data-testid="podcast-ready">
          <audio
            controls
            className={styles.audio}
            src={mp3SrcFor(status.data)}
            data-testid="podcast-audio"
          />
          <div className={styles.audioMeta}>
            <span>{formatHumanDuration(status.data.duration_seconds)} · {status.data.segment_count} 段</span>
            <span>{status.data.total_chars} 字</span>
          </div>
          <div className={styles.dlRow}>
            <a
              className={styles.dlBtn}
              href={mp3SrcFor(status.data)}
              download={`hbsc-podcast-${slugify(status.data.job_id)}.mp3`}
              data-testid="podcast-download-mp3"
            >
              <Download size={12} /> 下载 MP3
            </a>
            {status.data.srt_url && (
              <a
                className={styles.dlBtn}
                href={srtSrcFor(status.data)}
                download={`hbsc-podcast-${slugify(status.data.job_id)}.srt`}
                data-testid="podcast-download-srt"
              >
                <Download size={12} /> 下载字幕
              </a>
            )}
          </div>
          {status.data.script_text && (
            <details className={styles.scriptBox} open>
              <summary className={styles.scriptSummary}>对谈脚本</summary>
              <pre className={styles.scriptPre} data-testid="podcast-script">{status.data.script_text}</pre>
            </details>
          )}
        </div>
      )}

      {status.kind === 'error' && (
        <div className={styles.error} role="alert" data-testid="podcast-error">
          <AlertTriangle size={14} aria-hidden="true" />
          <div>
            <div>{status.message}</div>
            {status.fallbackUrl && (
              <div style={{ marginTop: 6 }}>
                你可以
                <a href={status.fallbackUrl} target="_blank" rel="noopener noreferrer">
                  打开完整工作台
                </a>
                手动生成。
              </div>
            )}
          </div>
        </div>
      )}

      {configQuery.isError && (
        <div className={styles.error}>
          <AlertTriangle size={14} aria-hidden="true" />
          <div>无法读取播客配置（{configQuery.error instanceof Error ? configQuery.error.message : '未知错误'}）</div>
        </div>
      )}
    </div>
  )
}

/**
 * Build the player src for a generated job.
 *
 * Backend returns either a MiniCast-relative path ("/api/jobs/.../download")
 * or an absolute URL. hbsc's `/api/public/podcast/download/{job_id}` is the
 * preferred proxied route so the browser doesn't have to talk to the
 * MiniCast origin directly (which is on a different port and may be
 * blocked by cross-origin policies). When the upstream returns a same-
 * origin path we transparently rewrite it.
 */
function mp3SrcFor(data: PodcastGenerateResult): string {
  const raw = data.mp3_url
  if (!raw) return `/api/public/podcast/download/${data.job_id}`
  if (raw.startsWith('/api/jobs/')) {
    const jobId = raw.split('/')[3]
    return `/api/public/podcast/download/${jobId}`
  }
  return raw
}

function srtSrcFor(data: PodcastGenerateResult): string {
  const raw = data.srt_url
  if (!raw) return ''
  if (raw.startsWith('/api/jobs/')) {
    const jobId = raw.split('/')[3]
    return `/api/public/podcast/subtitle/${jobId}`
  }
  return raw
}

function slugify(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'podcast'
}
