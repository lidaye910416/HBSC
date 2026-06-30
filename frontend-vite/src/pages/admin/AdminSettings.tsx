import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, RefreshCw, Zap, ZapOff } from 'lucide-react'
import { api } from '../../services/api'
import { PageHeader, Button, Card, CardHeader, CardTitle } from '../../components/ui'
import './AdminSettings.css'

interface Setting {
  key: string
  value?: string | null
  masked?: string | null
  is_secret: boolean
  description: string
  updated_at: string
  updated_by: string
}

const KNOWN_KEYS = [
  { key: 'page_agent.enabled',     label: '启用 page-agent', kind: 'bool'   as const },
  { key: 'page_agent.model',       label: '模型',             kind: 'string' as const },
  { key: 'page_agent.base_url',    label: 'API Base URL',     kind: 'string' as const },
  { key: 'page_agent.api_key',     label: 'API Key',          kind: 'secret' as const },
  { key: 'page_agent.system_prompt', label: '系统 Prompt（可覆盖）', kind: 'string' as const },
  // ----- article typesetter (AI 排版) -----
  { key: 'article_typesetter.enabled',  label: '启用 AI 排版',         kind: 'bool'   as const },
  { key: 'article_typesetter.model',       label: '模型 (AI 排版)',     kind: 'string' as const },
  { key: 'article_typesetter.base_url',    label: 'API Base URL',        kind: 'string' as const },
  { key: 'article_typesetter.api_key',     label: 'API Key (AI 排版)',   kind: 'secret' as const },
  { key: 'article_typesetter.system_prompt', label: '系统 Prompt（可覆盖）', kind: 'string' as const },
]

export function AdminSettings() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, string>>({})

  const listQ = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.admin.settings.list(),
  })

  // Pre-fill draft from existing values
  useEffect(() => {
    const items = listQ.data?.items ?? []
    const next: Record<string, string> = {}
    for (const it of items) {
      // secret rows return null value; we leave draft blank unless user types
      if (!it.is_secret && it.value != null) {
        next[it.key] = it.value
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
  const lookup = Object.fromEntries(items.map((i) => [i.key, i]))

  const setDraftFor = (k: string, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }))

  return (
    <div className="admin-settings">
      <PageHeader
        title="设置"
        description="page-agent 是基于自然语言操作 admin 页面的代理；AI 排版是上传 .docx 后可选的 LLM Markdown 清洗服务。两者独立配置。预设 base_url = https://api.minimax.chat/v1、model = MiniMax-M3。仅在 admin 路由内启用。API Key 在服务端 Fernet 加密落库，不会发送到浏览器。"
      />

      <div className="admin-settings__list">
        {KNOWN_KEYS.map((k) => {
          const row = lookup[k.key]
          const value = draft[k.key] ?? ''
          return (
            <Card key={k.key} variant="outlined">
              <div className="admin-settings__row">
                <label className="admin-settings__label">
                  {k.label}
                  <span className="admin-settings__key">{k.key}</span>
                  {row?.description && <span className="admin-settings__desc">{row.description}</span>}
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
                      placeholder={row?.masked || '尚未配置'}
                      value={value}
                      onChange={(e) => setDraftFor(k.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
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
                      disabled={testMut.isPending || !row}
                    >
                      测试连通
                    </Button>
                  )}
                </div>
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

      <Card variant="outlined" style={{ marginTop: 'var(--space-5)' }}>
        <CardHeader>
          <CardTitle>其他设置（只读）</CardTitle>
        </CardHeader>
        <table className="admin-table" style={{ margin: 0 }}>
          <thead>
            <tr><th>Key</th><th>值</th><th>更新时间</th><th>更新人</th></tr>
          </thead>
          <tbody>
            {items.filter((i) => !KNOWN_KEYS.some((k) => k.key === i.key)).map((i) => (
              <tr key={i.key}>
                <td>{i.key}</td>
                <td>{i.is_secret ? i.masked : i.value}</td>
                <td>{new Date(i.updated_at).toLocaleString('zh-CN')}</td>
                <td>{i.updated_by}</td>
              </tr>
            ))}
            {items.filter((i) => !KNOWN_KEYS.some((k) => k.key === i.key)).length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--admin-text-muted)' }}>无</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="admin-settings__hint">
        <ZapOff size={14} /> page-agent 仅在 admin 路由加载。启用后右下角会出现代理输入框，
        关闭后下次进入 admin 页面即消失（<RefreshCw size={14} /> 刷新当前页可立即生效）。
      </div>
    </div>
  )
}
