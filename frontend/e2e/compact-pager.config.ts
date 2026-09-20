import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: '.', testMatch: 'compact-pager-numbers.spec.ts', workers: 1,
  reporter: 'list', use: { browserName: 'chromium' }, outputDir: '../output/playwright/compact-pager' })
