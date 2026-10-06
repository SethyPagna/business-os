// Release-verifier finding (6 Oct 2026): raising a line's quantity on a PAID,
// Completed sale through POST /api/sales/:id/amendments left it "completed"
// with money owing (total 28.50, paid 9.50), and POST /:id/items did the
// same. Owner model: paid means Completed and a sale that still owes is Not
// Paid. One rule for both routes now (lib/saleLineChangeStatus.ts): a change
// that leaves a paid sale owing moves it to Not Paid in the same batch, and
// the add-items undo/redo replays that status with the money.
//
// Real Hono sales router over the migrated SQLite fixture. On the audited
// release (SEC_SALES_BASELINE=1) the owing sale stays "completed" and this
// suite fails; it passes only with the rule in place.
//
// Run: node test-sec-sales-line-change-owing-pure.cjs
const assert = require('node:assert/strict')
const h = require('./harness/sec_sales_route.cjs')

h.setAutoShift(true)
// Line writes need the reviewed header quote; accept the server's own quote
// for these requests exactly as the till does after its review step.
const requestActual = h.app.request.bind(h.app)
h.app.request = async (url, init, env, ctx) => {
  if (init?.method !== 'POST' || !/^\/\d+\/(items|amendments)$/.test(String(url))) return requestActual(url, init, env, ctx)
  const first = await requestActual(url, init, env, ctx), review = await first.clone().json()
  if (first.status !== 409 || review.code !== 'sale_header_quote_conflict') return first
  return requestActual(url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), expected_header_quote: review.header_quote }) }, env, ctx)
}
const kernel = h.load('lib/moneyPrecision.ts')
function line(key, price, quantity = 1, rate = 4000) {
  const total = kernel.multiplyMoney4(price, quantity)
  return { product_id: 10, quantity, branch_id: 1, batch_id: 500, client_line_key: key, pricing_source: 'manual', selling_price_input_usd: price,
    manual_discount_type: null, manual_discount_value: 0,
    pricing_quote: { gross_usd: total, product_discount_usd: 0, manual_discount_usd: 0, total_usd: total, total_khr: kernel.multiplyMoney4(total, rate) } }
}
const row = (f, id) => f.raw.prepare(`SELECT sale_status,total_usd,amount_paid_usd,is_delivery,delivery_fee_usd FROM sales WHERE id=${Number(id)}`).get()
async function post(f, route, body) {
  const response = await h.app.request(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB: f.route }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}
async function ring(f, key, { quantity = 1, ...extra } = {}) {
  const made = await h.postSale(f.route, { ...h.request(key), money_precision_version: 1, items: [line(key + '-l', 9.5, quantity)], ...extra })
  assert.equal(made.status, 200, JSON.stringify(made.body))
  return made.body.sale
}
const raise = (sale, key, quantity) => ({ money_precision_version: 1, client_request_id: key, expected_exchange_rate: 4000, kind: 'line_updated',
  sale_item_id: sale.items[0].id, quantity, applied_price_usd: 9.5, base_price_usd: 9.5, manual_discount_type: null, manual_discount_value: 0,
  manual_discount_usd: 0, pricing_quote: line('q', 9.5, quantity).pricing_quote })

let failures = 0
async function check(name, body) {
  try { await body(); console.log(`PASS ${name}`) } catch (error) { failures += 1; console.log(`FAIL ${name}\n  ${error && error.stack || error}`) }
}

;(async () => {
  h.setUser({ ...h.USER, permissions: '{"all":true}' })

  await check('amendment: raising a line on a paid Completed sale leaves it Not Paid with the balance owed', async () => {
    const f = h.fixture()
    const sale = await ring(f, 'amend-owing')
    assert.deepEqual({ ...row(f, sale.id) }, { sale_status: 'completed', total_usd: 9.5, amount_paid_usd: 9.5, is_delivery: 0, delivery_fee_usd: 0 })
    const amended = await post(f, `/${sale.id}/amendments`, raise(sale, 'amend-owing-r', 3))
    assert.equal(amended.status, 200, JSON.stringify(amended.body))
    assert.equal(row(f, sale.id).total_usd, 28.5)
    assert.equal(row(f, sale.id).amount_paid_usd, 9.5, 'nothing was collected: the tender is unchanged')
    assert.equal(row(f, sale.id).sale_status, 'awaiting_payment', 'a sale that still owes is Not Paid')
    assert.equal(amended.body.outstandingUsd, 19)
    assert.equal(amended.body.saleStatus, 'awaiting_payment')
  })

  await check('add-items: the same rule -- adding to a paid Completed sale leaves it Not Paid', async () => {
    const f = h.fixture()
    const sale = await ring(f, 'add-owing')
    const added = await post(f, `/${sale.id}/items`, { money_precision_version: 1, client_request_id: 'add-owing-r', expected_exchange_rate: 4000, items: [line('add-owing-2', 9.5, 2)] })
    assert.equal(added.status, 200, JSON.stringify(added.body))
    assert.deepEqual({ ...row(f, sale.id) }, { sale_status: 'awaiting_payment', total_usd: 28.5, amount_paid_usd: 9.5, is_delivery: 0, delivery_fee_usd: 0 })
    assert.equal(added.body.outstandingUsd, 19)
    assert.equal(added.body.saleStatus, 'awaiting_payment')
    // The move is not a payment-correction reopen: the audit carries its own
    // keys, never the newStatus/oldStatus pair that unlocks rewriting the tender
    // (routes/sales.ts saleAllowsPaymentCorrection). The add-items audit row is
    // written inside the batch, so the fixture holds it.
    const audit = f.raw.prepare(`SELECT details FROM audit_logs WHERE entity='sale' AND entity_id='${Number(sale.id)}' ORDER BY id DESC LIMIT 1`).get()
    assert.ok(audit, 'add-items audit row')
    const details = JSON.parse(audit.details)
    assert.deepEqual([details.action, details.sale_status, details.sale_status_after], ['add_items', 'completed', 'awaiting_payment'])
    assert.equal(details.newStatus, undefined)

    // Undo removes the lines AND puts the paid status back; redo re-applies both.
    const replay = async (direction) => {
      const history = f.raw.prepare(`SELECT * FROM action_history WHERE id=${Number(added.body.actionHistoryId)}`).get()
      const payload = JSON.parse(history[direction === 'undo' ? 'undo_payload' : 'redo_payload'])
      const applier = h.load('lib/undoAppliers.ts').resolveUndoApplier(payload)
      await applier.run(payload, { env: { DB: f.route }, user: { ...h.USER, permissions: '{"all":true}' }, direction, historyId: history.id, generation: payload.generation })
    }
    await replay('undo')
    assert.deepEqual({ ...row(f, sale.id) }, { sale_status: 'completed', total_usd: 9.5, amount_paid_usd: 9.5, is_delivery: 0, delivery_fee_usd: 0 })
    await replay('redo')
    assert.deepEqual({ ...row(f, sale.id) }, { sale_status: 'awaiting_payment', total_usd: 28.5, amount_paid_usd: 9.5, is_delivery: 0, delivery_fee_usd: 0 })
  })

  await check('amendment: a delivery fee raised over the tender leaves the sale Not Paid too', async () => {
    const f = h.fixture()
    const sale = await ring(f, 'fee-owing')
    f.raw.prepare(`UPDATE sales SET is_delivery=1, delivery_fee_usd=0, delivery_fee_khr=0, delivery_fee_paid_by='customer' WHERE id=${Number(sale.id)}`).run()
    const fee = await post(f, `/${sale.id}/amendments`, { money_precision_version: 1, client_request_id: 'fee-owing-r', expected_exchange_rate: 4000, kind: 'delivery_fee_changed', delivery_fee_usd: 2 })
    assert.equal(fee.status, 200, JSON.stringify(fee.body))
    assert.deepEqual({ ...row(f, sale.id) }, { sale_status: 'awaiting_payment', total_usd: 11.5, amount_paid_usd: 9.5, is_delivery: 1, delivery_fee_usd: 2 })
  })

  await check('control: a change the tender still covers leaves a paid sale Completed', async () => {
    const f = h.fixture()
    const sale = await ring(f, 'covered', { quantity: 2, amount_paid_usd: 19 })
    assert.equal(row(f, sale.id).amount_paid_usd, 19)
    const lowered = await post(f, `/${sale.id}/amendments`, raise(sale, 'covered-r', 1))
    assert.equal(lowered.status, 200, JSON.stringify(lowered.body))
    assert.equal(row(f, sale.id).total_usd, 9.5)
    assert.equal(row(f, sale.id).sale_status, 'completed')
  })

  await check('control: forward only -- a Not Paid sale stays Not Paid, and the move is never to Completed', async () => {
    const f = h.fixture()
    const sale = await ring(f, 'unpaid', { sale_status: 'awaiting_payment', amount_paid_usd: 0, amount_paid_khr: 0, payment_details: [] })
    assert.equal(row(f, sale.id).sale_status, 'awaiting_payment')
    const added = await post(f, `/${sale.id}/items`, { money_precision_version: 1, client_request_id: 'unpaid-r', expected_exchange_rate: 4000, items: [line('unpaid-2', 9.5)] })
    assert.equal(added.status, 200, JSON.stringify(added.body))
    assert.equal(row(f, sale.id).sale_status, 'awaiting_payment')
  })

  if (failures) {
    console.log(`\n${failures} check(s) failed${h.baseline ? ' (expected on the audited baseline: the owing sale stays completed)' : ''}`)
    process.exit(1)
  }
  console.log('\nAll line-change status checks passed')
})().catch((error) => { console.error(error); process.exit(1) })
