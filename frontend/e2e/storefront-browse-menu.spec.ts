import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  STOREFRONT_EN_LABELS,
  STOREFRONT_KM_LABELS,
  STOREFRONT_ORIGIN,
  collectPageHealth,
  expectNoRuntimeErrors,
  seedStorefrontLanguage,
  storefrontCards,
  storefrontSectionTab,
} from './support/harness'

/**
 * storefront-browse-menu.spec.ts -- View + Sort live in the storefront's filter
 * menu (PUBLIC-FILTER-MENU, owner 5 Oct: "put view + sort in the filter menu;
 * default by brand, user can switch (select/deselect)").
 *
 * WHAT THIS PROVES
 *  - The menu shows View and Sort with every option on its FIRST open, brand and
 *    Featured chosen -- at 360 px (the body-portalled layer) and at 1280 px (the
 *    slim panel), in English and in Khmer.
 *  - Each change is exactly ONE search request carrying `view` / `sort`, and the
 *    default asks for neither.
 *  - The grid regroups to match (brand headers, then category headers, then none)
 *    and never prints the same header twice on a page, which is the defect of
 *    re-sorting the server's brand-first page A-Z by name on the client.
 *  - Tapping the chosen non-default chip again deselects back to brand.
 *  - A hand-edited URL falls back to the defaults; a shared link opens on its view.
 *
 * SHOTS: set BROWSE_SHOTS_DIR to also write screenshots there.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-browse-menu
 */

const SEARCH_PATH = '/api/portal/catalog/products/search'
const GROUP_HEADERS = 'div.col-span-full > h3'
const SIZES = [
  { name: '360', width: 360, height: 780 },
  { name: '1280', width: 1280, height: 800 },
] as const

// 137 fixture products at 50 a page, 27-28 per category: page 1 is all of Body care and part of Fragrance.
const CATEGORY_HEADERS_PAGE_1 = ['Body care', 'Fragrance']

const EN = { view: 'View', sort: 'Sort', brand: 'Brand', category: 'Category', all: 'All products', featured: 'Featured', nameAsc: 'A-Z', nameDesc: 'Z-A', low: 'Low price', high: 'High price', filters: 'Filters' } as const
const KM = { view: 'មើលតាម', sort: 'តម្រៀប', brand: 'ម៉ាក', category: 'ប្រភេទ', all: 'ផលិតផលទាំងអស់', featured: 'ពិសេស', nameAsc: 'ឈ្មោះ A-Z', nameDesc: 'ឈ្មោះ Z-A', low: 'តម្លៃទាប', high: 'តម្លៃខ្ពស់', filters: 'តម្រង' } as const

function searchRequests(page: Page): URL[] {
  const seen: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === SEARCH_PATH) seen.push(url)
  })
  return seen
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.BROWSE_SHOTS_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, `${name}.png`) })
}

async function openProducts(page: Page, labels: typeof STOREFRONT_EN_LABELS | typeof STOREFRONT_KM_LABELS, url = `${STOREFRONT_ORIGIN}/`): Promise<void> {
  await page.goto(url, { waitUntil: 'load' })
  await storefrontSectionTab(page, labels as typeof STOREFRONT_EN_LABELS, 'products').click()
  await expect(page.locator(storefrontCards).first()).toBeVisible()
}

/** The Filters control that is on screen at this width (a layer below lg, a panel from lg). */
async function openFilters(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole('button', { name: label }).locator('visible=true').first()
  await trigger.click()
}

// textContent, not innerText: the headers are CSS-uppercased, innerText would return the shouting version.
const headers = async (page: Page): Promise<string[]> => (await page.locator(GROUP_HEADERS).allTextContents()).map((text) => text.trim())

for (const size of SIZES) {
  test.describe(`storefront browse menu at ${size.name}px`, () => {
    test.beforeEach(async ({ page, context }) => {
      await seedStorefrontLanguage(context, STOREFRONT_ORIGIN, 'en')
      await page.setViewportSize({ width: size.width, height: size.height })
    })

    test('View and Sort are in the menu from the first open, brand and Featured chosen', async ({ page }) => {
      // CATCHES: the options living anywhere but the filter menu, a menu that opens
      // as a stub and fills in later, or a default other than brand / Featured.
      const health = collectPageHealth(page)
      await openProducts(page, STOREFRONT_EN_LABELS)
      await openFilters(page, EN.filters)

      const viewGroup = page.getByRole('group', { name: EN.view })
      const sortGroup = page.getByRole('group', { name: EN.sort })
      await expect(viewGroup.getByRole('button')).toHaveCount(3)
      await expect(sortGroup.getByRole('button')).toHaveCount(5)
      await expect(viewGroup.getByRole('button', { name: EN.brand })).toHaveAttribute('aria-pressed', 'true')
      await expect(viewGroup.getByRole('button', { name: EN.category })).toHaveAttribute('aria-pressed', 'false')
      await expect(sortGroup.getByRole('button', { name: EN.featured })).toHaveAttribute('aria-pressed', 'true')
      // Icon-first chips with a tooltip, so a shopper can hover for the full phrase.
      await expect(viewGroup.getByRole('button', { name: EN.brand })).toHaveAttribute('title', 'Group by brand')
      await expect(sortGroup.getByRole('button', { name: EN.low })).toBeVisible()
      await shot(page, `en-${size.name}-menu-default`)
      expectNoRuntimeErrors(health)
    })

    test('the default groups by brand with each brand once, and asks for no view or sort', async ({ page }) => {
      // CATCHES: the client re-sorting the server's brand-first page A-Z by name,
      // which scattered one brand across the page and printed its header again.
      const requests = searchRequests(page)
      await openProducts(page, STOREFRONT_EN_LABELS)
      const printed = await headers(page)
      expect(printed.length).toBe(4) // Aurelia 16 + Belle Roux 16 + Céleste 15 + 3 of Dermalux
      expect(new Set(printed).size, `a brand header repeated: ${printed.join(', ')}`).toBe(printed.length)
      expect(printed[0]).toBe('Aurelia')
      expect([...printed]).toEqual([...printed].sort((a, b) => a.localeCompare(b)))
      for (const url of requests) {
        expect(url.searchParams.has('view'), url.search).toBe(false)
        expect(url.searchParams.has('sort'), url.search).toBe(false)
      }
    })

    test('switching View is one request, regroups the grid and keeps the URL shareable; the chosen chip deselects', async ({ page }) => {
      // CATCHES: a change that re-requests twice (page reset racing the search), a
      // view that changes the chips but not the grid, a URL that is not updated, and
      // a "deselect" that leaves nothing chosen.
      const health = collectPageHealth(page)
      const requests = searchRequests(page)
      await openProducts(page, STOREFRONT_EN_LABELS)
      await openFilters(page, EN.filters)
      const viewGroup = page.getByRole('group', { name: EN.view })
      const before = requests.length

      await viewGroup.getByRole('button', { name: EN.category }).click()
      await expect.poll(() => requests.length).toBe(before + 1)
      expect(requests[before].searchParams.get('view')).toBe('category')
      await expect.poll(() => headers(page)).toEqual(CATEGORY_HEADERS_PAGE_1)
      await expect(page).toHaveURL(/[?&]view=category/)
      await expect(viewGroup.getByRole('button', { name: EN.category })).toHaveAttribute('aria-pressed', 'true')
      await shot(page, `en-${size.name}-view-category`)

      await viewGroup.getByRole('button', { name: EN.all }).click()
      await expect.poll(() => requests.length).toBe(before + 2)
      expect(requests[before + 1].searchParams.get('view')).toBe('all')
      await expect.poll(() => headers(page)).toEqual([])
      await expect(page.locator(storefrontCards)).toHaveCount(50)
      await shot(page, `en-${size.name}-view-all`)

      // Select the chosen chip again: back to the default brand view, URL clean.
      await viewGroup.getByRole('button', { name: EN.all }).click()
      await expect.poll(() => requests.length).toBe(before + 3)
      expect(requests[before + 2].searchParams.has('view')).toBe(false)
      await expect(viewGroup.getByRole('button', { name: EN.brand })).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => headers(page).then((list) => list[0])).toBe('Aurelia')
      await expect(page).not.toHaveURL(/view=/)
      expectNoRuntimeErrors(health)
    })

    test('a price sort orders the page and is one request', async ({ page }) => {
      // CATCHES: a sort that is sent but not applied (order unchanged), and one that
      // groups under a view it should not (the headers must stay brand headers).
      const requests = searchRequests(page)
      await openProducts(page, STOREFRONT_EN_LABELS)
      await openFilters(page, EN.filters)
      const viewGroup = page.getByRole('group', { name: EN.view })
      const sortGroup = page.getByRole('group', { name: EN.sort })
      await viewGroup.getByRole('button', { name: EN.all }).click()
      const before = requests.length
      const response = page.waitForResponse((reply) => new URL(reply.url()).pathname === SEARCH_PATH && new URL(reply.url()).searchParams.get('sort') === 'price_asc')
      await sortGroup.getByRole('button', { name: EN.low }).click()
      const body = await (await response).json() as { items: Array<{ selling_price_usd: number }>; browse: { view: string; sort: string } }
      expect(requests.length).toBe(before + 1)
      expect(body.browse).toEqual({ view: 'all', sort: 'price_asc' })
      const prices = body.items.map((item) => Number(item.selling_price_usd))
      expect(prices).toEqual([...prices].sort((a, b) => a - b))
      expect(prices[0]).toBeLessThan(prices[prices.length - 1])
      await expect(page).toHaveURL(/view=all/)
      await expect(page).toHaveURL(/sort=price_asc/)
      await shot(page, `en-${size.name}-sort-price`)
    })

    test('a hand-edited URL falls back to the defaults; a shared link opens on its view', async ({ page }) => {
      // CATCHES: junk reaching the request, and a shared link that paints the
      // brand-ordered bootstrap before correcting itself.
      const requests = searchRequests(page)
      await openProducts(page, STOREFRONT_EN_LABELS, `${STOREFRONT_ORIGIN}/?view=bogus&sort=name%3B%20DROP%20TABLE%20products`)
      await openFilters(page, EN.filters)
      await expect(page.getByRole('group', { name: EN.view }).getByRole('button', { name: EN.brand })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('group', { name: EN.sort }).getByRole('button', { name: EN.featured })).toHaveAttribute('aria-pressed', 'true')
      for (const url of requests) {
        expect(url.searchParams.get('view') || '', url.search).toBe('')
        expect(url.searchParams.get('sort') || '', url.search).toBe('')
      }
      await expect(page).not.toHaveURL(/bogus/)

      await openProducts(page, STOREFRONT_EN_LABELS, `${STOREFRONT_ORIGIN}/?view=category&sort=name_desc`)
      await expect.poll(() => headers(page)).toEqual(CATEGORY_HEADERS_PAGE_1)
      await openFilters(page, EN.filters)
      await expect(page.getByRole('group', { name: EN.view }).getByRole('button', { name: EN.category })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('group', { name: EN.sort }).getByRole('button', { name: EN.nameDesc })).toHaveAttribute('aria-pressed', 'true')
    })
  })

  test.describe(`storefront browse menu in Khmer at ${size.name}px`, () => {
    test.beforeEach(async ({ page, context }) => {
      await seedStorefrontLanguage(context, STOREFRONT_ORIGIN, 'km')
      await page.setViewportSize({ width: size.width, height: size.height })
    })

    test('the menu reads in Khmer with no English left over', async ({ page }) => {
      // CATCHES: a key missing from the Khmer pack (the English fallback shows through).
      const health = collectPageHealth(page)
      await openProducts(page, STOREFRONT_KM_LABELS)
      await openFilters(page, KM.filters)
      const viewGroup = page.getByRole('group', { name: KM.view })
      const sortGroup = page.getByRole('group', { name: KM.sort })
      await expect(viewGroup.getByRole('button')).toHaveCount(3)
      await expect(sortGroup.getByRole('button')).toHaveCount(5)
      for (const label of [KM.brand, KM.category, KM.all]) await expect(viewGroup.getByRole('button', { name: label })).toBeVisible()
      for (const label of [KM.featured, KM.nameAsc, KM.nameDesc, KM.low, KM.high]) await expect(sortGroup.getByRole('button', { name: label })).toBeVisible()
      const text = await page.locator('[role="group"]').allInnerTexts()
      expect(text.join(' ')).not.toMatch(/\b(View|Sort|Featured|Low price|High price|Group by)\b/)
      await shot(page, `km-${size.name}-menu-default`)
      await viewGroup.getByRole('button', { name: KM.category }).click()
      await expect.poll(() => headers(page).then((list) => list.length)).toBeGreaterThan(1)
      await shot(page, `km-${size.name}-view-category`)
      expectNoRuntimeErrors(health)
    })
  })
}
