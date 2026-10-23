// Lane 6.0.967: raising a PAID sale's total moves the sale to Not Paid for the difference (owner, 23 Oct 2026).
//
// Drives the real routes (POST /:id/items, POST /:id/amendments), the real undo applier and the real reporting SQL on a migrated
// SQLite fixture -- the same harness test-sale-money-writers-native.cjs uses. Every writer that can raise a sale total is covered:
//   line_added (items route), line_updated (price / quantity edit), line_quantity_increased, delivery_added,
//   delivery_fee_changed, add-items Undo and Redo; and the writers that cannot raise a total are pinned by source.
// Money facts after a raise: status Not Paid, tender unchanged (the deposit), owed = total - tender, never counted as cash.
//
// Run: node scripts/test-sale-raised-after-payment-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module); harness.filename = file; harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
  + '\nmodule.exports={fixture,request,postSale,creationState,app,executionCtx,USER,setUser(value){currentUser=value},load};', file)
const h = harness.exports
const requestActual = h.app.request.bind(h.app), reviewedBodies = new Map()
h.app.request = async (url, init, env, ctx) => {
  if (init?.method !== 'POST' || !/^\/\d+\/(items|amendments)$/.test(String(url))) return requestActual(url, init, env, ctx)
  const body = JSON.parse(init.body), key = body.client_request_id
  if (reviewedBodies.has(key)) return requestActual(url, { ...init, body: JSON.stringify({ ...body, expected_header_quote: reviewedBodies.get(key) }) }, env, ctx)
  const first = await requestActual(url, init, env, ctx), review = await first.clone().json()
  if (first.status !== 409 || review.code !== 'sale_header_quote_conflict') return first
  assert.equal(review.proven_uncommitted, true)
  reviewedBodies.set(key, review.header_quote)
  return requestActual(url, { ...init, body: JSON.stringify({ ...body, expected_header_quote: review.header_quote }) }, env, ctx)
}
const kernel = h.load('lib/moneyPrecision.ts')
const resolution = h.load('lib/saleStatusResolution.ts')
const raised = h.load('lib/saleRaisedAfterPayment.ts')
function intent(key, base, quantity = 1, fixed = 0, rate = 4000) {
  const gross = kernel.multiplyMoney4(base, quantity), manual = kernel.multiplyMoney4(fixed, quantity), total = kernel.subtractMoney4(gross, manual)
  return { product_id: 10, quantity, branch_id: 1, batch_id: 500, client_line_key: key, pricing_source: 'manual', selling_price_input_usd: base, manual_discount_type: fixed ? 'fixed' : null, manual_discount_value: fixed,
    pricing_quote: { gross_usd: gross, product_discount_usd: 0, manual_discount_usd: manual, total_usd: total, total_khr: kernel.multiplyMoney4(total, rate) } }
}
const originalRequest = h.request
h.request = (id) => ({ ...originalRequest(id), items: [intent(id + '-line', 9.5)] })

let passed = 0
const pass = (name) => { passed += 1; console.log(`PASS ${name}`) }
const ADMIN = { ...h.USER, permissions: JSON.stringify({ all: true, product_cost_view: true }) }

async function paidSale(f, id) {
  h.setUser(ADMIN)
  const created = await h.postSale(f.route, { ...h.request(id), money_precision_version: 1 })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const row = f.raw.prepare('SELECT * FROM sales WHERE id=@id').get({ id: created.body.id })
  assert.equal(row.sale_status, 'completed')
  return row
}
const send = (f, route) => async (saleId, kind, payload) => {
  const response = await h.app.request(`/${saleId}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }, { DB: f.route }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}
const header = (f, id) => f.raw.prepare('SELECT * FROM sales WHERE id=@id').get({ id })
const owed = (row) => resolution.recordedSaleOutstandingUsd(row)
const replay = async (f, historyId, direction) => {
  const history = f.raw.prepare('SELECT * FROM action_history WHERE id=@id').get({ id: historyId })
  const payload = JSON.parse(history[direction === 'undo' ? 'undo_payload' : 'redo_payload'])
  await h.load('lib/undoAppliers.ts').resolveUndoApplier(payload).run(payload, { env: { DB: f.route }, user: { ...h.USER, permissions: '{"all":true}' }, direction, historyId: history.id, generation: payload.generation })
}

async function run() {
  // ---------------------------------------------------------------- line_added + undo + redo
  const f = h.fixture()
  const sale = await paidSale(f, 'raise-1')
  const paidUsd = sale.amount_paid_usd, paidKhr = sale.amount_paid_khr, totalBefore = sale.total_usd
  assert.equal(owed(sale), 0)
  const addItems = send(f, 'items')
  const added = await addItems(sale.id, 'items', { money_precision_version: 1, client_request_id: 'raise-add', expected_exchange_rate: 4000, items: [intent('raise-add-line', 3)] })
  assert.equal(added.status, 200, JSON.stringify(added.body))
  assert.equal(added.body.movedToNotPaid, true)
  assert.equal(added.body.saleStatus, 'awaiting_payment')
  let row = header(f, sale.id)
  assert.equal(row.sale_status, 'awaiting_payment', 'the raised sale is Not Paid')
  assert.equal(row.amount_paid_usd, paidUsd); assert.equal(row.amount_paid_khr, paidKhr)
  assert.ok(row.total_usd > totalBefore)
  assert.equal(owed(row), Math.round((row.total_usd - totalBefore) * 100) / 100, 'it owes exactly the increase')
  assert.equal(added.body.outstandingUsd, owed(row))
  const audit = JSON.parse(f.raw.prepare("SELECT details FROM audit_logs WHERE entity='sale' AND entity_id=@id ORDER BY id DESC LIMIT 1").get({ id: String(sale.id) }).details)
  assert.equal(audit.sale_status_after, 'awaiting_payment'); assert.equal(audit.owed_after_usd, owed(row))
  pass('add items to a paid sale: Not Paid, tender kept as the deposit, owed = the increase, audit says so')

  const reports = h.load('lib/salesAnalytics.ts')
  const awaiting = f.raw.prepare(`SELECT COUNT(*) AS n FROM sales s WHERE ${reports.awaitingExpr('s.')}`).get().n
  const collected = f.raw.prepare(`SELECT COUNT(*) AS n FROM sales s WHERE ${reports.collectedSaleExpr('s.')}`).get().n
  assert.equal(awaiting, 1, 'the report cohort sees the raised sale as Not Paid (receivables, shift Not Paid line, owed figures)')
  assert.equal(collected, 0, 'and not as a collected (paid) sale')
  pass('the reporting definitions (awaitingExpr / collectedSaleExpr) count the raised sale as Not Paid, not as collected')

  await replay(f, added.body.actionHistoryId, 'undo')
  row = header(f, sale.id)
  assert.equal(row.sale_status, 'completed', 'Undo puts the paid status back')
  assert.equal(row.total_usd, totalBefore); assert.equal(owed(row), 0)
  await replay(f, added.body.actionHistoryId, 'redo')
  row = header(f, sale.id)
  assert.equal(row.sale_status, 'awaiting_payment', 'Redo moves it to Not Paid again')
  assert.ok(owed(row) > 0)
  await replay(f, added.body.actionHistoryId, 'undo')
  assert.equal(header(f, sale.id).sale_status, 'completed')
  pass('Undo restores Completed and the old total; Redo moves it to Not Paid again; Undo again')

  // settled in between: the replay refuses instead of overwriting the settlement
  const g = h.fixture()
  const sale2 = await paidSale(g, 'raise-2')
  const addedG = await send(g, 'items')(sale2.id, 'items', { money_precision_version: 1, client_request_id: 'raise2-add', expected_exchange_rate: 4000, items: [intent('raise2-line', 3)] })
  assert.equal(addedG.body.movedToNotPaid, true)
  g.raw.prepare("UPDATE sales SET sale_status='completed' WHERE id=@id").run({ id: sale2.id })
  await assert.rejects(() => replay(g, addedG.body.actionHistoryId, 'undo'), /status changed|cannot be undone|undone safely/i)
  assert.equal(header(g, sale2.id).sale_status, 'completed')
  pass('Undo after the status changed again is refused')

  // a raise that the tender still covers (a smaller sale, tender above the total) does not move the sale
  const covered = h.fixture()
  const sale4 = await paidSale(covered, 'raise-4')
  covered.raw.prepare('UPDATE sales SET amount_paid_usd=amount_paid_usd+50 WHERE id=@id').run({ id: sale4.id })
  const bigTender = await send(covered, 'items')(sale4.id, 'items', { money_precision_version: 1, client_request_id: 'raise4-add', expected_exchange_rate: 4000, items: [intent('raise4-line', 1)] })
  assert.equal(bigTender.status, 200, JSON.stringify(bigTender.body))
  assert.equal(Object.hasOwn(bigTender.body, 'movedToNotPaid'), false)
  assert.equal(header(covered, sale4.id).sale_status, 'completed', 'the tender still covers the new total')
  // its snapshot carries no sale_status, which is exactly the shape of every action recorded before this rule: a replay writes money only
  const plain = JSON.parse(covered.raw.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='sale.add_items'").get().payload_json)
  assert.equal(Object.hasOwn(plain.moneyBefore, 'sale_status') || Object.hasOwn(plain.moneyAfter, 'sale_status'), false)
  const totalWithLine = header(covered, sale4.id).total_usd
  await replay(covered, bigTender.body.actionHistoryId, 'undo')
  assert.equal(header(covered, sale4.id).sale_status, 'completed'); assert.equal(header(covered, sale4.id).total_usd, sale4.total_usd)
  await replay(covered, bigTender.body.actionHistoryId, 'redo')
  assert.equal(header(covered, sale4.id).total_usd, totalWithLine); assert.equal(header(covered, sale4.id).sale_status, 'completed')
  pass('a raise the tender still covers leaves the sale Completed, and its snapshot (the pre-rule shape) replays money only')

  // an already Not Paid sale stays Not Paid and the response does not claim a move
  const notPaidDb = h.fixture()
  h.setUser(ADMIN)
  const waiting = await h.postSale(notPaidDb.route, { ...h.request('np-1'), money_precision_version: 1, sale_status: 'awaiting_payment', amount_paid_usd: 0, amount_paid_khr: 0, payment_details: [] })
  assert.equal(waiting.status, 200, JSON.stringify(waiting.body))
  const addedNp = await send(notPaidDb, 'items')(waiting.body.id, 'items', { money_precision_version: 1, client_request_id: 'np-add', expected_exchange_rate: 4000, items: [intent('np-line', 1)] })
  assert.equal(addedNp.status, 200, JSON.stringify(addedNp.body))
  assert.equal(Object.hasOwn(addedNp.body, 'movedToNotPaid'), false)
  assert.equal(header(notPaidDb, waiting.body.id).sale_status, 'awaiting_payment')
  pass('an already Not Paid sale stays Not Paid (no move reported)')

  // ---------------------------------------------------------------- amendments
  const amend = send(f, 'amendments')
  // line_quantity_increased / line_updated: the existing line goes from 1 to 2 at the same price
  const m = await paidSale(f, 'amend-1')
  const line = f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=@id').get({ id: m.id })
  const edit = await amend(m.id, 'amendments', { money_precision_version: 1, client_request_id: 'amend-qty', expected_exchange_rate: 4000, kind: 'line_updated', sale_item_id: line.id,
    quantity: 2, applied_price_usd: 9.5, base_price_usd: 9.5, manual_discount_type: null, manual_discount_value: 0, manual_discount_usd: 0, pricing_quote: intent('amend-qty-line', 9.5, 2).pricing_quote })
  assert.equal(edit.status, 200, JSON.stringify(edit.body))
  assert.equal(edit.body.movedToNotPaid, true, 'a line_updated that raises the total moves the paid sale to Not Paid')
  assert.equal(edit.body.saleStatus, 'awaiting_payment')
  row = header(f, m.id)
  assert.equal(row.sale_status, 'awaiting_payment'); assert.equal(row.amount_paid_usd, m.amount_paid_usd)
  assert.equal(owed(row), Math.round((row.total_usd - m.total_usd) * 100) / 100)
  const retry = await amend(m.id, 'amendments', { money_precision_version: 1, client_request_id: 'amend-qty', expected_exchange_rate: 4000, kind: 'line_updated', sale_item_id: line.id,
    quantity: 2, applied_price_usd: 9.5, base_price_usd: 9.5, manual_discount_type: null, manual_discount_value: 0, manual_discount_usd: 0, pricing_quote: intent('amend-qty-line', 9.5, 2).pricing_quote })
  assert.deepEqual(retry.body, edit.body, 'a retried request returns the stored answer and writes nothing')
  pass('line_updated (quantity raise): Not Paid, deposit kept, retry is idempotent')

  // a price edit that raises the total: the sale was rung up with a $2 fixed discount and the discount is removed
  h.setUser(ADMIN)
  const discounted = await h.postSale(f.route, { ...h.request('amend-2'), money_precision_version: 1, amount_paid_usd: 7.5, items: [intent('amend-2-line', 9.5, 1, 2)] })
  assert.equal(discounted.status, 200, JSON.stringify(discounted.body))
  const p = header(f, discounted.body.id)
  assert.equal(p.sale_status, 'completed'); assert.equal(p.total_usd, 7.5)
  const pline = f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=@id').get({ id: p.id })
  const price = await amend(p.id, 'amendments', { money_precision_version: 1, client_request_id: 'amend-price', expected_exchange_rate: 4000, kind: 'line_updated', sale_item_id: pline.id,
    quantity: 1, applied_price_usd: 9.5, base_price_usd: 9.5, manual_discount_type: null, manual_discount_value: 0, manual_discount_usd: 0, pricing_quote: intent('amend-2-line', 9.5, 1).pricing_quote })
  assert.equal(price.status, 200, JSON.stringify(price.body))
  assert.equal(price.body.movedToNotPaid, true)
  assert.equal(header(f, p.id).total_usd, 9.5)
  assert.equal(header(f, p.id).sale_status, 'awaiting_payment')
  assert.equal(owed(header(f, p.id)), 2)
  pass('line_updated (price edit that removes a discount, 7.50 -> 9.50): Not Paid, owes 2.00')

  // lowering the price of a paid sale never creates a debt
  const q = await paidSale(f, 'amend-3')
  const qline = f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=@id').get({ id: q.id })
  const lower = await amend(q.id, 'amendments', { money_precision_version: 1, client_request_id: 'amend-lower', expected_exchange_rate: 4000, kind: 'line_updated', sale_item_id: qline.id,
    quantity: 1, applied_price_usd: 7.5, base_price_usd: 9.5, manual_discount_type: 'fixed', manual_discount_value: 2, manual_discount_usd: 2, pricing_quote: intent('amend-3-line', 9.5, 1, 2).pricing_quote })
  assert.equal(lower.status, 200, JSON.stringify(lower.body))
  assert.equal(Object.hasOwn(lower.body, 'movedToNotPaid'), false)
  assert.equal(header(f, q.id).sale_status, 'completed'); assert.equal(header(f, q.id).total_usd, 7.5)
  pass('lowering a paid sale leaves it Completed')

  // delivery_added and delivery_fee_changed raise the total by the fee
  f.raw.prepare("INSERT INTO delivery_contacts(id,name,phone,address) VALUES(1,'Driver','012345678','Phnom Penh')").run()
  const d = await paidSale(f, 'amend-4')
  const delivery = await amend(d.id, 'amendments', { money_precision_version: 1, client_request_id: 'amend-delivery', expected_exchange_rate: 4000, kind: 'delivery_added', delivery_contact_id: 1, delivery_fee_usd: 1.5 })
  assert.equal(delivery.status, 200, JSON.stringify(delivery.body))
  assert.equal(delivery.body.movedToNotPaid, true, 'delivery_added raises the total, so the paid sale owes the fee')
  assert.equal(header(f, d.id).sale_status, 'awaiting_payment')
  assert.equal(owed(header(f, d.id)), 1.5)
  const fee = await amend(d.id, 'amendments', { money_precision_version: 1, client_request_id: 'amend-fee', expected_exchange_rate: 4000, kind: 'delivery_fee_changed', delivery_fee_usd: 2.5 })
  assert.equal(fee.status, 200, JSON.stringify(fee.body))
  assert.equal(Object.hasOwn(fee.body, 'movedToNotPaid'), false, 'already Not Paid: no second move')
  assert.equal(owed(header(f, d.id)), 2.5)
  const e = await paidSale(f, 'amend-5')
  await send(f, 'amendments')(e.id, 'amendments', { money_precision_version: 1, client_request_id: 'amend-delivery-2', expected_exchange_rate: 4000, kind: 'delivery_added', delivery_contact_id: 1, delivery_fee_usd: 0 })
  assert.equal(header(f, e.id).sale_status, 'completed', 'a free delivery raises nothing')
  f.raw.prepare("UPDATE sales SET amount_paid_usd=amount_paid_usd+0 WHERE id=@id").run({ id: e.id })
  const fee2 = await send(f, 'amendments')(e.id, 'amendments', { money_precision_version: 1, client_request_id: 'amend-fee-2', expected_exchange_rate: 4000, kind: 'delivery_fee_changed', delivery_fee_usd: 2 })
  assert.equal(fee2.status, 200, JSON.stringify(fee2.body))
  assert.equal(fee2.body.movedToNotPaid, true, 'delivery_fee_changed on a paid sale raises the total')
  assert.equal(header(f, e.id).sale_status, 'awaiting_payment'); assert.equal(owed(header(f, e.id)), 2)
  pass('delivery_added and delivery_fee_changed: a paid sale owes the fee; a free delivery or an already Not Paid sale moves nothing')

  // ---------------------------------------------------------------- the pure rule
  const base = { sale_status: 'completed', amount_paid_usd: 10, amount_paid_khr: 0, exchange_rate: 4000, money_precision_version: 1, calculated_total_usd: 10, total_usd: 10, delivery_pending: 0 }
  const move = (sale, total) => raised.notPaidStatusAfterRaise(sale, { total_usd: total, exchange_rate: sale.exchange_rate, money_precision_version: sale.money_precision_version, calculated_total_usd: total })
  assert.deepEqual(move(base, 12), { before: { sale_status: 'completed', delivery_pending: 0 }, after: { sale_status: 'awaiting_payment', delivery_pending: 0 } })
  assert.equal(move(base, 10), null); assert.equal(move(base, 8), null)
  assert.equal(move(base, 10.004), null, 'within half a cent the tender still covers it')
  assert.notEqual(move(base, 10.01), null, 'a cent short is a debt')
  assert.equal(move({ ...base, sale_status: 'awaiting_payment' }, 12), null)
  assert.equal(move({ ...base, sale_status: 'cancelled' }, 12), null)
  assert.equal(move({ ...base, sale_status: 'partial_return', status_before_return: 'completed' }, 12), null, 'a sale with a return is the Returns flow')
  assert.equal(move({ ...base, return_state: 'partial' }, 12), null)
  assert.equal(move({ ...base, exchange_rate: null }, 12), null, 'unreadable money moves nothing')
  const delivery_pending = move({ ...base, delivery_pending: 1 }, 12)
  assert.equal(delivery_pending.after.delivery_pending, 1, 'the delivery tag survives the payment move')
  const retired = move({ ...base, sale_status: 'awaiting_delivery' }, 12)
  assert.deepEqual(retired, { before: { sale_status: 'awaiting_delivery', delivery_pending: 0 }, after: { sale_status: 'awaiting_payment', delivery_pending: 1 } }, 'the retired awaiting_delivery word becomes the delivery tag')
  assert.equal(move({ ...base, amount_paid_usd: 0, amount_paid_khr: 40000 }, 12) !== null, true, 'a riel tender is measured at the sale rate')
  assert.equal(move({ ...base, amount_paid_usd: 0, amount_paid_khr: 40000 }, 10), null)
  const first = h.load('lib/saleLineAddition.ts').expectedSaleStatusForReplay
  assert.equal(first('undo', { saleStatus: 'completed', moneyAfter: { sale_status: 'awaiting_payment' }, moneyBefore: { sale_status: 'completed' } }), 'awaiting_payment')
  assert.equal(first('redo', { saleStatus: 'completed', moneyAfter: { sale_status: 'awaiting_payment' }, moneyBefore: { sale_status: 'completed' } }), 'completed')
  assert.equal(first('undo', { saleStatus: 'completed', moneyAfter: {}, moneyBefore: {} }), 'completed')
  pass('the rule: moves only a paid sale whose tender no longer covers the total (half-cent band, riel tender, legacy words, returns, unreadable money)')

  // ---------------------------------------------------------------- writers that cannot raise a total
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8').replace(/\r\n/g, '\n')
  assert.doesNotMatch(read('lib/reviewApply.ts'), /\bsales?\b\s*:|UPDATE sales|sale_items|amend/i, 'the review queue applies no sale change')
  const importCommit = read('lib/salesImportCommit.ts')
  assert.doesNotMatch(importCommit, /UPDATE sales\b/, 'the sales import only inserts sales (each born with its own tender and status)')
  assert.match(importCommit, /INSERT INTO sales \(/)
  const sales = read('routes/sales.ts')
  const writers = [...sales.matchAll(/saleMoneyUpdateStatement\(saleId, (moneyAfter|moneyAfterSnapshot)\)/g)]
  const marks = [...sales.matchAll(/markSaleNotPaidAfterRaise\(sale, (moneyBefore|moneyBeforeSnapshot), (moneyAfter|moneyAfterSnapshot)\)/g)]
  assert.equal(writers.length, 4, 'four route writers persist a money snapshot: items, delivery_added, delivery_fee_changed, line kinds')
  assert.equal(marks.length, 4, 'and each of them marks the status move before it persists')
  const costOnly = sales.indexOf("if (kind === 'delivery_actual_cost_changed')")
  assert.ok(costOnly > 0 && !/saleMoneyUpdateStatement/.test(sales.slice(costOnly, costOnly + 6000).split("if (kind === 'delivery_fee_changed')")[0]), 'the courier cost amendment never touches the total')
  const appliers = read('lib/undoAppliers.ts')
  assert.equal([...appliers.matchAll(/expectedSaleStatusForReplay\(ctx\.direction, reversal\)/g)].length, 2, 'both replay paths expect the status the direction finds')
  pass('writers pinned: review queue and import cannot raise a total; the four route writers each mark; the two replay paths expect the right status')

  console.log(`\n${passed} checks passed`)
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
