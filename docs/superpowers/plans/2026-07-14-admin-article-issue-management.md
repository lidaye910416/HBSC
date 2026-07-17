# Admin Article Issue Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators switch the article list by issue, combine issue selection with existing server-side filters/pagination, and safely create or reassign article issue membership.

**Architecture:** `Article.journal_id` is the sole membership key. The backend adds mutually exclusive `journal_id`/`unassigned` filters, exposes `journal_title`, and centralizes publication validation so both PUT-to-published and the dedicated publish route reject unassigned articles. The frontend keeps list state in URL query parameters, renders issue tabs from admin journal counts, and edits `journal_id` as a normal controlled form field.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, pytest, React 19, TypeScript, React Router 6, TanStack Query 5, Playwright.

**Prerequisites:** Complete `2026-07-14-unified-media-backend-and-migration.md` and `2026-07-14-markdown-editor-media-workflow.md` first because this plan modifies the same article routes, API types, and `ArticleEditor.tsx`.

---

## File structure and responsibility map

### Create

| File | Responsibility |
|---|---|
| `backend/app/services/article_publication.py` | Validate non-null journal IDs and all publication paths |
| `backend/tests/test_admin_article_issues.py` | Combined issue filters, counts, query alias, invalid combinations, journal validation |
| `backend/tests/test_article_publication.py` | Create/update/dedicated-publish invariants |
| `frontend-vite/tests/article-issue-management.spec.ts` | Issue tabs, URL state, pagination reset, editor hydration, reassignment, publish errors |

### Modify

| File | Responsibility of change |
|---|---|
| `backend/app/admin_router.py:7-11,90-252,362-398` | Query aliases, issue filters, journal title serialization, publication helper calls, no `pages` field |
| `backend/app/schemas/admin.py:17-79` | Keep `journal_id` explicit and add `journal_title` to outputs |
| `frontend-vite/src/services/api.ts:71-166,249-276,362-370` | Typed `AdminArticle`, issue filters, journal list, optional journal title |
| `frontend-vite/src/pages/admin/ArticleList.tsx:1-285` | URL-driven filters, top issue switcher, issue column, computed pagination |
| `frontend-vite/src/pages/admin/ArticleList.css:1-52` | Issue tabs and responsive horizontal scrolling using admin tokens |
| `frontend-vite/src/pages/admin/ArticleEditor.tsx:19-49,198-285,292-448` | Controlled `journal_id`, selector, preset/hydration, dirty tracking, payload, publish precheck |
| `frontend-vite/src/pages/admin/JournalDetail.tsx:88-94` | Keep canonical `journal_id` preset and verify query contract |

### Explicit non-changes

- Do not infer membership from title, issue number, slug, category, or publication date.
- Do not remove the existing four-category JournalDetail view.
- Do not require a journal for drafts.
- Do not allow a non-null nonexistent `journal_id`.
- Do not include drafts in public issue endpoints as part of this plan.
- Do not load all articles client-side for grouping.

---

## Wire contracts

Admin article list query:

```text
GET /api/admin/articles
  ?journal_id=2
  &unassigned=false
  &status=draft
  &category=方案与思考
  &q=数字医共体
  &featured=true
  &sort_by=updated_at
  &sort_dir=desc
  &page=1
  &per_page=20
```

Rules:

```text
journal_id + unassigned=true -> 422 invalid_issue_filter
nonexistent journal_id       -> 200 empty page for list filtering
nonexistent journal_id write -> 422 invalid_journal
published + journal_id null  -> 422 unassigned_journal
```

Admin article output adds:

```json
{
  "journal_id": 2,
  "journal_title": "2026年第二期"
}
```

---

### Task 1: Add journal/status query contracts and combined list filtering

**Files:**
- Modify: `backend/app/admin_router.py:7-11,90-169`
- Modify: `backend/app/schemas/admin.py:57-79,147-173`
- Create: `backend/tests/test_admin_article_issues.py`

- [ ] **Step 1: Write failing backend list tests**

```python
# backend/tests/test_admin_article_issues.py
from datetime import datetime
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import get_db
from app.main import app
from app.models.base import Base
from app.models.journal import Article, Journal
from app.security import create_access_token


@pytest.fixture()
def client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    def override_db():
        db = Session()
        try: yield db
        finally: db.close()
    app.dependency_overrides[get_db] = override_db
    db = Session()
    db.add_all([
        Journal(id=1, title="2026年第一期", slug="2026-q1", status="published", published_at=datetime(2026, 3, 31)),
        Journal(id=2, title="2026年第二期", slug="2026-q2", status="published", published_at=datetime(2026, 6, 30)),
        Article(id=1, title="Q1 published", slug="q1-p", journal_id=1, status="published"),
        Article(id=2, title="Q2 draft", slug="q2-d", journal_id=2, status="draft", category="方案与思考"),
        Article(id=3, title="Loose draft", slug="loose", journal_id=None, status="draft"),
    ])
    db.commit(); db.close()
    headers = {"Authorization": f"Bearer {create_access_token(sub='admin')}"}
    with TestClient(app) as test_client:
        yield test_client, headers
    app.dependency_overrides.clear()


def test_filters_by_journal_and_serializes_title(client):
    c, headers = client
    response = c.get("/api/admin/articles?journal_id=2", headers=headers)
    assert response.status_code == 200
    assert [item["title"] for item in response.json()["items"]] == ["Q2 draft"]
    assert response.json()["items"][0]["journal_title"] == "2026年第二期"


def test_unassigned_combines_with_status_alias(client):
    c, headers = client
    response = c.get("/api/admin/articles?unassigned=true&status=draft", headers=headers)
    assert response.status_code == 200
    assert [item["title"] for item in response.json()["items"]] == ["Loose draft"]


def test_journal_and_unassigned_are_mutually_exclusive(client):
    c, headers = client
    response = c.get("/api/admin/articles?journal_id=2&unassigned=true", headers=headers)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_issue_filter"


def test_list_uses_project_pagination_shape(client):
    c, headers = client
    assert set(c.get("/api/admin/articles", headers=headers).json()) == {"items", "total", "page", "per_page"}
```

- [ ] **Step 2: Run tests and verify failures**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_article_issues.py -q
```

Expected: `journal_id` and `unassigned` ignored, `status` ignored because current Python parameter is `status_`, `journal_title` absent, and `pages` present.

- [ ] **Step 3: Add query aliases and filters**

```python
from fastapi import Query

@router.get("/articles")
def list_articles(
    status_filter: Optional[str] = Query(None, alias="status"),
    category: Optional[str] = None,
    q: Optional[str] = None,
    featured: Optional[bool] = None,
    journal_id: Optional[int] = None,
    unassigned: bool = False,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    if journal_id is not None and unassigned:
        raise HTTPException(422, detail={
            "code": "invalid_issue_filter",
            "message": "journal_id 与 unassigned 不能同时使用",
        })
    query = db.query(Article)
    if status_filter:
        query = query.filter(Article.status == status_filter)
    if journal_id is not None:
        query = query.filter(Article.journal_id == journal_id)
    elif unassigned:
        query = query.filter(Article.journal_id.is_(None))
```

Keep existing category/search/featured/sort conditions and server pagination.

- [ ] **Step 4: Serialize journal title without a second per-row query**

Use SQLAlchemy `selectinload` so journal titles do not cause an N+1 query:

```python
from sqlalchemy.orm import selectinload
query = db.query(Article).options(selectinload(Article.journal))
```

Extend `_article_to_dict`:

```python
"journal_id": a.journal_id,
"journal_title": a.journal.title if a.journal else None,
```

Add `journal_title: Optional[str] = None` to both `ArticleAdminOut` and `ArticleAdminSummaryOut`.

- [ ] **Step 5: Remove `pages` from admin article list response**

Return only:

```python
{"items": items, "total": total, "page": page, "per_page": per_page}
```

- [ ] **Step 6: Run list and sort regression tests**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_article_issues.py tests/test_admin_articles_list_sort.py -q
```

Expected: all pass, including `?status=draft`.

- [ ] **Step 7: Commit boundary if authorized**

```bash
git add backend/app/admin_router.py backend/app/schemas/admin.py backend/tests/test_admin_article_issues.py
git commit -m "feat(admin): filter articles by issue membership"
```

---

### Task 2: Centralize journal validation for every article write/publication path

**Files:**
- Create: `backend/app/services/article_publication.py`
- Modify: `backend/app/admin_router.py:172-252`
- Create: `backend/tests/test_article_publication.py`

- [ ] **Step 1: Write failing publication invariant tests**

```python
# backend/tests/test_article_publication.py
from types import SimpleNamespace
import pytest


@pytest.fixture()
def unassigned_draft(admin_client):
    response = admin_client.post("/api/admin/articles", json={
        "title": "Unassigned", "slug": "unassigned", "status": "draft",
    })
    assert response.status_code == 200, response.text
    return SimpleNamespace(id=response.json()["id"])


def test_draft_may_be_unassigned(admin_client):
    response = admin_client.post("/api/admin/articles", json={"title": "Draft", "slug": "draft", "status": "draft"})
    assert response.status_code == 200
    assert response.json()["journal_id"] is None


def test_create_published_requires_journal(admin_client):
    response = admin_client.post("/api/admin/articles", json={"title": "P", "slug": "p", "status": "published"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unassigned_journal"


def test_put_transition_to_published_requires_journal(admin_client, unassigned_draft):
    response = admin_client.put(f"/api/admin/articles/{unassigned_draft.id}", json={"status": "published"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unassigned_journal"


def test_dedicated_publish_requires_journal(admin_client, unassigned_draft):
    response = admin_client.post(f"/api/admin/articles/{unassigned_draft.id}/publish")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unassigned_journal"


def test_any_non_null_journal_id_must_exist(admin_client):
    response = admin_client.post("/api/admin/articles", json={"title": "D", "slug": "d", "status": "draft", "journal_id": 999})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_journal"
```

- [ ] **Step 2: Run and verify current bypasses**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_article_publication.py -q
```

Expected: create/PUT/publish accept unassigned publication and invalid non-null journal IDs.

- [ ] **Step 3: Implement focused validation helpers**

```python
# backend/app/services/article_publication.py
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy.orm import Session
from ..models.journal import Article, Journal


def validate_journal_id(db: Session, journal_id: int | None) -> Journal | None:
    if journal_id is None:
        return None
    journal = db.get(Journal, journal_id)
    if journal is None:
        raise HTTPException(422, detail={
            "code": "invalid_journal", "message": "所属期数不存在",
        })
    return journal


def validate_article_publication(db: Session, article: Article) -> None:
    if article.status != "published":
        return
    if article.journal_id is None:
        raise HTTPException(422, detail={
            "code": "unassigned_journal", "message": "发布文章前必须选择所属期数",
        })
    validate_journal_id(db, article.journal_id)
    if article.published_at is None:
        article.published_at = datetime.utcnow()
```

- [ ] **Step 4: Call helpers from all write paths before commit**

Create:

```python
validate_journal_id(db, article.journal_id)
validate_article_publication(db, article)
```

Update: after applying partial fields but before usage sync/commit, call both. Dedicated publish: set status, call validation, then commit. All error paths roll back. This ordering composes with the media usage transaction from the backend plan.

- [ ] **Step 5: Run publication, usage, and list suites**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_article_publication.py tests/test_article_media_usage.py tests/test_admin_article_issues.py -q
```

Expected: all pass; no publication path bypass remains.

- [ ] **Step 6: Commit boundary if authorized**

```bash
git add backend/app/services/article_publication.py backend/app/admin_router.py backend/tests/test_article_publication.py
git commit -m "fix(admin): enforce article issue assignment on publication"
```

---

### Task 3: Type frontend admin article/issue contracts

**Files:**
- Modify: `frontend-vite/src/services/api.ts:71-166,249-276,362-370`
- Create: `frontend-vite/tests/article-issue-management.spec.ts`

- [ ] **Step 1: Add a failing query-serialization test through Playwright**

```ts
// frontend-vite/tests/article-issue-management.spec.ts
import { test, expect } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'
const adminPw = process.env.ADMIN_PW ?? 'admin123'

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${baseURL}/admin/login`)
  await page.fill('#username', 'admin')
  await page.fill('#password', adminPw)
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')
}

test('second-issue tab sends journal_id and preserves URL state', async ({ page }) => {
  await login(page)
  await page.route('**/api/admin/journals?**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [
      { id: 2, title: '2026年第二期', slug: '2026-q2', status: 'published', article_count: 8 },
      { id: 1, title: '2026年第一期', slug: '2026-q1', status: 'published', article_count: 11 },
    ], total: 2, page: 1, per_page: 100 }),
  }))
  let articlesURL = ''
  await page.route('**/api/admin/articles?**', route => {
    articlesURL = route.request().url()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, per_page: 20 }) })
  })
  await page.goto(`${baseURL}/admin/articles`)
  await page.getByRole('button', { name: /2026年第二期.*8/ }).click()
  await expect(page).toHaveURL(/journal_id=2/)
  await expect.poll(() => articlesURL).toContain('journal_id=2')
})
```

- [ ] **Step 2: Run and verify issue tabs do not exist**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-issue-management.spec.ts --reporter=line
```

Expected: no issue-tab button.

- [ ] **Step 3: Add typed admin article output and list parameters**

```ts
export interface AdminArticle extends Article {
  status: 'draft' | 'published'
  featured: boolean
  cover_image_alt?: string
  journal_id: number | null
  journal_title: string | null
  updated_at?: string
}

export interface AdminArticleListParams {
  status?: 'draft' | 'published'
  category?: string
  q?: string
  featured?: boolean
  journal_id?: number
  unassigned?: boolean
  sort_by?: 'updated_at' | 'published_at' | 'title'
  sort_dir?: 'asc' | 'desc'
  page?: number
  per_page?: number
}
```

Change `articles.list` to serialize `journal_id` and `unassigned`, return `PaginatedResponse<AdminArticle>`, and change `articles.get` to `Promise<AdminArticle>`.

- [ ] **Step 4: Add a typed journal selector query**

Use existing `api.admin.journals.list({page:1, per_page:100})`; no separate endpoint is needed. Keep `article_count` draft-inclusive.

- [ ] **Step 5: Run TypeScript build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run build
```

Expected: build passes after every remaining `.pages` consumer has been converted to `pageCount(data)` by the prior plan.

- [ ] **Step 6: Commit with the first consuming UI task, not alone**

Keep API typing changes with Task 4 so no unused contract lands.

---

### Task 4: Make `ArticleList` URL-driven and add top issue tabs

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleList.tsx:1-285`
- Modify: `frontend-vite/src/pages/admin/ArticleList.css:1-52`
- Modify: `frontend-vite/src/services/api.ts`
- Test: `frontend-vite/tests/article-issue-management.spec.ts`

- [ ] **Step 1: Extend failing UI tests**

Add assertions for:

```ts
await expect(page.getByRole('button', { name: /全部文章/ })).toBeVisible()
await expect(page.getByRole('button', { name: /未归期/ })).toBeVisible()
await page.getByRole('button', { name: /未归期/ }).click()
await expect(page).toHaveURL(/unassigned=true/)
await page.getByLabel('状态').selectOption('draft')
await expect(page).toHaveURL(/status=draft/)
await expect(page).toHaveURL(/page=1/)
```

Mock an “all articles” row with `journal_title:'2026年第二期'` and assert the table renders that title. In a concrete issue view, assert the “所属期数” column is absent.

- [ ] **Step 2: Run and verify current local state/columns fail**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-issue-management.spec.ts --reporter=line
```

Expected: issue tabs and URL-driven filters absent.

- [ ] **Step 3: Replace list filter state with `useSearchParams`**

Define typed helpers:

```ts
type IssueScope = { kind: 'all' } | { kind: 'journal'; id: number } | { kind: 'unassigned' }

function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
```

Read `journal_id`, `unassigned`, `status`, `category`, `featured`, `sort_by`, `sort_dir`, `q`, and `page` from search params. A single `updateParams(patch, {resetPage:true})` function updates them and sets page to `1` for every scope/filter/sort change. Search input may remain local for immediate typing, but writes its debounced value to URL and initializes from URL.

- [ ] **Step 4: Query journals, unassigned count, and current page**

```tsx
const journalsQ = useQuery({
  queryKey: ['admin', 'journals', 'article-tabs'],
  queryFn: () => api.admin.journals.list({ page: 1, per_page: 100 }),
})
const allCountQ = useQuery({
  queryKey: ['admin', 'articles', 'all-count'],
  queryFn: () => api.admin.articles.list({ page: 1, per_page: 1 }),
})
const unassignedQ = useQuery({
  queryKey: ['admin', 'articles', 'unassigned-count'],
  queryFn: () => api.admin.articles.list({ unassigned: true, page: 1, per_page: 1 }),
})
```

Sort journal tabs by `published_at` descending, then ID descending as deterministic fallback. The current article query receives the selected scope plus all other filters and server pagination. `allCountQ` and `unassignedQ` never receive current search/category/status/featured filters, so badge counts remain global admin counts.

- [ ] **Step 5: Render the top switcher and conditional issue column**

Render buttons in this order: “全部文章”, each journal, “未归期”. Use `article_count` for each journal, the unfiltered all query total for “全部文章”, and `unassignedQ.data.total` for “未归期”. If filters are active, do not rewrite tab totals to filtered counts.

Show “所属期数” only in `all` and `unassigned` scopes; render `journal_title ?? '未归期'`. In a concrete journal scope, hide the redundant column and adjust empty-row `colSpan`.

- [ ] **Step 6: Add token-based responsive styles**

```css
.article-issue-tabs {
  display: flex;
  gap: var(--space-2);
  overflow-x: auto;
  padding-bottom: var(--space-2);
  margin-bottom: var(--space-4);
}
.article-issue-tabs__button {
  white-space: nowrap;
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  color: var(--admin-text-2);
}
.article-issue-tabs__button.is-active {
  border-color: var(--brand-gold);
  background: var(--accent-soft);
  color: var(--admin-text);
}
```

Use existing radius/spacing/type tokens for exact padding and font size; do not add hex colors or global width rules.

- [ ] **Step 7: Compute page count from total/per_page**

```ts
const pages = data ? pageCount(data) : 1
```

Keep server pagination and update only the `page` URL param when pager buttons are clicked.

- [ ] **Step 8: Run UI test, token scan, and build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite
npx playwright test tests/article-issue-management.spec.ts --reporter=line
npm run lint:admin-tokens
npm run build
```

Expected: tabs, URL state, issue column, and page reset tests pass.

- [ ] **Step 9: Commit Tasks 3–4 boundary if authorized**

```bash
git add frontend-vite/src/services/api.ts frontend-vite/src/pages/admin/ArticleList.tsx frontend-vite/src/pages/admin/ArticleList.css frontend-vite/tests/article-issue-management.spec.ts
git commit -m "feat(admin): switch article management by issue"
```

---

### Task 5: Add controlled issue assignment and reassignment to `ArticleEditor`

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx:19-49,198-285,292-448`
- Modify: `frontend-vite/tests/article-issue-management.spec.ts`

- [ ] **Step 1: Add failing hydration and payload tests**

Mock `GET /api/admin/articles/19` with `journal_id:2` and `GET /api/admin/journals` with two issues. Assert:

```ts
await page.goto(`${baseURL}/admin/articles/19`)
await expect(page.getByLabel('所属期数')).toHaveValue('2')
```

Change to `1`, click “保存草稿”, capture the PUT JSON, and assert `journal_id === 1`. Add a new-article test for `/admin/articles/new?journal_id=2&category=方案与思考`, asserting preselection and create payload. Add an unassigned draft test with select value `''` and payload `journal_id:null`.

- [ ] **Step 2: Run and verify current editor never hydrates/sends assignment on edit**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-issue-management.spec.ts -g '所属期数|journal' --reporter=line
```

Expected: selector missing; edit payload omits journal ID.

- [ ] **Step 3: Add `journal_id` to controlled form state**

```ts
interface FormState {
  // existing fields
  journal_id: number | null
}

const emptyForm = (): FormState => ({
  // existing defaults
  journal_id: null,
})
```

Hydrate from `existing.journal_id ?? null`; include it in `isDirty`; always send it in create/update payload. Remove the current special case that adds `presetJournalIdNum` only on create.

- [ ] **Step 4: Apply query preset only to a new untouched form**

For new mode, initialize `journal_id` from a valid positive `?journal_id=`. Do not let a later effect overwrite an administrator’s manual selection. Existing article data always wins over query params.

- [ ] **Step 5: Query and render the selector**

```tsx
const journalsQ = useQuery({
  queryKey: ['admin', 'journals', 'selector'],
  queryFn: () => api.admin.journals.list({ page: 1, per_page: 100 }),
  staleTime: 5 * 60 * 1000,
})

<label htmlFor="article-journal">所属期数</label>
<select
  id="article-journal"
  value={form.journal_id ?? ''}
  onChange={event => update('journal_id', event.target.value ? Number(event.target.value) : null)}
>
  <option value="">未归期（仅可保存草稿）</option>
  {journalsQ.data?.items.map(journal => (
    <option key={journal.id} value={journal.id}>{journal.title}</option>
  ))}
</select>
```

Sort options latest first using the API order.

- [ ] **Step 6: Add client guidance without replacing backend validation**

If “保存并发布” is clicked with `journal_id===null`, set the existing error area to “发布文章前请选择所属期数” and do not send the request. If the backend returns `unassigned_journal` or `invalid_journal`, display the API message. “保存草稿” remains enabled for null.

- [ ] **Step 7: Invalidate all affected counts after save**

On success invalidate:

```ts
['admin', 'articles']
['admin', 'journals']
['admin', 'journal']
['admin', 'articles', 'unassigned-count']
```

Then navigate back to `/admin/articles`, preserving the prior list URL when available via location state; otherwise use the default route.

- [ ] **Step 8: Run editor issue tests and build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite
npx playwright test tests/article-issue-management.spec.ts --reporter=line
npm run build
```

Expected: hydration, reassignment, preset, null draft, and client publication guidance all pass.

- [ ] **Step 9: Commit boundary if authorized**

```bash
git add frontend-vite/src/pages/admin/ArticleEditor.tsx frontend-vite/tests/article-issue-management.spec.ts
git commit -m "feat(admin): edit article issue assignment"
```

---

### Task 6: Verify counts, JournalDetail creation, and both publication paths end to end

**Files:**
- Modify if needed: `frontend-vite/src/pages/admin/JournalDetail.tsx:88-94`
- Modify: `frontend-vite/tests/article-issue-management.spec.ts`
- Verify backend/frontend only otherwise

- [ ] **Step 1: Add count refresh test**

Route-mock initial journal counts as Q1=11/Q2=8, edit an article from Q2 to Q1, then return Q1=12/Q2=7 after PUT. Assert invalidated queries update both tab badges without page reload.

- [ ] **Step 2: Add JournalDetail creation-link test**

Open `/admin/journals/2`, click the “方案与思考” tab’s create action, and assert the URL contains both `journal_id=2` and URL-encoded `category=方案与思考`. On the editor, assert both controls are preselected.

- [ ] **Step 3: Add backend integration assertions for both publish paths**

Run:

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest tests/test_admin_article_issues.py tests/test_article_publication.py tests/test_article_media_usage.py -q
```

Expected: generic PUT and dedicated publish both reject unassigned articles and both accept valid journal assignment.

- [ ] **Step 4: Run frontend issue suite**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-issue-management.spec.ts --reporter=line
```

Expected: filters, URL state, counts, editor reassignment, and JournalDetail preset pass.

- [ ] **Step 5: Run full project verification**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && pytest -q
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run lint && npm run lint:admin-tokens && npm run test:tokens && npm run build
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test --reporter=line
```

Expected: all commands pass. If an unrelated pre-existing Playwright test fails, report it with exact output; do not weaken this feature’s tests.

- [ ] **Step 6: Manual browser verification**

At `/admin/articles` verify:

1. tabs show all/current issues/unassigned in newest-first order;
2. selecting second issue preserves filters in URL and resets page to 1;
3. refresh preserves selected issue/filter/page;
4. all view shows issue column; concrete issue view hides it;
5. draft can move to unassigned;
6. unassigned draft cannot publish;
7. reassignment changes both tab counts and lists;
8. existing JournalDetail four-category workflow still works.

- [ ] **Step 7: Commit final boundary if authorized**

```bash
git status --short
git add frontend-vite/src/pages/admin/JournalDetail.tsx frontend-vite/tests/article-issue-management.spec.ts
git commit -m "test(admin): verify article issue management end to end"
```

Only add `JournalDetail.tsx` if it actually required a code change.
