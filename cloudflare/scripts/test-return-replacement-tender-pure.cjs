// RET-A verify R2 (X6-X8) and R3 (E1, E4), fuzzed over the real
// settleReplacementTender (lib/returnRefundSplit.ts), the ONE settlement the
// Return screen preview and POST /api/returns share, and judged against the
// REAL drawer SQL run by SQLite -- not a JS stand-in (verify R3 E1: the old
// fuzz compared JS with JS and could not see the 1-riel drift).
//
// 200,000 cases. For each, the return row is stored the way D1 stores it
// (REAL columns) and SQLite evaluates:
//   - shiftReconciliation.ts REFUND_DRAWER_KHR_SQL (the shift drawer), and
//   - refundTender.ts refundDrawerKhrSql (the report kernel);
// then it must hold that:
//   1. both SQL readings, refundDrawerKhr (JS) and the frontend detail's
//      recordedRefundSplit read the same riel cash leg;
//   2. the riel the screen pays out is the drawer's net to the riel: that cash
//      leg less the riel tender the replacement records, never below 0;
//   3. the replacement is recorded at the shop rate whenever that changes
//      nothing it owes (E4), and what it owes at the recorded rate is what it
//      would owe with the refund's riel valued at the refund's own dollars.
// CONTROLS in the same run: the retired readings (dollars rounded to 4 places
// before the riel share; Math.round for SQLite's ROUND; the refund's own basis
// for every riel-funded replacement) break 1 / 3 on this very sample.
// Run: node scripts/test-return-replacement-tender-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { buildSync } = require('esbuild')

const root = path.join(__dirname, '..')
function bundle(entry) {
  const out = buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}
const k = bundle(`export { settleReplacementTender, saleRowOwedUsd } from './src/lib/returnRefundSplit'
export { refundCashKhr, refundDrawerKhr, refundDrawerKhrSql, sqliteRound0 } from './src/lib/refundTender'
export { REFUND_DRAWER_KHR_SQL } from './src/lib/shiftReconciliation'
export { recordedRefundSplit } from '../frontend/src/components/returns/helpers/refundCurrency'`)

const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE returns (id INTEGER PRIMARY KEY, refund_currency TEXT, total_refund_usd REAL, total_refund_khr REAL, owed_reduction_usd REAL)`)
const insert = db.prepare('INSERT INTO returns (id, refund_currency, total_refund_usd, total_refund_khr, owed_reduction_usd) VALUES (?, ?, ?, ?, ?)')

// SQLite's ROUND, pinned on the values where Math.round and it part ways.
for (const value of [0.49999999999999994, 2.5, -2.5, 822.4999999999998, 822.5, 1e15 + 0.5]) {
  assert.equal(k.sqliteRound0(value), db.prepare('SELECT ROUND(?) AS r').get(value).r, `sqliteRound0(${value}) is SQLite's ROUND`)
}
assert.notEqual(Math.round(0.49999999999999994), db.prepare('SELECT ROUND(?) AS r').get(0.49999999999999994).r, 'CONTROL: Math.round is not SQLite\'s ROUND')

let seed = 20261007
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const cents = (max) => Math.round(rnd() * max * 100) / 100
const money4 = (max) => Math.round(rnd() * max * 10000) / 10000
const N = 200000
const cases = []
db.exec('BEGIN')
// The verifier's D1 repro first: rate 4000, a $1.20 line at 4,700 riel, $0.99 lowered, a $0.21 replacement.
cases.push({ id: 1, saleRate: 4000, refundUsd: 1.2, refundKhr: 4700, owedReduction: 0.99, replacementUsd: 0.21 })
for (let i = 2; i <= N; i++) {
  const saleRate = [4000, 4050, 4100, 4062.5][i % 4]
  const refundUsd = Math.max(0.01, i % 5 === 0 ? money4(60) : cents(60))
  const shape = i % 6
  // Riel figures as returns record them: USD x rate (v0 rounded / v1 to 4
  // places), legacy round-hundred prices off the rate, and odd legacy prices.
  const refundKhr = shape === 0 ? Math.round(refundUsd * saleRate)
    : shape === 1 ? Math.round(refundUsd * saleRate * 10000) / 10000
    : shape === 2 ? Math.max(100, Math.round(refundUsd * saleRate / 100) * 100 + [0, -500, 300, 100][i % 4])
    : shape === 3 ? Math.max(1, Math.round(refundUsd * saleRate) + [-43, 57, 211, -7][i % 4])
    : shape === 4 ? Math.max(100, Math.round(refundUsd * (saleRate + 600) / 100) * 100)
    : Math.round(refundUsd * saleRate)
  const owedReduction = [0, refundUsd, cents(refundUsd), money4(refundUsd)][i % 4] > refundUsd ? refundUsd : [0, refundUsd, cents(refundUsd), money4(refundUsd)][i % 4]
  const replacementUsd = Math.max(0.01, cents(40))
  cases.push({ id: i, saleRate, refundUsd, refundKhr, owedReduction, replacementUsd })
}
for (const c of cases) insert.run(c.id, 'KHR', c.refundUsd, c.refundKhr, c.owedReduction)
db.exec('COMMIT')
const sqlDrawer = new Map(db.prepare(`SELECT id, ${k.REFUND_DRAWER_KHR_SQL} AS khr FROM returns`).all().map((r) => [r.id, r.khr]))
const sqlKernel = new Map(db.prepare(`SELECT id, ${k.refundDrawerKhrSql('returns')} AS khr FROM returns`).all().map((r) => [r.id, r.khr]))
// What D1 hands back for the stored row (REAL columns, as stored).
const stored = new Map(db.prepare('SELECT * FROM returns').all().map((r) => [r.id, r]))

let riel = 0, retiredDrift = 0, shopRate = 0, basisRate = 0, basisEverywhereMoves = 0, fullyFunded = 0
for (const c of cases) {
  const row = stored.get(c.id)
  const drawer = sqlDrawer.get(c.id)
  // 1. one riel cash leg
  assert.equal(sqlKernel.get(c.id), drawer, `case ${c.id}: the report kernel's SQL reads the drawer's riel`)
  assert.equal(k.refundDrawerKhr(row), drawer, `case ${c.id}: refundDrawerKhr ${k.refundDrawerKhr(row)} vs SQL ${drawer}`)
  const detail = k.recordedRefundSplit({ ...row, to_replacement_usd: 0, to_replacement_khr: 0 })
  const cashUsd = Math.round((c.refundUsd - c.owedReduction) * 10000) / 10000
  if (cashUsd > 0) assert.equal(detail.payoutKhr, drawer, `case ${c.id}: the frontend detail reads the drawer's riel`)
  if (cashUsd > 0 && Math.round(c.refundKhr * cashUsd / c.refundUsd) !== drawer) retiredDrift++

  const t = k.settleReplacementTender({ carriesDebt: true, cashUsd, replacementUsd: c.replacementUsd, currency: 'KHR',
    refundUsd: c.refundUsd, refundKhr: c.refundKhr, owedReductionUsd: c.owedReduction, saleRate: c.saleRate })
  if (!(t.paidFromRefundUsd > 0)) continue
  riel++
  // 2. screen riel == drawer net (refund leg out, replacement's riel tender in)
  assert.ok(t.paidFromRefundKhr >= 0 && t.paidFromRefundKhr <= drawer, `case ${c.id}: the replacement takes no more riel than the cash leg`)
  assert.equal(t.payoutKhr, drawer - t.paidFromRefundKhr, `case ${c.id}: screen riel ${t.payoutKhr} vs drawer net ${drawer - t.paidFromRefundKhr}`)
  if (!(t.payoutUsd > 0)) { fullyFunded++; assert.equal(t.paidFromRefundKhr, drawer, `case ${c.id}: a fully used cash leg funds the replacement with all of it`) }
  // 3. rate: shop rate unless it moves what is owed
  const owedAt = (rate) => k.saleRowOwedUsd({ total_usd: c.replacementUsd, amount_paid_usd: 0, amount_paid_khr: t.paidFromRefundKhr, exchange_rate: rate, money_precision_version: 0 })
  const basis = t.paidFromRefundKhr / t.paidFromRefundUsd
  assert.equal(owedAt(t.replacementRate), owedAt(basis), `case ${c.id}: the recorded rate leaves owed exactly as the refund's dollars credit it`)
  if (t.replacementRate === c.saleRate) shopRate++
  else { basisRate++; assert.notEqual(owedAt(c.saleRate), owedAt(basis), `case ${c.id}: the basis rate only where the shop rate would move what is owed`) }
  if (owedAt(c.saleRate) !== owedAt(basis)) basisEverywhereMoves++
}
assert.ok(riel > 50000, `enough riel-funded exchanges (${riel})`)
assert.ok(retiredDrift > 0, `CONTROL: the retired reading (dollars rounded first) drifts from the drawer SQL on this sample (${retiredDrift})`)
assert.ok(shopRate > 0 && basisRate > 0, `both rates occur (shop ${shopRate}, basis ${basisRate})`)
assert.equal(basisEverywhereMoves, basisRate, 'CONTROL: storing every riel-funded replacement at the shop rate would move what is owed in exactly the basis-rate cases')
const repro = cases[0]
const reproT = k.settleReplacementTender({ carriesDebt: true, cashUsd: 0.21, replacementUsd: 0.21, currency: 'KHR', refundUsd: 1.2, refundKhr: 4700, owedReductionUsd: 0.99, saleRate: 4000 })
assert.deepEqual([sqlDrawer.get(repro.id), reproT.paidFromRefundKhr, reproT.payoutKhr], [822, 822, 0], 'the verifier\'s D1 repro: drawer 822 out, 822 in, screen pays out 0')
console.log(`PASS ${N} returns vs the real drawer SQL: one riel cash leg in SQL, JS and the detail; ${riel} riel-funded exchanges pay out the drawer's net to the riel (${fullyFunded} fully funded); shop rate kept in ${shopRate}, refund basis only in the ${basisRate} where the shop rate would move what is owed (control: ${retiredDrift} drift under the retired reading)`)

// A dollar refund and a sale with no debt keep the sale's rate and pay no riel.
const usd = k.settleReplacementTender({ carriesDebt: true, cashUsd: 1, replacementUsd: 4, currency: 'USD', refundUsd: 4, refundKhr: 16000, owedReductionUsd: 3, saleRate: 4000 })
assert.deepEqual([usd.paidFromRefundUsd, usd.paidFromRefundKhr, usd.payoutKhr, usd.replacementRate, usd.owedUsd], [1, 0, 0, 4000, 3])
const counter = k.settleReplacementTender({ carriesDebt: false, cashUsd: 4, replacementUsd: 4, currency: 'KHR', refundUsd: 4, refundKhr: 15500, owedReductionUsd: 0, saleRate: 4000 })
assert.deepEqual([counter.followsDebt, counter.paidFromRefundKhr, counter.payoutKhr, counter.replacementRate], [false, 0, 15500, 4000],
  'no debt: the counter rule pays the whole riel cash leg out')
console.log('PASS dollar refunds and the counter rule are unchanged')

// E4, the owner-visible cases (verify R2 X6 / X7: rate 4100, a $1.23 line sold
// at 5,000 riel). Recorded at the shop rate, the refund's riel would cover less
// than the dollars the screen credited:
const x7 = k.settleReplacementTender({ carriesDebt: true, cashUsd: 1.23, replacementUsd: 1.23, currency: 'KHR', refundUsd: 1.23, refundKhr: 5000, owedReductionUsd: 0, saleRate: 4100 })
const owed = (t, total, rate) => k.saleRowOwedUsd({ total_usd: total, amount_paid_usd: 0, amount_paid_khr: t.paidFromRefundKhr, exchange_rate: rate, money_precision_version: 0 })
assert.equal(owed(x7, 1.23, x7.replacementRate), 0, 'X7 even swap: owes nothing at the recorded rate')
assert.equal(owed(x7, 1.23, 4100), 0.0105, 'X7 at the shop rate would owe $0.0105 -- an even swap left Not Paid (phantom debt)')
const x6 = k.settleReplacementTender({ carriesDebt: true, cashUsd: 2.62, replacementUsd: 4.92, currency: 'KHR', refundUsd: 2.62, refundKhr: 10650, owedReductionUsd: 0, saleRate: 4100 })
assert.equal(owed(x6, 4.92, x6.replacementRate), 2.3, 'X6: owes $2.30 at the recorded rate')
assert.equal(owed(x6, 4.92, 4100), 2.3224, 'X6 at the shop rate would owe $2.3224 ($0.0224 the screen never showed)')
// ...while an exchange whose riel is USD x the rate is recorded at the shop rate.
const modern = k.settleReplacementTender({ carriesDebt: true, cashUsd: 2.62, replacementUsd: 4.92, currency: 'KHR', refundUsd: 2.62, refundKhr: 10742, owedReductionUsd: 0, saleRate: 4100 })
assert.equal(modern.replacementRate, 4100, 'riel at USD x rate: the replacement keeps the shop rate')
assert.equal(owed(modern, 4.92, 4100), 2.3)
// Riel rounded to whole riel at a 4,062.5 rate: the refund's basis is
// 4,062.46... riel per dollar, but the shop rate owes the same (nothing), so
// the shop rate is stored -- the R2 code stored the odd basis here.
const rounded = k.settleReplacementTender({ carriesDebt: true, cashUsd: 3.33, replacementUsd: 3.33, currency: 'KHR', refundUsd: 3.33, refundKhr: 13528, owedReductionUsd: 0, saleRate: 4062.5 })
assert.notEqual(rounded.paidFromRefundKhr / rounded.paidFromRefundUsd, 4062.5, 'CONTROL: the refund basis is not the shop rate here')
assert.deepEqual([rounded.replacementRate, owed(rounded, 3.33, 4062.5)], [4062.5, 0], 'it is recorded at the shop rate, owing nothing')
console.log('PASS E4: shop rate unless it would move the debt (X6 $2.3224 vs $2.30, X7 $0.0105 vs $0 at the shop rate)')
