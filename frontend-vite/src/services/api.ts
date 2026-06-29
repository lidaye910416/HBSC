// 同源相对路径：开发期由 Vite proxy 转给后端 8000，生产期由 Nginx 转给后端
const API_BASE = ''

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const res = await fetch(API_BASE + path, {
    ...options,
    credentials: 'include',
    headers,
  })
  if (!res.ok) {
    // Global 401 handler
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.location.href = '/admin/login'
      throw new Error('Session expired')
    }
    // Try to parse new error format {error: {code, message}}
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body.error?.message || body.detail || msg
    } catch {}
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export interface Article {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  content?: string;
  cover_image?: string;
  category?: string;
  author_name?: string;
  author_avatar?: string;
  published_at?: string;
  reading_time: number;
  views: number;
  tags?: string[];
  related?: Article[];
}

export interface ArticleList {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  cover_image?: string;
  category?: string;
  author_name?: string;
  author_avatar?: string;
  published_at?: string;
  reading_time: number;
  views: number;
  tags?: string[];
}

export interface JournalAdmin {
  id: number;
  title: string;
  slug: string;
  cover_image?: string;
  description?: string;
  issue_number?: string;
  status: 'draft' | 'published';
  published_at?: string;
  article_count: number;
  updated_at?: string;
}

export interface JournalCompleteness {
  战略与政策: number;
  技术与产业: number;
  方案与思考: number;
  动态与文化: number;
  complete: boolean;
}

export interface Issue {
  id: number;
  title: string;
  slug: string;
  cover_image?: string;
  description?: string;
  issue_number?: string;
  published_at?: string;
  article_count: number;
}

export interface Researcher {
  id: number;
  name: string;
  name_en?: string;
  title?: string;
  bio?: string;
  avatar?: string;
  research_area?: string;
  email?: string;
  orcid?: string;
  twitter?: string;
  linkedin?: string;
  order: number;
}

export interface MediaOut {
  id: number;
  filename: string;
  url: string;
  original_name: string;
  mime: string;
  size: number;
  uploaded_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export const api = {
  issues: {
    list: (): Promise<Issue[]> => request<Issue[]>('/api/issues'),
    detail: (slug: string): Promise<Issue & { articles: ArticleList[] }> =>
      request<Issue & { articles: ArticleList[] }>(`/api/issues/${slug}`),
  },
  articles: {
    list: (params?: { category?: string; page?: number; per_page?: number }): Promise<PaginatedResponse<ArticleList>> => {
      const sp = new URLSearchParams()
      if (params?.category) sp.set('category', params.category)
      if (params?.page) sp.set('page', String(params.page))
      if (params?.per_page) sp.set('per_page', String(params.per_page))
      return request<PaginatedResponse<ArticleList>>('/api/articles?' + sp.toString())
    },
    featured: (): Promise<ArticleList[]> => request<ArticleList[]>('/api/articles/featured'),
    detail: (slug: string): Promise<Article> => request<Article>(`/api/articles/${slug}`),
    view: (slug: string): Promise<void> =>
      request<void>(`/api/articles/${slug}/view`, { method: 'POST' }),
  },
  team: (): Promise<Researcher[]> => request<Researcher[]>('/api/team'),
  search: (q: string) => request(`/api/search?q=${encodeURIComponent(q)}`),
  newsletter: (email: string) =>
    request(`/api/newsletter?email=${encodeURIComponent(email)}`, { method: 'POST' }),

  auth: {
    login: async (username: string, password: string): Promise<{ access_token: string; token_type: string; expires_at: string }> => {
      return request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
    },
    me: async (): Promise<{ id: number; username: string; role: string }> => {
      return request('/api/auth/me')
    },
    logout: async (): Promise<void> => {
      // 登出接口应宽容：401 表示已无会话，仍视为成功
      const res = await fetch(API_BASE + '/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 401) {
        let msg = res.statusText
        try {
          const body = await res.json()
          msg = body.error?.message || body.detail || msg
        } catch {}
        throw new Error(msg)
      }
    },
  },

  admin: {
    articles: {
      list: (params?: { status?: string; category?: string; q?: string; page?: number; per_page?: number }) => {
        const sp = new URLSearchParams()
        if (params?.status) sp.set('status', params.status)
        if (params?.category) sp.set('category', params.category)
        if (params?.q) sp.set('q', params.q)
        if (params?.page) sp.set('page', String(params.page))
        if (params?.per_page) sp.set('per_page', String(params.per_page))
        return request<PaginatedResponse<ArticleList & { status: string; updated_at?: string }>>('/api/admin/articles?' + sp.toString())
      },
      get: (id: number): Promise<Article & { status: string; featured: boolean; cover_image_alt?: string; updated_at?: string }> =>
        request(`/api/admin/articles/${id}`),
      create: (body: Record<string, unknown>) =>
        request('/api/admin/articles', { method: 'POST', body: JSON.stringify(body) }),
      update: (id: number, body: Record<string, unknown>) =>
        request(`/api/admin/articles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (id: number) =>
        request(`/api/admin/articles/${id}`, { method: 'DELETE' }),
      importDocx: async (file: File) => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(API_BASE + '/api/admin/articles/import-docx', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/admin/login'
            throw new Error('Session expired')
          }
          let msg = res.statusText
          try {
            const body = await res.json()
            msg = body.error?.message || body.detail || msg
          } catch {}
          throw new Error(msg)
        }
        return res.json() as Promise<{
          title: string
          content_markdown: string
          suggested_slug: string
          warnings: string[]
          images: Array<{ url: string; filename: string; size: number; original_name: string }>
        }>
      },
    },
    journals: {
      list: (params?: { q?: string; status?: string; page?: number; per_page?: number }): Promise<PaginatedResponse<JournalAdmin>> => {
        const sp = new URLSearchParams()
        if (params?.q) sp.set('q', params.q)
        if (params?.status) sp.set('status', params.status)
        if (params?.page) sp.set('page', String(params.page))
        if (params?.per_page) sp.set('per_page', String(params.per_page))
        return request<PaginatedResponse<JournalAdmin>>('/api/admin/journals?' + sp.toString())
      },
      create: (body: Record<string, unknown>) =>
        request('/api/admin/journals', { method: 'POST', body: JSON.stringify(body) }),
      update: (id: number, body: Record<string, unknown>) =>
        request(`/api/admin/journals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (id: number) =>
        request(`/api/admin/journals/${id}`, { method: 'DELETE' }),
      completeness: (id: number): Promise<JournalCompleteness> =>
        request<JournalCompleteness>(`/api/admin/journals/${id}/completeness`),
      completenessBatch: (ids: number[]): Promise<Record<string, JournalCompleteness>> =>
        request<Record<string, JournalCompleteness>>(`/api/admin/journals/completeness`, {
          method: 'POST',
          body: JSON.stringify({ ids }),
        }),
      publish: (id: number): Promise<JournalAdmin> =>
        request<JournalAdmin>(`/api/admin/journals/${id}/publish`, { method: 'POST' }),
      unpublish: (id: number): Promise<JournalAdmin> =>
        request<JournalAdmin>(`/api/admin/journals/${id}/unpublish`, { method: 'POST' }),
      articlesByCategory: (id: number): Promise<{
        strategy: Array<{ id: number; title: string; slug: string; category: string; status: string; updated_at?: string }>
        technology: Array<{ id: number; title: string; slug: string; category: string; status: string; updated_at?: string }>
        solution: Array<{ id: number; title: string; slug: string; category: string; status: string; updated_at?: string }>
        dynamics: Array<{ id: number; title: string; slug: string; category: string; status: string; updated_at?: string }>
        completeness: JournalCompleteness
      }> =>
        request(`/api/admin/journals/${id}/articles-by-category`),
    },
    settings: {
      list: (): Promise<{ items: Array<{
        key: string; value?: string | null; masked?: string | null;
        is_secret: boolean; description: string;
        updated_at: string; updated_by: string;
      }> }> => request('/api/admin/settings'),
      upsert: (key: string, value: string, description?: string) =>
        request(`/api/admin/settings/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({ value, description }),
        }),
      test: (key: string) =>
        request(`/api/admin/settings/${encodeURIComponent(key)}/test`, { method: 'POST' }),
    },
    agent: {
      config: (): Promise<{ enabled: boolean; model: string; base_url: string }> =>
        request('/api/admin/agent/config'),
      execute: (messages: Array<{ role: string; content: string }>) =>
        request('/api/admin/agent/execute', {
          method: 'POST',
          body: JSON.stringify({ messages }),
        }),
    },
    media: {
      list: (page = 1, per_page = 50): Promise<PaginatedResponse<MediaOut>> =>
        request<PaginatedResponse<MediaOut>>(`/api/admin/media?page=${page}&per_page=${per_page}`),
      // Multipart upload — must NOT set Content-Type: application/json
      upload: async (file: File, kind: 'image' | 'table' = 'image') => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(API_BASE + `/api/admin/media?kind=${kind}`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/admin/login'
            throw new Error('Session expired')
          }
          let msg = res.statusText
          try {
            const body = await res.json()
            msg = body.error?.message || body.detail || msg
          } catch {}
          throw new Error(msg)
        }
        return res.json()
      },
      delete: (id: number) =>
        request(`/api/admin/media/${id}`, { method: 'DELETE' }),
    },
  },
}