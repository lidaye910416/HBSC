import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Navigation } from './components/Navigation'
import { Footer } from './components/Footer'
import { Home } from './pages/Home'
import { Articles } from './pages/Articles'
import { ArticleDetail } from './pages/ArticleDetail'
import { Issues } from './pages/Issues'
import { IssueDetail } from './pages/IssueDetail'
import { About } from './pages/About'
import { SearchPage } from './pages/Search'
import { LabsPage } from './labs/LabsPage'
import { MiniCastLab } from './labs/MiniCastLab'
import { ProtectedRoute } from './components/admin/ProtectedRoute'
import { AdminLayout } from './components/admin/AdminLayout'
import { PublicPageAgentMount } from './components/PublicPageAgentMount'
import { Login } from './pages/admin/Login'
import { Dashboard } from './pages/admin/Dashboard'
import { ArticleList } from './pages/admin/ArticleList'
import { ArticleEditor } from './pages/admin/ArticleEditor'
import { JournalList } from './pages/admin/JournalList'
import { JournalEditor } from './pages/admin/JournalEditor'
import { JournalDetail } from './pages/admin/JournalDetail'
import { FeaturedArticles } from './pages/admin/FeaturedArticles'
import { MediaLibrary } from './pages/admin/MediaLibrary'
import { AdminSettings } from './pages/admin/AdminSettings'
import NotFound from './pages/NotFound'
import { ToastProvider } from './components/admin/Toast'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // Smarter retry: don't retry client errors (4xx) — they're deterministic
      // and retrying just wastes time. Allow up to 3 retries for transient
      // failures (5xx, network) which may succeed on retry.
      retry: (failureCount, error: any) => {
        const status = error?.status ?? error?.response?.status
        if (status >= 400 && status < 500) return false
        return failureCount < 3
      },
    },
  },
})

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Fixed full-viewport background — as a sibling div, not inside document flow.
          This div sits BEHIND everything (z-index:-1) and covers the ENTIRE viewport
          at all times, regardless of browser size. */}
      <div className="app-bg" aria-hidden="true" />

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative', zIndex: 0 }}>
        <Navigation />
        <div style={{ flex: 1 }}>{children}</div>
        <Footer />
      </div>
      {/* Public page-agent FAB — sits above the background and footer, scrolls
          with the public Layout but only renders when `page_agent.enabled`
          AND a non-empty api_key are configured in the admin settings. */}
      <PublicPageAgentMount />
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
        <Routes>
          {/* 公开站 */}
          <Route path="/" element={<Layout><Home /></Layout>} />
          <Route path="/articles" element={<Layout><Articles /></Layout>} />
          <Route path="/articles/:slug" element={<Layout><ArticleDetail /></Layout>} />
          <Route path="/issues" element={<Layout><Issues /></Layout>} />
          <Route path="/issues/:slug" element={<Layout><IssueDetail /></Layout>} />
          <Route path="/about" element={<Layout><About /></Layout>} />
          <Route path="/search" element={<Layout><SearchPage /></Layout>} />
          <Route path="/labs" element={<Layout><LabsPage /></Layout>} />
          <Route path="/labs/minicast" element={<Layout><MiniCastLab /></Layout>} />
          <Route path="*" element={<NotFound />} />

          {/* Admin 登录（公开） */}
          <Route path="/admin/login" element={<Login />} />

          {/* Admin 后台（全部受保护） */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="articles" element={<ArticleList />} />
            <Route path="articles/new" element={<ArticleEditor />} />
            {/* Order matters: 'articles/featured' must come before 'articles/:id'
                so the literal "featured" segment doesn't get parsed as an
                article id (which previously caused the editor's
                parseInt("featured") === NaN → 404 → "error page" symptom). */}
            <Route path="articles/featured" element={<FeaturedArticles />} />
            <Route path="articles/:id" element={<ArticleEditor />} />
            <Route path="journals" element={<JournalList />} />
            <Route path="journals/new" element={<JournalEditor />} />
            <Route path="journals/:id" element={<JournalDetail />} />
            <Route path="journals/:id/edit" element={<JournalEditor />} />
            <Route path="media" element={<MediaLibrary />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
