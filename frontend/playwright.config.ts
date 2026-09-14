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
  // E2E_WORKERS exists because this repository is worked by several sessions at
  // once: a run that shares the machine with a dozen other browsers is slower
  // per action, and `E2E_WORKERS=2` buys back the headroom without changing a
  // single assertion. 4 is the default because that is what the budgets in
  // perf-budget.spec.ts were measured under.
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : (process.env.CI ? 2 : 4),
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e-report', open: 'never' }],
  ],
  outputDir: 'test-results',
  // These four numbers are HARNESS budgets -- how long the runner waits before
  // giving up -- and deliberately NOT a claim about how fast the app is. The
  // only timing claims in this suite live in perf-budget.spec.ts, which
  // measures explicitly, keeps its own budgets, and is unaffected by anything
  // here.
  //
  // They were raised (test 60->90 s, action 15->30 s, navigation 30->45 s,
  // expect 10->15 s) after a measured failure mode, not defensively: on a
  // machine shared with other sessions (161 chrome + 79 node processes at the
  // time) one full run lost 5 ios-webkit tests, every one of them a
  // `locator.click: Timeout 15000ms exceeded` on an element Playwright had
  // already resolved and was merely waiting to settle. Re-running the same
  // files in isolation immediately passed 5/6, and the one straggler passed
  // alone in 4.7 s. Nothing in the product was slow; the CPU was.
  //
  // The cost of the larger numbers is that a genuine hang takes longer to
  // report. The cost of the smaller ones was failures that say nothing about
  // the app, which is worse: a suite that cries wolf stops being read.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    // Evidence on failure only: a green run should cost nothing.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
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
