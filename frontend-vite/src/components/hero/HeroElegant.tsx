'use client'

/**
 * HeroElegant — 克制优雅型 Hero 容器
 * ─────────────────────────────────────────────────────────────────────────────
 * 设计目标:
 *   1. 入场:label / title (SplitText 字符级) / subtitle / actions 顺序 stagger
 *   2. 鼠标:全局视差(背景 gradient + 标题字符跟随,quickTo 平滑)
 *   3. 悬停:title 字符级 hover (字符轻微上浮 + 高亮)、按钮 magnetic pull
 *   4. 退场:滚动时 hero 整体向上 + 渐隐(scrub,跟 ScrollTrigger 节奏)
 *
 * 约束遵循:
 *   - 不引入新依赖(只用已注册的 GSAP 插件: ScrollTrigger, SplitText, Flip)
 *   - useGsapScope + useEffect 双向覆盖(useEffect 用于挂载 quickTo listeners)
 *   - motionAllowed() 单点 gate(reducedMotion + saveData)
 *   - prefers-reduced-motion 完美回退:不入场动画、不视差、不 magnetic,直接静态
 *   - 防 StrictMode / HMR:所有监听器/tweens 在 cleanup 中完整 kill,
 *     useGsapScope 自带 revertOnUpdate=true
 *   - 字符级 SplitText:中文退化为「整句为 1 单元」(沿用 splitHeading.ts 策略),
 *     英文按 chars 拆,保证中文不闪烁
 *
 * 这个文件只提供**架构骨架**。具体 GSAP 代码以 placeholder 注释标注,
 * 等具体 task 阶段再填充。组件可以直接 mount,静态 UI 全可见,只是没动画。
 */

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { motionAllowed } from '../../animations/reducedMotion'
import { useGsapScope } from '../../animations/useGsapScope'
import './HeroElegant.css'

// ── 子模块占位符 ──────────────────────────────────────────────────────────────
// 当前阶段先用空实现占位,后续 task 单独填充。组件 mount 时调用对应 mountXxx(),
// 返回 cleanup 函数。组件 unmount / re-render 时由 useEffect 统一清理。

interface MountFnResult {
  cleanup: () => void
}

/** 入场 stagger reveal(标签 / 标题字符 / 副标题 / 按钮) */
async function mountIntroReveal(root: HTMLElement): Promise<MountFnResult> {
  // TODO: 填充策略 ——
  //   1. 找到 .hero__label, .hero__title, .hero__subtitle, .hero__actions
  //   2. 对 .hero__title 用 SplitText.create(el, { type: 'chars,lines', autoSplit: true })
  //      (注意:SplitText 在中文下应只用 chars;英文 fallback chars+lines 都行)
  //   3. gsap.timeline({ defaults: { ease: 'power3.out', duration: 0.55 } })
  //      .from(label,  { y: 16, autoAlpha: 0 }, 0)
  //      .from(titleChars, { yPercent: 105, autoAlpha: 0, stagger: 0.022 }, 0.08)
  //      .from(subtitle, { y: 12, autoAlpha: 0 }, '-=0.35')
  //      .from(actions, { y: 12, autoAlpha: 0 }, '-=0.35')
  //   4. onSplit 回调:对每个新的 SplitText 实例返回 cleanup(否则 resize 会泄漏)
  return { cleanup: () => {} }
}

/** 鼠标全局视差(背景 radial-gradient 中心 + title chars 偏移) */
function mountPointerParallax(root: HTMLElement, hero: HTMLElement): MountFnResult {
  // TODO: 填充策略 ——
  //   1. guard (pointer: fine) 用 window.matchMedia,触摸设备直接 return
  //   2. 创建 quickTo:
  //        bgX = gsap.quickTo('.hero__pattern', '--mx', { duration: 0.6, ease: 'power3' })
  //        bgY = gsap.quickTo('.hero__pattern', '--my', { duration: 0.6, ease: 'power3' })
  //   3. 监听 hero pointermove,把 clientX/Y 归一化到 [-1, 1] 后写入 CSS 变量
  //      (CSS 里把 var(--mx)/var(--my) 用于 radial-gradient 的 at 50% calc(...))
  //   4. 对 title chars 用 InertiaPlugin 或 quickTo 做 ±6px 抖动
  //      (注意:每个 char 一个 quickTo,几十个 char 没压力)
  //   5. pointerleave 把所有 quickTo 回到 0
  return { cleanup: () => {} }
}

/** 标题字符级 hover(高亮 + 上浮) */
function mountTitleHover(root: HTMLElement): MountFnResult {
  // TODO: 填充策略 ——
  //   1. SplitText.create 给 title 字符后,给每个 .char 绑 pointerenter / pointerleave
  //   2. gsap.to(char, { y: -4, color: 'var(--color-accent-on-dark)', duration: 0.25 })
  //   3. 离开时反向 .to(char, { y: 0, color: 'inherit', duration: 0.4, overwrite: 'auto' })
  //   4. 用事件代理代替逐字符监听(避免 N 个 listener);在 .hero__title 上 capture phase
  //      判断 e.target.matches('.char') 后再处理
  return { cleanup: () => {} }
}

/** 按钮 magnetic pull + 松手 elastic 回弹 */
function mountMagneticButtons(root: HTMLElement): MountFnResult {
  // TODO: 填充策略 ——
  //   1. gsap.utils.toArray('.hero__actions .btn').forEach(btn => { ... })
  //   2. 用 gsap.utils.mapRange 计算相对位置:
  //      const mapX = gsap.utils.mapRange(rect.left, rect.right, -btnW/2, btnW/2, e.clientX)
  //   3. mousemove: gsap.to(btn, { x: mapX * 0.3, y: mapY * 0.3, duration: 0.4,
  //                                ease: 'power2.out', overwrite: 'auto' })
  //   4. mouseleave: gsap.to(btn, { x: 0, y: 0, duration: 0.7,
  //                                  ease: 'elastic.out(1, 0.4)', overwrite: 'auto' })
  //   5. 一定要 overwrite: 'auto'!避免多个 tween 互相冲突(参考磁吸 button overwrite modes demo)
  return { cleanup: () => {} }
}

/** 滚动退场(scrub 跟滚动联动) */
function mountScrollExit(hero: HTMLElement): MountFnResult {
  // TODO: 填充策略 ——
  //   1. gsap.to(hero, {
  //        yPercent: -25,
  //        autoAlpha: 0,
  //        ease: 'none',
  //        scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 }
  //      })
  //   2. 注意:hero 内部的 .hero__pattern / .hero-particles / .hero-shader 各自也有
  //      scrollTrigger,需要保证它们不被这次退场动画误杀 ——
  //      通过 overwrite: false + 选择器 scope 隔离
  return { cleanup: () => {} }
}

// ── 组件主体 ────────────────────────────────────────────────────────────────

export function HeroElegant() {
  const rootRef = useRef<HTMLElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)

  // useGsapScope 范围:包裹所有 GSAP context 内的 tween / ScrollTrigger
  useGsapScope(() => {
    const root = rootRef.current
    const hero = heroRef.current
    if (!root || !hero || !motionAllowed()) return

    // mountIntroReveal 返回 Promise,这里改成同步包装以匹配 useGSAP 签名
    let cleanupIntro: (() => void) | undefined
    void mountIntroReveal(root).then(r => { cleanupIntro = r.cleanup })

    const cleanupPointer = mountPointerParallax(root, hero)
    const cleanupHover = mountTitleHover(root)
    const cleanupMag = mountMagneticButtons(root)
    const cleanupExit = mountScrollExit(hero)

    return () => {
      cleanupIntro?.()
      cleanupPointer.cleanup()
      cleanupHover.cleanup()
      cleanupMag.cleanup()
      cleanupExit.cleanup()
    }
  }, [], { scope: rootRef })

  // 防御性再清理(应对 HMR 偶发的 useGSAP cleanup 漏掉的情况)
  useEffect(() => () => {
    ScrollTrigger.getAll()
      .filter(t => rootRef.current?.contains(t.trigger as Element | null))
      .forEach(t => t.kill())
  }, [])

  // reduced-motion / saveData 静态降级(无 gsap,直接渲染 DOM)
  if (!motionAllowed()) {
    return <HeroMarkup />
  }

  return (
    <section ref={rootRef} className="hero hero--elegant" data-testid="hero-elegant">
      <div ref={heroRef} className="hero__content container">
        <HeroMarkup />
      </div>
    </section>
  )
}

/** 纯 UI markup,与动画解耦 ——
 *  测试 / SSR / reduced-motion 用户都会看到这一份。 */
function HeroMarkup() {
  return (
    <>
      <p className="hero__label" data-reveal="label">
        <span className="text-en">Hubei Digital Innovation</span>
      </p>
      <h1 className="hero__title" data-reveal="title">
        <span className="hero__title-line">智领AI荆楚新程</span>
        <span className="hero__title-accent">数绘产业发展新篇</span>
      </h1>
      <p className="hero__subtitle" data-reveal="subtitle">
        湖北数创是湖北数字产业创新研究的内部期刊<br />
        记录数字变革、传播前沿理念、赋能产业升级
      </p>
      <div className="hero__actions" data-reveal="actions">
        <Link to="/articles" className="btn btn-primary">
          阅读期刊 <ArrowRight size={16} />
        </Link>
        <Link to="/about" className="btn btn-outline">关于我们</Link>
      </div>
    </>
  )
}