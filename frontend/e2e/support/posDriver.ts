import { expect, type Locator, type Page } from '@playwright/test'
import { MONEY_ORIGIN, type Seed, type SeedLot, type SeedProduct } from './moneyFixture'

/**
 * e2e/support/posDriver.ts -- drives the REAL till (components/pos/POS.tsx) the way a cashier does.
 *
 * Every function here is a gesture, not an assertion about money: the till computes, the Worker stores, and the
 * spec compares the stored rows with numbers it derived itself. Selectors are the accessible names and ids the
 * app already exposes; the ones that are structural (a cart line, the order-level discount block) say why.
 *
 * Phone widths (< 768 px, the `md` breakpoint) show either the product grid or the cart, behind a two-tab bar, so
 * a gesture that needs the other half switches to it first (`showCart` / `showProducts`).
 */

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 768

export async function showCart(page: Page): Promise<void> {
  if (isPhone(page)) await page.getByRole('button', { name: /^Cart/ }).click()
}

export async function showProducts(page: Page): Promise<void> {
  // The cart panel has its own "Products" view toggle; the tab bar is the first one in the DOM.
  if (isPhone(page)) await page.getByRole('button', { name: 'Products', exact: true }).first().click()
}

/** Go to the till and wait until the seeded catalogue has reached it from the real database. */
export async function openPos(page: Page, seed: Seed): Promise<void> {
  await page.goto(`${MONEY_ORIGIN}/pos`)
  await expect(page.locator('#app-root')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(seed.products[0].name, { exact: true }).first(), 'the seeded catalogue must reach the till from real D1').toBeVisible({ timeout: 60_000 })
}

/**
 * A cart line. The structural hook is the quantity stepper: only a cart line has an "Increase quantity" button
 * (the product grid's tiles do not), so this never lands on the grid tile of the same product.
 */
export function cartLine(page: Page, productName: string): Locator {
  return page.locator('div[role="button"]').filter({ has: page.getByRole('button', { name: 'Increase quantity' }) }).filter({ hasText: productName })
}

/**
 * How the till names a lot: its received DATE, day first (2026-10-01 reads "01/10/2026"). Owner rule Z1a, utils/batchLabel.ts:
 * the stored received_at wins over the lot code, so the code never appears on a cashier's pill. The spec still names lots by
 * their code; this is the one place that turns a seeded lot into what a cashier can actually see and tap.
 */
export function lotLabel(lot: SeedLot): string {
  const [year, month, day] = lot.receivedAt.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/**
 * Put `qty` of a product, from a chosen lot, in the cart. Every seeded product has lots, so the tile always opens
 * the detail sheet (a one-tap add cannot know which lot to sell from); the cashier picks the received date, then
 * the price button. Choosing the lot by its date, not by position, is what lets a spec sell from the NEWER lot
 * and prove the sale did not fall back to oldest-first. The pill list also shows the OTHER branch's lot of the product
 * (greyed, 0 pcs at this branch, often the same date), so only an enabled pill counts; the stock and allocation rows
 * the spec reads afterwards are what prove the lot that was sold is the lot that was meant.
 */
export async function addToCart(page: Page, product: SeedProduct, lot: SeedLot, qty = 1): Promise<void> {
  await showProducts(page)
  const tile = page.getByText(product.name, { exact: true }).first()
  const chooser = page.getByRole('button', { name: /^Choose a received date/ })
  // The catalogue re-renders as its later loads land (measured in pos-sale.spec.ts), so a tap can hit a tile that
  // is being replaced. A cashier whose tap did nothing taps again.
  await expect(async () => {
    if (!(await chooser.isVisible())) await tile.click({ timeout: 10_000 })
    await expect(chooser).toBeVisible({ timeout: 5_000 })
  }, 'the detail sheet must open on the product tile').toPass({ timeout: 45_000 })
  await chooser.click()
  await page.getByRole('button', { name: new RegExp(`^${lotLabel(lot)}`), disabled: false }).click()
  await page.getByRole('button', { name: /^Selling price/ }).click()
  await showCart(page)
  const line = cartLine(page, product.name)
  await expect(line, 'the line must be in the cart').toBeVisible()
  for (let n = 1; n < qty; n += 1) {
    await line.getByRole('button', { name: 'Increase quantity' }).click()
    await expect(line.locator('input[type="number"]').first()).toHaveValue(String(n + 1))
  }
}

/** Retype the line's selling price (the USD box). Editing it sets the selling price; it is not a discount. */
export async function setLinePrice(page: Page, productName: string, usd: string): Promise<void> {
  const price = cartLine(page, productName).locator('input[type="number"]').nth(1)
  await price.fill(usd)
  await price.blur()
  // The box redraws from the stored base price ("3.20" reads back as "3.2"), so compare the number, not the text.
  await expect.poll(async () => Number(await price.inputValue()), { message: 'the line price must be committed on blur' }).toBe(Number(usd))
}

/** The order-level discount block (not the per-line one): it is the block labelled for `pos-discount-usd`. */
export async function setOrderDiscount(page: Page, discount: { percent: string } | { usd: string }): Promise<void> {
  const block = page.locator('label[for="pos-discount-usd"]').locator('xpath=..')
  if ('percent' in discount) {
    await block.getByRole('button', { name: '%', exact: true }).click()
    await page.locator('#pos-discount-usd').fill(discount.percent)
  } else {
    await block.getByRole('button', { name: '$', exact: true }).click()
    await page.locator('#pos-discount-usd').fill(discount.usd)
  }
}

/** Fill a payment row (the first by default). Leave a currency out to leave that box empty. */
export async function setTender(page: Page, tender: { method?: string; usd?: string; khr?: string }, row = 1): Promise<void> {
  if (tender.method !== undefined) await page.getByLabel(new RegExp(`^payment method ${row}$`, 'i')).fill(tender.method)
  if (tender.usd !== undefined) await page.getByLabel(new RegExp(`^amount paid usd ${row}$`, 'i')).fill(tender.usd)
  if (tender.khr !== undefined) await page.getByLabel(new RegExp(`^amount paid khr ${row}$`, 'i')).fill(tender.khr)
}

/** "+ Add payment method": a further tender row, opened with the first configured method. */
export async function addTenderRow(page: Page): Promise<void> {
  await page.getByRole('button', { name: /add payment method/i }).click()
}

/** The one-tap tenders: "Exact $" and "Exact ៛". */
export async function tapExact(page: Page, currency: 'usd' | 'khr'): Promise<void> {
  await page.getByRole('button', { name: currency === 'usd' ? 'Exact $' : 'Exact ៛', exact: true }).click()
}

/** The order summary's Total row, as the cashier reads it. */
export function totalRow(page: Page): Locator {
  return page.locator('div.font-bold').filter({ hasText: /^Total/ }).last()
}

/** Select a customer by typing a name and tapping the suggestion. */
export async function attachCustomer(page: Page, name: string): Promise<void> {
  await showCart(page)
  // The Customer section starts collapsed; its header reads "Customer ... Show" until opened.
  const header = page.getByRole('button', { name: /^Customer.*Show$/ })
  if (await header.count()) await header.click()
  const search = page.locator('#pos-customer-search')
  await search.fill(name)
  // The suggestions are the input's own siblings. Scoping to them matters: the section header button also reads
  // the typed name, and tapping it would collapse the section instead of choosing the customer.
  await search.locator('xpath=..').getByRole('button', { name: new RegExp(name) }).click()
}

/** Turn Delivery on, pick the courier and the fee, and say who pays it and what the courier is paid. */
export async function setDelivery(page: Page, delivery: { courier: string; feeUsd: string; paidBy: 'Customer' | 'Store'; costUsd: string }): Promise<void> {
  await showCart(page)
  await page.getByRole('switch', { name: 'Delivery' }).click()
  const search = page.locator('#pos-delivery-search')
  await search.fill(delivery.courier)
  await search.locator('xpath=..').getByRole('button', { name: new RegExp(delivery.courier) }).click()
  await page.locator('#pos-delivery-fee-usd').fill(delivery.feeUsd)
  await page.getByText('Fee Paid By', { exact: true }).locator('xpath=..').getByRole('button', { name: delivery.paidBy, exact: true }).click()
  await page.locator('#pos-delivery-actual-cost').fill(delivery.costUsd)
}

/** One option of the "Record Sale As" picker. It stays on screen, greyed, when the tender rules it out. */
export function statusOption(page: Page, status: 'completed' | 'awaiting_payment'): Locator {
  return page.locator(`[data-pos-status-option="${status}"]`)
}

export async function openStatusPicker(page: Page): Promise<void> {
  await showCart(page)
  await page.getByRole('button', { name: 'Complete Sale' }).click()
  await expect(page.getByText('Record Sale As')).toBeVisible()
}

export async function closeStatusPicker(page: Page): Promise<void> {
  await page.locator('div.fixed').filter({ hasText: 'Record Sale As' }).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText('Record Sale As')).toBeHidden()
}

/** Complete Sale, then the status the cashier picks in "Record Sale As". */
export async function completeSale(page: Page, status: 'completed' | 'awaiting_payment'): Promise<void> {
  await openStatusPicker(page)
  await statusOption(page, status).click()
}
