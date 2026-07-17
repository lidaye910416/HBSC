import { useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import './About.css'
import { useGsapScope } from '@/animations/useGsapScope'
import { batchReveal } from '@/animations/batchReveal'
import { splitHeadingsIn } from '@/animations/splitHeading'
import { useEffect } from 'react'
import { motionAllowed } from '@/animations/reducedMotion'

const timeline = [
  { year: '2024', event: '湖北数创创刊，聚焦湖北数字产业创新研究' },
  { year: '2025', event: '发布首期《湖北数字产业创新研究》期刊' },
  { year: '2026', event: '第二期期刊发布，拓展四大内容板块' },
]

const partners = [
  { name: '湖北省经济和信息化厅', logo: 'HBEI' },
  { name: '武汉东湖新技术开发区', logo: 'WHDL' },
  { name: '华中科技大学', logo: 'HUST' },
  { name: '武汉大学', logo: 'WHU' },
  { name: '中国信通院', logo: 'CAICT' },
  { name: '湖北省软件行业协会', logo: 'HBSIA' },
]

export function About() {
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const pathRef = useRef<SVGPathElement | null>(null)
  const itemsRef = useRef<HTMLDivElement[]>([])

  // P1-05 — About waypoint timeline reveal.
  //
  // Motion-allowed users: batch-reveal the year/event rows as they cross the
  // viewport, and scale the gold connecting path in at the same time. The
  // previous desktop-only `pin + scrub + drawSVG` path was fragile (a double
  // `gsap.set(items, {autoAlpha:0})` from two matching matchMedia conditions
  // left items stuck at opacity 0 in every viewport), so it has been dropped
  // in favour of a single, ScrollTrigger.batch-driven reveal.
  // Reduced-motion users / no-JS: nothing is pre-hidden, so the static DOM
  // stays readable. SVG carries aria-hidden so screen readers don't double-
  // read the line.
  useGsapScope(() => {
    const root = timelineRef.current
    const path = pathRef.current
    const items = itemsRef.current.filter(Boolean)
    if (!root || !items.length) return

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia()

      mm.add(
        { isMotion: '(prefers-reduced-motion: no-preference)' },
        (matchContext) => {
          if (!matchContext.conditions?.isMotion) return

          // batchReveal owns the hide-then-show via `fromTo autoAlpha:0→1`,
          // so we deliberately do NOT pre-set items to autoAlpha:0 here.
          // Pre-hiding would race the viewport check and leave items stuck
          // at opacity 0 if the timeline is already on-screen at hydration.
          const killItems = batchReveal({
            root,
            selector: '[data-waypoint-item]',
            y: 20,
            stagger: 0.1,
            start: 'top 85%',
          })

          // Draw the gold connecting path in alongside the first item.
          // scaleY on the wrapper so we don't need the DrawSVG plugin here.
          let killPath: (() => void) | undefined
          if (path) {
            const pathTrigger = ScrollTrigger.create({
              trigger: root,
              start: 'top 85%',
              once: true,
              onEnter: () => {
                gsap.fromTo(
                  path,
                  { scaleY: 0, transformOrigin: 'top center' },
                  { scaleY: 1, duration: 0.9, ease: 'power3.out' },
                )
              },
            })
            killPath = () => pathTrigger.kill()
          }

          return () => {
            killItems()
            killPath?.()
          }
        },
      )

      return () => mm.revert()
    }, root)

    return () => ctx.revert()
  }, [])

  // Section title SplitText + divider draw on the page.
  useEffect(() => {
    if (!motionAllowed()) return
    const c1 = splitHeadingsIn(document, { mode: 'words', stagger: 0.02 })
    const ctx2 = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-divider-draw]').forEach(el => {
        gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } })
      })
    })
    return () => {
      c1()
      ctx2.revert()
    }
  }, [])

  return (
    <main className="about-page">
      {/* Hero */}
      <div className="about-hero">
        <div className="about-hero__bg" />
        <div className="about-hero__content">
          <p className="section-label">ABOUT US</p>
          <h1 data-split-heading>关于湖北数创</h1>
          <p className="about-hero__lead">
            在数字经济时代，我们致力于研究湖北数字产业发展趋势——<br />
            用专业的视角解读政策、推动创新、服务产业。
          </p>
        </div>
      </div>

      {/* Mission */}
      <section className="section">
        <div className="container about-mission">
          <div className="about-mission__text">
            <p className="section-label">使命与愿景</p>
            <h2>记录数字变革<br /><span className="text-accent">赋能产业升级</span></h2>
            <div className="divider divider--draw" data-divider-draw />
            <p>湖北数创创立于2024年，是湖北数字产业创新研究的内部期刊。我们的核心使命是：记录湖北数字产业发展变革、传播前沿理念、推动产业升级。</p>
            <p>我们关注数字经济政策解读、技术创新趋势、数字化转型案例等内容，旨在用专业的视角和严谨的方法，为湖北产业数字化转型提供有价值的参考。</p>
            <p>我们相信，数字经济是推动湖北高质量发展的重要引擎。通过这本期刊，我们希望汇聚各方力量，共同推动湖北数字产业的繁荣发展。</p>
          </div>
          <div className="about-mission__principles">
            {[
              { title: '专业严谨', desc: '每一个分析都基于充分的调研与审慎的论证' },
              { title: '服务产业', desc: '以服务湖北产业数字化转型为核心目标' },
              { title: '开放共享', desc: '研究内容公开分享，促进知识的广泛传播' },
              { title: '创新驱动', desc: '关注技术创新与模式创新，推动产业升级' },
            ].map((p, i) => (
              <div key={i} className="principle-item">
                <div className="principle-item__num">{String(i+1).padStart(2, '0')}</div>
                <div>
                  <h4>{p.title}</h4>
                  <p>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="section section--secondary about-timeline-section">
        <div className="container">
          <div className="text-center" style={{marginBottom:'48px'}}>
            <p className="section-label">发展历程</p>
            <h2 data-split-heading>我们的足迹</h2>
            <div className="divider divider--center" />
          </div>
          <div className="about-timeline" ref={timelineRef}>
            <svg
              className="about-timeline__path"
              aria-hidden="true"
              focusable="false"
              preserveAspectRatio="none"
              viewBox="0 0 20 100"
            >
              <path
                ref={pathRef}
                data-timeline-path
                d="M10 0 L10 100"
              />
            </svg>
            {timeline.map((item, i) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) itemsRef.current[i] = el
                }}
                className="about-timeline__item"
                data-waypoint-item
              >
                <div className="about-timeline__year">{item.year}</div>
                <div className="about-timeline__dot" />
                <div className="about-timeline__event">{item.event}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Partners */}
      <section className="section section--secondary">
        <div className="container">
          <div className="text-center" style={{marginBottom:'48px'}}>
            <p className="section-label">合作机构</p>
            <h2>研究伙伴</h2>
            <div className="divider divider--center" />
          </div>
          <div className="partners-grid">
            {partners.map((p, i) => (
              <div key={i} className="partner-card">
                <div className="partner-card__logo">{p.logo}</div>
                <p className="partner-card__name">{p.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}