// RET-A F1 (owner rule 29 Sep 2026, confirmed 5 Oct): a return on a Not Paid
// sale lowers the debt. The sale's money column measures the payment against
// the total less that debt (the settlement editor asks only for the rest), and
// the sale carries a "Returned · debt lowered $X" tag beside its status in the
// list (table and card) and in the detail header, in both languages.
//
// Run: node tests/saleDebtLoweredTag.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { receiptTotalsFigures } from '../src/utils/receiptTotals.ts'

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

const sale = (extra: Record<string, unknown>) => ({
  money_precision_version: 1, calculated_total_usd: 20, rounding_adjustment_usd: 0,
  subtotal_usd: 20, total_usd: 20, exchange_rate: 4000, amount_paid_usd: 5, amount_paid_khr: 0,
  sale_status: 'awaiting_payment', ...extra,
})

const lowered = receiptTotalsFigures(sale({ return_owed_reduction_usd: 10, refund_usd: 10 }) as never)
assert.equal(lowered.debtLoweredUsd, 10)
assert.equal(lowered.payableUsd, 10, 'the payment is measured against the total less the lowered debt')
assert.equal(lowered.outstandingUsd, 5, 'a $20 sale paid $5 whose return lowered the debt by $10 still owes $5')
const plain = receiptTotalsFigures(sale({}) as never)
assert.equal(plain.debtLoweredUsd, 0)
assert.equal(plain.payableUsd, 20)
assert.equal(plain.outstandingUsd, 15, 'control: without a lowered debt the sale owes total less paid')
console.log('PASS what a sale owes and what settling it asks for subtract the debt its returns lowered')

const detail = read('src/components/sales/SaleDetailModal.tsx')
assert.match(detail, /totalUsd=\{totals\.payableUsd\}/, 'the settlement editor asks for the payable amount, not the gross total')
assert.match(detail, /settlementOutstandingUsd\(settlementRows, \{ totalUsd: totals\.payableUsd,/, 'the pre-submit check uses the same payable amount')
assert.match(detail, /<StatusBadge status=\{currentStatus\} t=\{t\} \/>\s*<DebtLoweredTag amountUsd=\{totals\.debtLoweredUsd\}/, 'the detail header shows the tag beside the status')
const list = read('src/components/sales/SalesListSurface.tsx')
assert.equal((list.match(/<DebtLoweredTag amountUsd=\{sale\.return_owed_reduction_usd\}/g) || []).length, 2, 'the table row and the phone card both show the tag')
const badge = read('src/components/sales/StatusBadge.tsx')
assert.match(badge, /export function DebtLoweredTag/, 'one shared tag component next to StatusBadge')
assert.match(badge, /if \(!Number\.isFinite\(amount\) \|\| amount <= 0\) return null/, 'no tag when no debt was lowered')
console.log('PASS the tag and the payable amount are wired into the list, the card and the detail')

assert.ok(en.sale_tag_debt_lowered?.includes('{amount}') && km.sale_tag_debt_lowered?.includes('{amount}'), 'both packs carry the tag with its amount')
assert.match(km.sale_tag_debt_lowered, /ជំពាក់/, 'the Khmer tag speaks of the debt')
console.log('PASS the tag is translated in both packs')
