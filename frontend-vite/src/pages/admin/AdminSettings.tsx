import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Save,
  Sparkles,
  Wand2,
  RefreshCw,
  Zap,
  Lock,
  Eye,
  EyeOff,
  ZapOff,
} from 'lucide-react'
import { api } from '../../services/api'
import {
  PageHeader,
  Button,
  StatusBadge,
  Empty,
} from '../../components/ui'
import { useToast } from '../../components/admin/Toast'
import './AdminSettings.css'

interface Setting {
  key: string
  value?: string | null
  masked?: string | null
  is_secret: boolean
  description: string
  default_value?: string | null
  updated_at?: string | null
  updated_by?: string | null
}

type SettingKind = 'bool' | 'string' | 'secret' | 'textarea'

interface KnownKey {
  key: string
  label: string
  kind: SettingKind
  hint?: string
}

interface SettingSection {
  id: 'page-agent' | 'ai-typesetter'
  icon: React.ReactNode
  eyebrow: string // uppercase sans label above the card title (e.g. "PAGE AGENT")
  title: string // serif h3 in the card header
  blurb: string
  defaults: { model: string; baseUrl: string }
  rows: KnownKey[]
}

const PAGE_AGENT_SECTION: SettingSection = {
  id: 'page-agent',
  icon: <Zap size={16} />,
  title: 'page-agent · 公开页面 AI 助手',
  eyebrow: 'PAGE AGENT',
  blurb:
    '配置首页右下角 AI 助手 FAB。支持聊天（问他）与页面操作（让他操作）两种模式。',
  defaults: { model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1' },
  rows: [
    { key: 'page_agent.enabled',       label: '启用',                  kind: 'bool' },
    { key: 'page_agent.model',         label: '模型',                  kind: 'string' },
    { key: 'page_agent.base_url',      label: 'API Base URL',          kind: 'string', hint: '聊天 / 页面操作共用。DOM 模式仅允许 https。' },
    { key: 'page_agent.api_key',       label: 'API Key',               kind: 'secret' },
    { key: 'page_agent.system_prompt', label: '系统 Prompt（可覆盖）',  kind: 'textarea' },
  ],
}

const AI_TYPESETTER_SECTION: SettingSection = {
  id: 'ai-typesetter',
  icon: <Sparkles size={16} />,
  title: 'AI 排版 · Word 导入清洗',
  eyebrow: 'AI TYPESETTER',
  blurb:
    '把 .docx 导入生成的 pandoc Markdown 调一次 LLM 进行格式清理（不动语义、不修改图片路径、不修改元数据）。通常只需要填入 API Key 即可启用。',
  defaults: {
    model: 'MiniMax-M3',
    baseUrl: 'https://api.minimaxi.com/v1',
  },
  rows: [
    { key: 'article_typesetter.enabled',       label: '启用',         kind: 'bool' },
    { key: 'article_typesetter.model',         label: '模型',         kind: 'string' },
    { key: 'article_typesetter.base_url',      label: 'API Base URL', kind: 'string', hint: 'Token Plan key 用于 https://api.minimaxi.com/v1（OpenAI 兼容）' },
    { key: 'article_typesetter.api_key',       label: 'API Key',      kind: 'secret', hint: '获取方式：登录 MiniMax 控制台 → Token Plan → 复制 sk-cp-...' },
    { key: 'article_typesetter.system_prompt', label: '系统 Prompt',   kind: 'textarea' },
  ],
}

const ALL_SECTIONS = [PAGE_AGENT_SECTION, AI_TYPESETTER_SECTION]
const ALL_KNOWN_KEYS: KnownKey[] = ALL_SECTIONS.flatMap((s) => s.rows)

/* ============================================================
   Inline primitives
   ============================================================ */

function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'as-switch',
        checked ? 'as-switch--on' : 'as-switch--off',
        disabled ? 'as-switch--disabled' : '',
      ].filter(Boolean).join(' ')}
    >
      <span className="as-switch__thumb" />
    </button>
  )
}

function SecretInput({
  value,
  onChange,
  masked,
  hasStored,
}: {
  value: string
  onChange: (v: string) => void
  masked: string | null
  hasStored: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const showPlaceholder = !value && (hasStored || masked)
  return (
    <div className="as-secret">
      <Lock size={14} className="as-secret__icon" />
      <input
        className="as-secret__input"
        type={revealed ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        placeholder={showPlaceholder ? (masked || '尚未配置（请填入新 Key）') : ''}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hasStored && masked && (
        <span className="as-secret__chip" title="已配置的 Key（服务端 Fernet 加密）">
          {masked}
        </span>
      )}
      <button
        type="button"
        className="as-secret__reveal"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? '隐藏' : '显示'}
        title={revealed ? '隐藏' : '显示'}
      >
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  )
}

function PrimaryButton({
  onClick,
  disabled,
  loading,
  children,
  size = 'md',
  className = '',
}: {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  children: React.ReactNode
  size?: 'sm' | 'md'
  className?: string
}) {
  // Render with the gold-primary styling (matches .ui-btn--primary) because
  // the shared <Button> only exposes shadcn-style variants.
  const cls = [
    'ui-btn',
    size === 'sm' ? 'ui-btn--sm' : 'ui-btn--md',
    'ui-btn--primary',
    'as-btn-primary',
    loading ? 'is-loading' : '',
    className,
  ].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} disabled={disabled || loading} onClick={onClick}>
      <Save size={size === 'sm' ? 12 : 14} />
      <span>{children}</span>
    </button>
  )
}

function AppearanceCard() {
  const toast = useToast()
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem('hbsc-theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })

  const handleChange = (next: 'dark' | 'light') => {
    if (next === theme) return
    setTheme(next)
    try { localStorage.setItem('hbsc-theme', next) } catch { /* noop */ }
    document.documentElement.dataset.theme = next === 'light' ? 'light' : ''
    toast.success(`已切换到${next === 'dark' ? '深色' : '浅色'}主题`)
  }

  return (
    <div className="ui-card ui-card--elevated as-card" data-section="appearance">
      <header className="as-card__head">
        <div className="as-card__head-text">
          <span className="as-card__eyebrow">
            <Eye size={16} /> APPEARANCE
          </span>
          <h3 className="as-card__title">外观</h3>
          <p className="as-card__blurb">选择后台界面的色彩风格</p>
        </div>
      </header>
      <div className="as-card__body">
        <div className="as-appearance">
          <label className={`as-appearance__option${theme === 'dark' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="theme"
              value="dark"
              checked={theme === 'dark'}
              onChange={() => handleChange('dark')}
            />
            <span className="as-appearance__option-title">深色</span>
            <span className="as-appearance__option-desc">
              深墨底 + 暖白字 · 默认 · 长时间编辑更护眼
            </span>
          </label>
          <label className={`as-appearance__option${theme === 'light' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="theme"
              value="light"
              checked={theme === 'light'}
              onChange={() => handleChange('light')}
            />
            <span className="as-appearance__option-title">浅色</span>
            <span className="as-appearance__option-desc">
              暖白底 + 深墨字 · 与公开站视觉一致
            </span>
          </label>
        </div>
        <p className="as-appearance__footer">
          选择保存在浏览器本地，可在任何时候切换
        </p>
      </div>
    </div>
  )
}

/* ============================================================
   Page
   ============================================================ */

export function AdminSettings() {
  const qc = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<Record<string, string>>({})

  const listQ = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.admin.settings.list(),
  })

  // Pre-fill draft from the row's stored value; fall back to default_value for
  // non-secret rows so the form opens with the preset already visible.
  useEffect(() => {
    const items = listQ.data?.items ?? []
    const next: Record<string, string> = {}
    for (const it of items) {
      if (it.is_secret) continue
      if (it.value != null && it.value !== '') {
        next[it.key] = it.value
        continue
      }
      if (it.default_value) {
        next[it.key] = it.default_value
      }
    }
    setDraft((d) => ({ ...next, ...d })) // preserve user-typed secrets
  }, [listQ.data])

  const upsertMut = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) =>
      api.admin.settings.upsert(key, value),
    onSuccess: (_data, vars) => {
      toast.success(`已保存 · ${vars.key}`)
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] })
      qc.invalidateQueries({ queryKey: ['admin', 'agent', 'config'] })
    },
    onError: (err, vars) => {
      toast.error(`${vars.key}: ${err instanceof Error ? err.message : '保存失败'}`)
    },
  })

  const testMut = useMutation({
    mutationFn: (key: string) => api.admin.settings.test(key),
    onSuccess: (_d, key) => toast.success(`连通成功 · ${key}`),
    onError: (err, key) =>
      toast.error(`连通失败 · ${key}: ${err instanceof Error ? err.message : '失败'}`),
  })

  const items: Setting[] = listQ.data?.items ?? []
  const lookup = useMemo(
    () => Object.fromEntries(items.map((i) => [i.key, i])),
    [items],
  )
  const otherItems = useMemo(
    () => items.filter((i) => !ALL_KNOWN_KEYS.some((k) => k.key === i.key)),
    [items],
  )

  const setDraftFor = (k: string, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const persistedValue = (k: string): string => {
    const row = lookup[k]
    if (!row) return ''
    if (row.is_secret) return row.masked ?? ''
    if (row.value != null && row.value !== '') return row.value
    return row.default_value ?? ''
  }

  const isDirty = (key: string): boolean => {
    const row = lookup[key]
    const current = draft[key] ?? ''
    if (!row) return current !== ''
    if (row.is_secret) return current !== ''
    return current !== persistedValue(key)
  }

  const dirtyCountFor = (section: SettingSection) =>
    section.rows.filter((r) => isDirty(r.key)).length

  const sectionIsEnabled = (section: SettingSection): boolean => {
    const row = lookup[section.rows[0].key] // .enabled is first row
    if (!row) return false
    const v =
      draft[section.rows[0].key] ??
      (row.value ?? row.default_value ?? 'false')
    return v === 'true'
  }

  const toggleSection = (section: SettingSection, next: boolean) => {
    const key = section.rows[0].key
    setDraftFor(key, next ? 'true' : 'false')
    upsertMut.mutate({ key, value: next ? 'true' : 'false' })
  }

  const saveSection = async (section: SettingSection) => {
    for (const row of section.rows) {
      if (!isDirty(row.key)) continue
      const v = draft[row.key] ?? ''
      await upsertMut.mutateAsync({ key: row.key, value: v })
    }
  }

  /* ----- Render helpers ----- */

  const renderSkeleton = () => (
    <div className="as-grid">
      {[0, 1].map((i) => (
        <div key={i} className="ui-card ui-card--elevated as-card as-card--skeleton" aria-hidden>
          <div className="as-card__head">
            <div className="as-skel as-skel--eyebrow" />
            <div className="as-skel as-skel--title" />
            <div className="as-skel as-skel--badge" />
          </div>
          <div className="as-card__body">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="as-skel-row">
                <div className="as-skel as-skel--label" />
                <div className="as-skel as-skel--input" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )

  const renderCard = (section: SettingSection) => {
    const dirty = dirtyCountFor(section)
    const enabled = sectionIsEnabled(section)
    const preset = section.defaults.model
    const enabledKey = section.rows[0].key

    return (
      <div
        key={section.id}
        className="ui-card ui-card--elevated as-card"
        data-section={section.id}
      >
        <header className="as-card__head">
          <div className="as-card__head-text">
            <span className="as-card__eyebrow">
              {section.icon} {section.eyebrow}
            </span>
            <h3 className="as-card__title">{section.title}</h3>
            <p className="as-card__blurb">{section.blurb}</p>
          </div>
          <div className="as-card__head-status">
            <StatusBadge status="featured">{`预设：${preset}`}</StatusBadge>
            <StatusBadge status={enabled ? 'published' : 'archived'}>
              {enabled ? '已启用' : '已停用'}
            </StatusBadge>
          </div>
        </header>

        {dirty > 0 && (
          <div className="as-dirty" role="status">
            <span className="as-dirty__count">{dirty} 处未保存</span>
            <PrimaryButton
              size="sm"
              onClick={() => saveSection(section)}
              loading={upsertMut.isPending}
            >
              保存本页
            </PrimaryButton>
          </div>
        )}

        <div className="as-card__body">
          {section.rows.map((k, idx) => {
            const row = lookup[k.key]
            const value = draft[k.key] ?? ''
            const showBelow = idx !== 0

            if (!showBelow) {
              // Master toggle row (the .enabled key)
              return (
                <div key={k.key} className="as-row as-row--toggle as-row--first">
                  <div className="as-row__head">
                    <span className="as-row__label">{k.label}</span>
                    <span className="as-row__hint">
                      {row?.description || '整体开关'}
                    </span>
                  </div>
                  <div className="as-row__field">
                    <Switch
                      checked={enabled}
                      onChange={(n) => toggleSection(section, n)}
                      disabled={upsertMut.isPending}
                      ariaLabel={`${section.title} ${k.label}`}
                    />
                    <span className="as-row__tech">{enabledKey}</span>
                  </div>
                </div>
              )
            }

            const isSecret = k.kind === 'secret'

            return (
              <div
                key={k.key}
                className={[
                  'as-row',
                  isSecret ? 'as-row--secret' : '',
                  isDirty(k.key) ? 'as-row--dirty' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="as-row__head">
                  <span className="as-row__label">{k.label}</span>
                  <span className="as-row__hint">
                    {k.hint || row?.description || ''}
                  </span>
                </div>
                <div className="as-row__field">
                  {k.kind === 'secret' ? (
                    <SecretInput
                      value={value}
                      onChange={(v) => setDraftFor(k.key, v)}
                      masked={row?.masked ?? null}
                      hasStored={Boolean(row?.masked)}
                    />
                  ) : k.kind === 'textarea' ? (
                    <textarea
                      className="as-input as-textarea"
                      rows={Math.min(6, Math.max(3, value.split('\n').length))}
                      value={value}
                      onChange={(e) => setDraftFor(k.key, e.target.value)}
                      placeholder={row?.description || undefined}
                    />
                  ) : (
                    <input
                      className="as-input"
                      type="text"
                      value={value}
                      onChange={(e) => setDraftFor(k.key, e.target.value)}
                      placeholder={row?.default_value ?? ''}
                    />
                  )}
                  {k.kind === 'secret' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => testMut.mutate(k.key)}
                      disabled={testMut.isPending || !row?.masked}
                    >
                      <span className="as-inline-icon-text">
                        <Zap size={14} /> 测试连通
                      </span>
                    </Button>
                  )}
                </div>
                <span className="as-row__tech">{k.key}</span>
                {row?.updated_at && row.value != null && row.value !== '' && (
                  <div className="as-row__meta">
                    上次更新：{new Date(row.updated_at).toLocaleString('zh-CN')}
                    {row.updated_by && ` · ${row.updated_by}`}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <footer className="as-card__foot">
          <PrimaryButton
            onClick={() => saveSection(section)}
            loading={upsertMut.isPending}
          >
            保存本页
          </PrimaryButton>
          <span className="as-card__foot-hint">
            <Wand2 size={12} /> 任一字段修改后可逐项保存
          </span>
        </footer>
      </div>
    )
  }

  const totalDirty = ALL_SECTIONS.reduce((n, s) => n + dirtyCountFor(s), 0)

  return (
    <div className="admin-settings">
      <PageHeader
        title="设置"
        description="两个独立的功能模块各自配置一组 LLM 设置；API Key 在服务端 Fernet 加密落库，不会发送到浏览器。"
        actions={
          <PrimaryButton
            onClick={() => ALL_SECTIONS.forEach(saveSection)}
            loading={upsertMut.isPending}
            disabled={totalDirty === 0}
          >
            {totalDirty === 0 ? '保存全部' : `保存全部 · ${totalDirty}`}
          </PrimaryButton>
        }
      />

      {listQ.isLoading && renderSkeleton()}

      {listQ.isError && (
        <Empty
          icon={<ZapOff size={36} strokeWidth={1.25} />}
          title="无法加载设置"
          description="请检查后端连接或稍后重试。"
          action={
            <Button variant="secondary" onClick={() => listQ.refetch()}>
              <span className="as-inline-icon-text">
                <RefreshCw size={14} /> 重试
              </span>
            </Button>
          }
        />
      )}

      <AppearanceCard />

      {!listQ.isLoading && !listQ.isError && (
        <div className="as-grid">{ALL_SECTIONS.map(renderCard)}</div>
      )}

      {otherItems.length > 0 && (
        <section className="ui-card ui-card--outlined as-other-card">
          <header className="as-other-card__head">
            <h3 className="as-other-card__title">其他设置（只读）</h3>
          </header>
          <div className="as-other-card__body">
            <table className="admin-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>值</th>
                  <th>默认值</th>
                  <th>更新时间</th>
                  <th>更新人</th>
                </tr>
              </thead>
              <tbody>
                {otherItems.map((i) => (
                  <tr key={i.key}>
                    <td>{i.key}</td>
                    <td>{i.is_secret ? i.masked : i.value ?? '—'}</td>
                    <td style={{ color: 'var(--admin-text-muted)' }}>{i.default_value ?? '—'}</td>
                    <td>{i.updated_at ? new Date(i.updated_at).toLocaleString('zh-CN') : '—'}</td>
                    <td>{i.updated_by ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="admin-settings__hint">
        <ZapOff size={14} /> 两组设置互不影响 — page-agent 关闭后右下角的代理输入框消失；
        AI 排版关闭后 ArticleEditor 里的「AI 排版」按钮变 disabled。
        改完点 <RefreshCw size={14} /> 刷新当前页可立即生效。
      </div>
    </div>
  )
}
