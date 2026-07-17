import { useEffect, useRef, useState } from 'react'
import { Mail, CheckCircle } from 'lucide-react'
import { gsap } from 'gsap'
import { motionAllowed } from '../animations/reducedMotion'
import { api } from '../services/api'
import './NewsletterForm.css'

type Status = 'idle' | 'loading' | 'success' | 'error'

export function NewsletterForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const stateRef = useRef<HTMLDivElement>(null)
  const initialMount = useRef(true)

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

  // P1-08: Animate the form <-> success transition with an auto-height + opacity
  // timeline. Skip the first paint so the form doesn't flicker from 0 height on
  // mount, and bail out entirely under `prefers-reduced-motion` / Save-Data.
  useEffect(() => {
    if (!motionAllowed()) return
    if (initialMount.current) {
      initialMount.current = false
      return
    }
    const el = stateRef.current
    if (!el) return
    const tween = gsap.fromTo(
      el,
      { height: 0, autoAlpha: 0, overflow: 'hidden' },
      {
        height: 'auto',
        autoAlpha: 1,
        duration: 0.35,
        ease: 'power2.out',
        clearProps: 'overflow',
      },
    )
    return () => {
      tween.kill()
    }
  }, [status])

  return (
    <div className="newsletter">
      <div className="newsletter__icon">
        <Mail size={28} strokeWidth={1.5} />
      </div>
      <h3 className="newsletter__title">订阅湖北数创</h3>
      <p className="newsletter__desc">
        接收来自湖北数创的最新期刊内容、研究动态和行业洞察。每季度一期，精选推送。
      </p>
      <div className="newsletter__state" ref={stateRef}>
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
            <button data-ai-blocked="newsletter" type="submit" className="btn btn-primary newsletter__btn" disabled={status === 'loading'}>
              {status === 'loading' ? '订阅中...' : '立即订阅'}
            </button>
            {error && <p className="newsletter__error">{error}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
