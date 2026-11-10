// KHQR round 7, D3: an unchanged resend of the online method, and a clear of it, cost no D1 call for the kinds map. The kinds map and the stored online method are read in the SAME
// statement as the rest of the save (rows that ride along, never part of the audit before-image), so the dedicated-method checks add no round trip. The call counts below are the
// ones of the base before the dedicated-method checks (resend 4, resend + unrelated key 7, clear 7); a build that reads the kinds map separately is one call over (control).
// Run (from cloudflare/): node scripts/test-online-method-resend-calls-native.cjs
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const OLD_READ = { name: 'separate-kinds-read', file: 'src/routes/settings.ts',
  from: "        : onlineAux.get(PAYMENT_METHOD_KINDS_SETTING)?.value)",
  to: "        : (await getDb(c.env).prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key: PAYMENT_METHOD_KINDS_SETTING }))?.value)" }

async function callsFor(patches) {
  const h = await H.startWorker({ patches })
  try {
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_methods',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(['Cash', 'ABA KHQR'])).run()
    const first = await h.call('POST', '/api/settings', { online_order_payment_method: 'ABA KHQR' }, 'set')
    assert.equal(first.status, 200, JSON.stringify(first.body))
    const calls = (label) => h.metrics.find((entry) => entry.label === label).calls
    const resend = await h.call('POST', '/api/settings', { online_order_payment_method: 'ABA KHQR' }, 'resend')
    assert.equal(resend.status, 200, JSON.stringify(resend.body))
    const resendOther = await h.call('POST', '/api/settings', { online_order_payment_method: 'ABA KHQR', receipt_footer: 'thanks' }, 'resend+key')
    assert.equal(resendOther.status, 200, JSON.stringify(resendOther.body))
    const clear = await h.call('POST', '/api/settings', { online_order_payment_method: '' }, 'clear')
    assert.equal(clear.status, 200, JSON.stringify(clear.body))
    return { resend: calls('resend'), resendOther: calls('resend+key'), clear: calls('clear') }
  } finally { await h.mf.dispose() }
}

async function main() {
  const plain = await callsFor([])
  console.log(`D1 calls: resend ${plain.resend}, resend + unrelated key ${plain.resendOther}, clear ${plain.clear}`)
  assert.deepEqual(plain, { resend: 4, resendOther: 7, clear: 7 }, 'the dedicated-method checks add no D1 call to a resend or a clear')
  console.log('PASS an unchanged resend and a clear add no D1 call')
  const mutated = await callsFor([OLD_READ])
  assert.deepEqual(mutated, { resend: 5, resendOther: 8, clear: 8 }, 'control: a separate kinds read is one call over on each')
  console.log('PASS control: a separate kinds read is one call over')
}
main().then(() => { console.log('online method resend calls: ok'); process.exit(0) }).catch((error) => { console.error(error); process.exit(1) })
