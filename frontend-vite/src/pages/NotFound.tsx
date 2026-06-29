import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1rem',
      padding: '2rem',
      textAlign: 'center',
    }}>
      <h1 style={{ fontSize: '4rem', margin: 0, color: '#1A1A2E' }}>404</h1>
      <p style={{ color: '#666' }}>您访问的页面不存在</p>
      <Link to="/" style={{ color: '#C9A84C' }}>返回首页</Link>
    </div>
  )
}
