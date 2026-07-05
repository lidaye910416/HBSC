import { useEffect, useRef, useState } from 'react'
import { ArrowRight, AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react'
import { Modal, Button } from '../ui'
import { ArticleBody } from '../ArticleBody'
import './TypesetPreviewDialog.css'

export type TypesetStyle = 'academic' | 'business' | 'concise'

export interface TypesetPreviewDialogProps {
  open: boolean
  onClose: () => void
  onApply: (cleaned: string) => void
  /** The article slug — passed through to ArticleBody so image paths resolve. */
  slug: string
  before: string
  after: string
  warnings: string[]
  model: string
  promptVersion: string
  /** Initial style selected in the radio group. */
  initialStyle?: TypesetStyle
  /**
   * Called whenever the admin picks a new style OR clicks "换个版本".
   * Parent must refetch the typeset result with the new style/variant and
   * pass the new `after` back via props. Dialog stays open while busy.
   */
  onRegenerate: (next: { style: TypesetStyle; variant: number }) => void
  regenerating?: boolean
}

const STYLE_OPTIONS: Array<{ value: TypesetStyle; label: string; hint: string }> = [
  { value: 'academic', label: '学术', hint: '严谨、保留术语与论证' },
  { value: 'business', label: '商务', hint: '突出结论与可量化指标' },
  { value: 'concise', label: '精简', hint: '压缩篇幅、保留核心观点' },
]

export function TypesetPreviewDialog({
  open,
  onClose,
  onApply,
  slug,
  before,
  after,
  warnings,
  model,
  promptVersion,
  initialStyle = 'academic',
  onRegenerate,
  regenerating = false,
}: TypesetPreviewDialogProps) {
  const [style, setStyle] = useState<TypesetStyle>(initialStyle)
  const [variant, setVariant] = useState(0)

  // Single-level undo: stash the *applied* snapshot when the admin first
  // sees the dialog. Reverting restores this exact `before` regardless of
  // how many regenerations happened since.
  const appliedSnapshotRef = useRef<string | null>(null)

  useEffect(() => {
    if (open) {
      // Open: refresh state + capture the original `before` so revert can
      // always restore to "what the admin typed before opening this dialog".
      setStyle(initialStyle)
      setVariant(0)
      appliedSnapshotRef.current = before
    }
    // intentionally only react to `open` transitions — `before`/`initialStyle`
    // shouldn't reset state mid-regeneration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleApply = (cleaned: string) => {
    // Remember exactly what we applied so the revert button can put it back.
    appliedSnapshotRef.current = cleaned
    onApply(cleaned)
  }

  const handleRevert = () => {
    const snapshot = appliedSnapshotRef.current
    if (snapshot !== null) onApply(snapshot)
  }

  const handleVariantB = () => {
    const nextVariant = variant + 1
    setVariant(nextVariant)
    onRegenerate({ style, variant: nextVariant })
  }

  const handleStyleChange = (next: TypesetStyle) => {
    if (next === style) return
    setStyle(next)
    setVariant(0)
    onRegenerate({ style: next, variant: 0 })
  }

  const stats = {
    before: before?.length ?? 0,
    after: after?.length ?? 0,
    delta: (after?.length ?? 0) - (before?.length ?? 0),
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="AI 排版预览"
      footer={
        <>
          <Button variant="secondary" onClick={handleRevert} title="恢复到打开此对话框时的原文">
            <RotateCcw size={14} /> 撤销本次应用
          </Button>
          <Button variant="secondary" onClick={onClose}>关闭</Button>
          <Button
            onClick={() => handleApply(after)}
            disabled={!after || regenerating}
          >
            <ArrowRight size={14} /> 应用到编辑器
          </Button>
        </>
      }
    >
      {warnings.length > 0 && (
        <div className="typeset-dialog__warnings">
          {warnings.map((w, i) => (
            <div key={i} className="typeset-dialog__warning">
              <AlertTriangle size={14} /> {w}
            </div>
          ))}
        </div>
      )}

      <form
        className="typeset-dialog__form"
        onSubmit={(e) => {
          e.preventDefault()
          if (after && !regenerating) handleApply(after)
        }}
      >
        <div className="typeset-dialog__controls">
          <fieldset className="typeset-dialog__styles" aria-label="排版风格">
            <legend className="typeset-dialog__label">排版风格</legend>
            {STYLE_OPTIONS.map((opt) => (
              <label key={opt.value} className="typeset-dialog__radio">
                <input
                  type="radio"
                  name="typeset-style"
                  value={opt.value}
                  checked={style === opt.value}
                  onChange={() => handleStyleChange(opt.value)}
                  disabled={regenerating}
                />
                <span className="typeset-dialog__radio-label">
                  <strong>{opt.label}</strong>
                  <small>{opt.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="typeset-dialog__variant">
            <Button
              type="button"
              variant="secondary"
              icon={<RefreshCw size={14} />}
              onClick={handleVariantB}
              loading={regenerating}
              disabled={regenerating}
              title="用相同风格生成另一版本（变体 #{variant + 1}）"
            >
              换个版本
            </Button>
          </div>
        </div>

        <div className="typeset-dialog__stats">
          <span>原文 <strong>{stats.before}</strong> 字符</span>
          <ArrowRight size={12} />
          <span>清洗后 <strong>{stats.after}</strong> 字符</span>
          <span className="typeset-dialog__delta">
            ({stats.delta >= 0 ? '+' : ''}{stats.delta})
          </span>
          <span className="typeset-dialog__meta">
            模型 {model} · prompt v{promptVersion} · 风格 {style} · 变体 #{variant}
          </span>
        </div>

        <div className="typeset-dialog__cols typeset-dialog__cols--3">
          <div className="typeset-dialog__col">
            <div className="typeset-dialog__col-title">原文</div>
            <pre className="typeset-dialog__pre">{before}</pre>
          </div>
          <div className="typeset-dialog__col">
            <div className="typeset-dialog__col-title">清洗后（Markdown）</div>
            <pre className="typeset-dialog__pre">{after}</pre>
          </div>
          <div className="typeset-dialog__col">
            <div className="typeset-dialog__col-title">预览（页面效果）</div>
            <div className="typeset-dialog__render">
              <ArticleBody content={after} slug={slug || 'draft'} className="prose prose-lg" />
            </div>
          </div>
        </div>
        {/* Hidden submit so Enter inside the radios triggers apply. */}
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}