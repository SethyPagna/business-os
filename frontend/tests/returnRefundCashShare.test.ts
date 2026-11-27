// R40 review N7: the Returns form's "open a shift to give cash back" note must follow the Worker's cash share, not the total refund. A return first
// lowers what a Not Paid customer still owes and only the rest is cash (cloudflare returns.ts: cashRefundUsd = refund - owedReduction), so a refund
// larger than the debt hands cash back on a Not Paid sale (the Worker refuses it with no shift) while one inside the debt never does.
// Mutants killed (each turns one assertion red):
//   the note hides for every Not Paid sale again (the old rule)   -> "the modal shows the note for the cash share"
//   the debt is ignored on a Not Paid sale                         -> "a refund inside the debt hands back no cash"
//   the debt is subtracted on a paid sale (imported, no tender)    -> "a paid sale hands all of it back"
//   the debt is not capped at the refund (negative share)          -> "a refund inside the debt hands back no cash"
//   rounding drifts a cent                                         -> "the share is rounded like the Worker"
//   an unreadable debt shows nothing                               -> "an unreadable sale keeps the note"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { refundCashShareUsd } from '../src/components/sales/settlementCashShift.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

runTest('a refund inside the debt hands back no cash', () => {
  assert.equal(refundCashShareUsd(4, true, 10), 0)
  assert.equal(refundCashShareUsd(10, true, 10), 0)
  assert.equal(refundCashShareUsd(4, true, 0), 4, 'a Not Paid sale with nothing owed any more hands it all back')
})
runTest('a refund above the debt hands back the rest', () => {
  assert.equal(refundCashShareUsd(12.5, true, 10), 2.5)
  assert.equal(refundCashShareUsd(10.01, true, 10), 0.01)
})
runTest('the share is rounded like the Worker', () => {
  assert.equal(refundCashShareUsd(12.505, true, 10.004), 2.505, 'the debt is cents, the share four places')
  assert.equal(refundCashShareUsd(0.3, true, 0.1 + 0.2), 0, 'float noise does not make a phantom cent')
})
runTest('a paid sale hands all of it back', () => {
  assert.equal(refundCashShareUsd(7.25, false, 9), 7.25, 'an imported or counter-paid sale never carries a debt')
  assert.equal(refundCashShareUsd(7.25, false, 0), 7.25)
})
runTest('an unreadable sale keeps the note', () => {
  assert.equal(refundCashShareUsd(7.25, true, Number.NaN), 7.25)
  assert.equal(refundCashShareUsd(7.25, true, -3), 7.25)
  assert.equal(refundCashShareUsd(Number.NaN, true, 3), 0)
  assert.equal(refundCashShareUsd(0, false, 0), 0)
})
runTest('the modal shows the note for the cash share', () => {
  const modal = readFileSync(path.join(here, '..', 'src', 'components', 'returns', 'NewReturnModal.tsx'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(modal, /const refundCashUsd = foundSale \? refundCashShareUsd\(totalRefund, foundSale\.sale_status === 'awaiting_payment' \|\| returnOwedReductionUsd\(foundSale as ReceiptTotalsSale\) > 0, receiptTotalsFigures\(foundSale as ReceiptTotalsSale\)\.outstandingUsd\) : 0/)
  assert.match(modal, /\{replacements\.length === 0 && refundCashUsd > 0 \? \(\n\s+<CashOutShiftNote branchId=\{foundSale\?\.branch_id \? Number\(foundSale\.branch_id\) : null\} usd=\{refundCashUsd\}/)
  assert.ok(!modal.includes("foundSale?.sale_status !== 'awaiting_payment' ? ("), 'the Not Paid blanket hide is gone')
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
