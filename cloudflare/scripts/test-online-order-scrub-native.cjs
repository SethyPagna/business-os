// KHQR S5: the 90 day scrub of UNPAID online orders (lib/onlineOrderScrub.ts) on the real migration chain. Each scenario names the wrong implementation it must turn red on.
//
// Run: node scripts/test-online-order-scrub-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createOrdersHarness } = require('./harness/load_portal_orders_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { console.log(`FAIL ${name}`); throw error }
}
const T0 = Date.UTC(2026, 10, 9, 3, 0, 0)
const DAY = 86_400_000
const at = (daysAgo) => new Date(T0 - daysAgo * DAY).toISOString().replace('T', ' ').replace('Z', '')

function world() {
  const h = createOrdersHarness({ switchOn: true, spreadNetworks: true, nowMs: T0 })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, 1, 50)', 'Serum', 12.5, 50000).lastInsertRowid)
    h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 50)', id)
  })
  return h
}
let seq = 0
const place = async (h, over = {}) => {
  const res = await h.request('/', 'POST', {
    lines: [{ product_id: 1, quantity: 2 }], name: 'Dara Private', phone: `0${12000000 + (seq += 1)}`, fulfilment: 'delivery', address: 'House 77 Hidden Street',
    note: 'leave-with-the-guard', contacts: { telegram: '@hidden_handle', instagram: 'hidden.insta' }, ...over,
  })
  assert.equal(res.status, 201, JSON.stringify(res.body)); return h.one('SELECT MAX(id) id FROM online_orders').id
}
const endAs = (h, id, state, daysAgo) => {
  h.run("UPDATE online_order_payments SET state = ? WHERE order_id = ?", state === 'cancelled' ? 'cancelled' : 'expired', id)
  h.run('UPDATE online_orders SET state = ?, updated_at = ? WHERE id = ?', state, at(daysAgo), id)
}
const row = (h, id) => h.one('SELECT * FROM online_orders WHERE id = ?', id)
const scrub = (h, limits) => { h.planTier.__resetPlanTierCacheForTests?.(); return h.load('lib/onlineOrderScrub.ts').scrubUnpaidOrders({ db: h.deps().db, env: { ...h.env, ...(limits || {}) }, now: () => new Date(h.state.nowMs) }) }

async function main() {
  await check('an unpaid order that ended 90+ days ago loses its contact details, keeps its items and totals, and gets ONE scrubbed Records row (a wrong build leaves the phone, or wipes the order)', async () => {
    const h = world(); const id = await place(h)
    h.run("INSERT INTO online_order_events (order_id, event, source, public_comment, internal_note, created_at) VALUES (?, 'note', 'staff', 'call Dara on 012 000 111', 'she lives at House 77', ?)", id, at(95))
    endAs(h, id, 'expired', 91)
    const before = row(h, id)
    const out = await scrub(h)
    assert.equal(out.scrubbed, 1)
    const after = row(h, id)
    assert.equal(after.customer_name, '[scrubbed]'); assert.equal(after.customer_phone, '[scrubbed]'); assert.equal(after.customer_address, '[scrubbed]', 'a delivery order must keep a non-empty address (table rule)')
    for (const column of ['contact_telegram', 'contact_instagram', 'contact_facebook', 'contact_tiktok', 'contact_whatsapp', 'contact_other', 'note', 'network_key']) assert.equal(after[column], null, column)
    assert.ok(after.scrubbed_at); assert.equal(after.revision, before.revision + 1)
    for (const column of ['order_no', 'state', 'goods_total_usd', 'items_json', 'fulfilment', 'currency']) assert.equal(after[column], before[column], `${column} is kept`)
    const events = h.all('SELECT * FROM online_order_events WHERE order_id = ?', id)
    assert.equal(events.filter((e) => e.event === 'scrubbed').length, 1)
    assert.ok(events.every((e) => e.public_comment === null && e.internal_note === null), 'staff free text about the customer is cleared too')
    const everything = JSON.stringify([after, events])
    for (const leak of ['Dara Private', 'Hidden Street', 'hidden_handle', 'hidden.insta', 'leave-with-the-guard', '012 000 111', 'House 77']) assert.ok(!everything.includes(leak), `leaked ${leak}`)
  })

  await check('a pickup order gets a null address; one younger than the plan days is untouched (a wrong build scrubs by creation date or at 30 days)', async () => {
    const h = world()
    const pickup = await place(h, { fulfilment: 'pickup', address: undefined })
    const young = await place(h)
    endAs(h, pickup, 'cancelled', 120); endAs(h, young, 'expired', 89)
    const out = await scrub(h)
    assert.equal(out.scrubbed, 1)
    assert.equal(row(h, pickup).customer_address, null)
    assert.equal(row(h, young).scrubbed_at, null); assert.equal(row(h, young).customer_name, 'Dara Private')
    h.state.nowMs = T0 + 2 * DAY
    assert.equal((await scrub(h)).scrubbed, 1, 'at 91 days it is due')
  })

  await check('an order that ever took money is NEVER scrubbed: paid, in review, expired with a held payment, or linked to a sale (a wrong build scrubs by state alone)', async () => {
    const h = world()
    const paid = await place(h); h.script.check = () => h.approved(25); await h.callback(h.one('SELECT tran_id FROM online_order_payments WHERE order_id = ? ORDER BY id DESC', paid).tran_id)
    h.run('UPDATE online_orders SET updated_at = ? WHERE id = ?', at(400), paid)
    const held = await place(h)
    endAs(h, held, 'expired', 200)
    h.run("UPDATE online_order_payments SET paid_amount = 20 WHERE order_id = ?", held) // money held on a payment whose order later ended expired
    const lateReview = await place(h)
    endAs(h, lateReview, 'cancelled', 200)
    h.run("UPDATE online_order_payments SET state = 'review' WHERE order_id = ?", lateReview)
    const plain = await place(h); endAs(h, plain, 'expired', 200)
    const out = await scrub(h)
    assert.equal(out.scrubbed, 1, 'only the plain unpaid one')
    for (const id of [paid, held, lateReview]) { assert.equal(row(h, id).scrubbed_at, null, `order ${id}`); assert.equal(row(h, id).customer_name, 'Dara Private') }
    assert.ok(row(h, plain).scrubbed_at)
  })

  await check('running again changes nothing: still one scrubbed row, and an order paid after the list was read is left alone by the batch guard', async () => {
    const h = world(); const id = await place(h); endAs(h, id, 'expired', 100)
    await scrub(h)
    const once = h.all('SELECT id FROM online_order_events WHERE event = ?', 'scrubbed').length
    const again = await scrub(h)
    assert.equal(again.rounds, 0, 'nothing left to list'); assert.equal(h.all('SELECT id FROM online_order_events WHERE event = ?', 'scrubbed').length, once)
    // the race: a late payment lands between the candidate list and the batch
    const r = world(); const raced = await place(r); endAs(r, raced, 'expired', 100)
    const db = r.deps().db
    const racing = { ...db, prepare: (sql) => { const s = db.prepare(sql); if (!/INDEXED BY idx_online_orders_scrub/.test(sql)) return s; return { ...s, all: async (...a) => { const rows = await s.all(...a); r.run("UPDATE online_order_payments SET state = 'review', paid_amount = 25 WHERE order_id = ?", raced); return rows } } } }
    const scrubber = r.load('lib/onlineOrderScrub.ts')
    const result = await scrubber.scrubUnpaidOrders({ db: racing, env: r.env, now: () => new Date(r.state.nowMs) })
    assert.equal(result.scrubbed, 0); assert.equal(row(r, raced).scrubbed_at, null); assert.equal(row(r, raced).customer_name, 'Dara Private')
    assert.equal(r.all("SELECT id FROM online_order_events WHERE event = 'scrubbed'").length, 0, 'no scrubbed Records row for an order that was not scrubbed')
  })

  await check('a backlog drains in bounded rounds: 30 orders, 25 per round, each round one candidate read and one batch', async () => {
    const h = world()
    const first = await place(h); endAs(h, first, 'expired', 100)
    const cols = h.all('PRAGMA table_info(online_orders)').map((c) => c.name).filter((n) => !['id', 'order_no', 'token_hash', 'client_request_id', 'updated_at'].includes(n))
    for (let i = 1; i < 30; i += 1) h.run(`INSERT INTO online_orders (order_no, token_hash, updated_at, ${cols.join(',')}) SELECT ?, ?, ?, ${cols.join(',')} FROM online_orders WHERE id = ?`, `LB-BULK-${i}`, `hash-${i}`, at(100 + i), first)
    h.clearStatements()
    const out = await scrub(h)
    assert.equal(out.scrubbed, 30); assert.equal(out.rounds, 2)
    assert.ok(h.d1.calls <= 12, 'D1 calls ' + h.d1.calls)
  })

  await check('G4: an old link to a SCRUBBED order reads closed and can neither get a new QR, nor be edited or cancelled (409 order_closed; a build that only checks the state hands a scrubbed order a live QR and no customer)', async () => {
    const h = world(); const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara Private', phone: '012777888', fulfilment: 'pickup' })
    assert.equal(res.status, 201, JSON.stringify(res.body)); const token = res.body.token
    h.advance(20 * 60_000); h.script.check = () => h.pending(); await h.sweep()
    assert.equal(row(h, 1).state, 'expired')
    const open = await h.request(`/${token}`, 'GET')
    assert.equal(open.body.order.status, 'expired', 'before the scrub the page still offers a new QR')
    h.run('UPDATE online_orders SET updated_at = ? WHERE id = 1', at(100))
    assert.equal((await scrub(h)).scrubbed, 1)
    const seen = await h.request(`/${token}`, 'GET')
    assert.equal(seen.status, 200); assert.equal(seen.body.order.status, 'closed'); assert.equal(seen.body.order.closed, true); assert.equal(seen.body.order.name, '[scrubbed]')
    const calls = h.calls.length
    for (const [pathname, payload] of [[`/${token}/retry`, {}], [`/${token}/edit`, { name: 'New Name' }], [`/${token}/cancel`, {}]]) {
      const refused = await h.request(pathname, 'POST', payload)
      assert.equal(refused.status, 409, pathname); assert.equal(refused.body.code, 'order_closed', pathname)
    }
    assert.equal(h.calls.length, calls, 'PayWay was never asked for a QR')
    assert.equal(h.one("SELECT COUNT(*) n FROM online_order_payments WHERE order_id = 1 AND state = 'awaiting'").n, 0, 'no live payment exists')
    assert.equal(row(h, 1).customer_name, '[scrubbed]')
  })

  await check('the scrub runs as a rotation step, and the days are a plan limit', async () => {
    const root = path.join(__dirname, '..')
    const index = fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8')
    assert.match(index, /step\('online-order-scrub', \(\) => scrubUnpaidOrders\(/)
    assert.match(fs.readFileSync(path.join(root, 'src', 'lib', 'cronStepIds.ts'), 'utf8'), /'online-order-scrub'/)
    const h = world(); assert.equal(h.planTier.getPlanLimits({ ...h.env, PLAN_TIER: 'free' }).onlineOrderScrubAfterDays, 90); assert.equal(h.planTier.getPlanLimits({ ...h.env, PLAN_TIER: 'paid' }).onlineOrderScrubAfterDays, 90)
  })

  console.log(`online order scrub: ${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
