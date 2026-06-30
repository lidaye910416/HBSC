import { useMemo } from 'react'
import { ArrowRight, AlertTriangle } from 'lucide-react'
import { Modal, Button } from '../ui'
import './TypesetPreviewDialog.css'

export interface TypesetPreviewDialogProps {
  open: boolean
  onClose: () => void
  onApply: (cleaned: string) => void
  before: string
  after: string
  warnings: string[]
  model: string
  promptVersion: string
}

export function TypesetPreviewDialog({
  open,
  onClose,
  onApply,
  before,
  after,
  warnings,
  model,
  promptVersion,
}: TypesetPreviewDialogProps) {
  const stats = useMemo(() => {
    const b = before?.length ?? 0
    const a = after?.length ?? 0
    return {
      before: b,
      after: a,
      delta: a - b,
    }
  }, [before, after])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="AI 排版预览"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            onClick={() => onApply(after)}
            disabled={!after}
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

      <div className="typeset-dialog__stats">
        <span>原文 <strong>{stats.before}</strong> 字符</span>
        <ArrowRight size={12} />
        <span>清洗后 <strong>{stats.after}</strong> 字符</span>
        <span className="typeset-dialog__delta">
          ({stats.delta >= 0 ? '+' : ''}{stats.delta})
        </span>
        <span className="typeset-dialog__meta">模型 {model} · prompt v{promptVersion}</span>
      </div>

      <div className="typeset-dialog__cols">
        <div className="typeset-dialog__col">
          <div className="typeset-dialog__col-title">原文</div>
          <pre className="typeset-dialog__pre">{before}</pre>
        </div>
        <div className="typeset-dialog__col">
          <div className="typeset-dialog__col-title">清洗后</div>
          <pre className="typeset-dialog__pre">{after}</pre>
        </div>
      </div>
    </Modal>
  )
}
