import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  MONEY_ORIGIN, adminCall, assertLoopback, ensureSettings, loadReady, lotQty, readState, signInAs, stockQty,
  type MoneyState, type Row, type Seed, type SeedLot, type SeedProduct,
} from '../support/moneyFixture'
import {
  addTenderRow, addToCart, attachCustomer, cartLine, closeStatusPicker, completeSale, openPos, openStatusPicker, setDelivery, setLinePrice,
  setOrderDiscount, setTender, showCart, statusOption, tapExact, totalRow,
} from '../support/posDriver'

/**
 * TIER "SYSTEM" -- the POS checkout, as a NON-admin cashier, against the real Worker and a real D1.
 *
 *   node cloudflare/scripts/e2e-money-fixture.cjs                      (needs frontend/dist; see e2e/README.md)
 *   cd frontend
 *   E2E_SYSTEM=1 npx playwright test e2e/system/pos-checkout.spec.ts --project=desktop-chromium --workers=1
 *
 * WHY THIS FILE EXISTS. pos-sale.spec.ts proves one thing: an administrator taps "Exact $" on one item. Almost every
 * way the till and the ledger can disagree lives elsewhere: a riel tender, change, a discount against tax, a price
 * typed over a price, a courier, a rate changed this morning, a customer's points, a nervous second tap. Each case
 * below rings the sale through the real till, then compares what the DATABASE holds -- totals, tender, payment rows,
 * status, customer, stock in the branch AND in the lot -- with numbers derived HERE, from the seed prices and the
 * owner's money rules. Nothing is read back from the app to grade the app.
 *
 * THE OWNER'S RULES THE ORACLE ENCODES (memory hub-sales-money.md and the notes it links)
 *   - Internal money is exact decimal at four places; the amount to pay is the NEAREST cent, half up, and the signed
 *     difference is kept (rounding_adjustment_usd).                        [displayed-money-nearest-cent, 24 Sep]
 *   - Tax is charged on the post-discount base, never on the delivery fee, and a fee only enters the total when the
 *     CUSTOMER pays it; a fee the shop pays "cancels out".                 [shop-paid-delivery-cancels-out, 24 Sep]
 *   - Revenue is net sales: subtotal - discount - membership discount, tax and delivery excluded, Not Paid sales
 *     counted and shown as credit.                                         [canonical-revenue-definition, 6 Sep]
 *   - A rate change applies from the moment it is saved; older sales keep theirs. [exchange-rate-changes-are-prospective]
 *   - Riel CASH comes in whole hundreds (no coin below 100) and is refused otherwise, in the Worker as well as the
 *     till; change handed back in riel is rounded DOWN to 100.            [owner-answers-27-oct #15; 31 Aug]
 *
 * Every state the cases read comes from /__fixture/state (raw rows). Cases are serial because they share one disposable
 * database; each measures its own before/after, so none depends on how many sales came before it.
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 })

// ---------------------------------------------------------------------------------------------------------------
// The oracle: exact integer arithmetic on four-decimal units (1 USD = 10,000 units), written from the rules above.
// ---------------------------------------------------------------------------------------------------------------
const UNITS = 10_000n
function units(usd: string): bigint {
  const [whole, fraction = ''] = usd.split('.')
  return BigInt(whole) * UNITS + BigInt((fraction + '0000').slice(0, 4))
}
const toUsd = (value: bigint): number => Number(value) / 10_000
const toKhr = (usdUnits: bigint, rate: number): number => Number(usdUnits * BigInt(rate)) / 10_000
/** The amount to pay: nearest cent, half up. */
const nearestCent = (value: bigint): bigint => ((value + 50n) / 100n) * 100n
/** A whole-number percent of an amount, rounded to the internal four places, half up. */
const percentOf = (amount: bigint, percent: number): bigint => (amount * BigInt(percent) + 50n) / 100n

type Basket = {
  lines: Array<{ unit: string; qty: number }>
  discount?: { percent: number } | { usd: string }
  membershipUsd?: string
  taxPercent?: number
  fee?: { usd: string; paidBy: 'customer' | 'store' }
  rate: number
}
function basket(input: Basket) {
  const subtotal = input.lines.reduce((sum, line) => sum + units(line.unit) * BigInt(line.qty), 0n)
  const discount = !input.discount ? 0n : 'percent' in input.discount ? percentOf(subtotal, input.discount.percent) : units(input.discount.usd)
  const membership = input.membershipUsd ? units(input.membershipUsd) : 0n
  const afterDiscount = subtotal - discount - membership
  const tax = input.taxPercent ? percentOf(afterDiscount, input.taxPercent) : 0n
  const fee = input.fee ? units(input.fee.usd) : 0n
  const calculated = afterDiscount + tax + (input.fee?.paidBy === 'customer' ? fee : 0n)
  const payable = nearestCent(calculated)
  const rate = input.rate
  return {
    subtotal: toUsd(subtotal), subtotalKhr: toKhr(subtotal, rate),
    discount: toUsd(discount), discountKhr: toKhr(discount, rate),
    membership: toUsd(membership), membershipKhr: toKhr(membership, rate),
    tax: toUsd(tax), taxKhr: toKhr(tax, rate),
    fee: toUsd(fee), feeKhr: toKhr(fee, rate),
    calculated: toUsd(calculated), rounding: toUsd(payable - calculated),
    total: toUsd(payable), totalKhr: toKhr(payable, rate), totalCents: Number(payable / 100n),
    /** Revenue contribution: net sales. Tax and delivery are not revenue. */
    netSales: toUsd(subtotal - discount - membership),
  }
}
const money = (value: number): string => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ---------------------------------------------------------------------------------------------------------------
// Shared fixtures of this file
// ---------------------------------------------------------------------------------------------------------------
let seed: Seed
let rose: SeedProduct, mint: SeedProduct, clay: SeedProduct, oat: SeedProduct
let revenueBaseline = { revenue: 0, pending: 0, withoutNotPaid: 0, owed: 0 }
/** Net revenue and Not Paid money of every sale THIS file rang, computed from the oracle, for the final reconcile. */
const ledger: Array<LedgerEntry> = []
/** net: revenue (subtotal - discounts); pending: the part of it that is Not Paid; owed: what Not Paid sales still owe. */
type LedgerEntry = { name: string; net: number; pending?: number; owed?: number }

const lotOf = (product: SeedProduct, code: string): SeedLot => {
  const lot = product.lots.find(l => l.code === code)
  if (!lot) throw new Error(`seed has no lot ${code}`)
  return lot
}
const SHOP = 1

test.beforeAll(async ({ request }) => {
  assertLoopback()
  const ready = await loadReady(request)
  seed = ready.seed
  const byName = (name: string) => seed.products.find(p => p.name === name)!
  rose = byName('M1 Rose Serum'); mint = byName('M1 Mint Balm'); clay = byName('M1 Clay Mask'); oat = byName('M1 Oat Soap')
  // The oracle is only as good as the seed it is fed: pin the inputs it assumes, so a changed seed fails here
  // by name instead of as a confusing money mismatch.
  expect([rose.priceUsd, mint.priceUsd, clay.priceUsd, oat.priceUsd]).toEqual([12.5, 4.75, 3.68, 2.2])
  expect(seed.exchangeRate).toBe(4000)
  // Two different URLs (limit only decides the 'more pages' flag, never the cohort) so neither read can be answered from the
  // other's cached copy: this case is about the revenue DEFINITION, not about cache invalidation.
  const stats = await adminCall(request, '/api/sales/stats?limit=100', 'GET')
  expect(stats.status).toBe(200)
  revenueBaseline = { revenue: Number(stats.body.revenue_usd), pending: Number(stats.body.pending_revenue_usd), withoutNotPaid: Number(stats.body.revenue_without_not_paid_usd), owed: Number(stats.body.not_paid_owed_usd) }
})

test.afterAll(async ({ request }) => {
  // Leave the shared fixture as the next spec expects it: tax off, the seed rate.
  await ensureSettings(request, { tax_enabled: 'false', exchange_rate: String(seed.exchangeRate) }).catch(() => undefined)
})

/** Money settings a case depends on, written through the real Settings route (idempotent). */
async function configure(request: APIRequestContext, wanted: { tax: boolean; rate: number }): Promise<void> {
  await ensureSettings(request, { tax_enabled: String(wanted.tax), exchange_rate: String(wanted.rate) })
}

async function signInAndOpenPos(page: Page): Promise<void> {
  await signInAs(page, 'cashier', seed)
  await openPos(page, seed)
}

/**
 * After the cashier presses Complete: wait for the sale to exist, and prove it is exactly ONE. A second tap, a retry
 * or a replayed request would show up here as two rows; waiting a beat after the first row appears is what gives a
 * duplicate time to arrive. If the till refuses instead, the toast is read back into the failure (it expires).
 */
async function expectOneNewSale(page: Page, request: APIRequestContext, before: MoneyState, entry: LedgerEntry) {
  let after: MoneyState = before
  await expect.poll(async () => {
    after = await readState(request)
    if (after.saleIds.length > before.saleIds.length) return 'recorded'
    const refusal = await page.getByRole('alert').first().innerText({ timeout: 1_000 }).catch(() => '')
    return refusal.trim() ? `the till refused: ${refusal.trim().replace(/\s+/g, ' ')}` : 'nothing yet'
  }, { message: 'POST /api/sales must have created the sale', timeout: 45_000 }).toBe('recorded')
  await page.waitForTimeout(1_000)
  after = await readState(request)
  expect(after.saleIds.length - before.saleIds.length, 'one tap must record ONE sale, never two').toBe(1)
  // Booked the moment the sale is known to exist, so the final reconcile stays truthful even if a later check fails.
  ledger.push(entry)
  const id = after.saleIds.find(candidate => !before.saleIds.includes(candidate))!
  const lines = after.lines.filter(line => line.sale_id === id)
  const lineIds = lines.map(line => line.id)
  return {
    id, before, after, lines,
    sale: after.sales.find(sale => sale.id === id)!,
    allocations: after.allocations.filter(row => lineIds.includes(row.sale_item_id)),
  }
}

/** Branch stock AND lot stock fall by exactly what was sold, from exactly the lot the cashier picked; nothing else moves. */
function expectStockMoved(before: MoneyState, after: MoneyState, moved: Array<{ product: SeedProduct; lot: SeedLot; qty: number }>): void {
  for (const row of before.stock) {
    const sold = moved.filter(m => m.product.id === row.product_id && m.lot.branchId === row.branch_id).reduce((sum, m) => sum + m.qty, 0)
    expect(stockQty(after, row.product_id, row.branch_id), `branch_stock of product ${row.product_id} at branch ${row.branch_id}`).toBe(Number(row.quantity) - sold)
  }
  for (const row of before.lots) {
    const sold = moved.filter(m => m.lot.id === row.batch_id).reduce((sum, m) => sum + m.qty, 0)
    expect(lotQty(after, row.batch_id), `branch_batch_stock of lot ${row.batch_id}`).toBe(Number(row.quantity) - sold)
  }
  expect(after.foreignKeyCheck).toEqual([])
}

/** Each line is stored with the lot it was sold from, and the allocation ledger agrees with it. */
function expectLines(lines: Row[], allocations: Row[], expected: Array<{ product: SeedProduct; lot: SeedLot; qty: number; unit: number; base?: number; manualDiscount?: number }>, rate: number): void {
  expect(lines).toHaveLength(expected.length)
  expected.forEach((want, index) => {
    const line = lines[index]
    const total = Number(units(String(want.unit)) * BigInt(want.qty)) / 10_000
    expect(line, `line ${index + 1}`).toMatchObject({
      product_id: want.product.id, product_name: want.product.name, quantity: want.qty, branch_id: SHOP,
      applied_price_usd: want.unit, base_price_usd: want.base ?? want.unit, manual_discount_usd: want.manualDiscount ?? 0,
      total_usd: total, total_khr: toKhr(units(String(total)), rate), batch_id: want.lot.id, batch_label: want.lot.code,
      // The cashier's till never receives cost (redacted); the sale must still snapshot the product's own cost.
      cost_price_usd: want.product.costUsd,
    })
    const allocation = allocations.filter(row => row.sale_item_id === line.id)
    expect(allocation, `allocation of line ${index + 1}`).toHaveLength(1)
    expect(allocation[0]).toMatchObject({ batch_id: want.lot.id, branch_id: SHOP, quantity: want.qty })
  })
}

/** The identity every sale this till rings carries. */
function expectRungByCashier(sale: Row): void {
  expect(sale).toMatchObject({ cashier_id: seed.actors.cashier.id, cashier_name: seed.actors.cashier.username, branch_id: SHOP, branch_name: 'Shop', money_precision_version: 1 })
}

/** The cashier is shown the receipt, and the number on it is the one Sales lists. */
async function expectReceiptShown(page: Page, sale: Row): Promise<void> {
  const receipt = String(sale.receipt_number)
  await expect(page.getByText(receipt).filter({ visible: true }).first(), 'the receipt handed to the cashier must carry the stored number').toBeVisible({ timeout: 30_000 })
  await page.goto(`${MONEY_ORIGIN}/sales`)
  await expect(page.getByText(receipt).filter({ visible: true }).first(), 'the new sale must be listed on Sales under its receipt number').toBeVisible({ timeout: 60_000 })
}

const paymentRows = (sale: Row): unknown => JSON.parse(String(sale.payment_details))

// ---------------------------------------------------------------------------------------------------------------
// 0. The shift gate. A non-admin has no shift on first sign-in; the till must not ring until one is registered.
// ---------------------------------------------------------------------------------------------------------------
test('a non-admin cashier meets the opening-cash gate, and registering a shift lifts it', async ({ page, request }) => {
  const before = await readState(request)
  const alreadyOpen = before.shifts.some(shift => shift.user_id === seed.actors.cashier.id && shift.closed_at == null && shift.cancelled_at == null)
  await signInAndOpenPos(page)
  const gate = page.getByText('Register opening cash').first()
  if (alreadyOpen) {
    // A second pass over a database that already holds today's shift: the gate must NOT come back.
    await expect(gate, 'a registered shift must not be asked for again').toBeHidden()
    return
  }
  // Wrong implementation caught: the gate exempting a cashier (it is meant for administrators only), or never showing.
  await expect(gate, 'a non-admin with no shift must be stopped by the opening-cash gate').toBeVisible()
  await page.getByLabel('Opening cash (USD)').fill('50')
  await page.getByLabel('Opening cash (KHR)').fill('200000')
  await page.getByRole('button', { name: 'Start shift' }).click()
  await expect(gate).toBeHidden()
  const after = await readState(request)
  const created = after.shifts.filter(shift => !before.shifts.some(old => old.id === shift.id))
  expect(created, 'registering writes exactly one shift').toHaveLength(1)
  expect(created[0]).toMatchObject({ user_id: seed.actors.cashier.id, opening_float_usd: 50, opening_float_khr: 200000, closed_at: null, scope_mode: 'per_account' })
})

// ---------------------------------------------------------------------------------------------------------------
// 1. Not Paid
// ---------------------------------------------------------------------------------------------------------------
test('Not Paid records the debt with no tender, no payment row, and the stock out of the shelf', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 2)
  const want = basket({ lines: [{ unit: '4.75', qty: 2 }], rate: 4000 })
  await expect(totalRow(page)).toContainText(money(want.total))
  // The picker offers Not Paid with nothing tendered.
  await openStatusPicker(page)
  await expect(statusOption(page, 'awaiting_payment')).toBeEnabled()
  await statusOption(page, 'awaiting_payment').click()
  const rung = await expectOneNewSale(page, request, before, { name: 'Not Paid', net: want.netSales, pending: want.netSales, owed: want.total })
  // Wrong implementations caught: Not Paid stored as Completed; a fabricated "Cash" payment row or an amount_paid equal to
  // the total; the stock not leaving the shelf (the picker promises "stock deducted"); the debt lost from the totals.
  expect(rung.sale).toMatchObject({
    sale_status: 'awaiting_payment', subtotal_usd: want.subtotal, discount_usd: 0, tax_usd: 0, total_usd: want.total, total_khr: want.totalKhr,
    amount_paid_usd: 0, amount_paid_khr: 0, change_usd: 0, change_khr: 0, payment_method: '', exchange_rate: 4000, customer_id: null, is_delivery: 0,
  })
  expect(paymentRows(rung.sale)).toEqual([])
  expectRungByCashier(rung.sale)
  expectLines(rung.lines, rung.allocations, [{ product: mint, lot, qty: 2, unit: 4.75 }], 4000)
  expectStockMoved(before, rung.after, [{ product: mint, lot, qty: 2 }])
  await expectReceiptShown(page, rung.sale)
})

// ---------------------------------------------------------------------------------------------------------------
// 2. Riel tender, whole hundreds
// ---------------------------------------------------------------------------------------------------------------
test('a riel cash tender in whole hundreds is recorded as riel, not converted to dollars', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 4)
  const want = basket({ lines: [{ unit: '4.75', qty: 4 }], rate: 4000 })
  expect(want.totalKhr % 100, 'oracle self-check: this total is a whole number of hundreds').toBe(0)
  await tapExact(page, 'khr')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'riel cash', net: want.netSales })
  // Wrong implementations caught: the riel tender converted to USD (amount_paid_usd = 19), payment_currency left as USD,
  // the payment row losing its riel amount, or change invented for an exact tender.
  expect(rung.sale).toMatchObject({
    sale_status: 'completed', total_usd: want.total, total_khr: 76000, amount_paid_usd: 0, amount_paid_khr: 76000, payment_currency: 'KHR',
    payment_method: 'Cash', change_usd: 0, change_khr: 0, exchange_rate: 4000,
  })
  expect(paymentRows(rung.sale)).toEqual([{ method: 'Cash', amount_usd: 0, amount_khr: 76000 }])
  expectRungByCashier(rung.sale)
  expectLines(rung.lines, rung.allocations, [{ product: mint, lot, qty: 4, unit: 4.75 }], 4000)
  expectStockMoved(before, rung.after, [{ product: mint, lot, qty: 4 }])
  await expectReceiptShown(page, rung.sale)
})

test('a 150 riel cash row is refused by the till and no sale is recorded', async ({ page, request }) => {
  // APP BUG, seen in the browser 3 Nov 2026 (desktop-chromium): the till offers Completed and sends the 150 riel cash row, and
  // POST /api/sales answers 200 -- no multiple-of-100 check on the cash path (frontend/src/components/pos/posCore.ts:24, cloudflare/src/routes/sales.ts:1259).
  // The case is declared expected-red only while that signature (ONE new sale in the database, holding the 150 riel row) is observed in
  // the run itself, below. Anything else that goes wrong (a timeout, a missing control) stays plainly red, and once the rule is enforced
  // the case simply passes. The evidence is the stored row, not the timing of one HTTP response, which a slow machine can miss.
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 1)
  // $4.71 + 150 riel = $4.7475 against $4.75: inside the half-cent band, so the tender "covers" the sale. That is the
  // trap -- the only thing wrong with it is a cash row no coin can make.
  await setTender(page, { method: 'Cash', usd: '4.71', khr: '150' })
  const posted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/sales' && r.request().method() === 'POST', { timeout: 45_000 }).catch(() => null)
  // Open the picker by hand: a till that refuses by greying "Completed" out has refused just as well as one that
  // sends the sale and is answered 400, and the shared completeSale() would wait forever for a disabled option.
  await openStatusPicker(page)
  const completed = statusOption(page, 'completed')
  await expect(completed).toBeVisible()
  const refusedByPicker = await completed.isDisabled()
  if (!refusedByPicker) await completed.click()
  // Either the till sends the sale (its answer arrives) or it refuses by itself (an alert); a till that does neither inside 45 s is
  // a failure of the case, not a refusal.
  const response = refusedByPicker ? null : await Promise.race([posted, page.getByRole('alert').first().waitFor({ timeout: 45_000 }).then(() => null, () => null)])
  await page.waitForTimeout(1_000)
  const after = await readState(request)
  const storedByTill = after.sales.find(row => !before.saleIds.includes(row.id))
  try {
    test.fail(
      after.saleIds.length - before.saleIds.length === 1 && storedByTill != null && JSON.stringify(paymentRows(storedByTill)) === JSON.stringify([{ method: 'Cash', amount_usd: 4.71, amount_khr: 150 }]),
      'owner rule 27 Oct #15 not enforced: till and POST /api/sales accept a 150 riel cash row (posCore.ts:24, sales.ts:1259)')
    // Wrong implementation caught: the 150 riel accepted (owner, 27 Oct: riel cash that is not a whole 100 is invalid on every cash path).
    if (response) expect(response.status(), 'a cash riel amount that is not a multiple of 100 must be refused').toBeGreaterThanOrEqual(400)
    expect(after.saleIds, 'no sale may be recorded').toEqual(before.saleIds)
    expectStockMoved(before, after, [])
    if (!refusedByPicker) await expect(page.getByRole('alert').first(), 'the cashier must be told why').toBeVisible()
  } finally {
    // If the sale WAS recorded the final revenue reconcile must still know about it.
    if (after.saleIds.length > before.saleIds.length) ledger.push({ name: '150 riel accepted (bug path)', net: basket({ lines: [{ unit: '4.75', qty: 1 }], rate: 4000 }).netSales })
  }
})

/**
 * One id per run. The Worker answers a repeated client_request_id with the sale it already holds (that is the replay rule the double-click
 * case relies on), so a fixed id would turn the second run against the same database into "no sale created" and could pass or fail a
 * case for the wrong reason.
 */
const RUN_ID = Date.now().toString(36)

/** A complete POST /api/sales body for one Mint Balm from the Shop lot, with the tender the case supplies. */
function saleBody(ready: { organizationId: number }, tender: { rows: Array<{ method: string; amount_usd: number; amount_khr: number }>; usd: number; khr: number; currency: string }, requestId: string, more: Record<string, unknown> = {}) {
  return {
    branch_id: SHOP, money_precision_version: 1, sale_status: 'completed', exchange_rate: 4000, client_request_id: `${requestId}-${RUN_ID}`,
    items: [{ product_id: mint.id, quantity: 1, branch_id: SHOP, batch_id: lotOf(mint, 'M1-MINT-SEP').id, client_line_key: 'line-1', pricing_source: 'selling',
      pricing_quote: { gross_usd: 4.75, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 4.75, total_khr: 19000 } }],
    subtotal_usd: 4.75, total_usd: 4.75, total_khr: 19000,
    payment_method: 'Cash', payment_details: tender.rows, payment_currency: tender.currency, amount_paid_usd: tender.usd, amount_paid_khr: tender.khr,
    offline_owner: { version: 1, actor_id: seed.actors.cashier.id, organization_id: ready.organizationId, authority: MONEY_ORIGIN, runtime: 'cloudflare-workers' },
    ...more,
  }
}
async function postSale(page: Page, body: unknown): Promise<{ status: number; body: any }> {
  return page.evaluate(async payload => {
    const response = await fetch('/api/sales', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('businessos_sync_token') || ''}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }, body)
}

test('the Worker refuses a 150 riel cash row sent straight to POST /api/sales, and takes the same sale with whole hundreds', async ({ page, request }) => {
  // APP BUG, seen in the browser 3 Nov 2026 (desktop-chromium): the whole-hundred control below is taken (200), and so is the
  // 150 riel cash row (200, a sale is created) -- the Worker normalises every payment row to whole riel and checks nothing more
  // (cloudflare/src/routes/sales.ts:1259; lib/paymentMethodRegistry.ts:273 isCashPaymentMethod already tells cash from digital).
  // Declared expected-red only while the signature (the 150 riel row answered 200) is observed below; once the rule is enforced it passes.
  const ready = await loadReady(request)
  await configure(request, { tax: false, rate: 4000 })
  await signInAs(page, 'cashier', seed)
  const before = await readState(request)
  // Positive control FIRST: the same body shape with $4.50 + 1,000 riel (= $4.75, a whole-hundred riel row) is a valid
  // sale. Without it a 4xx on the refused body could be nothing but a malformed request.
  const accepted = await postSale(page, saleBody(ready, { rows: [{ method: 'Cash', amount_usd: 4.5, amount_khr: 1000 }], usd: 4.5, khr: 1000, currency: 'MIXED' }, 'm1-whole-hundreds'))
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
  const afterControl = await readState(request)
  expect(afterControl.saleIds.length - before.saleIds.length).toBe(1)
  ledger.push({ name: 'control: whole-hundred riel row', net: 4.75 })
  // The refused body.
  let refusedStatus = 0
  try {
    const refused = await postSale(page, saleBody(ready, { rows: [{ method: 'Cash', amount_usd: 4.71, amount_khr: 150 }], usd: 4.71, khr: 150, currency: 'MIXED' }, 'm1-riel-150'))
    refusedStatus = refused.status
    test.fail(refused.status === 200, 'owner rule 27 Oct #15 not enforced in the Worker: POST /api/sales takes a 150 riel cash row (sales.ts:1259)')
    // Wrong implementation caught: backend validation missing -- the till refuses, the API takes it (frontend rule without backend enforcement).
    expect(refused.status, `the Worker must refuse a 150 riel cash row: ${JSON.stringify(refused.body)}`).toBe(400)
    const after = await readState(request)
    expect(after.saleIds, 'a refused request leaves no sale').toEqual(afterControl.saleIds)
    expectStockMoved(afterControl, after, [])
  } finally {
    if (refusedStatus === 200) ledger.push({ name: '150 riel accepted by the Worker (bug path)', net: 4.75 })
  }
})

test('a 150 riel amount on a bank method is not cash, so the whole-hundred rule does not apply and the Worker takes it', async ({ page, request }) => {
  const ready = await loadReady(request)
  await configure(request, { tax: false, rate: 4000 })
  await signInAs(page, 'cashier', seed)
  const before = await readState(request)
  // The mirror of the refused case above: the same $4.71 + 150 riel, but on the "Bank" method. The rule is about riel CASH
  // (no coin below 100); a transfer can carry any number. Wrong implementation caught: the hundreds rule applied to every method,
  // which is the easy over-correction when the 150 riel cash row is finally refused.
  const taken = await postSale(page, saleBody(ready, { rows: [{ method: 'Bank', amount_usd: 4.71, amount_khr: 150 }], usd: 4.71, khr: 150, currency: 'MIXED' }, 'm1-bank-150', { payment_method: 'Bank' }))
  expect(taken.status, JSON.stringify(taken.body)).toBe(200)
  const after = await readState(request)
  ledger.push({ name: 'bank row with 150 riel', net: 4.75 })
  expect(after.saleIds.length - before.saleIds.length).toBe(1)
  const sale = after.sales.find(row => !before.saleIds.includes(row.id))!
  expect(sale).toMatchObject({ sale_status: 'completed', total_usd: 4.75, amount_paid_usd: 4.71, amount_paid_khr: 150, payment_method: 'Bank' })
  expect(paymentRows(sale)).toEqual([{ method: 'Bank', amount_usd: 4.71, amount_khr: 150 }])
  expectStockMoved(before, after, [{ product: mint, lot: lotOf(mint, 'M1-MINT-SEP'), qty: 1 }])
})

// ---------------------------------------------------------------------------------------------------------------
// 2b. What "paid" means at its edges: nothing, one cent short, exact; a discount that eats more than the sale, and all of it
// ---------------------------------------------------------------------------------------------------------------
test('a tender one cent short cannot be recorded as Completed, by the till or the Worker, and Not Paid keeps the part payment', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const ready = await loadReady(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 1)
  // The picker follows the tender. Wrong implementations caught: Completed offered on an unpaid or short sale (the debt vanishes
  // from the Not Paid list), or Not Paid offered on a sale the customer has paid in full.
  await openStatusPicker(page)
  await expect(statusOption(page, 'completed'), 'nothing tendered').toBeDisabled()
  await expect(statusOption(page, 'awaiting_payment')).toBeEnabled()
  await closeStatusPicker(page)
  await setTender(page, { method: 'Cash', usd: '4.74' })
  await openStatusPicker(page)
  await expect(statusOption(page, 'completed'), 'one cent short').toBeDisabled()
  await expect(statusOption(page, 'awaiting_payment')).toBeEnabled()
  await closeStatusPicker(page)
  await setTender(page, { usd: '4.75' })
  await openStatusPicker(page)
  await expect(statusOption(page, 'completed'), 'the exact amount').toBeEnabled()
  await expect(statusOption(page, 'awaiting_payment'), 'a covered sale cannot be recorded as a debt').toBeDisabled()
  await closeStatusPicker(page)
  // The Worker holds the same line (frontend validation needs backend enforcement). Wrong implementation caught: the till
  // refusing while POST /api/sales takes a short tender as Completed.
  const before = await readState(request)
  const short = { rows: [{ method: 'Cash', amount_usd: 4.74, amount_khr: 0 }], usd: 4.74, khr: 0, currency: 'USD' }
  const refused = await postSale(page, saleBody(ready, short, 'm1-short-completed'))
  expect(refused.status, JSON.stringify(refused.body)).toBe(400)
  expect(refused.body).toMatchObject({ code: 'insufficient_payment_for_status' })
  expect((await readState(request)).saleIds, 'a refused request leaves no sale').toEqual(before.saleIds)
  // The same short tender, honestly recorded as Not Paid, keeps what was paid and owes the cent.
  const debt = await postSale(page, saleBody(ready, short, 'm1-short-notpaid', { sale_status: 'awaiting_payment' }))
  expect(debt.status, JSON.stringify(debt.body)).toBe(200)
  const after = await readState(request)
  ledger.push({ name: 'one cent short, Not Paid', net: 4.75, pending: 4.75, owed: 0.01 })
  expect(after.saleIds.length - before.saleIds.length).toBe(1)
  const sale = after.sales.find(row => !before.saleIds.includes(row.id))!
  expect(sale).toMatchObject({ sale_status: 'awaiting_payment', total_usd: 4.75, amount_paid_usd: 4.74, amount_paid_khr: 0, change_usd: 0, change_khr: 0 })
  expect(paymentRows(sale)).toEqual([{ method: 'Cash', amount_usd: 4.74, amount_khr: 0 }])
  expectStockMoved(before, after, [{ product: mint, lot, qty: 1 }])
})

test('a discount larger than the sale, or a negative one, is refused by the till and the Worker; one cent left is a valid sale', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const ready = await loadReady(request)
  const start = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 1)
  // The till: an impossible discount offers no total and records nothing, in dollars and in percent.
  for (const discount of [{ usd: '5.00' }, { percent: '101' }]) {
    await setOrderDiscount(page, discount)
    await expect(totalRow(page), 'no total is offered for an impossible discount').toContainText('—')
    // With no total to compare, the picker sees a zero sale and offers Completed; the click must still be refused.
    await openStatusPicker(page)
    await statusOption(page, 'completed').click()
    await expect(page.getByRole('alert').first(), 'the cashier is told why').toBeVisible()
    await page.waitForTimeout(500)
    expect((await readState(request)).saleIds, 'nothing may be recorded').toEqual(start.saleIds)
  }
  // The Worker. Positive control first: a $4.74 discount leaves one cent and is a valid Not Paid sale, so the refusals
  // below can only be about the discount.
  const none = { rows: [], usd: 0, khr: 0, currency: 'USD' }
  const valid = await postSale(page, saleBody(ready, none, 'm1-discount-474', { sale_status: 'awaiting_payment', discount_usd: 4.74 }))
  expect(valid.status, JSON.stringify(valid.body)).toBe(200)
  const afterControl = await readState(request)
  ledger.push({ name: 'control: $4.74 off $4.75', net: 0.01, pending: 0.01, owed: 0.01 })
  expect(afterControl.sales.find(row => !start.saleIds.includes(row.id))).toMatchObject({ subtotal_usd: 4.75, discount_usd: 4.74, total_usd: 0.01, total_khr: 40 })
  // Wrong implementations caught: a total below zero stored, or a negative discount used to raise the price.
  for (const [discount, label] of [[5, 'larger-than-the-sale'], [-1, 'negative']] as const) {
    const refused = await postSale(page, saleBody(ready, none, `m1-discount-${label}`, { sale_status: 'awaiting_payment', discount_usd: discount }))
    expect(refused.status, `a discount (${label}) must be refused: ${JSON.stringify(refused.body)}`).toBe(400)
  }
  const after = await readState(request)
  expect(after.saleIds, 'only the control was recorded').toEqual(afterControl.saleIds)
  expectStockMoved(start, after, [{ product: mint, lot, qty: 1 }])
})

test('a 100% discount rings a free sale as Completed with nothing tendered', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 1)
  await setOrderDiscount(page, { percent: '100' })
  const want = basket({ lines: [{ unit: '4.75', qty: 1 }], discount: { percent: 100 }, rate: 4000 })
  expect([want.discount, want.total, want.totalKhr, want.netSales]).toEqual([4.75, 0, 0, 0])
  await expect(totalRow(page)).toContainText(money(0))
  // Zero is covered by a zero tender: Completed is offered, and Not Paid (a debt of nothing) is not.
  await openStatusPicker(page)
  await expect(statusOption(page, 'completed')).toBeEnabled()
  await expect(statusOption(page, 'awaiting_payment')).toBeDisabled()
  await statusOption(page, 'completed').click()
  const rung = await expectOneNewSale(page, request, before, { name: '100% discount', net: want.netSales })
  // Wrong implementations caught: the sale refused for having no money in it, recorded as Not Paid, or stored with the
  // discount missing (total $4.75).
  expect(rung.sale).toMatchObject({ sale_status: 'completed', subtotal_usd: 4.75, discount_usd: 4.75, total_usd: 0, total_khr: 0, amount_paid_usd: 0, amount_paid_khr: 0, change_usd: 0, change_khr: 0 })
  expectStockMoved(before, rung.after, [{ product: mint, lot, qty: 1 }])
})

// ---------------------------------------------------------------------------------------------------------------
// 3. Mixed USD + KHR with change
// ---------------------------------------------------------------------------------------------------------------
test('a mixed dollar and riel tender records both amounts and the change both ways, shown to the cashier rounded down', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(clay, 'M1-CLAY-SEP')
  await addToCart(page, clay, lot, 2)
  const want = basket({ lines: [{ unit: '3.68', qty: 2 }], rate: 4000 })
  expect([want.total, want.totalKhr]).toEqual([7.36, 29440])
  // $5.00 + 20,000 riel = $10.00 handed over; surplus $2.64 = 10,560 riel at the 4,000 rate.
  await setTender(page, { method: 'Cash', usd: '5', khr: '20000' })
  // What the cashier is told to hand back: 10,560 riel exactly in "Use computed", and the CASH figure rounded DOWN to 10,500.
  // Wrong implementations caught: nearest (10,600) or up (10,600) -- the shop would hand out 40 riel more than the rule allows.
  await expect(page.getByText(/Use computed/)).toContainText('2.64')
  await expect(page.getByText(/Use computed/)).toContainText('10,560.00')
  await expect(page.getByText('Change (cash)').locator('xpath=..')).toContainText('10,500.00')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'mixed with computed change', net: want.netSales })
  expect(rung.sale).toMatchObject({
    sale_status: 'completed', total_usd: 7.36, total_khr: 29440, amount_paid_usd: 5, amount_paid_khr: 20000, payment_currency: 'MIXED',
    change_usd: 2.64, change_khr: 10560, change_is_actual: 0, exchange_rate: 4000,
  })
  expect(paymentRows(rung.sale)).toEqual([{ method: 'Cash', amount_usd: 5, amount_khr: 20000 }])
  expectRungByCashier(rung.sale)
  expectLines(rung.lines, rung.allocations, [{ product: clay, lot, qty: 2, unit: 3.68 }], 4000)
  expectStockMoved(before, rung.after, [{ product: clay, lot, qty: 2 }])
  await expectReceiptShown(page, rung.sale)
})

test('change the cashier actually hands back in riel is floored to 100 and stored as the actual change', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(clay, 'M1-CLAY-SEP')
  await addToCart(page, clay, lot, 2)
  await setTender(page, { method: 'Cash', usd: '5', khr: '20000' })
  // The cashier types the exact surplus; leaving the box floors it to the 100 riel note (the shop keeps the 60).
  const given = page.locator('#pos-change-given-khr')
  await given.fill('10560')
  await given.blur()
  await expect(given, 'riel change handed back is rounded DOWN to 100, never to the nearest').toHaveValue('10500')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'mixed with actual change', net: 7.36 })
  // Wrong implementations caught: change_is_actual lost (the computed 10,560 stored instead), the typed figure stored
  // unfloored, or a USD change invented alongside the riel one.
  expect(rung.sale).toMatchObject({ total_usd: 7.36, amount_paid_usd: 5, amount_paid_khr: 20000, change_usd: 0, change_khr: 10500, change_is_actual: 1, change_exchange_rate: 4000 })
  expectStockMoved(before, rung.after, [{ product: clay, lot, qty: 2 }])
  await expectReceiptShown(page, rung.sale)
})

test('a tender split over two payment rows keeps each row on its own method, so cash and bank money are never merged', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(rose, 'M1-ROSE-OCT')
  await addToCart(page, rose, lot, 1)
  const want = basket({ lines: [{ unit: '12.50', qty: 1 }], rate: 4000 })
  expect([want.total, want.totalKhr]).toEqual([12.5, 50000])
  // $5.00 in cash, and the other $7.50 as 30,000 riel on the bank row: exactly the sale, so no change either way.
  await setTender(page, { method: 'Cash', usd: '5' })
  await addTenderRow(page)
  await setTender(page, { method: 'Bank', khr: '30000' }, 2)
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'tender split over two rows', net: want.netSales })
  // Wrong implementations caught: the second row dropped (the sale is short, so Completed is refused or the cent debt lost);
  // both rows booked under the first method (bank money counted in the cash drawer at shift close); the bank riel converted
  // to dollars on the cash row; the two amounts not summed into amount_paid_*.
  expect(rung.sale).toMatchObject({
    sale_status: 'completed', total_usd: 12.5, total_khr: 50000, amount_paid_usd: 5, amount_paid_khr: 30000, payment_currency: 'MIXED',
    payment_method: 'Cash + Bank', change_usd: 0, change_khr: 0, exchange_rate: 4000,
  })
  expect(paymentRows(rung.sale)).toEqual([
    { method: 'Cash', amount_usd: 5, amount_khr: 0 },
    { method: 'Bank', amount_usd: 0, amount_khr: 30000 },
  ])
  expectRungByCashier(rung.sale)
  expectLines(rung.lines, rung.allocations, [{ product: rose, lot, qty: 1, unit: 12.5 }], 4000)
  expectStockMoved(before, rung.after, [{ product: rose, lot, qty: 1 }])
  await expectReceiptShown(page, rung.sale)
})

// ---------------------------------------------------------------------------------------------------------------
// 4. Discounts, against tax
// ---------------------------------------------------------------------------------------------------------------
test('a percent discount is taken before tax and the amount to pay is the nearest cent, with the adjustment kept', async ({ page, request }) => {
  await configure(request, { tax: true, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(rose, 'M1-ROSE-OCT') // the NEWER lot: oldest-first allocation would take M1-ROSE-AUG instead
  await addToCart(page, rose, lot, 2)
  await setOrderDiscount(page, { percent: '15' })
  const want = basket({ lines: [{ unit: '12.50', qty: 2 }], discount: { percent: 15 }, taxPercent: 10, rate: 4000 })
  // $25.00 - 15% ($3.75) = $21.25; tax 10% of that = $2.125; $23.375 pays as $23.38 (nearest, half up) and the +$0.005 is kept.
  expect([want.subtotal, want.discount, want.tax, want.calculated, want.total, want.rounding, want.totalKhr]).toEqual([25, 3.75, 2.125, 23.375, 23.38, 0.005, 93520])
  await expect(totalRow(page)).toContainText(money(want.total))
  await expect(totalRow(page)).toContainText(money(want.totalKhr))
  await tapExact(page, 'usd')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: '15% discount, taxed', net: want.netSales })
  // Wrong implementations caught: truncating to $23.37; the discount applied to the taxed amount; tax on the undiscounted $25.
  expect(rung.sale).toMatchObject({
    sale_status: 'completed', subtotal_usd: want.subtotal, discount_usd: want.discount, discount_khr: want.discountKhr, tax_usd: want.tax, tax_khr: want.taxKhr,
    calculated_total_usd: want.calculated, rounding_adjustment_usd: want.rounding, total_usd: want.total, total_khr: want.totalKhr,
    amount_paid_usd: want.total, amount_paid_khr: 0, change_usd: 0, change_khr: 0, exchange_rate: 4000,
  })
  expectRungByCashier(rung.sale)
  expectLines(rung.lines, rung.allocations, [{ product: rose, lot, qty: 2, unit: 12.5 }], 4000)
  expectStockMoved(before, rung.after, [{ product: rose, lot, qty: 2 }])
  await expectReceiptShown(page, rung.sale)
})

test('a dollar discount comes off before tax is charged, so tax is on the smaller amount', async ({ page, request }) => {
  await configure(request, { tax: true, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(rose, 'M1-ROSE-AUG')
  await addToCart(page, rose, lot, 2)
  await setOrderDiscount(page, { usd: '3.39' })
  const want = basket({ lines: [{ unit: '12.50', qty: 2 }], discount: { usd: '3.39' }, taxPercent: 10, rate: 4000 })
  // $25.00 - $3.39 = $21.61; tax 10% = $2.161; $23.771 pays as $23.77 and the -$0.001 is kept. Tax charged BEFORE the
  // discount would make it $25 + $2.50 - $3.39 = $24.11.
  expect([want.discount, want.tax, want.calculated, want.total, want.rounding, want.totalKhr]).toEqual([3.39, 2.161, 23.771, 23.77, -0.001, 95080])
  await tapExact(page, 'usd')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: '$3.39 discount, taxed', net: want.netSales })
  // Wrong implementations caught: tax on the undiscounted subtotal ($24.11); rounding the total UP ($23.78).
  expect(rung.sale).toMatchObject({
    subtotal_usd: 25, discount_usd: 3.39, discount_khr: want.discountKhr, tax_usd: 2.161, tax_khr: want.taxKhr, calculated_total_usd: 23.771,
    rounding_adjustment_usd: -0.001, total_usd: 23.77, total_khr: 95080, amount_paid_usd: 23.77, exchange_rate: 4000,
  })
  expectLines(rung.lines, rung.allocations, [{ product: rose, lot, qty: 2, unit: 12.5 }], 4000)
  expectStockMoved(before, rung.after, [{ product: rose, lot, qty: 2 }])
  await expectReceiptShown(page, rung.sale)
})

test('the summary the cashier reads foots: subtotal - discount + tax is the total, each line at the nearest cent', async ({ page, request }) => {
  // APP BUG, seen in the browser 3 Nov 2026 (desktop-chromium): the Tax line reads "$2.17" for a stored tax of 2.161 (total 23.77), so
  // the summary lines add to 23.78. fmtUSD formats with normalizePriceValue, which rounds UP (frontend/src/AppContext.tsx:2760 ->
  // frontend/src/utils/pricing.ts:22 roundUpToDecimals); owner rule 24 Sep: displayed money rounds to the NEAREST cent, only selling
  // prices round up. Declared expected-red only while that signature (the line reads $2.17) is observed below; once the display follows
  // the rule the case passes with no edit, and a timeout or a missing line stays plainly red.
  await configure(request, { tax: true, rate: 4000 })
  await signInAndOpenPos(page)
  await addToCart(page, rose, lotOf(rose, 'M1-ROSE-AUG'), 2)
  await setOrderDiscount(page, { usd: '3.39' })
  const want = basket({ lines: [{ unit: '12.50', qty: 2 }], discount: { usd: '3.39' }, taxPercent: 10, rate: 4000 })
  await expect(totalRow(page)).toContainText(money(want.total))
  // Owner rule (24 Sep): displayed money rounds to the NEAREST cent. Tax of $2.161 reads $2.16, so 25.00 - 3.39 + 2.16
  // = 23.77 foots. Shown rounded UP ($2.17) the lines add to $23.78 and disagree with the total beside them by a cent.
  // Wrong implementation caught: a display formatter that rounds up (utils/pricing.ts roundUpToDecimals via fmtUSD).
  const taxLine = page.getByText(/^Tax \(10%\)/).locator('xpath=..')
  const shownTax = await taxLine.innerText({ timeout: 15_000 })
  test.fail(/\$2\.17(?!\d)/.test(shownTax), 'displayed money rounds UP, owner rule 24 Sep says nearest: Tax $2.161 reads $2.17 (AppContext.tsx:2760, pricing.ts:22)')
  await expect(taxLine).toContainText('$2.16')
  await expect(taxLine).not.toContainText('$2.17')
})

// ---------------------------------------------------------------------------------------------------------------
// 5. A price typed over a price
// ---------------------------------------------------------------------------------------------------------------
test('a line price override sets the selling price: base and applied move together and no discount is invented', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(clay, 'M1-CLAY-SEP')
  await addToCart(page, clay, lot, 3)
  await setLinePrice(page, clay.name, '3.20')
  const want = basket({ lines: [{ unit: '3.20', qty: 3 }], rate: 4000 })
  expect([want.total, want.totalKhr]).toEqual([9.6, 38400])
  await expect(cartLine(page, clay.name)).toContainText(money(9.6))
  await tapExact(page, 'usd')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'price override', net: want.netSales })
  // Wrong implementations caught: the typed price recorded as a "fixed discount of base - typed" (base 3.68, manual_discount 0.48),
  // the catalogue price charged instead of the typed one, or the riel price left at the catalogue figure.
  expect(rung.sale).toMatchObject({ sale_status: 'completed', subtotal_usd: 9.6, discount_usd: 0, total_usd: 9.6, total_khr: 38400, amount_paid_usd: 9.6 })
  expectLines(rung.lines, rung.allocations, [{ product: clay, lot, qty: 3, unit: 3.2, base: 3.2, manualDiscount: 0 }], 4000)
  expect(rung.lines[0]).toMatchObject({ applied_price_khr: 12800, base_price_khr: 12800 })
  expectStockMoved(before, rung.after, [{ product: clay, lot, qty: 3 }])
  await expectReceiptShown(page, rung.sale)
})

// ---------------------------------------------------------------------------------------------------------------
// 6. A customer
// ---------------------------------------------------------------------------------------------------------------
test('an attached customer is stored on the sale with their identity, and the membership panel shows the balance', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 2)
  await attachCustomer(page, seed.customer.name)
  await expect(page.getByText(seed.customer.membershipNumber).first()).toBeVisible()
  await expect(page.getByText(`${seed.customer.points}`, { exact: false }).filter({ hasText: /pts/ }).first(), 'the points balance comes from the ledger').toBeVisible()
  const want = basket({ lines: [{ unit: '4.75', qty: 2 }], rate: 4000 })
  await tapExact(page, 'usd')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'customer attached', net: want.netSales })
  // Wrong implementations caught: the sale recorded as a walk-in (customer_id null), the typed name stored without the link,
  // or the membership discount applied without points being redeemed.
  expect(rung.sale).toMatchObject({
    sale_status: 'completed', customer_id: seed.customer.id, customer_name: seed.customer.name, customer_phone: seed.customer.phone,
    total_usd: want.total, membership_discount_usd: 0, membership_points_redeemed: 0, amount_paid_usd: want.total,
  })
  expectStockMoved(before, rung.after, [{ product: mint, lot, qty: 2 }])
  await expectReceiptShown(page, rung.sale)
})

test('redeeming a membership unit takes its dollars off the total and the points off the customer, before tax', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 2)
  await attachCustomer(page, seed.customer.name)
  await expect(page.getByText('1 unit = 100 points = $1.00')).toBeVisible()
  await page.locator('#pos-membership-redeem-units').fill('1')
  const want = basket({ lines: [{ unit: '4.75', qty: 2 }], membershipUsd: '1.00', rate: 4000 })
  expect([want.total, want.totalKhr, want.netSales]).toEqual([8.5, 34000, 8.5])
  await expect(totalRow(page)).toContainText(money(want.total))
  await tapExact(page, 'usd')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'membership redemption', net: want.netSales })
  // Wrong implementations caught: the discount shown but not stored (total $9.50), points not recorded as redeemed (the same
  // 100 points spendable again), or the membership dollars booked as a store discount.
  expect(rung.sale).toMatchObject({
    customer_id: seed.customer.id, subtotal_usd: 9.5, discount_usd: 0, membership_discount_usd: 1, membership_discount_khr: 4000,
    membership_points_redeemed: 100, total_usd: 8.5, total_khr: 34000, amount_paid_usd: 8.5,
  })
  expectStockMoved(before, rung.after, [{ product: mint, lot, qty: 2 }])
  await expectReceiptShown(page, rung.sale)
})

// ---------------------------------------------------------------------------------------------------------------
// 7. Delivery
// ---------------------------------------------------------------------------------------------------------------
test('a customer-paid delivery fee is added to the total after tax is figured on the goods alone, and the courier is recorded', async ({ page, request }) => {
  await configure(request, { tax: true, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 2)
  await setDelivery(page, { courier: seed.courier.name, feeUsd: '1.57', paidBy: 'Customer', costUsd: '1.00' })
  const want = basket({ lines: [{ unit: '4.75', qty: 2 }], taxPercent: 10, fee: { usd: '1.57', paidBy: 'customer' }, rate: 4000 })
  // Goods $9.50, tax 10% = $0.95 (on the goods, NOT the fee), fee $1.57: $12.02. Taxing the fee too would make it $12.18 - $0.157.
  expect([want.tax, want.fee, want.total, want.totalKhr]).toEqual([0.95, 1.57, 12.02, 48080])
  await expect(totalRow(page)).toContainText(money(want.total))
  await tapExact(page, 'usd')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'delivery, customer pays', net: want.netSales })
  // Wrong implementations caught: the fee left out of the total, tax charged on the fee, the courier cost missing or
  // swapped with the fee, the fee's riel figure at another rate.
  expect(rung.sale).toMatchObject({
    sale_status: 'completed', is_delivery: 1, delivery_contact_id: seed.courier.id, delivery_contact_name: seed.courier.name, delivery_contact_phone: seed.courier.phone,
    delivery_fee_usd: 1.57, delivery_fee_khr: want.feeKhr, delivery_fee_paid_by: 'customer', delivery_actual_cost_usd: 1, delivery_actual_cost_khr: 4000,
    subtotal_usd: 9.5, tax_usd: 0.95, total_usd: 12.02, total_khr: 48080, amount_paid_usd: 12.02,
  })
  expectStockMoved(before, rung.after, [{ product: mint, lot, qty: 2 }])
  await expectReceiptShown(page, rung.sale)
})

test('a shop-paid delivery fee is recorded but never billed: the customer pays the goods and tax only', async ({ page, request }) => {
  await configure(request, { tax: true, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(mint, 'M1-MINT-SEP')
  await addToCart(page, mint, lot, 2)
  await setDelivery(page, { courier: seed.courier.name, feeUsd: '1.57', paidBy: 'Store', costUsd: '1.00' })
  const want = basket({ lines: [{ unit: '4.75', qty: 2 }], taxPercent: 10, fee: { usd: '1.57', paidBy: 'store' }, rate: 4000 })
  expect([want.total, want.totalKhr]).toEqual([10.45, 41800])
  await expect(totalRow(page)).toContainText(money(want.total))
  await tapExact(page, 'usd')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'delivery, shop pays', net: want.netSales })
  // Wrong implementation caught: the shop-paid fee added to the customer's total as well ($12.02), which the owner ruled
  // "cancels out" -- it is the courier cost, not the fee, that the business counts.
  expect(rung.sale).toMatchObject({
    is_delivery: 1, delivery_fee_usd: 1.57, delivery_fee_khr: want.feeKhr, delivery_fee_paid_by: 'store', delivery_actual_cost_usd: 1,
    subtotal_usd: 9.5, tax_usd: 0.95, total_usd: 10.45, total_khr: 41800, amount_paid_usd: 10.45,
  })
  expectStockMoved(before, rung.after, [{ product: mint, lot, qty: 2 }])
  await expectReceiptShown(page, rung.sale)
})

// ---------------------------------------------------------------------------------------------------------------
// 8. The rate, changed before the sale
// ---------------------------------------------------------------------------------------------------------------
test('a rate changed before the sale prices the new sale at the new rate and leaves every older sale on its own', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4150 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(rose, 'M1-ROSE-AUG')
  await addToCart(page, rose, lot, 1)
  const want = basket({ lines: [{ unit: '12.50', qty: 1 }], rate: 4150 })
  expect([want.total, want.totalKhr]).toEqual([12.5, 51875])
  await expect(totalRow(page), 'the till must show the NEW rate').toContainText(money(want.totalKhr))
  await tapExact(page, 'usd')
  await completeSale(page, 'completed')
  const rung = await expectOneNewSale(page, request, before, { name: 'rate changed', net: want.netSales })
  // Wrong implementations caught: the old rate (50,000) or the schema default 4,100 (51,250) used for the new sale; and the
  // reverse failure, older sales restated at today's rate.
  expect(rung.sale).toMatchObject({ exchange_rate: 4150, total_usd: 12.5, total_khr: 51875, subtotal_khr: 51875, amount_paid_usd: 12.5 })
  expect(rung.lines[0]).toMatchObject({ applied_price_khr: 51875, total_khr: 51875, batch_id: lot.id })
  expectStockMoved(before, rung.after, [{ product: rose, lot, qty: 1 }])
  const older = rung.after.sales.filter(sale => sale.id !== rung.id && sale.exchange_rate === 4000)
  expect(older.length, 'earlier cases in this file rang sales at 4,000').toBeGreaterThan(0)
  for (const sale of older) expect(Number(sale.total_khr), `sale ${sale.receipt_number} keeps its own rate`).toBeCloseTo(Number(sale.total_usd) * 4000, 3)
  await expectReceiptShown(page, rung.sale)
})

// ---------------------------------------------------------------------------------------------------------------
// 9. One tap, one sale
// ---------------------------------------------------------------------------------------------------------------
test('a double click while the server is slow sends one request and records one sale, and replaying it returns that sale', async ({ page, request }) => {
  await configure(request, { tax: false, rate: 4000 })
  const before = await readState(request)
  await signInAndOpenPos(page)
  const lot = lotOf(oat, 'M1-OAT-SEP')
  await addToCart(page, oat, lot, 1)
  const sent: unknown[] = []
  // The server answers after 2.5 s, which is the window a nervous cashier taps again in.
  await page.route('**/api/sales', async route => {
    if (route.request().method() === 'POST') { sent.push(route.request().postDataJSON()); await new Promise(resolve => setTimeout(resolve, 2_500)) }
    await route.continue()
  })
  await tapExact(page, 'usd')
  await openStatusPicker(page)
  await statusOption(page, 'completed').dblclick()
  const rung = await expectOneNewSale(page, request, before, { name: 'double click', net: 2.2 })
  // Wrong implementations caught: a second POST (two sales, stock out twice), or a retry that mints a fresh request id.
  expect(sent, 'the till must send ONE create request for one sale').toHaveLength(1)
  expect(rung.sale).toMatchObject({ total_usd: 2.2, total_khr: 8800, amount_paid_usd: 2.2, sale_status: 'completed' })
  expectStockMoved(before, rung.after, [{ product: oat, lot, qty: 1 }])
  // The network-drop-after-commit retry: the same body again must hand back the SAME sale and add nothing.
  await page.unroute('**/api/sales')
  const replay = await postSale(page, sent[0])
  expect(replay.status, JSON.stringify(replay.body)).toBe(200)
  expect(replay.body).toMatchObject({ duplicate: true, id: rung.id })
  const after = await readState(request)
  expect(after.saleIds, 'the replay must not record a second sale').toEqual(rung.after.saleIds)
  expectStockMoved(before, after, [{ product: oat, lot, qty: 1 }])
  await expectReceiptShown(page, rung.sale)
})

// ---------------------------------------------------------------------------------------------------------------
// 10. Revenue, by the owner's definition
// ---------------------------------------------------------------------------------------------------------------
test('the Sales revenue figure is net sales of what this file rang: tax and delivery out, Not Paid in and shown as credit', async ({ request }) => {
  const stats = await adminCall(request, '/api/sales/stats?limit=101', 'GET')
  expect(stats.status).toBe(200)
  const sum = (items: number[]) => items.reduce((total, value) => total + units(String(value)), 0n)
  const net = toUsd(sum(ledger.map(entry => entry.net)))
  const pending = toUsd(sum(ledger.map(entry => entry.pending ?? 0)))
  const owed = toUsd(sum(ledger.map(entry => entry.owed ?? 0)))
  // Wrong implementations caught: revenue summed from total_usd (tax and the customer-paid fee leak in), Not Paid dropped from
  // revenue, a shop-paid fee counted, membership dollars not taken off.
  expect(Number(stats.body.revenue_usd) - revenueBaseline.revenue, `revenue of ${ledger.map(entry => entry.name).join(', ')}`).toBeCloseTo(net, 4)
  expect(Number(stats.body.pending_revenue_usd) - revenueBaseline.pending, 'Not Paid sales are counted in revenue and annotated as credit').toBeCloseTo(pending, 4)
  expect(Number(stats.body.revenue_without_not_paid_usd) - revenueBaseline.withoutNotPaid).toBeCloseTo(net - pending, 4)
  expect(Number(stats.body.not_paid_owed_usd) - revenueBaseline.owed, 'what the Not Paid sales still owe').toBeCloseTo(owed, 4)
})
