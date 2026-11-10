'use strict'
// KHQR round 2, D4: online ordering cannot be turned ON while no online payment method is stored (the till would refuse every in-store sale named "ABA KHQR" without the UI
// knowing), and the Worker publishes the method name in force (settings key online_order_method_in_force, on GET /api/settings and the bootstrap) so the UI and the Worker use ONE rule.
//
// Run (from cloudflare/): node scripts/test-online-order-method-switch-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url') })
  const { check, finish } = createReporter()
  const SWITCHES = '/api/runtime/read-switches'
  const flag = async () => (await world.first("SELECT value FROM system_flags WHERE key = 'read_switches'"))?.value ?? null
  const inForce = async () => (await world.api('GET', '/api/settings')).json.online_order_method_in_force
  try {
    await check('turning online_orders ON with no stored method is refused (409 online_method_required) and writes nothing; OFF and the other switches are unaffected', async (t) => {
      const refused = await world.api('PUT', SWITCHES, { name: 'online_orders', state: 'on', expectedEpoch: 0 })
      t.eq('status', [refused.status, refused.json && refused.json.code], [409, 'online_method_required'])
      t.eq('nothing written', await flag(), null)
      const other = await world.api('PUT', SWITCHES, { name: 'probe', state: 'on', expectedEpoch: 0 })
      t.eq('another switch still flips', other.status, 200)
      const off = await world.api('PUT', SWITCHES, { name: 'online_orders', state: 'off', expectedEpoch: 1 })
      t.eq('OFF is not refused', off.status, 200)
    })

    await check('with the method stored the same flip succeeds', async (t) => {
      await world.run("INSERT INTO settings (key, value) VALUES ('online_order_payment_method', 'ABA KHQR') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      const on = await world.api('PUT', SWITCHES, { name: 'online_orders', state: 'on', expectedEpoch: 1 })
      t.eq('status', on.status, 200)
    })

    await check('the Worker publishes the method in force: the stored name once set, the default when the switch is ON with nothing stored, nothing while both are absent', async (t) => {
      t.eq('stored', await inForce(), 'ABA KHQR')
      await world.run("UPDATE settings SET value = 'Bakong' WHERE key = 'online_order_payment_method'")
      t.eq('renamed', await inForce(), 'Bakong')
      await world.run("DELETE FROM settings WHERE key = 'online_order_payment_method'")
      t.eq('switch ON, nothing stored: the name the Worker refuses is the default', await inForce(), 'ABA KHQR')
      const off = await world.api('PUT', SWITCHES, { name: 'online_orders', state: 'off', expectedEpoch: 2 })
      t.eq('switch off', off.status, 200)
      t.eq('switch OFF, nothing stored: nothing is reserved', await inForce(), '')
    })

    await check('R3-3b: a settings save that clears the stored method while online_orders is ON is refused (409 online_method_required) and changes nothing; with the switch OFF the same save clears it', async (t) => {
      await world.run("INSERT INTO settings (key, value) VALUES ('online_order_payment_method', 'ABA KHQR') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      await world.run("INSERT INTO settings (key, value) VALUES ('pos_payment_methods', '[\"Cash\",\"ABA KHQR\"]') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      const storedMethod = async () => (await world.first("SELECT value FROM settings WHERE key = 'online_order_payment_method'"))?.value ?? null
      const on = await world.api('PUT', SWITCHES, { name: 'online_orders', state: 'on', expectedEpoch: 3 })
      t.eq('switch on', on.status, 200)
      const cleared = await world.api('POST', '/api/settings', { online_order_payment_method: '' })
      t.eq('refused', [cleared.status, cleared.json && cleared.json.code], [409, 'online_method_required'])
      t.eq('method kept', await storedMethod(), 'ABA KHQR')
      const resent = await world.api('POST', '/api/settings', { online_order_payment_method: 'ABA KHQR', business_name: 'Leang' })
      t.eq('a form that resends the stored method is not refused', resent.status, 200)
      const off = await world.api('PUT', SWITCHES, { name: 'online_orders', state: 'off', expectedEpoch: 4 })
      t.eq('switch off', off.status, 200)
      const allowed = await world.api('POST', '/api/settings', { online_order_payment_method: '' })
      t.eq('cleared once the switch is off', allowed.status, 200)
      t.eq('method gone', (await storedMethod()) || null, null)
    })

    await check('the bootstrap carries the same key, and a save that echoes it stores nothing', async (t) => {
      await world.run("INSERT INTO settings (key, value) VALUES ('online_order_payment_method', 'ABA KHQR') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      const boot = await world.api('GET', '/api/auth/bootstrap')
      t.eq('bootstrap', boot.json && boot.json.settings && boot.json.settings.online_order_method_in_force, 'ABA KHQR')
      await world.api('POST', '/api/settings', { online_order_method_in_force: 'Hacked', business_name: 'Leang' })
      t.eq('no stored row', await world.first("SELECT value FROM settings WHERE key = 'online_order_method_in_force'"), null)
    })
  } finally { await world.dispose() }
  finish('online order method switch')
}
main().catch((error) => { console.error(error); process.exit(1) })
