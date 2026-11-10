// KHQR security review (10 Nov 2026), open item: every PUBLIC order write route stays under the D1 ceiling of one invocation. The public routes are exempt in budgets.json
// (`payway-write`, no cookie, no ledger), so nothing else measures them. Each route is run once on the Free plan through the REAL route and store code over the in-memory migration
// chain; the harness counts D1 calls the way D1 does (each prepared get/all/run is one, a whole batch is ONE). The ceiling is the plan's per-invocation limit less a fixed
// headroom for what the platform itself spends on a request (owner rule: at most 45 of 50), read from lib/planTier.ts, never typed here.
//
// Run: node scripts/test-online-order-d1-ceiling-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createOrdersHarness } = require('./harness/load_portal_orders_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const ROUTE_HEADROOM = 5
const T0 = Date.UTC(2026, 10, 9, 3, 0, 0)
let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { console.log(`FAIL ${name}`); throw error }
}

function world() {
  const h = createOrdersHarness({ switchOn: true, nowMs: T0, env: { PLAN_TIER: 'free' } })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, 1, 50)', 'Serum', 12.5, 50000).lastInsertRowid)
    h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 50)', id)
  })
  return h
}
const PHONE = '012 345 678'
let seq = 0
const body = (over = {}) => ({ lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone: `0${12000000 + (seq += 1)}`, fulfilment: 'pickup', ...over })

async function main() {
  const ceilingOf = (h) => h.load('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'free' }).d1QueriesPerInvocation - ROUTE_HEADROOM
  const measure = async (h, label, run) => {
    h.clearStatements()
    const result = await run()
    const calls = h.d1.calls
    console.log(`  ${label}: ${calls} D1 call(s), ${h.statements.length} statement(s)`)
    assert.ok(calls > 0, `${label}: the instrument counted nothing`)
    assert.ok(calls <= ceilingOf(h), `${label}: ${calls} D1 calls is over the ceiling of ${ceilingOf(h)}`)
    return { result, calls }
  }
  const approve = (h, amount) => { h.script.check = () => h.approved(amount) }

  await check('every public order write route stays under the per-invocation D1 ceiling (Free plan)', async () => {
    const h = world()
    const created = (await measure(h, 'POST / (create)', () => h.request('/', 'POST', body({ phone: PHONE }), { ip: '10.7.0.1' }))).result
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const token = created.body.token
    const edited = (await measure(h, 'POST /:token/edit (new items)', () => h.request(`/${token}/edit`, 'POST', { lines: [{ product_id: 1, quantity: 3 }] }))).result
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    const second = await h.request('/', 'POST', body(), { ip: '10.7.0.2' }); assert.equal(second.status, 201)
    const cancelled = (await measure(h, 'POST /:token/cancel', () => h.request(`/${second.body.token}/cancel`, 'POST', {}))).result
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
    const third = await h.request('/', 'POST', body(), { ip: '10.7.0.3' }); assert.equal(third.status, 201)
    h.run("UPDATE online_orders SET state = 'expired' WHERE id = ?", 3); h.run("UPDATE online_order_payments SET state = 'expired' WHERE order_id = ?", 3)
    const retried = (await measure(h, 'POST /:token/retry', () => h.request(`/${third.body.token}/retry`, 'POST', {}))).result
    assert.equal(retried.status, 200, JSON.stringify(retried.body))
    // the callback pays order 1 (the edited cart: three lines)
    const tran = h.one("SELECT tran_id FROM online_order_payments WHERE order_id = 1 AND state = 'awaiting' ORDER BY id DESC").tran_id
    approve(h, 37.5)
    const called = (await measure(h, 'POST /callback (approved)', () => h.callback(tran))).result
    assert.ok(called.status < 300, JSON.stringify(called.body))
    assert.equal(h.one('SELECT state FROM online_orders WHERE id = 1').state, 'paid', 'the callback paid it')
    // a poll that nudges PayWay and finds the money
    const fourth = await h.request('/', 'POST', body(), { ip: '10.7.0.4' }); assert.equal(fourth.status, 201)
    approve(h, fourth.body.order.total_usd); h.advance(90_000)
    await measure(h, 'GET /:token/status (nudge pays)', () => h.request(`/${fourth.body.token}/status`, 'GET'))
    // a request after payment, its withdrawal, and a top-up QR
    const asked = (await measure(h, 'POST /:token/requests', () => h.request(`/${token}/requests`, 'POST', { kind: 'note', phone: PHONE, comment: 'please', after: { note: 'ring twice' } }))).result
    assert.equal(asked.status, 201, JSON.stringify(asked.body))
    const rid = h.one('SELECT MAX(id) id FROM online_order_requests').id
    const withdrawn = (await measure(h, 'POST /:token/requests/:id/withdraw', () => h.request(`/${token}/requests/${rid}/withdraw`, 'POST', { phone: PHONE }))).result
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body))
    h.run("INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json) VALUES (1, 'items', 'paid', '{}', '{}')")
    const itemsRid = h.one('SELECT MAX(id) id FROM online_order_requests').id
    h.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, request_id, amount, currency, state) VALUES (1, 'WTOPUPCEIL01', 'top_up', ?, 12.5, 'USD', 'expired')", itemsRid)
    const topped = (await measure(h, 'POST /:token/topup', () => h.request(`/${token}/topup`, 'POST', { request_id: itemsRid }))).result
    assert.equal(topped.status, 200, JSON.stringify(topped.body))
  })

  await check('the instrument is a real bound: the ceiling comes from the plan, raw SQLite is not counted, a Worker route is', async () => {
    const h = world()
    assert.ok(ceilingOf(h) > 0 && ceilingOf(h) < h.load('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'paid' }).d1QueriesPerInvocation)
    h.clearStatements()
    for (let i = 0; i < ceilingOf(h) + 1; i += 1) h.raw.db.prepare('SELECT 1').get()
    assert.equal(h.d1.calls, 0, 'control: statements run outside the Worker are not counted')
    await h.request('/', 'POST', body(), { ip: '10.7.1.1' })
    assert.ok(h.d1.calls > 0, 'control: a Worker route is counted')
  })
  console.log(`online order d1 ceiling: ${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
