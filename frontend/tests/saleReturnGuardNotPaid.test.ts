// Owner rule 29 Sep 2026 (SCAN2 U11): a Not Paid sale can be returned like a
// Completed one, and the Return action says in one line what that does -- the
// return lowers what the customer owes before any cash is refunded.
//
// Run: node tests/saleReturnGuardNotPaid.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { getSaleReturnBlockReason, getSaleReturnNote } from '../src/utils/saleReturnGuard.ts'

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

const line = (quantity: number, returned = 0) => ({ quantity, returned_quantity: returned })

assert.equal(getSaleReturnBlockReason({ sale_status: 'awaiting_payment', items: [line(2)] }), '', 'a Not Paid sale can be returned')
assert.equal(getSaleReturnNote({ sale_status: 'awaiting_payment', items: [line(2)] }), 'lowers_debt')
assert.equal(getSaleReturnNote({ sale_status: 'awaiting_payment', items: [line(2, 1)] }), 'lowers_debt', 'a partly returned Not Paid sale still owes')
assert.equal(getSaleReturnNote({ sale_status: 'completed', items: [line(2)] }), '', 'a paid sale refunds in cash as before')
assert.equal(getSaleReturnNote({ sale_status: 'partial_return', items: [line(2, 1)] }), '')
assert.equal(getSaleReturnNote({ sale_status: 'awaiting_payment', items: [line(2, 2)] }), '', 'nothing left to return: the block reason speaks instead')
assert.equal(getSaleReturnNote({ sale_status: 'cancelled', items: [line(2)] }), '')
assert.equal(getSaleReturnNote(null), '')
console.log('PASS the guard allows Not Paid sales and names their effect')

assert.ok(en.return_not_paid_lowers_debt && km.return_not_paid_lowers_debt, 'the note exists in both language packs')
assert.ok(en.return_not_paid_lowers_debt.split(/\s+/).length <= 18, 'the note is one short line')
assert.match(km.return_not_paid_lowers_debt, /ជំពាក់/, 'the Khmer note speaks of what is owed')
console.log('PASS the note is translated in both packs')

for (const [file, source] of [
  ['SaleDetailModal.tsx', read('src/components/sales/SaleDetailModal.tsx')],
  ['Sales.tsx', read('src/components/sales/Sales.tsx')],
  ['NewReturnModal.tsx', read('src/components/returns/NewReturnModal.tsx')],
] as const) {
  assert.match(source, /getSaleReturnNote\(/, `${file} asks the shared guard for the Not Paid note`)
  assert.match(source, /return_not_paid_lowers_debt/, `${file} shows the translated note`)
}
console.log('PASS every surface that starts a return shows the note')
