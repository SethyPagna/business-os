// Behavioural cover for the product option sheet's derived state.
//
// Every pre-existing test that names ProductDetailSheet.tsx is a regex over
// its source text, so none of them could see that a flat product's Stock read
// 0 while its own branch_stock said 28. These evaluate the derivation instead,
// on data shapes where the old and new implementations disagree.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { deriveProductSheetState } from '../src/components/pos/productSheetState.ts'
import { branchRoleFromName, branchCanSell, branchCanBeTransferSource, branchCanBeTransferDestination } from '../src/utils/branchRoles.ts'

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const src = (...parts: string[]) => fs.readFileSync(new URL(`../src/${parts.join('/')}`, import.meta.url), 'utf8')

// The two canonical branches as the server ships them on every product row
// (cloudflare/src/routes/products.ts attachBranchStock: one entry per ACTIVE
// branch, 0-filled, with branch_name).
const branchStock = (shop: number, warehouse: number) => ([
  { branch_id: 2, branch_name: 'Shop', quantity: shop },
  { branch_id: 1, branch_name: 'Warehouse', quantity: warehouse },
])

await runTest('branch roles come from the name, never from is_default', () => {
  assert.equal(branchRoleFromName('Warehouse'), 'warehouse')
  assert.equal(branchRoleFromName('  shop '), 'shop')
  assert.equal(branchRoleFromName('Depot'), 'other')
  assert.equal(branchCanSell('Warehouse'), false)
  assert.equal(branchCanSell('Shop'), true)
  // An unrecognised branch is not evidence of a stock-only branch.
  assert.equal(branchCanSell('Kiosk'), true)
  assert.equal(branchCanBeTransferSource('Warehouse'), true)
  assert.equal(branchCanBeTransferSource('Shop'), false)
  assert.equal(branchCanBeTransferDestination('Shop'), true)
  assert.equal(branchCanBeTransferDestination('Warehouse'), false)
})

// SHAPE B from the investigation: a flat, NON-batch-tracked product with real
// branch stock. The old derivation resolved the row out of `variants`, which
// is EMPTY for a flat product, so effectiveVariant was null, displayedStock
// was a hard 0 and all three Add buttons were disabled -- the sale refused on
// a product the shop was holding 28 of.
await runTest('flat non-batch-tracked product reads its stock from branch_stock, not 0', () => {
  const product = { id: 51, name: 'Flat Product', unit: 'pcs', branch_stock: branchStock(28, 0), stock_quantity: 28 }
  const state = deriveProductSheetState({ product, variants: [], groupProduct: false })
  assert.equal(state.displayedStock, 28, 'flat product must read 28, not the old hard 0')
  assert.equal(state.effectiveVariant?.id, 51, 'a flat product resolves to itself')
  assert.equal(state.effectiveBranchId, '2', 'preselects the selling branch')
  assert.equal(state.batchReadyToSell, true)
})

// SHAPE A: the grouped sheet's branch pills. The quantity was computed and
// then thrown away -- the pill printed only the branch name, so the sheet
// showed exactly one number and N nameless branch counts.
await runTest('branch pills carry the resolved row quantity and the group total', () => {
  const rows = [
    { id: 61, name: 'Grouped', barcode: 'A1', branch_stock: branchStock(4, 1) },
    { id: 62, name: 'Grouped', barcode: 'A2', branch_stock: branchStock(8, 6) },
  ]
  const state = deriveProductSheetState({
    product: { id: 61, name: 'Grouped', branch_stock: branchStock(4, 1) },
    variants: rows,
    groupProduct: true,
    selectedVariantId: '62',
  })
  const shop = state.branchOptions.find((option) => option.name === 'Shop')
  const warehouse = state.branchOptions.find((option) => option.name === 'Warehouse')
  assert.equal(shop?.quantity, 8, 'the pill shows the RESOLVED row at that branch (row 62)')
  assert.equal(shop?.groupQuantity, 12, 'the group total stays available beside it')
  assert.equal(warehouse?.quantity, 6)
  assert.equal(warehouse?.groupQuantity, 7)
  assert.equal(state.branchSummary, 'Shop: 8 · Warehouse: 6')
})

// SHAPE D (the "RECON residue" shape): branch_stock says 28 at the shop and
// the lot ledger is empty. The old sheet mixed the two -- it took the number
// from the LOT ledger (0) while a branch line beside it printed 28.
await runTest('branch_stock is the on-hand ledger; an empty lot list does not zero it', () => {
  const product = { id: 71, name: 'Tracked', branch_stock: branchStock(28, 0) }
  const state = deriveProductSheetState({
    product,
    variants: [],
    groupProduct: false,
    trackedBatchProductIds: new Set([71]),
    batches: [],
  })
  assert.equal(state.displayedStock, 28, 'on-hand comes from branch_stock')
  assert.equal(state.isBatchTracked, true)
  assert.equal(state.stockWithoutReceivedDate, true, 'the contradiction is surfaced, not silently rendered as 0')
  // The sale still cannot proceed without a received date -- that gate is
  // about WHICH intake, not about how many units exist.
  assert.equal(state.batchReadyToSell, false)
})

await runTest('picking a received date narrows the number to that lot', () => {
  const product = { id: 72, name: 'Tracked', branch_stock: branchStock(28, 0) }
  const batches = [
    { id: 901, quantity: 5, received_date: '2026-01-02' },
    { id: 902, quantity: 23, received_date: '2026-02-02' },
  ]
  const state = deriveProductSheetState({
    product,
    groupProduct: false,
    trackedBatchProductIds: new Set([72]),
    batches,
    selectedBatchId: 901,
  })
  assert.equal(state.displayedStock, 5)
  assert.equal(state.batchReadyToSell, true)
  assert.equal(state.receivedDateTotal, 28)
  assert.equal(state.receivedDateOptions[0].id, 901, 'earliest received date first')
  assert.equal(state.stockWithoutReceivedDate, false)
})

// N11's second clause. The warehouse is VISIBLE with its quantity, greyed and
// unselectable for everyone including admins, and never preselected.
await runTest('warehouse is shown with its quantity but cannot be picked on a sale surface', () => {
  const product = { id: 81, name: 'Warehouse only', branch_stock: branchStock(0, 40) }
  const state = deriveProductSheetState({ product, groupProduct: false, intent: 'sell', activeBranchId: 1 })
  const warehouse = state.branchOptions.find((option) => option.role === 'warehouse')
  assert.ok(warehouse, 'the warehouse option is still rendered')
  assert.equal(warehouse?.quantity, 40, 'with its quantity')
  assert.equal(warehouse?.selectable, false)
  assert.equal(warehouse?.blockedMessageKey, 'pos_warehouse_not_sellable')
  assert.equal(state.warehouseDisabled, true)
  // activeBranchId asked for the warehouse; a sale surface must not open on it.
  assert.equal(state.effectiveBranchId, '2', 'preselection skips a branch no Add button would accept')
  assert.equal(state.displayedStock, 0, 'the shop holds none of it')
})

await runTest('a selected warehouse branch is refused on sale surfaces and honoured on stock surfaces', () => {
  const product = { id: 82, name: 'Both', branch_stock: branchStock(3, 40) }
  const selling = deriveProductSheetState({ product, intent: 'sell', selectedBranchId: '1' })
  assert.equal(selling.effectiveBranchId, '2')
  assert.equal(selling.displayedStock, 3)

  const stocking = deriveProductSheetState({ product, intent: 'stock', selectedBranchId: '1' })
  assert.equal(stocking.effectiveBranchId, '1')
  assert.equal(stocking.displayedStock, 40)
  assert.equal(stocking.warehouseDisabled, false)
  assert.equal(stocking.branchOptions.every((option) => option.selectable), true)
})

await runTest('a product with no branch_stock at all falls back to the cross-branch number', () => {
  const product = { id: 91, name: 'No branch rows', stock_quantity: 7 }
  const state = deriveProductSheetState({ product, getDisplayStock: (row) => Number(row?.stock_quantity || 0) })
  assert.equal(state.branchOptions.length, 0)
  assert.equal(state.effectiveBranchId, null)
  assert.equal(state.displayedStock, 7)
  assert.equal(state.branchSummary, '')
})

await runTest('grouped rows narrow to the branch that carries them', () => {
  const rows = [
    { id: 101, name: 'G', barcode: 'X', branch_stock: [{ branch_id: 2, branch_name: 'Shop', quantity: 5 }] },
    { id: 102, name: 'G', barcode: 'Y', branch_stock: [{ branch_id: 1, branch_name: 'Warehouse', quantity: 9 }] },
  ]
  const state = deriveProductSheetState({ product: rows[0], variants: rows, groupProduct: true, intent: 'sell' })
  assert.deepEqual(state.candidatePool.map((row) => row.id), [101], 'only the shop row is offered at the shop')
  assert.equal(state.displayedStock, 5)
  const warehouse = state.branchOptions.find((option) => option.role === 'warehouse')
  assert.equal(warehouse?.quantity, 9, 'the warehouse pill still reports what it holds')
  assert.equal(warehouse?.selectable, false)
})

await runTest('the sheet reads its derived state from the pure module, not from inline expressions', () => {
  const sheet = src('components', 'pos', 'ProductDetailSheet.tsx')
  assert.match(sheet, /from '\.\/productSheetState\.ts'/, 'ProductDetailSheet must consume the extracted module')
  assert.doesNotMatch(sheet, /const candidatePool = candidateVariants\.length/, 'the inline duplicate derivation must be gone')
  assert.match(sheet, /t\('batches'\)/, 'the received-date step must read the language pack, not a posCopy literal')
  assert.doesNotMatch(sheet, /Pick a lot \/ batch/, 'the retired "Pick a lot / batch" wording must be gone')
})

// Sibling-surface parity: every picker listed in the owner ask mounts the one
// shared sheet rather than a private option popup of its own.
await runTest('every product picker mounts the shared option sheet', () => {
  // The POS mounts ProductDetailSheet itself -- it IS the sheet. Every other
  // surface reaches that same component through the shared adapter.
  const sites = [
    ['components', 'products', 'forms', 'StockAdjustModal.tsx'],
    ['components', 'inventory', 'FastStockInModal.tsx'],
    ['components', 'branches', 'TransferModal.tsx'],
    ['components', 'sales', 'SaleDetailModal.tsx'],
    ['components', 'returns', 'NewReturnModal.tsx'],
    ['components', 'products', 'CreateProductsSessionModal.tsx'],
  ]
  for (const site of sites) {
    const text = src(...site)
    assert.match(text, /ProductOptionSheet/, `${site.join('/')} must open the shared option sheet`)
  }
  assert.match(src('components', 'pos', 'POS.tsx'), /ProductDetailSheet/)
  // ...and the adapter stays an adapter, not a second implementation.
  assert.match(
    src('components', 'shared', 'ProductOptionSheet.tsx'),
    /from '\.\.\/pos\/ProductDetailSheet\.tsx'/,
    'the shared sheet must BE the POS sheet, not a copy of it',
  )
})

if (failed) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('productSheetState tests passed')
