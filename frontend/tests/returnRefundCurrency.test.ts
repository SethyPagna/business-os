// RET-A Q2 (owner, 6 Oct 2026): the Return screen gets the $ / riel refund
// choice the Worker already records (owner rule 29 Sep: a refund records the
// currency it was paid in, $ by default). A compact two-button control on the
// review step; both submit paths (legacy and net-refund v1) carry the choice;
// dollars add no key, exactly as the Worker's canonical intent leaves it out,
// so a dollar refund's body and idempotency digest are unchanged.
//
// Run: node tests/returnRefundCurrency.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { REFUND_CURRENCY_CHOICES, refundCurrencyField } from '../src/components/returns/helpers/refundCurrency.ts'

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const modal = read('src/components/returns/NewReturnModal.tsx')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
const worker = read('../cloudflare/src/lib/returnCreateAction.ts')
const tender = read('../cloudflare/src/lib/refundTender.ts')

assert.deepEqual(refundCurrencyField('USD'), {}, 'dollars add no key')
assert.deepEqual(refundCurrencyField('KHR'), { refund_currency: 'KHR' })
assert.deepEqual(REFUND_CURRENCY_CHOICES.map((choice) => [choice.value, choice.symbol]), [['USD', '$'], ['KHR', '៛']])
// The Worker side of the same contract: USD is the default and adds no key.
assert.match(tender, /DEFAULT_REFUND_CURRENCY[^\n]*'USD'/)
assert.match(worker, /parseRefundCurrency\(body\.refund_currency\) === DEFAULT_REFUND_CURRENCY \? \{\} : \{ refund_currency: 'KHR' \}/)
console.log('PASS the request field matches the Worker: riel adds refund_currency, dollars add nothing')

for (const key of ['return_refund_paid_in', ...REFUND_CURRENCY_CHOICES.map((choice) => choice.labelKey)]) {
  assert.ok(en[key] && km[key], `${key} is in both packs`)
  assert.notEqual(km[key], en[key], `${key} is translated`)
}
console.log('PASS the label and both tooltips are in EN and KM')

assert.match(modal, /useState<RefundCurrency>\('USD'\)/, 'dollars by default')
assert.equal(modal.split('...refundCurrencyField(refundCurrency),').length - 1, 2, 'the legacy and the net-refund (v1) submit both carry the choice')
const control = modal.slice(modal.indexOf('data-refund-currency=""'), modal.indexOf('data-refund-currency=""') + 2200)
assert.ok(control.includes('role="group"') && control.includes('aria-pressed={refundCurrency === choice.value}'), 'a two-state group with pressed state')
assert.ok(control.includes('title={T(choice.labelKey, choice.labelEn)}') && control.includes('aria-label={T(choice.labelKey, choice.labelEn)}'),
  'symbol buttons carry a translated tooltip and label (button policy: icon-only with tooltip)')
// RET-A verifier P2: the screen shows what the till hands out, never the full
// refund total as riel (the owner example lowers the debt and pays out nothing).
assert.ok(!modal.includes('Math.round(totalRefundKhr).toLocaleString()') && !modal.includes("refundCurrency === 'KHR' && totalRefundKhr > 0"),
  'the full refund total is never shown as the riel paid out')
const split = modal.slice(modal.indexOf('data-refund-split=""'), modal.indexOf('data-refund-split=""') + 1600)
assert.ok(modal.includes('transport.previewReturnSplit(') && split.length > 0, 'the review step reads the Worker split')
assert.ok(split.includes("T('return_split_lowers_debt', 'Lowers debt')") && split.includes('refundPreview.owed_reduction_usd'), 'it names the debt lowered')
assert.ok(split.includes("T('return_split_pay_out', 'Pay out')") && split.includes('refundPreview.payout_usd') && split.includes('refundPreview.payout_khr'),
  'it names the cash paid out and, for riel, the riel paid out')
assert.ok(split.includes('refundPreview.replacement_follows_debt'), 'an exchange on a debt sale says how the replacement is paid')
for (const key of ['return_split_lowers_debt', 'return_split_pay_out', 'return_split_replacement_from_refund', 'return_split_replacement_owed']) {
  assert.ok(en[key] && km[key] && en[key] !== km[key], `${key} is in both packs, translated`)
}
const transport = read('src/api/returnsTransport.ts')
assert.ok(transport.includes("apiFetch('POST', '/api/returns/split-preview', input)"), 'the transport calls the Worker split')
assert.ok(modal.indexOf('data-refund-currency=""') > modal.indexOf("{T('total_refunded','Total Refund')}"), 'it sits under the refund total on the review step')
console.log('PASS the review step offers $ / riel under the refund total, $ by default, and shows debt lowered and the real payout')
