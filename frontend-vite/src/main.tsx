import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'

// FOUC-prevention: set theme attribute on <html> before React mounts.
// This avoids a flash of the default (dark) theme when the user picked light.
const saved = (() => {
  try { return localStorage.getItem('hbsc-theme') } catch { return null }
})()
if (saved === 'light') document.documentElement.dataset.theme = 'light'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
