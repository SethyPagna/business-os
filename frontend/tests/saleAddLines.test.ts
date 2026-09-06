// Behavioural cover for staging an "add items to this sale" line from the
// SHARED POS sheet's pick.
//
// The add-items flow used to answer "which lot / how many / what price" in a
// second, private modal (SaleDetailProductPicker.tsx) that the POS has never
// rendered. These tests evaluate the rule the shared sheet's pick now feeds,
// on inputs where the private picker and this module disagree:
//
//  * the staged line's stock cap. The picker read the product-level
//    `stock_quantity` -- a CROSS-BRANCH total. A product with 2 at the shop
//    and 30 at the warehouse therefore staged with a cap of 32 at the shop,
//    the local "not enough stock" guard stayed silent, and the Worker
//    refused the write after the operator had already confirmed it.
//  * the received date. The sheet was never handed trackedBatchProductIds,
//    so its own lot step could not appear and every pick came back with no
//    batch at all; the private modal asked the question again with its own
//    list. A pick that carries a lot must land on the line.
import assert from 'node:assert/strict'
import {
  mergeStagedAddLine,
  stagedAddLineKey,
  stagedLineFromSheetPick,
  type SaleAddCandidate,
  type StagedAddLine,
} from '../src/components/sales/saleAddLines.ts'

let failed = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// Two canonical branches, as the server ships them on every product row
// (routes/products.ts attachBranchStock: one entry per ACTIVE branch,
// 0-filled, with branch_name).
const shopAndWarehouse: SaleAddCandidate = {
  id: 7321,
  name: 'Milk 1L',
  __displayName: 'Milk 1L',
  barcode: '8850001',
  selling_price_usd: 1.25,
  stock_quantity: 32,
  branch_stock: [
    { branch_id: 1, branch_name: 'shop', quantity: 2 },
    { branch_id: 2, branch_name: 'warehouse', quantity: 30 },
  ],
}

runTest('the staged cap is the branch the sheet was read at, not the cross-branch total', () => {
  const line = stagedLineFromSheetPick(shopAndWarehouse, { branchId: '1' })
  assert.ok(line)
  assert.equal(line.branchId, 1)
  // 32 is what the private picker staged here, and it is the number that let
  // "add 5" through to a Worker that only had 2 on that shelf. Asserted
  // against BOTH rules on this one input, so the case is provably
  // discriminating rather than merely green.
  const previousRule = Number(shopAndWarehouse.stock_quantity)
  assert.equal(previousRule, 32, 'the cross-branch total the old rule used')
  assert.equal(line.stockQuantity, 2)
  assert.notEqual(line.stockQuantity, previousRule)
  assert.equal(line.batchId, null)
  assert.equal(line.batchQuantity, null)
})

runTest('a row with no branch_stock entry for that branch falls back to its own quantity', () => {
  const flat: SaleAddCandidate = { id: 90, name: 'Loose item', selling_price_usd: 3, stock_quantity: 11 }
  const line = stagedLineFromSheetPick(flat, { branchId: '1' })
  assert.ok(line)
  assert.equal(line.stockQuantity, 11)
})

runTest('a branchless pick on a stock-skipped sale stages with no branch', () => {
  const line = stagedLineFromSheetPick(shopAndWarehouse, { branchId: null })
  assert.ok(line)
  assert.equal(line.branchId, null)
  assert.equal(line.stockQuantity, 32, 'with no branch resolved the row total is all there is')
})

runTest('the received date the sheet picked lands on the line, whole', () => {
  const line = stagedLineFromSheetPick(shopAndWarehouse, {
    branchId: '1',
    batch: {
      batchId: 501,
      batchLabel: 'Batch 2: 09/01/2026',
      batchExpiryDate: '2027-01-01',
      batchReceivedAt: '2026-09-01T00:00:00Z',
      quantity: 4,
    },
  })
  assert.ok(line)
  assert.equal(line.batchId, 501)
  assert.equal(line.batchLabel, 'Batch 2: 09/01/2026')
  assert.equal(line.batchExpiryDate, '2027-01-01')
  assert.equal(line.batchReceivedAt, '2026-09-01T00:00:00Z')
  assert.equal(line.batchQuantity, 4)
  // A lot narrows the cap: a batch-tracked line may only take what that lot
  // holds, never the branch's whole shelf.
  assert.equal(line.stockQuantity, 4)
})

runTest('a pick adds one unit at the row price, POS-style', () => {
  const line = stagedLineFromSheetPick(shopAndWarehouse, { branchId: '1' })
  assert.ok(line)
  assert.equal(line.quantity, 1)
  assert.equal(line.unitPriceUsd, 1.25)
  assert.equal(line.priceText, '1.25')
  assert.equal(line.name, 'Milk 1L')
  assert.equal(line.barcode, '8850001')
})

runTest('a zero-priced row stages a typable 0 rather than an empty box', () => {
  const line = stagedLineFromSheetPick({ id: 5, name: 'Sample', selling_price_usd: 0 }, { branchId: null })
  assert.ok(line)
  assert.equal(line.unitPriceUsd, 0)
  assert.equal(line.priceText, '0')
})

runTest('a row with no usable id stages nothing', () => {
  assert.equal(stagedLineFromSheetPick({ id: null, name: 'x' }, { branchId: '1' }), null)
  assert.equal(stagedLineFromSheetPick({ id: 0, name: 'x' }, { branchId: '1' }), null)
  assert.equal(stagedLineFromSheetPick({ id: 'abc', name: 'x' }, { branchId: '1' }), null)
})

runTest('picking the same product+branch+lot twice adds a unit instead of a row', () => {
  const first = stagedLineFromSheetPick(shopAndWarehouse, { branchId: '1' })
  assert.ok(first)
  const staged = mergeStagedAddLine([], first)
  assert.equal(staged.length, 1)
  const again = stagedLineFromSheetPick(shopAndWarehouse, { branchId: '1' })
  assert.ok(again)
  const twice = mergeStagedAddLine(staged, again)
  assert.equal(twice.length, 1)
  assert.equal(twice[0].quantity, 2)
})

runTest('a price typed on the staged row survives the next pick of the same line', () => {
  const first = stagedLineFromSheetPick(shopAndWarehouse, { branchId: '1' })
  assert.ok(first)
  // The operator retypes the unit price on the staged row. The sheet does not
  // ask for a price at all, so a later pick of the same line carries no newer
  // answer -- overwriting the edit with the catalogue default would silently
  // undo it.
  const edited: StagedAddLine = { ...first, unitPriceUsd: 0.99, priceText: '0.99' }
  const again = stagedLineFromSheetPick(shopAndWarehouse, { branchId: '1' })
  assert.ok(again)
  const merged = mergeStagedAddLine([edited], again)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].quantity, 2)
  assert.equal(merged[0].unitPriceUsd, 0.99)
  assert.equal(merged[0].priceText, '0.99')
})

runTest('two lots of one product are two lines, each capped by its own lot', () => {
  const lotA = stagedLineFromSheetPick(shopAndWarehouse, {
    branchId: '1',
    batch: { batchId: 501, batchLabel: 'A', batchExpiryDate: null, quantity: 4 },
  })
  const lotB = stagedLineFromSheetPick(shopAndWarehouse, {
    branchId: '1',
    batch: { batchId: 502, batchLabel: 'B', batchExpiryDate: null, quantity: 9 },
  })
  assert.ok(lotA && lotB)
  const staged = mergeStagedAddLine(mergeStagedAddLine([], lotA), lotB)
  assert.equal(staged.length, 2)
  assert.deepEqual(staged.map((line) => line.stockQuantity), [4, 9])
  assert.notEqual(stagedAddLineKey(staged[0]), stagedAddLineKey(staged[1]))
})

runTest('the same product on two shelves is two lines', () => {
  const shop = stagedLineFromSheetPick(shopAndWarehouse, { branchId: '1' })
  const other = stagedLineFromSheetPick(shopAndWarehouse, { branchId: '3' })
  assert.ok(shop && other)
  const staged = mergeStagedAddLine(mergeStagedAddLine([], shop), other)
  assert.equal(staged.length, 2)
  assert.notEqual(stagedAddLineKey(staged[0]), stagedAddLineKey(staged[1]))
})

runTest('re-picking refreshes what the lot holds, so a stale cap cannot linger', () => {
  const first = stagedLineFromSheetPick(shopAndWarehouse, {
    branchId: '1',
    batch: { batchId: 501, batchLabel: 'A', batchExpiryDate: null, quantity: 9 },
  })
  assert.ok(first)
  const drained = stagedLineFromSheetPick(shopAndWarehouse, {
    branchId: '1',
    batch: { batchId: 501, batchLabel: 'A', batchExpiryDate: null, quantity: 3 },
  })
  assert.ok(drained)
  const merged = mergeStagedAddLine([first], drained)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].stockQuantity, 3)
  assert.equal(merged[0].batchQuantity, 3)
})

if (failed > 0) {
  console.error(`${failed} sale add-line test(s) failed`)
  process.exit(1)
}
console.log('sale add-line staging tests passed')
