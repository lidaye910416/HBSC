import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Sparkles, Wand2, RefreshCw, Zap, ZapOff } from 'lucide-react'
import { api } from '../../services/api'
import { PageHeader, Button, Card } from '../../components/ui'
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
  hint?: string  // one-line hint shown below label
}

interface SettingSection {
  title: string
  icon: React.ReactNode
  blurb: string  // intro paragraph
  defaults: { model: string; baseUrl: string }  // preset chips for the preset badge
  rows: KnownKey[]
}

const PAGE_AGENT_SECTION: SettingSection = {
  title: 'page-agent — 自然语言操作 admin',
  icon: <Zap size={16} />,
  blurb:
    '基于自然语言操作 admin 页面的代理。启用后，admin 路由右下角会出现代理输入框。关闭后下次进入 admin 页面即消失（刷新当前页可立即生效）。',
  defaults: {
    model: 'MiniMax-M3',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  rows: [
    { key: 'page_agent.enabled',       label: '启用',                   kind: 'bool' },
    { key: 'page_agent.model',         label: '模型',                   kind: 'string' },
    { key: 'page_agent.base_url',      label: 'API Base URL',           kind: 'string' },
    { key: 'page_agent.api_key',       label: 'API Key',                kind: 'secret' },
    { key: 'page_agent.system_prompt', label: '系统 Prompt（可覆盖）',   kind: 'textarea' },
  ],
}

const AI_TYPESETTER_SECTION: SettingSection = {
  title: 'AI 排版 — Word 导入后的 Markdown 清洗',
  icon: <Sparkles size={16} />,
  blurb:
    '把 .docx 导入生成的 pandoc Markdown 调一次 LLM 进行格式清理（不动语义、不修改图片路径、不修改元数据）。通常只需要填入 API Key 即可启用，其余配置已按 minimax token plan 预设好。',
  defaults: {
    model: 'MiniMax-M3',
    baseUrl: 'https://api.minimax.chat/v1',
  },
  rows: [
    { key: 'article_typesetter.enabled',       label: '启用',           kind: 'bool' },
    { key: 'article_typesetter.model',         label: '模型',           kind: 'string' },
    { key: 'article_typesetter.base_url',      label: 'API Base URL',   kind: 'string' },
    { key: 'article_typesetter.api_key',       label: 'API Key',        kind: 'secret', hint: '获取方式：登录 minimax 控制台 → Token Plan → 复制 sk-cp-...' },
    { key: 'article_typesetter.system_prompt', label: '系统 Prompt',     kind: 'textarea' },
  ],
}

const ALL_SECTIONS = [PAGE_AGENT_SECTION, AI_TYPESETTER_SECTION]
const ALL_KNOWN_KEYS: KnownKey[] = ALL_SECTIONS.flatMap((s) => s.rows)

export function AdminSettings() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, string>>({})

  const listQ = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.admin.settings.list(),
  })

  // Pre-fill draft from the row's stored `value`; if absent, fall back to
  // the synthesized `default_value` so the form opens with the minimax
  // preset already visible (and NOT making the admin retype it).
  useEffect(() => {
    const items = listQ.data?.items ?? []
    const next: Record<string, string> = {}
    for (const it of items) {
      if (it.is_secret) continue  // secrets are NEVER auto-filled
      if (it.value != null && it.value !== '') {
        next[it.key] = it.value
        continue
      }
      if (it.default_value) {
        next[it.key] = it.default_value
      }
    }
    setDraft((d) => ({ ...next, ...d }))  // preserve user-typed secrets
  }, [listQ.data])

  const upsertMut = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) =>
      api.admin.settings.upsert(key, value),
    onSuccess: (_data, vars) => {
      setFeedback((f) => ({ ...f, [vars.key]: '已保存' }))
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] })
      qc.invalidateQueries({ queryKey: ['admin', 'agent', 'config'] })
    },
    onError: (err, vars) => {
      setFeedback((f) => ({ ...f, [vars.key]: err instanceof Error ? err.message : '保存失败' }))
    },
  })

  const testMut = useMutation({
    mutationFn: (key: string) => api.admin.settings.test(key),
    onSuccess: (_d, key) => setFeedback((f) => ({ ...f, [key]: '✓ 连通' })),
    onError: (err, key) => setFeedback((f) => ({ ...f, [key]: `× ${err instanceof Error ? err.message : '失败'}` })),
  })

  const items: Setting[] = listQ.data?.items ?? []
  const lookup = useMemo(() => Object.fromEntries(items.map((i) => [i.key, i])), [items])
  const otherItems = useMemo(
    () => items.filter((i) => !ALL_KNOWN_KEYS.some((k) => k.key === i.key)),
    [items],
  )

  const setDraftFor = (k: string, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const isPreset = (s: Setting, k: KnownKey) =>
    !k.key.endsWith('api_key') &&
    (s.value == null || s.value === '') &&
    !!s.default_value

  return (
    <div className="admin-settings">
      <PageHeader
        title="设置"
        description="两个独立的功能模块各自配置一组 LLM 设置；API Key 在服务端 Fernet 加密落库，不会发送到浏览器。"
      />

      {ALL_SECTIONS.map((section) => (
        <section key={section.title} className="admin-settings__section">
          <header className="admin-settings__section-head">
            <h2 className="admin-settings__section-title">
              {section.icon} {section.title}
            </h2>
            <p className="admin-settings__section-blurb">{section.blurb}</p>
            <div className="admin-settings__preset">
              <Wand2 size={12} />
              <span>预设模型</span>
              <code>{section.defaults.model}</code>
              <span className="admin-settings__preset-sep">·</span>
              <code>{section.defaults.baseUrl}</code>
            </div>
          </header>

          <div className="admin-settings__list">
            {section.rows.map((k) => {
              const row = lookup[k.key]
              const persisted = row?.value != null && row.value !== ''
              const value = draft[k.key] ?? ''
              return (
                <Card key={k.key} variant="outlined">
                  <div className="admin-settings__row">
                    <label className="admin-settings__label">
                      <span className="admin-settings__label-text">{k.label}</span>
                      <span className="admin-settings__key">{k.key}</span>
                      {row && isPreset(row, k) && (
                        <span className="admin-settings__preset-chip">预设</span>
                      )}
                      {row?.description && (
                        <span className="admin-settings__desc">{row.description}</span>
                      )}
                      {k.hint && (
                        <span className="admin-settings__hint-inline">{k.hint}</span>
                      )}
                    </label>
                    <div className="admin-settings__field">
                      {k.kind === 'bool' ? (
                        <select
                          value={value || 'false'}
                          onChange={(e) => setDraftFor(k.key, e.target.value)}
                        >
                          <option value="true">启用</option>
                          <option value="false">关闭</option>
                        </select>
                      ) : k.kind === 'secret' ? (
                        <input
                          type="password"
                          placeholder={row?.masked || '尚未配置（请填入新 Key）'}
                          value={value}
                          onChange={(e) => setDraftFor(k.key, e.target.value)}
                        />
                      ) : k.kind === 'textarea' ? (
                        <textarea
                          rows={Math.min(6, Math.max(3, value.split('\n').length))}
                          value={value}
                          onChange={(e) => setDraftFor(k.key, e.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder={row?.default_value ?? undefined}
                          value={value}
                          onChange={(e) => setDraftFor(k.key, e.target.value)}
                        />
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Save size={14} />}
                        onClick={() => upsertMut.mutate({ key: k.key, value })}
                        loading={upsertMut.isPending}
                      >
                        保存
                      </Button>
                      {k.kind === 'secret' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Zap size={14} />}
                          onClick={() => testMut.mutate(k.key)}
                          disabled={testMut.isPending || !row?.masked}
                        >
                          测试连通
                        </Button>
                      )}
                    </div>
                    {row?.updated_at && persisted && (
                      <div className="admin-settings__meta">
                        上次更新：{new Date(row.updated_at).toLocaleString('zh-CN')}
                        {row.updated_by && ` · ${row.updated_by}`}
                      </div>
                    )}
                    {feedback[k.key] && (
                      <div className={`admin-settings__feedback ${feedback[k.key].startsWith('×') ? 'admin-settings__feedback--err' : ''}`}>
                        {feedback[k.key]}
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        </section>
      ))}

      {otherItems.length > 0 && (
        <Card variant="outlined" style={{ marginTop: 'var(--space-5)' }}>
          <h3 style={{ margin: '0 0 var(--space-3) 0', fontSize: 'var(--type-base)' }}>
            其他设置（只读）
          </h3>
          <table className="admin-table" style={{ margin: 0 }}>
            <thead>
              <tr><th>Key</th><th>值</th><th>默认值</th><th>更新时间</th><th>更新人</th></tr>
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
        </Card>
      )}

      <div className="admin-settings__hint">
        <ZapOff size={14} /> 两组设置互不影响 — page-agent 关闭后右下角的代理输入框消失；
        AI 排版关闭后 ArticleEditor 里的「AI 排版」按钮变 disabled。
        改完点 <RefreshCw size={14} /> 刷新当前页可立即生效。
      </div>
    </div>
  )
}
