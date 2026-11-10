// KHQR round 5 defect 7: the online (KHQR) method name is compared the same way in JS and in SQL. SQLite lower() folds only A-Z, so a name with a non-ASCII capital must not be folded
// by the JS side (toLowerCase) into a key the SQL refusal never matches. A manual exchange paid with the configured method is refused, whatever the name holds.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-method-ascii-fold
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const METHODS = ['Cash', 'ABA KHQR', '\u00c9clair QR']

async function main() {
  const h = await H.startWorker({})
  try {
    await H.seedProduct(h, 9810, 'Fold Old', 10, 500, 4)
    await H.seedProduct(h, 9811, 'Fold New', 10, 500, 4)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_methods',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(METHODS)).run()
    const setMethod = (name) => h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(name).run()
    const sold = async () => (await h.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE payment_method LIKE '%QR%'").first()).n
    let step = 0
    const exchange = async (method) => {
      step += 1
      await new Promise((resolve) => setTimeout(resolve, 1100))
      return h.call('POST', '/api/returns', { client_request_id: `fold-${step}`, reason: 'manual exchange', items: [{ product_id: 9810, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
        replacement_items: [{ product_id: 9811, quantity: 1, branch_id: 1, applied_price_usd: 25 }], replacement_payment_method: method }, `fold ${step}`)
    }
    await setMethod('ABA KHQR')
    const ascii = await exchange('ABA KHQR')
    assert.equal(ascii.status, 400, JSON.stringify(ascii.body))
    assert.equal(ascii.body.code, 'online_method_requires_order')
    console.log('PASS control: the ASCII method is refused on a manual exchange')

    await setMethod('\u00c9clair QR')
    const folded = await exchange('\u00c9clair QR')
    assert.equal(folded.status, 400, `a name with a non-ASCII capital is refused too: ${JSON.stringify(folded.body)}`)
    assert.equal(folded.body.code, 'online_method_requires_order')
    assert.equal(await sold(), 0, 'no sale carries the reserved method')
    console.log('PASS a configured method with a non-ASCII capital is refused on a manual exchange, and no sale is written')

    const other = await exchange('Cash')
    assert.equal(other.status, 200, JSON.stringify(other.body))
    console.log('PASS control: a cash exchange still goes through')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online method ascii fold: ok'); process.exit(0) }).catch((error) => { console.error(error); process.exit(1) })
