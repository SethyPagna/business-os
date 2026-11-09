// KHQR S6a: the online (KHQR) payment method setting. It must name a configured method, a list save may not remove it, and a reviewed rename carries it along.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-method-setting
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
async function main() {
  const h = await H.startWorker()
  try {
    const set = (body) => h.call('POST', '/api/settings', body, 'settings')
    const value = async () => (await h.one("SELECT value FROM settings WHERE key = 'online_order_payment_method'"))?.value
    await h.db.prepare("UPDATE settings SET value = ? WHERE key = 'pos_payment_methods'").bind('["Cash","ABA","Wing"]').run()
    const unknown = await set({ online_order_payment_method: 'Bitcoin' })
    assert.equal(unknown.status, 400, JSON.stringify(unknown.body)); assert.equal(unknown.body.code, 'invalid_online_order_payment_method'); assert.equal(await value(), undefined)
    const ok = await set({ online_order_payment_method: 'ABA' })
    assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(await value(), 'ABA')
    const removing = await set({ pos_payment_methods: '["Cash","Wing"]' })
    assert.equal(removing.status, 400, JSON.stringify(removing.body)); assert.equal(removing.body.code, 'invalid_online_order_payment_method')
    assert.equal((await h.one("SELECT value FROM settings WHERE key = 'pos_payment_methods'")).value, '["Cash","ABA","Wing"]')
    const other = await set({ pos_payment_methods: '["Cash","ABA","Wing","Card"]' })
    assert.equal(other.status, 200, JSON.stringify(other.body))
    console.log('PASS the online method must be configured and the list cannot drop it')
    const impact = await h.call('GET', '/api/settings/payment-methods/impact?from=ABA&to=PayWay', undefined, 'impact')
    assert.equal(impact.status, 200, JSON.stringify(impact.body))
    const replaced = await h.call('POST', '/api/settings/payment-methods/replace', { from: 'ABA', to: 'PayWay', scope: 'settings_only', currentPassword: 'al-money-fixture', expected_updated_at: impact.body.settings_updated_at }, 'replace')
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body))
    assert.equal(await value(), 'PayWay', 'the rename carried the online method along')
    console.log('PASS a reviewed rename keeps the online method in step')
    // Control: a rename of some OTHER method leaves it alone.
    const impact2 = await h.call('GET', '/api/settings/payment-methods/impact?from=Wing&to=Wing2', undefined, 'impact')
    const replaced2 = await h.call('POST', '/api/settings/payment-methods/replace', { from: 'Wing', to: 'Wing2', scope: 'settings_only', currentPassword: 'al-money-fixture', expected_updated_at: impact2.body.settings_updated_at }, 'replace')
    assert.equal(replaced2.status, 200, JSON.stringify(replaced2.body)); assert.equal(await value(), 'PayWay')
    console.log('PASS control: renaming another method leaves the online method alone')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online method setting: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
