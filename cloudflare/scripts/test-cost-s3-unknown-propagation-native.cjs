'use strict'
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
function seedFixture(raw, seed) {
  const value = seedStockFixture(raw, seed)
  assert.throws(() => raw.exec("INSERT INTO products(name) VALUES('unadmitted fixture probe')"), /stock_transaction_required/)
  return value
}
// Cost-unknown lane, slice S3 (owner, 14 Oct 2026): "if cost is 0$ then it is 0
// for loss. if it is none, it should also be unknown. flag it."
//
// A sold line whose cost snapshot is NULL is UNKNOWN. The report kernel already
// left such a line out of COGS and counted it, but the count was lost on the way
// out (withRemovalLosses spread away the non-enumerable diagnostic, the period
// rows never carried it, gateTotals coerced an absent count to 0) so every
// surface printed COGS and profit as if complete. This drives the REAL routes on
// the complete migrated SQLite schema and asserts the count on every surface:
//   * three sales of one product: cost unknown (NULL), cost recorded $0, cost 4.
//     A recorded $0 is a real $0 -- it is summed and never counted as unknown.
//   * stats-strip (also through a JSON cache round trip, which drops Symbols),
//     daily-report, day-report, export summary, export detail rows (NULL stays
//     null, never 0), reports overview / periods / grouped / business-summary,
//     the dashboard's totals + period series, shift figures.
//   * a caller without product_cost_view receives none of the new keys.
//   * damaged-lot sale and its status transition carry the HELD lot's cost
//     (or NULL), never today's catalog cost, and never a literal 0.
//
// Every case is named and independent, so a run on the pre-S3 tree lists exactly
// which surfaces lose the count.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0, 'sibling fixture boundary must exist')
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(
  source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
    + '\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,cache:overrides["../lib/cache"],setUser(value){currentUser=value}};',
  file,
)
const h = harness.exports

const results = []
async function check(name, fn) {
  try { await fn(); results.push([name, null]) } catch (error) { results.push([name, error]) }
}

const DAY = '2026-09-13'
const WINDOW = `startDate=${DAY}&endDate=${DAY}`
const ADMIN = { ...h.USER, permissions: '{"all":true}' }
const PLAIN = { ...h.USER, permissions: '{"sales":true}' }
const COST_NO_COURIER = { ...h.USER, permissions: '{"sales":true,"product_cost_view":true,"sales:view_courier_cost":false}' }
const NEW_KEYS = ['cost_missing_snapshot_lines', 'cost_known_lines', 'cost_complete']

;(async () => {
  const f = h.fixture()
  const env = { DB: f.route }
  const sales = h.app
  const reports = h.load('routes/reports.ts')
  const lib = h.load('lib/salesAnalytics.ts')
  const shiftLib = h.load('lib/shiftReconciliation.ts')
  const profitView = h.load('lib/reportProfitView.ts')

  const get = async (app, url) => {
    const response = await app.request(url, {}, env, h.executionCtx)
    const text = await response.text()
    assert.equal(response.status, 200, `${url}: ${text}`)
    return JSON.parse(text)
  }
  const hasAny = (value, keys) => keys.filter((key) => Object.hasOwn(value, key))

  async function sell(key, unitCostUsd) {
    const khr = unitCostUsd == null ? null : unitCostUsd * 4000
    seedFixture(f.raw.db, () => f.raw.prepare('UPDATE products SET cost_price_usd=?, cost_price_khr=? WHERE id=10').run([unitCostUsd, khr]))
    const posted = await h.postSale(f.route, { ...h.request(key), money_precision_version: 1, amount_paid_usd: 9.5 })
    assert.equal(posted.status, 200, JSON.stringify(posted.body))
    f.raw.prepare("UPDATE sales SET created_at='2026-09-13 01:00:00' WHERE id=?").run([posted.body.id])
    return posted.body.id
  }

  h.setUser(ADMIN)
  const unknownSale = await sell('s3-unknown', null)
  const zeroSale = await sell('s3-zero', 0)
  const costedSale = await sell('s3-costed', 4)

  await check('the sale writer keeps NULL / $0 / 4 as three different snapshots', () => {
    const rows = f.raw.prepare('SELECT sale_id, cost_price_usd FROM sale_items ORDER BY sale_id').all()
    assert.deepEqual(rows.map((r) => [r.sale_id, r.cost_price_usd]), [[unknownSale, null], [zeroSale, 0], [costedSale, 4]])
  })

  await check('sale movements: NULL cost -> NULL unit AND NULL total (not DEFAULT 0); $0 -> 0; 4 -> total 4', () => {
    const rows = f.raw.prepare("SELECT reference_id, unit_cost_usd, total_cost_usd, total_cost_khr FROM inventory_movements WHERE movement_type='sale' ORDER BY reference_id").all()
    assert.deepEqual(rows.map((r) => [r.reference_id, r.unit_cost_usd, r.total_cost_usd]),
      [[unknownSale, null, null], [zeroSale, 0, 0], [costedSale, 4, 4]])
    assert.equal(rows[0].total_cost_khr, null)
  })

  // ---- /api/sales surfaces --------------------------------------------------
  const assertStrip = (payload, label) => {
    const t = payload.totals
    assert.equal(t.cost_missing_snapshot_lines, 1, `${label}: unknown lines`)
    assert.equal(t.cost_known_lines, 2, `${label}: the recorded $0 line and the costed line are known`)
    assert.equal(t.cost_complete, false, `${label}: partial`)
    assert.equal(t.cost_usd, 4, `${label}: COGS is the known lines only ($0 + $4)`)
  }
  await check('stats-strip carries the unknown-cost count', async () => assertStrip(await get(sales, `/stats-strip?${WINDOW}`), 'stats-strip'))

  await check('stats-strip count survives the JSON cache (a Symbol would not)', async () => {
    const original = h.cache.cachedJsonResponse
    h.cache.cachedJsonResponse = async (_r, _c, _k, _t, loader) => JSON.parse(JSON.stringify(await loader()))
    try { assertStrip(await get(sales, `/stats-strip?${WINDOW}`), 'cached stats-strip') } finally { h.cache.cachedJsonResponse = original }
  })

  await check('daily-report rows carry the count', async () => {
    const days = (await get(sales, `/daily-report?${WINDOW}`)).days
    assert.equal(days.length, 1)
    assert.equal(days[0].cost_missing_snapshot_lines, 1)
    assert.equal(days[0].cost_known_lines, 2)
    assert.equal(days[0].cost_complete, false)
  })

  await check('day-report totals carry the count', async () => {
    const report = await get(sales, `/day-report?date=${DAY}`)
    assert.equal(report.totals.cost_missing_snapshot_lines, 1)
    assert.equal(report.totals.cost_complete, false)
  })

  await check('export summary carries the count; detail rows keep NULL as null and $0 as 0', async () => {
    const body = await get(sales, `/export?${WINDOW}`)
    assert.equal(body.summary.cost_missing_snapshot_lines, 1)
    assert.equal(body.summary.cost_known_lines, 2)
    assert.equal(body.summary.cost_complete, false)
    assert.deepEqual(body.sales.map((row) => row.cost_price_usd), [null, 0, 4])
    assert.deepEqual(body.sales.map((row) => row.cost_price_khr), [null, 0, 16000])
  })

  // ---- /api/reports surfaces ------------------------------------------------
  await check('reports overview totals carry the count', async () => {
    const body = await get(reports.default, `/overview?${WINDOW}`)
    assert.equal(body.sales.totals.cost_missing_snapshot_lines, 1)
    assert.equal(body.sales.totals.cost_complete, false)
    assert.equal(body.sales.totals.cost_usd, 4)
  })

  await check('reports overview previous period reports a real zero for an empty window, not an absence', async () => {
    const body = await get(reports.default, `/overview?${WINDOW}&compare=1`)
    assert.ok(body.sales.previous, 'previous block present')
    assert.equal(body.sales.previous.cost_missing_snapshot_lines, 0)
    assert.equal(body.sales.previous.cost_complete, true)
  })

  await check('reports periods rows carry the count', async () => {
    const body = await get(reports.default, `/periods?${WINDOW}&granularity=day`)
    assert.equal(body.rows.length, 1)
    assert.equal(body.rows[0].cost_missing_snapshot_lines, 1)
    assert.equal(body.rows[0].cost_complete, false)
  })

  await check('reports grouped: totals and rows agree on the unknown count', async () => {
    const body = await get(reports.default, `/grouped?${WINDOW}&by=payment_method`)
    const rowSum = body.rows.reduce((sum, row) => sum + row.cost_missing_snapshot_lines, 0)
    assert.equal(rowSum, 1, 'rows')
    assert.equal(body.totals.cost_missing_snapshot_lines, 1, 'totals')
    assert.equal(body.totals.money_unknown_cost_lines, 1, 'the read diagnostic says the same')
    assert.equal(body.totals.cost_complete, false)
  })

  await check('reports grouped by product: row and totals carry the count and the completeness flag', async () => {
    const body = await get(reports.default, `/grouped?${WINDOW}&by=product`)
    assert.equal(body.rows[0].cost_missing_snapshot_lines, 1)
    assert.equal(body.rows[0].cost_complete, false)
    assert.equal(body.totals.cost_missing_snapshot_lines, 1)
    assert.equal(body.totals.cost_complete, false)
  })

  await check('business-summary sales: only the unknown receipt is flagged; the $0 receipt is complete', async () => {
    const body = await get(reports.default, `/business-summary/sales?${WINDOW}&order=asc`)
    const byId = new Map(body.rows.map((row) => [row.id, row]))
    assert.equal(byId.get(unknownSale).cost_missing_snapshot_lines, 1)
    assert.equal(byId.get(unknownSale).cost_complete, false)
    assert.equal(byId.get(zeroSale).cost_missing_snapshot_lines, 0)
    assert.equal(byId.get(zeroSale).cost_complete, true)
    assert.equal(byId.get(costedSale).cost_complete, true)
  })

  // ---- dashboard + kernel ---------------------------------------------------
  const filters = { startDate: DAY, endDate: DAY, branchId: null }
  await check('dashboard totals and period series carry the count (what compat.ts gates and returns)', async () => {
    const result = await lib.getSalesTotalsAndPeriodSeries(env, filters, 'day')
    assert.equal(result.totals.cost_missing_snapshot_lines, 1)
    assert.equal(result.periodSeries.length, 1)
    assert.equal(result.periodSeries[0].cost_missing_snapshot_lines, 1)
    assert.equal(result.periodSeries[0].cost_complete, false)
    const gated = reports.gateTotals(result.totals, true, true, 2, true)
    assert.equal(gated.cost_missing_snapshot_lines, 1)
    const period = reports.gateTotals(result.periodSeries[0], true, true, 4, true)
    assert.equal(period.cost_missing_snapshot_lines, 1)
    assert.equal(period.cost_complete, false)
  })

  await check('totals with removal losses keep the unknown count AND the read diagnostic', async () => {
    const totals = await lib.getSalesTotals(env, filters)
    assert.equal(typeof totals.removal_loss_usd, 'number', 'the removal block is attached')
    assert.equal(totals.cost_missing_snapshot_lines, 1)
    const gated = reports.gateTotals(totals, true, true, 2, true)
    assert.equal(gated.money_unknown_cost_lines, 1, 'the diagnostic survives withRemovalLosses')
    assert.equal(gated.money_complete, false)
  })

  await check('a window with no lines at all is complete (a real zero), a gated empty object carries no invented count', () => {
    const empty = lib.emptySalesTotals()
    assert.equal(empty.cost_missing_snapshot_lines, 0)
    assert.equal(empty.cost_complete, true)
    const gatedEmpty = reports.gateTotals({}, true, true, 2, true)
    assert.equal(Object.hasOwn(gatedEmpty, 'cost_missing_snapshot_lines'), false, 'absent stays absent, never 0')
    assert.equal(Object.hasOwn(gatedEmpty, 'cost_complete'), false)
  })

  await check('period roll-up sums the counts and recomputes completeness', () => {
    const day = (date, missing) => ({ date, tx_count: 1, revenue_usd: 5, cost_usd: 1, cost_missing_snapshot_lines: missing, cost_known_lines: 1 })
    const [week] = reports.rollupPeriodRows([day('2026-09-14', 0), day('2026-09-15', 2)], 'week')
    assert.equal(week.cost_missing_snapshot_lines, 2)
    assert.equal(week.cost_known_lines, 2)
    assert.equal(week.cost_complete, false)
    const [clean] = reports.rollupPeriodRows([day('2026-09-14', 0), day('2026-09-15', 0)], 'week')
    assert.equal(clean.cost_complete, true)
  })

  // ---- authority ------------------------------------------------------------
  await check('a caller without product_cost_view receives none of the new keys on any sales or reports surface', async () => {
    h.setUser(PLAIN)
    const leaks = []
    const scan = (label, value) => {
      if (!value || typeof value !== 'object') return
      for (const key of hasAny(value, NEW_KEYS)) leaks.push(`${label}.${key}`)
      for (const [key, child] of Object.entries(value)) scan(`${label}.${key}`, child)
    }
    for (const url of [`/stats-strip?${WINDOW}`, `/daily-report?${WINDOW}`, `/day-report?date=${DAY}`, `/export?${WINDOW}`]) scan(url, await get(sales, url))
    for (const url of [`/overview?${WINDOW}`, `/periods?${WINDOW}`, `/grouped?${WINDOW}&by=payment_method`, `/grouped?${WINDOW}&by=product`, `/business-summary/sales?${WINDOW}`]) scan(url, await get(reports.default, url))
    h.setUser(ADMIN)
    assert.deepEqual(leaks, [])
  })

  await check('a cost viewer without the courier-cost grant still receives the count (goods profit keeps it)', async () => {
    h.setUser(COST_NO_COURIER)
    try {
      const strip = await get(sales, `/stats-strip?${WINDOW}`)
      assert.equal(strip.totals.cost_missing_snapshot_lines, 1)
      assert.equal(strip.totals.cost_complete, false)
      assert.equal(strip.totals.profit_excludes_delivery, true)
      const overview = await get(reports.default, `/overview?${WINDOW}`)
      assert.equal(overview.sales.totals.cost_missing_snapshot_lines, 1)
      const exported = await get(sales, `/export?${WINDOW}`)
      assert.equal(exported.summary.cost_missing_snapshot_lines, 1)
    } finally { h.setUser(ADMIN) }
  })

  await check('costViewProfit restates profit but never drops or rewrites the unknown-cost count', () => {
    const restated = profitView.costViewProfit({ revenue_usd: 10, cost_usd: 4, profit_usd: 5, cost_missing_snapshot_lines: 2, cost_known_lines: 3, cost_complete: false })
    assert.equal(restated.profit_usd, 6)
    assert.equal(restated.cost_missing_snapshot_lines, 2)
    assert.equal(restated.cost_known_lines, 3)
    assert.equal(restated.cost_complete, false)
  })

  // ---- courier cost: sum of the known, a recorded $0 is a recorded cost ------
  await check('courier cost: NULL is left out of the sum and out of the recorded count; a recorded $0 counts as recorded', async () => {
    f.raw.prepare("UPDATE sales SET is_delivery=1, delivery_actual_cost_usd=NULL WHERE id=?").run([unknownSale])
    f.raw.prepare("UPDATE sales SET is_delivery=1, delivery_actual_cost_usd=0 WHERE id=?").run([zeroSale])
    f.raw.prepare("UPDATE sales SET is_delivery=1, delivery_actual_cost_usd=2.5 WHERE id=?").run([costedSale])
    try {
      const totals = await lib.getSalesTotals(env, filters)
      assert.equal(totals.delivery_sale_count, 3)
      assert.equal(totals.delivery_actual_cost_count, 2, 'the $0 and the 2.50 are recorded; the NULL is not')
      assert.equal(totals.delivery_actual_cost_usd, 2.5, 'sum of the known')
      const gated = reports.gateTotals(totals, true, true, 2, true)
      assert.equal(gated.delivery_actual_cost_count, 2)
      assert.equal(gated.delivery_actual_cost_usd, 2.5)
    } finally {
      f.raw.prepare('UPDATE sales SET is_delivery=0, delivery_actual_cost_usd=NULL').run()
    }
  })

  // ---- shift figures --------------------------------------------------------
  await check('shift figures carry the count when the kernel sent it, and stay silent when it did not', () => {
    const withCount = shiftLib.composeShiftFigures({ opening: {}, counted: {}, totals: { revenue_usd: 10, cost_usd: 4, profit_usd: 6, cost_missing_snapshot_lines: 3 }, expenses: {}, deliveryFees: {}, courier: {} })
    assert.equal(withCount.cost_missing_snapshot_lines, 3)
    assert.equal(withCount.cogs_usd, 4)
    assert.equal(withCount.profit_usd, 6)
    const without = shiftLib.composeShiftFigures({ opening: {}, counted: {}, totals: { revenue_usd: 10, cost_usd: 4, profit_usd: 6 }, expenses: {}, deliveryFees: {}, courier: {} })
    assert.equal(Object.hasOwn(without, 'cost_missing_snapshot_lines'), false, 'absent is not 0')
  })

  await check('loadShiftFigures reads the count off the sales kernel', async () => {
    const figures = await shiftLib.loadShiftFigures(env, {
      id: 1, user_id: ADMIN.id, branch_id: 1, opened_at: '2026-09-13 00:00:00', closed_at: '2026-09-13 23:00:00',
      opening_float_usd: 0, opening_float_khr: 0, scope_mode: 'shop_wide',
    }, Date.parse('2026-09-14T00:00:00Z'))
    assert.equal(figures.cost_missing_snapshot_lines, 1)
    assert.equal(figures.cogs_usd, 4)
  })

  // ---- damaged-lot writers --------------------------------------------------
  seedFixture(f.raw.db, () => f.raw.prepare('UPDATE products SET cost_price_usd=9, cost_price_khr=36000 WHERE id=10').run())
  seedFixture(f.raw.db, () => f.raw.prepare("INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,quantity,quantity_remaining,unit_cost_usd) VALUES(600,10,'Powder',1,5,5,3)").run())
  seedFixture(f.raw.db, () => f.raw.prepare("INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,quantity,quantity_remaining,unit_cost_usd) VALUES(601,10,'Powder',1,5,5,NULL)").run())
  async function sellDamaged(key, lotId, quantity = 1) {
    const base = h.request(key)
    const item = { product_id: 10, quantity, branch_id: 1, damaged_lot_id: lotId, applied_price_usd: 9.5, client_line_key: key, pricing_source: 'selling',
      pricing_quote: { gross_usd: 9.5 * quantity, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5 * quantity, total_khr: 38000 * quantity } }
    const posted = await h.postSale(f.route, { ...base, amount_paid_usd: 9.5 * quantity, items: [item] })
    assert.equal(posted.status, 200, JSON.stringify(posted.body))
    return posted.body.id
  }
  const movementsOf = (saleId, type) => f.raw.prepare('SELECT unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, quantity FROM inventory_movements WHERE reference_id=? AND movement_type=?').all([saleId, type])
  let heldSale = null, unknownHeldSale = null

  await check('POS sale of a damaged lot: the damage_out movement carries the HELD lot cost (3), not the catalog cost (9)', async () => {
    heldSale = await sellDamaged('s3-held', 600, 2)
    const [move] = movementsOf(heldSale, 'damage_out')
    assert.ok(move, 'damage_out recorded')
    assert.equal(move.unit_cost_usd, 3)
    assert.equal(move.total_cost_usd, 6)
    assert.equal(move.unit_cost_khr, null)
    assert.equal(move.total_cost_khr, null)
  })

  await check('POS sale of a damaged lot whose cost is unknown: the movement is unknown (NULL), never the catalog cost or 0', async () => {
    unknownHeldSale = await sellDamaged('s3-held-unknown', 601, 1)
    const [move] = movementsOf(unknownHeldSale, 'damage_out')
    assert.ok(move, 'damage_out recorded')
    assert.equal(move.unit_cost_usd, null)
    assert.equal(move.total_cost_usd, null)
  })

  async function patchStatus(saleId, status) {
    const row = f.raw.prepare('SELECT updated_at FROM sales WHERE id=?').get([saleId])
    const response = await sales.request(`/${saleId}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sale_status: status, cancel_reason: 'mistake', expected_updated_at: row.updated_at, client_request_id: `s3-${saleId}-${status}` }),
    }, env, h.executionCtx)
    const text = await response.text()
    assert.equal(response.status, 200, text)
  }

  await check('cancelling the damaged-lot sale puts the units back at the HELD lot cost (damage_in), not a literal 0', async () => {
    assert.ok(heldSale, 'the damaged-lot sale exists')
    await patchStatus(heldSale, 'cancelled')
    const [move] = movementsOf(heldSale, 'damage_in')
    assert.ok(move, 'damage_in recorded')
    assert.equal(move.unit_cost_usd, 3)
    assert.equal(move.total_cost_usd, 6)
  })

  await check('cancelling an unknown-cost damaged-lot sale records an unknown (NULL) movement, not 0', async () => {
    assert.ok(unknownHeldSale, 'the damaged-lot sale exists')
    await patchStatus(unknownHeldSale, 'cancelled')
    const [move] = movementsOf(unknownHeldSale, 'damage_in')
    assert.ok(move, 'damage_in recorded')
    assert.equal(move.unit_cost_usd, null)
    assert.equal(move.total_cost_usd, null)
  })

  let failed = 0
  for (const [name, error] of results) {
    if (error) { failed += 1; console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n').slice(0, 4).join('\n     ')}`) } else console.log(`PASS ${name}`)
  }
  console.log(`${results.length - failed}/${results.length} cases passed`)
  if (failed) process.exit(1)
})().catch((error) => { console.error(error); process.exit(1) })
