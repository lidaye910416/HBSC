// frontend-vite/tests/labs-page.spec.ts
import { test, expect } from '@playwright/test'

test.describe('数创实验室 /labs landing page', () => {
  test('loads at /labs with hero + lab cards', async ({ page }) => {
    await page.goto('/labs')

    // Hero
    await expect(page.getByRole('heading', { name: '数创实验室', level: 1 })).toBeVisible()
    await expect(page.getByText('探索 AI 驱动的内部实验项目')).toBeVisible()

    // Lab cards: 1 active + 2 coming-soon
    const cards = page.getByTestId('lab-card')
    await expect(cards).toHaveCount(3)

    // MiniCast is active with CTA pointing to /labs/minicast
    const minicastCard = page.getByTestId('lab-card').filter({ hasText: 'MiniCast' })
    await expect(minicastCard).toContainText('AI 播客生成器')
    await expect(minicastCard.getByRole('link', { name: /开始使用/ })).toHaveAttribute('href', '/labs/minicast')

    // Coming-soon cards are not clickable
    const comingSoon = page.getByTestId('lab-card').filter({ hasText: '下一个 Lab' })
    await expect(comingSoon.first()).toContainText('敬请期待')
  })

  test('theme uses hbsc 科技蓝 tokens (not gold)', async ({ page }) => {
    await page.goto('/labs')
    const accentLink = page.getByRole('link', { name: /开始使用/ }).first()
    const bg = await accentLink.evaluate((el) => getComputedStyle(el).backgroundColor)
    // accent = #2563eb = rgb(37, 99, 235)
    expect(bg).toMatch(/rgb\(37,\s*99,\s*235\)/)
  })
})