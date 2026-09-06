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
//   2. source pins that the flow is wired the way the ask requires -- the
//      SAME stock kernel as fast stock-in, all three header fields painted
//      up front (no progressive float), the session showing the header, and
//      a dirty Close offering Discard / Back.
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
  isCreateProductsHeaderDirty,
  openingStockRequest,
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
// 4. the opening stock rides the SAME kernel, under one session id
// ---------------------------------------------------------------------------

runTest('opening stock is one receiveBatchStock call carrying the session id', () => {
  const request = openingStockRequest(row(), header, 1725400000000, '2026-09-04')
  assert.deepEqual(request, {
    productId: 1, branchId: 2, quantity: 3,
    receivedDate: '2026-09-04', expiryDate: null,
    supplierId: 7, supplierName: 'Sok Trading',
    unitCostUsd: 2.5, sessionId: 1725400000000,
  })
})

runTest('a zero-quantity item posts no receipt at all', () => {
  assert.equal(openingStockRequest(row({ quantity: 0 }), header, 1, '2026-09-04'), null)
  assert.equal(openingStockRequest(row({ branchId: '' }), header, 1, '2026-09-04'), null)
  assert.equal(openingStockRequest(row({ productId: 0 }), header, 1, '2026-09-04'), null)
})

runTest('a name-only supplier stays name-only -- it is never auto-created', () => {
  const nameOnly: CreateProductsHeader = { brand: '', supplierId: null, supplierName: 'Walk-in wholesaler', branchId: '2' }
  const request = openingStockRequest(row({ supplierName: 'Walk-in wholesaler' }), nameOnly, 5, '2026-09-04')
  assert.equal(request?.supplierId, null)
  assert.equal(request?.supplierName, 'Walk-in wholesaler')
  // No supplier at all sends null rather than an empty string.
  assert.equal(
    openingStockRequest(row({ supplierName: '' }), emptyCreateProductsHeader('2'), 5, '2026-09-04')?.supplierName,
    null,
  )
})

runTest('an item that overrode the supplier never rides the header contact id', () => {
  // The header linked a supplier CONTACT (id 7). One item was typed against
  // a different name -- re-labelling contact 7 with it would corrupt a real
  // supplier's lot history, so that lot goes out name-only instead.
  const overridden = openingStockRequest(row({ supplierName: 'Other Co' }), header, 5, '2026-09-04')
  assert.equal(overridden?.supplierId, null)
  assert.equal(overridden?.supplierName, 'Other Co')
  // The ordinary path -- the row still carries the header's supplier -- keeps
  // the contact link, case and padding notwithstanding.
  const kept = openingStockRequest(row({ supplierName: '  sok trading ' }), header, 5, '2026-09-04')
  assert.equal(kept?.supplierId, 7)
  assert.equal(kept?.supplierName, 'sok trading')
})

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
// 6. source pins -- the flow is wired the way the ask requires
// ---------------------------------------------------------------------------

const modalSource = readFileSync(new URL('../src/components/products/CreateProductsSessionModal.tsx', import.meta.url), 'utf8')
const productsSource = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const productFormSource = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const fastStockInSource = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const inventoryWriteTransportSource = readFileSync(new URL('../src/api/inventoryWriteTransport.ts', import.meta.url), 'utf8')
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

runTest('Add Product opens the header step, and the item step is the existing form', () => {
  assert.match(productsSource, /setModal\('create_session'\)/, 'the Add action opens the header step')
  assert.match(productsSource, /<CreateProductsSessionModal/)
  // "then add new items page which is the current add products" -- the item
  // step is ProductForm itself, not a second product form.
  assert.match(modalSource, /lazyRetry\(\(\) => import\('\.\/forms\/ProductForm'\)/)
  assert.doesNotMatch(modalSource, /<input[^>]*selling_price/, 'the item step must not re-implement product fields')
})

runTest('all three header fields are painted from first paint -- no progressive float', () => {
  const headerBlock = modalSource.slice(modalSource.indexOf("step === 'header' ? ("))
  for (const field of ['brand', 'Brand'] ) assert.ok(headerBlock.includes(field))
  assert.match(headerBlock, /<SupplierPickerField/, 'supplier renders with the header, not after brand is answered')
  assert.match(headerBlock, /<AppSelect/, 'branch renders with the header')
  // None of the three is gated behind another being filled in.
  assert.doesNotMatch(headerBlock, /header\.brand\s*\?\s*\(?\s*<SupplierPickerField/)
  assert.doesNotMatch(headerBlock, /header\.supplierName\s*\?\s*\(?\s*<AppSelect/)
})

runTest('the header is seeded into the item form through ProductForm createDefaults', () => {
  assert.match(productFormSource, /createDefaults\?: Partial<ProductFormState>/)
  // Seeded LAST so the form's own blank defaults stay authoritative for
  // every field the session does not carry.
  assert.match(productFormSource, /\.\.\.\(createDefaults \|\| \{\}\),/)
  assert.match(modalSource, /const itemCreateDefaults = useMemo\(\(\) => \(\{ \.\.\.itemDefaults, received_date: receivedDate \}\)/)
  assert.match(modalSource, /createDefaults=\{itemCreateDefaults\}/)
  assert.match(modalSource, /showReceivedDate/, 'new child forms expose a receipt-date override')
  assert.match(productFormSource, /received_date\?: string \| null/)
  assert.match(productFormSource, /isCreateMode && showReceivedDate/)
  // A fresh key per item, or item two inherits item one's typed state.
  assert.match(modalSource, /key=\{editingNewLine \? `create-products-line-\$\{editingNewLine\.lineId\}` : `create-products-item-\$\{itemFormSeq\}`\}/)
})

runTest('positive new and existing lines use one atomic stock-session write', () => {
  assert.match(modalSource, /import \{[\s\S]*?createInventorySession/)
  assert.doesNotMatch(modalSource, /apiFetch|fetch\(/, 'no bespoke HTTP in this flow')
  assert.match(modalSource, /kind: 'create_receive'/)
  assert.match(modalSource, /kind: 'receive'/)
  assert.match(modalSource, /mode: 'stock_in'/)
  assert.doesNotMatch(modalSource, /kind: '(?:transfer|remove|set)'/, 'unfinished stock commands must not leak into Add products')
  assert.match(inventoryWriteTransportSource, /export function createInventorySession/)
  assert.match(inventoryWriteTransportSource, /'POST', '\/api\/inventory\/sessions'/)
  assert.match(inventoryWriteTransportSource, /route\([\s\S]*?null,[\s\S]*?true,?\s*\)/, 'stock sessions stay network-only writes')
})

runTest('queued rows reopen for correction without changing line identity or overwriting saved overrides', () => {
  assert.match(modalSource, /const \[editingLineId, setEditingLineId\] = useState<string \| null>\(null\)/)
  assert.match(modalSource, /if \(submissionLocked \|\| saving \|\| line\.status !== 'queued'\) return/)
  assert.match(modalSource, /draftScope=\{editingNewLine \? `create-products-session-\$\{sessionIdRef\.current\}-line-\$\{editingNewLine\.lineId\}`/)
  assert.match(modalSource, /lineId,[\s\S]*?product: stockSessionProduct\(prepared\)/, 'a New edit replaces the same logical line')
  assert.match(modalSource, /prev\.map\(\(row\) => row\.lineId === lineId \? updated : row\)/)
  assert.match(modalSource, /lineId: replaceLineId \|\| `receive_/, 'an Existing edit also keeps its line id')
  assert.match(modalSource, /name: editingNewLine\.name[\s\S]*?received_date: editingNewLine\.receivedDate/, 'saved child values seed after current header defaults')
  assert.match(modalSource, /receivedDate: String\(payload\.received_date \|\| current\.receivedDate \|\| receivedDate\)/)
})

runTest('an idempotency conflict stays explicit, frozen, and cannot mint or retry a new request', () => {
  assert.match(modalSource, /submissionErrorCode\?: string/)
  assert.match(modalSource, /const idempotencyConflict = submissionLocked && submissionErrorCode === 'idempotency_conflict'/)
  assert.match(modalSource, /if \(saving \|\| idempotencyConflict\) return/)
  assert.match(modalSource, /idempotency_conflict · \{tr\('resolve', 'Resolve'\)\}/)
  assert.match(modalSource, /disabled=\{saving \|\| idempotencyConflict/)
  assert.match(modalSource, /submittedItems: attemptItems, submissionErrorCode: errorCode/)
  assert.doesNotMatch(modalSource, /sessionRequestIdRef\.current\s*=/)
})

runTest('the whole run carries stable request and line ids for safe retry', () => {
  assert.match(modalSource, /sessionIdRef = useRef\(draft\?\.sessionId \|\| Date\.now\(\)\)/)
  assert.match(modalSource, /client_request_id: sessionRequestIdRef\.current/)
  assert.match(modalSource, /line_id: line\.lineId/)
  assert.match(modalSource, /setRows\(\(prev\) => \[row, \.\.\.prev\]\)/, 'queued line identity survives parent rerenders')
  assert.doesNotMatch(modalSource, /client_request_id:\s*[^\n]*Date\.now\(\)/, 'a retry must not mint a new request id')
  assert.match(modalSource, /submittedItems\?: InventoryStockSessionLine\[\] \| null/)
  assert.match(modalSource, /const attemptItems = submittedItems \|\| pending\.map\(sessionLine\)/)
  assert.match(modalSource, /submittedItems: attemptItems/)
  assert.match(modalSource, /items: attemptItems/)
  assert.match(modalSource, /const submissionLocked = submittedItems !== null/)
})

runTest('Add products exposes New and Have Already without exposing unfinished actions', () => {
  assert.match(modalSource, /type AddProductsMode = 'new' \| 'existing'/)
  assert.match(modalSource, /tr\('add_product'/)
  assert.match(modalSource, /tr\('existing_product'/)
  assert.match(productsSource, /initialMode=\{createSessionInitialMode\}/)
  assert.match(productsSource, /onAdd=\{\(canAddProduct \|\| canAdjustInventoryStock\)[\s\S]*?setCreateSessionInitialMode\(canAddProduct \? 'new' : 'existing'\)/)
  assert.doesNotMatch(productsSource, /onAddStock=/)
  assert.doesNotMatch(modalSource, />\s*(?:Transfer|Remove|Set quantity)\s*</i)
})

runTest('existing-product search groups families then opens a topmost inert-safe option surface', () => {
  assert.match(modalSource, /buildProductGroups\(candidates, productsById, \{ preserveInputOrder: true \}\)/)
  assert.match(modalSource, /selectedGroup/)
  assert.match(modalSource, /layer="nested"/)
  assert.match(modalSource, /setAttribute\('inert', ''\)/)
  assert.match(modalSource, /event\.key !== 'Escape'/)
  assert.match(modalSource, /searchInputRef\.current\?\.focus\(\)/)
  assert.match(modalSource, /group\.sellableItems/)
  assert.match(modalSource, /getProductBatches/)
  assert.match(modalSource, /exactBatchLoadKey/)
  assert.match(fastStockInSource, /buildProductGroups\(candidates, productsById, \{ preserveInputOrder: true \}\)/)
  // The option surface itself is no longer a private nested Modal on either
  // screen: both open the ONE shared sheet, which portals above its opener
  // and swallows Escape so the host modal (and the line being typed into it)
  // survives the key press that dismisses the sheet.
  assert.match(fastStockInSource, /<ProductOptionSheet/)
  assert.match(modalSource, /<ProductOptionSheet/)
  const optionSheetSource = readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8')
  assert.match(optionSheetSource, /createPortal\(sheet, document\.body\)/)
  assert.match(optionSheetSource, /event\.key !== 'Escape'/)
  assert.match(optionSheetSource, /document\.addEventListener\('keydown', onKeyDown, true\)/)
  assert.match(optionSheetSource, /document\.removeEventListener\('keydown', onKeyDown, true\)/)
})

runTest('corrected stock-session wire receives real JSON numbers and explicit batch identity', () => {
  assert.match(modalSource, /branch_id: Number\(line\.branchId\)/)
  assert.match(modalSource, /quantity: Number\(line\.quantity\)/)
  assert.match(modalSource, /product_id: Number\(line\.productId\)/)
  assert.match(modalSource, /batch_id: line\.batchId == null \? null : Number\(line\.batchId\)/)
  assert.match(modalSource, /unit_cost_usd: Number\(line\.unitCostUsd\)/)
  assert.match(modalSource, /const STOCK_SESSION_MAX_LINES = 25/)
  assert.match(modalSource, /const STOCK_SESSION_MAX_BYTES = 64 \* 1024/)
  assert.match(modalSource, /new TextEncoder\(\)\.encode\(JSON\.stringify\(attemptPayload\)\)\.length/)
})

runTest('an attributed existing lot locks its supplier and omits a replacement on the wire', () => {
  assert.match(modalSource, /const lotAttributedName = chosenBatch\?\.supplier_name\?\.trim\(\) \|\| ''/)
  assert.match(modalSource, /supplierName: lotAttributedName \|\| lineSupplier\.supplierName\.trim\(\), supplierLocked: Boolean\(lotAttributedName\)/)
  assert.match(modalSource, /lockedName=\{typeof batchChoice === 'number'/)
  assert.match(modalSource, /supplier_id: line\.supplierLocked \|\| line\.supplierId == null \? null/)
  assert.match(modalSource, /supplier_name: line\.supplierLocked \? null/)
})

runTest('existing-line quantity and unit cost reject invalid input instead of coercing it', () => {
  const queueBlock = modalSource.slice(modalSource.indexOf('const queueExistingLine ='), modalSource.indexOf('const writeDraft ='))
  assert.match(queueBlock, /const quantity = Number\(lineQuantity\)/)
  assert.match(queueBlock, /!Number\.isSafeInteger\(quantity\)/)
  assert.doesNotMatch(queueBlock, /Math\.floor\(Number\(lineQuantity\)\)/)
  assert.match(queueBlock, /const unitCostText = lineUnitCost\.trim\(\)/)
  assert.match(queueBlock, /!unitCostText \|\| !Number\.isFinite\(unitCostUsd\) \|\| unitCostUsd < 0/)
  assert.match(queueBlock, /quantity, unitCostUsd,/)
  assert.doesNotMatch(queueBlock, /unitCostUsd: Number\.isFinite[\s\S]*?\? unitCostUsd : 0/)
  const newItemBlock = modalSource.slice(modalSource.indexOf('const saveNewItem ='), modalSource.indexOf('const removeLine ='))
  assert.match(newItemBlock, /!Number\.isSafeInteger\(quantityValue\) \|\| quantityValue < 0/)
  assert.match(newItemBlock, /!Number\.isFinite\(costValue\) \|\| costValue < 0/)
  assert.doesNotMatch(newItemBlock, /Math\.max\(0, Math\.floor/)
})

runTest('every search dependency change and unmount invalidates an in-flight result', () => {
  const searchEffect = modalSource.slice(modalSource.indexOf("if (mode !== 'existing'" ) - 1200, modalSource.indexOf("if (mode !== 'existing'") + 1200)
  assert.match(searchEffect, /const seq = \+\+searchSeqRef\.current[\s\S]*?if \(mode !== 'existing'/)
  assert.match(searchEffect, /const invalidate = \(\) => \{ if \(searchSeqRef\.current === seq\) searchSeqRef\.current \+= 1 \}/)
  assert.match(searchEffect, /return invalidate/)
  assert.match(searchEffect, /window\.clearTimeout\(timer\); invalidate\(\)/)
})

runTest('definitive no-write failures unlock correction under the same request id', () => {
  assert.match(modalSource, /function isDefinitiveNoWriteStockSessionError/)
  assert.match(modalSource, /\[400, 403, 404\]\.includes\(status\)/)
  assert.match(modalSource, /status === 409 && !!code && code !== 'idempotency_conflict'/)
  assert.match(modalSource, /if \(isDefinitiveNoWriteStockSessionError\(error\)\) \{[\s\S]*?setSubmittedItems\(null\)[\s\S]*?submittedItems: null/)
  assert.doesNotMatch(modalSource, /sessionRequestIdRef\.current\s*=/, 'correction must reuse the known-unused identity')
})

runTest('full-access zero-stock New queues in the atomic session while Review keeps its approval workflow', () => {
  assert.match(modalSource, /const canCommitProductAdd = canCommitProductCreateInStockSession\(user\)/)
  assert.match(modalSource, /if \(quantity === 0 && !canCommitProductAdd\)/)
  assert.match(modalSource, /await onCreateProduct\(\{ \.\.\.payload, stock_quantity: 0 \}\)/)
  assert.match(modalSource, /Review-tier product creation must keep using the registered product[\s\S]*review workflow/)
  assert.match(modalSource, /if \(quantity > 0 && !canReceiveStock\)/)
  assert.match(modalSource, /kind: 'create_receive'/)
  assert.doesNotMatch(modalSource, /Bounded NON-ATOMIC exception/)
})

runTest('catalog-only session lines omit receipt and AP fields and accept nullable receipt ids', () => {
  const zeroWire = modalSource.slice(modalSource.indexOf("if (line.kind === 'create_receive' && Number(line.quantity) === 0)"), modalSource.indexOf('const common ='))
  assert.match(zeroWire, /quantity: 0/)
  assert.match(zeroWire, /received_date: line\.receivedDate/)
  assert.match(zeroWire, /product: line\.product \|\| \{\}/)
  assert.doesNotMatch(zeroWire, /batch_id|supplier_id|supplier_name|expiry_date|notes|unit_cost_usd|payment_status|credit_due_date/)
  assert.match(inventoryWriteTransportSource, /batchId: number \| null/)
  assert.match(inventoryWriteTransportSource, /movementId: number \| null/)
})

runTest('the session shows the header it captured', () => {
  assert.match(modalSource, /summarizeCreateProductsSession\(summaryRows, header, \{/)
  // The always-visible strip on the items step.
  assert.match(modalSource, /\{summary\.brand\}/)
  assert.match(modalSource, /\{summary\.supplier\}/)
  assert.match(modalSource, /\{summary\.branch\}/)
  // ... and every created row repeats them, so an override still reads true.
  assert.match(modalSource, /\{row\.brand \|\| tr\('none', 'None'\)\}/)
  assert.match(modalSource, /\{row\.supplierName \|\| tr\('none', 'None'\)\}/)
  assert.match(modalSource, /\{row\.branchName \|\| tr\('none', 'None'\)\}/)
})

runTest('the displayed default branch is the session value and empty-session summary', () => {
  assert.match(modalSource, /const resolvedDefaultBranchId = String\([\s\S]*?branches\.find\(\(branch\) => branch\.is_default\) \|\| branches\[0\]/)
  assert.match(modalSource, /branchId: draft\.header\.branchId \|\| resolvedDefaultBranchId/, 'a legacy blank-header draft adopts the visible default')
  assert.match(modalSource, /emptyCreateProductsHeader\(resolvedDefaultBranchId\)/)
  assert.match(modalSource, /branch: branchNameFor\(header\.branchId\) \|\| baseSummary\.branch/, 'before the first row, summary must name the selected header branch')
  assert.match(modalSource, /isCreateProductsHeaderDirty\(header, resolvedDefaultBranchId\)/, 'the adopted default must not look manually typed')
})

runTest('Close on a dirty header offers Discard / Back', () => {
  // S4-21 RE-POINTED this assertion; it did not weaken it. The behaviour
  // is unchanged -- dismissing with a typed-but-unused header still asks
  // Discard/Back -- but the dialog is no longer a copy living in this one
  // file. The modal now DECLARES its dirtiness and the single app-wide
  // guard in shared/Modal.tsx raises the single app-wide prompt, which is
  // the entire point of the item ("not a one-off"). The prompt's own
  // behaviour is DRIVEN, not pattern-matched, in
  // tests/unsavedChangesGuard.test.ts.
  assert.match(modalSource, /const closeIsGuarded = headerDirty && rows\.length === 0/)
  assert.match(modalSource, /unsavedChanges=\{\{ dirty: closeIsGuarded \}\}/)
  // And the local copy stays gone -- if it returns there are two prompts.
  assert.doesNotMatch(modalSource, /setConfirmDiscard/, 'the one-off discard dialog must not come back')
  assert.doesNotMatch(modalSource, /import ConfirmDialog from/, 'nothing here needs its own confirm dialog now')
})

runTest('the session survives a reload, like the stock-in session draft does', () => {
  assert.match(modalSource, /scopedWorkDraftKey\('create_products_session'\)/)
  assert.match(modalSource, /scheduleWorkDraftWrite<UnifiedSessionDraft>/)
  // A session resumed the next morning keeps the delivery's own lot date
  // rather than silently splitting the same shipment across two lot codes.
  assert.match(modalSource, /useState\(draft\?\.receivedDate \|\| todayStr\(\)\)/)
  assert.match(modalSource, /receivedDate, mode, query, submittedItems/)
  // Written synchronously before the item form replaces this UI.
  assert.match(modalSource, /writeWorkDraft<UnifiedSessionDraft>/)
  assert.match(modalSource, /clearWorkDraft\(draftKey\)/)
})

runTest('every new string is in BOTH packs', () => {
  const keys = [...new Set([...modalSource.matchAll(/\btr\('([a-z][a-z0-9_]*)'/g)].map((match) => match[1]))]
  assert.ok(keys.length > 10, `expected the modal to use real pack keys, found ${keys.length}`)
  const flatten = (input: unknown, target: Record<string, string> = {}): Record<string, string> => {
    if (!input || typeof input !== 'object') return target
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (value == null || Array.isArray(value)) continue
      if (typeof value === 'object') { flatten(value, target); continue }
      target[key] = String(value)
    }
    return target
  }
  const flatEn = flatten(en)
  const flatKm = flatten(km)
  const missing = keys.filter((key) => flatEn[key] === undefined || flatKm[key] === undefined)
  assert.deepEqual(missing, [], `keys missing from a pack: ${missing.join(', ')}`)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('createProductsSession: all tests passed')
