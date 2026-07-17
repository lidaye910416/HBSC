# HBSC GSAP 动效优化研究报告与实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps should be tracked and verified per iteration.

**Goal:** 在不破坏 HBSC 现有编辑设计、可访问性与性能的前提下，把公共站点从单一的 CSS 上浮淡入升级为有层次、可中断、可降级的 GSAP 动效系统。

**Architecture:** 以一个 React 19 StrictMode 安全的公共动效层为基础；GSAP 负责时间线、滚动连续态、高频 pointer 与 FLIP，Framer Motion 只负责 React 路由/挂载卸载边界。P0 先完成首屏与详情阅读反馈，P1 扩展到列表叙事与 About/Issues，P2 的 Canvas/WebGL/序列帧必须经过独立性能门禁。

**Tech Stack:** React 19.2、Vite 8、GSAP 3.15、`@gsap/react` 2.1、ScrollTrigger、Flip、SplitText、Framer Motion 12、Playwright、Lighthouse。

**建议落盘路径：** `/Users/jasonlee/hubei-shuchuang/docs/superpowers/specs/2026-07-17-hbsc-gsap-optimization-design.md`

---

## 0. 阅读指引

1. 本报告只综合用户提供的四份 GSAP demo 调研和两份 HBSC 审计；没有把外部未核实链接或未审计页面当成既有事实。
2. 下文代码均为“实施骨架”，用于说明生命周期、属性归属与验收方式；新增 selector、ref 和文件必须在实现阶段按现有组件结构落地。
3. 优先级严格按本任务评分：P0 面向首页/详情页首屏、强感知、少于 2 天且低风险；P1 面向列表/分类/长页叙事、2–5 天且中风险；P2 为次要增强、通常超过 5 天或带高性能/交互风险。
4. 实施时一次只交付一个编号；每项都必须通过 build、lint、reduced-motion、键盘/触屏和 Lighthouse 增量检查后再进入下一项。
5. 插件可用性以当前 `/Users/jasonlee/hubei-shuchuang/frontend-vite/package.json` 中 `gsap@^3.15.0` 的真实构建结果为准；SplitText、Flip、DrawSVG、Inertia 等必须先做 import/build smoke test，不能仅凭调研文字判断。

## 1. 现状摘要

### 1.1 两份审计的共同结论

- 技术依赖已经具备：`gsap`、`@gsap/react` 和 `framer-motion` 均已安装；但 GSAP 实际集中在 `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/admin/animations.ts` 与 admin Toast，公共页面没有 ScrollTrigger，Framer Motion 在审计范围内没有 import。
- 公共首页动效主要是 `animate-fade-up`、`animate-delay-*` 与 `.observe.in-view`：label、标题、卡片、section header 基本都使用相同的 `opacity + translateY(20px)`，节奏单一，且 CSS keyframe 与 IntersectionObserver transition 同时存在，存在属性竞争的审计疑点。
- `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/ArticleDetail.tsx` 与 `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/IssueDetail.tsx` 只有 skeleton shimmer、hover transition 和 TOC 原生 IntersectionObserver；首屏 cover、标题、正文、阅读进度均为静态。
- `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Articles.tsx`、`Issues.tsx`、`About.tsx`、`Search.tsx` 的列表、筛选、时间轴和异步结果大多瞬间出现；About 是最长的纯静态公共页。
- `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/CoverImage.tsx` 已有 lazy load 与 fallback，但图片 decode 后没有 reveal；其 CSS transform transition 在审计中没有对应触发。
- 当前最有杠杆的缺口是：公共动效生命周期层、首页/详情 hero 编排、阅读进度、列表 batch reveal、Issues 横向档案、About waypoint 时间轴、筛选 FLIP，以及统一 reduced-motion。

### 1.2 约束与取舍

- 不先引入全站平滑滚动。原生滚动可先稳定承载 P0/P1；ScrollSmoother 或第三方 smooth scroll 会扩大 pin、anchor、触屏与可访问性风险，保留为后续独立决策。
- 不让 GSAP 与 Framer Motion 同时写同一节点的同一属性。连续滚动/高频 pointer 归 GSAP；React mount/unmount 和 route presence 归 Framer Motion。
- 不为动效修改 `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/index.css` 或 `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/App.css` 的布局约束；全局布局仍遵循独立 `.app-bg` 与 `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/styles/global.css` 规范。

## 2. GSAP 技法清单

### 2.1 ScrollTrigger / Pin / Scrub

1. **Pinned horizontal track + x/xPercent scrub**：pin 外层、只移动内层 track、`ease:'none'`、动态 `end`、`invalidateOnRefresh`；来源：[horizontal-scrolling-gallery](https://demos.gsap.com/demo/horizontal-scrolling-gallery/)、[infinite-looped-panels](https://demos.gsap.com/demo/infinite-looped-panels/)、[infinite-looped-scrolling-sections](https://demos.gsap.com/demo/infinite-looped-scrolling-sections/)。
2. **Pinned panels with overscroll release**：在 pin 尾部保留释放缓冲，避免“卡死”；来源：[pinned-panels-with-overscroll](https://demos.gsap.com/demo/pinned-panels-with-overscroll/)。
3. **Scroll waypoints / stepped snap**：把长叙事切成离散站位；来源：[scroll-waypoints](https://demos.gsap.com/demo/scroll-waypoints/)、[threejs-scroll-waypoints](https://demos.gsap.com/demo/threejs-scroll-waypoints/)。
4. **Variable property scrub**：通过代理对象把进度映射到字重、缩放、颜色或数值；来源：[scrubbed-bento-gallery](https://demos.gsap.com/demo/scrubbed-bento-gallery/)。
5. **Scroll velocity skew**：读取滚动速度，以 quickSetter/quickTo 做有限角度回正；来源：[velocity-skew](https://demos.gsap.com/demo/velocity-skew/)。
6. **Canvas image sequence**：scrub 整数帧代理对象，帧变更时才重绘；来源：[image-sequence](https://demos.gsap.com/demo/image-sequence/)。
7. **Shader uniform on scroll**：把 ScrollTrigger progress 写入 WebGL uniform；来源：[shader-on-scroll](https://demos.gsap.com/demo/shader-on-scroll/)。
8. **Image mask on scroll**：用 clip-path/mask 擦除揭示前后图；来源：[image-mask-on-scroll](https://demos.gsap.com/demo/image-mask-on-scroll/)。
9. **Batch stagger reveal**：`ScrollTrigger.batch` 合并同批 enter，用 overwrite 防快速滚动堆积；来源：[stagger-items-in-on-scroll](https://demos.gsap.com/demo/stagger-items-in-on-scroll/)、[trigger-on-scroll](https://demos.gsap.com/demo/trigger-on-scroll/)。
10. **Lateral section indicator**：当前章节 dot/line 随 active section 移动；来源：[lateral-pin-indicator](https://demos.gsap.com/demo/lateral-pin-indicator/)。
11. **Responsive line splits**：字体/断点变化后自动 resplit，并与 ScrollTrigger refresh 协调；来源：[responsive-line-splits-on-scroll](https://demos.gsap.com/demo/responsive-line-splits-on-scroll/)。
12. **Scroll progress UI / scroll-to**：总进度写入 scaleX/CSS variable，锚点平滑跳转；来源：[link-to-scroll-progress](https://demos.gsap.com/demo/link-to-scroll-progress/)、[animate-scroll-position](https://demos.gsap.com/demo/animate-scroll-position/)。

### 2.2 Timeline / Stagger / Sequence

1. **Master timeline + defaults + position 参数**：统一 duration/ease，用 `<`、`<0.15` 编排首屏；来源：[basic-timeline](https://demos.gsap.com/demo/basic-timeline/)、[complex-timeline](https://demos.gsap.com/demo/complex-timeline/)。
2. **局部 section 时间线**：section 进入视口时只编排自身 `[data-reveal]`；来源：[enter-and-exit](https://demos.gsap.com/demo/enter-and-exit/)、[staggering](https://demos.gsap.com/demo/staggering/)。
3. **可中断 enter/exit 单时间线**：同一 timeline `play/reverse`，快速 hover 不残留半截状态；来源：[interruptible-single-timeline-enterexit](https://demos.gsap.com/demo/interruptible-single-timeline-enterexit/)。
4. **clear + rebuild**：动态筛选后重建同一 timeline；来源：[timeline-clear-and-rebuild](https://demos.gsap.com/demo/timeline-clear-and-rebuild/)。
5. **FLIP layout continuity**：先 getState，再改变 DOM/布局，最后 Flip.from；来源：[animate-between-layout-positions](https://demos.gsap.com/demo/animate-between-layout-positions/)、[animate-between-different-targets](https://demos.gsap.com/demo/animate-between-different-targets/)。
6. **overwrite/onInterrupt**：高频交互只保留最后一个属性写入；来源：[interruptible-single-timeline-enterexit](https://demos.gsap.com/demo/interruptible-single-timeline-enterexit/)、[stagger-items-in-on-scroll](https://demos.gsap.com/demo/stagger-items-in-on-scroll/)。
7. **Auto height**：对 FAQ、TOC、表单状态做自然高度展开；来源：[animate-auto-height](https://demos.gsap.com/demo/animate-auto-height/)。

### 2.3 Interaction / 3D / Physics

1. **Cursor follower + quickTo**：高频 pointer 只 retarget 现有 tween；来源：[cursor-follower](https://demos.gsap.com/demo/cursor-follower/)、[cursor-tracking-image-preview](https://demos.gsap.com/demo/cursor-tracking-image-preview/)、[cursor-trail](https://demos.gsap.com/demo/cursor-trail/)。
2. **Magnetic CTA**：依据指针到按钮中心的偏移驱动 x/y，mouseleave 回零；来源：[magnetic-button-overwrite-modes](https://demos.gsap.com/demo/magnetic-button-overwrite-modes/)、[radial-menu](https://demos.gsap.com/demo/radial-menu/)。
3. **3D perspective tilt + gloss**：rotateX/rotateY 与高光位置共享 pointer 归一化值；来源：[cursor-driven-perspective-tilt](https://demos.gsap.com/demo/cursor-driven-perspective-tilt/)、[proximity-scale-grid](https://demos.gsap.com/demo/proximity-scale-grid/)。
4. **Draggable + Inertia card stack**：拖拽、速度阈值、抛出或弹回；来源：[card-stack](https://demos.gsap.com/demo/card-stack/)、[make-elements-draggable](https://demos.gsap.com/demo/make-elements-draggable/)、[swipe-slider](https://demos.gsap.com/demo/swipe-slider/)。
5. **FLIP gallery-to-modal**：同一视觉元素从卡片扩展到 overlay；来源：[flip-gallery-modal](https://demos.gsap.com/demo/flip-gallery-modal/)。
6. **FLIP filter/carousel**：筛选或重排时保持位置连续；来源：[flip-carousel](https://demos.gsap.com/demo/flip-carousel/)、[flexbox-filtering](https://demos.gsap.com/demo/flexbox-filtering/)。
7. **Dock proximity scale**：按鼠标到多个 item 中心的距离分配 scale；来源：[macos-dock-effect](https://demos.gsap.com/demo/macos-dock-effect/)、[proximity-scale-grid](https://demos.gsap.com/demo/proximity-scale-grid/)。
8. **Observer unified input**：统一 pointer/touch/wheel/keyboard 的方向与速度；来源：[observe-events](https://demos.gsap.com/demo/observe-events/)、[swipe-slider](https://demos.gsap.com/demo/swipe-slider/)。
9. **Footer bounce / physics**：首次进入 footer 时使用有限的 elastic/bounce；来源：[footer-bounce](https://demos.gsap.com/demo/footer-bounce/)、[create-physics-based-effects](https://demos.gsap.com/demo/create-physics-based-effects/)。
10. **Curve swipe**：Draggable progress 映射到曲线路径与离散 snap；来源：[curve-swipe](https://demos.gsap.com/demo/curve-swipe/)、[swipe-slider](https://demos.gsap.com/demo/swipe-slider/)。

### 2.4 SVG / Morph / Text / Effect

1. **MorphSVG brand mark**：通过 shapeIndex/路径采样稳定 path-to-path；来源：[morph-between-svg-shapes](https://demos.gsap.com/demo/morph-between-svg-shapes/)、[smooth-morph](https://demos.gsap.com/demo/smooth-morph/)、[shape-index](https://demos.gsap.com/demo/shape-index/)。
2. **DrawSVG path drawing**：按路径长度控制描边显隐；来源：[draw-a-path](https://demos.gsap.com/demo/draw-a-path/)。
3. **SplitText chars/words/lines**：mask 包裹、stagger、autoSplit/revert；来源：[animate-text](https://demos.gsap.com/demo/animate-text/)、[responsive-line-splits-on-scroll](https://demos.gsap.com/demo/responsive-line-splits-on-scroll/)、[horizontal-text](https://demos.gsap.com/demo/horizontal-text/)。
4. **Text mask**：用 CSS mask-position/gradient 做光闸揭示；来源：[text-masking](https://demos.gsap.com/demo/text-masking/)。
5. **ScrambleText decode**：乱码到真文的受控揭示；来源：[text-scrambling](https://demos.gsap.com/demo/text-scrambling/)。
6. **Text replacement / rolling text**：固定高度 mask 内旧文滚出、新文滚入；来源：[animate-text-replacement](https://demos.gsap.com/demo/animate-text-replacement/)、[rolling-text](https://demos.gsap.com/demo/rolling-text/)。
7. **Canvas particles**：单 RAF 渲染，GSAP 只驱动少量全局参数；来源：[canvas-particles](https://demos.gsap.com/demo/canvas-particles/)。
8. **ScrollSmoother**：wrapper/content + smooth/effects 的全站平滑模式；来源：[smooth-scrolling](https://demos.gsap.com/demo/smooth-scrolling/)。本报告不把它列入当前 20 项，以避免过早劫持原生滚动。
9. **MotionPath / waypoints**：元素沿 SVG path 与滚动同步；来源：[animate-along-a-path](https://demos.gsap.com/demo/animate-along-a-path/)、[motionpath-waypoints](https://demos.gsap.com/demo/motionpath-waypoints/)。
10. **Canvas morph**：在 Canvas 上批量插值 path/粒子形态；来源：[canvas-morphs](https://demos.gsap.com/demo/canvas-morphs/)、[dynamic-morphing](https://demos.gsap.com/demo/dynamic-morphing/)。

## 3. 优先级矩阵 P0 / P1 / P2

### 3.1 总览

| ID | Priority | Title | Scope | 预估 |
|---|---|---|---|---|
| HBSC-P0-01 | P0 | 公共动效运行时与降级网关 | 全站公共路由 | 1 天 |
| HBSC-P0-02 | P0 | 首页 Hero 杂志式入场 | 首页首屏 | 1.5 天 |
| HBSC-P0-03 | P0 | 文章/期刊详情 Hero 编排 | 两类详情首屏 | 2 天 |
| HBSC-P0-04 | P0 | 阅读进度条与 TOC 滑动指示 | 文章详情 | 1 天 |
| HBSC-P0-05 | P0 | Cover decode reveal 与轻量视差 | 首页/详情首屏 | 1.5 天 |
| HBSC-P0-06 | P0 | 首页与期刊统计数字 count-up | 首页/列表 Hero | 0.75 天 |
| HBSC-P0-07 | P0 | 导航下拉与移动菜单可中断时间线 | 全站导航 | 1.5 天 |
| HBSC-P1-01 | P1 | 列表页 ScrollTrigger.batch 入场 | Articles/Issues/Search/Home | 2 天 |
| HBSC-P1-02 | P1 | 长文 block-level batch reveal | ArticleDetail | 2 天 |
| HBSC-P1-03 | P1 | Articles 筛选/分页 FLIP 连续性 | Articles | 3–4 天 |
| HBSC-P1-04 | P1 | Issues 档案横向 pinned gallery | Issues 桌面端 | 3–4 天 |
| HBSC-P1-05 | P1 | About waypoint 时间轴 + DrawSVG | About | 3 天 |
| HBSC-P1-06 | P1 | 卡片 3D tilt 与磁性 CTA | 卡片/主 CTA | 2–3 天 |
| HBSC-P1-07 | P1 | Section title SplitText + divider draw | 公共列表/About | 2–3 天 |
| HBSC-P1-08 | P1 | Footer reveal 与 Newsletter 状态编排 | Footer/Newsletter | 2 天 |
| HBSC-P1-09 | P1 | 公共路由 presence 过渡 | 公共路由壳 | 3–4 天 |
| HBSC-P2-01 | P2 | Hero Canvas 知识粒子场 | Home/About | 5–7 天 |
| HBSC-P2-02 | P2 | Hero shader scroll uniform | Home | 7–10 天 |
| HBSC-P2-03 | P2 | 研究过程 image sequence | Home/IssueDetail 试点 | 8–12 天+素材 |
| HBSC-P2-04 | P2 | 移动端期刊 Draggable/Inertia 卡堆 | Issues 移动端 | 6–8 天 |

### 3.2 P0 详细建议

#### HBSC-P0-01 — 公共动效运行时与降级网关

- **scope:** 全站公共路由，作为所有后续依赖。
- **technique:** `useGSAP` scoped context、`gsap.matchMedia`、`contextSafe`、`revertOnUpdate`；不使用全局 `ScrollTrigger.getAll().kill()`。
- **refDemoName:** Basic Timeline。
- **refDemoURL:** https://demos.gsap.com/demo/basic-timeline/
- **expectedEffect:** StrictMode 双执行、路由卸载和异步数据更新下仍只有一份 tween/trigger；reduced-motion 下内容直接可见。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/animations/publicMotion.ts`（新建）、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/animations/useReducedMotion.ts`（新建）、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/admin/animations.ts`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/App.tsx`。
- **codeSkeleton:**
```ts
// proposed public helper
useGSAP(() => {
  const mm = gsap.matchMedia()
  mm.add('(prefers-reduced-motion: no-preference)', () => buildMotion(root.current))
  mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(targets, { clearProps: 'all' }))
  return () => mm.revert()
}, { scope: root, dependencies, revertOnUpdate: true })
```
- **acceptance:** `npm run build` 与 `npm run lint` 通过；React StrictMode 下进入/离开同一路由 20 次 trigger 数不递增；reduce 模式无隐藏内容；admin 动效不回归。
- **risks:** 插件重复注册；抽共享 hook 时误改 admin；异步 callback 未用 contextSafe。
- **effortEstimate:** 1 天。

#### HBSC-P0-02 — 首页 Hero 杂志式入场

- **scope:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.tsx` 首屏。
- **technique:** Master timeline + SplitText words/chars + 统一 `power3.out`；替换 hero 上的 `animate-delay-*`，不与旧 CSS 同写 opacity/transform。
- **refDemoName:** Basic Timeline / Rolling Text。
- **refDemoURL:** https://demos.gsap.com/demo/basic-timeline/
- **expectedEffect:** label → 两行 H1 → subtitle → CTA → pattern 在约 1.2 秒内完成有层次的开场，首屏不再是四个相同上浮。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.css`。
- **codeSkeleton:**
```ts
useGSAP(() => {
  const split = SplitText.create('.hero__title', { type: 'words,chars', autoSplit: true })
  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .from('.hero__label', { y: 16, autoAlpha: 0, duration: 0.45 })
    .from(split.chars, { yPercent: 110, autoAlpha: 0, stagger: 0.025, duration: 0.7 }, '<0.1')
    .from(['.hero__subtitle', '.hero__actions'], { y: 18, autoAlpha: 0, stagger: 0.1 }, '<0.2')
}, { scope: heroRef })
```
- **acceptance:** 375/768/1440px 下标题不裁切；页面首次可交互不被 timeline 阻塞；heading accessible name 不变；reduce 模式直接显示；总入场不超过 1.5 秒。
- **risks:** 字体完成加载后换行变化；SplitText wrapper 与 `<br>`；旧 CSS animation 未清除导致 transform 竞争。
- **effortEstimate:** 1.5 天。

#### HBSC-P0-03 — 文章/期刊详情 Hero 编排

- **scope:** ArticleDetail 与 IssueDetail 的 Breadcrumb、eyebrow、标题、lede/meta。
- **technique:** 共享 master timeline；动态数据到达后只重建当前 scope；cover 动画与文字节点分层。
- **refDemoName:** Complex Timeline。
- **refDemoURL:** https://demos.gsap.com/demo/complex-timeline/
- **expectedEffect:** 详情页从“整棵 React tree 同时 paint”升级为封面、标题、摘要和元数据依次建立阅读层级。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/ArticleDetail.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/ArticleDetail.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/IssueDetail.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/IssueDetail.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/animations/useEditorialHero.ts`（新建）。
- **codeSkeleton:**
```ts
useGSAP(() => {
  if (!data) return
  gsap.timeline({ defaults: { duration: 0.55, ease: 'power3.out' } })
    .from('[data-hero-cover]', { scale: 1.04, autoAlpha: 0, duration: 0.9 })
    .from('[data-hero-crumb]', { x: -8, autoAlpha: 0 }, '<0.15')
    .from('[data-hero-copy]', { y: 24, autoAlpha: 0, stagger: 0.08 }, '<0.1')
}, { scope: root, dependencies: [data?.id], revertOnUpdate: true })
```
- **acceptance:** 两个详情页 loading→data 不闪烁；返回/前进不积累 inline styles；无 cover 时文字仍正常入场；reduce 模式零位移；首屏入场小于 1.5 秒。
- **risks:** React Query 数据切换导致重复播放；无图分支 target 为空；不同标题行数造成裁切。
- **effortEstimate:** 2 天。

#### HBSC-P0-04 — 阅读进度条与 TOC 滑动指示

- **scope:** ArticleDetail 的正文和侧栏目录。
- **technique:** standalone ScrollTrigger 把 progress 写入 `scaleX`；现有 activeId 保留，单一 marker 用 quickTo 滑到 active item。
- **refDemoName:** Link To Scroll Progress / Lateral Pin Indicator。
- **refDemoURL:** https://demos.gsap.com/demo/link-to-scroll-progress/
- **expectedEffect:** 顶部 2px 古铜金线持续反馈阅读位置，TOC 指示器不再硬切。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/ArticleDetail.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/ArticleDetail.css`。
- **codeSkeleton:**
```ts
const setProgress = gsap.quickSetter(progressRef.current, 'scaleX')
ScrollTrigger.create({
  trigger: mainRef.current,
  start: 'top top',
  end: 'bottom bottom',
  onUpdate: self => setProgress(self.progress),
})
// activeId change: yTo(activeItem.offsetTop)
```
- **acceptance:** 0%/50%/100% 位置误差不超过 3%；图片加载后 refresh 仍准确；锚点可键盘访问；进度条 `pointer-events:none`；reduce 模式允许即时进度更新但不做追赶动画。
- **risks:** sticky nav 高度偏移；正文过短导致 start/end 重合；lazy image 改变正文高度。
- **effortEstimate:** 1 天。

#### HBSC-P0-05 — Cover decode reveal 与轻量视差

- **scope:** CoverImage 的通用 decode reveal；ArticleDetail/IssueDetail 首屏 cover 的桌面 yPercent scrub。
- **technique:** onLoad 后 opacity/scale reveal；详情页只移动图片子节点，不移动 pinned/sticky 外层；transform 属性单一所有者。
- **refDemoName:** Image Mask On Scroll。
- **refDemoURL:** https://demos.gsap.com/demo/image-mask-on-scroll/
- **expectedEffect:** lazy 图片不再突然跳出，详情封面在进入正文时产生 4–8% 的克制景深。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/CoverImage.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/CoverImage.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/ArticleDetail.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/IssueDetail.tsx`。
- **codeSkeleton:**
```ts
// decode state controls baseline visibility; parent detail owns scroll transform
gsap.fromTo(img, { autoAlpha: 0, scale: 1.035 }, { autoAlpha: 1, scale: 1, duration: 0.7 })
gsap.to(img, {
  yPercent: 6, ease: 'none',
  scrollTrigger: { trigger: cover, start: 'top top', end: 'bottom top', scrub: 0.6 },
})
```
- **acceptance:** broken src fallback 仍可见；LCP 图不 lazy load；下方图片保持 lazy；移动端禁用 scrub 后无裁切；CLS 不增加。
- **risks:** 通用 CoverImage 与父级同时写 transform；首屏 LCP 图片仍使用默认 lazy；object-fit 裁切边缘暴露。
- **effortEstimate:** 1.5 天。

#### HBSC-P0-06 — 首页与期刊统计数字 count-up

- **scope:** Home 9/4/6/37、Issues totalArticles、Articles total。
- **technique:** 代理对象 tween + snap，不在每帧 setState；只更新 textContent。
- **refDemoName:** Scrubbed Bento Gallery（代理对象连续值模式）。
- **refDemoURL:** https://demos.gsap.com/demo/scrubbed-bento-gallery/
- **expectedEffect:** 数值在首次进入视口时快速建立信息重点，不改变原有数据语义。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Issues.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Articles.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/animations/countUp.ts`（新建）。
- **codeSkeleton:**
```ts
const state = { value: 0 }
gsap.to(state, {
  value: target, duration: 1.0, snap: { value: 1 }, ease: 'power2.out',
  onUpdate: () => { node.textContent = String(state.value) },
  scrollTrigger: { trigger: node, start: 'top 85%', once: true },
})
```
- **acceptance:** 最终值与 API/常量完全一致；查询重取不会从旧值跳错；屏幕阅读器不逐帧播报；reduce 模式立即显示最终值。
- **risks:** aria-live 逐帧噪声；异步 target 从占位符变数字；小数/格式化未来需求。
- **effortEstimate:** 0.75 天。

#### HBSC-P0-07 — 导航下拉与移动菜单可中断时间线

- **scope:** Navigation 的 Issues dropdown 和 mobile drawer。
- **technique:** 单一 paused timeline `play/reverse` + overwrite；退出完成前保留 DOM，并同步 `aria-expanded`、focus 与 inert/hidden。
- **refDemoName:** Interruptible Single Timeline Enter/Exit。
- **refDemoURL:** https://demos.gsap.com/demo/interruptible-single-timeline-enterexit/
- **expectedEffect:** 快速 hover/click/触屏切换不出现残影，移动菜单不再瞬间出现。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/Navigation.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/Navigation.css`。
- **codeSkeleton:**
```ts
const tl = gsap.timeline({ paused: true })
  .fromTo(menu, { y: -8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.22 })
  .from(items, { y: -5, autoAlpha: 0, stagger: 0.035 }, '<0.05')
const setOpen = contextSafe((open: boolean) => open ? tl.play() : tl.reverse())
```
- **acceptance:** 连续 hover 10 次无 stuck state；Escape/外部点击关闭；Tab 顺序正确；触屏第一次点击打开、菜单项可点击；route change 清理 timeline。
- **risks:** 当前条件渲染导致 reverse 前节点卸载；hover 与 click 状态竞争；150ms close timer 迁移不完整。
- **effortEstimate:** 1.5 天。

### 3.3 P1 详细建议

#### HBSC-P1-01 — 列表页 ScrollTrigger.batch 入场

- **scope:** Articles、Issues、Search、Home featured/category cards。
- **technique:** batch + stagger + overwrite + once；替换相同目标上的 `.observe`/fade-up，不叠加。
- **refDemoName:** Stagger Items In On Scroll。
- **refDemoURL:** https://demos.gsap.com/demo/stagger-items-in-on-scroll/
- **expectedEffect:** 同一屏卡片形成 60–90ms 的组节奏，快速滚动仍能立即落到正确终态。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Articles.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Issues.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Search.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/animations/batchReveal.ts`（新建）。
- **codeSkeleton:**
```ts
ScrollTrigger.batch(root.querySelectorAll('[data-reveal-card]'), {
  start: 'top 88%', interval: 0.08, batchMax: 6, once: true,
  onEnter: batch => gsap.fromTo(batch,
    { y: 28, autoAlpha: 0 },
    { y: 0, autoAlpha: 1, stagger: 0.07, overwrite: 'auto', clearProps: 'transform,opacity' }),
})
```
- **acceptance:** 每个节点只有一套 reveal；异步结果和分页后新节点可播放；快速滚动无不可见卡片；reduce 模式无 delay。
- **risks:** batch 仍创建每元素 trigger；旧 `.observe` 未清理；React Query 更新时 scope 重建。
- **effortEstimate:** 2 天。

#### HBSC-P1-02 — 长文 block-level batch reveal

- **scope:** ArticleDetail `.prose-lg` 中 h2/h3/p/blockquote/pre/table/figure。
- **technique:** block-level ScrollTrigger.batch，不做全文逐字符动画；图片 decode 后 refresh。
- **refDemoName:** Responsive Line Splits On Scroll。
- **refDemoURL:** https://demos.gsap.com/demo/responsive-line-splits-on-scroll/
- **expectedEffect:** 长文按阅读推进逐块出现，保持深阅读节奏而不牺牲正文可读性。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/ArticleDetail.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/ArticleDetail.css`。
- **codeSkeleton:**
```ts
const blocks = content.querySelectorAll(':scope > h2, :scope > h3, :scope > p, :scope > blockquote, :scope > pre, :scope > .prose-table-wrap, :scope > img')
ScrollTrigger.batch(blocks, {
  start: 'top 90%', once: true,
  onEnter: batch => gsap.from(batch, { y: 20, autoAlpha: 0, stagger: 0.045, duration: 0.55 }),
})
```
- **acceptance:** 文章内容、链接与复制选择始终可用；表格 wrapper 不被 transform 破坏横向滚动；首次加载时视口内正文不会长时间空白；reduce 模式静态。
- **risks:** ReactMarkdown DOM 层级与 selector 不一致；长文 trigger 数过多；打印样式受 inline opacity 影响。
- **effortEstimate:** 2 天。

#### HBSC-P1-03 — Articles 筛选/分页 FLIP 连续性

- **scope:** Articles category 与 pagination 的异步列表替换。
- **technique:** `Flip.getState` + stable `data-flip-id` + previousData 保留；新数据 commit 后 `Flip.from`，并 refresh。
- **refDemoName:** FLIP Carousel / Flexbox Filtering。
- **refDemoURL:** https://demos.gsap.com/demo/flexbox-filtering/
- **expectedEffect:** 保留下来的卡片滑到新位置，进入/离开卡片缩放淡入淡出，不再整网格硬切。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Articles.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Articles.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/ArticleCard.tsx`。
- **codeSkeleton:**
```ts
const state = Flip.getState(grid.querySelectorAll('[data-flip-id]'))
setSearchParams(next)
// after new query data commits
Flip.from(state, {
  targets: grid.querySelectorAll('[data-flip-id]'),
  duration: 0.55, ease: 'power3.inOut', absolute: true, stagger: 0.035,
  onComplete: () => ScrollTrigger.refresh(),
})
```
- **acceptance:** 快速切换分类不会错序；焦点保留在触发按钮；loading/empty 分支有明确过渡；URL、查询与视觉结果一致；reduce 模式无 FLIP。
- **risks:** 异步旧/新 DOM 生命周期；absolute 模式影响容器高度；分页滚动恢复时机。
- **effortEstimate:** 3–4 天。

#### HBSC-P1-04 — Issues 档案横向 pinned gallery

- **scope:** Issues archive desktop；mobile 保持原生纵向 grid。
- **technique:** pin 外层 section、移动内层 track，动态 x/end，`ease:'none'`、numeric scrub、matchMedia、invalidateOnRefresh。
- **refDemoName:** Horizontal Scrolling Gallery。
- **refDemoURL:** https://demos.gsap.com/demo/horizontal-scrolling-gallery/
- **expectedEffect:** 期刊封面成为全站标志性的横向编辑档案，垂直滚动映射为横向翻阅。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Issues.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Issues.css`。
- **codeSkeleton:**
```ts
mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
  const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth)
  gsap.to(track, {
    x: () => -distance(), ease: 'none',
    scrollTrigger: { trigger: viewport, pin: true, scrub: 0.8, end: () => '+=' + distance(), invalidateOnRefresh: true },
  })
})
```
- **acceptance:** 1 张期刊时不 pin；键盘与屏幕阅读顺序仍按 DOM；移动端无横向页面溢出；resize 后末卡完整可见；退出 pin 有自然间距。
- **risks:** 卡片数量少时滚动行程不合理；触屏横竖手势冲突；图片加载改变 track width。
- **effortEstimate:** 3–4 天。

#### HBSC-P1-05 — About waypoint 时间轴 + DrawSVG

- **scope:** About 2024/2025/2026 时间轴；移动端降级为普通逐项 reveal。
- **technique:** pinned waypoint timeline + snap；新增 SVG 线路用 DrawSVG 描绘。
- **refDemoName:** Scroll Waypoints / Draw A Path。
- **refDemoURL:** https://demos.gsap.com/demo/scroll-waypoints/
- **expectedEffect:** 三个年份成为三个清晰站位，金色线路随滚动连接节点，赋予 About 页面叙事主轴。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/About.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/About.css`。
- **codeSkeleton:**
```ts
const tl = gsap.timeline({ scrollTrigger: {
  trigger: timeline, pin: true, scrub: 0.55,
  end: () => '+=' + innerHeight * 2,
  snap: { snapTo: 0.5, duration: 0.3, ease: 'power2.inOut' },
}})
tl.from(path, { drawSVG: 0, ease: 'none' })
items.forEach((item, i) => tl.to(item, { autoAlpha: 1, y: 0 }, i))
```
- **acceptance:** 三站可双向滚动；移动端无 pin；年份内容不因 JS 失败隐藏；SVG 标记 aria-hidden；anchor/Tab 不被 pin 困住。
- **risks:** DrawSVG import 可用性；pin 与后续 Partners section 间距；snap 对触控用户过强。
- **effortEstimate:** 3 天。

#### HBSC-P1-06 — 卡片 3D tilt 与磁性 CTA

- **scope:** ArticleCard 与主要 CTA；仅 `(hover:hover) and (pointer:fine)`。
- **technique:** quickTo rotateX/rotateY/x/y + overwrite；卡片外层 perspective，内层承担 transform，避免 CSS hover 冲突。
- **refDemoName:** Cursor-driven Perspective Tilt / Magnetic Button。
- **refDemoURL:** https://demos.gsap.com/demo/cursor-driven-perspective-tilt/
- **expectedEffect:** 桌面精细指针下卡片呈克制 3D 景深，CTA 有轻微吸附；触屏保持现有反馈。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/ArticleCard.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/ArticleCard.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/styles/global.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/animations/pointerMotion.ts`（新建）。
- **codeSkeleton:**
```ts
const rx = gsap.quickTo(inner, 'rotateX', { duration: 0.35, ease: 'power3.out' })
const ry = gsap.quickTo(inner, 'rotateY', { duration: 0.35, ease: 'power3.out' })
const onMove = e => { const p = normalizedPointer(e, card); rx(-p.y * 5); ry(p.x * 5) }
const onLeave = () => { rx(0); ry(0) }
```
- **acceptance:** 最大倾角不超过 5°、按钮位移不超过自身短边 12%；键盘 focus 有等价非位移反馈；touch 不注册 move；卸载移除 listener。
- **risks:** 原 CSS transform 与 GSAP 冲突；过多卡片监听；3D 文本抗锯齿变化。
- **effortEstimate:** 2–3 天。

#### HBSC-P1-07 — Section title SplitText + divider draw

- **scope:** Articles、Issues、About 的 hero/section title 与 divider；不对长正文逐字拆分。
- **technique:** SplitText words/chars autoSplit + DrawSVG/CSS scaleX divider；限制总 stagger 时长。
- **refDemoName:** Animate Text / Draw A Path。
- **refDemoURL:** https://demos.gsap.com/demo/animate-text/
- **expectedEffect:** 中文标题呈现编辑式字符节奏，古铜金分隔线成为统一视觉语法。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Articles.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Issues.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/About.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/styles/global.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/animations/splitHeading.ts`（新建）。
- **codeSkeleton:**
```ts
SplitText.create(title, {
  type: 'words,chars', autoSplit: true,
  onSplit: self => gsap.from(self.chars, { yPercent: 105, autoAlpha: 0, stagger: 0.02, duration: 0.65 }),
})
gsap.from(divider, { scaleX: 0, transformOrigin: '0 50%', duration: 0.7 })
```
- **acceptance:** accessible name 与 DOM 文案不变；中文总动画小于 1.2 秒；resize/font ready 后无重复 wrapper；reduce/print 静态。
- **risks:** 字体加载造成 resplit；插件 import；过度使用导致全站标题同质化。
- **effortEstimate:** 2–3 天。

#### HBSC-P1-08 — Footer reveal 与 Newsletter 状态编排

- **scope:** Footer columns 首次 reveal；Newsletter idle/loading/error/success 高度与图标反馈。
- **technique:** footer ScrollTrigger stagger + 有限 elastic；Newsletter auto-height/opacity timeline，不改变提交逻辑。
- **refDemoName:** Footer Bounce / Animate Auto Height。
- **refDemoURL:** https://demos.gsap.com/demo/footer-bounce/
- **expectedEffect:** 长页收尾更有完成感，订阅成功不再瞬间替换。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/Footer.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/Footer.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/NewsletterForm.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/NewsletterForm.css`。
- **codeSkeleton:**
```ts
gsap.from(footerChildren, {
  y: 28, autoAlpha: 0, stagger: 0.07, duration: 0.65, ease: 'power3.out',
  scrollTrigger: { trigger: footer, start: 'top 88%', once: true },
})
gsap.fromTo(nextState, { height: 0, autoAlpha: 0 }, { height: 'auto', autoAlpha: 1, duration: 0.35 })
```
- **acceptance:** API 成功/失败语义不变；状态切换不导致布局跳动；footer 只播放一次；reduce 模式 fade 或直接切换；focus 不丢失。
- **risks:** height 动画触发布局；成功分支条件卸载过早；elastic 过度破坏品牌克制感。
- **effortEstimate:** 2 天。

#### HBSC-P1-09 — 公共路由 presence 过渡

- **scope:** `/`、`/articles*`、`/issues*`、`/about`、`/search`；Labs/Admin 保持既有边界。
- **technique:** Framer Motion AnimatePresence 管 React mount/unmount；GSAP 页面内 ScrollTrigger；两者写不同 wrapper。
- **refDemoName:** Animate Between Layout Positions（连续性原则参考）。
- **refDemoURL:** https://demos.gsap.com/demo/animate-between-layout-positions/
- **expectedEffect:** 公共页面切换有 150–220ms 的淡出/淡入连续性，同时正确清理前页 ScrollTrigger。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/App.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/styles/global.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/PublicRouteTransition.tsx`（新建）。
- **codeSkeleton:**
```tsx
<AnimatePresence mode='wait' initial={false}>
  <motion.div key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
    <Outlet />
  </motion.div>
</AnimatePresence>
```
- **acceptance:** Labs/Admin 不受影响；浏览器返回/前进正常；新页 focus/scroll restoration 明确；同一节点不同时由 GSAP 与 Motion 写 opacity/transform；reduce 模式 duration 0。
- **risks:** 当前每条 Route 单独包 Layout，重构路由壳有回归面；mode=wait 延迟页面显示；scroll restoration 与 exit 冲突。
- **effortEstimate:** 3–4 天。

### 3.4 P2 详细建议

#### HBSC-P2-01 — Hero Canvas 知识粒子场

- **scope:** Home 首屏试点；通过评审后才考虑 About。
- **technique:** 单 RAF canvas renderer，GSAP 仅驱动 emitter/密度/颜色代理；IntersectionObserver 停止离屏循环。
- **refDemoName:** Canvas Particles。
- **refDemoURL:** https://demos.gsap.com/demo/canvas-particles/
- **expectedEffect:** 深墨背景形成低密度“知识星图”，提升科技感而不依赖大视频。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/HeroParticles.tsx`（新建）。
- **codeSkeleton:**
```ts
const params = { density: 0.35, accent: 0 }
gsap.to(params, { accent: 1, scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.8 } })
function frame() { if (visible) { update(params); render(ctx) }; raf = requestAnimationFrame(frame) }
```
- **acceptance:** DPR 上限 2；移动端粒子数减半或静态；离屏停止 RAF；Lighthouse 相对基线下降不超过 5 分；reduce 模式显示静态背景。
- **risks:** CPU/GPU 持续占用；和 LCP 文本争抢主线程；Retina canvas 内存。
- **effortEstimate:** 5–7 天。

#### HBSC-P2-02 — Hero shader scroll uniform

- **scope:** Home hero 独立 A/B 试点。
- **technique:** fragment shader `uProgress/uTime/uResolution`，ScrollTrigger 只写 uniform；WebGL 不可用时回退现有 `.app-bg`/hero 背景。
- **refDemoName:** Shader On Scroll。
- **refDemoURL:** https://demos.gsap.com/demo/shader-on-scroll/
- **expectedEffect:** 深墨到古铜金的低频噪声渐变随滚动呼吸，形成高辨识度首屏。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/HeroShader.tsx`（新建）。
- **codeSkeleton:**
```ts
ScrollTrigger.create({
  trigger: hero, start: 'top top', end: 'bottom top',
  onUpdate: self => { material.uniforms.uProgress.value = self.progress },
})
// render loop pauses on visibilitychange / offscreen
```
- **acceptance:** WebGL context loss 可恢复/降级；低端移动端禁用；文字对比度全程达标；无全页面 horizontal overflow；性能门禁通过后才能上线。
- **risks:** GPU/电量；context loss；色彩对比与设计偏移；实现/维护成本高。
- **effortEstimate:** 7–10 天。

#### HBSC-P2-03 — 研究过程 image sequence

- **scope:** Home 或单个 IssueDetail 试点，二选一，不同时上线。
- **technique:** poster-first、近视口渐进 preload、canvas 按整数帧绘制、pin/scrub；只在帧号变化时 draw。
- **refDemoName:** Image Sequence。
- **refDemoURL:** https://demos.gsap.com/demo/image-sequence/
- **expectedEffect:** 滚动成为研究过程播放器，提供最强叙事冲击。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Home.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/IssueDetail.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/ScrollImageSequence.tsx`（新建）、`/Users/jasonlee/hubei-shuchuang/frontend-vite/public/seq/`（新增素材目录）。
- **codeSkeleton:**
```ts
const playhead = { frame: 0 }
gsap.to(playhead, {
  frame: frames.length - 1, snap: 'frame', ease: 'none',
  scrollTrigger: { trigger: sequence, pin: true, scrub: 0.5, end: '+=3000' },
  onUpdate: () => drawOnlyIfFrameChanged(Math.round(playhead.frame)),
})
```
- **acceptance:** 首屏只请求 poster/LCP 资源；距视口约 1–2 屏再加载序列；断网/缺帧显示 poster；内存峰值和总传输预算先定义再上线；reduce/save-data 禁用序列。
- **risks:** 素材制作与版本管理；带宽/解码/内存；pin 过长；移动端崩溃。
- **effortEstimate:** 8–12 天，另计素材生产。

#### HBSC-P2-04 — 移动端期刊 Draggable/Inertia 卡堆

- **scope:** Issues 移动端可选视图；默认纵向列表必须保留。
- **technique:** Draggable x + inertia + threshold/snap；`touch-action` 明确，纵向滚动优先；可切回列表。
- **refDemoName:** Card Stack。
- **refDemoURL:** https://demos.gsap.com/demo/card-stack/
- **expectedEffect:** 移动端可通过卡堆快速浏览期刊，但不会取代可访问的标准列表。
- **filesLikely:** `/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Issues.tsx`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/pages/Issues.css`、`/Users/jasonlee/hubei-shuchuang/frontend-vite/src/components/IssueCardStack.tsx`（新建）。
- **codeSkeleton:**
```ts
Draggable.create(card, {
  type: 'x', inertia: true, edgeResistance: 0.7,
  onDrag() { gsap.set(card, { rotation: this.x / 30 }) },
  onRelease() { Math.abs(this.x) > threshold ? advance() : gsap.to(card, { x: 0, rotation: 0 }) },
})
```
- **acceptance:** 上下滚动页面不被劫持；左右滑、按钮和键盘都可翻页；不会把滑动解释为收藏/删除；reduce 模式使用列表；插件 build 与移动 Safari 验证通过。
- **risks:** 手势冲突；Inertia 插件可用性；内容发现性下降；路由链接误触。
- **effortEstimate:** 6–8 天。

## 4. 迭代顺序

顺序必须保持“全部 P0 → 全部 P1 → 全部 P2”，同一优先级内按依赖排序：

1. `HBSC-P0-01` 公共动效运行时与降级网关。
2. `HBSC-P0-02` 首页 Hero。
3. `HBSC-P0-03` 两类详情 Hero。
4. `HBSC-P0-04` 阅读进度与 TOC。
5. `HBSC-P0-05` Cover reveal/parallax。
6. `HBSC-P0-06` Count-up。
7. `HBSC-P0-07` Navigation 可中断时间线。
8. `HBSC-P1-01` 列表 batch reveal。
9. `HBSC-P1-02` 正文 block reveal。
10. `HBSC-P1-03` Articles FLIP。
11. `HBSC-P1-04` Issues 横向 pin。
12. `HBSC-P1-05` About waypoints。
13. `HBSC-P1-06` 卡片/CTA pointer 动效。
14. `HBSC-P1-07` 标题 SplitText/Draw。
15. `HBSC-P1-08` Footer/Newsletter。
16. `HBSC-P1-09` 路由 presence；放在 P1 最后，避免和正在变化的页面内生命周期同时调试。
17. `HBSC-P2-01` Canvas 粒子。
18. `HBSC-P2-02` Shader；与粒子做二选一评审，不默认叠加。
19. `HBSC-P2-03` Image sequence；只有素材和性能预算批准后开始。
20. `HBSC-P2-04` Draggable 卡堆；保留列表基线后再试点。

建议交付批次：Iteration A=`P0-01..04`，B=`P0-05..07`，C=`P1-01..03`，D=`P1-04..06`，E=`P1-07..09`，F=逐个独立评审 P2。每批结束都记录 Lighthouse 基线、trigger 数量、reduced-motion 截图和触屏录像。

## 5. 全局考量

1. **reduced-motion：** 共享 `matchMedia('(prefers-reduced-motion: reduce)')` 网关。禁用 pin、scrub、3D tilt、磁性、Canvas/WebGL/序列帧；保留内容、进度语义与直接状态切换。禁止把可见性仅依赖 JS 动画终态。
2. **Lighthouse 性能预算：** 以每轮实现前的同路由移动端基线为对照，Performance 分数回退不得超过 5 分；目标 LCP ≤2.5s、INP ≤200ms、CLS ≤0.1；单个 long task <50ms。P2 必须额外记录 CPU 4x slowdown、低端 Android 与内存峰值。
3. **React 19 StrictMode 兼容性：** 只在 `useGSAP`/客户端生命周期创建动画；selector 必须有 scope；动态依赖使用 `revertOnUpdate:true`；事件回调用 `contextSafe`；卸载依赖 context revert，不全局 kill 其他页面/admin 的 trigger。
4. **移动端触屏(pointer 事件)：** hover/tilt/magnet 只在 `(hover:hover) and (pointer:fine)` 注册；使用 pointer 事件而非重复 mouse/touch listener；为 Draggable 明确 `touch-action`，默认保留垂直滚动、点击和键盘路径。
5. **CSS 与 transform 优先级：** 同一节点同一时刻只有一个 transform owner。CSS hover 与 GSAP 冲突时增加 wrapper：外层负责 layout/perspective，内层负责 GSAP transform，图片层负责 parallax。移动优先 x/y/scale/rotation/opacity，避免 width/height/top/left。
6. **preload 策略：** 每页最多一个确定的 LCP hero 使用 eager/`fetchpriority='high'`；其余 CoverImage 继续 lazy + async decode。字体只 preload 首屏必需字重，`document.fonts.ready` 后做一次 refresh。序列帧/Shader 代码和资源距视口 1–2 屏再加载；尊重 Save-Data。
7. **SSR/CSR 兼容：** 当前是 Vite CSR，但所有方案按可 SSR 的渐进增强设计：服务端/首屏 HTML 默认可见，任何 `window/document/gsap` 执行都位于客户端 hook；避免 hydration 前永久 opacity:0。
8. **GSAP 与 Framer Motion 共存：** GSAP 专属 scroll、timeline、Flip 和 pointer 高频值；Framer Motion 专属 route/list presence。需要同一视觉元素时分 wrapper，不在同一 DOM 节点竞争 opacity/transform/layout。
9. **ScrollTrigger refresh：** 创建顺序按页面从上到下；图片/字体/异步列表改变布局后合并一次 refresh；不在每个 resize callback 或每帧 refresh；production 禁止 markers。
10. **可访问性：** pin 不能改变 DOM/阅读顺序或困住焦点；SplitText 后 heading accessible name 不变；装饰 Canvas/SVG 使用 `aria-hidden`; 动画不承担唯一的信息表达。

## 6. 风险表

| ID | 风险 | 概率 | 影响 | 缓解 |
|---|---|---:|---:|---|
| R01 | React StrictMode 重复创建 tween/trigger | 中 | 高 | P0-01 统一 useGSAP scope、contextSafe、revertOnUpdate；路由循环测试 trigger 数。 |
| R02 | CSS animation/transition 与 GSAP 同写 transform/opacity | 高 | 高 | 删除同目标旧动画或增加 wrapper；建立属性 ownership 表。 |
| R03 | pin/snap 在移动端阻塞自然滚动 | 中 | 高 | desktop matchMedia；mobile 保持普通流；snap 先用户测试。 |
| R04 | 字体、lazy image、异步查询使 trigger 坐标过期 | 高 | 中 | fonts ready/image decode/query commit 后合并一次 refresh。 |
| R05 | SplitText resize wrapper 重复或 accessible name 变化 | 中 | 中 | autoSplit/onSplit 返回 tween；unmount revert；自动化可访问性检查。 |
| R06 | GSAP 与 Framer Motion 竞争属性 | 中 | 高 | 按能力分工；不同 wrapper；代码评审检查 property owner。 |
| R07 | FLIP 跨异步 React Query DOM 失配 | 中 | 高 | stable data-flip-id、previousData、快速切换测试；失败时降级为 enter/exit。 |
| R08 | Canvas/WebGL/sequence 拉低 LCP、INP 或耗电 | 高 | 高 | P2 独立门禁、延迟加载、离屏暂停、低端/Save-Data/reduce 降级。 |
| R09 | 插件 import/构建可用性与调研描述不一致 | 中 | 高 | 每个插件先最小 import/build smoke test；失败则采用 CSS/核心 GSAP 回退。 |
| R10 | 动效初始隐藏引发 FOUC/空白/CLS | 中 | 高 | 内容默认可见；useGSAP 同帧建立 from 状态；无 JS 时完整可读。 |
| R11 | route presence 破坏 scroll restoration/focus | 中 | 中 | P1 最后实施；显式定义滚动/焦点策略；Labs/Admin 排除。 |
| R12 | 动效过度削弱学术编辑品牌 | 中 | 中 | 限制位移、倾角、elastic；每页只设一个 signature motion，其余作为支持节奏。 |

## 7. 验收清单

### 构建与生命周期

- [ ] 在 `/Users/jasonlee/hubei-shuchuang/frontend-vite` 执行 `npm run build`，TypeScript 与 Vite 构建通过。
- [ ] 执行 `npm run lint`，无新增错误。
- [ ] React StrictMode 中对每个公共路由前进/后退 20 次，ScrollTrigger/ticker/listener 数不持续增长。
- [ ] 所有新增插件均有最小 import/build smoke test；production 无 `markers:true`。

### 视觉与响应式

- [ ] 375、768、1024、1440、1920px 下无水平溢出；`html/body/#root` 宽度正常，`.app-bg` 仍覆盖完整视口。
- [ ] 首页、文章详情、期刊详情首屏各只有一个主要 signature motion，支持动效不抢正文。
- [ ] 动态标题、无图、空列表、慢网、图片失败、字体晚加载均保持可读。
- [ ] pin section 进入/退出无跳跃，resize 后最终卡片/节点完整可见。

### 可访问性与输入

- [ ] `prefers-reduced-motion: reduce` 下无 pin/scrub/3D/Canvas/序列帧，内容与操作功能完整。
- [ ] Tab、Shift+Tab、Enter、Space、Escape 可操作导航、筛选、分页、TOC、CTA。
- [ ] 移动端上下滚动不被横向 gallery/Draggable 劫持；pointerfine 专属动效不在触屏注册。
- [ ] SplitText 后 heading accessible name 不变；装饰 SVG/Canvas 不进入可访问树。

### 性能

- [ ] 每轮记录改造前后同路由、同设备、同网络的 Lighthouse；Performance 回退 ≤5 分，LCP ≤2.5s、INP ≤200ms、CLS ≤0.1。
- [ ] 首屏只有一张 LCP 图片高优先级；下方图片 lazy；序列帧不在首屏批量 preload。
- [ ] pointermove 不创建新 tween；使用 quickTo/quickSetter；scroll onUpdate 不触发 React setState。
- [ ] 离屏 Canvas/WebGL/ticker 暂停，tab hidden 时暂停，context loss 有 fallback。

### 业务回归

- [ ] Articles category/page URL、React Query 数据、卡片顺序一致。
- [ ] ArticleDetail TOC、复制链接、微博分享、图片与表格行为不变。
- [ ] IssueDetail 无 cover/无 description/无 articles 分支正常。
- [ ] Newsletter 成功/失败与 loading 语义不变；Labs/Admin 路由不被公共 route transition 包裹。

## 8. 参考 demo 索引表

| slug | URL |
|---|---|
| horizontal-scrolling-gallery | https://demos.gsap.com/demo/horizontal-scrolling-gallery/ |
| infinite-looped-panels | https://demos.gsap.com/demo/infinite-looped-panels/ |
| infinite-looped-scrolling-sections | https://demos.gsap.com/demo/infinite-looped-scrolling-sections/ |
| pinned-panels-with-overscroll | https://demos.gsap.com/demo/pinned-panels-with-overscroll/ |
| scroll-waypoints | https://demos.gsap.com/demo/scroll-waypoints/ |
| threejs-scroll-waypoints | https://demos.gsap.com/demo/threejs-scroll-waypoints/ |
| scrubbed-bento-gallery | https://demos.gsap.com/demo/scrubbed-bento-gallery/ |
| velocity-skew | https://demos.gsap.com/demo/velocity-skew/ |
| image-sequence | https://demos.gsap.com/demo/image-sequence/ |
| shader-on-scroll | https://demos.gsap.com/demo/shader-on-scroll/ |
| image-mask-on-scroll | https://demos.gsap.com/demo/image-mask-on-scroll/ |
| stagger-items-in-on-scroll | https://demos.gsap.com/demo/stagger-items-in-on-scroll/ |
| trigger-on-scroll | https://demos.gsap.com/demo/trigger-on-scroll/ |
| lateral-pin-indicator | https://demos.gsap.com/demo/lateral-pin-indicator/ |
| responsive-line-splits-on-scroll | https://demos.gsap.com/demo/responsive-line-splits-on-scroll/ |
| link-to-scroll-progress | https://demos.gsap.com/demo/link-to-scroll-progress/ |
| animate-scroll-position | https://demos.gsap.com/demo/animate-scroll-position/ |
| basic-timeline | https://demos.gsap.com/demo/basic-timeline/ |
| complex-timeline | https://demos.gsap.com/demo/complex-timeline/ |
| enter-and-exit | https://demos.gsap.com/demo/enter-and-exit/ |
| staggering | https://demos.gsap.com/demo/staggering/ |
| interruptible-single-timeline-enterexit | https://demos.gsap.com/demo/interruptible-single-timeline-enterexit/ |
| timeline-clear-and-rebuild | https://demos.gsap.com/demo/timeline-clear-and-rebuild/ |
| animate-between-layout-positions | https://demos.gsap.com/demo/animate-between-layout-positions/ |
| animate-between-different-targets | https://demos.gsap.com/demo/animate-between-different-targets/ |
| animate-auto-height | https://demos.gsap.com/demo/animate-auto-height/ |
| cursor-follower | https://demos.gsap.com/demo/cursor-follower/ |
| cursor-tracking-image-preview | https://demos.gsap.com/demo/cursor-tracking-image-preview/ |
| cursor-trail | https://demos.gsap.com/demo/cursor-trail/ |
| magnetic-button-overwrite-modes | https://demos.gsap.com/demo/magnetic-button-overwrite-modes/ |
| radial-menu | https://demos.gsap.com/demo/radial-menu/ |
| cursor-driven-perspective-tilt | https://demos.gsap.com/demo/cursor-driven-perspective-tilt/ |
| proximity-scale-grid | https://demos.gsap.com/demo/proximity-scale-grid/ |
| card-stack | https://demos.gsap.com/demo/card-stack/ |
| make-elements-draggable | https://demos.gsap.com/demo/make-elements-draggable/ |
| swipe-slider | https://demos.gsap.com/demo/swipe-slider/ |
| flip-gallery-modal | https://demos.gsap.com/demo/flip-gallery-modal/ |
| flip-carousel | https://demos.gsap.com/demo/flip-carousel/ |
| flexbox-filtering | https://demos.gsap.com/demo/flexbox-filtering/ |
| macos-dock-effect | https://demos.gsap.com/demo/macos-dock-effect/ |
| observe-events | https://demos.gsap.com/demo/observe-events/ |
| footer-bounce | https://demos.gsap.com/demo/footer-bounce/ |
| create-physics-based-effects | https://demos.gsap.com/demo/create-physics-based-effects/ |
| curve-swipe | https://demos.gsap.com/demo/curve-swipe/ |
| morph-between-svg-shapes | https://demos.gsap.com/demo/morph-between-svg-shapes/ |
| smooth-morph | https://demos.gsap.com/demo/smooth-morph/ |
| shape-index | https://demos.gsap.com/demo/shape-index/ |
| draw-a-path | https://demos.gsap.com/demo/draw-a-path/ |
| animate-text | https://demos.gsap.com/demo/animate-text/ |
| horizontal-text | https://demos.gsap.com/demo/horizontal-text/ |
| text-masking | https://demos.gsap.com/demo/text-masking/ |
| text-scrambling | https://demos.gsap.com/demo/text-scrambling/ |
| animate-text-replacement | https://demos.gsap.com/demo/animate-text-replacement/ |
| rolling-text | https://demos.gsap.com/demo/rolling-text/ |
| canvas-particles | https://demos.gsap.com/demo/canvas-particles/ |
| smooth-scrolling | https://demos.gsap.com/demo/smooth-scrolling/ |
| animate-along-a-path | https://demos.gsap.com/demo/animate-along-a-path/ |
| motionpath-waypoints | https://demos.gsap.com/demo/motionpath-waypoints/ |
| canvas-morphs | https://demos.gsap.com/demo/canvas-morphs/ |
| dynamic-morphing | https://demos.gsap.com/demo/dynamic-morphing/ |
