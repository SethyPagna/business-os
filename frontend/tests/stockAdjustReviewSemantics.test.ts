import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildStockAdjustQuantityReview } from '../src/utils/stockAdjustReview.ts'

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

assert.deepEqual(buildStockAdjustQuantityReview({
  type: 'set', setScope: 'lot', batchLabel: '11/09/2026 · Supplier A', quantity: 9, beforeQuantity: 5, unit: 'pcs', tr,
}), [
  { label: 'Set quantity for', value: 'Selected received date' },
  { label: 'Selected received date', value: '11/09/2026 · Supplier A' },
  { label: 'Set received-date quantity', value: '5 pcs → 9 pcs' },
  { label: 'Difference', value: '+4 pcs' },
])

assert.deepEqual(buildStockAdjustQuantityReview({
  type: 'set', setScope: 'branch', batchLabel: '11/09/2026', quantity: 9, beforeQuantity: 5, unit: 'pcs', tr,
}), [
  { label: 'Set quantity for', value: 'Branch total' },
  { label: 'Selected received date', value: '11/09/2026' },
  { label: 'Set total quantity', value: '5 pcs → 9 pcs' },
  { label: 'Difference', value: '+4 pcs' },
])

const source = readFileSync(new URL('../src/components/products/forms/StockAdjustModal.tsx', import.meta.url), 'utf8')
assert.match(source, /setPendingAdjust\(\{\s*request: adjustmentRequest,\s*beforeQuantity: scopedSet && setScope === 'lot' \? selectedLotQuantity : currentQuantity,/, 'the review freezes the authoritative scoped quantity used by validation')
assert.match(source, /const adjustmentRequest = pendingAdjust\?\.request[\s\S]*?adjustStock\(adjustmentRequest\)/, 'display metadata never leaks into the inventory write payload')
assert.match(source, /const reqReason = String\(req\.reason \|\| ''\)\.trim\(\)[\s\S]*?items\.push\(\{ label: tr\('reason'/, 'the required reason remains visible in every confirmation')

console.log('PASS stock adjustment review uses action-specific signed quantities')
