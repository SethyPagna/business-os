import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  PORTAL_CACHE_KEY,
  STOREFRONT_EN_LABELS,
  STOREFRONT_KM_LABELS,
  STOREFRONT_ORIGIN,
  blockSiteData,
  collectPageHealth,
  expectNoRuntimeErrors,
  fetchBootstrapPayload,
  seedStorefrontCache,
  seedStorefrontLanguage,
  storefrontCards,
  storefrontSectionTab,
} from './support/harness'

/**
 * storefront-boot.spec.ts -- the customer storefront comes up, on every engine,
 * even when the browser is hostile.
 *
 * WHAT THIS PROVES
 *  - leangbeauty.com renders REAL product cards, not the pre-paint shell that
 *    index.html paints before any script runs.
 *  - It still renders them when web storage throws, which is what Safari
 *    private mode and "block all cookies" actually do -- and it does so without
 *    leaking a console error on the way.
 *  - The hostname routing picks the PUBLIC root, so the rest of the suite is
 *    not quietly testing the admin app.
 *
 * ERROR CLASS GUARDED: 1defc523 -- the blank storefront. A throw inside a
 * useRef initializer escaped PublicCatalogRoot's Suspense boundary (which is
 * not an error boundary) and the customer got nothing at all.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-boot
 *
 * Each test below names the wrong implementation it catches.
 */

test.describe('leangbeauty storefront boot', () => {
  test('renders the catalogue, not a blank page', async ({ page }) => {
    // CATCHES: any regression that leaves #root empty or stuck on the inline
    // loading shell -- a failed lazy chunk, a thrown module-scope initializer,
    // a Suspense fallback that never resolves. Asserting on real product CARDS
    // rather than on "body has text" is what makes it discriminating: the
    // pre-paint shell in index.html already puts "Leang Beauty" on screen, so a
    // text assertion would pass on a page whose React tree never mounted.
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })

    // The public root is chosen by HOSTNAME (src/app/pathRouting.ts). If this
    // ever reads "admin" the rest of the file is testing the wrong app.
    await expect(page.locator('html')).toHaveAttribute('data-business-os-initial-route', 'public')
    // A first visit opens in Khmer, the owner's storefront default.
    await expect(page.locator('html')).toHaveAttribute('lang', 'km')

    // About is the store's default landing tab (PublicCatalogPage's
    // resolvePortalActiveTab(..., 'about')), so the grid is one tap away.
    await storefrontSectionTab(page, STOREFRONT_KM_LABELS, 'products').click()

    await expect(page.locator(storefrontCards).first()).toBeVisible()
    // 137 fixture products at the store's own page size of 50.
    await expect(page.locator(storefrontCards)).toHaveCount(50)
    await expect(page.getByRole('navigation', { name: STOREFRONT_KM_LABELS.page }).first()).toBeVisible()

    expectNoRuntimeErrors(health)
    // A storefront that 404s or 500s on its own bootstrap is a white screen
    // waiting to happen even when this load happened to survive it.
    expect(health.failedApiResponses, 'storefront API responses').toEqual([])
  })

  test('still renders when site data is blocked (the 1defc523 regression)', async ({ page, context }) => {
    // CATCHES: reading window.localStorage / sessionStorage / indexedDB outside
    // a try/catch. In Safari private mode and under Chrome's "block all
    // cookies" those getters THROW SecurityError. PublicCatalogRoot has a
    // Suspense boundary but no error boundary, so a throw in
    // PublicCatalogPage's useRef initializers (readPortalCache,
    // readStoredCatalogPageSize) took the whole storefront to a blank page.
    //
    // Discriminating because the blocker below THROWS rather than returning
    // null: an implementation that only handles "storage returns null" passes a
    // null-stub test and still dies here, which is exactly what shipped.
    await blockSiteData(context)
    const health = collectPageHealth(page)

    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await storefrontSectionTab(page, STOREFRONT_KM_LABELS, 'products').click()

    await expect(page.locator(storefrontCards).first()).toBeVisible()
    await expect(page.locator(storefrontCards)).toHaveCount(50)

    // Prove the blocker was actually armed. Without this the test would still
    // pass if addInitScript silently failed to install, and would then be
    // asserting nothing at all.
    const storageThrew = await page.evaluate(() => {
      try {
        void window.localStorage
        return false
      } catch {
        return true
      }
    })
    expect(storageThrew, 'the site-data blocker must actually be armed').toBe(true)

    expectNoRuntimeErrors(health)
  })

  test('shows its cached shell offline instead of a white screen', async ({ page, context, browserName }) => {
    // CATCHES: an offline load that renders nothing. The service worker
    // precaches the app shell (public-runtime/service-worker.ts); if that
    // registration or its cache-first navigation handler regresses, a shopper
    // who opens the tab on a dead connection gets a white screen rather than
    // the shell.
    //
    // MEASURED LIMITATION, not a guess: on this Playwright/WebKit build
    // `page.reload()` while context.setOffline(true) fails with "WebKit
    // encountered an internal error" before the page is even asked to render,
    // so the offline RELOAD half cannot run there. ios-webkit therefore asserts
    // the part that is observable -- the storefront boots and stays error-free
    // -- and the cached-shell contract is proven on the Chromium projects.
    test.skip(browserName === 'webkit', 'WebKit cannot reload under Playwright offline emulation')
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await expect(storefrontSectionTab(page, STOREFRONT_KM_LABELS, 'products')).toBeVisible()

    if (browserName === 'chromium') {
      // index.tsx registers on the idle callback after `load`, so wait for a
      // real ACTIVE worker rather than for a fixed delay.
      //
      // expect.poll, not page.waitForFunction: a waitForFunction predicate that
      // has to `await` inside the page returns a pending Promise, which is
      // truthy, so the wait passes on its first poll and proves nothing. That
      // was measured in this suite, not assumed.
      await expect.poll(
        () => page.evaluate(async () => {
          const registration = await navigator.serviceWorker?.getRegistration?.('/')
          return registration?.active?.state ?? 'none'
        }),
        { message: 'the storefront service worker must be active', timeout: 20_000 },
      ).toBe('activated')
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        // Wait until the shell is actually in a cache; asserting offline
        // behaviour before the precache finishes would be a race, not a test.
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const keys = await caches.keys()
          if (keys.some((key) => key.startsWith('business-os-app-shell-'))) return
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        throw new Error(`app shell was never precached (registration scope ${registration.scope})`)
      })
    }

    await context.setOffline(true)
    try {
      await page.reload({ waitUntil: 'load' })
      // The shell, from cache. Its brand text is rendered by index.html before
      // any script runs, so this proves a real document came back rather than
      // the browser's own network-error page.
      await expect(page.locator('#root'), JSON.stringify(health)).not.toBeEmpty()
      await expect(page.locator('body')).toContainText('Leang Beauty')
    } finally {
      await context.setOffline(false)
    }

    expectNoRuntimeErrors(health)
  })
})

/**
 * P2 (PUBLIC-PAINT-FINAL section 5): the storefront never paints a default or
 * an old look. Service workers are blocked so page.route sees every request,
 * the document included.
 */
const POSTER = readFileSync(new URL('./fixtures/about-poster.png', import.meta.url))
const PAINT_EMBED = JSON.parse(readFileSync(new URL('./fixtures/portal-paint-embed.json', import.meta.url), 'utf8')) as { kind: string; v: number; config: Record<string, unknown> }
const REAL_SHOP = {
  businessName: 'Fixture Real Shop',
  businessLegalName: 'Fixture Real Shop Co., Ltd.',
  title: 'Fixture Real Shop',
  heroGradientStart: '#3b0764',
  heroGradientMid: '#155e75',
  heroGradientEnd: '#a16207',
  aboutContent: 'A real About story from the fixture config.',
  businessCover: '/uploads/real-cover-e2e.png',
}
const OLD_DEFAULT_TEXT = ['Leang Beauty', 'Welcome to our store.']
const OLD_DEFAULT_COLOURS = ['#0f172a', '#14532d', '#ea580c', 'rgb(15, 23, 42)', 'rgb(20, 83, 45)', 'rgb(234, 88, 12)']
const FAILURE_EN = "We couldn't open the shop. Check your connection and try again."
const FAILURE_KM = 'យើងមិនអាចបើកហាងបានទេ។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត ហើយព្យាយាមម្ដងទៀត។'
const LOADING_KM = 'កំពុងផ្ទុកគេហទំព័រ...'
const RAW_FAILURE_TEXT = /Portal (bootstrap|config)|failed: \d{3}|\b5\d\d\b/

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type ConfigRouteOptions = { patch?: Record<string, unknown>; delayMs?: number; gate?: Promise<void>; status?: number }

async function routeStorefrontConfig(page: Page, options: ConfigRouteOptions = {}): Promise<{ configRequests: () => number }> {
  let configRequests = 0
  for (const endpoint of ['**/api/portal/bootstrap', '**/api/portal/config']) {
    await page.route(endpoint, async (route) => {
      if (endpoint.endsWith('/config')) configRequests += 1
      if (options.gate) await options.gate
      if (options.delayMs) await pause(options.delayMs)
      if (options.status) return route.fulfill({ status: options.status, json: { error: 'fixture outage' } })
      const response = await route.fetch()
      const body = await response.json() as { config?: Record<string, unknown> } & Record<string, unknown>
      const patch = options.patch || {}
      await route.fulfill({ response, json: body.config ? { ...body, config: { ...body.config, ...patch } } : { ...body, ...patch } })
    })
  }
  await page.route('**/uploads/*-e2e.png', (route) => route.fulfill({ body: POSTER, contentType: 'image/png' }))
  return { configRequests: () => configRequests }
}

function serializeEmbed(embed: unknown): string {
  return JSON.stringify(embed)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

async function injectPaintEmbed(page: Page, embed: unknown): Promise<void> {
  await page.route(`${STOREFRONT_ORIGIN}/`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const response = await route.fetch()
    const html = await response.text()
    const headers = { ...response.headers() }
    delete headers['content-length']
    await route.fulfill({
      status: response.status(),
      headers,
      body: html.replace('<head>', `<head><script type="application/json" id="business-os-portal-paint">${serializeEmbed(embed)}</script>`),
    })
  })
}

/** Records, from before first paint, every old-default text, initials or colour the React tree ever shows. */
async function watchForOldDefaults(page: Page): Promise<void> {
  await page.addInitScript(({ texts, colours }) => {
    const seen: string[] = []
    const state = { seen, sawSkeleton: false }
    ;(window as unknown as { __p2Defaults: typeof state }).__p2Defaults = state
    const inShell = (node: Node | null) => Boolean((node instanceof Element ? node : node?.parentElement)?.closest('.business-os-initial-shell'))
    const scan = () => {
      const root = document.getElementById('root')
      if (!root) return
      if (root.querySelector('[data-portal-skeleton="true"]')) state.sawSkeleton = true
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (inShell(node)) continue
        const text = String(node.textContent || '').trim()
        if (text === 'LE' || texts.some((old) => text.includes(old))) seen.push(text)
      }
      for (const element of Array.from(root.querySelectorAll('[style]'))) {
        if (inShell(element)) continue
        const style = String(element.getAttribute('style') || '').toLowerCase()
        for (const colour of colours) if (style.includes(colour)) seen.push(`style ${colour}`)
      }
      if (seen.length > 50) seen.length = 50
    }
    new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] })
  }, { texts: OLD_DEFAULT_TEXT, colours: OLD_DEFAULT_COLOURS })
}

/** Records every src the About cover image ever had, and any price text that ever reached the page. */
async function watchCoverAndPrices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { coverSrcs: [] as string[], prices: [] as string[] }
    ;(window as unknown as { __p2Paint: typeof state }).__p2Paint = state
    const PRICE = /\$\s?\d|\d[\d,]*\s?៛/
    const scan = () => {
      for (const img of Array.from(document.querySelectorAll('img[aria-hidden="true"][alt=""].object-cover'))) {
        const src = img.getAttribute('src') || ''
        if (src && state.coverSrcs[state.coverSrcs.length - 1] !== src) state.coverSrcs.push(src)
      }
      const root = document.getElementById('root')
      if (!root) return
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const text = String(walker.currentNode.textContent || '')
        if (PRICE.test(text) && state.prices.length < 20) state.prices.push(text.trim())
      }
    }
    new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] })
  })
}

test.describe('P2 first paint: no default look, no saved copy, bounded failure', () => {
  test.use({ serviceWorkers: 'block' })

  test('P2-1 with no embed and the API slow, the old default name, initials, story and colours never paint', async ({ page, context }) => {
    // CATCHES: painting DEFAULT_PUBLIC_CONFIG ("Leang Beauty", "LE", the
    // navy/green/orange hero, "Welcome to our store.") while the config is on
    // its way. The real config here differs from every one of those values, so
    // any sighting is the default, never the shop.
    await seedStorefrontLanguage(context, STOREFRONT_ORIGIN, 'en')
    await watchForOldDefaults(page)
    await routeStorefrontConfig(page, { patch: REAL_SHOP, delayMs: 2_000 })
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })

    await expect(page.getByRole('heading', { level: 2, name: REAL_SHOP.businessName })).toBeVisible({ timeout: 20_000 })
    const watched = await page.evaluate(() => (window as unknown as { __p2Defaults: { seen: string[]; sawSkeleton: boolean } }).__p2Defaults)
    expect(watched.seen, 'old default look on screen').toEqual([])
    expect(watched.sawSkeleton, 'the neutral skeleton held the space while the config was on its way').toBe(true)
    expectNoRuntimeErrors(health)
  })

  test('P2-2 with the paint embed, the first cover and name are the real ones and never change', async ({ page }) => {
    // CATCHES: ignoring the embed (the page paints defaults, then the real
    // look), reading the retired full-bootstrap id, or decorating the cover
    // URL (?v=) so the hero requests something the Worker never preloaded.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const cover = String(PAINT_EMBED.config.businessCover)
    await watchCoverAndPrices(page)
    await injectPaintEmbed(page, PAINT_EMBED)
    const { configRequests } = await routeStorefrontConfig(page, { patch: PAINT_EMBED.config, gate })
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })

    await expect(page.getByRole('heading', { level: 2, name: String(PAINT_EMBED.config.businessName) }), 'painted from the embed while the bootstrap is held').toBeVisible()
    await expect(page.locator('img[aria-hidden="true"][alt=""].object-cover').first()).toHaveAttribute('src', cover)
    release()
    await expect(page.locator('[data-portal-skeleton]')).toHaveCount(0)
    await storefrontSectionTab(page, STOREFRONT_KM_LABELS, 'products').click()
    await expect(page.locator(storefrontCards).first()).toBeVisible()

    const painted = await page.evaluate(() => (window as unknown as { __p2Paint: { coverSrcs: string[] } }).__p2Paint.coverSrcs)
    expect(painted, 'the hero cover src from first paint to settled').toEqual([cover])
    expect(configRequests(), 'with a real config embedded, /api/portal/config is never fetched').toBe(0)
    expectNoRuntimeErrors(health)
  })

  test('P2-3 layout shift from navigation to settled stays under 0.05 on a phone', async ({ page }, testInfo) => {
    // CATCHES: a skeleton that does not hold the hero's box, a header name
    // that arrives on a second line, or a footer that pushes content up.
    test.skip(testInfo.project.name !== 'android-chromium', 'layout-shift entries are Chromium-only; the budget is set for the phone')
    await page.addInitScript(() => {
      const state = { cls: 0 }
      ;(window as unknown as { __p2Cls: typeof state }).__p2Cls = state
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) state.cls += entry.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
    })
    await routeStorefrontConfig(page, { patch: REAL_SHOP, delayMs: 800 })
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.getByRole('heading', { level: 2, name: REAL_SHOP.businessName })).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => page.locator('img[aria-hidden="true"][alt=""].object-cover').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    await pause(500)
    const cls = await page.evaluate(() => (window as unknown as { __p2Cls: { cls: number } }).__p2Cls.cls)
    testInfo.annotations.push({ type: 'cls', description: cls.toFixed(4) })
    expect(cls).toBeLessThan(0.05)
  })

  test('P2-4 an old saved copy is never painted, never requested, and removed; the shopper list is untouched', async ({ page, context, browser }) => {
    // CATCHES: seeding the page from the retired saved copy (the old cover
    // flashes and is fetched) or clearing more than the retired key.
    const bootstrap = await fetchBootstrapPayload(browser, STOREFRONT_ORIGIN)
    const oldCover = '/uploads/old-cover-e2e.png'
    await seedStorefrontCache(context, STOREFRONT_ORIGIN, {
      config: { ...(bootstrap.config as Record<string, unknown>), businessName: 'Old Cached Shop', businessCover: oldCover, showCover: true },
      products: bootstrap.products,
      catalog: bootstrap.catalog,
    })
    const shopperList = JSON.stringify([{ id: 7, name: 'Seeded list item', category: '', brand: '', qty: 2 }])
    await context.addInitScript(({ value, target }) => {
      if (window.location.origin !== target) return
      try { window.localStorage.setItem('business-os-portal-bucket-v1', value) } catch { /* blocked storage */ }
    }, { value: shopperList, target: STOREFRONT_ORIGIN })
    await routeStorefrontConfig(page, { patch: REAL_SHOP, delayMs: 1_000 })
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })

    await expect(page.getByRole('heading', { level: 2, name: REAL_SHOP.businessName })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Old Cached Shop')).toHaveCount(0)
    expect(health.requests.filter((url) => url.includes(oldCover)), 'the old cover is never requested').toEqual([])
    const stored = await page.evaluate((key) => ({
      local: window.localStorage.getItem(key),
      session: window.sessionStorage.getItem(key),
      list: window.localStorage.getItem('business-os-portal-bucket-v1'),
    }), PORTAL_CACHE_KEY)
    expect(stored.local, 'localStorage copy removed').toBeNull()
    expect(stored.session, 'sessionStorage copy removed').toBeNull()
    expect(JSON.parse(String(stored.list)).map((item: { id: number; qty: number }) => [item.id, item.qty])).toEqual([[7, 2]])
    expectNoRuntimeErrors(health)
  })

  test('P2-5 when the shop cannot load, every tab shows the translated failure and Retry, never raw error text; Retry recovers', async ({ page, context }) => {
    // CATCHES: a skeleton that never ends, the default look left on screen
    // (the About tab had no error surface), or "Portal bootstrap failed: 500".
    await seedStorefrontLanguage(context, STOREFRONT_ORIGIN, 'en')
    await routeStorefrontConfig(page, { status: 500 })
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })

    const failure = page.locator('[data-portal-load-failed="true"]')
    await expect(failure).toContainText(FAILURE_EN, { timeout: 20_000 })
    await expect(failure.getByRole('button', { name: 'Retry' })).toBeVisible()
    await storefrontSectionTab(page, STOREFRONT_EN_LABELS, 'products').click()
    await expect(failure).toContainText(FAILURE_EN)
    await page.getByRole('navigation', { name: STOREFRONT_EN_LABELS.sectionNavigation }).getByRole('button', { name: 'FAQ' }).click()
    await expect(failure).toContainText(FAILURE_EN)
    expect(await page.locator('#root').innerText()).not.toMatch(RAW_FAILURE_TEXT)

    await page.unrouteAll({ behavior: 'wait' })
    await failure.getByRole('button', { name: 'Retry' }).click()
    await expect(failure).toHaveCount(0)
    await storefrontSectionTab(page, STOREFRONT_EN_LABELS, 'products').click()
    await expect(page.locator(storefrontCards).first()).toBeVisible()
    expectNoRuntimeErrors(health)
  })

  test('P2-6 a Khmer shopper gets the skeleton label and the failure text in Khmer', async ({ page }) => {
    // CATCHES: English-only loading or failure copy (a first visit opens in Khmer).
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    await routeStorefrontConfig(page, { gate, status: 500 })
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator('[data-portal-skeleton="true"]').first()).toContainText(LOADING_KM)
    release()
    const failure = page.locator('[data-portal-load-failed="true"]')
    await expect(failure).toContainText(FAILURE_KM, { timeout: 20_000 })
    await expect(failure.getByRole('button', { name: 'ព្យាយាមម្ដងទៀត' })).toBeVisible()
  })

  test('P2-7 hidden prices never reach the page, whatever an old saved copy or the embed claims', async ({ page, context, browser }) => {
    // CATCHES: painting cached products (priced, from an old saved copy) before
    // the real config says prices are hidden, or trusting showPrices in the
    // embed (it is not on the paint allow-list).
    const bootstrap = await fetchBootstrapPayload(browser, STOREFRONT_ORIGIN)
    await seedStorefrontCache(context, STOREFRONT_ORIGIN, {
      config: { ...(bootstrap.config as Record<string, unknown>), showPrices: true, showAbout: false },
      products: bootstrap.products,
      catalog: bootstrap.catalog,
    })
    await watchCoverAndPrices(page)
    await injectPaintEmbed(page, { ...PAINT_EMBED, config: { ...PAINT_EMBED.config, showAbout: false, showPrices: true } })
    await routeStorefrontConfig(page, { patch: { showPrices: false, showAbout: false }, delayMs: 1_500 })
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })

    await expect(page.locator(storefrontCards).first()).toBeVisible({ timeout: 20_000 })
    const prices = await page.evaluate(() => (window as unknown as { __p2Paint: { prices: string[] } }).__p2Paint.prices)
    expect(prices, 'price text that reached the page').toEqual([])
    expectNoRuntimeErrors(health)
  })
})
