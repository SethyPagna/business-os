import { expect, test } from '@playwright/test'
import {
  STOREFRONT_KM_LABELS,
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
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-guest-requests
 */

const MARKER_KEY = 'business-os:portal-signed-in'

test.describe('storefront guard: guests add no requests', () => {
  test.use({ serviceWorkers: 'block' })

  test('focus, tab return, a restored page and a marker change make no /api request', async ({ page, context }) => {
    // The pick stays English: nothing here may contact Google.
    await seedStorefrontLanguage(context, STOREFRONT_ORIGIN, 'en')
    const health = collectPageHealth(page)
    const apiPaths: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/')) apiPaths.push(`${request.method()} ${url.pathname}${url.search}`)
    })

    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await storefrontSectionTab(page, STOREFRONT_KM_LABELS, 'products').click()
    await expect(page.locator(storefrontCards).first()).toBeVisible()
    await page.waitForLoadState('networkidle')

    const loadPaths = [...apiPaths]
    await test.info().attach('guest-load-api-paths', { body: JSON.stringify({ count: loadPaths.length, paths: loadPaths }, null, 2), contentType: 'application/json' })
    test.info().annotations.push({ type: 'guest-load-api-requests', description: String(loadPaths.length) })
    expect(loadPaths.length, 'the load itself reaches the Worker (the control: the counter is live)').toBeGreaterThan(0)

    // Each event runs the page's own listeners; the marker is written first so the re-read has something to find.
    await page.evaluate((key) => {
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

    // Two frames after the events: React has run every state update the listeners asked for.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.waitForLoadState('networkidle')

    expect(apiPaths.slice(loadPaths.length), 'requests made after the events').toEqual([])
    expectNoRuntimeErrors(health)
  })
})
