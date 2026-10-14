import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'

// Owner report, live on c9fd83121: every sign-in painted "Dashboard summary
// unavailable -- Read belongs to an earlier account or refresh" until Refresh.
// The fixture server answers in microseconds; production answers in hundreds
// of milliseconds, which is what leaves the startup read in flight while the
// sign-in finishes adopting the account. Model that latency on loopback.
test.use({ serviceWorkers: 'block' })

const API_LATENCY_MS = Number(process.env.E2E_API_LATENCY_MS || 400)

async function withServerLatency(context: BrowserContext): Promise<void> {
  await context.route((url) => url.origin === ADMIN_ORIGIN && url.pathname.startsWith('/api/'), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, API_LATENCY_MS))
    await route.continue().catch(() => {})
  })
}

function startupResponses(page: Page): () => number {
  let settled = 0
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/dashboard/startup') settled++
  })
  return () => settled
}

test('signing in lands on a working Dashboard with no refresh', async ({ page, context }) => {
  const health = collectPageHealth(page)
  await withServerLatency(context)
  const startups = startupResponses(page)
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await expect.poll(startups, { message: 'the Dashboard startup read must be answered', timeout: 30_000 }).toBeGreaterThan(0)
  await page.waitForTimeout(API_LATENCY_MS * 4)
  await expect(page.getByText('Dashboard summary unavailable')).toHaveCount(0)
  expect(health.consoleErrors.filter((entry) => entry.includes('[Dashboard] startup failed'))).toEqual([])
  expect(health.consoleErrors.filter((entry) => entry.includes('Read belongs to an earlier account'))).toEqual([])
})
