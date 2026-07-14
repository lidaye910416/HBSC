import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import './Footer.css'

const researchLinks = [
  { label: '战略与政策', path: '/articles?category=战略与政策' },
  { label: '技术与产业', path: '/articles?category=技术与产业' },
  { label: '方案与思考', path: '/articles?category=方案与思考' },
  { label: '动态与文化', path: '/articles?category=动态与文化' },
]

const siteLinks = [
  { label: '期刊', path: '/articles' },
  { label: '数创实验室', path: '/labs' },
  { label: '关于我们', path: '/about' },
]

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner container">
        <div className="footer__brand">
          <div className="footer__logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="2" y="2" width="28" height="28" rx="6" fill="rgba(37, 99, 235, 0.15)" stroke="#2563eb" strokeWidth="1.5"/>
              <circle cx="16" cy="16" r="6" stroke="#2563eb" strokeWidth="1.5"/>
              <circle cx="16" cy="16" r="2" fill="#2563eb"/>
            </svg>
            <span>湖北数创</span>
          </div>
          <p className="footer__tagline">
            智领AI荆楚新程，数绘产业发展新篇<br/>
            记录数字变革、传播前沿理念、赋能产业升级
          </p>
          <div className="footer__social">
            <a href="mailto:contact@jisi.tech" aria-label="邮箱"><Mail size={16} strokeWidth={1.5}/></a>
            <a href="https://github.com/jiangshang" aria-label="GitHub" target="_blank" rel="noopener noreferrer"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg></a>
          </div>
        </div>

        <div className="footer__links">
          <div className="footer__col">
            <h4 className="footer__col-title">内容分类</h4>
            <ul>
              {researchLinks.map(l => (
                <li key={l.path}><Link to={l.path}>{l.label}</Link></li>
              ))}
            </ul>
          </div>
          <div className="footer__col">
            <h4 className="footer__col-title">导航</h4>
            <ul>
              {siteLinks.map(l => (
                <li key={l.path}><Link to={l.path}>{l.label}</Link></li>
              ))}
            </ul>
          </div>
          <div className="footer__col">
            <h4 className="footer__col-title">联系我们</h4>
            <ul className="footer__contact">
              <li>contact@hbdit.com</li>
              <li>湖北省小龟山金融文化公园19栋</li>
              <li className="footer__contact-desc">湖北数创是湖北数字产业创新研究的内部期刊，展示数字产业政策解读、技术趋势分析、数字化转型案例。</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="footer__bottom">
        <div className="container">
          <p>© 2024 湖北数创 · Hubei Digital Innovation</p>
          <p className="footer__legal">
            <a href="#">隐私政策</a> · <a href="#">使用条款</a>
          </p>
        </div>
      </div>
    </footer>
  )
}
