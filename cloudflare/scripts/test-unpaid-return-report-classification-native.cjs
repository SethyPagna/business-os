const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
  + '\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,overrides,setUser(value){currentUser=value}};', file)
const h = harness.exports
h.overrides['../lib/cache'].bumpVersions = async () => {}
Object.assign(h.overrides['../lib/telegram'], { sendReturnTelegramEvent: async () => {}, sendReturnStatusTelegramEvents: async () => {} })
h.overrides['./cache'] = h.overrides['../lib/cache']
h.overrides['./telegram'] = h.overrides['../lib/telegram']
const returns = h.load('routes/returns.ts').default
const analytics = h.load('lib/salesAnalytics.ts')
const reports = h.load('routes/reports.ts').default
const bulk = h.load('lib/returnBulkAction.ts')
const shiftKernel = h.load('lib/shiftReconciliation.ts')
const telegram = h.load('lib/telegram.ts')
const owner = { ...h.USER, permissions: '{"all":true}' }
const date = '2026-09-13'
const filters = { startDate: date, endDate: date }

async function send(app, f, method, url, body) {
  const response = await app.request(url, { method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: f.route }, h.executionCtx)
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result
}

async function createSale(f, key, paid = false, delivery = false) {
  const original = h.request(key)
  const result = await h.postSale(f.route, { ...original, sale_status: paid ? 'completed' : 'awaiting_payment',
    amount_paid_usd: paid ? 19 + (delivery ? 2 : 0) : 0,
    ...(delivery ? { is_delivery: true, delivery_fee_usd: 2, delivery_fee_paid_by: 'customer' } : {}),
    items: [{ ...original.items[0], quantity: 2,
      pricing_quote: { ...original.items[0].pricing_quote, gross_usd: 19, total_usd: 19, total_khr: 76000 } }] })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  f.raw.prepare("UPDATE sales SET created_at='2026-09-13 01:00:00' WHERE id=?").run([result.body.id])
  return result.body.sale
}

async function createReturn(f, sale, key, quantity = 1, stockAction = 'restock') {
  const quoted = await send(returns, f, 'POST', '/quote', { sale_id: sale.id,
    items: [{ sale_item_id: sale.items[0].id, quantity }] })
  const { customer_return_create_version: _create, customer_return_edit_version: _edit, ...expected_quote } = quoted
  return send(returns, f, 'POST', '/', { client_request_id: key, money_precision_version: 1,
    sale_id: sale.id, reason: 'Unpaid return reporting regression', expected_quote,
    items: [{ sale_item_id: sale.items[0].id, quantity, stock_action: stockAction, branch_id: 1 }] })
}

async function status(f, id, target, key) {
  const row = f.raw.prepare(`SELECT id,COALESCE(status,'completed') expected_status,
    COALESCE(return_type,'restock') expected_method,updated_at expected_updated_at FROM returns WHERE id=?`).get([id])
  return send(returns, f, 'POST', '/bulk', { client_request_id: key, field: 'status', source: row.expected_status,
    target, items: [row] })
}

async function replay(f, receipt, direction) {
  const history = f.raw.prepare('SELECT undo_payload,redo_payload FROM action_history WHERE id=?').get([receipt.actionHistoryId])
  const payload = JSON.parse(history[direction === 'undo' ? 'undo_payload' : 'redo_payload'])
  await bulk.replayReturnBulkAction({ DB: f.route }, owner, direction, receipt.actionHistoryId, payload.generation, payload)
}

async function assertUnpaidConsumers(f, rawStatus, label) {
  const env = { DB: f.route }
  const snapshot = await analytics.readSalesReportSnapshot(env, filters)
  const totals = analytics.salesTotalsFromSnapshot(snapshot)
  assert.equal(totals.collected_total_usd, 0, `${label}: collected`)
  assert.equal(totals.pending_tx_count, 1, `${label}: pending count`)
  const row = analytics.businessSummarySalesRowsFromSnapshot(snapshot)[0]
  assert.equal(row.collected_total_usd, 0, `${label}: export row collected`)
  assert.equal(row.status, rawStatus, `${label}: raw export status is retained`)
  const remaining = rawStatus === 'returned' ? 0 : rawStatus === 'partial_return' ? 1 : 2
  assert.equal(totals.pending_revenue_usd, remaining * 9.5, `${label}: pending revenue reverses the same merchandise recognition as revenue`)
  assert.equal(row.pending_revenue_usd, totals.pending_revenue_usd, `${label}: aggregate pending and export row agree`)
  assert.equal(totals.pending_cost_usd, remaining * 4, `${label}: pending COGS reverses only restocked cost`)
  assert.equal(totals.pending_profit_usd, remaining * 5.5, `${label}: pending profit is the same recognized unpaid subset`)
  const payment = analytics.paymentMethodBreakdownFromSnapshot(snapshot)[0]
  assert.equal(payment.collected_usd, 0, `${label}: payment collected`)
  const day = await analytics.getSalesDayReport(env, date)
  assert.equal(day.totals.collected_total_usd, 0, `${label}: day collected`)
  assert.equal(day.totals.pending_revenue_usd, totals.pending_revenue_usd, `${label}: day pending amount`)
  assert.equal(day.sales[0].collected_usd, 0, `${label}: day row collected`)
  const cashier = (await analytics.getSalesGroupedTotals(env, filters, 'cashier'))[0]
  assert.equal(cashier.paid_tx_count, 0, `${label}: live SQL cashier paid counter`)
  assert.equal(cashier.pending_revenue_usd, totals.pending_revenue_usd, `${label}: cashier pending amount`)
  assert.equal(cashier.pending_cost_usd, totals.pending_cost_usd, `${label}: cashier pending COGS`)
  assert.equal(cashier.pending_profit_usd, totals.pending_profit_usd, `${label}: cashier pending profit`)
  const customer = await analytics.getCustomerSalesTotals(env, { ...filters, customerId: 7 })
  assert.equal(customer.collected_usd, 0, `${label}: direct SQL customer eligibility`)
  const exported = await send(reports, f, 'GET', `/business-summary/sales?intent=export&startDate=${date}&endDate=${date}`)
  assert.equal(exported.totals.collected_total_usd, 0, `${label}: actual export route total`)
  assert.equal(exported.totals.pending_revenue_usd, row.pending_revenue_usd, `${label}: actual export pending amount`)
  assert.equal(exported.rows[0].collected_total_usd, 0, `${label}: actual export route row`)
  const strip = await send(h.app, f, 'GET', `/stats-strip?startDate=${date}&endDate=${date}`)
  assert.equal(strip.totals.collected_total_usd, 0, `${label}: actual stats route`)
  assert.equal(strip.totals.pending_revenue_usd, totals.pending_revenue_usd, `${label}: actual stats pending amount`)
  const overview = await telegram.shiftOverviewFigures(env, { business_date: date, branch_id: 1 })
  assert.equal(overview.creditUsd, totals.pending_revenue_usd, `${label}: actual Telegram overview input`)
  assert.equal(overview.revenueUsd, totals.revenue_usd, `${label}: Telegram recognized basis unchanged`)
  const shift = await shiftKernel.loadShiftFigures(env, { scope_mode: 'shop_wide', user_id: owner.id, branch_id: 1,
    opened_at: '2026-09-13 00:00:00', closed_at: '2026-09-13 02:00:00', opening_float_usd: 0, opening_float_khr: 0 })
  assert.equal(shift.credit_usd, totals.pending_revenue_usd, `${label}: actual shift input`)
  return { totals, exported }
}

function sqlEligibility(f, id, retained = 'sales.status_before_return') {
  return f.raw.prepare(`SELECT ${analytics.awaitingExpr('sales.', retained)} awaiting,
    ${analytics.collectedSaleExpr('sales.', retained)} collected FROM sales WHERE id=?`).get([id])
}

;(async () => {
  h.setUser(owner)
  const f = h.fixture()
  try {
    const sale = await createSale(f, 'unpaid-report')
    f.raw.prepare("INSERT INTO customers(id,name) VALUES(7,'Unpaid customer')").run()
    f.raw.prepare('UPDATE sales SET customer_id=7 WHERE id=?').run([sale.id])
    const rawCustomerBeforeReturn = await analytics.getCustomerSalesTotals({ DB: f.route }, { ...filters, customerId: 7 })
    const firstReturn = await createReturn(f, sale, 'unpaid-report-partial')
    f.raw.prepare("UPDATE returns SET created_at='2026-10-01 01:00:00' WHERE id=?").run([firstReturn.id])
    const saved = f.raw.prepare('SELECT sale_status,status_before_return FROM sales WHERE id=?').get([sale.id])
    assert.equal(saved.sale_status, 'partial_return')
    assert.equal(saved.status_before_return, 'awaiting_payment')
    const totals = await analytics.getSalesTotals({ DB: f.route }, filters)
    assert.equal(totals.collected_total_usd, 0, 'a partial return must not turn an unpaid sale into collected money')
    assert.equal(totals.pending_tx_count, 1, 'the retained unpaid lifecycle must remain pending')
    assert.equal(rawCustomerBeforeReturn.collected_usd, 0, 'raw unpaid customer totals must share existing collected eligibility')
    console.log('PASS actual unpaid sale/create-return routes preserve pending reporting authority')
    assert.deepEqual({ ...sqlEligibility(f, sale.id) }, { awaiting: 1, collected: 0 })
    const partial = await assertUnpaidConsumers(f, 'partial_return', 'partial')
    assert.equal(partial.totals.revenue_usd, 9.5, 'recognized revenue/refund basis is unchanged')
    const secondReturn = await createReturn(f, sale, 'unpaid-report-full')
    assert.equal(f.raw.prepare('SELECT status_before_return FROM sales WHERE id=?').get([sale.id]).status_before_return, 'awaiting_payment')
    const full = await assertUnpaidConsumers(f, 'returned', 'full')
    assert.equal(full.totals.revenue_usd, 0)
    const cancelled = await status(f, secondReturn.id, 'cancelled', 'cancel-second')
    await assertUnpaidConsumers(f, 'partial_return', 'cancel second')
    await replay(f, cancelled, 'undo')
    await assertUnpaidConsumers(f, 'returned', 'undo cancellation')
    await replay(f, cancelled, 'redo')
    await assertUnpaidConsumers(f, 'partial_return', 'redo cancellation')
    await status(f, firstReturn.id, 'cancelled', 'cancel-first')
    await assertUnpaidConsumers(f, 'awaiting_payment', 'cancel final')
    await status(f, firstReturn.id, 'completed', 'restore-first')
    await assertUnpaidConsumers(f, 'partial_return', 'restore first')
    await status(f, secondReturn.id, 'completed', 'restore-second')
    await assertUnpaidConsumers(f, 'returned', 'restore full')
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM return_create_receipts').get().n, 2)
    assert.equal(f.raw.prepare('SELECT amount_paid_usd FROM sales WHERE id=?').get([sale.id]).amount_paid_usd, 0,
      'reporting must not manufacture a payment')
    const rawFilter = await analytics.getSalesTotals({ DB: f.route }, { ...filters, status: 'awaiting_payment' })
    assert.equal(rawFilter.tx_count, 0, 'raw status filter semantics remain unchanged')
    console.log('PASS partial/full/successive returns, cancel-final, restore and server Undo/Redo; JS/SQL, export, day, payment, cashier, customer, Telegram and shift classification')

    f.raw.prepare("UPDATE sales SET status_before_return='completed' WHERE id=?").run([sale.id])
    const changed = await send(reports, f, 'GET', `/business-summary/sales?intent=export&startDate=${date}&endDate=${date}`)
    assert.notEqual(changed.export_token, full.exported.export_token, 'retained classification belongs to export identity')
    f.raw.prepare("UPDATE sales SET status_before_return='awaiting_payment' WHERE id=?").run([sale.id])
    const originalPrepare = f.route.prepare.bind(f.route)
    let passes = 0
    f.route.prepare = sql => {
      const statement = originalPrepare(sql)
      if (/SELECT s.id,s.created_at,s.sale_status,s.status_before_return,/.test(sql)) return { ...statement, all: params => {
        f.raw.prepare('UPDATE sales SET status_before_return=? WHERE id=?').run([++passes % 2 ? 'awaiting_payment' : 'completed', sale.id])
        return statement.all(params)
      } }
      return statement
    }
    await assert.rejects(() => analytics.readSalesReportSnapshot({ DB: f.route }, filters), error => error.code === 'snapshot_changed')
    assert.equal(passes, 4, 'both attempted pairs compare the captured retained classification')
    f.route.prepare = originalPrepare
    console.log('PASS retained authority participates in export identity and coherent-read race rejection')
  } finally { f.raw.db.close() }

  for (const [label, current, retained, awaiting, collected] of [
    ['paid partial', 'partial_return', 'completed', 0, 1],
    ['paid full', 'returned', 'awaiting_delivery', 0, 1],
    ['missing retained', 'partial_return', null, 0, 1],
    ['invalid retained', 'returned', 'unknown', 0, 1],
    ['stale completed', 'completed', 'awaiting_payment', 0, 1],
    ['cancelled override', 'cancelled', 'awaiting_payment', 0, 0],
    ['literal retained only', 'partial_return', ' awaiting_payment', 0, 1],
  ]) {
    const control = h.fixture()
    try {
      control.raw.prepare(`INSERT INTO sales(id,receipt_number,sale_status,status_before_return,subtotal_usd,total_usd,
        money_precision_version,created_at,branch_id) VALUES(1,'CONTROL',?,?,19,19,0,'2026-09-13 01:00:00',1)`).run([current, retained])
      assert.deepEqual({ ...sqlEligibility(control, 1) }, { awaiting, collected }, label)
      const totals = await analytics.getSalesTotals({ DB: control.route }, filters)
      assert.equal(totals.pending_tx_count, awaiting, label)
      assert.equal(totals.collected_total_usd, collected * 19, label)
      if (current !== 'cancelled') assert.equal(analytics.businessSummarySalesRowsFromSnapshot(await analytics.readSalesReportSnapshot({ DB: control.route }, filters))[0].status, current)
    } finally { control.raw.db.close() }
  }
  console.log('PASS paid, missing, invalid, strict-literal, stale Completed and Cancelled JS/SQL controls without guessed authority')
  for (const paid of [false, true]) {
    const delivery = h.fixture()
    try {
      const sale = await createSale(delivery, `delivery-${paid}`, paid, true)
      await createReturn(delivery, sale, `delivery-return-${paid}`)
      delivery.raw.prepare("INSERT INTO customers(id,name) VALUES(7,'Delivery customer')").run()
      delivery.raw.prepare('UPDATE sales SET customer_id=7 WHERE id=?').run([sale.id])
      const totals = await analytics.getSalesTotals({ DB: delivery.route }, filters)
      const courier = (await analytics.getDeliveryContactTotals({ DB: delivery.route }, filters))[0]
      assert.equal(courier.receivable_fee_usd, paid ? 0 : 2, 'retained unpaid delivery stays receivable')
      assert.equal(courier.paid_fee_usd, paid ? 2 : 0, 'delivery collection uses the same reporting authority')
      assert.equal(totals.pending_tx_count, paid ? 0 : 1)
      assert.equal(totals.pending_revenue_usd, paid ? 0 : 9.5, 'delivery charge stays outside net pending merchandise')
      assert.equal(totals.pending_cost_usd, paid ? 0 : 4)
      assert.equal(totals.pending_profit_usd, paid ? 0 : 7.5, 'unpaid profit includes established delivery margin once')
      if (paid) assert.ok(totals.collected_total_usd > 0, 'actual paid return remains eligible for recorded collection')
      else assert.equal(totals.collected_total_usd, 0)
      const customer = await analytics.getCustomerSalesTotals({ DB: delivery.route }, { ...filters, customerId: 7 })
      assert.equal(customer.collected_usd, paid ? 21 : 0, 'customer eligibility changes without adding refund subtraction to its recorded payable basis')
      h.setUser({ ...h.USER, permissions: '{"sales":"view"}' })
      const employee = await send(reports, delivery, 'GET', `/business-summary/sales?intent=export&startDate=${date}&endDate=${date}`)
      assert.equal(employee.totals.collected_total_usd, totals.collected_total_usd)
      assert.equal(Object.hasOwn(employee.totals, 'cost_usd'), false, 'employee cost redaction remains independent')
      h.setUser({ ...h.USER, permissions: '{}' })
      assert.equal((await reports.request(`/business-summary/sales?intent=export&startDate=${date}&endDate=${date}`, {}, { DB: delivery.route }, h.executionCtx)).status, 403)
      h.setUser(owner)
      await createReturn(delivery, sale, `delivery-return-full-${paid}`)
      const full = await analytics.getSalesTotals({ DB: delivery.route }, filters)
      assert.equal(full.pending_revenue_usd, 0)
      assert.equal(full.pending_cost_usd, 0)
      assert.equal(full.pending_profit_usd, paid ? 0 : 2, 'a full merchandise return retains the established delivery margin')
    } finally { delivery.raw.db.close() }
  }
  console.log('PASS actual paid/unpaid delivery return controls and employee export permission/redaction')
  const disposition = h.fixture()
  try {
    const sale = await createSale(disposition, 'unpaid-none')
    await createReturn(disposition, sale, 'unpaid-none-return', 1, 'none')
    const totals = await analytics.getSalesTotals({ DB: disposition.route }, filters)
    assert.equal(totals.pending_revenue_usd, 9.5)
    assert.equal(totals.pending_cost_usd, 8, 'a non-restock return does not put cost back on the sellable shelf')
    assert.equal(totals.pending_profit_usd, 1.5)
    await createReturn(disposition, sale, 'unpaid-none-full', 1, 'none')
    const full = await analytics.getSalesTotals({ DB: disposition.route }, filters)
    assert.equal(full.pending_revenue_usd, 0)
    assert.equal(full.pending_cost_usd, 8)
    assert.equal(full.pending_profit_usd, -8, 'a real recognized loss is not clamped at the pending display')
    console.log('PASS actual non-restock partial/full returns preserve COGS and unfloored pending loss')
  } finally { disposition.raw.db.close() }
  const floor = h.fixture()
  try {
    for (const [id, current, subtotal, cost] of [[1, 'awaiting_payment', 19, null], [2, 'awaiting_payment', 19, 10],
      [3, 'completed', 19, 20], [4, 'awaiting_payment', 0, 9], [5, 'cancelled', 19, 100]]) {
      floor.raw.prepare(`INSERT INTO sales(id,receipt_number,sale_status,subtotal_usd,total_usd,money_precision_version,
        created_at,branch_id) VALUES(?,?,?, ?,?,0,'2026-09-13 01:00:00',1)`).run([id, `FLOOR-${id}`, current, subtotal, subtotal])
      floor.raw.prepare('INSERT INTO sale_items(id,sale_id,quantity,total_usd,cost_price_usd) VALUES(?,?,1,?,?)').run([id, id, subtotal, cost])
    }
    for (const [id, saleId, scope, current, cost] of [[1, 1, 'customer', 'completed', 6], [2, 3, 'customer', 'completed', 30],
      [3, 2, 'supplier', 'completed', 100], [4, 2, 'customer', 'cancelled', 100], [5, 5, 'customer', 'completed', 100]]) {
      floor.raw.prepare(`INSERT INTO returns(id,sale_id,return_scope,status,total_refund_usd,money_precision_version,created_at)
        VALUES(?,?,?,?,0,0,'2026-10-01 01:00:00')`).run([id, saleId, scope, current])
      floor.raw.prepare(`INSERT INTO return_items(id,return_id,sale_item_id,quantity,cost_price_usd,stock_action)
        VALUES(?,?,?,1,?,'restock')`).run([id, id, saleId, cost])
    }
    const snapshot = await analytics.readSalesReportSnapshot({ DB: floor.route }, filters)
    const totals = analytics.salesTotalsFromSnapshot(snapshot)
    assert.equal(totals.pending_revenue_usd, 38)
    assert.equal(totals.pending_cost_usd, 4, 'one pending-cohort floor: valued cost10 minus pending restock6, excluding paid/supplier/cancelled/unvalued effects')
    assert.equal(totals.pending_profit_usd, 34)
    assert.equal(totals.unvalued_cost_usd, 9)
    assert.equal(totals.returned_cost_shortfall_usd, 6, 'recognized cohort floor retains its independent existing diagnostic')
    const rows = analytics.businessSummarySalesRowsFromSnapshot(snapshot)
    assert.equal(rows.reduce((sum, row) => sum + row.pending_revenue_usd, 0), totals.pending_revenue_usd)
    assert.equal(rows.filter(row => [1, 2, 4].includes(row.id)).reduce((sum, row) => sum + row.cost_usd, 0), 10,
      'receipt cost floors remain distinct from the established aggregate cohort floor')
    console.log('PASS mixed paid/unpaid/unvalued cost cohorts, supplier/cancelled scope and one exact pending bucket floor')
  } finally { floor.raw.db.close() }
  const legacy = h.fixture()
  try {
    h.load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests()
    legacy.raw.db.exec('ALTER TABLE sales DROP COLUMN status_before_return')
    legacy.raw.prepare(`INSERT INTO sales(id,receipt_number,sale_status,subtotal_usd,total_usd,money_precision_version,
      created_at,branch_id) VALUES(1,'PRE-0125','partial_return',19,19,0,'2026-09-13 01:00:00',1)`).run()
    assert.deepEqual({ ...sqlEligibility(legacy, 1, 'NULL') }, { awaiting: 0, collected: 1 }, 'NULL authority cannot leak SQL NULL')
    const snapshot = await analytics.readSalesReportSnapshot({ DB: legacy.route }, filters)
    assert.equal(snapshot.sales[0].status_before_return, null)
    assert.equal(analytics.salesTotalsFromSnapshot(snapshot).collected_total_usd, 19)
    assert.equal((await analytics.getSalesGroupedTotals({ DB: legacy.route }, filters, 'cashier'))[0].paid_tx_count, 1)
    assert.equal((await analytics.getCustomerSalesTotals({ DB: legacy.route }, { ...filters, customerId: 7 })).collected_usd, 0)
    console.log('PASS genuine pre-0125 schema optional NULL capture and live cashier SQL compatibility')
  } finally { legacy.raw.db.close(); h.load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests() }
})().catch(error => { console.error(error); process.exitCode = 1 })
