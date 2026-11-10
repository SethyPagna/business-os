// KHQR round 2, D5: a return exchange cannot be paid with the online (KHQR) method, the same refusal a plain sale gets (online_method_requires_order), on the one-step exchange
// (exchange_payment rows) and on the replacement_payment_method path. A control exchange paid in cash still records.
//
// Run (from cloudflare/): node scripts/test-online-method-exchange-refusal-native.cjs
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 9700, 'Exchange Old', 10, 200, 4)
    await H.seedProduct(h, 9701, 'Exchange New', 10, 200, 4)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method','ABA KHQR') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_methods',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(['Cash', 'ABA KHQR'])).run()
    let n = 0
    async function exchange(payment, extra = {}) {
      n += 1
      const sale = await H.createSale(h, { key: `ex-sale-${n}`, status: 'completed', lines: [{ productId: 9700, quantity: 2 }], paymentDetails: [{ method: 'Cash', amount_usd: 20, amount_khr: 0 }] })
      assert.equal(sale.status, 200, JSON.stringify(sale.body))
      const items = await h.all('SELECT id FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id)
      const out = [{ branch_id: 1, product_id: 9701, quantity: 2 }]
      const lines = [{ sale_item_id: items[0].id, quantity: 1 }]
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: sale.body.id, items: lines, replacement_items: out }, `ex ${n}: quote`)
      assert.equal(quote.status, 200, JSON.stringify(quote.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      return h.call('POST', '/api/returns', { client_request_id: `ex-ret-${n}`, money_precision_version: 1, sale_id: sale.body.id, reason: 'exchange', expected_quote: expected, expected_exchange: quoted,
        exchange_payment: payment, items: lines.map((line) => ({ ...line, stock_action: 'restock', branch_id: 1 })), replacement_items: out, ...extra }, `ex ${n}: create`)
    }
    const returns = async () => (await h.one('SELECT COUNT(*) AS c FROM returns')).c

    const before = await returns()
    const online = await exchange({ details: [{ method: 'ABA KHQR', amount_usd: 10, amount_khr: 0 }], change_currency: 'USD' })
    assert.equal(online.status, 400, JSON.stringify(online.body)); assert.equal(online.body.code, 'online_method_requires_order')
    assert.equal(await returns(), before, 'nothing was recorded')
    const cash = await exchange({ details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], change_currency: 'USD' })
    assert.equal(cash.status, 200, JSON.stringify(cash.body)); assert.equal(await returns(), before + 1)
    console.log('PASS the one-step exchange refuses the online method and still takes cash')

    const manual = (method) => h.call('POST', '/api/returns', { client_request_id: `ex-manual-${method === 'Cash' ? 'cash' : 'online'}`, reason: 'manual exchange',
      items: [{ product_id: 9700, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
      replacement_items: [{ product_id: 9701, quantity: 1, branch_id: 1, applied_price_usd: 25 }], replacement_payment_method: method }, `manual ${method}`)
    const legacy = await manual('ABA KHQR')
    assert.equal(legacy.status, 400, JSON.stringify(legacy.body)); assert.equal(legacy.body.code, 'online_method_requires_order'); assert.equal(await returns(), before + 1)
    const manualCash = await manual('Cash')
    assert.equal(manualCash.status, 200, JSON.stringify(manualCash.body))
    console.log('PASS the replacement_payment_method path refuses it too')

    // R3-8: the refusal is decided inside the commit (no read of its own), so each way the rule applies is held here: the stored name (any spelling), the default name while the switch is ON
    // with nothing stored, a different non-cash method that is not reserved, and nothing reserved while the setting is absent and the switch is off.
    const setting = (value) => value === null ? h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run() : h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(value).run()
    const switchState = (state) => h.db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({ epoch: 1, switches: { online_orders: state } })).run()
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_methods',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(['Cash', 'ABA KHQR', 'Bakong', 'Wing'])).run()
    let m = 0
    const attempt = async (method) => { m += 1; await new Promise((resolve) => setTimeout(resolve, 1100)); return h.call('POST', '/api/returns', { client_request_id: `ex-rule-${m}`, reason: 'manual exchange',
      items: [{ product_id: 9700, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }], replacement_items: [{ product_id: 9701, quantity: 1, branch_id: 1, applied_price_usd: 25 }], replacement_payment_method: method }, `rule ${m}`) }
    await setting('Bakong'); await switchState('off')
    assert.equal((await attempt('  bakong ')).body.code, 'online_method_requires_order', 'the stored name is reserved whatever its spelling')
    assert.equal((await attempt('ABA KHQR')).status, 200, 'the old default name is free once another method is stored')
    await setting(null); await switchState('on')
    assert.equal((await attempt('ABA KHQR')).body.code, 'online_method_requires_order', 'the switch ON with nothing stored reserves the default name')
    assert.equal((await attempt('Wing')).status, 200, 'another non-cash method is never refused')
    await switchState('off')
    assert.equal((await attempt('ABA KHQR')).status, 200, 'nothing stored and the switch off: nothing is reserved')
    console.log('PASS the in-commit refusal follows the stored name, the default name while the switch is ON, and nothing else')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online method exchange refusal: ok'); process.exit(0) }).catch((error) => { console.error(error); process.exit(1) })
