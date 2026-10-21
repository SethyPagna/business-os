'use strict'
// Revenue WITH and WITHOUT Not Paid (owner, 20 Oct 2026), what Not Paid still
// OWES (owner, 21 Oct 2026), and the money-taken figure ("collected"), on the
// REAL kernel over SQLite. One window holds every shape the brief names:
//
//   S1  Completed  $25.005, paid in full, $10 refunded in cash       revenue 15.005
//   S2  Not Paid   $30.005 + $2 delivery, deposit $3 + 4,100៛ ($1),
//                  $10 returned, all of it lowering the debt          revenue 20.005, owes 18.005
//   S3  Cancelled  $50                                                nothing
//   S4  Not Paid   $8, a pre-0260 return of $3 (no currency)          revenue 5, owes 5
//
//   revenue with Not Paid      15.005 + 20.005 + 5 = 40.01
//   revenue without Not Paid   15.005                -> 15.01 (rounded once)
//   Not Paid revenue           40.01 - 15.01         =  25.00 (rounded separately it is 25.01:
//                                                        the pair would not foot by a cent)
//   still owed                 18.005 + 5            -> 23.01
//   collected                  15.005 + 4 + 0        -> 19.01 (the old figure skipped Not Paid: 15.01)
//   profit with / without      16.01 / 5.01, Not Paid profit 11.00 (separately 11.01)
//
// Also: the customer report's "Collected total" is the kernel's (it ignored
// refunds: 25.01), product detail revenue is the ledger's (net of the receipt
// discount and the return), and the shift report and Telegram print both
// revenues and the amount still owed, in English and Khmer.
//
// Run (from cloudflare/): node scripts/test-revenue-not-paid-split-pure.cjs
const assert = require('node:assert/strict')
const { makeKernelWorld } = require('./harness/kernel_sqlite_world.cjs')

const DAY = '2026-10-20'
const FILTERS = { startDate: DAY, endDate: DAY }
let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`) }

function seed(world) {
  const { sqlite } = world
  sqlite.exec(`
    ALTER TABLE sales ADD COLUMN amount_paid_khr REAL;
    ALTER TABLE sales ADD COLUMN exchange_rate REAL;
    ALTER TABLE sales ADD COLUMN membership_points_redeemed REAL DEFAULT 0;
    ALTER TABLE sales ADD COLUMN subtotal_khr REAL DEFAULT 0;
    ALTER TABLE sales ADD COLUMN discount_khr REAL DEFAULT 0;
    ALTER TABLE sales ADD COLUMN membership_discount_khr REAL DEFAULT 0;
    ALTER TABLE sale_items ADD COLUMN total_khr REAL DEFAULT 0;
    ALTER TABLE sale_items ADD COLUMN cost_price_khr REAL;
    ALTER TABLE sale_items ADD COLUMN branch_id INTEGER DEFAULT 1;
    ALTER TABLE returns ADD COLUMN owed_reduction_usd REAL;
    ALTER TABLE returns ADD COLUMN refund_currency TEXT;
    ALTER TABLE returns ADD COLUMN branch_id INTEGER DEFAULT 1;
    ALTER TABLE return_items ADD COLUMN product_id INTEGER;
    ALTER TABLE return_items ADD COLUMN branch_id INTEGER;
    ALTER TABLE return_items ADD COLUMN total_khr REAL DEFAULT 0;
    ALTER TABLE return_items ADD COLUMN cost_price_khr REAL;
    INSERT INTO products(id,name) VALUES (1,'Serum'),(2,'Lipstick'),(3,'Toner'),(9,'Cream');
    INSERT INTO customers(id,name,phone) VALUES (7,'Dara','012'),(8,'Sok','013');
  `)
  const sale = sqlite.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,branch_name,customer_id,customer_name,payment_method,
    subtotal_usd,discount_usd,total_usd,delivery_fee_usd,delivery_fee_paid_by,is_delivery,amount_paid_usd,amount_paid_khr,exchange_rate)
    VALUES (@id,@at,@status,1,'Shop',@customer,@name,'Cash',@subtotal,@discount,@total,@delivery,'customer',@isDelivery,@paid,@paidKhr,4100)`)
  const base = { at: `${DAY} 03:00:00`, discount: 0, delivery: 0, isDelivery: 0, paidKhr: 0 }
  sale.run({ ...base, id: 1, status: 'completed', customer: 7, name: 'Dara', subtotal: 25.005, total: 25.005, paid: 25.005 })
  sale.run({ ...base, id: 2, status: 'awaiting_payment', customer: 7, name: 'Dara', subtotal: 30.005, total: 32.005, delivery: 2, isDelivery: 1, paid: 3, paidKhr: 4100 })
  sale.run({ ...base, id: 3, status: 'cancelled', customer: 7, name: 'Dara', subtotal: 50, total: 50, paid: 50 })
  sale.run({ ...base, id: 4, status: 'awaiting_payment', customer: 8, name: 'Sok', subtotal: 8, total: 8, paid: 0 })
  // A product sold once at $10 with a $2 receipt discount, then returned whole ($8 back; the line was $10).
  sale.run({ ...base, id: 5, at: '2026-09-10 03:00:00', status: 'completed', customer: 8, name: 'Sok', subtotal: 10, discount: 2, total: 8, paid: 8 })
  const item = sqlite.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd) VALUES (?,?,?,?,?,?,?)')
  item.run(1, 1, 1, 'Serum', 1, 25.005, 10)
  item.run(2, 2, 2, 'Lipstick', 1, 30.005, 12)
  item.run(3, 3, 1, 'Serum', 1, 50, 20)
  item.run(4, 4, 3, 'Toner', 1, 8, 4)
  item.run(5, 5, 9, 'Cream', 1, 10, 3)
  const ret = sqlite.prepare('INSERT INTO returns(id,sale_id,total_refund_usd,owed_reduction_usd,refund_currency) VALUES (?,?,?,?,?)')
  ret.run(1, 1, 10, 0, 'USD')
  ret.run(2, 2, 10, 10, 'USD')
  ret.run(4, 4, 3, null, null)
  ret.run(5, 5, 8, 0, 'USD')
  // Damaged lines: no restocked cost, so COGS stays the sold lines' cost.
  sqlite.exec(`INSERT INTO return_items(id,return_id,product_id,cost_price_usd,quantity,stock_action,total_usd) VALUES
    (1,1,1,10,0.4,'damaged',10),(5,5,9,3,1,'damaged',10)`)
}

async function main() {
  const world = makeKernelWorld()
  seed(world)
  const a = world.analytics
  const totals = await a.getSalesTotals(world.env, FILTERS)

  check('revenue WITH Not Paid is the canonical revenue (40.01)', () => assert.equal(totals.revenue_usd, 40.01))
  check('revenue WITHOUT Not Paid leaves out whole Not Paid sales, rounded once (15.01)', () => assert.equal(totals.revenue_without_not_paid_usd, 15.01))
  check('with - without = Not Paid to the cent (25.00, not the separately rounded 25.01)', () => {
    assert.equal(totals.pending_revenue_usd, 25)
    assert.equal(Math.round((totals.revenue_usd - totals.revenue_without_not_paid_usd) * 100), Math.round(totals.pending_revenue_usd * 100))
  })
  check('profit gets the same pair from the same pass (16.01 / 5.01 / 11.00)', () => {
    assert.equal(totals.profit_usd, 16.01)
    assert.equal(totals.profit_without_not_paid_usd, 5.01)
    assert.equal(totals.pending_profit_usd, 11)
  })
  check('still owed = total charged less deposits ($ and ៛) and the debt returns lowered, legacy rows included (23.01)', () =>
    assert.equal(totals.not_paid_owed_usd, 23.01))
  check('collected = money actually taken, Not Paid deposits included, cash refunds out (19.01)', () =>
    assert.equal(totals.collected_total_usd, 19.01))

  // The per-receipt, per-method and day-report views read the same collected rule.
  const snapshot = await a.readSalesReportSnapshot(world.env, FILTERS)
  check('payment-method and receipt rows split the same collected total', () => {
    const methods = a.paymentMethodBreakdownFromSnapshot(snapshot)
    assert.equal(methods.reduce((sum, row) => sum + row.collected_usd, 0).toFixed(4), '19.0050')
    const receipts = a.businessSummarySalesRowsFromSnapshot(snapshot)
    assert.deepEqual(receipts.map((row) => [row.id, row.collected_total_usd]), [[1, 15.005], [2, 4], [4, 0]])
  })

  const customer = await a.getCustomerSalesTotals(world.env, { ...FILTERS, customerId: 7 })
  const customerKernel = a.salesTotalsFromSnapshot(await a.readSalesReportSnapshot(world.env, FILTERS, false,
    (alias) => ({ sql: `${alias}.customer_id = @reportScope_c`, params: { reportScope_c: 7 } })))
  check('customer report "Collected total" equals the kernel for that customer (19.01, was 25.01)', () => {
    assert.equal(customer.collected_usd, customerKernel.collected_total_usd)
    assert.equal(customer.collected_usd, 19.01)
  })

  // Product detail: the ledger's net figure, not the raw line total.
  const dbShim = { getDb: () => ({ prepare(sql) { const stmt = world.sqlite.prepare(sql); return { all: async (p = {}) => stmt.all(p), get: async (p = {}) => stmt.get(p) } } }) }
  const ledger = world.load('src/lib/productSalesLedger.ts')
  const periods = { day: world.load('src/lib/businessDateWindow.ts').localDateExpr('s.created_at'), month: world.load('src/lib/businessDateWindow.ts').localMonthExpr('s.created_at') }
  const sept = await ledger.getProductSalesBreakdown(dbShim.getDb(), 9, { startDate: '2026-09-01', endDate: '2026-09-30' }, periods)
  check('product detail revenue is net of the receipt discount and the return ($0, was $10)', () => {
    assert.deepEqual(sept.by_day.map((row) => [row.period, row.revenue_usd, row.qty, row.sale_count]), [['2026-09-10', 0, 0, 1]])
    assert.deepEqual(sept.by_month.map((row) => [row.period, row.revenue_usd]), [['2026-09', 0]])
  })
  const october = await ledger.getProductSalesBreakdown(dbShim.getDb(), 1, FILTERS, periods)
  check('and equals the Inventory ledger for a sale with a cash refund (25.005 - 10 = 15.005 -> 15.01)', () =>
    assert.deepEqual(october.by_day.map((row) => [row.period, row.revenue_usd, row.sale_count]), [[DAY, 15.01, 1]]))

  // Shift report figures and Telegram lines.
  const shiftKernel = world.load('src/lib/shiftReconciliation.ts')
  const figures = shiftKernel.composeShiftFigures({ opening: null, counted: null, totals, expenses: null, deliveryFees: null, courier: null })
  check('shift figures carry both revenues, both profits, and the amount still owed', () => {
    assert.equal(figures.sales_usd, 40.01)
    assert.equal(figures.sales_without_not_paid_usd, 15.01)
    assert.equal(figures.profit_without_not_paid_usd, 5.01)
    assert.equal(figures.credit_usd, 23.01)
  })
  const lang = world.load('src/lib/telegramLang.ts')
  const telegram = world.load('src/lib/telegram.ts', { './db': dbShim })
  const shift = {
    shift_code: 'S-1020-01', scope_mode: 'per_account', user_id: 7, user_name: 'Za', branch_id: 1, branch_name: 'Shop',
    business_date: DAY, opened_at: `${DAY}T01:00:00.000Z`, opening_float_usd: 0, opening_float_khr: 0,
    closed_at: `${DAY}T12:00:00.000Z`, closing_counted_usd: 0, closing_counted_khr: 0,
  }
  const shiftFigures = {
    invoices: 3, cancelled: 1, edited: 0, revenueUsd: totals.revenue_usd, profitUsd: totals.profit_usd,
    revenueWithoutNotPaidUsd: totals.revenue_without_not_paid_usd, profitWithoutNotPaidUsd: totals.profit_without_not_paid_usd,
    deliveryFeeUsd: 2, deliveryCostUsd: 0, deliveryCostRecorded: 0, refundUsd: totals.refund_usd, creditUsd: totals.not_paid_owed_usd,
  }
  const inMode = (mode, build) => { const before = lang.getTelegramLanguage(); lang.setTelegramLanguage(mode); try { return build() } finally { lang.setTelegramLanguage(before) } }
  const english = inMode('en', () => telegram.formatShiftReport('Leang Cosmetics', shift, shiftFigures, Date.parse(`${DAY}T13:00:00Z`))).split('\n')
  const khmer = inMode('km', () => telegram.formatShiftReport('Leang Cosmetics', shift, shiftFigures, Date.parse(`${DAY}T13:00:00Z`))).split('\n')
  const row = (lines, label) => lines.find((line) => line.startsWith(`· ${label}:`))
  check('Telegram shift report (EN): Revenue, Revenue (paid only), Profit (paid only), Still owed', () => {
    assert.equal(row(english, 'Revenue'), '· Revenue: $40.01')
    assert.equal(row(english, 'Revenue (paid only)'), '· Revenue (paid only): $15.01')
    assert.equal(row(english, 'Profit (paid only)'), '· Profit (paid only): $5.01')
    assert.equal(row(english, 'Still owed'), '· Still owed: $23.01')
    assert.ok(!english.some((line) => line.startsWith('· Not Paid:')), 'the owed line no longer reads as Not Paid revenue')
  })
  check('Telegram shift report (KM): the same four lines in Khmer', () => {
    assert.equal(row(khmer, 'ចំណូល'), '· ចំណូល: $40.01')
    assert.equal(row(khmer, 'ចំណូល (បានបង់)'), '· ចំណូល (បានបង់): $15.01')
    assert.equal(row(khmer, 'ចំណេញ (បានបង់)'), '· ចំណេញ (បានបង់): $5.01')
    assert.equal(row(khmer, 'ប្រាក់នៅជំពាក់'), '· ប្រាក់នៅជំពាក់: $23.01')
  })
  const overviewFigures = {
    revenueUsd: totals.revenue_usd, profitUsd: totals.profit_usd, grossSalesUsd: totals.gross_sales_usd, itemDiscountUsd: 0, invoiceDiscountUsd: 0,
    revenueWithoutNotPaidUsd: totals.revenue_without_not_paid_usd, profitWithoutNotPaidUsd: totals.profit_without_not_paid_usd,
    deliveryFeeUsd: 2, creditUsd: totals.not_paid_owed_usd, refundUsd: totals.refund_usd, invoices: 3, cancelled: 1, paymentMethods: [],
    expenses: { fees: { usd: 0, khr: 0 }, deliveryFees: { usd: 0, khr: 0 }, courier: { usd: 0, khr: 0 } }, unbranchedFees: null,
    returns: { count: 0, refundUsd: 0 },
  }
  const overview = inMode('both', () => telegram.formatShiftOverview('Leang Cosmetics', shift, overviewFigures, undefined, Date.parse(`${DAY}T13:00:00Z`))).split('\n')
  check('Telegram after-shift overview (EN + KM): both revenues, paid-only profit, still owed', () => {
    const sep = lang.BILINGUAL_SEPARATOR
    assert.equal(row(overview, `Revenue (paid only)${sep}ចំណូល (បានបង់)`), `· Revenue (paid only)${sep}ចំណូល (បានបង់): $15.01`)
    assert.equal(row(overview, `Profit (paid only)${sep}ចំណេញ (បានបង់)`), `· Profit (paid only)${sep}ចំណេញ (បានបង់): $5.01`)
    assert.equal(row(overview, `Still owed${sep}ប្រាក់នៅជំពាក់`), `· Still owed${sep}ប្រាក់នៅជំពាក់: $23.01`)
  })
  const quiet = inMode('en', () => telegram.formatShiftReport('Leang Cosmetics', shift,
    { ...shiftFigures, revenueWithoutNotPaidUsd: 40.01, profitWithoutNotPaidUsd: 16.01, creditUsd: 0 }, Date.parse(`${DAY}T13:00:00Z`))).split('\n')
  check('a shift with no Not Paid sales prints no paid-only lines (concise)', () => {
    assert.equal(row(quiet, 'Revenue (paid only)'), undefined)
    assert.equal(row(quiet, 'Profit (paid only)'), undefined)
  })

  // The kernel reads "still owed" with exact rationals; it must say what the sale
  // screen's formula (saleStatusResolution recordedSaleOutstandingUsd, debt lowered as
  // returnRefundSplit plans it) says, to four places, on every shape.
  const resolution = world.load('src/lib/saleStatusResolution.ts')
  const cases = [
    { total: 32.005, paid: 3, khr: 4100, rate: 4100, returns: [[10, 10, 'USD']] },
    { total: 10, paid: 9.996, khr: 0, rate: null, returns: [] },             // short by 0.004: paid
    { total: 10, paid: 9.995, khr: 0, rate: null, returns: [] },             // short by exactly half a cent: paid
    { total: 10, paid: 9.9949, khr: 0, rate: null, returns: [] },            // short by 0.0051: owes
    { total: 20, paid: 0, khr: 10000, rate: 4123.45678, returns: [] },       // legacy rate quantized
    { total: 20, paid: 0, khr: 10000, rate: 4123.45678, v1: true, returns: [] }, // V1 rate exact
    { total: 15.3333, paid: 1.11114, khr: 333, rate: 4000, returns: [[3.33335, null, null], [1, 0.5, 'KHR']] },
    { total: 5, paid: 0, khr: 0, rate: 0, returns: [[2, 2, 'USD']] },        // no riel: an unreadable rate does not matter
    { total: 5, paid: 7, khr: 0, rate: 4100, returns: [] },                   // overpaid: owes nothing
  ]
  for (const [index, c] of cases.entries()) {
    const w = makeKernelWorld()
    w.sqlite.exec('ALTER TABLE sales ADD COLUMN amount_paid_khr REAL; ALTER TABLE sales ADD COLUMN exchange_rate REAL; ALTER TABLE returns ADD COLUMN owed_reduction_usd REAL; ALTER TABLE returns ADD COLUMN refund_currency TEXT')
    w.sqlite.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,subtotal_usd,total_usd,amount_paid_usd,amount_paid_khr,exchange_rate,
      money_precision_version,calculated_total_usd) VALUES (1,'${DAY} 03:00:00','awaiting_payment',1,?,?,?,?,?,?,?)`)
      .run(c.total, c.total, c.paid, c.khr, c.rate, c.v1 ? 1 : 0, c.v1 ? c.total : null)
    c.returns.forEach(([usd, owed, currency], i) => w.sqlite.prepare('INSERT INTO returns(id,sale_id,total_refund_usd,owed_reduction_usd,refund_currency) VALUES (?,1,?,?,?)').run(i + 1, usd, owed, currency))
    const kernelOwed = w.analytics.salesTotalsFromSnapshot(await w.analytics.readSalesReportSnapshot(w.env, FILTERS), 4).not_paid_owed_usd
    const lowered = c.returns.map(([usd, owed, currency]) => (currency == null ? usd : owed))
    const rielPaid = c.khr !== 0
    const formula = resolution.recordedSaleOutstandingUsd({ total_usd: c.total, amount_paid_usd: c.paid, amount_paid_khr: c.khr,
      exchange_rate: rielPaid || c.rate > 0 ? c.rate : 1, money_precision_version: c.v1 ? 1 : 0, calculated_total_usd: c.v1 ? c.total : null,
      refund_usd: resolution.sumRefundsUsd(lowered) })
    check(`still owed matches the sale screen's formula, case ${index + 1} (${formula})`, () => assert.equal(kernelOwed, formula))
  }

  console.log(`\n${passed} passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
