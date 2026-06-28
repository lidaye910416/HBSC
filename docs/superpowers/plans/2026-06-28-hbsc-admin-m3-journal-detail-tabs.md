# HBSC Admin Phase 3 — JournalDetail 4-Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/admin/journals/:id` page with 4 tabs (one per required category) showing the articles in each, with quick "new article" buttons that pre-fill `journal_id` + `category`, and a "Publish journal" CTA gated on completeness.

**Architecture:** New `JournalDetail.tsx` page consumes the existing `api.admin.journals.completeness()` (added in M1) and a new lightweight endpoint `GET /api/admin/journals/{id}/articles-by-category` that returns `{strategy: [...], technology: [...], ...}`. Articles are filtered by status (drafts shown too) so the admin sees what still needs work. The Publish button calls `POST /publish` from M1.

**Tech Stack:** React 19, react-router-dom 6, @tanstack/react-query (already used everywhere), existing CSS variables.

**Spec:** `docs/superpowers/specs/2026-06-28-hbsc-admin-completeness-design.md` §5.1 (route), §5.3 (flow), §9 M3 acceptance.

**Prereq:** Phase 1 (M1) shipped — `Journal.status`, completeness endpoint, settings/types.

---

## File Structure

### New files
- `frontend-vite/src/pages/admin/JournalDetail.tsx` — 4-Tab UI
- `frontend-vite/src/pages/admin/JournalDetail.css` — scoped styles
- `backend/app/routers/admin_journal_articles.py` — `GET /api/admin/journals/{id}/articles-by-category`

### Modified files
- `backend/app/main.py` — register new router
- `backend/app/schemas/admin.py` — add `JournalArticlesByCategoryOut`
- `frontend-vite/src/App.tsx` — add `<Route path="journals/:id" element={<JournalDetail />} />` (replacing the old JournalEditor behavior, which moves to `journals/:id/edit`)
- `frontend-vite/src/services/api.ts` — `api.admin.journals.articlesByCategory(id)`
- `frontend-vite/src/pages/admin/JournalList.tsx` — change row click target
- `frontend-vite/src/pages/admin/JournalList.tsx` — "Edit metadata" still uses `/admin/journals/{id}/edit`

---

## Task 1: Backend — articles-by-category endpoint

**Files:**
- Create: `backend/app/routers/admin_journal_articles.py`
- Modify: `backend/app/schemas/admin.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add schema**

In `backend/app/schemas/admin.py`, append at the bottom:

```python
class JournalArticlesByCategoryOut(BaseModel):
    """Per-category article list for the 4-Tab UI. Drafts included."""
    strategy: list[ArticleAdminOut]      # 战略与政策
    technology: list[ArticleAdminOut]    # 技术与产业
    solution: list[ArticleAdminOut]      # 方案与思考
    dynamics: list[ArticleAdminOut]      # 动态与文化
    completeness: dict
```

- [ ] **Step 2: Write the failing test**

Append to `backend/tests/test_admin_journals.py`:

```python
def test_articles_by_category_groups_correctly(env):
    from app.models.journal import Article, Journal as J
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    jid = db.query(J).filter_by(slug="2026-q1").first().id
    db.add_all([
        Article(title="S1", slug="s1", category="战略与政策", status="published", journal_id=jid),
        Article(title="S2", slug="s2", category="战略与政策", status="draft", journal_id=jid),
        Article(title="T1", slug="t1", category="技术与产业", status="published", journal_id=jid),
        Article(title="O1", slug="o1", category="方案与思考", status="draft", journal_id=jid),
    ])
    db.commit()

    res = env["client"].get(f"/api/admin/journals/{jid}/articles-by-category", headers=_auth(_token()))
    assert res.status_code == 200
    body = res.json()
    assert len(body["strategy"]) == 2
    assert len(body["technology"]) == 1
    assert len(body["solution"]) == 1
    assert len(body["dynamics"]) == 0
    assert body["completeness"]["complete"] is False


def test_articles_by_category_404(env):
    res = env["client"].get("/api/admin/journals/99999/articles-by-category", headers=_auth(_token()))
    assert res.status_code == 404
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_journals.py::test_articles_by_category_groups_correctly -v
```
Expected: 404

- [ ] **Step 4: Implement endpoint**

Create `backend/app/routers/admin_journal_articles.py`:

```python
"""Admin: per-category article list for the 4-Tab journal detail UI."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.journal import Journal
from ..schemas.admin import JournalArticlesByCategoryOut, ArticleAdminOut
from ..security import get_current_admin
from ..services.completeness import is_journal_complete, REQUIRED_CATEGORIES


router = APIRouter(prefix="/api/admin/journals", tags=["admin-journals"])


_CATEGORY_KEYS = {
    "战略与政策": "strategy",
    "技术与产业": "technology",
    "方案与思考": "solution",
    "动态与文化": "dynamics",
}


def _serialize_article(a) -> ArticleAdminOut:
    return ArticleAdminOut(
        id=a.id,
        title=a.title,
        slug=a.slug,
        summary=a.summary,
        content=a.content,
        cover_image=a.cover_image,
        cover_image_alt=a.cover_image_alt,
        category=a.category,
        author_name=a.author_name,
        author_avatar=a.author_avatar,
        reading_time=a.reading_time or 5,
        views=a.views or 0,
        featured=bool(a.featured),
        status=a.status or "draft",
        tags=[t.strip() for t in (a.tags or "").split(",") if t.strip()] if a.tags else None,
        journal_id=a.journal_id,
        published_at=a.published_at.isoformat() if a.published_at else None,
        created_at=a.created_at.isoformat() if a.created_at else None,
        updated_at=a.updated_at.isoformat() if a.updated_at else None,
    )


@router.get("/{journal_id}/articles-by-category", response_model=JournalArticlesByCategoryOut)
def articles_by_category(
    journal_id: int,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="期刊不存在")

    buckets: dict[str, list] = {key: [] for key in _CATEGORY_KEYS.values()}
    for a in sorted(j.articles, key=lambda x: (x.published_at or x.created_at or __import__("datetime").datetime.min), reverse=True):
        key = _CATEGORY_KEYS.get(a.category)
        if key:
            buckets[key].append(_serialize_article(a))

    return JournalArticlesByCategoryOut(
        strategy=buckets["strategy"],
        technology=buckets["technology"],
        solution=buckets["solution"],
        dynamics=buckets["dynamics"],
        completeness=is_journal_complete(j),
    )
```

- [ ] **Step 5: Wire into main.py**

In `backend/app/main.py`, add to the routers import line:

```python
from .routers import articles_router, team_router, auth_router, admin_router, settings_router, admin_articles_import, admin_journal_articles
```

Add after the other `include_router` calls:

```python
app.include_router(admin_journal_articles.router)
```

- [ ] **Step 6: Run — expect PASS**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_journals.py -v
```
Expected: existing + 2 new pass

- [ ] **Step 7: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add backend/app/schemas/admin.py backend/app/routers/admin_journal_articles.py backend/app/main.py backend/tests/test_admin_journals.py && git commit -m "feat(admin): GET /journals/{id}/articles-by-category"
```

---

## Task 2: Frontend api — articlesByCategory

**Files:**
- Modify: `frontend-vite/src/services/api.ts`

- [ ] **Step 1: Add method**

Inside `admin.journals`, after `unpublish`, add:

```typescript
      articlesByCategory: (id: number): Promise<{
        strategy: Array<{ id: number; title: string; slug: string; category: string; status: string; updated_at?: string }>
        technology: Array<{ id: number; title: string; slug: string; category: string; status: string; updated_at?: string }>
        solution: Array<{ id: number; title: string; slug: string; category: string; status: string; updated_at?: string }>
        dynamics: Array<{ id: number; title: string; slug: string; category: string; status: string; updated_at?: string }>
        completeness: import('./api').JournalCompleteness
      }> =>
        request(`/api/admin/journals/${id}/articles-by-category`),
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/services/api.ts && git commit -m "feat(api): admin.journals.articlesByCategory"
```

---

## Task 3: JournalDetail page

**Files:**
- Create: `frontend-vite/src/pages/admin/JournalDetail.tsx`
- Create: `frontend-vite/src/pages/admin/JournalDetail.css`

- [ ] **Step 1: Create the page**

Create `frontend-vite/src/pages/admin/JournalDetail.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ExternalLink, ArrowLeft } from 'lucide-react'
import { api, JournalCompleteness } from '../../services/api'
import './JournalDetail.css'

const TABS = [
  { key: 'strategy',  label: '战略与政策', category: '战略与政策' },
  { key: 'technology', label: '技术与产业', category: '技术与产业' },
  { key: 'solution',  label: '方案与思考', category: '方案与思考' },
  { key: 'dynamics',  label: '动态与文化', category: '动态与文化' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function JournalDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const journalId = parseInt(id!, 10)
  const [tab, setTab] = useState<TabKey>('strategy')
  const [error, setError] = useState('')

  const journalQ = useQuery({
    queryKey: ['admin', 'journal', journalId],
    queryFn: async () => {
      const list = await api.admin.journals.list({ per_page: 100 })
      return list.items.find((j) => j.id === journalId)
    },
  })

  const groupedQ = useQuery({
    queryKey: ['admin', 'journal', journalId, 'grouped'],
    queryFn: () => api.admin.journals.articlesByCategory(journalId),
  })

  const publishMut = useMutation({
    mutationFn: () => api.admin.journals.publish(journalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'journals'] })
      qc.invalidateQueries({ queryKey: ['admin', 'journal', journalId] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : '发布失败'),
  })

  const completeness: JournalCompleteness | undefined = groupedQ.data?.completeness
  const canPublish = completeness?.complete && journalQ.data?.status !== 'published'

  const gotoNew = (category: string) => {
    const q = new URLSearchParams({ journal_id: String(journalId), category })
    navigate(`/admin/articles/new?${q.toString()}`)
  }

  if (journalQ.isLoading || groupedQ.isLoading) {
    return <div style={{ padding: '24px' }}>加载中…</div>
  }
  if (!journalQ.data) {
    return <div style={{ padding: '24px' }}>期刊不存在</div>
  }

  const j = journalQ.data
  const articles = groupedQ.data?.[tab] ?? []

  return (
    <div className="journal-detail">
      <div className="journal-detail__header">
        <button
          type="button"
          className="journal-detail__back"
          onClick={() => navigate('/admin/journals')}
        >
          <ArrowLeft size={14} /> 返回列表
        </button>
        <div className="journal-detail__title">
          <h2>{j.title}</h2>
          <span className="journal-detail__meta">/{j.slug}{j.issue_number ? ` · ${j.issue_number}` : ''}</span>
        </div>
        <div className="journal-detail__actions">
          <button
            type="button"
            className="journal-detail__btn"
            onClick={() => navigate(`/admin/journals/${journalId}/edit`)}
          >
            编辑元数据
          </button>
          <button
            type="button"
            className="journal-detail__btn journal-detail__btn--primary"
            disabled={!canPublish || publishMut.isPending}
            onClick={() => publishMut.mutate()}
            title={
              !completeness?.complete
                ? '四类文章齐全后才能发布'
                : j.status === 'published'
                ? '期刊已是发布状态'
                : ''
            }
          >
            {j.status === 'published' ? '已发布' : publishMut.isPending ? '发布中…' : '发布期刊'}
          </button>
        </div>
      </div>

      {error && <div className="journal-detail__error">{error}</div>}

      <div className="journal-detail__completeness">
        {(['战略与政策', '技术与产业', '方案与思考', '动态与文化'] as const).map((c) => {
          const n = completeness?.[c] ?? 0
          return (
            <div
              key={c}
              className={`journal-detail__pill ${n >= 1 ? 'journal-detail__pill--ok' : 'journal-detail__pill--missing'}`}
            >
              {c}: {n} 篇
            </div>
          )
        })}
      </div>

      <div className="journal-detail__tabs" role="tablist">
        {TABS.map((t) => {
          const count = groupedQ.data?.[t.key]?.length ?? 0
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`journal-detail__tab ${tab === t.key ? 'journal-detail__tab--active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label} <span className="journal-detail__tab-count">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="journal-detail__panel">
        <div className="journal-detail__panel-head">
          <button
            type="button"
            className="journal-detail__btn journal-detail__btn--primary"
            onClick={() => gotoNew(TABS.find((t) => t.key === tab)!.category)}
          >
            <Plus size={14} /> 新建 {TABS.find((t) => t.key === tab)!.label}
          </button>
        </div>
        {articles.length === 0 ? (
          <div className="journal-detail__empty">此分类暂无文章，点上面按钮新建。</div>
        ) : (
          <table className="journal-detail__table">
            <thead>
              <tr><th>标题</th><th>状态</th><th>更新时间</th><th>操作</th></tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td>
                    <span className={`journal-detail__status journal-detail__status--${a.status}`}>
                      {a.status === 'published' ? '已发布' : '草稿'}
                    </span>
                  </td>
                  <td className="journal-detail__sub">{a.updated_at ? new Date(a.updated_at).toLocaleString('zh-CN') : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="journal-detail__action"
                      onClick={() => navigate(`/admin/articles/${a.id}`)}
                    >
                      <ExternalLink size={12} /> 编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the CSS**

Create `frontend-vite/src/pages/admin/JournalDetail.css`:

```css
.journal-detail { padding: 24px; max-width: 1100px; }
.journal-detail__header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.journal-detail__back { background: transparent; border: 1px solid #ddd; padding: 6px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: 0.8125rem; }
.journal-detail__title { flex: 1; min-width: 200px; }
.journal-detail__title h2 { margin: 0; font-size: 1.5rem; }
.journal-detail__meta { color: var(--color-text-secondary); font-size: 0.8125rem; }
.journal-detail__actions { display: flex; gap: 8px; }
.journal-detail__btn { padding: 8px 14px; border: 1px solid #ddd; background: #fff; border-radius: 6px; cursor: pointer; font-size: 0.875rem; display: inline-flex; align-items: center; gap: 4px; }
.journal-detail__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.journal-detail__btn--primary { background: #1A1A2E; color: #FAFAF7; border-color: #1A1A2E; }
.journal-detail__btn--primary:disabled { background: #4b4b62; }
.journal-detail__error { background: #fee; color: #c00; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 0.875rem; }

.journal-detail__completeness { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.journal-detail__pill { padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; }
.journal-detail__pill--ok { background: rgba(22, 163, 74, 0.12); color: #16a34a; }
.journal-detail__pill--missing { background: rgba(217, 119, 6, 0.12); color: #d97706; }

.journal-detail__tabs { display: flex; gap: 0; border-bottom: 1px solid #ddd; margin-bottom: 16px; }
.journal-detail__tab { background: transparent; border: none; padding: 10px 16px; cursor: pointer; font-size: 0.875rem; color: var(--color-text-secondary); border-bottom: 2px solid transparent; }
.journal-detail__tab--active { color: #1A1A2E; border-bottom-color: #C9A84C; font-weight: 500; }
.journal-detail__tab-count { display: inline-block; margin-left: 4px; padding: 1px 6px; background: #eee; border-radius: 999px; font-size: 0.6875rem; }

.journal-detail__panel { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 16px; }
.journal-detail__panel-head { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.journal-detail__empty { text-align: center; padding: 32px; color: var(--color-text-secondary); }

.journal-detail__table { width: 100%; border-collapse: collapse; }
.journal-detail__table th, .journal-detail__table td { padding: 10px 8px; text-align: left; border-bottom: 1px solid #f0f0f0; font-size: 0.875rem; }
.journal-detail__table th { background: #fafaf7; font-weight: 500; }
.journal-detail__sub { color: var(--color-text-secondary); font-size: 0.75rem; }
.journal-detail__status { padding: 2px 8px; border-radius: 999px; font-size: 0.6875rem; }
.journal-detail__status--published { background: rgba(22,163,74,0.12); color: #16a34a; }
.journal-detail__status--draft { background: rgba(217,119,6,0.12); color: #d97706; }
.journal-detail__action { background: transparent; border: 1px solid #ddd; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 2px; }
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/pages/admin/JournalDetail.tsx frontend-vite/src/pages/admin/JournalDetail.css && git commit -m "feat(admin): JournalDetail 4-Tab page with publish CTA"
```

---

## Task 4: Wire route + JournalList redirect

**Files:**
- Modify: `frontend-vite/src/App.tsx`
- Modify: `frontend-vite/src/pages/admin/JournalList.tsx`

- [ ] **Step 1: Add JournalDetail import**

In `frontend-vite/src/App.tsx`, add:

```tsx
import { JournalDetail } from './pages/admin/JournalDetail'
```

- [ ] **Step 2: Replace journal routes**

In `frontend-vite/src/App.tsx`, find the journal route block:

```tsx
            <Route path="journals" element={<JournalList />} />
            <Route path="journals/new" element={<JournalEditor />} />
            <Route path="journals/:id" element={<JournalEditor />} />
```

Replace with:

```tsx
            <Route path="journals" element={<JournalList />} />
            <Route path="journals/new" element={<JournalEditor />} />
            <Route path="journals/:id" element={<JournalDetail />} />
            <Route path="journals/:id/edit" element={<JournalEditor />} />
```

- [ ] **Step 3: Update JournalList "编辑" button**

In `frontend-vite/src/pages/admin/JournalList.tsx`, find the "编辑" button (around line 102):

```tsx
                      <button className="article-list__action" onClick={() => navigate(`/admin/journals/${j.id}`)}>
                        编辑
                      </button>
```

Replace with:

```tsx
                      <button className="article-list__action" onClick={() => navigate(`/admin/journals/${j.id}`)}>
                        查看
                      </button>
                      <button className="article-list__action" onClick={() => navigate(`/admin/journals/${j.id}/edit`)}>
                        编辑元数据
                      </button>
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/App.tsx frontend-vite/src/pages/admin/JournalList.tsx && git commit -m "feat(routes): /admin/journals/:id now JournalDetail, metadata moved to /edit"
```

---

## Task 5: ArticleEditor — accept journal_id + category from query

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`

- [ ] **Step 1: Read existing useSearchParams-style hook usage**

ArticleEditor currently uses `useParams` only. We need to add `useSearchParams`.

- [ ] **Step 2: Add the import + prefill**

At the top of the file, add:

```tsx
import { useSearchParams } from 'react-router-dom'
```

Inside the component body (right after `const navigate = useNavigate()`), add:

```tsx
  const [searchParams] = useSearchParams()
  const presetJournalId = searchParams.get('journal_id')
  const presetCategory = searchParams.get('category')
```

- [ ] **Step 3: Apply preset when creating**

After `useState<FormState>(emptyForm())`, immediately:

```tsx
  useEffect(() => {
    if (isNew && (presetJournalId || presetCategory)) {
      setForm((f) => ({
        ...f,
        ...(presetCategory && CATEGORIES.includes(presetCategory) ? { category: presetCategory } : {}),
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

(We don't store journal_id in FormState because the backend infers it from request body — but we need to send it on save. Add a separate state:)

```tsx
  const [presetJournalIdState] = useState<number | null>(
    presetJournalId ? parseInt(presetJournalId, 10) : null
  )
```

- [ ] **Step 4: Include journal_id in create body**

In the `saveMut.mutationFn`, replace the create branch:

```typescript
    mutationFn: async (status: 'draft' | 'published') => {
      const tagsArr = form.tags.split(',').map((t) => t.trim()).filter(Boolean)
      const body: Record<string, unknown> = {
        ...form,
        tags: tagsArr,
        status,
        reading_time: Number(form.reading_time),
      }
      if (presetJournalIdState) {
        body.journal_id = presetJournalIdState
      }
      if (isNew) {
        return api.admin.articles.create(body)
      }
      const { slug, ...rest } = body
      return api.admin.articles.update(parseInt(id!, 10), rest)
    },
```

- [ ] **Step 5: Type-check**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx tsc -b --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang && git add frontend-vite/src/pages/admin/ArticleEditor.tsx && git commit -m "feat(admin): ArticleEditor accepts journal_id + category query params"
```

---

## Task 6: Verification — full backend + frontend build + manual smoke

- [ ] **Step 1: Backend tests**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest -q
```
Expected: all green

- [ ] **Step 2: Frontend build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run build
```
Expected: success

- [ ] **Step 3: Manual UI walkthrough**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && uvicorn app.main:app --port 8000 &
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run dev -- --port 5173 &
```

Steps:
1. Login → `/admin/journals`
2. Click "新建" → fill metadata → save → redirect to `/admin/journals/{id}` (JournalDetail)
3. Verify 4 pills show "0 篇" each, "发布" button disabled
4. Click "新建 战略与政策" → ArticleEditor opens with category pre-filled
5. Save → back to JournalDetail → pill shows "1 篇"
6. Repeat for the other 3 categories
7. Pill row goes all green → "发布期刊" button enables
8. Click publish → status flips to "已发布", button now reads "已发布"
9. Open `/issues` (public) → new journal appears

- [ ] **Step 4: Stop dev servers**

```bash
pkill -f "uvicorn app.main:app" ; pkill -f "vite" || true
```

- [ ] **Step 5: Tag milestone**

```bash
cd /Users/jasonlee/hubei-shuchuang && git tag -a m3-complete -m "Phase 3: JournalDetail 4-Tab UI shipped"
```

---

## Self-Review

**Spec coverage:**
- §5.1 `/admin/journals/:id` route → Tasks 3-4 ✓
- §5.3 "新建文章 预填 journal_id + category" → Task 5 ✓
- §5.3 4-Tab 状态显示 (草稿/已发布/缺失) → Task 3 (pill + tab badges) ✓
- §5.3 publish 按钮 仅 complete 时启用 → Task 3 (canPublish gating) ✓
- §9 M3 acceptance UI walkthrough → Task 6 ✓

**Type consistency:**
- `JournalArticlesByCategoryOut` keys (`strategy/technology/solution/dynamics`) match the front-end `TABS` array keys (Task 1 vs Task 3). ✓
- `JournalCompleteness` reused from M1. ✓
- `article.status` rendered as `'published' | 'draft'` matches schema enum. ✓

**No placeholders:** Every CSS class is defined; every route handler returns a concrete shape; query-string prefill is explicit.

**Risks accepted:** The 4-Tab layout assumes the editor stays within an 1100px max-width — if a 4K monitor shows it too narrow, Task 6 acceptance is the moment to widen. No new risks added.