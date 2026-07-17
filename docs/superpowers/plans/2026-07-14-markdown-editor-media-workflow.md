# Markdown Editor Media Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paste, drop, toolbar upload, and media-library selection insert managed images into Markdown without losing cursor position or overwriting concurrent edits.

**Architecture:** The backend from `2026-07-14-unified-media-backend-and-migration.md` remains authoritative for media identity and usage. The controlled MDEditor uses functional React state updates and unique comment markers for asynchronous uploads; a shared `MediaBrowser` serves page and drawer modes, while both toolbars and textarea events call one insertion controller. The article body continues to use the existing shared `ArticleBody` renderer.

**Tech Stack:** React 19, TypeScript 6, @uiw/react-md-editor 4.1.1, TanStack Query 5, Playwright 1.61, existing admin UI primitives and CSS tokens.

**Prerequisite:** Complete Tasks 1–7 of `docs/superpowers/plans/2026-07-14-unified-media-backend-and-migration.md` before starting this plan.

---

## File structure and responsibility map

### Create

| File | Responsibility |
|---|---|
| `frontend-vite/src/components/admin/media/MediaBrowser.tsx` | Shared search/filter/grid/detail UI for full page and selection drawer |
| `frontend-vite/src/components/admin/media/MediaBrowser.css` | Responsive media grid, health/usage/status chips, drawer layout |
| `frontend-vite/src/components/admin/media/MediaDrawer.tsx` | Accessible right-side drawer, alt input, frozen selection insertion |
| `frontend-vite/src/components/admin/Mde/editorImageInsertion.ts` | Pure range, marker, Markdown, and functional replacement helpers |
| `frontend-vite/src/components/admin/Mde/useEditorImages.tsx` | Selection tracking, paste/drop, async upload lifecycle, drawer state, toolbar commands |
| `frontend-vite/tests/media-library.spec.ts` | Full page filters, pagination, usage details, trash/restore, 409 behavior |
| `frontend-vite/tests/article-editor-media.spec.ts` | Paste/drop/upload/select workflows and concurrent-edit preservation |
| `frontend-vite/tests/article-renderer-parity.spec.ts` | Admin/public image renderer parity for canonical and legacy paths |

### Modify

| File | Responsibility of change |
|---|---|
| `frontend-vite/src/services/api.ts:150-166,249-354,442-473` | New media types/filters/usages/lifecycle, upload source, page-count helper, article payload typing |
| `frontend-vite/src/pages/admin/MediaLibrary.tsx:1-127` | Replace catalog-only page with `MediaBrowser mode="page"` |
| `frontend-vite/src/pages/Articles.tsx:122-145` | Compute page count from `total/per_page` instead of `data.pages` |
| `frontend-vite/src/pages/admin/ArticleList.tsx:250-258` | Compute page count from `total/per_page` before the issue-management rewrite |
| `frontend-vite/src/pages/admin/JournalList.tsx:240-248` | Compute page count from `total/per_page` |
| `frontend-vite/src/pages/admin/ArticleEditor.tsx:1-615` | Integrate image controller, textarea handlers, drawer, marker save guard, imported-content typeset fix |
| `frontend-vite/src/pages/admin/ArticleList.css:140-340` | Keep editor styles and add drawer-open responsive layout only; no global layout changes |
| `frontend-vite/src/components/admin/Mde/insertImagePlugin.tsx:1-74` | Replace global DOM mutation command with callback-based upload/library commands, or remove after imports migrate |
| `frontend-vite/src/components/ArticleBody.tsx:14-46,93-193` | Retain legacy resolver; export/test canonical `resolveImageSrc`; do not create a second renderer |
| `frontend-vite/tests/article-autotypeset.spec.ts:66-90` | Assert typesetter receives newly imported Markdown, not stale form content |

### Explicit non-changes

- Do not add raw HTML rendering.
- Do not convert pasted text URLs into images.
- Do not store `media://id` in Markdown.
- Do not mutate `.w-md-editor-content` directly.
- Do not assign `textarea.value` or dispatch synthetic input events.
- Do not promise pixel-precise textarea drop placement.
- Do not create a second media-list API for drawer mode.

---

## Shared frontend contracts

```ts
export type MediaSource = 'paste' | 'drop' | 'upload' | 'docx' | 'legacy' | 'cover' | 'generated'
export type MediaStatus = 'active' | 'trashed'
export type MediaHealth = 'healthy' | 'missing_file' | 'invalid_image'

export interface MediaAsset {
  id: number
  storage_path: string
  url: string
  original_name: string
  mime_type: string
  byte_size: number
  width: number | null
  height: number | null
  sha256: string
  source: MediaSource
  status: MediaStatus
  health: MediaHealth
  uploaded_by: string | null
  created_at: string
  trashed_at: string | null
  filename: string
  mime: string
  size: number
  uploaded_at: string
  kind: 'image'
}

export interface MediaUsage {
  owner_type: 'article' | 'journal'
  owner_id: number
  field: 'content' | 'cover_image'
  title: string
  reference_count: number
}

export type TextRange = { start: number; end: number }
export const UPLOAD_MARKER_PREFIX = '<!--hbsc-upload:'
```

---

### Task 1: Update media API types and remove `pages` dependence from media UI

**Files:**
- Modify: `frontend-vite/src/services/api.ts:150-166,442-473`
- Modify: `frontend-vite/src/pages/admin/MediaLibrary.tsx:1-127`
- Modify: `frontend-vite/src/pages/Articles.tsx:122-145`
- Modify: `frontend-vite/src/pages/admin/ArticleList.tsx:250-258`
- Modify: `frontend-vite/src/pages/admin/JournalList.tsx:240-248`
- Create: `frontend-vite/tests/media-library.spec.ts`

- [ ] **Step 1: Write a failing media-library contract test**

```ts
// frontend-vite/tests/media-library.spec.ts
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

const asset = {
  id: 42, storage_path: '2026/07/a.png', url: '/uploads/2026/07/a.png',
  original_name: 'architecture.png', mime_type: 'image/png', byte_size: 2048,
  width: 1600, height: 900, sha256: 'a'.repeat(64), source: 'upload',
  status: 'active', health: 'healthy', uploaded_by: 'admin',
  created_at: '2026-07-14T08:00:00', trashed_at: null,
  filename: 'a.png', mime: 'image/png', size: 2048,
  uploaded_at: '2026-07-14T08:00:00', kind: 'image',
}

test('media page accepts pagination without pages and filters by filename', async ({ page }) => {
  await login(page)
  let requestURL = ''
  await page.route('**/api/admin/media?**', async route => {
    requestURL = route.request().url()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: [asset], total: 25, page: 1, per_page: 24 }),
    })
  })
  await page.goto(`${baseURL}/admin/media`)
  await expect(page.getByText('architecture.png')).toBeVisible()
  await expect(page.getByRole('button', { name: '2' })).toBeVisible()
  await page.getByPlaceholder('搜索文件名或路径').fill('arch')
  await expect.poll(() => requestURL).toContain('q=arch')
})
```

- [ ] **Step 2: Run and verify the current page fails**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/media-library.spec.ts --reporter=line
```

Expected: no search input and/or pagination relies on missing `data.pages`.

- [ ] **Step 3: Replace legacy `MediaOut` and pagination type**

In `api.ts`, add the shared contracts from this plan and change:

```ts
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  per_page: number
}

export function pageCount(data: Pick<PaginatedResponse<unknown>, 'total' | 'per_page'>): number {
  return Math.max(1, Math.ceil(data.total / data.per_page))
}
```

Do not keep required `pages`; later plans update remaining consumers.

- [ ] **Step 4: Add media list/query/detail/usages/lifecycle methods**

```ts
async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(API_BASE + path, {
    method: 'POST', credentials: 'include', body: formData,
  })
  if (!response.ok) {
    if (response.status === 401) window.location.href = '/admin/login'
    let body: unknown = null
    try { body = await response.json() } catch { body = null }
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(
      error?.message || response.statusText || 'Upload failed',
      error?.code || codeForStatus(response.status),
      response.status,
      body,
    )
  }
  return response.json() as Promise<T>
}

export interface MediaListParams {
  q?: string
  source?: MediaSource
  usage?: 'used' | 'unused'
  status?: MediaStatus
  health?: MediaHealth
  page?: number
  per_page?: number
}

list: (params: MediaListParams = {}): Promise<PaginatedResponse<MediaAsset>> => {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') sp.set(key, String(value))
  })
  return request(`/api/admin/media?${sp.toString()}`)
},
get: (id: number): Promise<MediaAsset> => request(`/api/admin/media/${id}`),
usages: (id: number): Promise<MediaUsage[]> => request(`/api/admin/media/${id}/usages`),
trash: (id: number) => request(`/api/admin/media/${id}`, { method: 'DELETE' }),
restore: (id: number) => request(`/api/admin/media/${id}/restore`, { method: 'POST' }),
purge: (id: number) => request(`/api/admin/media/${id}/purge`, { method: 'DELETE' }),
```

Change image upload to:

```ts
upload: async (file: File, source: 'paste' | 'drop' | 'upload' = 'upload') => {
  const fd = new FormData(); fd.append('file', file)
  return uploadRequest<MediaAsset>(`/api/admin/media?kind=image&source=${source}`, fd)
}
```

Keep a separate compatibility `uploadTable(file)` method for `kind=table`.

- [ ] **Step 5: Replace every `.pages` dependency before building**

In `MediaLibrary`, add search and use `api.admin.media.list({page, per_page:24, q})`. In all four current pagination consumers—`MediaLibrary.tsx`, public `Articles.tsx`, admin `ArticleList.tsx`, and admin `JournalList.tsx`—replace `data.pages` with a local value:

```ts
const pages = data ? pageCount(data) : 1
```

Use `pages` for visibility, page-number array length, next-button disabling, and `Math.min(pages, page + 1)`. Add a search input to `MediaLibrary` with placeholder `搜索文件名或路径`; debounce it by 250 ms and reset page to 1 when filters change. Finally run:

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && rg -n '\.pages' src
```

Expected: no matches.

- [ ] **Step 6: Run build and Playwright test**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run build
npx playwright test tests/media-library.spec.ts --reporter=line
```

Expected: TypeScript build passes; the contract test passes without `pages`.

- [ ] **Step 7: Commit boundary if authorized**

```bash
git add frontend-vite/src/services/api.ts frontend-vite/src/pages/Articles.tsx frontend-vite/src/pages/admin/ArticleList.tsx frontend-vite/src/pages/admin/JournalList.tsx frontend-vite/src/pages/admin/MediaLibrary.tsx frontend-vite/tests/media-library.spec.ts
git commit -m "refactor(media): consume canonical paginated asset API"
```

---

### Task 2: Add pure functional range and upload-marker helpers

**Files:**
- Create: `frontend-vite/src/components/admin/Mde/editorImageInsertion.ts`
- Create: `frontend-vite/tests/article-editor-media.spec.ts`

- [ ] **Step 1: Add a failing browser test for concurrent edits**

```ts
// first test in article-editor-media.spec.ts
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

const LIBRARY_ASSET = {
  id: 42, storage_path: '2026/07/a.png', url: '/uploads/2026/07/a.png',
  original_name: 'architecture.png', mime_type: 'image/png', byte_size: 2048,
  width: 1600, height: 900, sha256: 'a'.repeat(64), source: 'upload',
  status: 'active', health: 'healthy', uploaded_by: 'admin',
  created_at: '2026-07-14T08:00:00', trashed_at: null,
  filename: 'a.png', mime: 'image/png', size: 2048,
  uploaded_at: '2026-07-14T08:00:00', kind: 'image',
}

test('paste upload replaces only its marker and preserves later typing', async ({ page }) => {
  await login(page)
  let releaseUpload!: () => void
  const gate = new Promise<void>(resolve => { releaseUpload = resolve })
  await page.route('**/api/admin/media?kind=image&source=paste', async route => {
    await gate
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 9, url: '/uploads/2026/07/paste.png', storage_path: '2026/07/paste.png', original_name: 'paste.png', mime_type: 'image/png', byte_size: 68, width: 1, height: 1, sha256: 'b'.repeat(64), source: 'paste', status: 'active', health: 'healthy', uploaded_by: 'admin', created_at: '2026-07-14T08:00:00', trashed_at: null, filename: 'paste.png', mime: 'image/png', size: 68, uploaded_at: '2026-07-14T08:00:00', kind: 'image' }),
    })
  })
  await page.goto(`${baseURL}/admin/articles/new`)
  const editor = page.locator('.w-md-editor-text-input').first()
  await editor.fill('before after')
  await editor.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(7, 7))
  await editor.evaluate(node => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'paste.png', { type: 'image/png' }))
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(editor).toHaveValue(/<!--hbsc-upload:/)
  await editor.press('End')
  await editor.type(' later')
  releaseUpload()
  await expect(editor).toHaveValue('before ![paste.png](/uploads/2026/07/paste.png)after later')
})
```

- [ ] **Step 2: Run and verify no marker/upload behavior exists**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-editor-media.spec.ts --reporter=line
```

Expected: paste does not call upload and no marker appears.

- [ ] **Step 3: Implement pure helpers with no DOM mutation**

```ts
// editorImageInsertion.ts
export type TextRange = { start: number; end: number }
export const UPLOAD_MARKER_PREFIX = '<!--hbsc-upload:'

export function clampRange(text: string, range: TextRange): TextRange {
  const start = Math.max(0, Math.min(range.start, text.length))
  const end = Math.max(start, Math.min(range.end, text.length))
  return { start, end }
}

export function replaceRange(text: string, range: TextRange, replacement: string): string {
  const safe = clampRange(text, range)
  return text.slice(0, safe.start) + replacement + text.slice(safe.end)
}

export function uploadMarker(id: string): string {
  return `${UPLOAD_MARKER_PREFIX}${id}-->`
}

export function imageMarkdown(alt: string, url: string): string {
  const safeAlt = alt.replace(/[\[\]\n\r]/g, ' ').trim()
  return `![${safeAlt}](${url})`
}

export function replaceMarker(text: string, marker: string, replacement: string): string {
  const index = text.indexOf(marker)
  if (index < 0) return text
  return text.slice(0, index) + replacement + text.slice(index + marker.length)
}

export function hasUploadMarker(text: string): boolean {
  return text.includes(UPLOAD_MARKER_PREFIX)
}
```

- [ ] **Step 4: Add the controller in Task 3 before expecting the browser test to pass**

Do not introduce a temporary `textarea.value` workaround. Leave the failing test in place and proceed directly to Task 3.

- [ ] **Step 5: Commit only with Task 3 if authorized**

This pure module has no runtime consumer yet; keep it uncommitted until Task 3 makes the vertical slice pass.

---

### Task 3: Implement paste/drop async uploads with functional state updates

**Files:**
- Create: `frontend-vite/src/components/admin/Mde/useEditorImages.tsx`
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx:57-79,260-285,464-472`
- Test: `frontend-vite/tests/article-editor-media.spec.ts`

- [ ] **Step 1: Add a failing marker-deletion test**

```ts
test('deleting a marker before upload completion leaves other text untouched', async ({ page }) => {
  await login(page)
  let releaseUpload!: () => void
  const gate = new Promise<void>(resolve => { releaseUpload = resolve })
  await page.route('**/api/admin/media?kind=image&source=paste', async route => {
    await gate
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 10, url: '/uploads/2026/07/orphan.png', storage_path: '2026/07/orphan.png', original_name: 'orphan.png', mime_type: 'image/png', byte_size: 68, width: 1, height: 1, sha256: 'c'.repeat(64), source: 'paste', status: 'active', health: 'healthy', uploaded_by: 'admin', created_at: '2026-07-14T08:00:00', trashed_at: null, filename: 'orphan.png', mime: 'image/png', size: 68, uploaded_at: '2026-07-14T08:00:00', kind: 'image' }) })
  })
  await page.goto(`${baseURL}/admin/articles/new`)
  const editor = page.locator('.w-md-editor-text-input').first()
  await editor.fill('keep')
  await editor.evaluate(node => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.png', { type: 'image/png' }))
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  const marked = await editor.inputValue()
  await editor.fill(marked.replace(/<!--hbsc-upload:[^>]+-->/, '') + ' user')
  releaseUpload()
  await expect(editor).toHaveValue('keep user')
})
```

- [ ] **Step 2: Implement `useEditorImages` state contract**

```tsx
interface UseEditorImagesArgs {
  content: string
  setContent: React.Dispatch<React.SetStateAction<string>>
  toastError: (message: string) => void
}

export function useEditorImages({ content, setContent, toastError }: UseEditorImagesArgs) {
  const currentContentRef = useRef(content)
  currentContentRef.current = content
  const lastSelection = useRef<TextRange>({ start: content.length, end: content.length })
  const savedDrawerRange = useRef<TextRange | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const remember = (node: HTMLTextAreaElement) => {
    lastSelection.current = { start: node.selectionStart, end: node.selectionEnd }
  }
  // return textareaProps, pendingCount, toolbar commands, drawer state,
  // currentContentRef, and savedDrawerRange from this single controller
}
```

Every async path inserts the marker synchronously with:

```ts
setContent(current => replaceRange(current, range, marker))
```

and completes with:

```ts
setContent(current => replaceMarker(current, marker, imageMarkdown(alt, asset.url)))
```

If the marker no longer exists, `replaceMarker` returns the current content unchanged; the asset remains unused.

- [ ] **Step 3: Implement `onPaste`**

Only intercept when `clipboardData.files` or `clipboardData.items` contains an image. Plain text and URLs return without `preventDefault()`. Use `crypto.randomUUID()` for marker IDs, source `paste`, and default alt `file.name || '粘贴图片'`.

- [ ] **Step 4: Implement `onDrop` with defined fallback**

Only intercept image files. Choose insertion range from event textarea selection, then remembered selection, then `{start: content.length,end:content.length}`. Do not calculate pixel-to-character position.

- [ ] **Step 5: Wire textarea props and save guard**

```tsx
const imageController = useEditorImages({
  content: form.content,
  setContent: updater => setForm(current => ({
    ...current,
    content: typeof updater === 'function' ? updater(current.content) : updater,
  })),
  toastError: toast.error,
})

<MDEditor
  value={form.content}
  onChange={value => update('content', value || '')}
  textareaProps={imageController.textareaProps}
/>
```

Disable save/publish when `pendingCount > 0 || hasUploadMarker(form.content)`. The backend remains the authoritative `422 upload_incomplete` guard.

- [ ] **Step 6: Run both paste tests**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-editor-media.spec.ts --reporter=line
```

Expected: concurrent typing survives; deleted marker stays deleted.

- [ ] **Step 7: Commit Tasks 2–3 boundary if authorized**

```bash
git add frontend-vite/src/components/admin/Mde/editorImageInsertion.ts frontend-vite/src/components/admin/Mde/useEditorImages.tsx frontend-vite/src/pages/admin/ArticleEditor.tsx frontend-vite/tests/article-editor-media.spec.ts
git commit -m "feat(editor): upload pasted and dropped images safely"
```

---

### Task 4: Replace global DOM toolbar mutation with controlled commands

**Files:**
- Modify: `frontend-vite/src/components/admin/Mde/insertImagePlugin.tsx:1-74`
- Modify: `frontend-vite/src/components/admin/Mde/useEditorImages.tsx`
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx:1-10,464-472`
- Test: `frontend-vite/tests/article-editor-media.spec.ts`

- [ ] **Step 1: Add failing toolbar assertions**

```ts
test('toolbar has upload and media-library controls but no built-in URL image button', async ({ page }) => {
  await login(page)
  await page.goto(`${baseURL}/admin/articles/new`)
  await expect(page.getByRole('button', { name: '上传并插入图片' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '从媒体库插入图片' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Add image/ })).toHaveCount(0)
})
```

- [ ] **Step 2: Run and verify failure**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-editor-media.spec.ts -g toolbar --reporter=line
```

Expected: media-library command missing and built-in image command still present.

- [ ] **Step 3: Replace static command with factories**

```tsx
// insertImagePlugin.tsx
import type { ICommand } from '@uiw/react-md-editor'

export function createUploadImageCommand(onExecute: (range: TextRange) => void): ICommand {
  return {
    name: 'upload-image', keyCommand: 'upload-image',
    buttonProps: { 'aria-label': '上传并插入图片', title: '上传并插入图片' },
    icon: <span>🖼 上传图片</span>,
    execute: state => onExecute(state.selection),
  }
}

export function createLibraryImageCommand(onExecute: (range: TextRange) => void): ICommand {
  return {
    name: 'media-library', keyCommand: 'media-library',
    buttonProps: { 'aria-label': '从媒体库插入图片', title: '从媒体库插入图片' },
    icon: <span>▦ 媒体库</span>,
    execute: state => onExecute(state.selection),
  }
}
```

Delete `document.querySelector`, direct `textarea.value`, synthetic `input`, `window.prompt`, and `alert` from this file.

- [ ] **Step 4: Use a filtered default command array**

```tsx
import { getCommands } from '@uiw/react-md-editor/commands'

const editorCommands = useMemo(
  () => getCommands().filter(command => command.name !== 'image'),
  [],
)

<MDEditor
  commands={editorCommands}
  extraCommands={[
    imageController.uploadCommand,
    imageController.libraryCommand,
    tableCommand,
    csvCommand,
  ]}
/>
```

`useEditorImages` stores the selection supplied by each command before opening the file input or drawer.

- [ ] **Step 5: Add a persistent hidden file input to ArticleEditor**

Render one input with `data-testid="editor-image-upload"`. Its change handler calls the controller with source `upload`, then clears the input value. This replaces dynamic DOM input creation and timeout cleanup.

- [ ] **Step 6: Run toolbar test and build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run build
npx playwright test tests/article-editor-media.spec.ts -g toolbar --reporter=line
```

Expected: two intended controls, zero built-in URL image controls, build passes.

- [ ] **Step 7: Commit boundary if authorized**

```bash
git add frontend-vite/src/components/admin/Mde/insertImagePlugin.tsx frontend-vite/src/components/admin/Mde/useEditorImages.tsx frontend-vite/src/pages/admin/ArticleEditor.tsx frontend-vite/tests/article-editor-media.spec.ts
git commit -m "refactor(editor): use controlled image toolbar commands"
```

---

### Task 5: Build the shared media browser and reference-aware page mode

**Files:**
- Create: `frontend-vite/src/components/admin/media/MediaBrowser.tsx`
- Create: `frontend-vite/src/components/admin/media/MediaBrowser.css`
- Modify: `frontend-vite/src/pages/admin/MediaLibrary.tsx`
- Test: `frontend-vite/tests/media-library.spec.ts`

- [ ] **Step 1: Extend failing page-mode tests**

Add route-mocked tests for:

```ts
await expect(page.getByLabel('来源')).toBeVisible()
await expect(page.getByLabel('使用状态')).toBeVisible()
await page.getByText('architecture.png').click()
await expect(page.getByText('文章：红安县数字医共体')).toBeVisible()
```

Add a 409 delete response with `asset_in_use` and assert the modal lists the referencing article instead of claiming deletion succeeded. Add trashed-status route data and assert the primary action is “恢复”.

- [ ] **Step 2: Run and verify current catalog-only page fails**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/media-library.spec.ts --reporter=line
```

Expected: filters/details/restore behavior absent.

- [ ] **Step 3: Implement `MediaBrowser` props and query state**

```tsx
interface MediaBrowserProps {
  mode: 'page' | 'select'
  onSelect?: (asset: MediaAsset) => void
  selectedId?: number | null
}
```

Both modes call the same `api.admin.media.list(params)`. Page mode exposes trash/restore/purge; select mode hides all lifecycle controls and disables assets unless `status==='active' && health==='healthy'`.

- [ ] **Step 4: Implement grid/detail/usages**

Each card shows thumbnail, original name, storage path, dimensions, size, source, status, health, uploader, and date. Selecting a card queries `api.admin.media.usages(id)` and renders owner type/title/field/reference count. Use existing `CoverImage`, `Modal`, `Button`, `IconButton`, and admin tokens.

Render one hidden image input and an “上传图片” button in both modes. It calls `api.admin.media.upload(file, 'upload')`, invalidates the current media list, and in select mode also marks the returned healthy asset as the current selection without inserting it until the caller confirms alt text.

- [ ] **Step 5: Implement safe page lifecycle actions**

- Trash active assets with confirmation.
- On `ApiError.code === 'asset_in_use'`, show returned usages and do not invalidate as if deleted.
- Restore trashed assets.
- Only show purge for eligible server responses; require a second confirmation and never expose purge in select mode.

- [ ] **Step 6: Replace `MediaLibrary` body with page mode**

```tsx
export function MediaLibrary() {
  return (
    <div>
      <PageHeader title="媒体库" description="统一管理正文图片与封面" />
      <MediaBrowser mode="page" />
    </div>
  )
}
```

- [ ] **Step 7: Run tests, token scan, and build**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite
npx playwright test tests/media-library.spec.ts --reporter=line
npm run lint:admin-tokens
npm run build
```

Expected: all pass; no hard-coded admin color literals introduced.

- [ ] **Step 8: Commit boundary if authorized**

```bash
git add frontend-vite/src/components/admin/media/MediaBrowser.tsx frontend-vite/src/components/admin/media/MediaBrowser.css frontend-vite/src/pages/admin/MediaLibrary.tsx frontend-vite/tests/media-library.spec.ts
git commit -m "feat(media): add searchable reference-aware media browser"
```

---

### Task 6: Add the right-side media drawer and frozen selection insertion

**Files:**
- Create: `frontend-vite/src/components/admin/media/MediaDrawer.tsx`
- Modify: `frontend-vite/src/components/admin/media/MediaBrowser.css`
- Modify: `frontend-vite/src/components/admin/Mde/useEditorImages.tsx`
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`
- Modify: `frontend-vite/src/pages/admin/ArticleList.css`
- Test: `frontend-vite/tests/article-editor-media.spec.ts`

- [ ] **Step 1: Add a failing frozen-selection test**

```ts
test('media drawer inserts at the selection captured before drawer focus', async ({ page }) => {
  await login(page)
  await page.route('**/api/admin/media?**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [LIBRARY_ASSET], total: 1, page: 1, per_page: 24 }),
  }))
  await page.goto(`${baseURL}/admin/articles/new`)
  const editor = page.locator('.w-md-editor-text-input').first()
  await editor.fill('left right')
  await editor.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(5, 5))
  await page.getByRole('button', { name: '从媒体库插入图片' }).click()
  await page.getByPlaceholder('搜索文件名或路径').fill('architecture')
  await page.getByText('architecture.png').click()
  await page.getByLabel('图片说明').fill('总体架构')
  await page.getByRole('button', { name: '插入所选图片' }).click()
  await expect(editor).toHaveValue('left ![总体架构](/uploads/2026/07/a.png)right')
})
```

- [ ] **Step 2: Run and verify drawer does not exist**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-editor-media.spec.ts -g drawer --reporter=line
```

Expected: no drawer/media-library button flow.

- [ ] **Step 3: Implement accessible drawer structure**

`MediaDrawer` renders a fixed right panel with `role="dialog"`, `aria-modal="true"`, title “选择媒体”, close button, `MediaBrowser mode="select"`, alt input, and “插入所选图片”. Escape and backdrop close it; lifecycle actions are absent.

- [ ] **Step 4: Freeze and consume the command selection**

When the library command executes:

```ts
savedDrawerRange.current = clampRange(currentContentRef.current, state.selection)
setDrawerOpen(true)
```

Searching/focusing alt never changes this range. Insert calls functional `replaceRange(current, savedDrawerRange.current, imageMarkdown(alt, asset.url))`; if no range was captured, use end-of-content.

- [ ] **Step 5: Add responsive editor/drawer layout**

Use admin tokens only. At desktop width, the drawer is 420 px and overlays from the right without changing global `#root` or viewport width. Below 768 px it fills the viewport width. Do not modify `index.css`, `App.css`, or global background rules.

- [ ] **Step 6: Run drawer, full editor, and build checks**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite
npx playwright test tests/article-editor-media.spec.ts --reporter=line
npm run lint:admin-tokens
npm run build
```

Expected: selection preserved after search/alt focus; all paste/drop/toolbar tests pass.

- [ ] **Step 7: Commit boundary if authorized**

```bash
git add frontend-vite/src/components/admin/media/MediaDrawer.tsx frontend-vite/src/components/admin/media/MediaBrowser.css frontend-vite/src/components/admin/Mde/useEditorImages.tsx frontend-vite/src/pages/admin/ArticleEditor.tsx frontend-vite/src/pages/admin/ArticleList.css frontend-vite/tests/article-editor-media.spec.ts
git commit -m "feat(editor): insert existing media from a side drawer"
```

---

### Task 7: Fix DOCX auto-typeset stale content

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx:124-172`
- Modify: `frontend-vite/tests/article-autotypeset.spec.ts:66-90`

- [ ] **Step 1: Strengthen the existing failing Playwright test**

Capture the request body:

```ts
let typesetBody: { content_markdown?: string } | null = null
await page.route('**/api/admin/articles/typeset', async route => {
  typesetBody = route.request().postDataJSON()
  await route.fulfill({ status: 200, contentType: 'application/json', body: TYPESET_STUB })
})
// after upload
expect(typesetBody?.content_markdown).toBe('# 原标题\n\n原始 pandoc 输出')
```

- [ ] **Step 2: Run and verify it receives stale pre-import content**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-autotypeset.spec.ts -g '自动打开' --reporter=line
```

Expected: captured `content_markdown` is empty or old form content.

- [ ] **Step 3: Make typeset input explicit**

```ts
const openTypeset = async (content: string, style: TypesetStyle = 'academic') => {
  const res = await api.admin.articles.typeset(content, { style })
  setTypesetDialog({ before: content, after: res.content_markdown, warnings: res.warnings || [], model: res.model, promptVersion: res.prompt_version, style })
}

const handleTypeset = (style: TypesetStyle = 'academic') => openTypeset(form.content, style)
```

In `handleImportDocx`, compute `const imported = result.content_markdown || form.content`, update the form once with a functional update, and call `await openTypeset(imported, 'academic')`.

- [ ] **Step 4: Run the full existing auto-typeset suite**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-autotypeset.spec.ts --reporter=line
```

Expected: all existing cases plus request-body assertion pass.

- [ ] **Step 5: Commit boundary if authorized**

```bash
git add frontend-vite/src/pages/admin/ArticleEditor.tsx frontend-vite/tests/article-autotypeset.spec.ts
git commit -m "fix(editor): typeset newly imported markdown"
```

---

### Task 8: Verify shared `ArticleBody` parity and legacy compatibility

**Files:**
- Modify: `frontend-vite/src/components/ArticleBody.tsx:14-46`
- Create: `frontend-vite/tests/article-renderer-parity.spec.ts`

- [ ] **Step 1: Add failing/guarding parity coverage**

Create the complete Playwright guard:

```ts
// frontend-vite/tests/article-renderer-parity.spec.ts
import { test, expect } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'
const adminPw = process.env.ADMIN_PW ?? 'admin123'
const slug = 'openclaw-agent-framework'
const markdown = [
  '![canonical](/uploads/2026/07/a.png)',
  '![legacy](media/image1.png)',
].join('\n')
const article = {
  id: 19, title: 'Renderer parity', slug, summary: '', content: markdown,
  cover_image: null, cover_image_alt: '', category: '技术与产业',
  author_name: 'Admin', reading_time: 5, views: 0, featured: false,
  status: 'draft', tags: [], journal_id: 2, journal_title: '2026年第二期',
}

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${baseURL}/admin/login`)
  await page.fill('#username', 'admin')
  await page.fill('#password', adminPw)
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')
}

async function imageSources(page: import('@playwright/test').Page) {
  return page.locator('.prose-figure-img').evaluateAll(images =>
    images.map(image => image.getAttribute('src')),
  )
}

test('admin preview and public page resolve canonical and legacy images identically', async ({ page }) => {
  await login(page)
  await page.route('**/api/admin/settings', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }),
  }))
  await page.route('**/api/admin/articles/19', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(article),
  }))
  await page.goto(`${baseURL}/admin/articles/19`)
  await page.getByRole('button', { name: '预览' }).click()
  const adminSources = await imageSources(page)

  await page.route(`**/api/articles/${slug}`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      ...article, status: 'published', published_at: '2026-07-14T08:00:00', related: [],
    }),
  }))
  await page.route(`**/api/articles/${slug}/view`, route => route.fulfill({ status: 204 }))
  await page.goto(`${baseURL}/articles/${slug}`)
  const publicSources = await imageSources(page)

  expect(publicSources).toEqual(adminSources)
  expect(publicSources).toEqual([
    '/uploads/2026/07/a.png',
    '/uploads/source-images/03-openclaw/image1.png',
  ])
})
```

This is a guarding test because both surfaces already share `ArticleBody`; it fails only if current or future edits introduce drift.

- [ ] **Step 2: Export the resolver for direct accountability**

Change only:

```ts
export function resolveImageSrc(src: string, slug?: string): string
```

Do not duplicate it or move rendering out of `ArticleBody`.

- [ ] **Step 3: Run parity test**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npx playwright test tests/article-renderer-parity.spec.ts --reporter=line
```

Expected: admin and public `src` arrays match for canonical and legacy inputs.

- [ ] **Step 4: Run all frontend verification**

```bash
cd /Users/jasonlee/hubei-shuchuang/frontend-vite
npm run lint
npm run lint:admin-tokens
npm run test:tokens
npm run build
npx playwright test tests/media-library.spec.ts tests/article-editor-media.spec.ts tests/article-autotypeset.spec.ts tests/article-renderer-parity.spec.ts --reporter=line
```

Expected: every command passes.

- [ ] **Step 5: Commit boundary if authorized**

```bash
git add frontend-vite/src/components/ArticleBody.tsx frontend-vite/tests/article-renderer-parity.spec.ts
git commit -m "test(editor): lock admin and public markdown parity"
```

---

### Task 9: End-to-end verification against a disposable article

**Files:**
- Verify runtime only; do not edit article 19 or production data in this task.

- [ ] **Step 1: Start backend/frontend using project commands**

```bash
cd /Users/jasonlee/hubei-shuchuang/backend && uvicorn app.main:app --reload --port 8000
cd /Users/jasonlee/hubei-shuchuang/frontend-vite && npm run dev -- --port 5174
```

Expected: `/api/health` and `/admin/login` respond.

- [ ] **Step 2: Exercise all four insertion paths on a disposable draft**

Using Playwright or the browser:

1. create an unassigned draft;
2. paste a PNG;
3. type while upload is pending;
4. drop a second PNG;
5. upload a third through toolbar;
6. select an existing fourth image from the drawer;
7. save the draft.

- [ ] **Step 3: Verify media-library management**

For each new asset, confirm source, dimensions, health, and uploader. After draft save, usages show the draft article and correct reference counts. Trash returns 409 while referenced. Remove one Markdown image and save; its asset becomes active/unused and can be moved to trash and restored with the same URL.

- [ ] **Step 4: Verify failed upload behavior**

Simulate a 422 and a network failure. The marker disappears, other text remains, an error toast appears, and no `<!--hbsc-upload:` marker can be persisted.

- [ ] **Step 5: Verify no unexpected data mutation**

Delete only the disposable draft and optional disposable assets. Confirm no historical file, article 19 content, journal assignment, or cover changed during this plan.
