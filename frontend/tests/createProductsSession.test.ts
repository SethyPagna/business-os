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
  assert.match(modalSource, /createDefaults=\{itemDefaults\}/)
  // A fresh key per item, or item two inherits item one's typed state.
  assert.match(modalSource, /key=\{`create-products-item-\$\{itemFormSeq\}`\}/)
})

runTest('opening stock goes through the one shared kernel, never a parallel write', () => {
  assert.match(modalSource, /import \{ receiveBatchStock \} from '\.\.\/\.\.\/api\/batchesTransport\.ts'/)
  assert.doesNotMatch(modalSource, /apiFetch|fetch\(/, 'no bespoke HTTP in this flow')
  // Products are written by the page's own create path, handed in as a prop.
  assert.doesNotMatch(modalSource, /createProduct\(/)
  assert.match(modalSource, /onCreateProduct\(\{/)
  // Created at zero, then received -- otherwise the same units land twice
  // (seedInitialBatchForNewProduct already seeds the chosen branch).
  assert.match(modalSource, /stock_quantity: 0,/)
})

runTest('the whole run carries ONE session id, so it lands as one stock-in session', () => {
  assert.match(modalSource, /sessionIdRef = useRef\(draft\?\.sessionId \|\| Date\.now\(\)\)/)
  assert.equal((modalSource.match(/openingStockRequest\(/g) || []).length, 2, 'first save + retry, both from the same helper')
  assert.match(modalSource, /openingStockRequest\(row, header, sessionIdRef\.current, receivedDateRef\.current\)/)
})

runTest('the session shows the header it captured', () => {
  assert.match(modalSource, /summarizeCreateProductsSession\(rows, header, \{/)
  // The always-visible strip on the items step.
  assert.match(modalSource, /\{summary\.brand\}/)
  assert.match(modalSource, /\{summary\.supplier\}/)
  assert.match(modalSource, /\{summary\.branch\}/)
  // ... and every created row repeats them, so an override still reads true.
  assert.match(modalSource, /\{row\.brand \|\| tr\('none', 'None'\)\}/)
  assert.match(modalSource, /\{row\.supplierName \|\| tr\('none', 'None'\)\}/)
  assert.match(modalSource, /\{row\.branchName \|\| tr\('none', 'None'\)\}/)
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
  assert.match(modalSource, /scheduleWorkDraftWrite<CreateProductsSessionDraft>/)
  // A session resumed the next morning keeps the delivery's own lot date
  // rather than silently splitting the same shipment across two lot codes.
  assert.match(modalSource, /useRef\(draft\?\.receivedDate \|\| todayStr\(\)\)/)
  assert.match(modalSource, /receivedDate: receivedDateRef\.current,/)
  // Written synchronously before the item form replaces this UI.
  assert.match(modalSource, /writeWorkDraft<CreateProductsSessionDraft>/)
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
