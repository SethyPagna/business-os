'use strict'
// The Expenses list that also shows the courier cost recorded on sales (6.0.1053). The page asks for it (`source=all`) and it is on by
// default: this is the owner's feature, not an optimisation, so there is no switch. A request without `source` is the old list.
//
// What the owner asked: "show expenses attached to sales here as well ... all expenses like delivery etc, not cost of goods".
// The canonical Expenses definition (Telegram shift report / day summary / overview, shift reconciliation) is every fees row plus
// the courier payouts read off non-cancelled sales by courierPayoutsWhere, a payout also recorded as a delivery-typed fee counted
// ONCE. This test wires the new list to that definition and proves, on the REAL kernel over the full migration chain:
//   - totals parity: the fee half equals Reports overview `expenses.totals`; the sale half equals courierPayoutsWhere, the kernel's
//     recognized delivery cost and the sum of the rows; fee half + sale half is the Telegram "Expenses" total;
//   - what is NOT an expense stays out: cost of goods, the waived shop-paid delivery FEE, a cancelled sale, a $0 or NULL cost,
//     the sale-side twin of a delivery fee;
//   - no `source` (and `source=recorded`) = the exact old list (compared with a verbatim copy of the base handler over a matrix), so an
//     older client never meets a sale row;
//   - the three figures the page shows are named and equal their counterparts: Recorded expenses = Reports overview expenses, Courier
//     cost (USD and riel apart) = courierPayoutsWhere, Total = Telegram "Expenses";
//   - no courier cost for a caller without `sales:view_courier_cost`: no row, no count, no amount anywhere in the body;
//   - paging by the merge keeps the true total and every row exactly once;
//   - mutation controls: each plausible wrong implementation turns a check red.
//
// Run (from cloudflare/): node scripts/test-expenses-sale-rows-native.cjs
const assert = require('node:assert/strict')
const { createFeesWorld } = require('./harness/fees_world.cjs')

let passed = 0
let quiet = false
async function check(name, run) { await run(); if (!quiet) { passed += 1; console.log(`PASS ${name}`) } }

const RANGE = 'from=2026-10-10&to=2026-10-12'
const COGS_MARKER = 987.65

function seed(w) {
  w.sql.exec(`
    INSERT INTO branches (id, name, role, is_active) VALUES (1, 'Store', 'shop', 1), (2, 'Second', 'shop', 1);
    INSERT INTO delivery_contacts (id, name) VALUES (5, 'Courier A');
  `)
  const sale = w.sql.prepare(`INSERT INTO sales (id, created_at, sale_status, branch_id, receipt_number, total_usd, subtotal_usd,
      delivery_fee_usd, delivery_fee_paid_by, delivery_actual_cost_usd, delivery_actual_cost_khr, is_delivery, delivery_contact_id, delivery_contact_name)
    VALUES (@id, @created_at, @status, @branch, @receipt, 20, 20, @fee, @paid_by, @usd, @khr, @delivery, @contact, @contact_name)`)
  const rows = [
    // id, created (UTC), status, branch, receipt, courier usd, courier riel twin, shop-paid fee, contact
    [1, '2026-10-10 03:00:00', 'completed', 1, 'R-0001', 3, 12300, 0, 5],
    [2, '2026-10-10 04:00:00', 'completed', 1, 'R-0002', null, 20000, 0, null],
    [3, '2026-10-10 05:00:00', 'cancelled', 1, 'R-0003', 7, 28700, 0, 5],
    [4, '2026-10-11 03:00:00', 'completed', 1, 'R-0004', 5, 20500, 0, 5],
    [5, '2026-10-11 04:00:00', 'completed', 1, 'R-0005', 0, 0, 0, null],
    [6, '2026-10-11 05:00:00', 'completed', 1, 'R-0006', null, null, 1.5, null],
    [7, '2026-10-12 03:00:00', 'awaiting_payment', 1, 'R-0007', 2, 8200, 0, 5],
    [8, '2026-10-20 03:00:00', 'completed', 1, 'R-0008', 9, 36900, 0, 5],
    [9, '2026-10-11 06:00:00', 'completed', 2, 'R-0009', 4, 16400, 0, null],
  ]
  for (const [id, created_at, status, branch, receipt, usd, khr, fee, contact] of rows) {
    sale.run({ id, created_at, status, branch, receipt, usd, khr, fee, paid_by: fee ? 'store' : 'customer', delivery: usd == null && khr == null ? 0 : 1, contact, contact_name: contact ? 'Courier A' : null })
  }
  // Cost of goods: a priced sale line. It must not surface as an expense anywhere.
  w.sql.exec(`INSERT INTO sale_items (sale_id, product_name, quantity, total_usd, cost_price_usd) VALUES (1, 'Serum', 1, 20, ${COGS_MARKER}), (9, 'Soap', 1, 20, ${COGS_MARKER})`)
  const fee = w.sql.prepare(`INSERT INTO fees (id, fee_type, label, amount_usd, amount_khr, fee_date, sale_id, branch_id, created_by, created_at, updated_at)
    VALUES (@id, @type, @label, @usd, @khr, @date, @sale, @branch, 2, @created, @created)`)
  for (const row of [
    [1, 'other', 'Tape', 2, 0, '2026-10-10', null, 1, '2026-10-10 06:00:00'],
    // sale 4's courier cost is ALSO recorded as this delivery fee: the sale-side copy must not count again
    [2, 'delivery', 'Courier A', 5, 0, '2026-10-11', 4, 1, '2026-10-11 05:00:00'],
    [3, 'tax', null, 1, 0, '2026-10-12', null, 1, '2026-10-12 02:00:00'],
    [4, 'expense', 'Ice', 0, 8000, '2026-10-10', null, 1, '2026-10-10 08:00:00'],
    [5, 'other', 'Tape', 6, 0, '2026-10-20', null, 1, '2026-10-20 02:00:00'],
    [6, 'other', 'Soap', 1, 0, '2026-10-11', null, 2, '2026-10-11 07:00:00'],
  ]) fee.run({ id: row[0], type: row[1], label: row[2], usd: row[3], khr: row[4], date: row[5], sale: row[6], branch: row[7], created: row[8] })
}

// The base's GET /api/fees handler, verbatim (736929e91): the oracle for "switch off = the exact old list".
async function oldList(w, query) {
  const fees = w.load('routes/fees.ts')
  const db = w.raw
  const { search, fee_type: feeType, sale_id: saleId, branch_id: branchId, delivery_contact_id: deliveryContactId, limit: limitParam, offset: offsetParam } = query
  const range = fees.feeRangePredicate(query)
  const conditions = [range.sql]
  const params = { ...range.params }
  if (search && search.trim()) { conditions.push('(f.label LIKE @search OR f.notes LIKE @search OR f.fee_type LIKE @search)'); params.search = `%${search.trim()}%` }
  if (feeType && feeType.trim() && feeType !== 'all') { conditions.push('f.fee_type = @feeType'); params.feeType = String(feeType).trim().toLowerCase() }
  if (saleId && saleId.trim()) { conditions.push('f.sale_id = @saleId'); params.saleId = Number(saleId) }
  if (branchId && branchId.trim()) { conditions.push('f.branch_id = @branchId'); params.branchId = Number(branchId) }
  if (deliveryContactId && deliveryContactId.trim()) { conditions.push('f.delivery_contact_id = @deliveryContactId'); params.deliveryContactId = Number(deliveryContactId) }
  const where = `WHERE ${conditions.join(' AND ')}`
  const toNumber = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d }
  const limit = Math.min(Math.max(toNumber(limitParam, 100), 1), 500)
  const offset = Math.max(toNumber(offsetParam, 0), 0)
  const rows = await db.prepare(`SELECT f.*, s.receipt_number AS sale_receipt_number, CASE WHEN trim(COALESCE(f.branch_name,''),char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))<>'' THEN f.branch_name ELSE b.name END AS branch_name,
      dc.name AS delivery_contact_name FROM fees f LEFT JOIN sales s ON s.id = f.sale_id LEFT JOIN branches b ON b.id = f.branch_id LEFT JOIN delivery_contacts dc ON dc.id = f.delivery_contact_id
      ${where} ORDER BY f.fee_date DESC, f.id DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset })
  const summary = await db.prepare(`SELECT fee_type, COUNT(*) as count, COALESCE(SUM(amount_usd), 0) as total_usd, COALESCE(SUM(amount_khr), 0) as total_khr FROM fees f ${where} GROUP BY fee_type`).all(params)
  return { fees: rows, total: summary.reduce((sum, row) => sum + (Number(row.count) || 0), 0), limit, offset, summary }
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const ids = (rows) => rows.map((r) => `${r.kind || 'expense'}:${r.id}`)

async function scenario(w) {
  const U = w.users
  const list = (qs, user = U.full) => w.request('GET', `/api/fees?${qs}`, undefined, user)

  await check('schema: the partial index serves the courier-cost read, so a long window reads only sales that carry a cost', async () => {
    const plan = w.all(`EXPLAIN QUERY PLAN SELECT sales.id FROM sales WHERE sales.created_at >= '2026-01-01' AND sales.created_at < '2027-01-01'
      AND (sales.delivery_actual_cost_usd IS NOT NULL OR sales.delivery_actual_cost_khr IS NOT NULL)`).map((r) => r.detail).join(' | ')
    assert.match(plan, /idx_sales_courier_cost/)
  })

  await check('no source (and source=recorded) answers the exact old list (verbatim base handler as oracle) over a matrix of filters', async () => {
    const matrix = [RANGE, `${RANGE}&limit=2&offset=1`, `${RANGE}&fee_type=delivery`, `${RANGE}&fee_type=other&search=tape`, `${RANGE}&branch_id=2`, `${RANGE}&sale_id=4`, `${RANGE}&search=ice`, 'limit=3', 'createdFrom=2026-10-10T00:00:00Z&createdTo=2026-10-11T00:00:00Z']
    for (const qs of matrix) {
      const expected = clone(await oldList(w, Object.fromEntries(new URLSearchParams(qs))))
      for (const extra of ['', '&source=recorded', '&source=bogus']) {
        const got = await list(qs + extra)
        assert.equal(got.status, 200, qs + extra)
        assert.deepEqual(got.json, expected, `${qs}${extra}`)
      }
    }
  })

  let all
  await check('source=all: expenses plus the sale courier rows, each tagged and linked to its sale', async () => {
    const r = await list(`${RANGE}&source=all&limit=100`)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    all = r.json
    const sales = all.fees.filter((f) => f.kind === 'sale_delivery')
    // sale 1 ($3), sale 2 (20,000 riel), sale 7 (awaiting payment $2), sale 9 (other branch $4); NOT 3 (cancelled), 4 (guarded), 5 ($0), 6 (waived fee only), 8 (outside)
    assert.deepEqual(sales.map((s) => s.sale_id).sort(), [1, 2, 7, 9])
    for (const row of sales) {
      assert.equal(row.fee_type, 'delivery')
      assert.equal(row.sale_receipt_number, `R-000${row.sale_id}`)
      assert.deepEqual([row.notes, row.created_by], [null, null])
    }
    const byId = Object.fromEntries(sales.map((s) => [s.sale_id, s]))
    assert.deepEqual([byId[1].amount_usd, byId[1].amount_khr], [3, 0], 'a payout leaves in ONE currency: the riel twin of a dollar cost is not a second payout')
    assert.deepEqual([byId[2].amount_usd, byId[2].amount_khr], [0, 20000])
    assert.deepEqual([byId[7].amount_usd, byId[9].amount_usd], [2, 4])
    assert.equal(byId[1].label, 'Courier A')
    assert.equal(byId[1].fee_date, '2026-10-10')
    assert.equal(all.fees.filter((f) => f.kind === 'expense').length, 5, 'every stored expense in range stays (f1, f2, f3, f4, f6)')
    assert.equal(all.total, 5 + 4)
    assert.deepEqual(all.sale_delivery, { count: 4, usd: 9, khr: 20000 })
  })

  await check('not an expense: cost of goods, the waived shop-paid fee, cancelled, $0/NULL cost, the sale twin of a delivery fee', async () => {
    const text = JSON.stringify(all)
    assert.ok(!text.includes(String(COGS_MARKER)), 'cost of goods appears nowhere')
    const saleIds = all.fees.filter((f) => f.kind === 'sale_delivery').map((f) => f.sale_id)
    for (const excluded of [3, 4, 5, 6, 8]) assert.ok(!saleIds.includes(excluded), `sale ${excluded} is not a sale expense`)
    assert.ok(all.fees.some((f) => f.kind === 'expense' && f.id === 2 && f.sale_id === 4), 'the delivery FEE linked to sale 4 is listed once, as an expense')
    for (const row of all.fees) assert.ok(['expense', 'sale_delivery'].includes(row.kind))
    // every amount shown is a stored fee or a recorded courier cost, never a sale total or a line cost
    const shown = all.fees.map((f) => [f.amount_usd, f.amount_khr])
    assert.ok(!shown.some(([usd]) => usd === 20 || usd === 1.5))
  })

  await check('TOTALS PARITY: fee half = Reports overview expenses; sale half = courierPayoutsWhere = kernel recognized delivery cost = sum of rows', async () => {
    const overview = (await w.request('GET', `/api/reports/overview?startDate=2026-10-10&endDate=2026-10-12`, undefined, U.admin)).json
    const feeSummary = all.summary.reduce((t, r) => ({ count: t.count + r.count, usd: t.usd + r.total_usd, khr: t.khr + r.total_khr }), { count: 0, usd: 0, khr: 0 })
    assert.deepEqual([feeSummary.count, feeSummary.usd, feeSummary.khr], [overview.expenses.totals.count, overview.expenses.totals.amount_usd, overview.expenses.totals.amount_khr], 'fee half = Reports overview expenses.totals')
    const report = (await w.request('GET', `/api/fees/report?startDate=2026-10-10&endDate=2026-10-12`, undefined, U.full)).json
    assert.deepEqual(report.totals, overview.expenses.totals, 'the stats strip total = Reports overview')

    const { courierPayoutsWhere } = w.load('lib/shiftReconciliation.ts')
    const { whereActiveSales } = w.load('lib/salesAnalytics.ts')
    const active = whereActiveSales('sales', { startDate: '2026-10-10', endDate: '2026-10-12' })
    const canonical = await courierPayoutsWhere(w.env, [active.sql], active.params)
    assert.deepEqual({ usd: all.sale_delivery.usd, khr: all.sale_delivery.khr }, canonical, 'sale half = courierPayoutsWhere')
    const rows = all.fees.filter((f) => f.kind === 'sale_delivery')
    assert.equal(rows.reduce((t, r) => t + r.amount_usd, 0), canonical.usd, 'the rows add up to the total')
    assert.equal(rows.reduce((t, r) => t + r.amount_khr, 0), canonical.khr)
    assert.equal(overview.sales.totals.recognized_delivery_cost_usd, canonical.usd, 'kernel recognized delivery cost (USD) = sale half')

    // fee half + sale half is the Telegram / shift "Expenses" total: delivery cost (courier + delivery fees) + other expenses
    const { composeShiftFigures, FEE_SPLIT_COLUMNS } = w.load('lib/shiftReconciliation.ts')
    const split = w.get(`SELECT ${FEE_SPLIT_COLUMNS} FROM fees WHERE fee_date >= '2026-10-10' AND fee_date <= '2026-10-12'`)
    const figures = composeShiftFigures({ opening: null, counted: null, totals: {}, expenses: split, deliveryFees: { usd: split.delivery_usd, khr: split.delivery_khr }, courier: canonical })
    assert.equal(figures.delivery_cost.usd + figures.other_expenses.usd, feeSummary.usd + all.sale_delivery.usd)
    assert.equal(figures.delivery_cost.khr + figures.other_expenses.khr, feeSummary.khr + all.sale_delivery.khr)

    // the report endpoint with include=sales: fee totals byte-identical to the plain report, plus the sale block for the same range
    const withSales = (await w.request('GET', `/api/fees/report?startDate=2026-10-10&endDate=2026-10-12&include=sales`, undefined, U.full)).json
    const { sale_delivery: block, ...rest } = withSales
    assert.deepEqual(rest, report)
    assert.deepEqual(block, all.sale_delivery)
  })

  await check('THE THREE FIGURES the page shows are named and each equals its counterpart: Recorded expenses = Reports overview, Courier cost = courierPayoutsWhere (USD and riel apart), Total = Telegram "Expenses"', async () => {
    const r2 = (n) => Math.round(n * 100) / 100
    const overview = (await w.request('GET', `/api/reports/overview?startDate=2026-10-10&endDate=2026-10-12`, undefined, U.admin)).json
    const strip = (await w.request('GET', `/api/fees/report?startDate=2026-10-10&endDate=2026-10-12&include=sales`, undefined, U.full)).json
    const recorded = { usd: strip.totals.amount_usd, khr: strip.totals.amount_khr }
    assert.deepEqual(recorded, { usd: overview.expenses.totals.amount_usd, khr: overview.expenses.totals.amount_khr }, 'Recorded expenses = the Reports overview expenses line (recorded only)')
    const { courierPayoutsWhere, composeShiftFigures, FEE_SPLIT_COLUMNS } = w.load('lib/shiftReconciliation.ts')
    const { whereActiveSales } = w.load('lib/salesAnalytics.ts')
    const active = whereActiveSales('sales', { startDate: '2026-10-10', endDate: '2026-10-12' })
    const canonical = await courierPayoutsWhere(w.env, [active.sql], active.params)
    assert.deepEqual({ usd: strip.sale_delivery.usd, khr: strip.sale_delivery.khr }, canonical, 'Courier cost (shop-paid delivery) = courierPayoutsWhere, dollars and riel kept apart')
    assert.ok(strip.sale_delivery.usd > 0 && strip.sale_delivery.khr > 0, 'control: the fixture has both a dollar and a riel courier cost, so "apart" is observable')
    const split = w.get(`SELECT ${FEE_SPLIT_COLUMNS} FROM fees WHERE fee_date >= '2026-10-10' AND fee_date <= '2026-10-12'`)
    const telegram = composeShiftFigures({ opening: null, counted: null, totals: {}, expenses: split, deliveryFees: { usd: split.delivery_usd, khr: split.delivery_khr }, courier: canonical })
    assert.equal(r2(recorded.usd + strip.sale_delivery.usd), r2(telegram.delivery_cost.usd + telegram.other_expenses.usd), 'Total (USD) = Telegram Expenses')
    assert.equal(recorded.khr + strip.sale_delivery.khr, telegram.delivery_cost.khr + telegram.other_expenses.khr, 'Total (riel) = Telegram Expenses')
    assert.notEqual(recorded.usd + strip.sale_delivery.usd, recorded.usd, 'control: the Total differs from the Recorded expenses, so the two labels are not the same number')
  })

  await check('branch filter narrows both halves the way the reports do (branch_id=1)', async () => {
    const r = (await list(`${RANGE}&branch_id=1&source=all`)).json
    assert.deepEqual(r.fees.filter((f) => f.kind === 'sale_delivery').map((f) => f.sale_id).sort(), [1, 2, 7])
    assert.deepEqual(r.sale_delivery, { count: 3, usd: 5, khr: 20000 })
    const { courierPayoutsWhere } = w.load('lib/shiftReconciliation.ts')
    const { whereActiveSales } = w.load('lib/salesAnalytics.ts')
    const active = whereActiveSales('sales', { startDate: '2026-10-10', endDate: '2026-10-12', branchId: '1' })
    assert.deepEqual({ usd: r.sale_delivery.usd, khr: r.sale_delivery.khr }, await courierPayoutsWhere(w.env, [active.sql], active.params))
    const report = (await w.request('GET', `/api/fees/report?startDate=2026-10-10&endDate=2026-10-12&branchId=1&include=sales`, undefined, U.full)).json
    assert.deepEqual(report.sale_delivery, r.sale_delivery)
  })

  await check('exact time window: sale rows follow createdFrom/createdTo (entry time), like the expense half', async () => {
    const r = (await list('createdFrom=2026-10-10T03:30:00Z&createdTo=2026-10-10T04:30:00Z&source=all')).json
    assert.deepEqual(r.fees.filter((f) => f.kind === 'sale_delivery').map((f) => f.sale_id), [2])
    assert.equal(r.sale_delivery.count, 1)
  })

  await check('filters: type other/tax hides the sale rows, delivery keeps them, search finds a receipt, sale_id and courier narrow', async () => {
    const other = (await list(`${RANGE}&source=all&fee_type=other`)).json
    assert.ok(other.fees.every((f) => f.kind === 'expense') && other.sale_delivery.count === 0)
    const delivery = (await list(`${RANGE}&source=all&fee_type=delivery`)).json
    assert.deepEqual(ids(delivery.fees).sort(), ['expense:2', 'sale_delivery:1', 'sale_delivery:2', 'sale_delivery:7', 'sale_delivery:9'].sort())
    const receipt = (await list(`${RANGE}&source=all&search=R-0007`)).json
    assert.deepEqual(ids(receipt.fees), ['sale_delivery:7'])
    assert.deepEqual(ids((await list(`${RANGE}&source=all&sale_id=1`)).json.fees), ['sale_delivery:1'])
    assert.deepEqual(ids((await list(`${RANGE}&source=sale&search=courier`)).json.fees).sort(), ['sale_delivery:1', 'sale_delivery:7'].sort(), 'the courier name matches a sale row')
  })

  await check('PAGING: Back/Next over the merge shows every row once, in order, with the true total on every page', async () => {
    const full = (await list(`${RANGE}&source=all&limit=500`)).json
    const order = ids(full.fees)
    assert.equal(new Set(order).size, order.length)
    for (const size of [1, 2, 3, 4, 9]) {
      const seen = []
      for (let offset = 0; offset < full.total; offset += size) {
        const page = (await list(`${RANGE}&source=all&limit=${size}&offset=${offset}`)).json
        assert.equal(page.total, full.total, 'the total is the true total on every page')
        seen.push(...ids(page.fees))
      }
      assert.deepEqual(seen, order, `page size ${size}`)
    }
    // newest first by booked date; on one date the later entry time first
    const dates = full.fees.map((f) => f.fee_date)
    assert.deepEqual([...dates].sort().reverse(), dates)
    const { mergeExpenseRows } = w.load('routes/feesCatalog.ts')
    assert.deepEqual(mergeExpenseRows([{ fee_date: '2026-10-11', created_at: '2026-10-11 05:00:00', id: 1, kind: 'expense' }], [{ fee_date: '2026-10-11', created_at: '2026-10-11 06:00:00', id: 2, kind: 'sale_delivery' }]).map((r) => r.id), [2, 1])
    assert.deepEqual(mergeExpenseRows([{ fee_date: '2026-10-11', created_at: '2026-10-11T05:00:00.000Z', id: 1, kind: 'expense' }], [{ fee_date: '2026-10-11', created_at: '2026-10-11 05:00:00', id: 2, kind: 'sale_delivery' }]).map((r) => r.id), [1, 2], 'an expense wins a tie; ISO and SQLite timestamps compare alike')
  })

  await check('source=sale lists only the sale rows; the total is their count', async () => {
    const r = (await list(`${RANGE}&source=sale`)).json
    assert.ok(r.fees.every((f) => f.kind === 'sale_delivery'))
    assert.deepEqual([r.total, r.fees.length, r.summary.length], [4, 4, 0])
  })

  await check('PERMISSION: without sales:view_courier_cost there is no sale row, no count, no amount, in any shape of the response', async () => {
    const withCost = JSON.stringify((await list(`${RANGE}&source=all&limit=500`)).json)
    for (const user of [U.noSales, U.courierOff]) {
      const r = await list(`${RANGE}&source=all&limit=500`, user)
      assert.equal(r.status, 200)
      assert.equal(r.json.sale_delivery, null)
      assert.ok(r.json.fees.every((f) => f.kind === 'expense'))
      assert.equal(r.json.total, 5, 'the total counts the expenses they may read, nothing more')
      const text = JSON.stringify(r.json)
      for (const receipt of ['R-0001', 'R-0002', 'R-0007', 'R-0009']) assert.ok(!text.includes(receipt), `${user.username} sees no ${receipt}`)
      assert.ok(!text.includes('sale_delivery":{'), 'no totals block')
      const only = (await list(`${RANGE}&source=sale`, user)).json
      assert.deepEqual([only.fees.length, only.total, only.sale_delivery], [0, 0, null])
      const report = (await w.request('GET', `/api/fees/report?startDate=2026-10-10&endDate=2026-10-12&include=sales`, undefined, user)).json
      assert.equal(report.sale_delivery, null)
      assert.deepEqual(report.totals.amount_usd, 9, 'the fee totals are theirs to read')
    }
    assert.ok(withCost.includes('R-0007'), 'control: an authorised caller does see them')
    assert.equal((await list(`${RANGE}&source=all`, U.nothing)).status, 403)
    assert.equal((await list(`${RANGE}&source=all`, U.noView)).status, 403)
    assert.equal((await list(`${RANGE}&source=all`, null)).status, 401)
  })

  await check('loophole: crafted parameters cannot widen the sale half (bad dates 400, injection text inert, foreign branch narrows)', async () => {
    assert.equal((await list('from=2026-13-40&source=all')).status, 400)
    assert.equal((await list(`from=2026-10-12&to=2026-10-10&source=all`)).status, 400)
    assert.equal((await list(`createdFrom=2026-10-10T00:00:00Z&source=all`)).status, 400)
    const inert = (await list(`${RANGE}&source=all&search=${encodeURIComponent("' OR 1=1 --")}`)).json
    assert.deepEqual([inert.total, inert.sale_delivery.count], [0, 0])
    const foreign = (await list(`${RANGE}&source=all&branch_id=99`)).json
    assert.deepEqual([foreign.total, foreign.sale_delivery.count], [0, 0])
    assert.equal((await list(`${RANGE}&source=ALL`)).json.sale_delivery, undefined, 'only the exact words switch the sale half on')
  })

  await check('the report without include=sales is the plain report: no sale block, byte for byte what an older client reads', async () => {
    const plain = (await w.request('GET', `/api/fees/report?startDate=2026-10-10&endDate=2026-10-12`, undefined, U.full)).json
    assert.equal(plain.sale_delivery, undefined)
    assert.equal((await list(RANGE)).json.sale_delivery, undefined)
    assert.ok((await list(RANGE)).json.fees.every((f) => f.kind === undefined))
  })
}

(async () => {
  const w = createFeesWorld()
  seed(w)
  await scenario(w)

  // ---- mutation controls ---------------------------------------------------------------------------------------------
  const mutants = [
    ['the courier guard is dropped: the sale twin of a delivery fee counts twice', { file: 'src/lib/shiftReconciliation.ts', from: "return { usd: deliveryActualCostExpr('sales.'), khr, recognized:", to: "return { usd: 'COALESCE(sales.delivery_actual_cost_usd, 0)', khr, recognized:" }],
    ['the riel twin of a dollar cost is counted as a second payout', { file: 'src/lib/shiftReconciliation.ts', from: "? 'WHEN COALESCE(sales.delivery_actual_cost_usd, 0) > 0 THEN 0'", to: "? ''" }],
    ['cancelled sales are included in the sale half', { file: 'src/lib/salesAnalytics.ts', from: "clauses.push(`COALESCE(${alias}.sale_status, 'completed') <> 'cancelled'`)", to: "clauses.push('1=1')" }],
    ['the permission check is dropped from the list', { file: 'src/routes/feesCatalog.ts', from: "  const showSales = canViewCourierCost(c.get('user'))\n  try {", to: "  const showSales = true\n  try {" }],
    ['the permission check is dropped from the report block', { file: 'src/routes/feesCatalog.ts', from: "  const showSales = canViewCourierCost(c.get('user'))\n  let saleDelivery", to: "  const showSales = true\n  let saleDelivery" }],
    ['a request without source also gets the sale rows (an older client would meet one)', { file: 'src/routes/feesCatalog.ts', from: "  if (source !== 'all' && source !== 'sale') return next()\n", to: '' }],
    ['the report block is added to every report, not only include=sales', { file: 'src/routes/feesCatalog.ts', from: "  if (c.req.query('include') !== 'sales') return next()\n", to: '' }],
    ['the merge drops the offset (page 2 repeats page 1)', { file: 'src/routes/feesCatalog.ts', from: "      fees: merged.slice(offset, offset + limit),", to: "      fees: merged.slice(0, limit)," }],
    ['the total forgets the sale rows', { file: 'src/routes/feesCatalog.ts', from: "      total: fees.total + saleTotals.count,", to: "      total: fees.total," }],
    ['a type filter other than delivery still lists the sale rows', { file: 'src/routes/feesCatalog.ts', from: "if (type && type !== 'all' && await resolveFeeTypeFilter(db, type) !== 'delivery') return null", to: "" }],
    ['the shop-paid delivery fee is added as an expense', [
      { file: 'src/routes/feesCatalog.ts', from: "'(sales.delivery_actual_cost_usd IS NOT NULL OR sales.delivery_actual_cost_khr IS NOT NULL)',", to: "'(sales.delivery_actual_cost_usd IS NOT NULL OR sales.delivery_actual_cost_khr IS NOT NULL OR sales.delivery_fee_usd > 0)'," },
      { file: 'src/routes/feesCatalog.ts', from: "`(${expressions.usd} <> 0 OR ${expressions.khr} <> 0)`,", to: "`(${expressions.usd} <> 0 OR ${expressions.khr} <> 0 OR sales.delivery_fee_usd > 0)`," },
    ]],
  ]
  quiet = true
  for (const [name, patch] of mutants) {
    let red = false
    try {
      const m = createFeesWorld({ patches: [].concat(patch) })
      seed(m)
      await scenario(m)
    } catch {
      red = true
    }
    quiet = false
    assert.ok(red, `mutant survived: ${name}`)
    passed += 1
    console.log(`PASS mutant killed: ${name}`)
    quiet = true
  }
  quiet = false
  console.log(`\n${passed} sale-row checks passed.`)
})().catch((error) => { console.error(error); process.exit(1) })
