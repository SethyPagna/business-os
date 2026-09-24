import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  PAGE_SIZE_STORAGE_KEY,
  STOREFRONT_ORIGIN,
  collectPageHealth,
  expectNoRuntimeErrors,
  fetchBootstrapPayload,
  productSkeletons,
  seedStorefrontCache,
  seedViewerPageSize,
  storefrontCards,
} from './support/harness'

/**
 * storefront-pager.spec.ts -- the shopper-facing pager, and the over-fill glitch.
 *
 * WHAT THIS PROVES
 *  - The grid never shows more cards than the chosen page size, at any instant
 *    -- not merely once it has settled.
 *  - A RETURNING shopper (a stored 20/50/100 choice plus a cached bootstrap cut
 *    at the store's own size) sees their own page size honoured, although the
 *    pager no longer offers a size chooser (P10-20, 2026-09-17).
 *  - The page counts are exact: 137 fixture products means 7 pages at 20, 3 at
 *    50, 2 at 100, and every product name is unique so one row is one card.
 *
 * ERROR CLASS GUARDED: a1d55f12 -- the over-fill glitch. The grid painted 50
 * cards under a pager reading "1 / 7" and then corrected itself when the sized
 * search landed, so the shopper saw the wrong page for a moment and any
 * after-the-fact assertion saw nothing wrong at all. That is why this file
 * installs a peak-count observer BEFORE first paint.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-pager
 */

const PAGER = 'nav[aria-label="Page"]'

/**
 * Record the HIGHEST number of product cards that was ever in the DOM.
 *
 * A post-hoc `toHaveCount(20)` cannot see the a1d55f12 glitch at all: the grid
 * showed 50 cards under a pager reading "1 / 7" and then CORRECTED itself when
 * the sized search landed, so by the time any assertion ran the count was
 * already right. The observer has to be installed before first paint.
 */
async function watchPeakCardCount(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const state = { peak: 0 }
    ;(window as unknown as { __peakCards: { peak: number } }).__peakCards = state
    const measure = () => {
      const count = document.querySelectorAll('article[data-product-card="true"]').length
      if (count > state.peak) state.peak = count
    }
    const start = () => {
      measure()
      new MutationObserver(measure).observe(document.body, { childList: true, subtree: true })
    }
    if (document.body) start()
    else document.addEventListener('DOMContentLoaded', start, { once: true })
  })
}

function readPeakCardCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __peakCards?: { peak: number } }).__peakCards?.peak ?? -1)
}

/**
 * The RETURNING visitor the glitch needs: a cached bootstrap snapshot that the
 * Worker cut at its own fixed 50 (routes/portal.ts buildPortalCatalog hardcodes
 * page 1 / pageSize 50), plus a stored 20 from an earlier visit.
 *
 * showAbout is turned off in the seeded config so the storefront opens straight
 * on Products -- a real merchant toggle (customer_portal_show_about), and the
 * only way to observe the FIRST paint of the grid rather than a paint that
 * happens a click later, by which time the corrective search has landed.
 */
async function seedReturningShopper(context: BrowserContext, bootstrap: Record<string, unknown>, pageSize: number) {
  const config = { ...(bootstrap.config as Record<string, unknown>), showAbout: false }
  await seedStorefrontCache(context, STOREFRONT_ORIGIN, {
    config,
    products: bootstrap.products,
    catalog: bootstrap.catalog,
    categories: (bootstrap.meta as Record<string, unknown>)?.categories,
    brands: (bootstrap.meta as Record<string, unknown>)?.brands,
    branches: (bootstrap.meta as Record<string, unknown>)?.branches,
  })
  await seedViewerPageSize(context, STOREFRONT_ORIGIN, pageSize)
  // The live bootstrap must agree with the cache about the tab, or the grid
  // would be unmounted again the moment the fetch resolves.
  await context.route('**/api/portal/bootstrap', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.config.showAbout = false
    await route.fulfill({ response, json: body })
  })
}

test.describe('storefront pager', () => {
  test('reads [Back] [page / total] [Next], in that order', async ({ page }) => {
    // CATCHES: the control order regressing back to the admin layout (a
    // "Showing 1-50 of 137" summary on the left, a size selector beside Next)
    // or the per-page chooser coming back -- P10-20 (owner, 2026-09-17: "no
    // need to show rows per page options") removed it from every layout. The
    // assertion walks the rendered children left to right rather than merely
    // checking each control exists somewhere.
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Products', exact: true }).click()
    await expect(page.locator(storefrontCards).first()).toBeVisible()

    const pager = page.locator(PAGER).first()
    const order = await pager.locator('button, input').evaluateAll((nodes) => nodes.map((node) => {
      const label = node.getAttribute('aria-label')
      return label || node.textContent?.trim() || node.nodeName.toLowerCase()
    }))
    expect(order, 'pager control order').toEqual(['Back', 'Page', 'Next'])

    // No size chooser anywhere in the row; the count beside the page box is the
    // total page count at the store's default size of 50.
    await expect(pager.getByRole('button', { name: 'Per page' })).toHaveCount(0)
    await expect(pager.locator('input[aria-label="Page"]')).toHaveValue('1')
    await expect(pager).toContainText('/ 3')

    // The storefront pager must NOT carry the admin "Showing X-Y of N" row.
    await expect(pager).not.toContainText('Showing')

    expectNoRuntimeErrors(health)
  })

  test('a stored page size is still honoured across a reload', async ({ page, context }) => {
    // CATCHES: dropping the chooser (P10-20) also dropping the stored choice,
    // or the storefront reading a different key than the one catalogPagination
    // wrote. Shoppers who picked 20 before the chooser went keep it, so the
    // stored value is seeded and a reload must still land on 20.
    await seedViewerPageSize(context, STOREFRONT_ORIGIN, 20)
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Products', exact: true }).click()

    const pager = page.locator(PAGER).first()
    await expect(page.locator(storefrontCards)).toHaveCount(20)
    await expect(pager).toContainText('/ 7')
    await expect(pager.getByRole('button', { name: 'Per page' })).toHaveCount(0)

    // The exact key, not "some key": a rename would silently orphan every
    // existing shopper's stored choice.
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), PAGE_SIZE_STORAGE_KEY)
    expect(stored).toBe('20')

    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: 'Products', exact: true }).click()
    await expect(page.locator(storefrontCards)).toHaveCount(20)
    await expect(page.locator(PAGER).first()).toContainText('/ 7')

    expectNoRuntimeErrors(health)
  })

  test('never paints more cards than the chosen size (the a1d55f12 over-fill glitch)', async ({ page, context, browser }) => {
    // CATCHES: seeding the grid from a payload cut at a DIFFERENT page size.
    // The bootstrap snapshot is always the store's first 50 families ordered
    // promoted -> brand -> name; a shopper on 20 who is seeded from it sees 50
    // cards under a pager reading "1 / 7" until the corrective search lands.
    // Slicing the first 20 off that payload is the tempting wrong fix and is
    // ALSO caught here, because those 20 are the wrong 20: the browse order is
    // by name, so the server's page 1 at size 20 is a different set. The
    // assertion is therefore both "never more than 20" AND "the 20 that land
    // are the server's page 1".
    const bootstrap = await fetchBootstrapPayload(browser, STOREFRONT_ORIGIN)
    await watchPeakCardCount(context)
    await seedReturningShopper(context, bootstrap, 20)

    // Hold the corrective search open long enough that an over-fill would be
    // on screen for a whole second -- without this the glitch can be too brief
    // for even the observer to be worth trusting.
    await context.route('**/api/portal/catalog/products/search**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      await route.continue()
    })

    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })

    await expect(page.locator(storefrontCards)).toHaveCount(20, { timeout: 20_000 })
    expect(await readPeakCardCount(page), 'most cards ever in the DOM').toBeLessThanOrEqual(20)

    const serverPage = await (await page.request.get(
      `${STOREFRONT_ORIGIN}/api/portal/catalog/products/search?page=1&pageSize=20`,
    )).json()
    const expectedFirst = serverPage.items[0].name
    await expect(page.locator(storefrontCards).first()).toContainText(expectedFirst)

    expectNoRuntimeErrors(health)
  })

  test('holds skeletons until the sized page lands', async ({ page, context, browser }) => {
    // CATCHES: the OTHER half of the same fix. Rather than showing the wrong
    // 50, the grid must show loading skeletons -- and it must show them because
    // it is waiting for a page cut at the viewer's size, not because it is
    // waiting for the network in general. Discriminating input: the bootstrap
    // (50) resolves immediately and the search (20) is held for 1.5s. An
    // implementation that treats "bootstrap arrived" as "done" drops the
    // skeletons in that window; the correct one keeps them.
    const bootstrap = await fetchBootstrapPayload(browser, STOREFRONT_ORIGIN)
    await seedReturningShopper(context, bootstrap, 20)
    await context.route('**/api/portal/catalog/products/search**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.continue()
    })

    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })

    await expect(page.locator(productSkeletons).first()).toBeVisible()
    // ...and no real card beside them while they are up.
    expect(await page.locator(storefrontCards).count()).toBe(0)

    await expect(page.locator(storefrontCards)).toHaveCount(20, { timeout: 20_000 })
    await expect(page.locator(productSkeletons)).toHaveCount(0)

    expectNoRuntimeErrors(health)
  })
})
