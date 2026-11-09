// KHQR S6a: a plain POS sale is the hottest path; the online-order Fulfil work must cost it NOTHING. The numbers below were measured at the lane base (before 6.0.1431)
// with this same fixture and are pinned EXACTLY (not a ceiling). Any D1 call or statement added to a plain sale turns this red.
// Run (from cloudflare/): node scripts/run-native-suite.cjs plain-sale-d1-cost
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
const PINNED = { first: { calls: 15, statements: 15 }, next: { calls: 20, statements: 36 } }
async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 12, 'Cost Serum', 12.5, 100, 2)
    const pay = [{ method: 'Cash', amount_usd: 12.5, amount_khr: 0 }]
    const one = (key) => H.createSale(h, { key, lines: [{ productId: 12, quantity: 1 }], paymentDetails: pay, label: key })
    assert.equal((await one('cost-1')).status, 200); assert.equal((await one('cost-2')).status, 200)
    const [a, b] = h.metrics.filter((m) => m.label.startsWith('cost-'))
    console.log('MEASURED', JSON.stringify({ first: { calls: a.calls, statements: a.statements }, next: { calls: b.calls, statements: b.statements } }))
    assert.deepEqual({ calls: a.calls, statements: a.statements }, PINNED.first, 'first plain sale D1 cost differs from the lane base')
    assert.deepEqual({ calls: b.calls, statements: b.statements }, PINNED.next, 'next plain sale D1 cost differs from the lane base')
    console.log('PASS a plain sale costs exactly the lane-base D1 calls and statements')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('plain sale d1 cost: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
