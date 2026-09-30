// Scoped Set and explicit received dates on the bulk and fast stock surfaces
// (owner, 17 Sep; confirmed 24 Sep: "Set Quantity: offer selected
// received-date lot or branch total; selected lot is the default").
// Ported from codex/existing-stock-lot-corrections-20260912 and adapted to
// today's files: the preview mirrors cloudflare/src/lib/stockLotAdjustment.ts
// (including the Part-77 branch floor on lot scope), Add keeps New, Remove and
// Set must name an existing lot, and a bulk Set is undone only through the
// Worker's history rows.
// Since 30 Sep 2026 the bulk panel queues its products as Items in the Stock
// Session, so BulkAddStockModal's per-row lot pickers and the page's client
// redo are retired; the session applies the same lot rules to every line.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { bulkActionCanReceive, isBatchPickerVisible, isStockInSubmission, normalizeStockSetScope, scopedSetPreview } from '../src/utils/stockReceiptFields.ts'
import { isRevertibleStockMovement } from '../src/utils/stockMovementDetail.ts'
import { buildStockLineRequest, sessionLotChoices, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const products = read('../src/components/products/Products.tsx')
const fast = read('../src/components/inventory/FastStockInModal.tsx')
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

test('the bulk panel hands the session its products; the page keeps no client stock redo', () => {
  assert.match(products, /const openBulkStockSession = \(\) => \{/)
  assert.match(products, /if \(lines\.length\) setStockSession\(\{ mode, lines \}\)/)
  // A client redo closure re-adds on redo, which is wrong for a Remove or a Set.
  assert.doesNotMatch(products, /BulkAddStockModal|addStockToProducts/)
})

const lots = [
  { id: 1, quantity: 0, received_at: '2026-08-01' },
  { id: 2, quantity: 5, received_at: '2026-09-01' },
  { id: 3, quantity: 2, received_at: '2026-07-01' },
]
const anySupplier = { supplierId: null, supplierName: '' }

test('session: New only for Add, Remove only lots with stock, Set every lot', () => {
  assert.deepEqual(sessionLotChoices('remove', lots, anySupplier).map((lot) => lot.id), [3, 2], 'Remove offers only lots holding stock, oldest first')
  assert.deepEqual(sessionLotChoices('set', lots, anySupplier).map((lot) => lot.id), [3, 1, 2], 'Set may correct an emptied lot')
  assert.match(fast, /if \(mode === 'add'\) return \[\{ value: 'new', label: newLabel \}, \.\.\.batchOptions\.map\(lotRow\)\]/, 'New is an Add-only choice')
})

test('session: a scoped Set names its lot and the count it read', () => {
  const line = {
    key: 'k', requestId: 'r', product: { id: 9, name: 'Serum' }, productName: 'Serum', mode: 'set', quantity: 7, freeQuantity: 0,
    unitCost: '', sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice: 2, batchLabel: '', expectedLotQuantity: 5,
    reason: '', conditionTag: '', createdProduct: false, status: 'queued', detail: '',
  } as unknown as StockSessionLine
  const ctx = { branchId: '1', receivedDate: '2026-09-30', supplier: anySupplier, paymentStatus: 'paid' as const, creditDueDate: '', sessionId: 1, canEditPrice: false, reasonFor: () => 'Count' }
  const body = buildStockLineRequest(line, ctx).body as Record<string, unknown>
  assert.deepEqual([body.type, body.setScope, body.batchId, body.expectedLotQuantity], ['set', 'lot', 2, 5])
  const branchTotal = buildStockLineRequest({ ...line, batchChoice: 'none' }, ctx).body as Record<string, unknown>
  assert.equal(Object.hasOwn(branchTotal, 'setScope'), false, 'CONTROL: with no dated lot the Set is the branch total')
})

test('the tag choice is offered on a Set only once its preview lowers stock', () => {
  assert.match(fast, /tagDisabled=\{mode === 'set' && !setLowers\}/)
  assert.match(fast, /conditionTag: mode === 'set' && !setLowers \? '' : conditionTag/)
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
