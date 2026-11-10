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

  for (const [name, res] of [['paid', paid], ['cancelled_owing', owing], ['partly_refunded', partlyRefunded]]) {
    assert.deepEqual(MONEY_KEYS.filter((k) => !(k in res.body.money)), [], `${name}: staff detail money carries the customer-view names`)
  }
  assert.equal(paid.body.money.paid_usd, 25); assert.equal(paid.body.money.refund_due_usd, 0)
  assert.equal(owing.body.money.paid_usd, 25); assert.equal(owing.body.money.refund_due_usd, 25); assert.equal(owing.body.money.refunded_usd, 0)
  assert.equal(partlyRefunded.body.money.refunded_usd, 10, 'refunded_usd is the sum of refund notes'); assert.equal(partlyRefunded.body.money.refund_due_usd, 15)
  // the camelCase read stays for the Worker's own tests, and agrees
  assert.equal(owing.body.money.refundDueUsd, owing.body.money.refund_due_usd)

  const recorded = { paid: scrub(paid.body), cancelled_owing: scrub(owing.body), partly_refunded: scrub(partlyRefunded.body) }
  if (process.env.UPDATE_CONTRACT === '1') { fs.writeFileSync(FIXTURE, JSON.stringify(recorded, null, 2) + '\n'); console.log('fixture rewritten') }
  const onDisk = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  assert.deepEqual(recorded, onDisk, 'the Worker response equals the recorded contract fixture (UPDATE_CONTRACT=1 rewrites it; copy it to the UI lane)')
  console.log('PASS staff detail money contract (3 scenarios)')
}
main().catch((error) => { console.error(error); process.exit(1) })
