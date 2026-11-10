'use strict'
// KHQR round 7, N1 (second half): a method that ORDINARY sales already use cannot become the online (KHQR) method, because a stored method is reserved at once (the till hides
// it and refuses it on a plain sale). The check is bounded: the latest `onlineMethodSalesWindow` sales through idx_sales_created_pg, as one more statement of the settings batch.
//   * red without the fix: an ordinary sale with method X, then storing X as the online method answers 409 online_method_in_use_by_sales and stores nothing
//   * controls: a method used only by online-fulfilled sales is accepted; a method used only beyond the window is accepted (documents the bound); an unchanged resend does not
//     run the check; a split payment row, a legacy payment_method-only sale and a different case / padding of the name count; a method nobody used is accepted
//   * cost: the guard reads at most 2 x window + a small constant rows (native rows_read: N index entries + N row lookups), uses idx_sales_created_pg, and the settings write stays well under 45 D1 calls.
// Run (from cloudflare/): node scripts/test-online-method-in-use-native.cjs
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
const { loadTsLib } = require('./harness/load_ts_lib.cjs')
const { ONLINE_METHOD_IN_USE_GUARD_SQL: GUARD } = loadTsLib('onlineOrderFulfil', { readSwitches: {} })

const WINDOW = 5000
const SLACK = 25
let passed = 0
const pass = (name) => { passed += 1; console.log(`PASS ${name}`) }
const asPositional = (sql) => sql.replace(/@windowRows/g, '?1').replace(/@methodKey/g, '?2')

async function main() {
  const h = await H.startWorker({})
  try {
    const set = (value, label) => h.call('POST', '/api/settings', { online_order_payment_method: value }, label || `set online ${value}`)
    const stored = async () => (await h.one("SELECT value FROM settings WHERE key = 'online_order_payment_method'"))?.value ?? null
    const clear = () => h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run()
    const sale = (n, method, details, at) => h.db.prepare('INSERT INTO sales (receipt_number, total_usd, payment_method, payment_details, created_at) VALUES (?, 5, ?, ?, ?)').bind(`R-${n}`, method, details, at).run()
    const rowOf = (method) => JSON.stringify([{ method, amount_usd: 5, amount_khr: 0 }])
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_methods', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(JSON.stringify(['Cash', 'ABA', 'ABA KHQR', 'Wing', 'Telcard', 'Pay2', 'Pay3'])).run()

    await sale(1, 'ABA', rowOf('ABA'), '2026-11-01 10:00:00')
    const refused = await set('ABA')
    assert.deepEqual([refused.status, refused.body.code], [409, 'online_method_in_use_by_sales'], JSON.stringify(refused.body))
    assert.equal(await stored(), null, 'nothing stored on refusal')
    pass('an ordinary sale used ABA: storing ABA as the online method is 409 online_method_in_use_by_sales and stores nothing')

    assert.equal((await set('  aba ')).status, 409, 'trim + case fold: "  aba " matches ABA')
    pass('the same fold as methodFold: a trimmed, lower-cased name matches')

    await sale(2, 'Cash + Wing', JSON.stringify([{ method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'Wing', amount_usd: 3, amount_khr: 0 }]), '2026-11-01 11:00:00')
    assert.equal((await set('Wing')).status, 409, 'a split-payment row of an ordinary sale counts')
    pass('a payment_details (split) row counts')

    await sale(3, 'Telcard', null, '2026-11-01 12:00:00')
    assert.equal((await set('Telcard')).status, 409)
    pass('a legacy sale with only payment_method counts')

    await sale(4, 'ABA KHQR', rowOf('ABA KHQR'), '2026-11-01 13:00:00')
    const onlineSaleId = (await h.one("SELECT id FROM sales WHERE receipt_number = 'R-4'")).id
    await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, sale_id, created_at, updated_at)
      VALUES ('ON-1','th-1','fulfilled','pickup',1,'A','012','USD',5,'[]',1,1,CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(onlineSaleId).run()
    const okOnline = await set('ABA KHQR')
    assert.deepEqual([okOnline.status, await stored()], [200, 'ABA KHQR'], JSON.stringify(okOnline.body))
    pass('control: a method used only by online-fulfilled sales is accepted')

    // An ordinary sale with the stored method (the till cannot make one, so it is forced in): an unchanged resend writes nothing and must not run the check.
    await sale(5, 'ABA KHQR', rowOf('ABA KHQR'), '2026-11-02 10:00:00')
    const resend = await set('ABA KHQR')
    assert.equal(resend.status, 200, JSON.stringify(resend.body))
    assert.equal(resend.body.keys.length, 0, 'unchanged: nothing written, so no guard')
    pass('control: an unchanged resend of the stored method is accepted (the check does not run)')
    await clear()
    assert.equal((await set('ABA KHQR')).status, 409, 'set anew with an ordinary sale behind it: refused')
    pass('the same method set anew is judged again')

    assert.deepEqual([(await set('Pay2')).status, await stored()], [200, 'Pay2'])
    pass('control: a method no sale used is accepted')
    await clear()

    // The bound: Pay3 is used only by the oldest sale, then WINDOW newer sales that do not use it.
    await sale(6, 'Pay3', rowOf('Pay3'), '2020-01-01 00:00:00')
    await h.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
      INSERT INTO sales (receipt_number, total_usd, payment_method, payment_details, created_at)
      SELECT 'F-' || i, 5, 'Cash', '[{"method":"Cash","amount_usd":5,"amount_khr":0}]', datetime('2026-11-05 00:00:00', '+' || i || ' seconds') FROM n`).bind(WINDOW).run()
    const beyond = await set('Pay3')
    assert.deepEqual([beyond.status, await stored()], [200, 'Pay3'], JSON.stringify(beyond.body))
    pass(`control: a method used only beyond the latest ${WINDOW} sales is accepted (the documented bound)`)
    await clear()

    // Cost: rows read by the guard on a miss (the worst case: nothing short-circuits), its plan, and the calls of the settings write.
    const total = (await h.one('SELECT COUNT(*) c FROM sales')).c
    const miss = await h.db.prepare(asPositional(GUARD)).bind(WINDOW, 'nobody-used-this').all()
    const rows = miss.meta.rows_read
    console.log(`guard rows_read on a miss: ${rows} (window ${WINDOW}, ${total} sales in the table)`)
    assert.ok(total > WINDOW, 'the table is larger than the window')
    // idx_sales_created_pg holds only (created_at, id), so each of the N index entries also costs one table-row lookup for payment_method / payment_details: 2N, not N.
    assert.ok(rows <= 2 * WINDOW + SLACK, `rows read ${rows} <= 2 x window ${WINDOW} + ${SLACK}`)
    const plan = (await h.db.prepare(`EXPLAIN QUERY PLAN ${asPositional(GUARD)}`).bind(WINDOW, 'x').all()).results.map((r) => r.detail).join(' | ')
    console.log(`plan: ${plan}`)
    assert.match(plan, /idx_sales_created_pg/, 'the window is read through idx_sales_created_pg')
    assert.doesNotMatch(plan, /SCAN sales(?! USING INDEX idx_sales_created_pg)/, 'no table scan of sales')
    pass(`cost: the guard read ${rows} rows (<= 2 x ${WINDOW} + ${SLACK}: N index entries + N row lookups) through idx_sales_created_pg`)

    const guarded = await set('Pay2', 'set online method (guard)')
    assert.equal(guarded.status, 200, JSON.stringify(guarded.body))
    const other = await h.call('POST', '/api/settings', { receipt_footer_probe: 'x' }, 'set other key')
    const g = h.metrics.find((m) => m.label === 'set online method (guard)')
    const o = h.metrics.find((m) => m.label === 'set other key')
    console.log(`D1 calls: online method set ${g.calls} (${g.statements} statements), ordinary key set ${o.calls} (${o.statements} statements); status ${other.status}`)
    assert.ok(g.calls < 45, `calls ${g.calls} well under 45`)
    pass(`cost: the settings write makes ${g.calls} D1 calls (< 45)`)
  } finally { await h.mf.dispose() }
  console.log(`online method in use: ${passed} passed`)
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
