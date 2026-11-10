'use strict'
// KHQR round 6, N2: the online (KHQR) payment method follows /api/settings/payment-methods/replace.
//   The route carries the online method along, so it needs the same administrator as the settings save, never merges the online method into
//       another configured method, and never renames it to a cash one.
//
// Run (from cloudflare/): node scripts/test-online-method-replace-admin-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  const setting = async (key) => (await world.first('SELECT value FROM settings WHERE key = ?', key))?.value ?? null
  const put = (key, value) => world.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  try {
    await world.account('policy_manager', { roleCode: 'policy_manager_role', permissions: { settings: true, sales_policy: true } })

    await put('pos_payment_methods', JSON.stringify(['Cash', 'ABA KHQR', 'Bakong']))

    await check('N2: a manager cannot rename or merge the online method (either side), and nothing moves', async (t) => {
      await put('pos_payment_methods', JSON.stringify(['Cash', 'ABA KHQR', 'Bakong']))
      await put('online_order_payment_method', 'ABA KHQR')
      const asManager = { as: 'policy_manager' }
      for (const [from, to] of [['ABA KHQR', 'Bakong'], ['ABA KHQR', 'Cash'], ['Bakong', 'ABA KHQR'], ['ABA KHQR', 'ABA Pay'], [' aba khqr ', 'Wallet']]) {
        const refused = await world.api('POST', '/api/settings/payment-methods/replace', { from, to, scope: 'settings_only' }, asManager)
        t.eq(`${from} -> ${to}: refused`, [refused.status, refused.json && refused.json.code], [403, 'online_method_admin_only'])
      }
      t.eq('online method kept', await setting('online_order_payment_method'), 'ABA KHQR')
      t.eq('list kept', await setting('pos_payment_methods'), JSON.stringify(['Cash', 'ABA KHQR', 'Bakong']))
    })

    await check('N2: even an administrator cannot merge the online method into another configured method, or rename it to a cash one', async (t) => {
      const merge = await world.api('POST', '/api/settings/payment-methods/replace', { from: 'ABA KHQR', to: 'Bakong', scope: 'settings_only' })
      t.eq('merge into another method', [merge.status, merge.json && merge.json.code], [409, 'online_method_merge_refused'])
      const intoCash = await world.api('POST', '/api/settings/payment-methods/replace', { from: 'ABA KHQR', to: 'Cash', scope: 'settings_only' })
      t.eq('merge into Cash', [intoCash.status, intoCash.json && intoCash.json.code], [409, 'online_method_merge_refused'])
      const toCash = await world.api('POST', '/api/settings/payment-methods/replace', { from: 'ABA KHQR', to: 'Cash Drawer', scope: 'settings_only' })
      t.eq('rename to a new cash-named method', [toCash.status, toCash.json && toCash.json.code], [409, 'online_order_method_is_cash'])
      t.eq('online method kept', await setting('online_order_payment_method'), 'ABA KHQR')
      t.eq('list kept', await setting('pos_payment_methods'), JSON.stringify(['Cash', 'ABA KHQR', 'Bakong']))
    })

    await check('D1 (round 7): even an administrator cannot merge ANOTHER method INTO the online method, settings-only or linked, and no sale is rewritten', async (t) => {
      await put('pos_payment_methods', JSON.stringify(['Cash', 'ABA KHQR', 'Bakong']))
      await put('online_order_payment_method', 'ABA KHQR')
      await world.run("DELETE FROM sales WHERE receipt_number = 'R-D1'")
      await world.run("INSERT INTO sales (receipt_number, total_usd, payment_method, payment_details, created_at) VALUES ('R-D1', 5, 'Cash', '[{\"method\":\"Cash\",\"amount_usd\":5,\"amount_khr\":0}]', datetime('now'))")
      const before = JSON.stringify(await world.first("SELECT payment_method, payment_details FROM sales WHERE receipt_number = 'R-D1'"))
      for (const [from, to, scope] of [['Cash', 'ABA KHQR', 'linked'], ['Cash', 'ABA KHQR', 'settings_only'], ['Bakong', 'ABA KHQR', 'settings_only'], ['Bakong', ' aba khqr ', 'linked']]) {
        const refused = await world.api('POST', '/api/settings/payment-methods/replace', { from, to, scope, currentPassword: adminPassword })
        t.eq(`${from} -> ${to} (${scope}): refused`, [refused.status, refused.json && refused.json.code], [409, 'online_method_merge_refused'])
      }
      t.eq('the online method kept', await setting('online_order_payment_method'), 'ABA KHQR')
      t.eq('the list kept', await setting('pos_payment_methods'), JSON.stringify(['Cash', 'ABA KHQR', 'Bakong']))
      t.eq('the ordinary Cash sale untouched', JSON.stringify(await world.first("SELECT payment_method, payment_details FROM sales WHERE receipt_number = 'R-D1'")), before)
    })

    await check('N2 control: the administrator renames it to a new dedicated name and the setting follows; a manager still renames an unrelated method', async (t) => {
      const other = await world.api('POST', '/api/settings/payment-methods/replace', { from: 'Bakong', to: 'Bakong Pay', scope: 'settings_only' }, { as: 'policy_manager' })
      t.eq('manager, unrelated method', other.status, 200)
      const renamed = await world.api('POST', '/api/settings/payment-methods/replace', { from: 'ABA KHQR', to: 'ABA Pay', scope: 'settings_only' })
      t.eq('administrator, online method', renamed.status, 200)
      t.eq('the setting followed', await setting('online_order_payment_method'), 'ABA Pay')
      t.eq('the list', await setting('pos_payment_methods'), JSON.stringify(['Cash', 'ABA Pay', 'Bakong Pay']))
    })
  } finally { await world.dispose() }
  finish('online method replace admin')
}
main().catch((error) => { console.error(error); process.exit(1) })
