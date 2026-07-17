import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { InertiaPlugin } from 'gsap/InertiaPlugin'
import { Draggable } from 'gsap/Draggable'
import { motionAllowed } from '../animations/reducedMotion'

export interface IssueCardStackItem {
  slug: string
  title: string
  cover?: string | null
  date?: string
  badge?: string
}

/**
 * Mobile-only swipeable issue card stack.
 *
 * Designed for touch devices and (max-width: 1023px) viewports. The
 * component renders a stack of 3 cards; the front card is draggable.
 * Velocity × threshold decides whether to advance, snap back, or throw
 * (inertia).
 *
 * This is the *optional secondary* mode for /issues on mobile. The native
 * vertical grid remains the primary entry point; this component is opt-in
 * via `feature mobile-card-stack` (or via direct route flag).
 *
 * Touch / a11y:
 *  - touch-action: pan-y on the front card so vertical page scroll still works
 *  - keyboard: ArrowLeft / ArrowRight on focus advance / rewind
 *  - aria-live announces "Showing N of M"
 */
export function IssueCardStack({ items, maxWidthPx = 1023 }: { items: IssueCardStackItem[]; maxWidthPx?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const frontRef = useRef<HTMLAnchorElement>(null)
  const [index, setIndex] = useState(0)

  // Disable on desktop or reduced-motion. The component returns null.
  const [active, setActive] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidthPx}px)`)
    const update = () => setActive(mql.matches && motionAllowed())
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [maxWidthPx])

  useEffect(() => {
    if (!active) return
    const front = frontRef.current
    const wrap = wrapRef.current
    if (!front || !wrap) return

    let draggable: Draggable | null = null
    const advance = (next: number) => {
      const total = items.length
      const wrapped = ((next % total) + total) % total
      setIndex(wrapped)
    }

    const ctx = gsap.context(() => {
      draggable = Draggable.create(front, {
        type: 'x',
        inertia: true,
        edgeResistance: 0.7,
        onDrag() {
          // tilt the card while dragging
          gsap.set(front, { rotation: this.x / 30 })
        },
        onRelease() {
          const v = Math.abs(this.velocityX) || 0
          const dx = Math.abs(this.x)
          if (dx > 120 || v > 400) {
            const dir = this.x < 0 ? 1 : -1
            gsap.to(front, { x: dir * -window.innerWidth, duration: 0.4, ease: 'power2.inOut', onComplete: () => {
              advance(index + (dir < 0 ? 1 : -1))
              gsap.set(front, { x: 0, rotation: 0, clearProps: 'transform' })
            } })
          } else {
            gsap.to(front, { x: 0, rotation: 0, duration: 0.3, ease: 'power2.out' })
          }
        },
        onClick() {
          // Forward clicks to the underlying link; Draggable suppresses them
          // when the gesture is recognised as drag.
        },
      })[0]

      // Stack visual: 2 cards behind the front one with slight offsets.
      const behind = wrap.querySelectorAll<HTMLElement>('[data-stack-card-behind]')
      behind.forEach((el, i) => {
        gsap.set(el, { y: 8 + i * 6, scale: 1 - i * 0.04, opacity: 1 - i * 0.15 })
      })

      const onKey = (e: KeyboardEvent) => {
        if (!front.matches(':focus-within')) return
        if (e.key === 'ArrowRight') advance(index + 1)
        if (e.key === 'ArrowLeft') advance(index - 1)
      }
      front.addEventListener('keydown', onKey)
      return () => {
        front.removeEventListener('keydown', onKey)
      }
    }, wrap)

    return () => {
      ctx.revert()
      if (draggable) draggable.kill()
      // Belt and braces
      InertiaPlugin?.clear?.(front)
    }
  }, [active, items.length, index])

  if (!active || items.length === 0) return null

  const frontItem = items[index % items.length] ?? items[0]
  const back1 = items[(index + 1) % items.length] ?? items[0]
  const back2 = items[(index + 2) % items.length] ?? items[0]

  return (
    <div ref={wrapRef} className="issue-stack" aria-roledescription="carousel" aria-label="期刊快览">
      <div className="issue-stack__head">
        <span className="issue-stack__count" aria-live="polite">
          {index + 1} / {items.length}
        </span>
        <span className="issue-stack__hint">左右滑动 · Enter 打开</span>
      </div>
      <div className="issue-stack__cards">
        {/* back cards for stacked visual */}
        <Link to={`/issues/${back2.slug}`} className="issue-stack__card issue-stack__card--back-2" data-stack-card-behind aria-hidden="true" tabIndex={-1}>
          <span className="issue-stack__title">{back2.title}</span>
        </Link>
        <Link to={`/issues/${back1.slug}`} className="issue-stack__card issue-stack__card--back-1" data-stack-card-behind aria-hidden="true" tabIndex={-1}>
          <span className="issue-stack__title">{back1.title}</span>
        </Link>
        <Link
          ref={frontRef}
          to={`/issues/${frontItem.slug}`}
          className="issue-stack__card issue-stack__card--front"
          aria-current="true"
          style={{ touchAction: 'pan-y' }}
        >
          {frontItem.cover && <img src={frontItem.cover} alt="" className="issue-stack__cover" loading="lazy" />}
          <div className="issue-stack__body">
            {frontItem.badge && <span className="issue-stack__badge">{frontItem.badge}</span>}
            <h3 className="issue-stack__title">{frontItem.title}</h3>
            {frontItem.date && <span className="issue-stack__date">{frontItem.date}</span>}
          </div>
        </Link>
      </div>
    </div>
  )
}
