// S4-12: the create-products header step.
//
// The ask: "add a layer to Add Product: so beginning it will have Brand,
// Supplier, Branch then add new items page which is the current add products.
// so users just have to enter brand, supplier, and branch once when add
// products... same as the session for add stock, and will show this in the
// session".
//
// Two halves are asserted here:
//   1. the pure session model (utils/createProductsSession.ts) -- real
//      behaviour, executed;
//   2. source pins on what the flow shares with the Stock Session.
//
// UI-STOCK-3 (30 Sep 2026) deleted CreateProductsSessionModal.tsx: the
// Products header Add opens the one Stock Session float (UI-STOCK-2), which
// has its own tests (stockSession*.test.ts). The pins on the modal's own source
// are retired with it and listed in the UI-STOCK-3 lane report.
//
// Run: node tests/createProductsSession.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './productDraftLifecycle.test.ts'
import './filePickerModalLifecycle.test.ts'
import {
  canStartCreateProductsSession,
  createProductsSessionDefaults,
  createProductsSessionRow,
  emptyCreateProductsHeader,
  findSessionProductDuplicate,
  isCreateProductsHeaderDirty,
  isSameQueuedProduct,
  sessionProductDuplicateReason,
  summarizeCreateProductsSession,
  type CreateProductsHeader,
  type CreateProductsSessionRow,
} from '../src/utils/createProductsSession.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const LABELS = {
  multipleBrands: 'Multiple brands',
  multipleSuppliers: 'Multiple suppliers',
  multipleBranches: 'Multiple branches',
  none: 'None',
}

const header: CreateProductsHeader = { brand: 'MAC', supplierId: 7, supplierName: 'Sok Trading', branchId: '2' }

function row(over: Partial<CreateProductsSessionRow> = {}): CreateProductsSessionRow {
  return {
    key: 'k', productId: 1, name: 'Lipstick', barcode: '123', brand: 'MAC',
    supplierName: 'Sok Trading', branchId: '2', branchName: 'Main', quantity: 3,
    unitCostUsd: 2.5, lotCode: '', status: 'created', detail: '', ...over,
  }
}

// ---------------------------------------------------------------------------
// 1. the header is entered once and rides every item
// ---------------------------------------------------------------------------

runTest('the header hands brand + supplier + branch to every item form', () => {
  assert.deepEqual(createProductsSessionDefaults(header), {
    brand: 'MAC', supplier: 'Sok Trading', branch_id: '2',
  })
  // Trimmed, so a stray space never forks the brand/supplier vocabulary.
  assert.deepEqual(
    createProductsSessionDefaults({ brand: '  MAC ', supplierId: null, supplierName: ' Sok ', branchId: '2' }),
    { brand: 'MAC', supplier: 'Sok', branch_id: '2' },
  )
})

runTest('only the branch gates leaving the header step', () => {
  assert.equal(canStartCreateProductsSession(header), true)
  // A shop that tracks neither brands nor suppliers must still be able to
  // create products -- the opening stock only needs somewhere to land.
  assert.equal(canStartCreateProductsSession(emptyCreateProductsHeader('4')), true)
  assert.equal(canStartCreateProductsSession(emptyCreateProductsHeader('')), false)
})

// ---------------------------------------------------------------------------
// 2. Close on a dirty form must prompt Discard / Back
// ---------------------------------------------------------------------------

runTest('a pre-filled default branch is not "typed data"', () => {
  // Fresh open: the branch select already carries the page default. That is
  // not something the operator typed, so Close must not nag.
  assert.equal(isCreateProductsHeaderDirty(emptyCreateProductsHeader('2'), '2'), false)
  assert.equal(isCreateProductsHeaderDirty({ ...emptyCreateProductsHeader('2'), brand: 'MAC' }, '2'), true)
  assert.equal(isCreateProductsHeaderDirty({ ...emptyCreateProductsHeader('2'), supplierName: 'Sok' }, '2'), true)
  assert.equal(isCreateProductsHeaderDirty({ ...emptyCreateProductsHeader('2'), supplierId: 7 }, '2'), true)
  // Changing the branch away from the default IS a deliberate choice.
  assert.equal(isCreateProductsHeaderDirty(emptyCreateProductsHeader('5'), '2'), true)
})

// ---------------------------------------------------------------------------
// 3. a created item, recorded as the session sees it
// ---------------------------------------------------------------------------

runTest('a session row reads the values actually saved, not the header assumed', () => {
  const built = createProductsSessionRow(
    { name: ' Lipstick ', barcode: '123', brand: 'NARS', supplier: 'Other Co', branch_id: '3', stock_quantity: '12', cost_price_usd: '1.75' },
    header,
    { productId: 91, branchName: 'Branch 3' },
  )
  assert.equal(built.productId, 91)
  assert.equal(built.name, 'Lipstick')
  // The item form stays fully editable, so an override wins over the header.
  assert.equal(built.brand, 'NARS')
  assert.equal(built.supplierName, 'Other Co')
  assert.equal(built.branchId, '3')
  assert.equal(built.quantity, 12)
  assert.equal(built.unitCostUsd, 1.75)
  assert.equal(built.status, 'created')
})

runTest('an item that left a field blank falls back to the header', () => {
  const built = createProductsSessionRow({ name: 'Gloss', stock_quantity: 0 }, header, { productId: 92 })
  assert.equal(built.brand, 'MAC')
  assert.equal(built.supplierName, 'Sok Trading')
  assert.equal(built.branchId, '2')
  assert.equal(built.quantity, 0)
})

runTest('quantities are floored non-negative -- junk never becomes stock', () => {
  assert.equal(createProductsSessionRow({ name: 'A', stock_quantity: -5 }, header, { productId: 1 }).quantity, 0)
  assert.equal(createProductsSessionRow({ name: 'A', stock_quantity: 2.9 }, header, { productId: 1 }).quantity, 2)
  assert.equal(createProductsSessionRow({ name: 'A', stock_quantity: 'abc' }, header, { productId: 1 }).quantity, 0)
  assert.equal(createProductsSessionRow({ name: 'A', cost_price_usd: -3 }, header, { productId: 1 }).unitCostUsd, 0)
})

// ---------------------------------------------------------------------------
// 4. the opening stock rides the SAME writer as every other stock-in session
//    (POST /api/inventory/sessions -- pinned below in the wire tests). The
//    per-line receiveBatchStock helper that used to live here was removed as
//    zombie code on 2026-09-06: nothing in src had called it since S4-15.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 5. the session record's own columns
// ---------------------------------------------------------------------------

runTest('the session shows the header brand, supplier and branch', () => {
  const summary = summarizeCreateProductsSession([row({ key: 'a' }), row({ key: 'b', quantity: 2, unitCostUsd: 4 })], header, LABELS)
  assert.equal(summary.items, 2)
  assert.equal(summary.units, 5)
  assert.equal(summary.costUsd, 15.5) // 3*2.50 + 2*4.00
  assert.equal(summary.brand, 'MAC')
  assert.equal(summary.supplier, 'Sok Trading')
  assert.equal(summary.branch, 'Main')
})

runTest('a row that overrode the header collapses to "Multiple ..." -- the summary never lies', () => {
  const summary = summarizeCreateProductsSession(
    [row({ key: 'a' }), row({ key: 'b', brand: 'NARS', supplierName: 'Other Co', branchName: 'Branch 3' })],
    header, LABELS,
  )
  assert.equal(summary.brand, LABELS.multipleBrands)
  assert.equal(summary.supplier, LABELS.multipleSuppliers)
  assert.equal(summary.branch, LABELS.multipleBranches)
})

runTest('an empty session still shows the header the operator typed', () => {
  // The point of the header step: it is visible BEFORE anything is created.
  const summary = summarizeCreateProductsSession([], header, LABELS)
  assert.equal(summary.items, 0)
  assert.equal(summary.brand, 'MAC')
  assert.equal(summary.supplier, 'Sok Trading')
  assert.equal(summary.branch, LABELS.none)
  assert.equal(summarizeCreateProductsSession([], emptyCreateProductsHeader('2'), LABELS).brand, LABELS.none)
})

runTest('money rounds to cents rather than accumulating float dust', () => {
  const summary = summarizeCreateProductsSession(
    [row({ key: 'a', quantity: 3, unitCostUsd: 0.1 }), row({ key: 'b', quantity: 3, unitCostUsd: 0.2 })],
    header, LABELS,
  )
  assert.equal(summary.costUsd, 0.9)
})

// ---------------------------------------------------------------------------
// 6. source pins -- what outlived the Add/Create Products Session modal
// ---------------------------------------------------------------------------

const utilsSource = readFileSync(new URL('../src/utils/createProductsSession.ts', import.meta.url), 'utf8')
const productFormSource = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const fastStockInSource = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const inventoryWriteTransportSource = readFileSync(new URL('../src/api/inventoryWriteTransport.ts', import.meta.url), 'utf8')

runTest('the per-line receipt helper is gone -- one writer, no parallel path', () => {
  assert.doesNotMatch(utilsSource, /openingStockRequest/)
})

runTest('ProductForm seeds create defaults last and can show a receipt-date override', () => {
  assert.match(productFormSource, /createDefaults\?: Partial<ProductFormState>/)
  assert.match(productFormSource, /\.\.\.\(createDefaults \|\| \{\}\),/)
  assert.match(productFormSource, /received_date\?: string \| null/)
  assert.match(productFormSource, /isCreateMode && showReceivedDate/)
})

runTest('the stock-session transport stays one network-only atomic write', () => {
  assert.match(inventoryWriteTransportSource, /export function createInventorySession/)
  assert.match(inventoryWriteTransportSource, /'POST', '\/api\/inventory\/sessions'/)
  assert.match(inventoryWriteTransportSource, /INVENTORY_SESSION_TIMEOUT_MS\s*=\s*60_000/)
  assert.match(inventoryWriteTransportSource, /'\/api\/inventory\/sessions', payload, INVENTORY_SESSION_TIMEOUT_MS/)
  assert.match(inventoryWriteTransportSource, /route\([\s\S]*?null,[\s\S]*?true,?\s*\)/, 'stock sessions stay network-only writes')
  assert.match(inventoryWriteTransportSource, /batchId: number \| null/)
  assert.match(inventoryWriteTransportSource, /movementId: number \| null/)
})

runTest('product search groups families then opens the shared topmost option sheet', () => {
  assert.match(fastStockInSource, /buildProductGroups\(visibleCandidates, productsById, \{ preserveInputOrder: true \}\)/)
  // The option surface is the ONE shared sheet, which portals above its
  // opener and swallows Escape so the float (and the line being typed into
  // it) survives the key press that dismisses the sheet.
  assert.match(fastStockInSource, /<ProductOptionSheet/)
  const optionSheetSource = readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8')
  assert.match(optionSheetSource, /createPortal\(sheet, document\.body\)/)
  assert.match(optionSheetSource, /event\.key !== 'Escape'/)
  assert.match(optionSheetSource, /document\.addEventListener\('keydown', onKeyDown, true\)/)
  assert.match(optionSheetSource, /document\.removeEventListener\('keydown', onKeyDown, true\)/)
})

// The 2026-09-06 leading-zero report on the CREATE path. The session
// refuses to queue one article twice, and it compared barcodes as plain
// text -- so '0748485110011' and '748485110011' both went through and
// became two catalog rows for one article. Red before the fold.
runTest('the queued-twin guard folds a leading-zero barcode', () => {
  const queued = { name: 'Padded Twin Serum', barcode: '748485110011', unitCostUsd: 3.5 }
  assert.equal(
    isSameQueuedProduct(queued, { name: 'Padded Twin Serum', barcode: '0748485110011', unitCostUsd: 3.5 }),
    true,
    'a padding twin of a queued line is the SAME product and must be refused',
  )
  assert.equal(isSameQueuedProduct(queued, { name: 'padded twin serum ', barcode: '00748485110011', unitCostUsd: 3.5 }), true)
})

runTest('the catalog-identity helper remains narrower than the session warning', () => {
  const queued = { name: 'Padded Twin Serum', barcode: '748485110011', unitCostUsd: 3.5 }
  // One digit different is a different article.
  assert.equal(isSameQueuedProduct(queued, { name: 'Padded Twin Serum', barcode: '748485110012', unitCostUsd: 3.5 }), false)
  // A different cost is deliberately a different LINE -- the session
  // records what each delivery actually cost.
  assert.equal(isSameQueuedProduct(queued, { name: 'Padded Twin Serum', barcode: '0748485110011', unitCostUsd: 4 }), false)
  // A different name is a different product even on the same code.
  assert.equal(isSameQueuedProduct(queued, { name: 'Other Serum', barcode: '0748485110011', unitCostUsd: 3.5 }), false)
  // '0' is a placeholder, not a barcode: two blank-coded lines still
  // compare on name and cost alone, exactly as before.
  assert.equal(isSameQueuedProduct({ name: 'A', barcode: '', unitCostUsd: 1 }, { name: 'A', barcode: '', unitCostUsd: 1 }), true)
})

// Sep 15 2026 wildcard half of the barcode identity rule, reaching the
// CREATE-session queue guard: a blank/broken barcode on either side never
// forces a NEW queued line by itself. The plain `row.barcode.trim() ===
// barcode` string comparison this replaced would say FALSE here (''
// !== '748485110011'), letting the operator queue the same delivery twice;
// barcodeIdentityMatches treats one side being non-real as a wildcard, so
// this must be TRUE. Two DIFFERENT real barcodes are never a wildcard case
// (both real, so the fold/compare runs and they disagree) -- that must stay
// FALSE under both the old and the new code, so it is not by itself proof
// the fix landed, but it pins the boundary the wildcard must not cross.
runTest('the queued-twin guard treats a blank/broken barcode as a wildcard, not a mismatch', () => {
  const real = { name: 'Padded Twin Serum', barcode: '748485110011', unitCostUsd: 3.5 }
  assert.equal(
    isSameQueuedProduct(real, { name: 'Padded Twin Serum', barcode: '', unitCostUsd: 3.5 }),
    true,
    'a blank barcode is a wildcard, not a different identity -- same name+cost must still be refused as a duplicate',
  )
  assert.equal(
    isSameQueuedProduct(real, { name: 'Padded Twin Serum', barcode: 'N/A', unitCostUsd: 3.5 }),
    true,
    'a word-like placeholder barcode is broken, not real -- also a wildcard',
  )
  assert.equal(
    isSameQueuedProduct(real, { name: 'Padded Twin Serum', barcode: '999999999999', unitCostUsd: 3.5 }),
    false,
    'two genuinely different REAL barcodes are never a wildcard match, even with the same name and cost',
  )
})

runTest('same-session duplicate warning matches normalized name OR guarded barcode identity', () => {
  assert.equal(sessionProductDuplicateReason(
    { name: ' Rose   Lip Oil ', barcode: '111' },
    { name: 'rose lip oil', barcode: '222' },
  ), 'name')
  assert.equal(sessionProductDuplicateReason(
    { name: 'First', barcode: '748485110011' },
    { name: 'Second', barcode: '0748485110011' },
  ), 'barcode')
  assert.equal(sessionProductDuplicateReason({ name: 'A', barcode: '' }, { name: 'B', barcode: '' }), null)
  assert.equal(sessionProductDuplicateReason({ name: 'A', barcode: '0' }, { name: 'B', barcode: '000' }), null)
  assert.equal(sessionProductDuplicateReason(
    { name: 'UPC-E article', barcode: '01234565' },
    { name: 'Internal-code article', barcode: '1234565' },
  ), null, 'a valid UPC-E must not collide with its stripped seven-digit text')
  assert.equal(sessionProductDuplicateReason(
    { name: 'UPC-E article', barcode: '01234565' },
    { name: 'UPC-A article', barcode: '012345000065' },
  ), 'barcode', 'the actual UPC-E / UPC-A pair remains the same session item')
})

runTest('duplicate lookup includes saved and queued rows and excludes the line being edited', () => {
  const lines = [
    { lineId: 'saved', status: 'saved', name: 'Saved serum', barcode: '9001' },
    { lineId: 'queued', status: 'queued', name: 'Queued cream', barcode: '9002' },
  ]
  assert.equal(findSessionProductDuplicate(lines, { name: 'saved serum' })?.row.lineId, 'saved')
  assert.equal(findSessionProductDuplicate(lines, { barcode: '09002' })?.row.lineId, 'queued')
  assert.equal(findSessionProductDuplicate(lines, { name: 'Queued cream' }, 'queued'), null)
})

runTest('both add and edit paths use the session warning without changing catalog identity', () => {
  const uses = fastStockInSource.match(/findSessionProductDuplicate\(duplicateRows/g) || []
  assert.ok(uses.length >= 3, 'the pick, the new-product hold and the nested form must all consult the queued session items')
  assert.doesNotMatch(fastStockInSource, /\.barcode\.trim\(\) === barcode/, 'no hand-rolled barcode equality may remain')
  assert.match(fastStockInSource, /create_products_session_duplicate', 'Duplicate: You added this item already\.'/)
})

runTest('nested ProductForm shows session duplicate immediately and availability only after lookup resolves', () => {
  assert.match(productFormSource, /sessionDuplicateCheck\?: \(candidate:/)
  assert.match(productFormSource, /const createSessionDuplicate =/)
  assert.match(productFormSource, /createSessionDuplicate \? \([\s\S]*?create_products_session_duplicate/)
  assert.match(productFormSource, /createMatchLookupState === 'resolved'/)
  assert.match(productFormSource, /tr\('available', 'Available'/)
  assert.doesNotMatch(productFormSource, /createMatchLookupState === 'loading'[\s\S]{0,200}?tr\('available'/,
    'green availability cannot appear while a lookup is pending')
})


if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('createProductsSession: all tests passed')
