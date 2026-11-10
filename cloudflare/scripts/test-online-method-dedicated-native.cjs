'use strict'
// KHQR round 6, N1: the online (KHQR) payment method is a DEDICATED method.
//   N1: a cash-kind method (the token rule or an explicit kind) cannot be stored as the online method, because a stored method is reserved at once (ordinary sales with it are
//       refused, the till hides it), which would stop the till taking cash. The check uses the kinds map the same save carries, else the stored one.
// Not checked here, on purpose: refusing a method that existing non-online sales already use. No index supports that probe (sales has none on payment_method or the payment
// details JSON), so it would be a scan of sales; see LANE-KHQR.md round 6.
//
// Run (from cloudflare/): node scripts/test-online-method-dedicated-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url') })
  const { check, finish } = createReporter()
  const setting = async (key) => (await world.first('SELECT value FROM settings WHERE key = ?', key))?.value ?? null
  const put = (key, value) => world.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  try {
    await check('N1: a cash method cannot be the online method (token rule, Khmer token, explicit kind), and nothing is stored', async (t) => {
      await put('pos_payment_methods', JSON.stringify(['Cash', 'សាច់ប្រាក់ ដុល្លារ', 'ABA KHQR', 'Wing']))
      await world.run("DELETE FROM settings WHERE key IN ('online_order_payment_method','pos_payment_method_kinds')")
      for (const name of ['Cash', 'cash', 'សាច់ប្រាក់ ដុល្លារ']) {
        const refused = await world.api('POST', '/api/settings', { online_order_payment_method: name })
        t.eq(`${name}: refused`, [refused.status, refused.json && refused.json.code], [400, 'online_order_method_is_cash'])
        t.eq(`${name}: nothing stored`, await setting('online_order_payment_method'), null)
      }
      await put('pos_payment_method_kinds', JSON.stringify({ Wing: 'cash' }))
      const declared = await world.api('POST', '/api/settings', { online_order_payment_method: 'Wing' })
      t.eq('a method the owner marked as cash: refused', [declared.status, declared.json && declared.json.code], [400, 'online_order_method_is_cash'])
      await world.run("DELETE FROM settings WHERE key = 'pos_payment_method_kinds'")
      const sameSave = await world.api('POST', '/api/settings', { online_order_payment_method: 'ABA KHQR', pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'cash' }) })
      t.eq('the kinds map carried by the same save counts', [sameSave.status, sameSave.json && sameSave.json.code], [400, 'online_order_method_is_cash'])
      t.eq('nothing stored', await setting('online_order_payment_method'), null)
    })

    await check('N1 control: a dedicated method is accepted; the list is still checked first', async (t) => {
      const ok = await world.api('POST', '/api/settings', { online_order_payment_method: 'ABA KHQR' })
      t.eq('ABA KHQR stored', [ok.status, await setting('online_order_payment_method')], [200, 'ABA KHQR'])
      const unlisted = await world.api('POST', '/api/settings', { online_order_payment_method: 'Nowhere' })
      t.eq('an unlisted method keeps its own code', [unlisted.status, unlisted.json && unlisted.json.code], [400, 'invalid_online_order_payment_method'])
    })

    await check('D2 (round 7): a kinds-only save cannot make the stored online method cash-kind (manager or administrator), and nothing is stored', async (t) => {
      await world.account('kinds_manager', { roleCode: 'kinds_manager_role', permissions: { settings: true, sales_policy: true } })
      await put('pos_payment_methods', JSON.stringify(['Cash', 'ABA KHQR', 'Wing']))
      await put('online_order_payment_method', 'ABA KHQR')
      await world.run("DELETE FROM settings WHERE key = 'pos_payment_method_kinds'")
      const asManager = await world.api('POST', '/api/settings', { pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'cash' }) }, { as: 'kinds_manager' })
      t.eq('manager', [asManager.status, asManager.json && asManager.json.code], [400, 'online_order_method_is_cash'])
      const asAdmin = await world.api('POST', '/api/settings', { pos_payment_method_kinds: JSON.stringify({ ' aba khqr ': 'cash' }) })
      t.eq('administrator, other spelling', [asAdmin.status, asAdmin.json && asAdmin.json.code], [400, 'online_order_method_is_cash'])
      t.eq('kinds not stored', await setting('pos_payment_method_kinds'), null)
      const control = await world.api('POST', '/api/settings', { pos_payment_method_kinds: JSON.stringify({ Wing: 'cash' }) })
      t.eq('control: kinds for another method are saved', [control.status, await setting('pos_payment_method_kinds')], [200, JSON.stringify({ Wing: 'cash' })])
      // An already cash-kind online method (stale state) never traps an unrelated kinds edit.
      await put('pos_payment_method_kinds', JSON.stringify({ 'ABA KHQR': 'cash' }))
      const stale = await world.api('POST', '/api/settings', { pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'cash', Wing: 'digital' }) })
      t.eq('control: a stale cash-kind online method does not trap an unrelated kinds edit', stale.status, 200)
    })

  } finally { await world.dispose() }
  finish('online method dedicated')
}
main().catch((error) => { console.error(error); process.exit(1) })
