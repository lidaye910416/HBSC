// frontend-vite/tests/e2e/visibility-fixes.spec.ts
//
// Regression specs for two visibility bugs fixed in commits
// dc60f4f (about timeline batch reveal) and 77dbc71 (nav dropdown
// re-create timeline when items finish loading).
//
// Both bugs shared the same symptom: a GSAP-tween'd element was left at
// autoAlpha:0 because the timeline was built before the target node
// existed / before ScrollTrigger could observe the right viewport state.
//
// We assert the observable DOM end-state — opacity near 1 and
// visibility !== 'hidden' — rather than reading GSAP internals.

import { test, expect } from '@playwright/test'

async function waitForStableHeight(page, { polls = 4, gapMs = 150 } = {}) {
  let last = -1
  for (let i = 0; i < polls; i++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    if (h === last) return h
    last = h
    await page.waitForTimeout(gapMs)
  }
  return last
}

test.describe('visibility regression fixes', () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' })

  test('aboutTimelineRevealsOnScroll: all 3 items reach opacity 1', async ({ page }) => {
    await page.goto('/about', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)

    const items = page.locator('[data-waypoint-item]')
    await expect(items).toHaveCount(3)

    // Scroll the timeline section into view; ScrollTrigger fires onEnter at
    // `top 85%`. Give ScrollTrigger an explicit refresh in case the page
    // was laid out while the test runner held the dev server.
    await page.evaluate(() => {
      const root = document.querySelector('[data-waypoint-item]')?.closest('.about-timeline')
      if (root) root.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    })
    await page.evaluate(() => {
      // gsap is bundled globally by useGsapScope; ScrollTrigger.refresh()
      // is exposed on it.
      const w = window as unknown as { gsap?: { ScrollTrigger?: { refresh: () => void } } }
      w.gsap?.ScrollTrigger?.refresh()
    })
    await page.waitForTimeout(200)

    // Up to ~6 s for ScrollTrigger to flush + tween to finish (~0.4 s).
    // 6 s is generous because the dev server is shared with other specs
    // and ScrollTrigger.batch onEnter can lag in flaky CI conditions.
    await expect.poll(async () => {
      return page.evaluate(() => {
        const els = Array.from(document.querySelectorAll<HTMLElement>('[data-waypoint-item]'))
        return els.map((el) => Number(getComputedStyle(el).opacity))
      })
    }, { timeout: 6000, intervals: [200, 300, 400, 500] }).toEqual([1, 1, 1])
  })

  test('navDropdownOpensOnClick: dropdown menu reaches opacity ~1', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForStableHeight(page)

    const trigger = page.locator('button.nav__dropdown-trigger')
    await expect(trigger).toBeVisible()

    // Wait for the issues query to finish loading so the dropdown items
    // (and the GSAP timeline that animates them) exist before we click.
    // The navbar renders either [data-nav-dropdown-item] nodes (issues
    // loaded) or a `.nav__dropdown-empty` placeholder (issues empty) — we
    // poll for whichever appears first.
    await expect.poll(async () => {
      return page.evaluate(() => ({
        items: document.querySelectorAll('[data-nav-dropdown-item]').length,
        empty: !!document.querySelector('.nav__dropdown-empty'),
      }))
    }, { timeout: 5000, intervals: [100, 150, 200, 250, 300] }).toMatchObject({
      items: expect.any(Number),
    })

    // Give one more animation frame for useGSAP to commit the new timeline
    // since `dependencies: [sortedIssues]` re-runs the effect when items
    // arrive.
    await page.waitForTimeout(200)

    // Use a real pointer click. This intentionally covers the hover + click
    // sequence that previously opened on mouseenter and immediately toggled
    // closed in the click handler.
    await trigger.click()

    // GSAP timeline duration is ~0.22 s plus the small stagger for items.
    // 700 ms is comfortably enough margin.
    await page.waitForTimeout(700)

    const state = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-nav-dropdown]')
      if (!el) return null
      const cs = getComputedStyle(el)
      return { opacity: Number(cs.opacity), visibility: cs.visibility }
    })

    expect(state, 'dropdown menu element').not.toBeNull()
    expect(state!.opacity, 'dropdown opacity').toBeGreaterThan(0.9)
    expect(state!.visibility, 'dropdown visibility').not.toBe('hidden')
  })

  test('nav dropdown closes after pointer leaves the trigger and menu area', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const trigger = page.locator('button.nav__dropdown-trigger')
    const menu = page.locator('[data-nav-dropdown]')

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await page.locator('main').hover({ position: { x: 20, y: 300 } })

    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toHaveAttribute('aria-hidden', 'true')
  })

  test('open nav dropdown stays visible when issue data finishes loading', async ({ page }) => {
    let releaseIssues: (() => void) | undefined
    await page.route('**/api/issues', async (route) => {
      await new Promise<void>((resolve) => { releaseIssues = resolve })
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 1,
          title: '2026 年第二期',
          slug: '2026-q2',
          article_count: 4,
        }]),
      })
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const trigger = page.locator('button.nav__dropdown-trigger')
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(() => Boolean(releaseIssues)).toBe(true)
    releaseIssues?.()
    await expect(page.locator('[data-nav-dropdown-item]')).toHaveCount(1)

    const menu = page.locator('[data-nav-dropdown]')
    await expect.poll(async () => Number(await menu.evaluate((element) => getComputedStyle(element).opacity)))
      .toBeGreaterThan(0.9)
  })

  test('nav dropdown trigger toggles closed for keyboard users', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const trigger = page.locator('button.nav__dropdown-trigger')

    await trigger.focus()
    await page.keyboard.press('Space')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Space')

    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('nav dropdown trigger closes on a second pointer click', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const trigger = page.locator('button.nav__dropdown-trigger')

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await trigger.click()

    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('mobile navigation closes when selecting the current articles route', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/articles', { waitUntil: 'networkidle' })
    const toggle = page.locator('button.nav__mobile-toggle')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('link', { name: '所有文章', exact: true }).click()

    await expect(page).toHaveURL('/articles')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('mobile navigation closes after following the articles link', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/', { waitUntil: 'networkidle' })
    const toggle = page.locator('button.nav__mobile-toggle')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('link', { name: '所有文章', exact: true }).click()

    await expect(page).toHaveURL('/articles')
    await expect(page.locator('button.nav__mobile-toggle')).toHaveAttribute('aria-expanded', 'false')
  })
})
