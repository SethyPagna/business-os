// KHQR round 3 R3-8: refusing the online (KHQR) method on a manual exchange costs no D1 call of its own. A manual exchange paid with another non-cash method (Wing) uses exactly
// as many D1 calls as the same exchange paid in cash, which never touched the setting; that count is the one of the base before the online order work. A mutant that reads the
// setting first (the round 2 shape) is one call over, so the count is sensitive to it.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-method-exchange-calls
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const EXTRA_READ = { name: 'extra-settings-read', file: 'src/routes/returns.ts', from: "  const replacementStatus = replacementUnpaid ? 'awaiting_payment' : 'completed'\n",
  to: "  if (replacementLines.length && replacementPaymentMethod && !sameMethod(replacementPaymentMethod, DEFAULT_REPLACEMENT_PAYMENT_METHOD)) await db.prepare('SELECT value FROM settings WHERE key = @key').get({ key: ONLINE_PAYMENT_METHOD_KEY })\n  const replacementStatus = replacementUnpaid ? 'awaiting_payment' : 'completed'\n" }

async function callsFor(patches) {
  const h = await H.startWorker({ patches })
  try {
    await H.seedProduct(h, 9800, 'Calls Old', 10, 500, 4)
    await H.seedProduct(h, 9801, 'Calls New', 10, 500, 4)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_methods',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(['Cash', 'Wing', 'ABA KHQR'])).run()
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method','ABA KHQR') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const manual = async (method, tag) => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
      const result = await h.call('POST', '/api/returns', { client_request_id: `calls-${tag}`, reason: 'manual exchange', items: [{ product_id: 9800, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
        replacement_items: [{ product_id: 9801, quantity: 1, branch_id: 1, applied_price_usd: 25 }], replacement_payment_method: method }, `manual ${tag}`)
      assert.equal(result.status, 200, JSON.stringify(result.body))
      return h.metrics.find((entry) => entry.label === `manual ${tag}`).calls
    }
    await manual('Cash', 'warm')
    const cash = await manual('Cash', 'cash')
    const wing = await manual('Wing', 'wing')
    return { cash, wing }
  } finally { await h.mf.dispose() }
}

async function main() {
  const plain = await callsFor([])
  assert.ok(plain.cash > 0, 'the instrument counts calls')
  assert.equal(plain.wing, plain.cash, `a manual Wing exchange costs ${plain.wing} D1 calls, the cash one ${plain.cash}: the online-method refusal adds none`)
  console.log(`PASS a manual non-cash exchange costs the same ${plain.wing} D1 calls as the cash one`)
  const mutated = await callsFor([EXTRA_READ])
  assert.equal(mutated.cash, plain.cash)
  assert.equal(mutated.wing, plain.wing + 1, 'control: reading the setting first is one call more')
  console.log('PASS control: a build that reads the setting first is one call over')
}
main().then(() => { console.log('online method exchange calls: ok'); process.exit(0) }).catch((error) => { console.error(error); process.exit(1) })
