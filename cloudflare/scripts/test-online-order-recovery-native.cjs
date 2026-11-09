// KHQR S5: the recovery re-check after a maintenance hold (lib/onlineOrderSweep.ts RECHECK_DUE_FLAG). While a hold is on the cron skips and callbacks cannot land; the
// first sweep after it clears asks PayWay once about EVERY payment that could still be paid, ignoring the per-payment interval, bounded by the tick budget and
// continuing on the next ticks. Each scenario names the wrong implementation it must turn red on.
//
// Run: node scripts/test-online-order-recovery-native.cjs
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
const MIN = 60_000
const HOUR = 60 * MIN

function world(options = {}) {
  const h = createOrdersHarness({ switchOn: true, nowMs: T0, ...options })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, 1, 500)', 'Serum', 12.5, 50000).lastInsertRowid)
    h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 500)', id)
  })
  return h
}
let phoneSeq = 0
const place = async (h) => {
  const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone: `0${12000000 + (phoneSeq += 1)}`, fulfilment: 'pickup' })
  assert.equal(res.status, 201, JSON.stringify(res.body)); return h.one('SELECT MAX(id) id FROM online_orders').id
}
const pay = (h, orderId) => h.one('SELECT * FROM online_order_payments WHERE order_id = ? ORDER BY id DESC', orderId)
const order = (h, id) => h.one('SELECT * FROM online_orders WHERE id = ?', id)
const flag = (h) => h.one("SELECT value FROM system_flags WHERE key = 'online_orders_late_recheck_due'")?.value ?? null
const asked = (h, tran) => h.calls.filter((c) => c.op === 'check' && c.body.tran_id === tran).length
const hold = (h) => h.sweepModule.markLateRecheckDue(h.deps().db, new Date(h.state.nowMs))
/** An order whose QR ran out, expired by the sweep (which stamps its last check), then asked about again inside the interval. */
async function expiredOrder(h) {
  const id = await place(h)
  h.advance(20 * MIN); h.script.check = () => h.pending(); await h.sweep()
  assert.equal(pay(h, id).state, 'expired')
  return id
}

async function main() {
  await check('after a hold, an expired payment asked about a minute ago is asked AGAIN and its money lands; without the hold marker it is not (a build with no recovery leaves the money unseen)', async () => {
    const h = world()
    const id = await expiredOrder(h); const tran = pay(h, id).tran_id
    h.advance(MIN)
    h.script.check = () => h.approved(25); h.calls.length = 0
    await h.sweep()
    assert.equal(asked(h, tran), 0, 'inside the interval and no hold: not asked')
    await hold(h); h.advance(2 * MIN); h.calls.length = 0
    const out = await h.sweep()
    assert.equal(asked(h, tran), 1, 'the hold made the last answer stale: asked once')
    assert.equal(out.recovery, true); assert.equal(out.recoveryDone, true)
    assert.equal(order(h, id).state, 'paid'); assert.equal(pay(h, id).paid_amount, 25)
    assert.equal(flag(h), null, 'the marker is gone once nothing is left')
    h.calls.length = 0; await h.sweep()
    assert.equal(h.calls.length, 0, 'no marker, nothing to ask: an idle sweep makes no PayWay call')
  })

  await check('the pass covers awaiting (QR still live), expired and cancelled-with-QR payments, and not those outside the plan window or without a QR', async () => {
    const h = world()
    const live = await place(h)                       // awaiting, QR live
    const cancelled = await place(h)
    h.run("UPDATE online_order_payments SET state = 'cancelled' WHERE order_id = ?", cancelled)
    const expired = await place(h); h.run("UPDATE online_order_payments SET state = 'expired' WHERE order_id = ?", expired)
    const noQr = await place(h); h.run("UPDATE online_order_payments SET state = 'expired', qr_string = NULL WHERE order_id = ?", noQr)
    const old = await place(h)
    const windowHours = h.planTier.getPlanLimits(h.env).onlineOrderLateCheckHours
    const longAgo = new Date(T0 - (windowHours + 2) * HOUR).toISOString().replace('T', ' ').replace('Z', '')
    h.run("UPDATE online_order_payments SET state = 'expired', expires_at = ? WHERE order_id = ?", longAgo, old)
    for (const id of [live, cancelled, expired, noQr, old]) h.run('UPDATE online_order_payments SET last_checked_at = ? WHERE order_id = ?', new Date(T0 - 30_000).toISOString().replace('T', ' ').replace('Z', ''), id)
    h.advance(MIN); await hold(h); h.advance(MIN)
    h.script.check = () => h.pending(); h.calls.length = 0
    await h.sweep()
    for (const [name, id] of [['live', live], ['cancelled', cancelled], ['expired', expired]]) assert.equal(asked(h, pay(h, id).tran_id), 1, name)
    assert.equal(asked(h, pay(h, noQr).tran_id), 0, 'no QR was ever issued: nothing exists at ABA')
    assert.equal(asked(h, pay(h, old).tran_id), 0, 'outside the late window')
  })

  await check('bounded and continuing: more candidates than one tick may ask are asked on the next ticks, none twice, and the marker stays until the last is done', async () => {
    const h = world({ env: { PLAN_TIER: 'free' } })
    const batch = h.planTier.getPlanLimits({ ...h.env, PLAN_TIER: 'free' }).onlineOrderSweepMaxPerTick
    const ids = []
    for (let i = 0; i < batch + 5; i += 1) ids.push(await place(h))
    h.run("UPDATE online_order_payments SET state = 'expired', last_checked_at = ?", new Date(T0).toISOString().replace('T', ' ').replace('Z', ''))
    h.advance(MIN); await hold(h); h.advance(MIN)
    h.script.check = () => h.pending(); h.calls.length = 0
    const first = await h.sweep()
    assert.equal(first.recovery, true); assert.equal(first.recoveryDone, undefined, 'the first tick cannot finish it')
    assert.ok(flag(h), 'the marker stays')
    assert.ok(checksOf(h) <= batch, 'one tick asks at most its batch: ' + checksOf(h))
    let ticks = 1; let last = first
    while (!last.recoveryDone && ticks < 30) { h.advance(MIN); last = await h.sweep(); ticks += 1 }
    assert.equal(last.recoveryDone, true, 'finished within ' + ticks + ' ticks'); assert.ok(ticks >= 2, 'it took more than one tick'); assert.equal(flag(h), null)
    for (const id of ids) assert.equal(asked(h, pay(h, id).tran_id), 1, 'each payment is asked exactly once across the ticks')
  })

  await check('a PayWay failure releases the claim and keeps the marker: the payment is retried next tick, not skipped (a build that keeps the claim loses the money)', async () => {
    const h = world()
    const id = await expiredOrder(h); const tran = pay(h, id).tran_id
    const before = pay(h, id).last_checked_at
    await hold(h); h.advance(2 * MIN)
    h.script.check = () => ({ httpStatus: 500, json: null }); h.calls.length = 0
    const out = await h.sweep()
    assert.equal(out.recoveryDone, undefined); assert.ok(flag(h), 'the marker stays')
    assert.equal(pay(h, id).last_checked_at, before, 'the claim was undone')
    h.script.check = () => h.approved(25); h.advance(MIN)
    const again = await h.sweep()
    assert.equal(again.recoveryDone, true); assert.equal(order(h, id).state, 'paid'); assert.ok(asked(h, tran) >= 2)
  })

  await check('a newer hold during the pass keeps the marker (the delete is guarded by the value that was read); a first hold writes it and later holds only move it forward', async () => {
    const h = world()
    const id = await expiredOrder(h)
    await hold(h); const first = flag(h)
    h.advance(MIN); await hold(h)
    assert.notEqual(flag(h), first, 'a later hold moves the marker')
    assert.equal(h.all("SELECT key FROM system_flags WHERE key = 'online_orders_late_recheck_due'").length, 1, 'one row, upserted')
    h.advance(MIN)
    h.script.check = () => { hold(h); return h.pending() } // another hold begins while the pass is asking
    h.state.nowMs += 1
    await h.sweep()
    assert.ok(flag(h), 'the new hold leaves its own marker')
    void id
  })

  await check('without PayWay credentials nothing is asked and the marker stays; a missing system_flags table never breaks the hold skip', async () => {
    const h = world()
    await expiredOrder(h); await hold(h); h.advance(MIN)
    const out = await h.sweep({ noCredentials: true })
    assert.equal(out.recovery, undefined); assert.ok(flag(h))
    const broken = { prepare: () => ({ run: async () => { throw new Error('no such table: system_flags') }, get: async () => { throw new Error('no such table') }, all: async () => [] }), batch: async () => [] }
    await h.sweepModule.markLateRecheckDue(broken, new Date(T0)) // must not throw
  })

  await check('the recovery list plans through the two partial indexes and the cron marks the hold in index.ts', async () => {
    const h = world(); await expiredOrder(h); await hold(h)
    h.clearStatements(); h.advance(MIN)
    h.script.check = () => h.pending(); await h.sweep()
    const list = h.statements.find((sql) => /UNION ALL/.test(sql) && /idx_online_order_payments_open/.test(sql))
    assert.ok(list, 'the recovery statement ran')
    const plan = h.all('EXPLAIN QUERY PLAN ' + list.replace(/@(\w+)/g, (_, n) => ({ windowStart: "'2026-11-01 00:00:00'", since: "'2026-11-10 00:00:00'", limit: '25' }[n] ?? '1'))).map((r) => r.detail).join(' | ')
    assert.match(plan, /idx_online_order_payments_expired/); assert.match(plan, /idx_online_order_payments_open/); assert.doesNotMatch(plan, /SCAN p(?! USING)/)
    const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8')
    assert.match(index, /if \(await getMaintenance\(env\)\) \{[\s\S]{0,400}markLateRecheckDue\(getDb\(env\), new Date\(\)\)[\s\S]{0,40}return/)
  })

  console.log(`online order recovery: ${passed} checks passed`)
}
function checksOf(h) { return h.calls.filter((c) => c.op === 'check').length }
main().catch((error) => { console.error(error); process.exit(1) })
