import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_EN_LABELS, STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage, storefrontCards, storefrontSectionTab } from './support/harness'
import { stubStorefrontConfig } from './support/storefrontStub'

/**
 * storefront-products-grid.spec.ts -- the Products page (owner ask, 2 Nov 2026).
 *
 *  - The grid follows the screen: 2 on phones, 3 on tablets, 4 at 1024 px, 5 at 1280 px, 6 at 1536 px.
 *    "Automatic columns" is the default; a shop that turned it off keeps its fixed counts.
 *  - The search and Filters join the section tabs: on the tab row from 1024 px, directly under the tabs below
 *    it, with no gap. The tab bar (and so the search) stays pinned while the products scroll.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-products-grid
 *
 * Each test names the wrong implementation it catches.
 */

test.use({ serviceWorkers: 'block' })

const COLUMNS_BY_WIDTH: ReadonlyArray<readonly [width: number, columns: number]> = [
  [360, 2], [390, 2], [639, 2], [640, 3], [768, 3], [1023, 3], [1024, 4], [1279, 4], [1280, 5], [1535, 5], [1536, 6], [1920, 6],
]

async function openProducts(page: Page, width: number, patch: Record<string, unknown> = {}): Promise<void> {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 })
  await seedStorefrontLanguage(page.context(), STOREFRONT_ORIGIN, 'en')
  await stubStorefrontConfig(page, patch)
  await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
  await storefrontSectionTab(page, STOREFRONT_EN_LABELS, 'products').click()
  await expect(page.locator(storefrontCards).first()).toBeVisible()
}

const grid = (page: Page) => page.locator(storefrontCards).first().locator('xpath=..')
const columnCount = (page: Page): Promise<number> => grid(page).evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)

test.describe('Products grid', () => {
  for (const [width, columns] of COLUMNS_BY_WIDTH) {
    test(`${width}px shows ${columns} per row, readable cards, no horizontal scroll`, async ({ page }) => {
      // CATCHES: the old fixed counts (2 on a tablet, 2 at 1024 px, 4 on a large screen), a stored "2 desktop
      // columns" that the automatic scale would have to ignore, and cards squeezed too narrow to read.
      const health = collectPageHealth(page)
      await openProducts(page, width, { gridColumnsDesktop: 2, gridColumnsMobile: 1 })
      expect(await columnCount(page)).toBe(columns)
      const card = await page.locator(storefrontCards).first().evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { width: rect.width, right: rect.right }
      })
      expect(card.width, 'a card stays as wide as the old 2-column phone card (about 142 px at 360)').toBeGreaterThanOrEqual(140)
      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client)
      expectNoRuntimeErrors(health)
    })
  }

  test('with "Automatic columns" off the fixed counts the shop chose still apply', async ({ page }) => {
    // CATCHES: dropping the Website Editor's column settings: turned off, 3 desktop columns means 3 on a large
    // screen (and 2 at 1100 px), exactly as before.
    await openProducts(page, 1600, { gridColumnsAuto: false, gridColumnsDesktop: 3, gridColumnsMobile: 2 })
    expect(await columnCount(page)).toBe(3)
    await page.setViewportSize({ width: 1100, height: 900 })
    await expect.poll(() => columnCount(page)).toBe(2)
  })
})

test.describe('Search joined to the section tabs', () => {
  const nav = (page: Page) => page.getByRole('navigation', { name: STOREFRONT_EN_LABELS.sectionNavigation })

  for (const width of [390, 768, 1024, 1280, 1600] as const) {
    test(`at ${width}px the search is part of the tab bar, with no gap`, async ({ page }) => {
      // CATCHES: the old floating search card under the tabs (its own bordered, shadowed box with a gap above it),
      // a search that landed beside the tabs on a phone, and a search under the tabs on a desktop.
      await openProducts(page, width)
      const search = page.locator('#portal-product-search')
      await expect(search).toBeVisible()
      await expect(nav(page).locator('#portal-product-search'), 'the search lives inside the tab bar').toHaveCount(1)
      await expect(nav(page).getByRole('button', { name: 'Filters' }), 'Filters stays, with the search').toBeVisible()

      const tabs = await nav(page).getByRole('button', { name: STOREFRONT_EN_LABELS.products, exact: true }).boundingBox()
      const field = await search.locator('xpath=ancestor::label').boundingBox()
      const bar = await nav(page).boundingBox()
      expect(tabs && field && bar).toBeTruthy()
      if (width >= 1024) {
        expect(Math.abs((tabs!.y + tabs!.height / 2) - (field!.y + field!.height / 2)), 'one row: the search is level with the tabs').toBeLessThanOrEqual(10)
        expect(field!.x, 'on the right of the tabs').toBeGreaterThan(tabs!.x + tabs!.width)
        expect(bar!.height, 'one row tall').toBeLessThanOrEqual(120)
      } else {
        expect(field!.y - (tabs!.y + tabs!.height), 'directly under the tabs').toBeLessThanOrEqual(20)
        expect(field!.y, 'under, not beside').toBeGreaterThan(tabs!.y + tabs!.height - 4)
      }
      expect(field!.y + field!.height, 'inside the bar').toBeLessThanOrEqual(bar!.y + bar!.height + 1)
      expect(await page.locator('div.sticky.top-16').count(), 'no second floating card under the tabs').toBe(0)
    })
  }

  test('the tab bar with the search stays pinned while the products scroll', async ({ page }) => {
    // CATCHES: a docked search that scrolls away with the page (the card used to be sticky on its own).
    await openProducts(page, 1280)
    await page.mouse.wheel(0, 1600)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
    const bar = await nav(page).boundingBox()
    expect(bar!.y).toBeLessThanOrEqual(12)
    await expect(page.locator('#portal-product-search')).toBeInViewport()
  })

  test('typing in the docked search narrows the products; clearing restores them', async ({ page }) => {
    // CATCHES: the search drawn in the tab bar but not wired to the products (state or handlers lost in the move).
    await openProducts(page, 1280)
    const all = await page.locator(storefrontCards).count()
    await page.locator('#portal-product-search').fill('Glowary')
    await expect.poll(() => page.locator(storefrontCards).count()).toBeLessThan(all)
    await page.locator('[data-search-clear="true"]').click()
    await expect.poll(() => page.locator(storefrontCards).count()).toBe(all)
  })

  test('the desktop Filters panel floats under the bar and does not push the products down', async ({ page }) => {
    // CATCHES: the panel growing the pinned tab bar (the whole page shifts when Filters opens).
    await openProducts(page, 1280)
    const before = await grid(page).boundingBox()
    await page.getByRole('button', { name: 'Filters' }).click()
    const panel = page.locator('#portal-desktop-filters')
    await expect(panel).toBeVisible()
    const after = await grid(page).boundingBox()
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1)
    const panelBox = await panel.boundingBox()
    const barBox = await nav(page).boundingBox()
    expect(panelBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height - 2)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(1280)
  })

  test('on a phone Filters opens its own layer from the docked bar', async ({ page }) => {
    // CATCHES: the phone Filters menu losing its trigger when the controls move into the tab bar.
    await openProducts(page, 390)
    await page.getByRole('button', { name: 'Filters' }).click()
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible()
  })
})
