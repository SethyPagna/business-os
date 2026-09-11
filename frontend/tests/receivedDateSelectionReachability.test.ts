import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deriveProductSheetState } from '../src/components/pos/productSheetState.ts'
import { stagedAddLineKey, stagedLineFromSheetPick } from '../src/components/sales/saleAddLines.ts'
import type { SaleItemAddition } from '../src/api/salesTransport.ts'

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const shop = (quantity: number) => [{ branch_id: 2, branch_name: 'Shop', quantity }]

test('an indistinguishable merged group resolves to its in-stock row and exposes that row unlotted', () => {
  const rows = [
    { id: 4101, name: 'Same item', barcode: '', selling_price_usd: 5, branch_stock: shop(0) },
    { id: 4102, name: 'Same item', barcode: '', selling_price_usd: 5, branch_stock: shop(7) },
  ]
  const state = deriveProductSheetState({
    product: rows[0],
    variants: rows,
    groupProduct: true,
    trackedBatchProductIds: new Set([4101, 4102]),
    knownPositiveBatchQuantityByProduct: { 4101: 0, 4102: 0 },
    optionStepTitleFor: () => 'Option',
  })
  assert.equal(state.mergeRowsIntoLotList, true)
  assert.equal(state.effectiveVariant?.id, 4102, 'the hidden internal-id step must not strand the picker on Shop 0')
  assert.equal(state.branchOptions[0]?.quantity, 7, 'the merged branch pill reports reachable group stock')
  assert.deepEqual(state.unlottedStockOptions, [{ productId: 4102, quantity: 7 }])

  const selected = deriveProductSheetState({
    product: rows[0], variants: rows, groupProduct: true,
    trackedBatchProductIds: new Set([4101, 4102]),
    knownPositiveBatchQuantityByProduct: { 4101: 0, 4102: 0 },
    optionStepTitleFor: () => 'Option',
    selectedVariantId: '4102',
    selectedUnlottedProductId: 4102,
  })
  assert.equal(selected.pickAllowed, true)
  assert.equal(selected.selectedUnlottedProductId, 4102)
  assert.equal(selected.displayedStock, 7)
})

test('an explicit unlotted sale pick stays finite, distinct, and tied to its product and branch', () => {
  const product = { id: 4102, name: 'Same item', selling_price_usd: 5, branch_stock: shop(7) }
  const line = stagedLineFromSheetPick(product, {
    branchId: '2',
    batch: { unlottedStock: true, quantity: 7 },
  })
  assert.ok(line)
  assert.equal(line.productId, 4102)
  assert.equal(line.branchId, 2)
  assert.equal(line.unlottedStock, true)
  assert.equal(line.batchId, null, 'unlotted must never become Number(undefined)/NaN')
  assert.equal(Number.isNaN(line.batchId), false)
  assert.equal(line.stockQuantity, 7)
  assert.equal(stagedAddLineKey(line), '4102:2:unlotted')
})

test('a failed POS tracking lookup requires a source until successful metadata replaces it', () => {
  const product = { id: 4201, name: 'Unknown tracking state', branch_stock: shop(3) }
  const unknown = deriveProductSheetState({
    product,
    trackedBatchProductIds: new Set(),
    trackedBatchLookupUnavailable: true,
    knownPositiveBatchQuantityByProduct: {},
  })
  assert.equal(unknown.isBatchTracked, true)
  assert.equal(unknown.pickAllowed, false, 'no-lot add is refused while metadata is unavailable')

  const recovered = deriveProductSheetState({ product, trackedBatchProductIds: new Set() })
  assert.equal(recovered.isBatchTracked, false, 'a successful empty response restores genuine untracked behavior')
  assert.equal(recovered.pickAllowed, true)
})

test('a failed POS tracking lookup requires a stock source only until recovery', () => {
  const product = { id: 4201, name: 'Unknown tracking', branch_stock: shop(3) }
  const failed = deriveProductSheetState({
    product,
    trackedBatchProductIds: new Set(),
    trackedBatchLookupUnavailable: true,
    knownPositiveBatchQuantityByProduct: {},
  })
  assert.equal(failed.isBatchTracked, true)
  assert.equal(failed.pickBlockedReason, 'received_date')
  const recovered = deriveProductSheetState({
    product,
    trackedBatchProductIds: new Set(),
    trackedBatchLookupUnavailable: false,
  })
  assert.equal(recovered.isBatchTracked, false, 'a successful empty result restores normal untracked behavior')
  assert.equal(recovered.pickAllowed, true)
})

test('Sale Add Items preserves unlotted_stock and fails tracking lookup loudly', () => {
  const payload = { product_id: 4102, quantity: 1, branch_id: 2, unlotted_stock: true } satisfies SaleItemAddition
  assert.equal(payload.unlotted_stock, true)
  const modal = readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
  const transport = readFileSync(new URL('../src/api/salesTransport.ts', import.meta.url), 'utf8')
  assert.match(modal, /\.\.\.\(line\.unlottedStock \? \{ unlotted_stock: true \} : \{\}\)/)
  assert.match(transport, /unlotted_stock\?: boolean/)
  assert.match(modal, /trackedBatchLookupState === 'failed'/)
  assert.match(modal, /setTrackedBatchReloadKey\(\(key\) => key \+ 1\)/)
  assert.match(modal, /trackedBatchProductIds=\{trackedIdsForAddSheet\}/)
})

test('zero-quantity regular and damaged lots are native-disabled and aria-disabled', () => {
  const sheet = readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8')
  assert.equal((sheet.match(/\n\s+disabled=\{batchOut\}/g) || []).length, 2)
  assert.equal((sheet.match(/aria-disabled=\{batchOut\}/g) || []).length, 2)
  assert.ok((sheet.match(/disabled=\{Number\(lot\.quantity_remaining \|\| 0\) <= 0\}/g) || []).length >= 2)
  assert.match(sheet, /role="alert"[\s\S]*setBatchesReloadKey/)
})

if (failed) process.exit(1)
console.log('received-date reachability tests passed')
