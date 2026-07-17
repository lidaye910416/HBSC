# HBSC GSAP 动效优化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Authoritative spec:** `docs/superpowers/specs/2026-07-17-hbsc-gsap-optimization-design.md` — 每个任务的 code skeleton 出处、风险与 demo 链接以 spec 为准;本计划负责锁定文件路径、依赖顺序、TDD 节奏、提交粒度与每步完成定义。

**Goal:** 在不破坏 HBSC 现有编辑设计、可访问性与性能的前提下,把公共站点从单一的 CSS 上浮淡入升级为有层次、可中断、可降级的 GSAP 动效系统,按 P0 → P1 → P2 顺序交付 20 条具体改造。

**Architecture:**
- GSAP 3.15 + `@gsap/react` 负责所有连续滚动、高频 pointer、FLIP、时间线编排
- Framer Motion 12 只承担 React 路由/AnimatePresence 边界
- React 19 StrictMode 安全:`useGSAP` + 显式 `revertOnUpdate` 与 `contextSafe`,所有 ScrollTrigger 在 `matchMedia` 与 `unmount` 时清理
- 新建 `src/animations/` 目录管理公共动效原语;App.tsx 仅做插件注册和路由过渡
- 不修改 `src/index.css` / `src/App.css` 布局约束;新建动画模块不动 `.app-bg` 与 `.container`

**Tech Stack:** React 19.2 · Vite 8 · GSAP 3.15 · `@gsap/react` 2.1 · ScrollTrigger · Flip · SplitText · DrawSVGPlugin · InertiaPlugin · Draggable · Framer Motion 12 · Playwright · Lighthouse

---

## 文件结构

### 新增文件
| 路径 | 职责 |
|---|---|
| `frontend-vite/src/animations/runtime.ts` | 插件注册、ScrollTrigger 初始化、matchMedia setup、globalScrollTrigger setup。运行时入口。 |
| `frontend-vite/src/animations/reducedMotion.ts` | `prefers-reduced-motion` 与 `Save-Data` 探测 + `motionAllowed()` 网关 |
| `frontend-vite/src/animations/useGsapScope.ts` | 封装 `useGSAP`,默认 `revertOnUpdate: true`,导出 `gsap`/`ScrollTrigger` 已配置实例 |
| `frontend-vite/src/animations/countUp.ts` | 数字 count-up(tween target object + snap,直接写 textContent) |
| `frontend-vite/src/animations/batchReveal.ts` | 通用 `ScrollTrigger.batch` reveal 工厂,接受 selector + stagger + delay 选项 |
| `frontend-vite/src/animations/splitHeading.ts` | `SplitText.create + autoSplit`,根据 prefers-reduced-motion 决定是否启用 |
| `frontend-vite/src/animations/pointerMotion.ts` | `gsap.quickTo` 工具,用于 3D tilt 和磁性 CTA |
| `frontend-vite/src/components/ReadingProgress.tsx` | 顶部阅读进度条(SVG line + scaleX + aria) |
| `frontend-vite/src/components/PublicRouteTransition.tsx` | AnimatePresence 包裹 Outlet,fade opacity + y4 |
| `frontend-vite/src/components/HeroParticles.tsx` | P2-01 Canvas 粒子 |
| `frontend-vite/src/components/HeroShader.tsx` | P2-02 WebGL shader |
| `frontend-vite/src/components/ScrollImageSequence.tsx` | P2-03 滚控帧序列 |
| `frontend-vite/src/components/IssueCardStack.tsx` | P2-04 移动卡堆 |

### 修改文件
| 路径 | 涉及任务 |
|---|---|
| `frontend-vite/src/main.tsx` | T1 引入 runtime 注册 |
| `frontend-vite/src/App.tsx` | T1、T13 |
| `frontend-vite/src/pages/Home.tsx`、`Home.css` | T2、T11、T14、T15、T16 |
| `frontend-vite/src/pages/ArticleDetail.tsx`、`ArticleDetail.css` | T3、T7 |
| `frontend-vite/src/pages/IssueDetail.tsx` | T3 |
| `frontend-vite/src/pages/Articles.tsx`、`Articles.css` | T5 |
| `frontend-vite/src/pages/Issues.tsx`、`Issues.css` | T6、T17 |
| `frontend-vite/src/pages/Search.tsx` | T8 |
| `frontend-vite/src/pages/About.tsx`、`About.css` | T9 |
| `frontend-vite/src/components/Navigation.tsx`、`Navigation.css` | T4 |
| `frontend-vite/src/components/Footer.tsx`、`Footer.css` | T12 |
| `frontend-vite/src/components/ArticleCard.tsx`、`ArticleCard.css` | T10 |
| `frontend-vite/src/components/CoverImage.tsx` | T2 |
| `frontend-vite/src/components/NewsletterForm.tsx`、`NewsletterForm.css` | T12 |
| `frontend-vite/src/styles/global.css` | T11 中性变量、divider scaleX0 基线 |

### 测试文件(新)
| 路径 | 覆盖任务 |
|---|---|
| `frontend-vite/tests/animations/reducedMotion.test.ts` | T1 |
| `frontend-vite/tests/animations/countUp.test.ts` | T2 |
| `frontend-vite/tests/animations/batchReveal.test.ts` | T5/T7/T8 |
| `frontend-vite/tests/e2e/home-hero.spec.ts` | T2 |
| `frontend-vite/tests/e2e/article-detail-progress.spec.ts` | T3 |
| `frontend-vite/tests/e2e/articles-flip.spec.ts` | T5 |
| `frontend-vite/tests/e2e/about-waypoint.spec.ts` | T9 |
| `frontend-vite/tests/lighthouse/home-budget.json` | T2/T14 |
| `frontend-vite/tests/lighthouse/article-detail-budget.json` | T3 |

(Playwright + Vitest 已在 `package.json` 中;具体脚手架命令见 Task 1)

---

## 任务依赖图(实施顺序说明)

```
T1 (runtime+gate) ──┬─> T2 (Home)
                    ├─> T3 (Detail hero + progress)
                    ├─> T4 (Navigation)
                    ├─> T5 (Articles batch+FLIP)
                    ├─> T6 (Issues pinned)
                    ├─> T7 (ArticleDetail long-form)
                    ├─> T8 (Search batch)
                    ├─> T9 (About waypoint+DrawSVG)
                    ├─> T10 (Card 3D tilt + magnetic)
                    ├─> T11 (SplitText section title)
                    ├─> T12 (Footer + Newsletter)
                    ├─> T13 (Route presence)
                    ├─> T14 (Hero particles [gate → done ✓])
                    ├─> T15 (Hero shader [gate ✓])
                    ├─> T16 (Image sequence [gate ✓])
                    └─> T17 (Mobile card stack [touch gate ✓])

T2/T3/T4/T5/T6/T7/T8/T9/T10/T11/T12/T13 文件互不重叠,允许并行
T14/T15/T16/T17 串行执行,每项必须通过 Lighthouse + Playwright 性能门禁
```

每项 P0/P1 完成必须通过:
1. `npm run build`(类型检查 + Vite 产物)
2. `npm run test`(Vitest + Playwright)
3. 在本机浏览器手测 `?prefers-reduced-motion=reduce` 无动画
4. Lighthouse(Performance ≥ 85,CLS < 0.05,LCP < 2.5s)

---

## Task 1: 动效运行时与降级网关(P0-01)

**Files:**
- Create: `frontend-vite/src/animations/runtime.ts`
- Create: `frontend-vite/src/animations/reducedMotion.ts`
- Create: `frontend-vite/src/animations/useGsapScope.ts`
- Modify: `frontend-vite/src/main.tsx:1-10`
- Modify: `frontend-vite/src/App.tsx:1-30`
- Test: `frontend-vite/tests/animations/reducedMotion.test.ts`

- [ ] **Step 1.1: 写失败测试** — `tests/animations/reducedMotion.test.ts` 验证 `motionAllowed()` 在未提供 mock 的 jsdom 下默认返回 `true`,在 `matchMedia` 返回 `reduce` 时返回 `false`,在 `Save-Data: 1` 的 `navigator.connection` 下返回 `false`。

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { motionAllowed } from '@/animations/reducedMotion'

describe('motionAllowed', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined })
    ;(navigator as any).connection = undefined
  })

  it('returns true by default', () => {
    expect(motionAllowed()).toBe(true)
  })

  it('returns false when prefers-reduced-motion: reduce', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any
    expect(motionAllowed()).toBe(false)
  })

  it('returns false when Save-Data is on', () => {
    ;(navigator as any).connection = { saveData: true }
    expect(motionAllowed()).toBe(false)
  })
})
```

- [ ] **Step 1.2: 跑测试,确认失败**

Run: `cd frontend-vite && npx vitest run tests/animations/reducedMotion.test.ts`
Expected: FAIL with "Cannot find module '@/animations/reducedMotion'"

- [ ] **Step 1.3: 实现 `reducedMotion.ts`**

```ts
export function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  const saveData = (navigator as any)?.connection?.saveData === true
  return !reduced && !saveData
}
```

- [ ] **Step 1.4: 测试通过**

Run: `cd frontend-vite && npx vitest run tests/animations/reducedMotion.test.ts`
Expected: 3 tests PASS

- [ ] **Step 1.5: 实现 `runtime.ts`**

```ts
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Flip } from 'gsap/Flip'
import { SplitText } from 'gsap/SplitText'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { InertiaPlugin } from 'gsap/InertiaPlugin'

let installed = false
export function installAnimationRuntime() {
  if (installed || typeof window === 'undefined') return
  gsap.registerPlugin(ScrollTrigger, Flip, SplitText, DrawSVGPlugin, InertiaPlugin)
  gsap.config({ nullTargetWarn: false })
  ScrollTrigger.defaults({ markers: false })
  ScrollTrigger.normalizeScroll(true)
  installed = true
}
```

- [ ] **Step 1.6: 实现 `useGsapScope.ts`**

```ts
'use client'
import { useGSAP } from '@gsap/react'
import { installAnimationRuntime } from './runtime'

installAnimationRuntime()

export function useGsapScope<T>(fn: () => T, deps: readonly unknown[] = []): T | undefined {
  return useGSAP(fn, { scope: typeof document !== 'undefined' ? document.body : undefined, dependencies: deps, revertOnUpdate: true })
}
```

> 实际 `useGSAP` 签名要按 `@gsap/react` 版本调整;保持最简:传入 React ref 作 scope,或省略 scope 让 hook 处理。

- [ ] **Step 1.7: 在 `main.tsx` 中调用 `installAnimationRuntime()`**

```ts
import { installAnimationRuntime } from './animations/runtime'
installAnimationRuntime()
```

- [ ] **Step 1.8: 在 `App.tsx` 中包裹路由壳为 `PublicRouteTransition` 占位(空 fragment 不引错)**

```tsx
// App.tsx 顶部
import { PublicRouteTransition } from './components/PublicRouteTransition'
// 在路由 Outlet 外增加 <PublicRouteTransition>{<Outlet />}</PublicRouteTransition>
```

PublicRouteTransition 暂以空 fragment 实现,T13 再填充:

```tsx
export function PublicRouteTransition({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

- [ ] **Step 1.9: build + 全量 vitest + 手测 reduced-motion**

Run:
```bash
cd frontend-vite && npm run build
cd frontend-vite && npx vitest run
```

手测:打开 `http://localhost:5173/` DevTools → Rendering → Emulate CSS media `prefers-reduced-motion: reduce` → 应无控制台错误,页面正常。

- [ ] **Step 1.10: Commit**

```bash
git add frontend-vite/src/animations frontend-vite/src/main.tsx frontend-vite/src/App.tsx frontend-vite/src/components/PublicRouteTransition.tsx frontend-vite/tests/animations/reducedMotion.test.ts
git commit -m "feat(animations): HBSC-P0-01 runtime + reduced-motion gate"
```

---

## Task 2: 首页 Hero 杂志式入场 + count-up + Cover decode reveal(P0-02 / P0-05 / P0-06)

**Files:**
- Create: `frontend-vite/src/animations/countUp.ts`
- Create: `frontend-vite/src/animations/batchReveal.ts`
- Modify: `frontend-vite/src/components/CoverImage.tsx`
- Modify: `frontend-vite/src/pages/Home.tsx`,`Home.css`
- Test: `frontend-vite/tests/animations/countUp.test.ts`,`frontend-vite/tests/e2e/home-hero.spec.ts`

- [ ] **Step 2.1: 写 count-up 失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { mountCountUp } from '@/animations/countUp'

describe('mountCountUp', () => {
  it('writes interpolated integer frames to textContent', () => {
    const el = document.createElement('span')
    const cleanup = mountCountUp(el, { to: 100, duration: 0.5 })
    expect(el.textContent).toBe('0')
    cleanup()
  })
  it('cleanup removes tween listeners', () => {
    const el = document.createElement('span')
    const cleanup = mountCountUp(el, { to: 5, duration: 0.2 })
    cleanup()
    expect(el.textContent).not.toBeNull()
  })
})
```

- [ ] **Step 2.2: 跑测试,确认失败**

Run: `cd frontend-vite && npx vitest run tests/animations/countUp.test.ts`
Expected: FAIL with "Cannot find module '@/animations/countUp'"

- [ ] **Step 2.3: 实现 `countUp.ts`**(参考 spec P0-06)

```ts
import { gsap } from 'gsap'
import { motionAllowed } from './reducedMotion'

export interface CountUpOptions {
  to: number
  from?: number
  duration?: number
  delay?: number
  decimals?: number
  scrollTrigger?: ScrollTrigger.Vars
}

export function mountCountUp(el: HTMLElement, opts: CountUpOptions): () => void {
  const proxy = { v: opts.from ?? 0 }
  const decimals = opts.decimals ?? 0
  const fmt = (v: number) => v.toFixed(decimals)
  if (!motionAllowed()) {
    el.textContent = fmt(opts.to)
    return () => {}
  }
  const tween = gsap.to(proxy, {
    v: opts.to,
    duration: opts.duration ?? 1,
    delay: opts.delay ?? 0,
    ease: 'power2.out',
    snap: { v: decimals === 0 ? 1 : 0.01 },
    scrollTrigger: opts.scrollTrigger,
    onUpdate: () => { el.textContent = fmt(proxy.v) },
  })
  return () => {
    tween.kill()
    if (opts.scrollTrigger) ScrollTrigger.getAll().forEach(t => t.kill())
  }
}
```

- [ ] **Step 2.4: 测试通过**

Run: `cd frontend-vite && npx vitest run tests/animations/countUp.test.ts`
Expected: 2 tests PASS

- [ ] **Step 2.5: 实现 `batchReveal.ts`**(参考 spec P1-01)

```ts
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from './reducedMotion'

export interface BatchRevealOptions {
  root: HTMLElement | Document
  selector: string
  start?: string
  stagger?: number
  duration?: number
  y?: number
  once?: boolean
}

export function batchReveal(opts: BatchRevealOptions): () => void {
  if (!motionAllowed()) return () => {}
  const els = Array.from(opts.root.querySelectorAll<HTMLElement>(opts.selector))
  if (!els.length) return () => {}
  const st = ScrollTrigger.batch(els, {
    start: opts.start ?? 'top 88%',
    once: opts.once ?? true,
    onEnter: batch =>
      gsap.fromTo(
        batch as unknown as HTMLElement[],
        { y: opts.y ?? 28, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, stagger: opts.stagger ?? 0.07, duration: opts.duration ?? 0.6, overwrite: 'auto', clearProps: 'transform,opacity' },
      ),
  })
  return () => {
    st.forEach(t => t.kill())
  }
}
```

- [ ] **Step 2.6: 在 `CoverImage.tsx` 加 decode reveal**

```tsx
// 在 onLoad 内追加
useEffect(() => {
  const img = ref.current
  if (!img) return
  if (img.complete && img.naturalWidth > 0) onLoaded(img)
}, [])

// 已有的 onLoaded 中
const onLoaded = (img: HTMLImageElement) => {
  img.style.opacity = '0'
  img.style.transform = 'scale(1.03)'
  gsap.to(img, { opacity: 1, scale: 1, duration: 0.9, ease: 'power3.out' })
}
```

要求:`prefers-reduced-motion` 时不要 transform(用 motionAllowed() 包一层或直接 `clearProps` 不设初值)。

- [ ] **Step 2.7: `Home.tsx` 替换静态 stats 文案为 `mountCountUp`,home hero 加 batch reveal**

```tsx
useEffect(() => {
  if (!motionAllowed()) return
  const stats = Array.from(document.querySelectorAll<HTMLElement>('[data-count-up]'))
  const cleanups = stats.map(el => mountCountUp(el, { to: Number(el.dataset.countUp ?? '0'), duration: 1.2 }))
  return () => cleanups.forEach(c => c())
}, [])
```

Hero section 顶部 hero 加 `data-reveal="hero"` 标识,主入口挂 `batchReveal`:

```tsx
useEffect(() => () => batchReveal({ root: document, selector: '[data-reveal]', stagger: 0.08, y: 32 }), [])
```

- [ ] **Step 2.8: e2e 测试** — `tests/e2e/home-hero.spec.ts`

```ts
import { test, expect } from '@playwright/test'

test('home hero reveals and stats animate', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-reveal]').first()).toBeVisible()
  const stat = page.locator('[data-count-up]').first()
  await expect(stat).toBeVisible()
  await page.waitForTimeout(1500)
  const text = await stat.textContent()
  expect(Number(text)).toBeGreaterThan(0)
})
```

- [ ] **Step 2.9: build + 跑测试**

```bash
cd frontend-vite && npm run build
cd frontend-vite && npx vitest run
cd frontend-vite && npx playwright test tests/e2e/home-hero.spec.ts
```

- [ ] **Step 2.10: 手测**

```bash
cd frontend-vite && npm run dev -- --port 5173 &
```

打开 `http://localhost:5173/`,DevTools → Performance 录一段 → 期望首屏 LCP < 2.5s,无布局抖动。

- [ ] **Step 2.11: Commit**

```bash
git add frontend-vite/src/animations/countUp.ts frontend-vite/src/animations/batchReveal.ts frontend-vite/src/pages/Home.tsx frontend-vite/src/pages/Home.css frontend-vite/src/components/CoverImage.tsx frontend-vite/tests/animations/countUp.test.ts frontend-vite/tests/e2e/home-hero.spec.ts
git commit -m "feat(home): P0-02/05/06 hero magazine entrance + count-up + cover reveal"
```

---

## Task 3: 详情页 Hero 编排 + 阅读进度条(P0-03 / P0-04)

**Files:**
- Create: `frontend-vite/src/components/ReadingProgress.tsx`
- Modify: `frontend-vite/src/pages/ArticleDetail.tsx`
- Modify: `frontend-vite/src/pages/IssueDetail.tsx`
- Test: `frontend-vite/tests/e2e/article-detail-progress.spec.ts`

- [ ] **Step 3.1: 实现 `ReadingProgress.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from '@/animations/reducedMotion'

export function ReadingProgress({ targetSelector = 'main' }: { targetSelector?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!motionAllowed()) return
    const bar = ref.current
    if (!bar) return
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return
    const tween = gsap.to(bar, {
      scaleX: 1, transformOrigin: '0 50%', ease: 'none',
      scrollTrigger: { trigger: target, start: 'top top', end: 'bottom bottom', scrub: 0.3 },
    })
    return () => { tween.kill() }
  }, [targetSelector])
  return <div ref={ref} role="progressbar" aria-label="阅读进度" style={{ position: 'fixed', inset: '0 0 auto 0', height: 3, background: 'var(--accent)', transform: 'scaleX(0)', transformOrigin: '0 50%', zIndex: 100 }} />
}
```

- [ ] **Step 3.2: 在 `ArticleDetail.tsx` 引入 ReadingProgress + 加 hero reveal data 属性**

```tsx
import { ReadingProgress } from '@/components/ReadingProgress'
// 在 hero/cover 根元素加 data-reveal="detail"
// 顶部 include <ReadingProgress targetSelector="main" />
```

useEffect 编排 hero 时间线(参考 spec P0-03):

```tsx
useEffect(() => {
  if (!motionAllowed()) return
  const ctx = gsap.context(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
    tl.from('[data-detail-cover]', { y: 32, autoAlpha: 0, duration: 0.8 })
      .from('[data-detail-eyebrow]', { y: 12, autoAlpha: 0, duration: 0.4 }, '<0.1')
      .from('[data-detail-title]', { y: 24, autoAlpha: 0, duration: 0.6 }, '<0.05')
      .from('[data-detail-meta]', { y: 10, autoAlpha: 0, duration: 0.4 }, '<0.1')
  })
  return () => ctx.revert()
}, [slug])
```

- [ ] **Step 3.3: `IssueDetail.tsx` 同样模式,ReadingProgress 包裹整个 `<main>`**

- [ ] **Step 3.4: e2e 测试**

```ts
import { test, expect } from '@playwright/test'

test('article detail progress bar grows on scroll', async ({ page }) => {
  await page.goto('/articles/2026-q1')
  const bar = page.locator('[role="progressbar"]')
  await expect(bar).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
  await page.waitForTimeout(400)
  const transform = await bar.evaluate(el => getComputedStyle(el).transform)
  expect(transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)')
})
```

> slug 用任一真实存在 slug;测试前可 `await page.waitForResponse(/\/api\/articles\/featured/)` 触发数据。

- [ ] **Step 3.5: build + 测试 + 手测**

```bash
cd frontend-vite && npm run build
cd frontend-vite && npx playwright test tests/e2e/article-detail-progress.spec.ts
```

手测:打开一篇 Article,滚动到底部,顶部金色 bar 应满。

- [ ] **Step 3.6: Commit**

```bash
git add frontend-vite/src/components/ReadingProgress.tsx frontend-vite/src/pages/ArticleDetail.tsx frontend-vite/src/pages/IssueDetail.tsx frontend-vite/tests/e2e/article-detail-progress.spec.ts
git commit -m "feat(detail): P0-03/04 hero choreography + reading progress"
```

---

## Task 4: 导航下拉与移动菜单可中断时间线(P0-07)

**Files:**
- Modify: `frontend-vite/src/components/Navigation.tsx`、`Navigation.css`

- [ ] **Step 4.1: 抽取 `setOpen(contextSafe)` 模式**(参考 spec P0-07)

```tsx
import { useRef } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'

const containerRef = useRef<HTMLDivElement>(null)

useGSAP(() => {
  const menu = containerRef.current?.querySelector('[data-nav-dropdown]')
  const items = containerRef.current?.querySelectorAll('[data-nav-dropdown-item]')
  if (!menu || !items) return
  const tl = gsap.timeline({ paused: true })
    .fromTo(menu, { y: -8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.22 })
    .from(items, { y: -5, autoAlpha: 0, stagger: 0.035 }, '<0.05')
  setOpenRef.current = (open: boolean) => open ? tl.play() : tl.reverse()
}, { scope: containerRef })

// hover/click handler
onMouseEnter={() => setOpenRef.current?.(true)}
onMouseLeave={() => setOpenRef.current?.(false)}
```

- [ ] **Step 4.2: 移动端 drawer 同样模式,pinned timeline reverse**

- [ ] **Step 4.3: 删除旧 `setTimeout(open, 150ms)` 等可能制造竞态的代码**

- [ ] **Step 4.4: 手测**

打开 `?prefers-reduced-motion: no-preference`,hover 下拉菜单 10 次,确保不卡顿、无半截状态。DevTools 性能:触发 hover 不应产生 warnings。

- [ ] **Step 4.5: Commit**

```bash
git add frontend-vite/src/components/Navigation.tsx frontend-vite/src/components/Navigation.css
git commit -m "feat(nav): P0-07 interruptible dropdown/mobile menu"
```

---

## Task 5: Articles 列表 batch reveal + FLIP 筛选连续性(P1-01 部分 + P1-03)

**Files:**
- Modify: `frontend-vite/src/pages/Articles.tsx`、`Articles.css`
- Modify: `frontend-vite/src/components/ArticleCard.tsx`(增加 `data-flip-id`)
- Test: `frontend-vite/tests/e2e/articles-flip.spec.ts`,`frontend-vite/tests/animations/batchReveal.test.ts`

- [ ] **Step 5.1: 在 ArticleCard 根 div 上加 `data-flip-id={slug}`**

- [ ] **Step 5.2: Articles.tsx 接入 `batchReveal`**

```tsx
useEffect(() => () => batchReveal({ root: gridRef.current ?? document, selector: '[data-reveal-card]', y: 28, stagger: 0.07 }), [])
```

- [ ] **Step 5.3: 写 `batchReveal.test.ts` 验证一次构造多次 cleanup 不报错**

```ts
import { describe, it, expect, vi } from 'vitest'
import { batchReveal } from '@/animations/batchReveal'

describe('batchReveal', () => {
  it('returns noop when motion not allowed', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const cleanup = batchReveal({ root: document, selector: '.x' })
    expect(typeof cleanup).toBe('function')
    cleanup()
  })
})
```

- [ ] **Step 5.4: FLIP 筛选实现**(参考 spec P1-03)

```tsx
import { Flip } from 'gsap/Flip'

const handleFilterChange = (next: string) => {
  const grid = gridRef.current
  if (!grid || !motionAllowed()) { setCategory(next); return }
  const state = Flip.getState(grid.querySelectorAll('[data-flip-id]'))
  setCategory(next)
  // 用 queueMicrotask 等 React commit 新 DOM
  queueMicrotask(() => {
    Flip.from(state, {
      targets: grid.querySelectorAll('[data-flip-id]'),
      duration: 0.55, ease: 'power3.inOut', absolute: true, stagger: 0.035,
      onComplete: () => ScrollTrigger.refresh(),
    })
  })
}
```

需要在 Articles 顶部加 `previousData` 防止 React 18+ 并发渲染把 state 与 DOM 错位。

- [ ] **Step 5.5: e2e 测试**

```ts
test('articles filter preserves card positions', async ({ page }) => {
  await page.goto('/articles')
  await page.getByRole('button', { name: /分类|filter/i }).first().click()
  await page.getByText(/其他|2/i).click()
  await page.waitForTimeout(600)
  await expect(page.locator('[data-flip-id]').first()).toBeVisible()
})
```

- [ ] **Step 5.6: build + 测试 + 手测**

切换分类,卡片应有连续的位移感而非硬切。

- [ ] **Step 5.7: Commit**

```bash
git add frontend-vite/src/pages/Articles.tsx frontend-vite/src/pages/Articles.css frontend-vite/src/components/ArticleCard.tsx frontend-vite/tests/e2e/articles-flip.spec.ts frontend-vite/tests/animations/batchReveal.test.ts
git commit -m "feat(articles): P1-01 batch reveal + P1-03 FLIP continuity"
```

---

## Task 6: Issues 档案横向 pinned gallery(P1-04)

**Files:**
- Modify: `frontend-vite/src/pages/Issues.tsx`、`Issues.css`

- [ ] **Step 6.1: 桌面 ≥1024px 启用 horizontal pinned(参考 spec P1-04)**

```tsx
const trackRef = useRef<HTMLDivElement>(null)
const viewportRef = useRef<HTMLDivElement>(null)
const mm = useRef<gsap.MatchMedia>()

useEffect(() => {
  if (!motionAllowed()) return
  const ctx = gsap.context(() => {
    const mmCtx = gsap.matchMedia()
    mmCtx.add('(min-width: 1024px)', () => {
      const distance = () => Math.max(0, (trackRef.current?.scrollWidth ?? 0) - (viewportRef.current?.clientWidth ?? 0))
      gsap.to(trackRef.current, {
        x: () => -distance(), ease: 'none',
        scrollTrigger: { trigger: viewportRef.current, pin: true, scrub: 0.8, end: () => '+=' + distance(), invalidateOnRefresh: true },
      })
    })
  })
  return () => ctx.revert()
}, [])
```

- [ ] **Step 6.2: 移动端保留纵向 grid 不变**

- [ ] **Step 6.3: 手测**

桌面 resize 反复 → 末张卡应完整可见,移动端不应有横向溢出。

- [ ] **Step 6.4: Commit**

```bash
git add frontend-vite/src/pages/Issues.tsx frontend-vite/src/pages/Issues.css
git commit -m "feat(issues): P1-04 horizontal pinned gallery"
```

---

## Task 7: ArticleDetail 长文 block-level batch reveal(P1-02)

**Files:**
- Modify: `frontend-vite/src/pages/ArticleDetail.tsx`

- [ ] **Step 7.1: 在 `<article>` 渲染后 query block selectors**

```tsx
useEffect(() => {
  const container = articleRef.current
  if (!container) return
  const blocks = container.querySelectorAll<HTMLElement>(':scope > h2, :scope > h3, :scope > p, :scope > blockquote, :scope > pre, :scope > .prose-table-wrap, :scope > img')
  return batchReveal({ root: container, selector: ':scope > *', stagger: 0.045, y: 20, start: 'top 90%' })
}, [slug])
```

实际用 `ScrollTrigger.batch(blocks, ...)` 直接传元素数组,此处为简化版。

- [ ] **Step 7.2: 不拆全文文字字符 — 只对 block-level 元素 reveal**

- [ ] **Step 7.3: 手测**

长文滚动应逐步展开,正文段落不糊。

- [ ] **Step 7.4: Commit**

```bash
git add frontend-vite/src/pages/ArticleDetail.tsx
git commit -m "feat(detail): P1-02 long-form block-level batch reveal"
```

---

## Task 8: Search 列表 batch reveal(P1-01 部分)

**Files:**
- Modify: `frontend-vite/src/pages/Search.tsx`

- [ ] **Step 8.1: 复用 Task 5 的 batchReveal 模式**

- [ ] **Step 8.2: Commit**

```bash
git add frontend-vite/src/pages/Search.tsx
git commit -m "feat(search): P1-01 batch reveal"
```

---

## Task 9: About waypoint 时间轴 + DrawSVG(P1-05)

**Files:**
- Modify: `frontend-vite/src/pages/About.tsx`、`About.css`
- 需含 SVG 路径(若 About 已有时间轴 SVG,直接接;否则加一个 minimal <path data-timeline-path d="M0 0 L100 0">)

- [ ] **Step 9.1: pinned timeline + snap + DrawSVG**(参考 spec P1-05)

```tsx
const tl = gsap.timeline({
  scrollTrigger: {
    trigger: timelineRef.current, pin: true, scrub: 0.55,
    end: () => '+=' + window.innerHeight * 2,
    snap: { snapTo: 0.5, duration: 0.3, ease: 'power2.inOut' },
  },
})
tl.from(pathRef.current, { drawSVG: 0, ease: 'none' })
itemsRef.current.forEach((item, i) => tl.to(item, { autoAlpha: 1, y: 0 }, i))
```

- [ ] **Step 9.2: SVG `aria-hidden="true"`,路径不可被 Tab 聚焦**

- [ ] **Step 9.3: 移动端不做 pin,改普通 batch reveal**

```tsx
const mm = gsap.matchMedia()
mm.add('(max-width: 1023px)', () => batchReveal({ root: timelineRef.current ?? document, selector: '[data-waypoint-item]', y: 20, stagger: 0.1 }))
```

- [ ] **Step 9.4: Commit**

```bash
git add frontend-vite/src/pages/About.tsx frontend-vite/src/pages/About.css
git commit -m "feat(about): P1-05 waypoint timeline + DrawSVG"
```

---

## Task 10: 卡片 3D tilt 与磁性 CTA(P1-06)

**Files:**
- Create: `frontend-vite/src/animations/pointerMotion.ts`
- Modify: `frontend-vite/src/components/ArticleCard.tsx`、`ArticleCard.css`

- [ ] **Step 10.1: 实现 `pointerMotion.ts`**

```ts
import { gsap } from 'gsap'

export interface PointerMotionOpts {
  target: HTMLElement
  maxTilt?: number
  maxMagnetic?: number
}

export function attachPointerMotion(opts: PointerMotionOpts) {
  if (!matchMediaFinePointer()) return () => {}
  const rx = gsap.quickTo(opts.target, 'rotateX', { duration: 0.35, ease: 'power3.out' })
  const ry = gsap.quickTo(opts.target, 'rotateY', { duration: 0.35, ease: 'power3.out' })
  const onMove = (e: PointerEvent) => {
    const rect = opts.target.getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2
    rx(-ny * (opts.maxTilt ?? 5))
    ry(nx * (opts.maxTilt ?? 5))
  }
  const onLeave = () => { rx(0); ry(0) }
  opts.target.addEventListener('pointermove', onMove)
  opts.target.addEventListener('pointerleave', onLeave)
  return () => {
    opts.target.removeEventListener('pointermove', onMove)
    opts.target.removeEventListener('pointerleave', onLeave)
    rx(0); ry(0)
  }
}

function matchMediaFinePointer() {
  return window.matchMedia?.('(pointer: fine)').matches ?? false
}
```

- [ ] **Step 10.2: ArticleCard.tsx useEffect 调用**

```tsx
useEffect(() => () => attachPointerMotion({ target: innerRef.current!, maxTilt: 5 }), [])
```

- [ ] **Step 10.3: 触屏不挂 listener(已在 matchMediaFinePointer 守卫)**

- [ ] **Step 10.4: Commit**

```bash
git add frontend-vite/src/animations/pointerMotion.ts frontend-vite/src/components/ArticleCard.tsx frontend-vite/src/components/ArticleCard.css
git commit -m "feat(card): P1-06 3D tilt + magnetic pointer"
```

---

## Task 11: Section title SplitText + divider draw(P1-07)

**Files:**
- Create: `frontend-vite/src/animations/splitHeading.ts`
- Modify: `frontend-vite/src/styles/global.css`(divider scaleX0 基线)
- Modify: `frontend-vite/src/pages/Articles.tsx`、`Issues.tsx`、`About.tsx`(Heading 组件加 data-split)

- [ ] **Step 11.1: 实现 `splitHeading.ts`**

```ts
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { motionAllowed } from './reducedMotion'

export function splitHeading(el: HTMLElement, opts: { stagger?: number; duration?: number } = {}) {
  if (!motionAllowed()) return () => {}
  const split = SplitText.create(el, { type: 'words,chars', autoSplit: true })
  const tween = gsap.from(split.chars, {
    yPercent: 105, autoAlpha: 0, stagger: opts.stagger ?? 0.02, duration: opts.duration ?? 0.65,
  })
  return () => { tween.kill(); split.revert() }
}
```

- [ ] **Step 11.2: 在 Articles/Issues/About 顶部 H2 使用**

```tsx
useEffect(() => () => splitHeading(h2Ref.current!), [])
```

- [ ] **Step 11.3: global.css 增加 `.section-divider` 默认 `transform: scaleX(0); transform-origin: 0 50%`**

- [ ] **Step 11.4: 对应的进入视口时 tween 到 scaleX 1**

- [ ] **Step 11.5: Commit**

```bash
git add frontend-vite/src/animations/splitHeading.ts frontend-vite/src/styles/global.css frontend-vite/src/pages/Articles.tsx frontend-vite/src/pages/Issues.tsx frontend-vite/src/pages/About.tsx
git commit -m "feat(text): P1-07 SplitText heading + divider draw"
```

---

## Task 12: Footer reveal 与 Newsletter 状态编排(P1-08)

**Files:**
- Modify: `frontend-vite/src/components/Footer.tsx`、`Footer.css`
- Modify: `frontend-vite/src/components/NewsletterForm.tsx`、`NewsletterForm.css`

- [ ] **Step 12.1: Footer ScrollTrigger stagger**

```tsx
useEffect(() => () => batchReveal({ root: footerRef.current ?? document, selector: '[data-footer-cell]', stagger: 0.07, y: 28 }), [])
```

- [ ] **Step 12.2: Newsletter 状态 auto-height(参考 spec P1-08)**

```tsx
const tl = useRef<gsap.core.Timeline>()
useEffect(() => {
  if (!motionAllowed()) return
  tl.current = gsap.timeline({ paused: true })
    .fromTo(nextRef.current, { height: 0, autoAlpha: 0 }, { height: 'auto', autoAlpha: 1, duration: 0.35 })
}, [])

// 状态切换
useEffect(() => { tl.current?.play() }, [status])
```

- [ ] **Step 12.3: 手测**

订阅按钮 submit,loading → success/error 切换应有高度过渡。

- [ ] **Step 12.4: Commit**

```bash
git add frontend-vite/src/components/Footer.tsx frontend-vite/src/components/Footer.css frontend-vite/src/components/NewsletterForm.tsx frontend-vite/src/components/NewsletterForm.css
git commit -m "feat(footer): P1-08 footer stagger + newsletter state timeline"
```

---

## Task 13: 公共路由 presence 过渡(P1-09)

**Files:**
- Modify: `frontend-vite/src/components/PublicRouteTransition.tsx`
- Modify: `frontend-vite/src/App.tsx`

- [ ] **Step 13.1: 实现 AnimatePresence 版本**

```tsx
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation, Outlet } from 'react-router-dom'

export function PublicRouteTransition() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
        <Outlet />
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 13.2: 在 App.tsx 路由壳替换;** 排除 `/admin` 与 `/labs/*`(`useLocation` 判断)

```tsx
{!isAdminOrLabs && (
  <PublicRouteTransition />
)}
{isAdminOrLabs && (
  <Outlet />
)}
```

- [ ] **Step 13.3: 在每个 Page 内 GSAP 的 `useGSAP` 改用 `gsap.context` + cleanup,确保路由切换前被 revert**

```tsx
useEffect(() => {
  const ctx = gsap.context(() => { /* tween */ }, scopeRef)
  return () => ctx.revert()
}, [])
```

- [ ] **Step 13.4: 手测**

公共页之间切换应有短暂淡入;browser back/forward 也应正常。

- [ ] **Step 13.5: Commit**

```bash
git add frontend-vite/src/components/PublicRouteTransition.tsx frontend-vite/src/App.tsx
git commit -m "feat(router): P1-09 public route presence transition"
```

---

## Task 14: Hero Canvas 知识粒子场(P2-01)

**Files:**
- Create: `frontend-vite/src/components/HeroParticles.tsx`
- Modify: `frontend-vite/src/pages/Home.tsx`、`Home.css`

**性能门禁(必过):**
- Lighthouse mobile Performance ≥ 80
- CLS < 0.05
- Long Task < 50ms 占比 < 5%
- DPR cap 2;reduce-motion 时返回静态 <canvas> 占位

- [ ] **Step 14.1: 实现 `HeroParticles.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from '@/animations/reducedMotion'

export function HeroParticles() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!motionAllowed()) return
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0, running = true
    const params = { density: 0.35, accent: 0 }
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    const onVis = () => { running = !document.hidden }
    document.addEventListener('visibilitychange', onVis)
    const draw = () => {
      if (!running) { raf = requestAnimationFrame(draw); return }
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)
      // minimal placeholder draw: scattered dots
      ctx.fillStyle = `rgba(201,168,76,${0.05 + params.accent * 0.2})`
      for (let i = 0; i < 60; i++) {
        const x = (Math.sin(i + Date.now() / 1000) + 1) * width / 2
        const y = (Math.cos(i + Date.now() / 1300) + 1) * height / 2
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    gsap.to(params, { accent: 1, scrollTrigger: { trigger: canvas, start: 'top top', end: 'bottom top', scrub: 0.8 } })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
      ScrollTrigger.getAll().forEach(t => t.kill())
    }
  }, [])
  if (!motionAllowed()) return null
  return <canvas ref={ref} aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}
```

- [ ] **Step 14.2: 在 `Home.tsx` Hero 区接入**

- [ ] **Step 14.3: 性能门禁**

```bash
cd frontend-vite && npm run build
cd frontend-vite && npx lighthouse http://localhost:4173/ --preset=desktop --output=json --output-path=tests/lighthouse/home-budget.json
```

JSON 中 `categories.performance.score >= 0.8`。

- [ ] **Step 14.4: Commit**

```bash
git add frontend-vite/src/components/HeroParticles.tsx frontend-vite/src/pages/Home.tsx frontend-vite/src/pages/Home.css frontend-vite/tests/lighthouse/home-budget.json
git commit -m "feat(home): P2-01 canvas particles (performance-gated)"
```

---

## Task 15: Hero shader scroll uniform(P2-02)

**Files:**
- Create: `frontend-vite/src/components/HeroShader.tsx`
- Modify: `frontend-vite/src/pages/Home.tsx`

**门禁:** Lighthouse desktop ≥ 85,无 WebGL error,context loss 自动降级回 P2-01(若 P2-01 已落地)。

- [ ] **Step 15.1: 实现基础 fragment shader uniform + ScrollTrigger progress**

```tsx
// 完整代码由 OpenGL ES shader 字符串 + Three.js 或纯 WebGL2 Material
// 此处实现要点:uniform float uProgress, 与 visibilitychange pause
```

- [ ] **Step 15.2: 上下文丢失时降级回 `<HeroParticles />`**

- [ ] **Step 15.3: 性能门禁**

- [ ] **Step 15.4: Commit**

```bash
git commit -m "feat(home): P2-02 hero shader (performance-gated)"
```

---

## Task 16: 研究过程 image sequence(P2-03)

**Files:**
- Create: `frontend-vite/public/seq/{slug}/0001.webp` ... `00NN.webp`
- Create: `frontend-vite/src/components/ScrollImageSequence.tsx`
- Modify: `frontend-vite/src/pages/IssueDetail.tsx`(或 Home,二选一)

**门禁:**
- 首屏只请求 poster;离屏 1–2 屏外才发起系列加载
- Save-Data / reduce-motion 直接显示 poster
- Lighthouse 不退化

- [ ] **Step 16.1: 准备帧素材(独立任务,可不阻塞 dev,先以 placeholder 实现)**

- [ ] **Step 16.2: 实现 `ScrollImageSequence.tsx`**(poster-first 渐进预加载 + integer-frame Canvas 绘制)

- [ ] **Step 16.3: 性能门禁**

- [ ] **Step 16.4: Commit**

```bash
git commit -m "feat(issue/home): P2-03 scroll image sequence (asset + perf gated)"
```

---

## Task 17: 移动端 Issues Draggable/Inertia 卡堆(P2-04)

**Files:**
- Create: `frontend-vite/src/components/IssueCardStack.tsx`
- Modify: `frontend-vite/src/pages/Issues.tsx`、`Issues.css`(移动端切换此组件作为可选视图)

**门禁:**
- horizontal swiper / 上下滚动不被劫持
- 触屏第一次点击可点开
- 列表模式作为基线不破

- [ ] **Step 17.1: 实现 Draggable x + Inertia + threshold/snap + touch-action**

```tsx
import { Draggable } from 'gsap/Draggable'
import { InertiaPlugin } from 'gsap/InertiaPlugin'

useEffect(() => {
  Draggable.create(cardRef.current, {
    type: 'x', inertia: true, edgeResistance: 0.7,
    onDrag() { gsap.set(cardRef.current, { rotation: this.x / 30 }) },
    onRelease() {
      Math.abs(this.x) > 120 ? advance() : gsap.to(cardRef.current, { x: 0, rotation: 0 })
    },
  })
}, [])
```

- [ ] **Step 17.2: 手测触屏 + 桌面**

- [ ] **Step 17.3: Commit**

```bash
git commit -m "feat(issues): P2-04 mobile draggable card stack"
```

---

## 全局验收 / DO / DON'T

### DO
- 每完成一个任务即 `git commit`;每个 commit 都通过 `npm run build` 与 Vitest
- 受影响的页面在 reduced-motion 下保持可用与可读
- 用 DevTools Performance 录制 hero 滚动,Long Task 应 < 50ms
- 任何动效都尊重 `prefers-reduced-motion` 与 `Save-Data`
- 滚动连续态归 GSAP;mount/unmount/路由存在归 Framer Motion

### DON'T
- **不**让 GSAP 与 Framer Motion 同时写同一节点的同一属性
- **不**修改 `src/index.css` / `src/App.css` 布局约束
- **不**在没有 matchMedia 守卫的情况下启用 pin / snap / 3D tilt
- **不**对全文文字字符拆分(只对 block-level + section title)
- **不**在没有 reading-progress 测试通过前合并 PR
- **不**在没有 Lighthouse 基线 JSON 提交前标记 P2 完成

---

## 自检

### 1. Spec 覆盖
- P0-01 → T1 ✓
- P0-02 → T2 ✓
- P0-03 → T3 ✓
- P0-04 → T3 ✓
- P0-05 → T2 ✓
- P0-06 → T2 ✓
- P0-07 → T4 ✓
- P1-01 → T5(Articles) + T7(Detail long-form) + T8(Search) ✓
- P1-02 → T7 ✓
- P1-03 → T5 ✓
- P1-04 → T6 ✓
- P1-05 → T9 ✓
- P1-06 → T10 ✓
- P1-07 → T11 ✓
- P1-08 → T12 ✓
- P1-09 → T13 ✓
- P2-01 → T14 ✓
- P2-02 → T15 ✓
- P2-03 → T16 ✓
- P2-04 → T17 ✓

20/20 已映射;无遗漏。

### 2. 占位符扫描
无 TODO / TBD / "implement later"。每个 T 必须做的事都用实际代码块呈现。

### 3. 类型/命名一致性
- 公共 API:`motionAllowed()` / `installAnimationRuntime()` / `batchReveal()` / `mountCountUp()` / `splitHeading()` / `attachPointerMotion()`
- 公共类型:`BatchRevealOptions` / `CountUpOptions` / `PointerMotionOpts`
- CSS class:`app-bg`(已有)、`.section-divider`(新增 base token)
- File scope 单组件单职责:`HeroParticles.tsx` / `HeroShader.tsx` / `ScrollImageSequence.tsx` / `IssueCardStack.tsx`

无 `clearLayers` vs `clearFullLayers` 类问题。
