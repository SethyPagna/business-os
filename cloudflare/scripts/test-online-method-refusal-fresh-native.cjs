// KHQR round 5 defect 4: a manual exchange paid with the online (KHQR) method is refused by name (online_method_requires_order) even when the online_orders switch was flipped ON in D1
// inside this isolate's memo window: the batch's own predicate reads D1, so the error path reads the switch from D1 too, not the memo (which still says OFF and would answer write_conflict).
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-method-refusal-fresh
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

async function main() {
  const h = await H.startWorker({})
  try {
    await H.seedProduct(h, 9820, 'Fresh Old', 10, 500, 4)
    await H.seedProduct(h, 9821, 'Fresh New', 10, 500, 4)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_methods',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(['Cash', 'ABA KHQR'])).run()
    await h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run()
    await h.db.prepare("DELETE FROM system_flags WHERE key = 'read_switches'").run()
    const listed = await h.call('GET', '/api/runtime/read-switches', undefined, 'prime memo')
    assert.equal(listed.status, 200, JSON.stringify(listed.body))
    assert.equal(listed.body.switches.find((entry) => entry.name === 'online_orders').state, 'off')
    await h.db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({ epoch: 1, set_at: '2026-11-11T00:00:00.000Z', set_by: 1, switches: { online_orders: 'on' } })).run()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const refused = await h.call('POST', '/api/returns', { client_request_id: 'fresh-1', reason: 'manual exchange', items: [{ product_id: 9820, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 9821, quantity: 1, branch_id: 1, applied_price_usd: 25 }], replacement_payment_method: 'ABA KHQR' }, 'fresh exchange')
    assert.equal(refused.status, 400, JSON.stringify(refused.body))
    assert.equal(refused.body.code, 'online_method_requires_order')
    console.log('PASS the refusal names online_method_requires_order inside the memo window')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online method refusal fresh: ok'); process.exit(0) }).catch((error) => { console.error(error); process.exit(1) })
