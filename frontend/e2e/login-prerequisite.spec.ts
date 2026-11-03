import { expect, test } from '@playwright/test'
import { APP_ROOT, E2E_ACCOUNTS, signInForTiming } from './support/session'

/**
 * login-prerequisite.spec.ts -- the timed sign-in used by perf-budget.spec.ts
 * waits for the form's own prerequisite (the organization) before it types.
 *
 * WHY A SPEC FOR A HELPER: the "till is usable within budget" test lost a cold
 * attempt in two of the first four gate runs (android-chromium, then passed on
 * the retry and was reported flaky). The sampler typed and clicked Login the
 * moment #login-username was visible; Login.tsx keeps the button live while the
 * organization is still being fetched and refuses the submit, so a loaded
 * runner that answered the bootstrap a little late gave `#app-root` never
 * appearing. A quiet laptop never shows it, so this holds the bootstrap for a
 * fixed 1.5 s and makes the late answer the ONLY thing under test.
 *
 * CATCHES: a sign-in helper that fills and clicks before the organization is
 * set (the old inline version fails this with `#app-root` ... element(s) not
 * found). It does not time or budget anything.
 */
test.use({ serviceWorkers: 'block' })

const BOOTSTRAP_DELAY_MS = 1_500

test('the timed sign-in waits for a slow organization bootstrap instead of clicking Login into a refusal', async ({ page }) => {
  let bootstrapAnsweredAt = 0
  let loginPostedAt = 0
  await page.route('**/api/organizations/bootstrap', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_DELAY_MS))
    bootstrapAnsweredAt = Date.now()
    await route.fallback()
  })
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/login') loginPostedAt = Date.now()
  })

  await signInForTiming(page, E2E_ACCOUNTS.cashierA)

  await expect(page.locator(APP_ROOT)).toBeVisible()
  expect(bootstrapAnsweredAt, 'the bootstrap really was held, so the wait was exercised').toBeGreaterThan(0)
  expect(loginPostedAt, 'Login was submitted after the organization arrived, not before').toBeGreaterThanOrEqual(bootstrapAnsweredAt)
})
