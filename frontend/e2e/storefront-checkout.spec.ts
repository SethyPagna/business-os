import { expect, test, type Page, type Route } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage } from './support/harness'
import { stubStorefrontConfig } from './support/storefrontStub'

/**
 * storefront-checkout.spec.ts -- paying online with ABA KHQR from the storefront (KHQR slice S7), against a MOCKED order API.
 *
 *  - Off: the cart is the old shortlist (no Checkout, no "My orders"); on: Checkout, one form with every field from the first paint.
 *  - Placing an order sends what was typed, opens the order page at /order/<token> with the QR, empties the cart, remembers the link.
 *  - The order page: waiting, paid (found by the status poll), time ran out ("Get a new QR"), QR failed ("Try again"), not found.
 *  - After payment: a return request with a reason, the shop's reply, withdrawing it, and the day count taken from the order itself.
 *  - English and Khmer, at phone width, in all three browser profiles of playwright.config.ts (desktop, Pixel 7, iPhone 13 WebKit).
 *
 * No real PayWay call is possible here: every /api/portal/orders request is answered by this file. The Worker's own behaviour is proved
 * by cloudflare/scripts/test-online-order-routes-native.cjs.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-checkout
 * SCREENSHOTS:         E2E_SHOTS_DIR=<folder> npx playwright test storefront-checkout -g screenshots
 *
 * Each test names the wrong implementation it catches. Everything here is synthetic: the repository is public.
 */

test.use({ serviceWorkers: 'block' })

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA'
const NOW = new Date('2026-11-09T10:00:00Z')
const QR_STRING = '00020101021229370016abaakhppxxx@abaa01090000000010208ABA Bank40390007bakong0124sample.shop@abaa5204599953038405802KH5910Leang Shop6010Phnom Penh63041234'
const BUCKET_KEY = 'business-os-portal-bucket-v1'
const HISTORY_KEY = 'business-os-portal-orders-v1'

type Json = Record<string, unknown>
type Seen = { method: string; path: string; body: Json | null }

const ITEMS = [{ product_id: 1000, name: 'E2E Product 001 Aurelia', quantity: 2, unit_price_usd: 18.63, line_total_usd: 37.26 }]

/** The order as GET /api/portal/orders/:token answers (publicOrderView in the Worker), with the parts a test varies. */
function orderView(over: Json = {}): Json {
  return {
    order_no: 'W261109K7Q2', status: 'awaiting_payment', phase: 'before_sale', chips: [], fulfilment: 'pickup', name: 'Sample Buyer', phone_hint: '*** 678',
    address: null, contacts: { telegram: null, instagram: null, facebook: null, tiktok: null, whatsapp: null, other: null }, note: null, items: ITEMS,
    total_usd: 37.26, total_khr: 152766, currency: 'USD', created_at: '2026-11-09 09:59:30.000', paid_at: null,
    payment: { amount: 37.26, currency: 'USD', qr_string: QR_STRING, deeplink: 'abamobilebank://ababank.com?type=payway&qrcode=sample', expires_at: '2026-11-09 10:15:00.000' },
    top_ups: [], requests: [], money: { paid_usd: 0, refunded_usd: 0, refund_due_usd: 0, balance_due_usd: 0 },
    can_edit: true, can_cancel: true, requests_open: false, request_kinds: [], request_window_days: 7,
    ...over,
  }
}
const paidView = (over: Json = {}): Json => orderView({
  status: 'paid', payment: null, can_edit: false, can_cancel: false, paid_at: '2026-11-09 10:01:00.000', money: { paid_usd: 37.26, refunded_usd: 0, refund_due_usd: 0, balance_due_usd: 0 },
  requests_open: true, request_kinds: ['items', 'fulfilment', 'address', 'contact', 'note', 'cancel'], ...over,
})

/** Answers every /api/portal/orders request from `reply`, and records what the page sent. */
async function mockOrders(page: Page, reply: (seen: Seen) => { status?: number; json: unknown; headers?: Record<string, string> } | undefined): Promise<Seen[]> {
  const seen: Seen[] = []
  await page.route('**/api/portal/orders**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    let body: Json | null = null
    try { body = request.postDataJSON() as Json } catch { body = null }
    const entry: Seen = { method: request.method(), path: url.pathname.replace('/api/portal/orders', '') || '/', body }
    seen.push(entry)
    const answer = reply(entry) ?? { status: 500, json: { code: 'unscripted' } }
    await route.fulfill({ status: answer.status ?? 200, contentType: 'application/json', body: JSON.stringify(answer.json), headers: answer.headers })
  })
  return seen
}

async function openCatalogue(page: Page, { language = 'en', online = true, width = 390, height = 760 }: { language?: 'en' | 'km'; online?: boolean; width?: number; height?: number } = {}) {
  await page.clock.install({ time: NOW })
  await page.setViewportSize({ width, height })
  await seedStorefrontLanguage(page.context(), STOREFRONT_ORIGIN, language)
  // Seeded once: the page navigates to the order afterwards, and a re-seed would put the cart back.
  await page.addInitScript(({ key, items }) => {
    if (window.localStorage.getItem('__e2e_seeded')) return
    window.localStorage.setItem(key, JSON.stringify(items))
    window.localStorage.setItem('__e2e_seeded', '1')
  }, { key: BUCKET_KEY, items: [{ id: 1000, name: 'E2E Product 001 Aurelia', category: 'Skincare', brand: 'Aurelia', priceText: '$18.63', qty: 2 }] })
  await stubStorefrontConfig(page, online ? { onlineOrdersEnabled: true } : {})
  await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
  await expect(page.locator('footer[data-portal-footer="true"]')).toBeVisible()
}

const openDrawer = async (page: Page) => {
  await page.locator('button[aria-label="My List"]').click()
  await expect(page.getByRole('dialog', { name: 'My List' })).toBeVisible()
}
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name })

async function fillCheckout(page: Page, over: { name?: string; phone?: string; delivery?: boolean; address?: string; telegram?: string } = {}) {
  const form = sheet(page, 'Your order')
  await form.getByLabel('Your name').fill(over.name ?? 'Sample Buyer')
  await form.getByLabel('Phone number').fill(over.phone ?? '012 345 678')
  if (over.delivery) await form.getByRole('radio', { name: 'Delivery' }).click()
  if (over.address) await form.getByLabel('Delivery address').fill(over.address)
  if (over.telegram) await form.getByLabel('Telegram').fill(over.telegram)
}

test.describe('Checkout', () => {
  test('with the switch off the cart is the old shortlist: no Checkout, no My orders, the no-payment notice', async ({ page }) => {
    // CATCHES: a checkout (or a "My orders" link) shown to a shop that has not turned online ordering on.
    const health = collectPageHealth(page)
    await openCatalogue(page, { online: false })
    await openDrawer(page)
    const drawer = page.getByRole('dialog', { name: 'My List' })
    await expect(drawer.getByRole('button', { name: 'Checkout' })).toHaveCount(0)
    await expect(drawer.getByRole('link', { name: 'My orders' })).toHaveCount(0)
    await expect(drawer.getByRole('note')).toContainText('don\'t take online payments')
    await expect(drawer).toContainText('No payment here')
    expectNoRuntimeErrors(health)
  })

  test('a switch that is not exactly true counts as off (a missing or odd answer never opens checkout)', async ({ page }) => {
    // CATCHES: a truthy check (the string "false", 1, "yes") that opens checkout for a shop that never turned it on.
    await openCatalogue(page, { online: false })
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await stubStorefrontConfig(page, { onlineOrdersEnabled: 'true' })
    await page.reload({ waitUntil: 'load' })
    await expect(page.locator('footer[data-portal-footer="true"]')).toBeVisible()
    await openDrawer(page)
    await expect(page.getByRole('dialog', { name: 'My List' }).getByRole('button', { name: 'Checkout' })).toHaveCount(0)
  })

  test('with the switch on the cart says the shop takes KHQR, and Checkout opens the whole form at once', async ({ page }) => {
    // CATCHES: the old "we take no online payments" sentence beside a Pay button, and a form that unfolds field by field (the address, the
    // delivery notice and every contact field must be there from the first paint).
    const health = collectPageHealth(page)
    await openCatalogue(page)
    await openDrawer(page)
    const drawer = page.getByRole('dialog', { name: 'My List' })
    await expect(drawer.getByRole('note')).toContainText('pay online with ABA KHQR')
    await expect(drawer.getByRole('note')).not.toContainText('don\'t take online payments')
    await expect(drawer.getByRole('link', { name: 'My orders' })).toBeVisible()
    await drawer.getByRole('button', { name: 'Checkout' }).click()
    const form = sheet(page, 'Your order')
    await expect(form).toBeVisible()
    for (const label of ['Your name', 'Phone number', 'Delivery address', 'Telegram', 'Instagram', 'Facebook', 'TikTok', 'WhatsApp', 'Other', 'Note for the shop (optional)']) {
      await expect(form.getByLabel(label, { exact: true }), label).toBeVisible()
    }
    await expect(form.getByRole('radio', { name: 'Pickup at the shop' })).toHaveAttribute('aria-checked', 'true')
    await expect(form).toContainText('our staff will contact you about the delivery price and time')
    await expect(form).toContainText('The QR covers the goods only')
    await expect(form).toContainText('You will see the exact total before you pay')
    await expect(form.getByRole('button', { name: 'Get QR' })).toBeVisible()
    await expect(form.getByRole('link', { name: 'Terms & Conditions' })).toBeVisible()
    await expect(form.getByRole('link', { name: 'Privacy Policy' })).toBeVisible()
    expectNoRuntimeErrors(health)
  })

  test('name and phone are required, an address only for delivery; nothing is sent until they are right', async ({ page }) => {
    // CATCHES: an order sent with no name or phone, an address demanded for pickup, and a Get QR that fires before the form is valid.
    const seen = await mockOrders(page, () => ({ status: 201, json: { order: orderView(), token: TOKEN } }))
    await openCatalogue(page)
    await openDrawer(page)
    await page.getByRole('dialog', { name: 'My List' }).getByRole('button', { name: 'Checkout' }).click()
    const form = sheet(page, 'Your order')
    await form.getByRole('button', { name: 'Get QR' }).click()
    await expect(form.getByRole('alert')).toHaveText('Please enter your name.')
    await form.getByLabel('Your name').fill('Sample Buyer')
    await form.getByRole('button', { name: 'Get QR' }).click()
    await expect(form.getByRole('alert')).toContainText('Please enter a phone number we can call')
    await form.getByLabel('Phone number').fill('1234567')
    await form.getByRole('button', { name: 'Get QR' }).click()
    await expect(form.getByRole('alert')).toContainText('Please enter a phone number we can call')
    await form.getByLabel('Phone number').fill('012 345 678')
    await form.getByRole('radio', { name: 'Delivery' }).click()
    await form.getByRole('button', { name: 'Get QR' }).click()
    await expect(form.getByRole('alert')).toContainText('Please enter your delivery address')
    expect(seen, 'nothing reached the API').toEqual([])
  })

  test('placing an order sends what was typed, opens the order page with the QR, empties the cart and remembers the link', async ({ page }) => {
    // CATCHES: wrong or missing fields in the create call, a cart that survives its own order (the shopper would pay twice), a link that is
    // not remembered, a QR page that does not show the amount, a countdown, or the QR itself, and a delivery order that hides the notice.
    const health = collectPageHealth(page)
    const delivery = { fulfilment: 'delivery', address: '12 Street 271, Phnom Penh' }
    const seen = await mockOrders(page, ({ method, path }) => {
      if (method === 'POST' && path === '/') return { status: 201, json: { order: orderView(delivery), token: TOKEN } }
      if (method === 'GET' && path === `/${TOKEN}`) return { json: { order: orderView(delivery) } }
      if (method === 'GET' && path === `/${TOKEN}/status`) return { json: { state: 'awaiting_payment', revision: 1, paid_at: null, total_usd: 37.26 } }
      return undefined
    })
    await openCatalogue(page)
    await openDrawer(page)
    await page.getByRole('dialog', { name: 'My List' }).getByRole('button', { name: 'Checkout' }).click()
    await fillCheckout(page, { delivery: true, address: '12 Street 271, Phnom Penh', telegram: '@sample' })
    await sheet(page, 'Your order').getByRole('button', { name: 'Get QR' }).click()
    await page.waitForURL(`**/order/${TOKEN}`)

    const create = seen.find((entry) => entry.method === 'POST')!
    expect(create.body).toMatchObject({
      lines: [{ product_id: 1000, quantity: 2 }], name: 'Sample Buyer', phone: '012 345 678', fulfilment: 'delivery', address: '12 Street 271, Phnom Penh', contacts: { telegram: '@sample' },
    })
    expect(String(create.body?.client_request_id)).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(Object.keys(create.body ?? {})).not.toContain('website')

    await expect(page.getByRole('heading', { level: 1 })).toContainText('W261109K7Q2')
    await expect(page.getByAltText('KHQR code to pay $37.26')).toBeVisible()
    expect(await page.getByAltText('KHQR code to pay $37.26').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 100), 'the QR image is a real drawn picture').toBe(true)
    await expect(page.getByRole('timer')).toHaveText(/^Pay within 1[45]:\d\d$/)
    await expect(page.getByText('Waiting for your payment…')).toBeVisible()
    await expect(page.getByText('Total for the goods')).toBeVisible()
    await expect(page.getByText('our staff will contact you about the delivery price and time').first()).toBeVisible()
    // The clock runs on after install; stop it at a known second so the countdown can be read exactly.
    await page.clock.pauseAt(new Date('2026-11-09T10:01:00Z'))
    await page.clock.runFor(1_000)
    await expect(page.getByRole('timer')).toHaveText('Pay within 13:59')
    await page.clock.runFor(60_000)
    await expect(page.getByRole('timer')).toHaveText('Pay within 12:59')
    const stored = await page.evaluate(([bucket, history]) => ({ bucket: window.localStorage.getItem(bucket), history: window.localStorage.getItem(history) }), [BUCKET_KEY, HISTORY_KEY])
    expect(JSON.parse(stored.bucket || '[]'), 'the cart is empty').toEqual([])
    const remembered = JSON.parse(stored.history || '[]')
    expect(remembered).toHaveLength(1)
    expect(Object.keys(remembered[0]).sort(), 'only the link, number, time and total are kept').toEqual(['orderNo', 'savedAt', 'token', 'totalUsd'])
    expect(remembered[0]).toMatchObject({ token: TOKEN, orderNo: 'W261109K7Q2', totalUsd: 37.26 })
    expectNoRuntimeErrors(health)
  })

  test('a refusal for stock keeps the shopper in the sheet and names the items', async ({ page }) => {
    // CATCHES: the Worker's English sentence shown instead of the shopper's language, a lost form, and a refusal without the item names.
    await mockOrders(page, () => ({ status: 409, json: { error: 'Some items are not in stock.', code: 'out_of_stock', items: [{ product_id: 1000, name: 'E2E Product 001 Aurelia', available: 1 }] } }))
    await openCatalogue(page)
    await openDrawer(page)
    await page.getByRole('dialog', { name: 'My List' }).getByRole('button', { name: 'Checkout' }).click()
    await fillCheckout(page)
    const form = sheet(page, 'Your order')
    await form.getByRole('button', { name: 'Get QR' }).click()
    await expect(form.getByRole('alert')).toContainText('Some items are not in stock in the quantity you asked for')
    await expect(form.getByRole('alert')).toContainText('E2E Product 001 Aurelia: 1 left')
    await expect(form.getByLabel('Your name')).toHaveValue('Sample Buyer')
    expect(new URL(page.url()).pathname, 'still on the catalogue').toBe('/')
    await expect(form.getByRole('button', { name: 'Get QR' })).toBeEnabled()
  })

  test('closing a half-filled sheet asks first, with Discard and Back', async ({ page }) => {
    // CATCHES: typed details thrown away by a stray tap on the backdrop or the X, and an empty sheet that asks needlessly.
    await openCatalogue(page)
    await openDrawer(page)
    await page.getByRole('dialog', { name: 'My List' }).getByRole('button', { name: 'Checkout' }).click()
    const form = sheet(page, 'Your order')
    await form.getByRole('button', { name: 'Close' }).click()
    await expect(form).toHaveCount(0)
    await page.getByRole('dialog', { name: 'My List' }).getByRole('button', { name: 'Checkout' }).click()
    await form.getByLabel('Your name').fill('Sample Buyer')
    await form.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(form.getByLabel('Your name')).toHaveValue('Sample Buyer')
    await form.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect(form).toHaveCount(0)
  })
})

test.describe('Order page', () => {
  async function openOrder(page: Page, language: 'en' | 'km' = 'en', width = 390, { frozen = false } = {}) {
    await page.clock.install({ time: NOW })
    // frozen: no timer fires until the test moves the clock, so a slow browser cannot spend the poll interval while the page loads.
    if (frozen) await page.clock.pauseAt(new Date(NOW.getTime() + 1_000))
    await page.setViewportSize({ width, height: 760 })
    await seedStorefrontLanguage(page.context(), STOREFRONT_ORIGIN, language)
    await page.goto(`${STOREFRONT_ORIGIN}/order/${TOKEN}`, { waitUntil: 'load' })
  }

  test('the status poll finds the payment and the page turns to "Payment received" without a reload', async ({ page }) => {
    // CATCHES: a QR page that never learns it was paid, a poll that reads faster than every 3 seconds, and one that does not stop once paid.
    const health = collectPageHealth(page)
    let paid = false
    const seen = await mockOrders(page, ({ method, path }) => {
      if (path === `/${TOKEN}/status`) return { json: { state: paid ? 'paid' : 'awaiting_payment', revision: 1, paid_at: null, total_usd: 37.26 } }
      if (method === 'GET' && path === `/${TOKEN}`) return { json: { order: paid ? paidView() : orderView() } }
      return undefined
    })
    await openOrder(page, 'en', 390, { frozen: true })
    await expect(page.getByAltText('KHQR code to pay $37.26')).toBeVisible()
    const polls = () => seen.filter((entry) => entry.path.endsWith('/status')).length
    expect(polls(), 'nothing is read at once: the page already has fresh data').toBe(0)
    await page.clock.runFor(2_900)
    expect(polls(), 'not before the first interval').toBe(0)
    await page.clock.runFor(1_200)
    await expect.poll(polls).toBe(1)
    paid = true
    // The next poll is scheduled when the previous answer lands, which is real network time: move the clock on until it has been asked.
    await expect(async () => {
      await page.clock.runFor(1_000)
      await expect(page.getByText('Payment received. Thank you!')).toBeVisible({ timeout: 400 })
    }).toPass({ timeout: 20_000 })
    await expect(page.getByText('Come to the shop to collect your order')).toBeVisible()
    await expect(page.getByAltText('KHQR code to pay $37.26')).toHaveCount(0)
    const settled = polls()
    await page.clock.runFor(60_000)
    expect(polls(), 'a paid order is not polled again').toBe(settled)
    expectNoRuntimeErrors(health)
  })

  test('when the time runs out the page says nothing was charged and "Get a new QR" brings a fresh one', async ({ page }) => {
    // CATCHES: a dead QR left on screen as payable, no way forward after the countdown, and a new QR that does not replace the old one.
    const fresh = orderView({ payment: { amount: 37.26, currency: 'USD', qr_string: QR_STRING.replace('1234', '5678'), deeplink: null, expires_at: '2026-11-09 10:31:00.000' } })
    let retried = false
    const seen = await mockOrders(page, ({ method, path }) => {
      if (path === `/${TOKEN}/status`) return { json: { state: 'awaiting_payment', revision: 1, paid_at: null, total_usd: 37.26 } }
      if (path === `/${TOKEN}/retry`) { retried = true; return { json: { order: fresh } } }
      if (method === 'GET' && path === `/${TOKEN}`) return { json: { order: orderView({ payment: { amount: 37.26, currency: 'USD', qr_string: QR_STRING, deeplink: null, expires_at: '2026-11-09 10:00:20.000' } }) } }
      return undefined
    })
    await openOrder(page)
    await expect(page.getByRole('timer')).toBeVisible()
    // The clock runs on after install; stop it at a known second so the countdown reads exactly (the QR expires at 10:00:20).
    await page.clock.pauseAt(new Date('2026-11-09T10:00:10Z'))
    await page.clock.runFor(1_000)
    await expect(page.getByRole('timer')).toHaveText('Pay within 0:09')
    await page.clock.runFor(11_000)
    await expect(page.getByText('Time ran out. Nothing was charged.')).toBeVisible()
    await expect(page.getByAltText('KHQR code to pay $37.26')).toHaveCount(0)
    await page.getByRole('button', { name: 'Get a new QR' }).click()
    await expect(page.getByAltText('KHQR code to pay $37.26')).toBeVisible()
    expect(retried).toBe(true)
    expect(seen.find((entry) => entry.path.endsWith('/retry'))?.method).toBe('POST')
    await expect(page.getByRole('timer')).toContainText('Pay within')
  })

  test('a QR that could not be made opens the order with "Get a new QR", not a blank page or a dead end', async ({ page }) => {
    // CATCHES: losing an order that exists when ABA gave no QR (the Worker still answers with its token), and a retry that stays disabled.
    await mockOrders(page, ({ method, path }) => {
      if (method === 'POST' && path === '/') return { status: 502, json: { error: 'busy', code: 'payment_busy', retryable: true, token: TOKEN, order_no: 'W261109K7Q2' } }
      if (path === `/${TOKEN}`) return { json: { order: orderView({ status: 'qr_failed', payment: null }) } }
      return undefined
    })
    await openCatalogue(page)
    await openDrawer(page)
    await page.getByRole('dialog', { name: 'My List' }).getByRole('button', { name: 'Checkout' }).click()
    await fillCheckout(page)
    await sheet(page, 'Your order').getByRole('button', { name: 'Get QR' }).click()
    await page.waitForURL(`**/order/${TOKEN}`)
    await expect(page.getByText('We could not get a QR for this order yet. Nothing was charged.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Get a new QR' })).toBeEnabled()
  })

  test('a link that is not an order says so plainly and offers no retry', async ({ page }) => {
    // CATCHES: a blank page, a raw "order_not_found" code, or a retry loop on a link that can never work.
    await mockOrders(page, () => ({ status: 404, json: { error: 'We could not find this order.', code: 'order_not_found' } }))
    await openOrder(page)
    await expect(page.getByRole('alert')).toHaveText('We could not find this order. Check the link you were given.')
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    await page.goto(`${STOREFRONT_ORIGIN}/order/not-a-real-token`, { waitUntil: 'load' })
    await expect(page.getByRole('alert')).toHaveText('We could not find this order. Check the link you were given.')
  })

  test('changing a waiting order shows before and after, and sends only what changed', async ({ page }) => {
    // CATCHES: a save with no review, a body that rewrites untouched fields, and contacts sent as one field (the Worker would clear the others).
    let editBody: Json | null = null
    await mockOrders(page, ({ method, path, body }) => {
      if (path === `/${TOKEN}/edit`) { editBody = body; return { json: { order: orderView({ items: [{ ...ITEMS[0], quantity: 1, line_total_usd: 18.63 }], total_usd: 18.63, payment: { amount: 18.63, currency: 'USD', qr_string: QR_STRING, deeplink: null, expires_at: '2026-11-09 10:30:00.000' } }) } } }
      if (method === 'GET' && path === `/${TOKEN}`) return { json: { order: orderView({ contacts: { telegram: '@old', instagram: 'old_ig', facebook: null, tiktok: null, whatsapp: null, other: null } }) } }
      if (path === `/${TOKEN}/status`) return { json: { state: 'awaiting_payment', revision: 1, paid_at: null, total_usd: 37.26 } }
      return undefined
    })
    await openOrder(page)
    await page.getByRole('button', { name: 'Change your order' }).click()
    const dialog = page.getByRole('dialog', { name: 'Change your order' })
    await dialog.getByRole('button', { name: 'Decrease quantity: E2E Product 001 Aurelia' }).click()
    await dialog.getByLabel('Telegram').fill('@new')
    await dialog.getByRole('button', { name: 'Review changes' }).click()
    const review = page.getByText('Save these changes?')
    await expect(review).toBeVisible()
    await expect(page.getByText('Items before')).toBeVisible()
    await expect(page.getByText('2 × E2E Product 001 Aurelia', { exact: true })).toBeVisible()
    await expect(page.getByText('1 × E2E Product 001 Aurelia', { exact: true })).toBeVisible()
    await expect(page.getByRole('definition').filter({ hasText: '$37.26' }).first()).toBeVisible()
    expect(editBody, 'nothing is sent before the review is confirmed').toBeNull()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => editBody).not.toBeNull()
    expect(editBody).toEqual({
      lines: [{ product_id: 1000, quantity: 1 }],
      contacts: { telegram: '@new', instagram: 'old_ig', facebook: '', tiktok: '', whatsapp: '', other: '' },
    })
    await expect(page.getByText('1 × $18.63')).toBeVisible()
  })

  test('cancelling a waiting order shows the status before and after and then cancels', async ({ page }) => {
    // CATCHES: a one-tap cancel with no review, and a cancelled order that still shows a QR.
    let cancelled = false
    await mockOrders(page, ({ method, path }) => {
      if (path === `/${TOKEN}/cancel`) { cancelled = true; return { json: { order: orderView({ status: 'cancelled', payment: null, can_edit: false, can_cancel: false }) } } }
      if (method === 'GET' && path === `/${TOKEN}`) return { json: { order: orderView() } }
      if (path === `/${TOKEN}/status`) return { json: { state: 'awaiting_payment', revision: 1, paid_at: null, total_usd: 37.26 } }
      return undefined
    })
    await openOrder(page)
    await page.getByRole('button', { name: 'Cancel order' }).click()
    await expect(page.getByText('Cancel this order?')).toBeVisible()
    await expect(page.getByText('Waiting for payment → Cancelled')).toBeVisible()
    expect(cancelled).toBe(false)
    await page.getByRole('button', { name: 'Cancel order' }).last().click()
    await expect(page.getByText('This order is cancelled.')).toBeVisible()
    await expect(page.getByAltText('KHQR code to pay $37.26')).toHaveCount(0)
    expect(cancelled).toBe(true)
  })

  test('after payment: a return needs items and a reason, goes with the phone, and the shop\'s answer shows; the window is the order\'s own', async ({ page }) => {
    // CATCHES: a return request with no reason, a request without the phone check, a literal "7 days" (the payload says 9), and the shop's reply hidden.
    let requestBody: Json | null = null
    let withdrawBody: Json | null = null
    let requests: Json[] = [{ id: 4, kind: 'note', stage: 'paid', status: 'rejected', staff_reply: 'Sorry, the box has already been packed.', comment: 'Please add a gift note', attachments: [], created_at: '2026-11-09 10:05:00.000' }]
    await mockOrders(page, ({ method, path, body }) => {
      if (path === `/${TOKEN}/requests` && method === 'POST') {
        requestBody = body
        requests = [...requests, { id: 5, kind: 'return', stage: 'after_sale', status: 'pending', staff_reply: null, comment: null, attachments: [], created_at: '2026-11-09 10:10:00.000' }]
        return { status: 201, json: { order: paidView({ status: 'completed', phase: 'after_sale', request_window_days: 9, request_kinds: ['items', 'return', 'cancel'], requests }) } }
      }
      if (path === `/${TOKEN}/requests/5/withdraw`) {
        withdrawBody = body
        requests = requests.map((r) => (r.id === 5 ? { ...r, status: 'withdrawn' } : r))
        return { json: { order: paidView({ status: 'completed', phase: 'after_sale', request_window_days: 9, request_kinds: ['items', 'return', 'cancel'], requests }) } }
      }
      if (method === 'GET' && path === `/${TOKEN}`) return { json: { order: paidView({ status: 'completed', phase: 'after_sale', request_window_days: 9, request_kinds: ['items', 'return', 'cancel'], requests }) } }
      return undefined
    })
    await openOrder(page)
    const section = page.getByRole('region', { name: 'Changes and returns' })
    await expect(section).toContainText('within 9 days')
    await expect(section).not.toContainText('7 days')
    await expect(section.getByText('Not accepted')).toBeVisible()
    await expect(section.getByText('Sorry, the box has already been packed.')).toBeVisible()
    await section.getByRole('radio', { name: 'Return items' }).click()
    await section.getByLabel('The phone number you gave when you ordered').fill('012 345 678')
    await section.getByRole('button', { name: 'Send request' }).click()
    await expect(section.getByRole('alert')).toHaveText('Choose at least one item.')
    await section.getByRole('button', { name: 'Increase quantity: E2E Product 001 Aurelia' }).click()
    await section.getByRole('button', { name: 'Send request' }).click()
    await expect(section.getByRole('alert')).toHaveText('Please write why you are returning these items.')
    await expect(section).toContainText('Our staff will contact you for photos if they need them')
    await section.getByLabel('Why are you returning these items?').fill('The cap was cracked')
    expect(requestBody).toBeNull()
    await section.getByRole('button', { name: 'Send request' }).click()
    await expect(section.getByText('Waiting for the shop', { exact: true })).toBeVisible()
    expect(requestBody).toEqual({ kind: 'return', phone: '012 345 678', after: { lines: [{ product_id: 1000, quantity: 1 }], reason: 'The cap was cracked' } })
    await expect(section.getByRole('button', { name: 'Send request' }), 'one request at a time: the form is gone while one waits').toHaveCount(0)
    await section.getByRole('button', { name: 'Withdraw request' }).click()
    await expect(page.getByText('Waiting for the shop → Withdrawn')).toBeVisible()
    await page.getByRole('dialog').getByLabel('The phone number you gave when you ordered').fill('012 345 678')
    await page.getByRole('dialog').getByRole('button', { name: 'Withdraw request' }).click()
    await expect(section.getByText('Withdrawn')).toBeVisible()
    expect(withdrawBody).toEqual({ phone: '012 345 678' })
  })

  test('a refusal from the Worker shows in the shopper\'s language, not as a code', async ({ page }) => {
    // CATCHES: "phone_mismatch" or the Worker's English sentence shown to a Khmer reader.
    await mockOrders(page, ({ method, path }) => {
      if (path === `/${TOKEN}/requests` && method === 'POST') return { status: 403, json: { error: 'That phone number does not match this order.', code: 'phone_mismatch' } }
      if (method === 'GET' && path === `/${TOKEN}`) return { json: { order: paidView() } }
      return undefined
    })
    await openOrder(page, 'km')
    const section = page.getByRole('region', { name: 'ការកែប្រែ និងការប្រគល់ទំនិញវិញ' })
    await section.getByRole('radio', { name: 'បោះបង់ការបញ្ជាទិញ' }).click()
    await section.getByLabel('លេខទូរស័ព្ទដែលអ្នកបានផ្តល់ពេលបញ្ជាទិញ').fill('099 111 222')
    await section.getByRole('button', { name: 'ផ្ញើសំណើ' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'ផ្ញើសំណើ' }).click()
    await expect(section.getByRole('alert')).toHaveText('លេខទូរស័ព្ទនោះមិនត្រូវនឹងការបញ្ជាទិញនេះទេ។ សូមបញ្ចូលលេខដែលអ្នកបានផ្តល់ពេលបញ្ជាទិញ។')
    await expect(section.getByRole('alert')).not.toContainText('phone_mismatch')
  })

  test('My orders lists this browser\'s orders and removing one does not cancel it', async ({ page }) => {
    // CATCHES: a list that shows more than the number, time and total, one that cannot be emptied, and a "remove" that calls the Worker.
    const seen = await mockOrders(page, () => ({ json: {} }))
    await page.setViewportSize({ width: 390, height: 760 })
    await seedStorefrontLanguage(page.context(), STOREFRONT_ORIGIN, 'en')
    await page.addInitScript(({ key, token }) => {
      window.localStorage.setItem(key, JSON.stringify([{ token, orderNo: 'W261109K7Q2', savedAt: '2026-11-09T03:00:00.000Z', totalUsd: 37.26 }]))
    }, { key: HISTORY_KEY, token: TOKEN })
    await page.goto(`${STOREFRONT_ORIGIN}/order`, { waitUntil: 'load' })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My orders')
    const link = page.getByRole('link', { name: /W261109K7Q2/ })
    await expect(link).toHaveAttribute('href', `/order/${TOKEN}`)
    await expect(link).toContainText('$37.26')
    await page.getByRole('button', { name: 'Remove from this list: W261109K7Q2' }).click()
    await expect(page.getByText('You have no orders on this device yet')).toBeVisible()
    expect(seen).toEqual([])
  })

  test('the order page is private: no indexing, no referrer, and it loads without the catalogue', async ({ page }) => {
    // CATCHES: an order link crawled by a search engine or sent on as a referrer, and the whole catalogue downloaded just to show one order.
    const health = collectPageHealth(page)
    await mockOrders(page, ({ method, path }) => (method === 'GET' && path === `/${TOKEN}` ? { json: { order: orderView() } } : { json: { state: 'awaiting_payment', revision: 1, paid_at: null, total_usd: 37.26 } }))
    await openOrder(page)
    await expect(page.getByAltText('KHQR code to pay $37.26')).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
    expect(health.requests.filter((url) => url.includes('/api/portal/catalog')), 'no catalogue request').toEqual([])
  })
})

test.describe('Khmer', () => {
  test('the checkout and the QR page read in Khmer, with room for the glyphs', async ({ page }) => {
    // CATCHES: English left on a Khmer screen, and Khmer text in a fixed-height line box that clips its marks.
    await mockOrders(page, ({ method, path }) => {
      if (method === 'POST' && path === '/') return { status: 201, json: { order: orderView(), token: TOKEN } }
      if (method === 'GET' && path === `/${TOKEN}`) return { json: { order: orderView() } }
      return { json: { state: 'awaiting_payment', revision: 1, paid_at: null, total_usd: 37.26 } }
    })
    await openCatalogue(page, { language: 'km' })
    await page.locator('button[aria-label="បញ្ជីរបស់ខ្ញុំ"]').click()
    await page.getByRole('button', { name: 'ទូទាត់' }).click()
    const form = page.getByRole('dialog', { name: 'ការបញ្ជាទិញរបស់អ្នក' })
    await expect(form).toBeVisible()
    await expect(form).toContainText('ឈ្មោះរបស់អ្នក')
    await expect(form).toContainText('បុគ្គលិករបស់យើងនឹងទាក់ទងអ្នកអំពីតម្លៃ និងពេលវេលាដឹកជញ្ជូន')
    const english = await form.evaluate((node) => (node.textContent || '').match(/\b(?:Your name|Phone number|Delivery address|Get QR|Checkout|optional)\b/g))
    expect(english, 'no English UI words on a Khmer checkout').toBeNull()
    await form.getByLabel('ឈ្មោះរបស់អ្នក').fill('សាក​ល្បង')
    await form.getByLabel('លេខទូរស័ព្ទ').fill('012 345 678')
    await form.getByRole('button', { name: 'ទទួលយក QR' }).click()
    await page.waitForURL(`**/order/${TOKEN}`)
    await expect(page.getByAltText('កូដ KHQR សម្រាប់បង់ $37.26')).toBeVisible()
    await expect(page.getByRole('timer')).toContainText('សូមបង់ក្នុងរយៈពេល')
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('km')
    const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main p, main li, main h1, main h2, main label, main button, main a')]
      .filter((node) => /[ក-៿]/.test(node.textContent || '') && getComputedStyle(node).display !== 'none')
      .filter((node) => {
        const style = getComputedStyle(node)
        const lineHeight = parseFloat(style.lineHeight)
        return Number.isFinite(lineHeight) && lineHeight < parseFloat(style.fontSize) * 1.25 && node.scrollHeight > node.clientHeight + 1
      })
      .map((node) => (node.textContent || '').slice(0, 40)))
    expect(clipped, 'Khmer lines whose box is shorter than their glyphs').toEqual([])
  })
})

test.describe('Phone width', () => {
  test('nothing scrolls sideways at 360 px: checkout, QR page and requests', async ({ page }) => {
    // CATCHES: a form, a QR card or a request row wider than a 360 px phone (a horizontal scroll bar on the payment screen).
    await mockOrders(page, ({ method, path }) => {
      if (method === 'POST' && path === '/') return { status: 201, json: { order: orderView(), token: TOKEN } }
      if (method === 'GET' && path === `/${TOKEN}`) return { json: { order: orderView() } }
      return { json: { state: 'awaiting_payment', revision: 1, paid_at: null, total_usd: 37.26 } }
    })
    await openCatalogue(page, { width: 360, height: 740 })
    await openDrawer(page)
    await page.getByRole('dialog', { name: 'My List' }).getByRole('button', { name: 'Checkout' }).click()
    const wide = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth)
    expect(await wide(), 'the checkout sheet').toBeLessThanOrEqual(0)
    const box = await sheet(page, 'Your order').boundingBox()
    expect(box && box.width).toBeLessThanOrEqual(360)
    await fillCheckout(page)
    await sheet(page, 'Your order').getByRole('button', { name: 'Get QR' }).click()
    await page.waitForURL(`**/order/${TOKEN}`)
    await expect(page.getByAltText('KHQR code to pay $37.26')).toBeVisible()
    expect(await wide(), 'the QR page').toBeLessThanOrEqual(0)
    const qr = await page.getByAltText('KHQR code to pay $37.26').boundingBox()
    expect(qr && qr.width, 'the QR is big enough to scan').toBeGreaterThanOrEqual(200)
  })
})

// Screenshots for the owner's review (360x740, English and Khmer). Off in normal runs: it only writes files when E2E_SHOTS_DIR is set.
test.describe('Screenshots', () => {
  const dir = process.env.E2E_SHOTS_DIR
  test.skip(!dir, 'set E2E_SHOTS_DIR to write the 360x740 screenshots')
  for (const language of ['en', 'km'] as const) {
    test(`360x740 screenshots, ${language}`, async ({ page }, info) => {
      test.skip(info.project.name !== 'android-chromium', 'one browser is enough for the review pictures')
      const shot = async (name: string) => { fs.mkdirSync(dir!, { recursive: true }); await page.screenshot({ path: path.join(dir!, `${name}-${language}.png`) }) }
      let phase: 'waiting' | 'expired' | 'paid' = 'waiting'
      let requests: Json[] = []
      await mockOrders(page, ({ method, path: p, body }) => {
        if (method === 'POST' && p === '/') return { status: 201, json: { order: orderView({ fulfilment: 'delivery', address: '12 Street 271, Phnom Penh' }), token: TOKEN } }
        if (p === `/${TOKEN}/status`) return { json: { state: phase === 'paid' ? 'paid' : 'awaiting_payment', revision: 1, paid_at: null, total_usd: 37.26 } }
        if (p === `/${TOKEN}/requests` && method === 'POST') {
          requests = [{ id: 5, kind: 'return', stage: 'paid', status: 'pending', staff_reply: null, comment: null, attachments: [], created_at: '2026-11-09 10:10:00.000' }]
          void body
          return { status: 201, json: { order: paidView({ requests, request_window_days: 7 }) } }
        }
        if (method === 'GET' && p === `/${TOKEN}`) {
          if (phase === 'paid') return { json: { order: paidView({ requests }) } }
          if (phase === 'expired') return { json: { order: orderView({ payment: { amount: 37.26, currency: 'USD', qr_string: QR_STRING, deeplink: null, expires_at: '2026-11-09 09:59:00.000' } }) } }
          return { json: { order: orderView({ fulfilment: 'delivery', address: '12 Street 271, Phnom Penh' }) } }
        }
        return undefined
      })
      await openCatalogue(page, { language, width: 360, height: 740 })
      await page.locator(`button[aria-label="${language === 'km' ? 'បញ្ជីរបស់ខ្ញុំ' : 'My List'}"]`).click()
      await page.waitForTimeout(300)
      await shot('1-cart')
      await page.locator('[role="dialog"] button:has(svg.lucide-qr-code)').click()
      await page.waitForTimeout(300)
      await shot('2-checkout-top')
      const body = page.locator('[role="dialog"] form > div').first()
      await body.evaluate((node) => { node.scrollTop = node.scrollHeight })
      await page.waitForTimeout(200)
      await shot('3-checkout-bottom')
      await page.locator('#order-name').fill(language === 'km' ? 'សាកល្បង' : 'Sample Buyer')
      await page.locator('#order-phone').fill('012 345 678')
      await page.locator('[role="dialog"] form button[type="submit"]').click()
      await page.waitForURL(`**/order/${TOKEN}`)
      await page.waitForSelector('img[alt]')
      await page.waitForTimeout(400)
      await shot('4-qr')
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(200)
      await shot('5-order-details')
      phase = 'expired'
      await page.reload({ waitUntil: 'load' })
      await page.waitForTimeout(500)
      await shot('6-expired')
      phase = 'paid'
      await page.reload({ waitUntil: 'load' })
      await page.waitForTimeout(500)
      await shot('7-paid')
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(200)
      await shot('8-requests')
    })
  }
})
