'use strict'
// The shift cash reader and a riel over-tender under one 100-riel note (owner ruling, 27 Oct 2026: no note exists below 100 riel, so
// nothing can be handed back, and a riel payment short by under 100 riel is fully paid). Lane MONEY-1 review fix B1, 4 Nov 2026.
//
// summarizeShiftCashDetail (lib/shiftReconciliation.ts) is the pure reader behind the drawer comparison. The till posts the COMPUTED
// change unmarked (change_is_actual 0) unless the cashier states it, and an unmarked non-zero change is "unknown" -- flagged
// change_ambiguous. A riel tender over the total by under one note (40,000 riel on a $9.99 = 39,960 sale: 40 over) has a computed change
// of 40 riel that nobody could have handed back, so it is no longer an unknown amount of change; a larger over-tender still is, a USD
// over-tender still is, and a stated change is judged as before.
// DISCRIMINATING: each row names the plausible wrong implementation it separates (always flag / never flag / ignore the marker).
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'lib', 'shiftReconciliation.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent',
  external: ['cloudflare:*', 'node:*'],
})
// SUBNOTE_MUTATION=reader_flag_restored runs the reader with the sub-note exemption removed (the wrong implementation): rows 1-3 must go red.
let text = out.outputFiles[0].text
if (process.env.SUBNOTE_MUTATION === 'reader_flag_restored') {
  const exempt = 'change.kind === "unknown" && !(underOneRielNote && unmarkedChange)'
  assert.ok(text.includes(exempt), 'the mutation anchor is present')
  text = text.replace(exempt, () => 'change.kind === "unknown"')
}
const loaded = { exports: {} }
new Function('require', 'module', 'exports', text)(require, loaded, loaded.exports)
const { summarizeShiftCashDetail } = loaded.exports

const RATE = 4000
const sale = (over = {}) => ({
  sale_status: 'completed', total_usd: 9.99, exchange_rate: RATE,
  payment_method: 'Cash', payment_details: [{ method: 'Cash', amount_usd: 0, amount_khr: 40000 }],
  amount_paid_usd: 0, amount_paid_khr: 40000, change_usd: 0.01, change_khr: 40, change_is_actual: 0, change_exchange_rate: null, ...over,
})
const verdict = (row) => { const r = summarizeShiftCashDetail([row]); return { review: r.needsReview, codes: r.reviewCodes, khr: r.khr } }

// 1. The case the review found: 40 riel over, computed change, unmarked.
assert.deepEqual(verdict(sale()), { review: false, codes: [], khr: 40000 }, '40,000 riel on $9.99 (40 over) raises no flag; the drawer holds the 40,000')
// 2. The same over-tender on a $3.01 sale (12,040): 12,100 riel is 60 over.
assert.deepEqual(verdict(sale({ total_usd: 3.01, payment_details: [{ method: 'Cash', amount_usd: 0, amount_khr: 12100 }], amount_paid_khr: 12100, change_usd: 0.01, change_khr: 60 })),
  { review: false, codes: [], khr: 12100 }, '12,100 riel on $3.01 (60 over) raises no flag')
// 3. 99 over is still under one note; 100 over is not.
const over = (khrOver) => sale({ payment_details: [{ method: 'Cash', amount_usd: 0, amount_khr: 39960 + khrOver }], amount_paid_khr: 39960 + khrOver, change_usd: 0.02, change_khr: khrOver })
assert.equal(verdict(over(99)).review, false, '99 riel over: no note to hand back')
assert.deepEqual(verdict(over(100)).codes, ['change_ambiguous', 'tender_incomplete'], '100 riel over is a whole note nobody stated change for: flagged (wrong implementation: a looser threshold)')
assert.deepEqual(verdict(over(10040)).codes, ['change_ambiguous', 'tender_incomplete'], 'a real over-tender is still flagged')
// 4. A shortfall is not an over-tender: 39,900 on $9.99 owes nothing here and raises nothing.
assert.deepEqual(verdict(sale({ payment_details: [{ method: 'Cash', amount_usd: 0, amount_khr: 39900 }], amount_paid_khr: 39900, change_usd: 0, change_khr: 0 })), { review: false, codes: [], khr: 39900 })
// 5. A USD over-tender is not a riel one: $10 on $9.99 leaves one cent of unmarked change, which stays flagged (the rule is about riel notes).
assert.equal(verdict(sale({ payment_details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], amount_paid_usd: 10, amount_paid_khr: 0, change_usd: 0.01, change_khr: 0 })).review, true,
  'a USD over-tender with unmarked change is still ambiguous (wrong implementation: exempting every small change)')
// 6. Only an unmarked change is exempt. A stated change (marker 1) is subtracted as before, and a corrupt marker stays unknown.
const stated = verdict(sale({ change_is_actual: 1, change_usd: 0, change_khr: 0, change_exchange_rate: RATE }))
assert.deepEqual(stated, { review: false, codes: [], khr: 40000 }, 'a stated change of zero reconciles')
assert.equal(verdict(sale({ change_is_actual: 2 })).review, true, 'a corrupt change marker is not the sub-note exemption (wrong implementation: ignoring the marker)')
// 7. A non-cash riel over-tender is digital money: it never reaches the drawer and the 40 riel raises nothing either.
const bank = summarizeShiftCashDetail([sale({ payment_method: 'ABA', payment_details: [{ method: 'ABA', amount_usd: 0, amount_khr: 40000 }] })])
assert.deepEqual([bank.needsReview, bank.khr, bank.digital.khr], [false, 0, 40000])

console.log('PASS shift cash reader: a riel over-tender under one 100-riel note raises no review flag; larger, USD and corrupt-marker cases still do')
