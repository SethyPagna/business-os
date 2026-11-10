// KHQR round 5 defect 5: with online_orders OFF and no online method stored, GET /api/settings and the bootstrap cost the same D1 calls as before the online-order work: the in-force
// label reads no database (it uses the isolate's last-seen switch), so an expired switch memo adds no fourth call. A build whose label reads the switch is one call over.
// Run (from cloudflare/): node scripts/run-native-suite.cjs settings-get-calls
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const MEMO_EXPIRY_MS = 16000
const READS_SWITCH = { name: 'label-reads-switch', file: 'src/routes/settings.ts', from: 'return c.json({ ...withOnlineMethodInForce(settingsVisibleTo(user, map)), updatedAt })',
  to: "await (await import('../lib/readSwitches')).readSwitch(c.env, 'online_orders'); return c.json({ ...withOnlineMethodInForce(settingsVisibleTo(user, map)), updatedAt })" }

async function measure(patches) {
  const h = await H.startWorker({ patches })
  try {
    await h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run()
    const calls = {}
    for (const [label, url] of [['settings', '/api/settings'], ['bootstrap', '/api/auth/bootstrap']]) {
      await new Promise((resolve) => setTimeout(resolve, MEMO_EXPIRY_MS))
      const result = await h.call('GET', H.fresh(url), undefined, `get ${label}`)
      assert.equal(result.status, 200, JSON.stringify(result.body))
      assert.equal((result.body.settings || result.body).online_order_method_in_force, '', `${label}: nothing is reserved while the switch is off and no method is stored`)
      calls[label] = h.metrics.find((entry) => entry.label === `get ${label}`).calls
    }
    return calls
  } finally { await h.mf.dispose() }
}

async function main() {
  const head = await measure([])
  console.log(`settings ${head.settings}, bootstrap ${head.bootstrap}`)
  assert.equal(head.settings, 3, 'GET /api/settings costs the 3 D1 calls it cost before the online-order work')
  console.log('PASS GET /api/settings costs 3 D1 calls with the switch memo expired')
  assert.equal(head.bootstrap, 3, 'the bootstrap costs the 3 D1 calls it cost before the online-order work')
  console.log(`PASS the bootstrap costs ${head.bootstrap} D1 calls with the switch memo expired`)
  const mutated = await measure([READS_SWITCH])
  assert.equal(mutated.settings, head.settings + 1, 'control: a build that reads the switch on this route is one call over')
  console.log('PASS control: reading the switch on GET /api/settings is one call over')
}
main().then(() => { console.log('settings get calls: ok'); process.exit(0) }).catch((error) => { console.error(error); process.exit(1) })
