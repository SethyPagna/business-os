import { defineConfig, devices } from '@playwright/test'

/**
 * playwright.config.ts -- browser end-to-end suite for the Business OS PWA.
 *
 * TWO TIERS, one config.
 *
 *   Tier "app" (default, frontend/e2e/*.spec.ts)
 *     Deterministic and backend-free. e2e/server/fixtureServer.mjs serves the
 *     REAL built dist plus committed /api fixtures recorded from the Worker
 *     routes. No database, no Worker, no network beyond loopback. These are the
 *     specs that must stay green on any machine, in any order.
 *
 *   Tier "system" (opt-in, E2E_SYSTEM=1, frontend/e2e/system/*.spec.ts)
 *     Runs the same browsers against a LOCAL wrangler Worker on 8787 with a
 *     seeded local D1. Excluded by default because it needs `npm run
 *     migrate:local` + `npm run dev` in cloudflare/ and a seeded admin.
 *
 * THREE PROJECTS, always. Every error class the owner named (blank page, white
 * screen, runtime errors, glitches, slowness) has shown up on exactly one form
 * factor before, so no spec is desktop-only:
 *     desktop-chromium  1440x900  Desktop Chrome
 *     android-chromium  Pixel 7   (touch, 2.625 dpr)
 *     ios-webkit        iPhone 13 (WebKit -- the only engine that reproduces
 *                                  iOS Safari's storage, viewport and
 *                                  getUserMedia behaviour)
 *
 * NOTHING HERE MAY REACH PRODUCTION. Every URL the suite uses is loopback; the
 * two origins below are both 127.0.0.0/8 and are chosen because
 * src/app/pathRouting.ts routes "/" by HOSTNAME (admin.* and localhost/127.0.0.1
 * are the admin shell; anything else is the customer storefront), mirroring
 * admin.leangbeauty.com vs leangbeauty.com.
 */

export const E2E_PORT = Number(process.env.E2E_PORT || 4318)
/** The admin shell: an "admin hostname" per src/app/pathRouting.ts. */
export const ADMIN_ORIGIN = `http://127.0.0.1:${E2E_PORT}`
/** The customer storefront: a non-admin hostname, so "/" mounts PublicCatalogRoot. */
export const STOREFRONT_ORIGIN = `http://127.0.0.2:${E2E_PORT}`

const isSystemTier = process.env.E2E_SYSTEM === '1'

// Chromium can be handed a synthetic camera. WebKit cannot, which is why
// scanner.spec.ts asserts the granted-camera contract on the two Chromium
// projects and the denied/unsupported contract on ios-webkit -- a single
// "it works" assertion would have been unfalsifiable on one of them.
const FAKE_CAMERA_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
]

/**
 * Shared context options. Exported because perf-budget.spec.ts builds its own
 * throwaway contexts (it measures a COLD boot several times and keeps the best
 * sample), and a second hand-written copy of the device descriptors would drift
 * the day somebody changes a viewport here.
 */
export const SHARED_CONTEXT_USE = {
  // A stable clock and locale: "no console errors" and the storefront's own
  // date formatting both change with them.
  locale: 'en-US',
  timezoneId: 'Asia/Phnom_Penh',
} as const

export const PROJECT_CONTEXT_USE = {
  'desktop-chromium': { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...SHARED_CONTEXT_USE },
  'android-chromium': { ...devices['Pixel 7'], ...SHARED_CONTEXT_USE },
  'ios-webkit': { ...devices['iPhone 13'], ...SHARED_CONTEXT_USE },
} as const

export default defineConfig({
  testDir: './e2e',
  // Tier "system" is opt-in. Without the flag its directory is not collected at
  // all, so `npm run test:e2e` on a clean checkout never fails for a missing
  // Worker.
  testIgnore: isSystemTier ? [] : ['system/**'],
  // Every spec drives one page through its own fixtures; nothing is shared, so
  // full parallelism is safe. The fixture server is stateless except for the
  // service-worker generation counter, and pwa-update.spec.ts serialises itself.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e-report', open: 'never' }],
  ],
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    // Evidence on failure only: a green run should cost nothing.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ...SHARED_CONTEXT_USE,
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...PROJECT_CONTEXT_USE['desktop-chromium'],
        launchOptions: { args: FAKE_CAMERA_ARGS },
      },
    },
    {
      name: 'android-chromium',
      use: {
        ...PROJECT_CONTEXT_USE['android-chromium'],
        launchOptions: { args: FAKE_CAMERA_ARGS },
      },
    },
    {
      name: 'ios-webkit',
      use: {
        ...PROJECT_CONTEXT_USE['ios-webkit'],
      },
    },
  ],

  // Tier "system" brings its own Worker (see e2e/system/README notes in
  // e2e/README.md); the fixture server would only shadow it.
  webServer: isSystemTier
    ? undefined
    : {
        // `npm run build` first: the suite tests the BUILT app, because the
        // blank-page and stale-module error classes only exist in the built
        // module graph. Reusing an existing dist is the fast path locally.
        command: 'node e2e/server/fixtureServer.mjs',
        url: `${ADMIN_ORIGIN}/__e2e/state`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
