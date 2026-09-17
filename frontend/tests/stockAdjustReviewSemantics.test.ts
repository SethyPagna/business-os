import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildStockAdjustQuantityReview, buildStockReceiptPaymentReview } from '../src/utils/stockAdjustReview.ts'

const tr = (_key: string, fallback: string) => fallback

assert.deepEqual(buildStockAdjustQuantityReview({
  type: 'add', quantity: 4, beforeQuantity: 5, unit: 'pcs', tr,
}), [{ label: 'Add quantity', value: '+4 pcs' }])

assert.deepEqual(buildStockAdjustQuantityReview({
  type: 'remove', quantity: 3, beforeQuantity: 5, unit: 'pcs', tr,
}), [{ label: 'Remove quantity', value: '−3 pcs' }])

assert.deepEqual(buildStockAdjustQuantityReview({
  type: 'set', quantity: 9, beforeQuantity: 5, unit: 'pcs', tr,
}), [
  { label: 'Set total quantity', value: '5 pcs → 9 pcs' },
  { label: 'Difference', value: '+4 pcs' },
])

assert.deepEqual(buildStockAdjustQuantityReview({
  type: 'set', quantity: 2, beforeQuantity: 5, unit: 'pcs', tr,
}), [
  { label: 'Set total quantity', value: '5 pcs → 2 pcs' },
  { label: 'Difference', value: '−3 pcs' },
])

assert.deepEqual(buildStockAdjustQuantityReview({
  type: 'set', quantity: 0, beforeQuantity: 0, unit: '', tr,
}), [
  { label: 'Set total quantity', value: '0 unit → 0 unit' },
  { label: 'Difference', value: '0 unit' },
])

const source = readFileSync(new URL('../src/components/products/forms/StockAdjustModal.tsx', import.meta.url), 'utf8')
assert.match(source, /setPendingAdjust\(\{ request: adjustmentRequest, beforeQuantity: currentQuantity \}\)/, 'the review freezes the authoritative branch quantity used by validation')
assert.match(source, /const adjustmentRequest = pendingAdjust\?\.request[\s\S]*?adjustStock\(adjustmentRequest\)/, 'display metadata never leaks into the inventory write payload')
assert.match(source, /const reqReason = String\(req\.reason \|\| ''\)\.trim\(\)[\s\S]*?items\.push\(\{ label: tr\('reason'/, 'the required reason remains visible in every confirmation')

// P10-19: "the date in the Not Yet Paid in add stock etc... are not
// working" -- verified against the live code and found no data-loss bug in
// the wire/state path (frontend field -> stockReceiptWire -> POST
// /api/inventory/adjust -> cloudflare/src/lib/productBatches.ts's
// receiveBatchStock -> product_batches.credit_due_date, and the read-back
// surfaces StockInSessionsSection.tsx/StockChangeSection.tsx display it
// correctly). The real, provable defect: every stock-receipt confirmation
// that commits a typed due date failed to show it back before writing --
// Inventory.tsx's own adjust flow used a BARE window.confirm() with no
// values at all (not even the quantity), ReceiveBatchModal.tsx's confirm
// baked the quantity/lot into an English sentence but never mentioned
// Payment/Due date, and StockAdjustModal.tsx's ConfirmDialog omitted the
// row entirely. A due date that is never reflected back before commit is
// indistinguishable, to the person who typed it, from one that "isn't
// working". These assertions pin the fix: the row exists, is gated on
// isStockIn (never shown for a remove/set-down), and all three owning
// files removed their bare native confirm for the adjust/receive flow.

assert.deepEqual(
  buildStockReceiptPaymentReview({ isStockIn: true, paymentStatus: 'credit', creditDueDate: '2026-09-30', tr }),
  [{ label: 'Payment', value: 'Not Yet Paid · 30/09/2026' }],
  'a Not Yet Paid receipt review shows the due date, day-first',
)
assert.deepEqual(
  buildStockReceiptPaymentReview({ isStockIn: true, paymentStatus: 'paid', creditDueDate: '', tr }),
  [{ label: 'Payment', value: 'Paid' }],
  'a Paid receipt review shows Paid with no due date',
)
assert.deepEqual(
  buildStockReceiptPaymentReview({ isStockIn: false, paymentStatus: 'paid', creditDueDate: '', tr }),
  [],
  'a remove/set-down carries no payment fact even though the form default is "paid" underneath',
)
assert.deepEqual(
  buildStockReceiptPaymentReview({ isStockIn: true, paymentStatus: null, creditDueDate: null, tr }),
  [],
  'an unset payment status (not on the wire at all) shows nothing rather than a false "Paid"',
)

const stockAdjustModalSource = source
assert.match(stockAdjustModalSource, /buildStockReceiptPaymentReview\(\{/, 'StockAdjustModal.tsx review includes the Payment/Due-date row')

const inventorySource = readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
assert.match(inventorySource, /buildStockReceiptPaymentReview\(\{/, 'Inventory.tsx review includes the Payment/Due-date row')
assert.doesNotMatch(inventorySource, /window\.confirm\(adjustConfirmLabel\)/, 'Inventory.tsx adjust no longer commits behind a bare native confirm')

const receiveBatchSource = readFileSync(new URL('../src/components/inventory/ReceiveBatchModal.tsx', import.meta.url), 'utf8')
assert.match(receiveBatchSource, /buildStockReceiptPaymentReview\(\{/, 'ReceiveBatchModal.tsx review includes the Payment/Due-date row')
assert.doesNotMatch(receiveBatchSource, /window\.confirm\(tr\(\s*\n\s*'confirm_receive_batch_details'/, 'ReceiveBatchModal.tsx receive no longer commits behind a bare native confirm')

console.log('PASS stock adjustment review uses action-specific signed quantities')
console.log('PASS P10-19: Payment/Due-date is shown in every stock-receipt confirmation before it commits')
