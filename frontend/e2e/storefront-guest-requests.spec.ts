import { expect, test } from '@playwright/test'
import {
  STOREFRONT_EN_LABELS,
  STOREFRONT_ORIGIN,
  collectPageHealth,
  expectNoRuntimeErrors,
  seedStorefrontLanguage,
  storefrontCards,
  storefrontSectionTab,
} from './support/harness'

/**
 * storefront-guest-requests.spec.ts -- the translate guard costs a guest ZERO Worker requests.
 *
 * The shop runs on Cloudflare's free plan and the public site is its widest door. The guard that keeps Google's translate script away from
 * a signed-in shopper learns about a sign-in made in another tab from a localStorage marker, never from the network: focus, tab return,
 * a restored page and a storage event only re-read the marker.
 *
 * CATCHES: any listener that asks the Worker again (the round-1 design re-checked /api/portal/auth/me on focus, visibility and pageshow).
 * The load-time list of API paths is attached to the test output so the measured number can be read from the gate log.
 *
 * SILENCE OVER TIME: Playwright's clock is installed before the page loads. After the events fire, the clock runs past 10 s (longer than any
 * throttle a re-check could hide behind), the events fire once more, the clock runs again, and only then is the request list read. No real
 * waiting and no waitForTimeout: a delayed or throttled re-check has its timer fired by the clock.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-guest-requests
 */

const MARKER_KEY = 'business-os:portal-signed-in'

test.describe('storefront guard: guests add no requests', () => {
  test.use({ serviceWorkers: 'block' })

  test('focus, tab return, a restored page and a marker change make no /api request', async ({ page, context }) => {
    // The pick stays English: nothing here may contact Google.
    await page.clock.install()
    await seedStorefrontLanguage(context, STOREFRONT_ORIGIN, 'en')
    const health = collectPageHealth(page)
    const apiPaths: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/')) apiPaths.push(`${request.method()} ${url.pathname}${url.search}`)
    })

    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await storefrontSectionTab(page, STOREFRONT_EN_LABELS, 'products').click()
    await expect(page.locator(storefrontCards).first()).toBeVisible()
    await page.waitForLoadState('networkidle')

    const loadPaths = [...apiPaths]
    await test.info().attach('guest-load-api-paths', { body: JSON.stringify({ count: loadPaths.length, paths: loadPaths }, null, 2), contentType: 'application/json' })
    test.info().annotations.push({ type: 'guest-load-api-requests', description: String(loadPaths.length) })
    expect(loadPaths.length, 'the load itself reaches the Worker (the control: the counter is live)').toBeGreaterThan(0)

    // Everything recorded from here on is a request the events caused.
    const settled = apiPaths.length

    // Each event runs the page's own listeners; the marker is written first so the re-read has something to find.
    const fireEvents = () => page.evaluate((key) => {
      window.localStorage.setItem(key, String(Date.now()))
      window.dispatchEvent(new Event('focus'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('resume'))
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      window.dispatchEvent(new StorageEvent('storage', { key }))
      window.localStorage.removeItem(key)
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    }, MARKER_KEY)
    const settleFrames = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

    await fireEvents()
    await settleFrames()
    // Past 10 s of page time: a throttled or delayed re-check would fire its timer here.
    await page.clock.runFor(11_000)
    await fireEvents()
    await settleFrames()
    await page.clock.runFor(11_000)
    await settleFrames()

    expect(apiPaths.slice(settled), 'requests made after the events').toEqual([])
    expectNoRuntimeErrors(health)
  })
})
