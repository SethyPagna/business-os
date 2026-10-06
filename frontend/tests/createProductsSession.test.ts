// What stays pinned from the create-products session (S4-12): the same-session
// duplicate guard the Stock Session float uses, and the sources it shares with
// the Stock Session. UI-STOCK-3 (30 Sep 2026) deleted CreateProductsSessionModal.tsx:
// the Products header Add opens the one Stock Session float (UI-STOCK-2), which
// has its own tests (stockSession*.test.ts). The session model that served the
// modal (header, rows, summary, permission requirements) was removed with the
// DEBLOAT-IMPL pass.
//
// Run: node tests/createProductsSession.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './productDraftLifecycle.test.ts'
import './filePickerModalLifecycle.test.ts'
import { findSessionProductDuplicate, sessionProductDuplicateReason } from '../src/utils/createProductsSession.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// ---------------------------------------------------------------------------
// Source pins -- what outlived the Add/Create Products Session modal
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
