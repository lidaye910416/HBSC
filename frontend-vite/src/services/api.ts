// 同源相对路径：开发期由 Vite proxy 转给后端 8000，生产期由 Nginx 转给后端
const API_BASE = ''

/**
 * Structured error from the API. Carries the stable error code from the
 * backend envelope `{error: {code, message, ...extras}}` plus the raw body
 * so callers can branch on `err.code` (e.g. "incomplete_journal") and read
 * extras like `missing` categories.
 */
export class ApiError extends Error {
  code: string;
  status: number;
  body: unknown;
  constructor(message: string, code: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

function codeForStatus(status: number): string {
  return {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    422: 'validation_error',
    429: 'rate_limited',
    500: 'internal_error',
  }[status] || 'error';
}

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
      throw new ApiError('Session expired', 'unauthorized', 401, null)
    }
    // Parse new error envelope {error: {code, message, ...extras}} with
    // backward-compat fallback to legacy {detail}.
    let body: unknown = null
    try {
      body = await res.json()
    } catch {}
    const errBody = (body as { error?: { code?: string; message?: string } } | null)?.error
    const message =
      errBody?.message ||
      (body as { detail?: string } | null)?.detail ||
      res.statusText ||
      'Request failed'
    const code = errBody?.code || codeForStatus(res.status)
    throw new ApiError(message, code, res.status, body)
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

export interface SearchResultItem {
  id: number;
  title: string;
  slug: string;
  category?: string;
  type: 'article';
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
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
  search: (q: string): Promise<SearchResponse> =>
    request<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`),
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
      if (res.ok || res.status === 401) return
      let body: unknown = null
      try { body = await res.json() } catch {}
      const errBody = (body as { error?: { code?: string; message?: string } } | null)?.error
      const message =
        errBody?.message ||
        (body as { detail?: string } | null)?.detail ||
        res.statusText ||
        'Logout failed'
      throw new ApiError(message, errBody?.code || codeForStatus(res.status), res.status, body)
    },
  },

  public: {
    /**
     * Public page-agent proxy used by the home-page FAB. No admin auth.
     * The same backend AdminSetting rows (`page_agent.*`) drive the
     * enablement flag; flipping the admin toggle to true makes the FAB
     * appear on the next visitor refetch.
     */
    agent: {
      config: (): Promise<{
        enabled: boolean
        model: string
        base_url: string
        system_prompt: string
      }> =>
        request('/api/public/agent/config'),
      execute: (messages: Array<{ role: string; content: string }>) =>
        request<{ content: string }>('/api/public/agent/execute', {
          method: 'POST',
          body: JSON.stringify({ messages }),
        }),
      llm: ({ url, init }: { url: string; init: RequestInit }) =>
        request<unknown>('/api/public/agent/llm', {
          method: 'POST',
          body: JSON.stringify({ url, init }),
        }),
    },

    /**
     * 数创智伴 「播一下」 tab backend.
     * Mirrors the public_agent shape: no admin auth, anonymous-friendly,
     * driven by  AdminSetting rows.
     * See backend/app/routers/public_podcast_router.py + docs/superpowers/specs/2026-07-20-fab-podcast-mode-design.md.
     */
    podcast: {
      config: (): Promise<PodcastConfig> => request<PodcastConfig>('/api/public/podcast/config'),

      /**
       * One-shot generate: extract → script → synthesize.
       * Returns a ready-to-play job. The browser-side <audio> element
       * points at  (or downloads through /api/public/podcast/download/{job_id}
       * if the upstream origin is cross-origin to the page).
       *
       * Throws ApiError with code 'minicast_unavailable' (503) when the
       * upstream MiniCast service is down — callers should fall back to
       * the workbench at /labs/minicast/?embed=1&source=<URL>.
       */
      generate: (body: { url: string; title_hint?: string }) =>
        request<PodcastGenerateResult>('/api/public/podcast/generate', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      article: (slug: string) =>
        request<PodcastAudioStatus>(`/api/public/podcast/article/${encodeURIComponent(slug)}`),
    },
  },

  admin: {
    articles: {
      list: (params?: {
        status?: string; category?: string; q?: string; featured?: boolean;
        sort_by?: 'updated_at' | 'published_at' | 'title';
        sort_dir?: 'asc' | 'desc';
        page?: number; per_page?: number;
      }) => {
        const sp = new URLSearchParams()
        if (params?.status) sp.set('status', params.status)
        if (params?.category) sp.set('category', params.category)
        if (params?.q) sp.set('q', params.q)
        if (params?.featured !== undefined) sp.set('featured', String(params.featured))
        if (params?.sort_by) sp.set('sort_by', params.sort_by)
        if (params?.sort_dir) sp.set('sort_dir', params.sort_dir)
        if (params?.page) sp.set('page', String(params.page))
        if (params?.per_page) sp.set('per_page', String(params.per_page))
        return request<PaginatedResponse<ArticleList & { status: string; featured: boolean; updated_at?: string; podcast_status?: PodcastAudioStatus['status'] }>>('/api/admin/articles?' + sp.toString())
      },
      get: (id: number): Promise<Article & { status: string; featured: boolean; cover_image_alt?: string; updated_at?: string }> =>
        request(`/api/admin/articles/${id}`),
      create: (body: Record<string, unknown>) =>
        request('/api/admin/articles', { method: 'POST', body: JSON.stringify(body) }),
      update: (id: number, body: Record<string, unknown>) =>
        request(`/api/admin/articles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
      podcast: {
        get: (id: number) => request<PodcastAudioStatus>(`/api/admin/articles/${id}/podcast`),
        regenerate: (id: number) => request<PodcastAudioStatus>(`/api/admin/articles/${id}/podcast`, { method: 'POST' }),
        delete: (id: number) => request(`/api/admin/articles/${id}/podcast`, { method: 'DELETE' }),
      },
      delete: (id: number) =>
        request(`/api/admin/articles/${id}`, { method: 'DELETE' }),
      // Multipart upload — must NOT set Content-Type: application/json
      uploadCover: async (id: number, file: File) => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(API_BASE + `/api/admin/articles/${id}/cover`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/admin/login'
            throw new ApiError('Session expired', 'unauthorized', 401, null)
          }
          let body: unknown = null
          try { body = await res.json() } catch {}
          const errBody = (body as { error?: { code?: string; message?: string } } | null)?.error
          const message =
            errBody?.message ||
            (body as { detail?: string } | null)?.detail ||
            res.statusText ||
            'Upload failed'
          throw new ApiError(message, errBody?.code || codeForStatus(res.status), res.status, body)
        }
        return res.json()
      },
      clearCover: (id: number) =>
        request(`/api/admin/articles/${id}/cover`, { method: 'DELETE' }),
      toggleFeatured: (id: number) =>
        request(`/api/admin/articles/${id}/featured`, { method: 'PATCH' }),
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
            throw new ApiError('Session expired', 'unauthorized', 401, null)
          }
          let body: unknown = null
          try { body = await res.json() } catch {}
          const errBody = (body as { error?: { code?: string; message?: string } } | null)?.error
          const message =
            errBody?.message ||
            (body as { detail?: string } | null)?.detail ||
            res.statusText ||
            'Import failed'
          throw new ApiError(message, errBody?.code || codeForStatus(res.status), res.status, body)
        }
        return res.json() as Promise<{
          title: string
          content_markdown: string
          suggested_slug: string
          warnings: string[]
          images: Array<{ url: string; filename: string; size: number; original_name: string }>
        }>
      },
      typeset: (
        content_markdown: string,
        options?: { style?: 'academic' | 'business' | 'concise'; variant?: number },
      ): Promise<{
        content_markdown: string
        warnings: string[]
        model: string
        prompt_version: string
      }> =>
        request('/api/admin/articles/typeset', {
          method: 'POST',
          body: JSON.stringify({
            content_markdown,
            style: options?.style,
            variant: options?.variant,
          }),
        }),
    },
    covers: {
      // 批量封面健康检查：返回每个期刊/文章的 cover_image URL 是否还指向一个真实文件
      status: (): Promise<{
        journals: Array<{ id: number; title: string; slug: string; cover_image: string | null; status: 'ok' | 'missing' | 'missing_file'; reason?: string | null }>
        articles: Array<{ id: number; title: string; slug: string; journal_id: number | null; cover_image: string | null; status: 'ok' | 'missing' | 'missing_file'; reason?: string | null }>
      }> => request('/api/admin/covers/status'),
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
      create: (body: Record<string, unknown>): Promise<JournalAdmin & { id: number }> =>
        request('/api/admin/journals', { method: 'POST', body: JSON.stringify(body) }),
      get: (id: number): Promise<JournalAdmin> =>
        request<JournalAdmin>(`/api/admin/journals/${id}`),
      update: (id: number, body: Record<string, unknown>) =>
        request(`/api/admin/journals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (id: number) =>
        request(`/api/admin/journals/${id}`, { method: 'DELETE' }),
      // Multipart upload — must NOT set Content-Type: application/json
      uploadCover: async (id: number, file: File) => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(API_BASE + `/api/admin/journals/${id}/cover`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/admin/login'
            throw new ApiError('Session expired', 'unauthorized', 401, null)
          }
          let body: unknown = null
          try { body = await res.json() } catch {}
          const errBody = (body as { error?: { code?: string; message?: string } } | null)?.error
          const message =
            errBody?.message ||
            (body as { detail?: string } | null)?.detail ||
            res.statusText ||
            'Upload failed'
          throw new ApiError(message, errBody?.code || codeForStatus(res.status), res.status, body)
        }
        return res.json() as Promise<JournalAdmin>
      },
      clearCover: (id: number) =>
        request(`/api/admin/journals/${id}/cover`, { method: 'DELETE' }),
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
        default_value?: string | null;
        updated_at?: string | null; updated_by?: string | null;
      }> }> => request('/api/admin/settings'),
      upsert: (key: string, value: string, description?: string) =>
        request(`/api/admin/settings/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({ value, description }),
        }),
      test: (key: string) =>
        request(`/api/admin/settings/${encodeURIComponent(key)}/test`, { method: 'POST' }),
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
            throw new ApiError('Session expired', 'unauthorized', 401, null)
          }
          let body: unknown = null
          try { body = await res.json() } catch {}
          const errBody = (body as { error?: { code?: string; message?: string } } | null)?.error
          const message =
            errBody?.message ||
            (body as { detail?: string } | null)?.detail ||
            res.statusText ||
            'Upload failed'
          throw new ApiError(message, errBody?.code || codeForStatus(res.status), res.status, body)
        }
        return res.json()
      },
      delete: (id: number) =>
        request(`/api/admin/media/${id}`, { method: 'DELETE' }),
    },
  },
}

/**
 * Backend contract for /api/public/podcast/* (see backend/app/routers/public_podcast_router.py).
 * Keep these types in sync with the router Pydantic models.
 */
export interface PodcastVoiceInfo {
  label: string       // hbsc product name: 小数 / 小创
  subtitle: string    // one-liner describing tone
  emoji: string
  gender: "male" | "female"
}

export interface PodcastConfig {
  enabled: boolean
  minicast_base_url: string
  voices: Record<string, PodcastVoiceInfo>
  default_voice_a: string
  default_voice_b: string
}

export interface PodcastGenerateResult {
  job_id: string
  mp3_url: string
  srt_url?: string
  duration_seconds: number
  total_chars: number
  segment_count: number
  script_text: string
  fallback_url: string
  mode?: string
}

export interface PodcastAudioStatus {
  status: 'pending' | 'generating' | 'ready' | 'failed'
  job_id?: string | null
  mp3_url?: string
  srt_url?: string
  duration_seconds?: number
  total_chars?: number
  segment_count?: number
  script_text?: string
  error_message?: string
  updated_at?: string | null
}
