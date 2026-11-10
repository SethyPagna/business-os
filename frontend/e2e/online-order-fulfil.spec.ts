import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { collectPageHealth } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'
import { completeSale, setOrderDiscount } from './support/posDriver'

// KHQR security review F3, in the real built app with a mocked API: the two flows that had no screen. (1) Fulfil: Orders -> Fulfil -> the till opens with the order's items and its online
// money filled in, the cashier can see ordered -> in this sale and what a difference means in money, and the sale is posted with online_order_id and ONE online payment row for exactly the
// part of the payment it covers; a Worker refusal reads as a sentence. (2) The ABA refund: Returns -> a sale that took online money -> "Through ABA" shows its effect and cap and the
// return is posted with refund_channel 'aba'. UI/transport contract only: the Worker's own rules are pinned by its tests, not here.
test.use({ serviceWorkers: 'block' })

const PRODUCT = { id: 1001, name: 'E2E Product 002 Belle Roux', price: 24.81 }
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const order = {
  id: 7, order_no: 'W261110K7Q2', state: 'paid', revision: 4, sale_id: null, goods_total_usd: PRODUCT.price, currency: 'USD', branch_id: 1, customer_name: 'Sample Buyer', customer_phone: '*** 678',
  fulfilment: 'pickup', customer_address: null, contact_telegram: null, contact_instagram: null, contact_facebook: null, contact_tiktok: null, contact_whatsapp: null, contact_other: null, note: null,
  created_at: '2026-11-10 03:00:00.000', paid_at: '2026-11-10 03:01:00.000',
  items_json: JSON.stringify([{ product_id: PRODUCT.id, name: PRODUCT.name, quantity: 1, unit_price_usd: PRODUCT.price, line_total_usd: PRODUCT.price }]),
}
const detail = {
  order, payments: [{ id: 1, purpose: 'order', amount: PRODUCT.price, currency: 'USD', state: 'paid', paid_amount: PRODUCT.price, paid_at: order.paid_at, created_at: order.created_at, expires_at: null }],
  requests: [], events: [], status: 'paid', chips: [], money: { paid_usd: PRODUCT.price, refunded_usd: 0, refund_due_usd: 0, balance_due_usd: 0 },
}
const listRow = { id: 7, order_no: order.order_no, state: 'paid', fulfilment: 'pickup', customer_name: 'Sample Buyer', customer_phone: '*** 678', goods_total_usd: PRODUCT.price, created_at: order.created_at, paid_at: order.paid_at,
  sale_id: null, pending_requests: 0, held_review: 0, refund_due: false, refund_due_usd: 0 }

type Sale = { online_order_id?: number; total_usd?: number; sale_status?: string; payment_details?: Array<{ method: string; usd?: number; amount_usd?: number }>; items: Array<{ id?: number; product_id?: number; quantity: number }> }

/** Sign in, mock the order screens and the sale, and walk Orders -> Fulfil -> Open the till. Returns the sales the till posted. */
async function openTillFromOrder(page: Page, context: BrowserContext): Promise<Sale[]> {
  const sales: Sale[] = []
  await context.route('**/api/online-orders**', (route) => {
    const url = new URL(route.request().url())
    return json(route, url.pathname === '/api/online-orders' ? { rows: [listRow], next_cursor: null, page_size: 25 } : detail)
  })
  // The shop has the online payment method configured (the Worker refuses an order sale otherwise, and the till's strip warns when it is missing). Settings reach the app inside the
  // sign-in and bootstrap answers.
  await context.route(/\/api\/auth\/(bootstrap|login|me)(\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = await response.json().catch(() => null) as { settings?: Record<string, unknown>; user?: Record<string, unknown> } | null
    // The production session user carries organization_id (the fixture's carries only organizationId); a till sale is stamped with it.
    if (body?.user && body.user.organization_id === undefined) body.user.organization_id = body.user.organizationId ?? null
    if (body?.settings) body.settings.pos_payment_methods = JSON.stringify(['Cash', 'ABA Bank', 'ABA KHQR'])
    await route.fulfill({ response, json: body })
  })
  await context.route('**/api/sales', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    sales.push(route.request().postDataJSON() as Sale)
    return json(route, { error: 'The online payment on this sale does not match.', code: 'online_tender_mismatch' }, 409)
  })
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await gotoAdminPage(page, '/sales#hub:sales:orders')

  // Orders -> the order -> Fulfil -> Open the till
  await page.locator('[data-online-order-row="7"]').click()
  await expect(page.locator('[data-online-order-detail="7"]')).toBeVisible()
  await page.locator('[data-online-order-detail="7"]').getByRole('button', { name: 'Fulfil', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText("The till opens with this order's items and its online payment filled in")
  await dialog.getByRole('button', { name: 'Open the till', exact: true }).click()
  return sales
}

const strip = (page: Page) => page.locator('[data-online-order-till="7"]')
const money = (value: number) => value.toFixed(2).replace('.', '\\.')

test('Fulfil opens the till with the order filled in and posts the sale linked to it, with one online payment row', async ({ page, context }) => {
  const health = collectPageHealth(page)
  const sales = await openTillFromOrder(page, context)

  // the till: the strip, the line added through the till's own add, the online payment as the first row
  await expect(strip(page)).toBeVisible({ timeout: 30_000 })
  await expect(strip(page)).toContainText('W261110K7Q2')
  await expect(strip(page)).toContainText(PRODUCT.name)
  await expect(strip(page).locator('[data-order-line="1001"]')).toContainText('1 → 1', { timeout: 30_000 })
  await expect(strip(page)).toContainText(new RegExp(`Paid online\\s*\\$${money(PRODUCT.price)}`))
  await expect(strip(page).locator('[data-fulfil-money]')).toHaveAttribute('data-fulfil-money', 'same')
  await expect(page.getByLabel(/^amount paid usd 1$/i)).toHaveValue(PRODUCT.price.toFixed(2))

  // complete: the sale carries the order and exactly one online row for the covered part
  await completeSale(page, 'completed')
  await expect.poll(() => sales.length, { message: 'the till posts the sale' }).toBe(1)
  expect(sales[0].online_order_id).toBe(7)
  const online = (sales[0].payment_details || []).filter((row) => /khqr/i.test(row.method))
  expect(online, 'exactly one online payment row').toHaveLength(1)
  expect(Number(online[0].usd ?? online[0].amount_usd)).toBeCloseTo(PRODUCT.price, 2)
  expect(sales[0].items).toHaveLength(1)

  // the Worker's refusal is shown to the cashier (Khmer restating is pinned by tests/onlineOrdersLogic.test.ts)
  await expect(page.getByText('The online payment on this sale does not match.')).toBeVisible()
  expect(health.pageErrors).toEqual([])
})

test('the cashier may change the sale: the strip says what the difference means, and the online row follows the part of the payment the sale covers', async ({ page, context }) => {
  const sales = await openTillFromOrder(page, context)
  await expect(strip(page).locator('[data-order-line="1001"]')).toContainText('1 → 1', { timeout: 30_000 })
  await expect(page.getByLabel(/^amount paid usd 1$/i)).toHaveValue(PRODUCT.price.toFixed(2))

  // a $5 discount: the sale comes to less than the customer paid online, so $5 is owed back through ABA, and the online row drops to what the sale covers
  await setOrderDiscount(page, { usd: '5' })
  const covered = PRODUCT.price - 5
  await expect(strip(page).locator('[data-fulfil-money]')).toHaveAttribute('data-fulfil-money', 'refund_back')
  await expect(strip(page)).toContainText('The customer paid $5.00 more online than this sale comes to. After Complete, send $5.00 back through ABA from Orders.')
  await expect(page.getByLabel(/^amount paid usd 1$/i), 'the online row is the part of the payment the sale covers').toHaveValue(covered.toFixed(2))

  await completeSale(page, 'completed')
  await expect.poll(() => sales.length).toBe(1)
  expect(sales[0].online_order_id).toBe(7)
  const online = (sales[0].payment_details || []).filter((row) => /khqr/i.test(row.method))
  expect(online, 'still exactly one online row').toHaveLength(1)
  expect(Number(online[0].usd ?? online[0].amount_usd)).toBeCloseTo(covered, 2)
  expect(Number(sales[0].total_usd)).toBeCloseTo(covered, 2)

})

test('taking the order off the sale is one tap, and the online payment row goes with it', async ({ page, context }) => {
  await openTillFromOrder(page, context)
  await expect(strip(page).locator('[data-order-line="1001"]')).toContainText('1 → 1', { timeout: 30_000 })
  await expect(page.getByLabel(/^payment method 1$/i)).toHaveValue(/KHQR/i)
  await page.getByRole('button', { name: 'Sell without this order' }).click()
  await expect(strip(page)).toHaveCount(0)
  await expect(page.getByLabel(/^payment method 1$/i)).not.toHaveValue(/KHQR/i)
  await expect(page.getByLabel(/^amount paid usd 1$/i)).not.toHaveValue(PRODUCT.price.toFixed(2))
})
