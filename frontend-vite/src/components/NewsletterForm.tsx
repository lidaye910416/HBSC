import { useState } from 'react'
import { Mail, CheckCircle } from 'lucide-react'
import { api } from '../services/api'
import './NewsletterForm.css'

export function NewsletterForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !email.includes('@')) {
      setError('请输入有效的邮箱地址')
      return
    }
    setStatus('loading')
    setError('')
    try {
      await api.newsletter(email)
      setStatus('success')
    } catch {
      setStatus('error')
      setError('订阅失败，请稍后重试')
    }
  }

  return (
    <div className="newsletter">
      <div className="newsletter__icon">
        <Mail size={28} strokeWidth={1.5} />
      </div>
      <h3 className="newsletter__title">订阅湖北数创</h3>
      <p className="newsletter__desc">
        接收来自湖北数创的最新期刊内容、研究动态和行业洞察。每季度一期，精选推送。
      </p>
      {status === 'success' ? (
        <div className="newsletter__success">
          <CheckCircle size={20} strokeWidth={1.5} />
          <span>订阅成功，感谢您的关注！</span>
        </div>
      ) : (
        <form className="newsletter__form" onSubmit={handleSubmit}>
          <input
            type="email"
            className="input newsletter__input"
            placeholder="输入您的邮箱"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary newsletter__btn" disabled={status === 'loading'}>
            {status === 'loading' ? '订阅中...' : '立即订阅'}
          </button>
          {error && <p className="newsletter__error">{error}</p>}
        </form>
      )}
    </div>
  )
}
