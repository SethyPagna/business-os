// KHQR security review N1: the staff detail's money object is ONE shape with the customer view (snake_case: paid_usd, refunded_usd, refund_due_usd, balance_due_usd,
// held_in_review_usd), because the staff Orders screen and the till read exactly those names. This test drives the REAL staff route (staffDetail) on the real migration
// chain and (a) asserts the keys, (b) asserts the response equals the recorded contract fixture `scripts/fixtures/staff-order-detail-contract.json`, which the
// frontend lane's test feeds to the UI's own logic. Run with UPDATE_CONTRACT=1 to rewrite the fixture after an intended change (copy it to the UI lane).
// Wrong builds it turns red on: a staff detail with only camelCase money (the shipped bug), a rename of any field, a refunded_usd that ignores refund notes.
//
// Run: node scripts/test-online-order-staff-money-contract-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createOrdersHarness } = require('./harness/load_portal_orders_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const FIXTURE = path.join(__dirname, 'fixtures', 'staff-order-detail-contract.json')
const T0 = Date.UTC(2026, 10, 9, 3, 0, 0)
const ADMIN = { id: 1, name: 'Owner', username: 'owner', permissions: JSON.stringify({ all: true }), role_permissions: null, role_code: 'admin' }
const MONEY_KEYS = ['balance_due_usd', 'held_in_review_usd', 'paid_usd', 'refund_due_usd', 'refunded_usd']

async function main() {
  const h = createOrdersHarness({ switchOn: true, spreadNetworks: true, nowMs: T0 })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, 1, ?)', 'Serum', 12.5, 50000, 50).lastInsertRowid)
    h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, ?)', id, 50)
  })
  const ask = (p, method = 'GET', body) => h.staff(p, method, body, { as: ADMIN })
  const placePaid = async (phone) => {
    const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone, fulfilment: 'pickup' })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const id = h.one('SELECT MAX(id) id FROM online_orders').id
    h.script.check = () => h.approved(25)
    await h.callback(h.one('SELECT tran_id FROM online_order_payments WHERE order_id = ? ORDER BY id DESC', id).tran_id)
    return id
  }
  const scrub = (body) => JSON.parse(JSON.stringify(body, (key, value) => (['tran_id', 'token_hash', 'order_no', 'created_at', 'updated_at', 'paid_at', 'expires_at', 'qr_expires_at', 'reference'].includes(key) ? '<volatile>' : value)))

  const paidId = await placePaid('012000001')
  const paid = await ask(`/${paidId}`)
  assert.equal(paid.status, 200, JSON.stringify(paid.body))

  const cancelledId = await placePaid('012000002')
  const cancel = await ask(`/${cancelledId}/cancel`, 'POST', { reason: 'out of stock', revision: h.one('SELECT revision FROM online_orders WHERE id = ?', cancelledId).revision })
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body))
  const owing = await ask(`/${cancelledId}`)

  const notedId = await placePaid('012000003')
  assert.equal((await ask(`/${notedId}/cancel`, 'POST', { reason: 'x', revision: h.one('SELECT revision FROM online_orders WHERE id = ?', notedId).revision })).status, 200)
  const note = await ask(`/${notedId}/refund-note`, 'POST', { amount_usd: 10, reference: 'ABA-1' })
  assert.ok([200, 201].includes(note.status), JSON.stringify(note.body))
  const partlyRefunded = await ask(`/${notedId}`)

  const place = async (phone) => {
    const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone, fulfilment: 'pickup' })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return h.one('SELECT MAX(id) id FROM online_orders').id
  }
  const awaitingId = await place('012000004')
  const awaiting = await ask(`/${awaitingId}`)

  const reviewId = await place('012000005')
  h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 10, total_amount: 10, apv: 'APVREV' } })
  await h.callback(h.one('SELECT tran_id FROM online_order_payments WHERE order_id = ? ORDER BY id DESC', reviewId).tran_id)
  const inReview = await ask(`/${reviewId}`)
  assert.equal(inReview.body.order.state, 'review', 'a short payment holds the order in review')

  const heldId = await placePaid('012000006')
  h.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at) VALUES (?, 'WHELD0000000000001', 'order', 25, 'USD', 'review', 12, 'USD', '2026-11-09 03:01:00', 'QR', 1, '2026-11-09 03:00:00')", heldId)
  const heldWhilePaid = await ask(`/${heldId}`)

  const fulfilledId = await placePaid('012000007')
  h.run("INSERT INTO sales (id, receipt_number, total_usd, calculated_total_usd, amount_paid_usd, amount_paid_khr, sale_status, created_at, exchange_rate, money_precision_version) VALUES (50, 'R50', 25, 25, 25, 0, 'completed', '2026-11-09 05:00:00', 4000, 1)")
  h.run("UPDATE online_orders SET state = 'fulfilled', sale_id = 50 WHERE id = ?", fulfilledId)
  h.run("INSERT INTO online_order_events (order_id, payment_id, event, source, amount_usd, sale_id) SELECT ?, id, 'payment_recorded_on_sale', 'staff', 25, 50 FROM online_order_payments WHERE order_id = ?", fulfilledId, fulfilledId)
  h.run("INSERT INTO returns (return_number, sale_id, return_scope, status, total_refund_usd, total_refund_khr, refund_channel, created_at) VALUES ('RX1', 50, 'customer', 'completed', 5, 0, 'aba', '2026-11-09 05:30:00')")
  const fulfilled = await ask(`/${fulfilledId}`)

  for (const [name, res] of [['paid', paid], ['cancelled_owing', owing], ['partly_refunded', partlyRefunded], ['awaiting_payment', awaiting], ['in_review', inReview], ['held_while_paid', heldWhilePaid], ['fulfilled', fulfilled]]) {
    assert.deepEqual(MONEY_KEYS.filter((k) => !(k in res.body.money)), [], `${name}: staff detail money carries the customer-view names`)
  }
  assert.equal(paid.body.money.paid_usd, 25); assert.equal(paid.body.money.refund_due_usd, 0)
  assert.equal(owing.body.money.paid_usd, 25); assert.equal(owing.body.money.refund_due_usd, 25); assert.equal(owing.body.money.refunded_usd, 0)
  assert.equal(partlyRefunded.body.money.refunded_usd, 10, 'refunded_usd is the sum of refund notes'); assert.equal(partlyRefunded.body.money.refund_due_usd, 15)
  assert.equal(awaiting.body.money.paid_usd, 0); assert.equal(awaiting.body.money.refund_due_usd, 0)
  assert.equal(inReview.body.money.held_in_review_usd, 10); assert.equal(inReview.body.money.paid_usd, 0); assert.equal(inReview.body.money.refund_due_usd, 0)
  assert.equal(heldWhilePaid.body.money.held_in_review_usd, 12); assert.equal(heldWhilePaid.body.money.refund_due_usd, 12); assert.equal(heldWhilePaid.body.order.state, 'paid')
  assert.equal(fulfilled.body.money.refunded_usd, 5, 'refunded_usd counts the ABA returns of the sale, not only notes'); assert.equal(fulfilled.body.order.state, 'fulfilled')
  // the camelCase read stays for the Worker's own tests, and agrees
  assert.equal(owing.body.money.refundDueUsd, owing.body.money.refund_due_usd)

  const recorded = {
    paid: scrub(paid.body), cancelled_owing: scrub(owing.body), partly_refunded: scrub(partlyRefunded.body), awaiting_payment: scrub(awaiting.body), in_review: scrub(inReview.body),
    held_while_paid: scrub(heldWhilePaid.body), fulfilled: scrub(fulfilled.body),
  }
  if (process.env.UPDATE_CONTRACT === '1') { fs.writeFileSync(FIXTURE, JSON.stringify(recorded, null, 2) + '\n'); console.log('fixture rewritten') }
  const onDisk = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  assert.deepEqual(recorded, onDisk, 'the Worker response equals the recorded contract fixture (UPDATE_CONTRACT=1 rewrites it; copy it to the UI lane)')
  console.log('PASS staff detail money contract (7 scenarios)')
}
main().catch((error) => { console.error(error); process.exit(1) })
