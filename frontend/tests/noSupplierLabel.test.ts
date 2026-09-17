import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { supplierDisplay, hasSupplier, NO_SUPPLIER_KEY } from '../src/utils/supplierDisplay.ts'

// Owner (Sep 17): "i see that some items have no supplier. I want you to make
// it 'No supplier' for supplier, and in contacts show. so in supplier page,
// and in batches can also edit to add supplier name."
//
// Three contracts, each of which was broken somewhere before this file:
//
//   1. ONE label. A blank supplier used to render as '--', '-', an em dash,
//      the word "Unknown", or nothing at all, differently on every surface.
//   2. The no-supplier lots have to be REACHABLE. The product's supplier
//      breakdown filtered them out in SQL, so no amount of frontend labelling
//      could have shown them.
//   3. A batch can be given a supplier from the batch editor, not only from
//      the stock-in session editor.

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

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
const worker = (rel: string) => readFileSync(new URL(`../../cloudflare/src/${rel}`, import.meta.url), 'utf8')
const tr = (key: string, fallback: string) => (key === NO_SUPPLIER_KEY ? 'No supplier' : fallback)

runTest('a blank, missing or whitespace supplier reads as the label, never an empty string', () => {
  for (const blank of [null, undefined, '', '   ', '\t']) {
    assert.equal(supplierDisplay(blank, tr), 'No supplier')
    assert.equal(hasSupplier(blank), false)
  }
  // A real name is never touched -- not trimmed away, not relabelled.
  assert.equal(supplierDisplay('Hanuman Trading', tr), 'Hanuman Trading')
  assert.equal(hasSupplier('Hanuman Trading'), true)
  assert.equal(supplierDisplay(' Hanuman Trading ', tr), 'Hanuman Trading')
})

runTest('both packs carry the owner\'s wording on the one key', () => {
  const en = JSON.parse(src('lang/en.json')) as Record<string, string>
  const km = JSON.parse(src('lang/km.json')) as Record<string, string>
  assert.equal(en[NO_SUPPLIER_KEY], 'No supplier')
  assert.ok(km[NO_SUPPLIER_KEY], `km.json is missing ${NO_SUPPLIER_KEY}`)
  assert.notEqual(en[NO_SUPPLIER_KEY], km[NO_SUPPLIER_KEY], 'the label must really be translated')
  // The second key that said the same thing is gone: two keys for one label is
  // how the surfaces drifted apart in the first place.
  assert.equal(en.supplier_not_recorded, undefined)
  assert.equal(km.supplier_not_recorded, undefined)
})

runTest('no surface still decodes a missing supplier as a dash, a hidden chip or "Unknown"', () => {
  const cases: Array<[string, RegExp]> = [
    ['components/contacts/ApInvoicesSection.tsx', /supplier_name \|\| '--'/],
    ['components/contacts/SupplierPurchasesModal.tsx', /supplierName \|\| '--'/],
    ['components/products/StockInSessionsSection.tsx', /batch_supplier_name \|\| '—'/],
    ['components/products/StockChangeSection.tsx', /historyField\(row\.batch_supplier_name\)/],
    ['components/products/StockChangeSection.tsx', /detail\.batch_supplier_name \? </],
    ['components/inventory/ManageBatchesModal.tsx', /batch\.supplier_name \? </],
    ['components/products/surfaces/AttributeSupplierModal.tsx', /lot\.supplier_name \? </],
    ['components/products/SelectedConflictMergeReviewModal.tsx', /supplier_name \|\| tr\('unknown'/],
    ['components/returns/ReturnDetailModal.tsx', /supplier_name \|\| '-'/],
    ['components/returns/ReturnsListSurface.tsx', /supplier_name \|\| '-'/],
  ]
  for (const [file, forbidden] of cases) {
    assert.doesNotMatch(src(file), forbidden, `${file} still renders a missing supplier as something other than the label`)
  }
  // And each of them goes through the one helper instead.
  for (const file of [
    'components/contacts/ApInvoicesSection.tsx',
    'components/contacts/SupplierPurchasesModal.tsx',
    'components/products/StockInSessionsSection.tsx',
    'components/products/StockChangeSection.tsx',
    'components/inventory/ManageBatchesModal.tsx',
    'components/products/surfaces/ProductDetailReport.tsx',
    'components/products/surfaces/AttributeSupplierModal.tsx',
    'components/products/SelectedConflictMergeReviewModal.tsx',
    'components/pos/ProductDetailSheet.tsx',
    'components/returns/ReturnDetailModal.tsx',
    'components/returns/ReturnsListSurface.tsx',
  ]) {
    assert.match(src(file), /supplierDisplay\(/, `${file} does not use the shared label`)
  }
})

runTest('the product supplier breakdown can actually contain the no-supplier lots', () => {
  const route = worker('routes/products.ts')
  // The filter that made the group unreachable is gone ...
  assert.doesNotMatch(route, /AND \(pb\.supplier_id IS NOT NULL OR trim\(COALESCE\(pb\.supplier_name, ''\)\) <> ''\)/)
  // ... and the group key is a real value, so the rows group and render.
  assert.match(route, /NULLIF\('name:' \|\| lower\(trim\(COALESCE\(pb\.supplier_name, ''\)\)\), 'name:'\), 'none'\)/)
})

runTest('a batch can be given a supplier from the batch editor', () => {
  const modal = src('components/inventory/ManageBatchesModal.tsx')
  // A searchable picker, like every other supplier field (owner's rule).
  assert.match(modal, /import SupplierPickerField from '\.\.\/shared\/SupplierPickerField\.tsx'/)
  assert.match(modal, /<SupplierPickerField/)
  // Seeded from the batch, and actually sent on save.
  assert.match(modal, /supplierId: batch\.supplier_id \?\? null/)
  assert.match(modal, /supplierName: String\(batch\.supplier_name \|\| ''\)/)
  assert.match(modal, /supplierName: draft\.supplierName\.trim\(\) \|\| null/)
  // Clearing the name must clear the id too, or the lot keeps a stale link.
  assert.match(modal, /supplierId: draft\.supplierName\.trim\(\) \? draft\.supplierId : null/)
  // The route has accepted these two fields all along -- this surface simply
  // never sent them, which is why only the session editor could fix a lot.
  const route = worker('routes/batches.ts')
  assert.match(route, /if \(bodyExtra\.supplier_name !== undefined\)/)
  assert.match(route, /updates\.push\('supplier_name = @supplier_name', 'supplier_id = @supplier_id'\)/)
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} no-supplier test(s) failed`)
} else {
  console.log('\nAll no-supplier tests passed')
}
