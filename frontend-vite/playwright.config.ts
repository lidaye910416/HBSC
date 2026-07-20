import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 1,
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  // Playwright must NOT pick up vitest unit tests that live in tests/animations/.
  testIgnore: ['**/*.test.ts', '**/*.test.tsx'],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'off',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
