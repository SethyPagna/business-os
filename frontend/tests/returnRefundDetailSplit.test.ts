// RET-A (verifier, 6 Oct 2026): the return detail shows the currency the
// refund was paid in and the part that lowered a Not Paid sale's debt, in both
// packs. A refund recorded before 0234 (no currency) keeps its old rows.
// The riel paid out is the Worker's own figure (refundTender.ts refundCashKhr,
// the drawer's REFUND_DRAWER_KHR_SQL), held equal here on the same inputs.
//
// Run: node tests/returnRefundDetailSplit.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { recordedRefundSplit } from '../src/components/returns/helpers/refundCurrency.ts'
import { refundCashKhr, refundOutcome } from '../../cloudflare/src/lib/refundTender.ts'

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
const modal = read('src/components/returns/ReturnDetailModal.tsx')

// Owner example: $10 Not Paid, $4 back -> lowers the debt, pays out nothing.
assert.deepEqual(recordedRefundSplit({ refund_currency: 'USD', total_refund_usd: 4, total_refund_khr: 16000, owed_reduction_usd: 4 }),
  { currency: 'USD', loweredUsd: 4, toReplacementUsd: 0, toReplacementKhr: 0, payoutUsd: 0, payoutKhr: 0 })
// $7 paid of $10, $4 back in riel: $3 lowers the debt, $1 = 4,000 riel paid out.
assert.deepEqual(recordedRefundSplit({ refund_currency: 'KHR', total_refund_usd: 4, total_refund_khr: 16000, owed_reduction_usd: 3 }),
  { currency: 'KHR', loweredUsd: 3, toReplacementUsd: 0, toReplacementKhr: 0, payoutUsd: 1, payoutKhr: 4000 })
assert.deepEqual(recordedRefundSplit({ refund_currency: 'USD', total_refund_usd: '4.50', total_refund_khr: 18000, owed_reduction_usd: 0 }),
  { currency: 'USD', loweredUsd: 0, toReplacementUsd: 0, toReplacementKhr: 0, payoutUsd: 4.5, payoutKhr: 0 })
assert.equal(recordedRefundSplit({ refund_currency: null, total_refund_usd: 4, total_refund_khr: 16000 }), null, 'recorded before 0234: no split')
assert.equal(recordedRefundSplit({ refund_currency: 'khr', total_refund_usd: 4 }), null, 'only the stored codes')
for (const [usd, khr, lowered] of [[4, 16000, 3], [9.99, 40959, 2.5], [1, 4100, 0], [3, 12000, 3]] as const) {
  const split = recordedRefundSplit({ refund_currency: 'KHR', total_refund_usd: usd, total_refund_khr: khr, owed_reduction_usd: lowered })!
  assert.equal(split.payoutKhr, refundCashKhr(khr, split.payoutUsd, usd), `riel paid out equals the Worker's (${usd}, ${khr}, ${lowered})`)
}
console.log('PASS the recorded split names the debt lowered and the cash paid out in its own currency, as the Worker reads it')

// RET-A verify R2: an exchange whose refund cash paid the replacement. The
// till paid out only the rest -- never "Paid out $1" when it handed back $0.
assert.deepEqual(recordedRefundSplit({ refund_currency: 'USD', total_refund_usd: 4, total_refund_khr: 16000, owed_reduction_usd: 3, to_replacement_usd: 1, to_replacement_khr: 0 }),
  { currency: 'USD', loweredUsd: 3, toReplacementUsd: 1, toReplacementKhr: 0, payoutUsd: 0, payoutKhr: 0 })
const rielSwap = recordedRefundSplit({ refund_currency: 'KHR', total_refund_usd: 4, total_refund_khr: 15500, owed_reduction_usd: 3, to_replacement_usd: 0.5, to_replacement_khr: 1938 })!
assert.deepEqual(rielSwap, { currency: 'KHR', loweredUsd: 3, toReplacementUsd: 0.5, toReplacementKhr: 1938, payoutUsd: 0.5, payoutKhr: 1937 },
  'riel: the 3,875-riel cash leg less the 1,938 riel that paid the replacement is the 1,937 the drawer paid out')
assert.equal(rielSwap.payoutKhr + rielSwap.toReplacementKhr, refundCashKhr(15500, 1, 4), 'the two parts add up to the drawer\'s riel cash leg')
const worker = refundOutcome({ refund_currency: 'KHR', total_refund_usd: 4, total_refund_khr: 15500, owed_reduction_usd: 3, to_replacement_usd: 0.5, to_replacement_khr: 1938 })
assert.deepEqual([worker.payoutUsd, worker.payoutKhr, worker.toReplacementUsd, worker.toReplacementKhr], [rielSwap.payoutUsd, rielSwap.payoutKhr, rielSwap.toReplacementUsd, rielSwap.toReplacementKhr],
  'the detail and the Worker (Telegram) read the same outcome')
const swapRows = modal.slice(modal.indexOf('const split = recordedRefundSplit(ret)'), modal.indexOf('</tfoot>'))
assert.ok(swapRows.includes('data-return-to-replacement') && swapRows.includes("tr('return_refund_to_replacement', 'To replacement')")
  && swapRows.includes('split.toReplacementUsd > 0'), 'the detail names the part that paid the replacement, only when there is one')
assert.ok(en.return_refund_to_replacement && km.return_refund_to_replacement && en.return_refund_to_replacement !== km.return_refund_to_replacement,
  'return_refund_to_replacement is in both packs, translated')
console.log('PASS an exchange shows To replacement apart from Paid out, in EN and KM, as the Worker reads it')

const tfoot = modal.slice(modal.indexOf('const split = recordedRefundSplit(ret)'), modal.indexOf('</tfoot>'))
assert.ok(tfoot.includes('data-return-debt-lowered') && tfoot.includes("tr('return_debt_lowered', 'Debt lowered')") && tfoot.includes('split.loweredUsd > 0'),
  'the detail shows the debt lowered, only when there is some')
assert.ok(tfoot.includes('data-return-paid-out') && tfoot.includes("tr('return_paid_out', 'Paid out')")
  && tfoot.includes("split.currency === 'KHR' ? fmtKHR(split.payoutKhr) : fmtUSD(split.payoutUsd)"), 'the cash paid out, in the currency it was paid in')
assert.ok(tfoot.includes("split?.currency !== 'USD' && isPositiveMoney(ret.total_refund_khr)"), 'a dollar refund prints no riel equivalent under its total')
for (const key of ['return_debt_lowered', 'return_paid_out']) {
  assert.ok(en[key] && km[key] && en[key] !== km[key], `${key} is in both packs, translated`)
}
console.log('PASS the return detail shows Debt lowered and Paid out ($ or ៛) in EN and KM')
