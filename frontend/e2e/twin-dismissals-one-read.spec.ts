import { expect, test } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth } from './support/harness'
import { APP_ROOT, E2E_ACCOUNTS, signIn } from './support/session'

// The shell's TwinDismissalsLoader (App.tsx) reads the Keep-both rulings behind the Duplicate tag once per load of a signed-in shell. The e2e logs of a spec that signs
// in and then navigates show two reads: those are two loads (the sign-in lands on the shell, page.goto loads it again), each reading once. A second read within one
// load would be a network call and a read-budget call for nothing, so this pins one per load.
test.use({ serviceWorkers: 'block' })

test('each load of the signed-in shell reads the Keep-both dismissals once', async ({ page }) => {
  const health = collectPageHealth(page)
  const reads: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === ADMIN_ORIGIN && url.pathname === '/api/products/duplicate-dismissals') reads.push(request.method())
  })
  // Past the loader's 1.5 s debounce for a later products change, so a second read within the load would have been sent by now.
  const settle = () => page.waitForTimeout(4_000)

  await signIn(page, E2E_ACCOUNTS.cashierA)
  await settle()
  expect(reads, 'the load that follows sign-in').toEqual(['GET'])

  await page.goto(`${ADMIN_ORIGIN}/pos`)
  await expect(page.locator(APP_ROOT)).toBeVisible()
  await settle()
  expect(reads, 'a second load of the shell').toEqual(['GET', 'GET'])
  // Other pages' reads are not this spec's business; the dismissals route itself must answer.
  expect(health.failedApiResponses.filter((entry) => entry.includes('duplicate-dismissals'))).toEqual([])
})
