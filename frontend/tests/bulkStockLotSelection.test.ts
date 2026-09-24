// Scoped Set and explicit received dates on the bulk and fast stock surfaces
// (owner, 17 Sep; confirmed 24 Sep: "Set Quantity: offer selected
// received-date lot or branch total; selected lot is the default").
// Ported from codex/existing-stock-lot-corrections-20260912 and adapted to
// today's files: the preview mirrors cloudflare/src/lib/stockLotAdjustment.ts
// (including the Part-77 branch floor on lot scope), Add keeps New, Remove and
// Set must name an existing lot, and a bulk Set is undone only through the
// Worker's history rows.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { bulkActionCanReceive, isBatchPickerVisible, isStockInSubmission, normalizeStockSetScope, scopedSetPreview } from '../src/utils/stockReceiptFields.ts'
import { isRevertibleStockMovement } from '../src/utils/stockMovementDetail.ts'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')
const bulk = read('../src/components/products/forms/BulkAddStockModal.tsx')
const products = read('../src/components/products/Products.tsx')
const fast = read('../src/components/inventory/FastStockInModal.tsx')
const modals = read('../src/components/inventory/InventoryStockModals.tsx')
const worker = read('../../cloudflare/src/lib/stockLotAdjustment.ts')

function test(name: string, run: () => void): void {
  try {
    run()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

test('scoped Set preview matches the Worker lot and branch arithmetic', () => {
  assert.deepEqual(
    scopedSetPreview({ scope: 'lot', targetQuantity: 7, lotQuantity: 3, branchQuantity: 20 }),
    { scope: 'lot', targetQuantity: 7, valid: true, delta: 4, beforeLotQuantity: 3, afterLotQuantity: 7, beforeBranchQuantity: 20, afterBranchQuantity: 24 },
  )
  assert.deepEqual(
    scopedSetPreview({ scope: 'branch', targetQuantity: 25, lotQuantity: 3, branchQuantity: 20 }),
    { scope: 'branch', targetQuantity: 25, valid: true, delta: 5, beforeLotQuantity: 3, afterLotQuantity: 8, beforeBranchQuantity: 20, afterBranchQuantity: 25 },
  )
  assert.equal(scopedSetPreview({ scope: 'branch', targetQuantity: 10, lotQuantity: 3, branchQuantity: 20 }).valid, false,
    'a branch-total Set cannot drain more than the selected lot holds')
  // Part-77 floor, as the Worker applies it: a drifted aggregate floors at 0.
  assert.equal(scopedSetPreview({ scope: 'lot', targetQuantity: 0, lotQuantity: 10, branchQuantity: 4 }).afterBranchQuantity, 0)
  assert.match(worker, /Math\.max\(0, before\.branchQuantity \+ lotDelta\)/, 'the Worker floors the same way')
  assert.equal(normalizeStockSetScope(undefined), 'lot', 'the selected received date is the default')
})

test('a scoped Set is a correction, never a receipt, and always shows the lot picker', () => {
  assert.equal(isStockInSubmission('set', 50, 1, 'lot'), false)
  assert.equal(isStockInSubmission('set', 50, 1, 'branch'), false)
  assert.equal(isStockInSubmission('set', 50, 1), true, 'CONTROL: the legacy unscoped Set above stock is still a receipt')
  assert.equal(isBatchPickerVisible({ type: 'set', quantity: 50, currentQuantity: 1, unlockPricing: false, branchId: 1, batchId: '', setScope: 'lot' }), true)
  assert.equal(isBatchPickerVisible({ type: 'set', quantity: 50, currentQuantity: 1, unlockPricing: false, branchId: 1, batchId: '' }), false,
    'CONTROL: a legacy set-up has no picker')
  assert.equal(bulkActionCanReceive('set'), false)
  assert.equal(bulkActionCanReceive('add'), true)
})

test('every bulk row names an action-appropriate received date', () => {
  assert.match(bulk, /getProductBatches\(productId, numericBranchId, action === 'remove'\)/, 'Remove asks for lots with stock; Add and Set ask for every lot')
  assert.match(bulk, /action === 'add'\s*\n?\s*\? \[\{ value: 'new'/, 'New is an Add-only choice')
  assert.match(bulk, /const missing = selectedProducts\.find/, 'no silent New/FIFO default for Remove and Set')
  assert.match(bulk, /lotErrors\[productId\][\s\S]*?role="alert"[\s\S]*?setLotReloadKey/, 'a lot lookup failure is distinct from an empty list and retryable')
  assert.match(bulk, /if \(action === 'set' && lot\) \{[\s\S]*?setScope, batchId: Number\(lot\.id\), expectedLotQuantity: Number\(lot\.quantity \|\| 0\)/)
  assert.match(bulk, /useState<StockSetScope>\('lot'\)/, 'selected-lot Set is the default')
})

test('a bulk Set or Remove is never redone as an add; server history is its undo', () => {
  assert.match(bulk, /action_history_id/)
  assert.match(bulk, /serverActionHistoryIds: \[\.\.\.historyIdsRef\.current\]/)
  assert.match(products, /if \(serverActionHistoryIds\.length\) await actionHistory\.refreshServerItems\(\)/)
  assert.match(products, /if \(action === 'add' && !serverActionHistoryIds\.length/)
  assert.match(products, /action === 'remove' \? 'Removed stock from' : action === 'set' \? 'Set stock for' : 'Added stock to'/)
})

test('fast stock-in: New only for Add, Remove only lots with stock, scoped Set wire', () => {
  assert.match(fast, /mode === 'remove' \? batchOptions\.filter\(\(batch\) => Number\(batch\.quantity\) > 0\) : batchOptions/)
  assert.match(fast, /\{mode === 'add' \? <button type="button"/)
  assert.match(fast, /if \(mode !== 'add' && !chosenOption\)/)
  assert.match(fast, /setScope: line\.setScope \|\| 'lot',\s*\n\s*batchId: typeof line\.batchChoice === 'number' \? line\.batchChoice : null,\s*\n\s*expectedLotQuantity: line\.expectedLotQuantity,/)
})

test('the tag choice is offered on a Set only once its preview lowers stock', () => {
  assert.match(modals, /adjustForm\.type === 'remove' \|\| adjustForm\.type === 'add' \|\| setLowersStock/)
  assert.match(fast, /mode !== 'set' \|\| fastSetLowers/)
})

test('history replays a scoped Set with its generation; the ledger never offers Revert', () => {
  // actionHistory.ts pulls runtime loaders, so its generation list is read as source.
  assert.match(read('../src/utils/actionHistory.ts'), /\|\| applier === 'stock\.quantity_set'/,
    'a scoped Set replays with expected_generation like every other generation-guarded applier')
  assert.equal(isRevertibleStockMovement('remove', 'stock-set:abc:0'), false)
  assert.equal(isRevertibleStockMovement('adjustment', 'stock-set:abc:2'), false)
  assert.equal(isRevertibleStockMovement('remove', null), true, 'CONTROL: a plain removal stays revertible')
})

console.log('PASS bulk stock lot selection contract')
