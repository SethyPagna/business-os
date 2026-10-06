// RET-A verify R2 (X6-X8 and the 1-riel preview/drawer drift), fuzzed over the
// real settleReplacementTender (lib/returnRefundSplit.ts), the ONE settlement
// the Return screen preview and POST /api/returns share.
//
// For every riel exchange that follows a debt it must hold that:
//   1. the riel the screen pays out is the drawer's net to the riel: the
//      return's riel cash leg (refundCashKhr over its cash share, the JS twin
//      of REFUND_DRAWER_KHR_SQL) less the riel tender the replacement records;
//   2. the replacement, recorded at replacementRate with that riel tender,
//      owes exactly what the screen said (recordedSaleOutstandingUsd, the one
//      owed helper) -- no phantom debt below the rounding unit.
// CONTROLS in the same run: the retired readings (payout riel rounded on its
// own share; replacement measured at the sale's rate) break 1 and 2 on this
// very sample, so a green run is not an instrument that cannot fail.
// Run: node scripts/test-return-replacement-tender-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')

const root = path.join(__dirname, '..')
function bundle(entry) {
  const out = buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}
const k = bundle(`export { settleReplacementTender } from './src/lib/returnRefundSplit'
export { refundCashKhr } from './src/lib/refundTender'
export { recordedSaleOutstandingUsd } from './src/lib/saleStatusResolution'`)

let seed = 20261006
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const cents = (max) => Math.round(rnd() * max * 100) / 100

let cases = 0, payoutDrift = 0, phantom = 0
for (let i = 0; i < 50000; i++) {
  const saleRate = [4000, 4050, 4100][i % 3]
  const refundUsd = Math.max(0.01, cents(60))
  // A legacy/v0 riel figure: USD x rate, nudged to a rounded riel price.
  const refundKhr = Math.max(100, Math.round(refundUsd * saleRate / 100) * 100 + [0, -500, 300, -43][i % 4])
  const owedReduction = Math.min(refundUsd, cents(refundUsd))
  const cashUsd = Math.round((refundUsd - owedReduction) * 10000) / 10000
  const replacementUsd = Math.max(0.01, cents(40))
  const t = k.settleReplacementTender({ carriesDebt: true, cashUsd, replacementUsd, currency: 'KHR', refundUsd, refundKhr, saleRate })
  if (!(t.paidFromRefundUsd > 0)) continue
  cases++
  // 1. screen riel == drawer net
  const drawerOut = k.refundCashKhr(refundKhr, cashUsd, refundUsd)
  assert.equal(t.payoutKhr, drawerOut - t.paidFromRefundKhr, `case ${i}: screen riel ${t.payoutKhr} vs drawer ${drawerOut - t.paidFromRefundKhr}`)
  // 2. the recorded replacement owes what the screen said
  const recorded = k.recordedSaleOutstandingUsd({ total_usd: replacementUsd, amount_paid_usd: 0, amount_paid_khr: t.paidFromRefundKhr,
    exchange_rate: t.replacementRate, money_precision_version: 0 })
  assert.ok(Math.abs(recorded - t.owedUsd) < 0.005 && (recorded > 0) === (t.owedUsd > 0),
    `case ${i}: recorded owes ${recorded}, screen ${t.owedUsd}`)
  // CONTROLS: the retired readings on the same case.
  if (k.refundCashKhr(refundKhr, t.payoutUsd, refundUsd) !== t.payoutKhr) payoutDrift++
  const atSaleRate = k.recordedSaleOutstandingUsd({ total_usd: replacementUsd, amount_paid_usd: 0, amount_paid_khr: t.paidFromRefundKhr,
    exchange_rate: saleRate, money_precision_version: 0 })
  if (Math.abs(atSaleRate - t.owedUsd) >= 0.005 || (atSaleRate > 0) !== (t.owedUsd > 0)) phantom++
}
assert.ok(cases > 20000, `enough riel-funded cases (${cases})`)
assert.ok(payoutDrift > 0, 'CONTROL: rounding the payout share on its own drifts from the drawer on this sample')
assert.ok(phantom > 0, 'CONTROL: measuring the replacement at the sale rate leaves phantom debt on this sample')
console.log(`PASS ${cases} riel-funded exchanges: screen riel == drawer riel and recorded owed == screen owed (controls: ${payoutDrift} drift, ${phantom} phantom under the retired readings)`)

// A dollar refund and a sale with no debt keep the sale's rate and pay no riel.
const usd = k.settleReplacementTender({ carriesDebt: true, cashUsd: 1, replacementUsd: 4, currency: 'USD', refundUsd: 4, refundKhr: 16000, saleRate: 4000 })
assert.deepEqual([usd.paidFromRefundUsd, usd.paidFromRefundKhr, usd.payoutKhr, usd.replacementRate, usd.owedUsd], [1, 0, 0, 4000, 3])
const counter = k.settleReplacementTender({ carriesDebt: false, cashUsd: 4, replacementUsd: 4, currency: 'KHR', refundUsd: 4, refundKhr: 15500, saleRate: 4000 })
assert.deepEqual([counter.followsDebt, counter.paidFromRefundKhr, counter.payoutKhr, counter.replacementRate], [false, 0, 15500, 4000],
  'no debt: the counter rule pays the whole riel cash leg out')
console.log('PASS dollar refunds and the counter rule are unchanged')
